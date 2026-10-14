import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isSerializationFailure, pauseBeforeRetry } from "@/lib/prisma-errors";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import {
  carriedClassLevel,
  carriedRole,
  carryForwardYears,
  type CarryForwardInput,
} from "@/modules/club-rosters/carry-forward-domain";
import { ageOn, calendarDateOf } from "@/modules/club-rosters/domain";
import { RosterOperationError } from "@/modules/club-rosters/repository";

/**
 * Carrying last year's roster forward (#414). A carried person keeps the same
 * Person record and the same sealed birth date (the ciphertext is copied as is,
 * never opened); nothing goes into registrations or answers. Last year's rows
 * are not touched, so that roster stays readable for history, and removal
 * (ADR 0005 Addendum A section 6) works exactly as before. The audit and the
 * confirmation record hold ids and counts only.
 */

type Actor = { accountId: string } | { userId: string; actAsId?: string };
type Db = Prisma.TransactionClient;

const maxAttempts = 6;

async function runSerializable<T>(operation: (tx: Db) => Promise<T>) {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // A lost race (or a concurrent confirmation hitting the unique key) wrote nothing; the retry sees the winner.
      const retryable = isSerializationFailure(error)
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
      if (!retryable) throw error;
      if (attempt < maxAttempts - 1) await pauseBeforeRetry(attempt);
    }
  }
  throw new RosterOperationError("CARRY_FORWARD_BUSY", "Another change to this roster was in progress. Try again in a moment.");
}

export type CarryForwardCandidate = {
  memberId: string;
  firstName: string;
  lastName: string;
  attendeeType: "YOUTH" | "STAFF" | "ADULT" | "UNDERAGE";
  role: string;
  classLevel: string | null;
  /** An open transfer request moves this person to another club: shown flagged and unticked. */
  transferring: boolean;
  /** Whole years today, computed here. The birth date itself never leaves the server. */
  age: number | null;
};

export type CarryForwardOffer =
  | { state: "AVAILABLE"; fromClubYear: string; toClubYear: string; candidates: CarryForwardCandidate[] }
  | { state: "DONE"; fromClubYear: string; toClubYear: string; confirmedAt: Date }
  | { state: "NOTHING_TO_CARRY"; fromClubYear: string; toClubYear: string };

/** Who is already on the club's roster for the new year (removed rows hold no person). */
async function personsAlreadyOnTarget(db: Db, organizationId: string, toClubYear: string, personIds: string[]) {
  if (personIds.length === 0) return new Set<string>();
  const rows = await db.clubRosterMember.findMany({
    where: { organizationId, clubYear: toClubYear, personId: { in: personIds } },
    select: { personId: true },
  });
  return new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])));
}

/**
 * What the director sees: last year's active people who aren't on the new
 * year's roster yet, or that the year was already started. The caller has
 * already checked this director's access to this club.
 */
export async function getCarryForwardOffer(organizationId: string, now = new Date()): Promise<CarryForwardOffer> {
  const { fromClubYear, toClubYear } = carryForwardYears(now);
  const prisma = getPrisma();
  const done = await prisma.clubRosterCarryForward.findUnique({
    where: { organizationId_toClubYear: { organizationId, toClubYear } },
    select: { createdAt: true },
  });
  if (done) return { state: "DONE", fromClubYear, toClubYear, confirmedAt: done.createdAt };
  const members = await prisma.clubRosterMember.findMany({
    where: { organizationId, clubYear: fromClubYear, status: "ACTIVE", personId: { not: null } },
    select: {
      id: true, personId: true, attendeeType: true, role: true, classLevel: true, sealedBirthDate: true,
      person: { select: { firstName: true, lastName: true } },
    },
  });
  const present = await personsAlreadyOnTarget(prisma, organizationId, toClubYear, members.flatMap((member) => (member.personId ? [member.personId] : [])));
  const today = calendarDateOf(now);
  // Open outbound transfer requests (#489): pending or declined, still holding the person.
  const personIds = members.flatMap((member) => (member.personId ? [member.personId] : []));
  const transfers = personIds.length === 0 ? [] : await prisma.memberTransfer.findMany({
    where: { fromOrganizationId: organizationId, status: { in: ["PENDING", "DECLINED"] }, pendingPersonId: { in: personIds } },
    select: { pendingPersonId: true },
  });
  const transferring = new Set(transfers.flatMap((transfer) => (transfer.pendingPersonId ? [transfer.pendingPersonId] : [])));
  const candidates = members
    .filter((member) => member.personId && !present.has(member.personId))
    .map((member) => ({
      memberId: member.id,
      firstName: member.person?.firstName ?? "",
      lastName: member.person?.lastName ?? "",
      attendeeType: member.attendeeType,
      role: member.role,
      classLevel: member.classLevel,
      transferring: member.personId ? transferring.has(member.personId) : false,
      age: member.sealedBirthDate ? ageOn(openBirthDate(member.sealedBirthDate), today) : null,
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.memberId.localeCompare(b.memberId));
  if (candidates.length === 0) return { state: "NOTHING_TO_CARRY", fromClubYear, toClubYear };
  return { state: "AVAILABLE", fromClubYear, toClubYear, candidates };
}

export type CarryForwardResult = {
  fromClubYear: string;
  toClubYear: string;
  carried: number;
  leftBehind: number;
  typeChanged: number;
  /** Ticked people who were already on the new year's roster, so nothing was added for them. */
  alreadyThere: number;
  personIds: string[];
};

/**
 * One confirmation, one transaction. Refused cleanly (`CARRY_FORWARD_DONE`)
 * when this club already confirmed the new year, so a double click or a
 * second tab changes nothing. A person who is not an active member of this
 * club's previous roster is `MEMBER_NOT_FOUND`, the same answer for another
 * club's person as for an id that doesn't exist.
 */
export async function carryRosterForward(organizationId: string, input: CarryForwardInput, actor: Actor, now = new Date()): Promise<CarryForwardResult> {
  const { fromClubYear, toClubYear } = carryForwardYears(now);
  return runSerializable(async (tx) => {
    const done = await tx.clubRosterCarryForward.findUnique({
      where: { organizationId_toClubYear: { organizationId, toClubYear } },
      select: { id: true },
    });
    if (done) {
      throw new RosterOperationError("CARRY_FORWARD_DONE", "This club has already started its new year's roster.");
    }
    const ids = input.people.map((person) => person.memberId);
    // Lock the chosen rows. A removal that commits first, or one still running, makes this fail to serialize (or
    // shows the row as removed on the retry), so a person removed meanwhile is never carried.
    await tx.$queryRaw`SELECT "id" FROM "ClubRosterMember" WHERE "id" = ANY(${ids}::text[]) AND "organizationId" = ${organizationId} FOR UPDATE`;
    const sources = await tx.clubRosterMember.findMany({
      where: { id: { in: ids }, organizationId, clubYear: fromClubYear, status: "ACTIVE", personId: { not: null } },
      select: { id: true, personId: true, attendeeType: true, role: true, classLevel: true, gender: true, reportedAge: true, sealedBirthDate: true },
    });
    if (sources.length !== ids.length) {
      throw new RosterOperationError("MEMBER_NOT_FOUND", "One of those people isn't on last year's roster.");
    }
    const present = await personsAlreadyOnTarget(tx, organizationId, toClubYear, sources.flatMap((source) => (source.personId ? [source.personId] : [])));
    const choices = new Map(input.people.map((person) => [person.memberId, person]));
    const rows: Prisma.ClubRosterMemberCreateManyInput[] = [];
    let typeChanged = 0;
    for (const source of sources) {
      if (!source.personId || present.has(source.personId)) continue;
      const choice = choices.get(source.id)!;
      if (choice.attendeeType !== source.attendeeType) typeChanged += 1;
      rows.push({
        organizationId,
        clubYear: toClubYear,
        personId: source.personId,
        attendeeType: choice.attendeeType,
        role: carriedRole(source, choice),
        classLevel: carriedClassLevel(source, choice),
        gender: source.gender,
        reportedAge: source.reportedAge,
        // The ciphertext moves as it is: a carried birth date is never opened here, so it never exists in plain text.
        sealedBirthDate: source.sealedBirthDate,
        source: "DIRECTOR",
        ...("accountId" in actor ? { createdByAccountId: actor.accountId } : { createdByUserId: actor.userId }),
      });
    }
    const totalActive = await tx.clubRosterMember.count({
      where: { organizationId, clubYear: fromClubYear, status: "ACTIVE", personId: { not: null } },
    });
    const carried = rows.length;
    const alreadyThere = sources.length - carried;
    // People already on the new roster count as handled, not as left behind.
    const leftBehind = totalActive - sources.length;
    if (carried > 0) await tx.clubRosterMember.createMany({ data: rows });
    const record = await tx.clubRosterCarryForward.create({
      data: {
        organizationId,
        fromClubYear,
        toClubYear,
        carriedCount: carried,
        leftBehindCount: leftBehind,
        typeChangedCount: typeChanged,
        ...("accountId" in actor ? { confirmedByAccountId: actor.accountId } : { confirmedByUserId: actor.userId }),
      },
      select: { id: true },
    });
    await writeAuditLog({
      ...("userId" in actor ? { actorUserId: actor.userId } : {}),
      action: "CLUB_ROSTER_CARRIED_FORWARD",
      entityType: "Organization",
      entityId: organizationId,
      summary: "Started a club's next year roster by carrying people forward.",
      // Ids and counts only: no name, role or birth date.
      metadata: {
        organizationId,
        carryForwardId: record.id,
        fromClubYear,
        toClubYear,
        carried,
        leftBehind,
        typeChanged,
        alreadyThere,
        ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : { actAsId: actor.actAsId ?? null }),
      },
    }, tx);
    return {
      fromClubYear,
      toClubYear,
      carried,
      leftBehind,
      typeChanged,
      alreadyThere,
      personIds: rows.flatMap((row) => (row.personId ? [row.personId] : [])),
    };
  });
}

export type ClubNewYearStatus = {
  organizationId: string;
  name: string;
  church: string | null;
  /** Active people on last year's roster: what there is to carry. */
  lastYearActive: number;
  started: boolean;
};

/**
 * For staff and Area Coordinators (#414): which active clubs with people on
 * last year's roster haven't started the new year, a club counting as started
 * once its director confirmed a carry-forward or any person is on its new
 * roster. Counts only, never a person. The caller has already authorized the
 * viewer for the all-clubs view.
 */
export async function listClubsNewYearStatus(now = new Date()) {
  const { fromClubYear, toClubYear } = carryForwardYears(now);
  const prisma = getPrisma();
  const clubs = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentOrganization: { select: { name: true } } },
  });
  const clubIds = clubs.map((club) => club.id);
  const [lastYear, thisYear, confirmations] = await Promise.all([
    prisma.clubRosterMember.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: clubIds }, clubYear: fromClubYear, status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.clubRosterMember.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: clubIds }, clubYear: toClubYear, status: { not: "REMOVED" } },
      _count: { _all: true },
    }),
    prisma.clubRosterCarryForward.findMany({ where: { organizationId: { in: clubIds }, toClubYear }, select: { organizationId: true } }),
  ]);
  const last = new Map(lastYear.map((group) => [group.organizationId, group._count._all]));
  const started = new Set([...thisYear.map((group) => group.organizationId), ...confirmations.map((row) => row.organizationId)]);
  const statuses: ClubNewYearStatus[] = clubs
    .map((club) => ({
      organizationId: club.id,
      name: club.name,
      church: club.parentOrganization?.name ?? null,
      lastYearActive: last.get(club.id) ?? 0,
      started: started.has(club.id),
    }))
    .filter((club) => club.lastYearActive > 0);
  return {
    fromClubYear,
    toClubYear,
    clubs: statuses,
    notStarted: statuses.filter((club) => !club.started),
  };
}
