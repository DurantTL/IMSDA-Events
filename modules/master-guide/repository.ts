import "server-only";

import { Prisma } from "@prisma/client";
import { logError } from "@/lib/logger";
import { formatPersonName } from "@/lib/person-name";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { ageOn, calendarDateOf, clubYearFor } from "@/modules/club-rosters/domain";
import type { MasterGuideAreaActor, MasterGuideClubActor } from "@/modules/master-guide/access";
import { areaClubWhere } from "@/modules/organizations/area-coordinator-ministries-domain";
import { coordinatorMinistriesForAccount } from "@/modules/organizations/area-coordinators";
import type { ClubKindValue } from "@/modules/organizations/club-kind";
import {
  MASTER_GUIDE_FEATURE_KEY,
  MASTER_GUIDE_MIN_START_AGE,
  MasterGuideError,
  addProblem,
  areaCoordinatorMayApproveForClub,
  canTransition,
  clubApprovalProblem,
  isEditable,
  isMasterGuideStatus,
  masterGuideWindow,
  type MasterGuideStatus,
  type MasterGuideWindow,
  BIRTH_DATE_NEEDED,
  BIRTH_DATE_UNREADABLE,
  BIRTH_DATE_UNREADABLE_MESSAGE,
  type RosterBirthDate,
} from "@/modules/master-guide/domain";

/**
 * Master Guide candidates (#1698). Every function here re-checks that the club has the feature on, so a page or route that
 * forgot to would still find nothing. The roster's sealed birth date is opened only to work out an age and is never
 * returned or stored here. Every add, change, removal and approval writes an audit entry with ids and the status change.
 */

type Db = Prisma.TransactionClient;

export type MasterGuideRow = {
  id: string;
  personId: string;
  name: string;
  startedOn: string;
  mentorName: string | null;
  status: MasterGuideStatus;
  window: MasterGuideWindow | null;
  clubApprovedOn: string | null;
  areaApprovedOn: string | null;
  /** Why the club cannot approve right now (age, missing birth date), or null when it can. Only while in progress. */
  approvalProblem: string | null;
};

export type MasterGuideEligible = { personId: string; name: string };

export type MasterGuideList = {
  clubYear: string;
  rows: MasterGuideRow[];
  /** Active people 16 or older this club year who are not candidates yet. */
  eligible: MasterGuideEligible[];
  /** Active people with no birth date on the roster, who cannot be added until it is there. */
  needBirthDate: string[];
  /** Active people whose roster birth date could not be read, so no age can be worked out. */
  unreadableBirthDate: string[];
};

export type AreaApprovalRow = {
  id: string;
  organizationId: string;
  clubName: string;
  name: string;
  startedOn: string;
  mentorName: string | null;
  clubApprovedOn: string | null;
  window: MasterGuideWindow | null;
};

/** Opens a sealed birth date. A sealed value that cannot be opened (a key or setup problem) is "unreadable", not "missing"; the error is logged, never the value. */
function openBirthDateOrFlag(sealed: string | null): RosterBirthDate {
  if (!sealed) return null;
  try {
    return openBirthDate(sealed);
  } catch (error) {
    logError("A roster birth date could not be opened for Master Guide tracking", error);
    return BIRTH_DATE_UNREADABLE;
  }
}

function birthDateProblemCode(problem: string, otherwise: "TOO_YOUNG_TO_START" | "TOO_YOUNG_TO_APPROVE") {
  if (problem === BIRTH_DATE_NEEDED) return "BIRTH_DATE_NEEDED" as const;
  if (problem === BIRTH_DATE_UNREADABLE_MESSAGE) return "BIRTH_DATE_UNREADABLE" as const;
  if (problem.startsWith("Enter")) return "INVALID_DATE" as const;
  return otherwise;
}

function attributionData(actor: MasterGuideClubActor) {
  return "accountId" in actor ? { createdByAccountId: actor.accountId } : { createdByUserId: actor.userId };
}

function auditActor(actor: MasterGuideClubActor | MasterGuideAreaActor) {
  return "accountId" in actor
    ? { metadata: { actorAttendeeAccountId: actor.accountId } }
    : {
      actorUserId: actor.userId,
      metadata: { actAsId: actor.actAsId, ...(actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}) },
    };
}

async function assertClubAndFeature(db: Db, organizationId: string) {
  const club = await db.organization.findUnique({ where: { id: organizationId }, select: { type: true, isActive: true } });
  if (!club || club.type !== "CLUB" || !club.isActive) throw new MasterGuideError("NOT_FOUND", "That club could not be found.");
  const on = await db.clubOptionalFeature.findUnique({
    where: { organizationId_featureKey: { organizationId, featureKey: MASTER_GUIDE_FEATURE_KEY } },
    select: { id: true },
  });
  if (!on) throw new MasterGuideError("FEATURE_OFF", "Master Guide tracking is off for this club.");
}

/** The birth date the roster holds for a person in this club: the newest active row that has one. Never returned to a caller outside this module. */
async function rosterBirthDate(db: Db, organizationId: string, personId: string): Promise<RosterBirthDate> {
  const rows = await db.clubRosterMember.findMany({
    where: { organizationId, personId, status: "ACTIVE" },
    orderBy: { clubYear: "desc" },
    select: { sealedBirthDate: true },
  });
  let unreadable = false;
  for (const row of rows) {
    const opened = openBirthDateOrFlag(row.sealedBirthDate);
    if (opened === BIRTH_DATE_UNREADABLE) unreadable = true;
    else if (opened) return opened;
  }
  return unreadable ? BIRTH_DATE_UNREADABLE : null;
}

/** Whether the feature is on for this club: the one check the pages share. */
export async function masterGuideAvailable(organizationId: string): Promise<boolean> {
  return isClubFeatureEnabled(organizationId, MASTER_GUIDE_FEATURE_KEY);
}

/** Whether any club has the feature on, so an Area Coordinator's menu shows the approvals only when there could be some. */
export async function anyClubUsesMasterGuide(): Promise<boolean> {
  const count = await getPrisma().clubOptionalFeature.count({ where: { featureKey: MASTER_GUIDE_FEATURE_KEY } });
  return count > 0;
}

/** The club's list, or null when the feature is off. */
export async function loadMasterGuide(organizationId: string, now = new Date()): Promise<MasterGuideList | null> {
  if (!(await masterGuideAvailable(organizationId))) return null;
  const prisma = getPrisma();
  const clubYear = clubYearFor(now);
  const today = calendarDateOf(now);
  const [candidates, members] = await Promise.all([
    prisma.masterGuideCandidate.findMany({
      where: { organizationId },
      select: {
        id: true, personId: true, startedOn: true, mentorName: true, status: true, clubApprovedAt: true, areaApprovedAt: true,
        person: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.clubRosterMember.findMany({
      where: { organizationId, status: "ACTIVE", personId: { not: null } },
      orderBy: { clubYear: "desc" },
      select: { personId: true, clubYear: true, sealedBirthDate: true, person: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  // One birth date per person: the newest active row that has one. The sealed value is opened here and dropped.
  const birthByPerson = new Map<string, string>();
  const unreadable = new Set<string>();
  for (const member of members) {
    if (!member.personId || birthByPerson.has(member.personId)) continue;
    const opened = openBirthDateOrFlag(member.sealedBirthDate);
    if (opened === BIRTH_DATE_UNREADABLE) unreadable.add(member.personId);
    else if (opened) birthByPerson.set(member.personId, opened);
  }
  const rows: MasterGuideRow[] = candidates
    .map((candidate): MasterGuideRow => {
      const startedOn = calendarDateOf(candidate.startedOn);
      const status = isMasterGuideStatus(candidate.status) ? candidate.status : "IN_PROGRESS";
      const clubApprovedOn = candidate.clubApprovedAt ? calendarDateOf(candidate.clubApprovedAt) : null;
      return {
        id: candidate.id,
        personId: candidate.personId,
        name: formatPersonName(candidate.person),
        startedOn,
        mentorName: candidate.mentorName,
        status,
        window: masterGuideWindow(startedOn, today, clubApprovedOn),
        clubApprovedOn,
        areaApprovedOn: candidate.areaApprovedAt ? calendarDateOf(candidate.areaApprovedAt) : null,
        approvalProblem: status === "IN_PROGRESS" ? clubApprovalProblem(birthByPerson.get(candidate.personId) ?? (unreadable.has(candidate.personId) ? BIRTH_DATE_UNREADABLE : null), today) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const taken = new Set(candidates.map((candidate) => candidate.personId));
  const thisYear = members.filter((member) => member.clubYear === clubYear && member.personId && !taken.has(member.personId));
  const seen = new Set<string>();
  const eligible: MasterGuideEligible[] = [];
  const needBirthDate: string[] = [];
  const unreadableBirthDate: string[] = [];
  for (const member of thisYear) {
    const personId = member.personId!;
    if (seen.has(personId)) continue;
    seen.add(personId);
    const name = formatPersonName(member.person ?? {});
    const birth = birthByPerson.get(personId);
    if (!birth && unreadable.has(personId)) {
      unreadableBirthDate.push(name);
      continue;
    }
    if (!birth) {
      needBirthDate.push(name);
      continue;
    }
    const age = ageOn(birth, today);
    if (age !== null && age >= MASTER_GUIDE_MIN_START_AGE) eligible.push({ personId, name });
  }
  eligible.sort((a, b) => a.name.localeCompare(b.name));
  needBirthDate.sort((a, b) => a.localeCompare(b));
  unreadableBirthDate.sort((a, b) => a.localeCompare(b));
  return { clubYear, rows, eligible, needBirthDate, unreadableBirthDate };
}

export async function addCandidate(
  organizationId: string,
  input: { personId: string; startedOn: string; mentorName?: string | null },
  actor: MasterGuideClubActor,
  now = new Date(),
) {
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      await assertClubAndFeature(tx, organizationId);
      const member = await tx.clubRosterMember.findFirst({
        where: { organizationId, personId: input.personId, status: "ACTIVE", clubYear: clubYearFor(now) },
        select: { id: true },
      });
      if (!member) throw new MasterGuideError("NOT_ON_ROSTER", "Pick someone on this club year's active roster.");
      const birthDate = await rosterBirthDate(tx, organizationId, input.personId);
      const problem = addProblem(birthDate, input.startedOn);
      if (problem) {
        throw new MasterGuideError(
          birthDateProblemCode(problem, "TOO_YOUNG_TO_START"),
          problem,
        );
      }
      const created = await tx.masterGuideCandidate.create({
        data: {
          organizationId,
          personId: input.personId,
          startedOn: new Date(`${input.startedOn}T00:00:00.000Z`),
          mentorName: input.mentorName ?? null,
          status: "IN_PROGRESS",
          ...attributionData(actor),
        },
        select: { id: true },
      });
      const who = auditActor(actor);
      await writeAuditLog({
        ...("actorUserId" in who ? { actorUserId: who.actorUserId } : {}),
        action: "MASTER_GUIDE_CANDIDATE_ADDED",
        entityType: "MasterGuideCandidate",
        entityId: created.id,
        summary: "Added a Master Guide candidate.",
        metadata: { organizationId, personId: input.personId, startedOn: input.startedOn, toStatus: "IN_PROGRESS", ...who.metadata },
      }, tx);
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new MasterGuideError("ALREADY_A_CANDIDATE", "That person is already a Master Guide candidate in this club.");
    }
    throw error;
  }
}

async function loadOwnCandidate(db: Db, organizationId: string, candidateId: string) {
  const candidate = await db.masterGuideCandidate.findFirst({
    where: { id: candidateId, organizationId },
    select: { id: true, personId: true, startedOn: true, mentorName: true, status: true },
  });
  if (!candidate) throw new MasterGuideError("NOT_FOUND", "That candidate could not be found.");
  const status = isMasterGuideStatus(candidate.status) ? candidate.status : null;
  if (!status) throw new MasterGuideError("WRONG_STATUS", "That candidate's status is not recognised.");
  return { ...candidate, status };
}

export async function updateCandidate(
  organizationId: string,
  candidateId: string,
  input: { startedOn: string; mentorName?: string | null },
  actor: MasterGuideClubActor,
) {
  await getPrisma().$transaction(async (tx) => {
    await assertClubAndFeature(tx, organizationId);
    const candidate = await loadOwnCandidate(tx, organizationId, candidateId);
    if (!isEditable(candidate.status)) throw new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be changed.");
    const birthDate = await rosterBirthDate(tx, organizationId, candidate.personId);
    const problem = addProblem(birthDate, input.startedOn);
    if (problem) {
      throw new MasterGuideError(
        birthDateProblemCode(problem, "TOO_YOUNG_TO_START"),
        problem,
      );
    }
    const mentorName = input.mentorName ?? null;
    const result = await tx.masterGuideCandidate.updateMany({
      where: { id: candidateId, organizationId, status: "IN_PROGRESS" },
      data: { startedOn: new Date(`${input.startedOn}T00:00:00.000Z`), mentorName },
    });
    if (result.count === 0) throw new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be changed.");
    const who = auditActor(actor);
    await writeAuditLog({
      ...("actorUserId" in who ? { actorUserId: who.actorUserId } : {}),
      action: "MASTER_GUIDE_CANDIDATE_UPDATED",
      entityType: "MasterGuideCandidate",
      entityId: candidateId,
      summary: "Changed a Master Guide candidate's start date or mentor.",
      metadata: {
        organizationId,
        personId: candidate.personId,
        fromStartedOn: calendarDateOf(candidate.startedOn),
        toStartedOn: input.startedOn,
        mentorChanged: (candidate.mentorName ?? null) !== mentorName,
        fromStatus: "IN_PROGRESS",
        toStatus: "IN_PROGRESS",
        ...who.metadata,
      },
    }, tx);
  });
}

export async function removeCandidate(organizationId: string, candidateId: string, actor: MasterGuideClubActor) {
  await getPrisma().$transaction(async (tx) => {
    await assertClubAndFeature(tx, organizationId);
    const candidate = await loadOwnCandidate(tx, organizationId, candidateId);
    if (!isEditable(candidate.status)) throw new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be removed.");
    const result = await tx.masterGuideCandidate.deleteMany({ where: { id: candidateId, organizationId, status: "IN_PROGRESS" } });
    if (result.count === 0) throw new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be removed.");
    const who = auditActor(actor);
    await writeAuditLog({
      ...("actorUserId" in who ? { actorUserId: who.actorUserId } : {}),
      action: "MASTER_GUIDE_CANDIDATE_REMOVED",
      entityType: "MasterGuideCandidate",
      entityId: candidateId,
      summary: "Removed a Master Guide candidate.",
      metadata: { organizationId, personId: candidate.personId, fromStatus: "IN_PROGRESS", ...who.metadata },
    }, tx);
  });
}

/** The club approves: IN_PROGRESS to CLUB_APPROVED, only when the candidate is 18 or older today and the roster has a birth date. */
export async function approveForClub(organizationId: string, candidateId: string, actor: MasterGuideClubActor, now = new Date()) {
  await getPrisma().$transaction(async (tx) => {
    await assertClubAndFeature(tx, organizationId);
    const candidate = await loadOwnCandidate(tx, organizationId, candidateId);
    if (!canTransition(candidate.status, "CLUB_APPROVED")) throw new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be approved by the club.");
    const onRoster = await tx.clubRosterMember.findFirst({
      where: { organizationId, personId: candidate.personId, status: "ACTIVE", clubYear: clubYearFor(now) },
      select: { id: true },
    });
    if (!onRoster) throw new MasterGuideError("NOT_ON_ROSTER", "This person is no longer on this club year's active roster, so the club cannot approve them.");
    const today = calendarDateOf(now);
    const problem = clubApprovalProblem(await rosterBirthDate(tx, organizationId, candidate.personId), today);
    if (problem) throw new MasterGuideError(birthDateProblemCode(problem, "TOO_YOUNG_TO_APPROVE"), problem);
    const result = await tx.masterGuideCandidate.updateMany({
      where: { id: candidateId, organizationId, status: "IN_PROGRESS" },
      data: {
        status: "CLUB_APPROVED",
        clubApprovedAt: now,
        ...("accountId" in actor ? { clubApprovedByAccountId: actor.accountId } : { clubApprovedByUserId: actor.userId }),
      },
    });
    if (result.count === 0) throw new MasterGuideError("WRONG_STATUS", "Only a candidate still in progress can be approved by the club.");
    const who = auditActor(actor);
    await writeAuditLog({
      ...("actorUserId" in who ? { actorUserId: who.actorUserId } : {}),
      action: "MASTER_GUIDE_CLUB_APPROVED",
      entityType: "MasterGuideCandidate",
      entityId: candidateId,
      summary: "The club approved a Master Guide candidate.",
      metadata: { organizationId, personId: candidate.personId, fromStatus: "IN_PROGRESS", toStatus: "CLUB_APPROVED", ...who.metadata },
    }, tx);
  });
}

/**
 * Candidates the club approved and the Area Coordinator has not yet, in clubs of the coordinator's ministries (#843) with the
 * feature on, for the coordinator's page.
 */
export async function listAreaApprovalQueue(ministries: readonly ClubKindValue[], now = new Date()): Promise<AreaApprovalRow[]> {
  if (ministries.length === 0) return [];
  const today = calendarDateOf(now);
  const candidates = await getPrisma().masterGuideCandidate.findMany({
    where: {
      status: "CLUB_APPROVED",
      organization: { ...areaClubWhere(ministries), clubOptionalFeatures: { some: { featureKey: MASTER_GUIDE_FEATURE_KEY } } },
    },
    select: {
      id: true, organizationId: true, startedOn: true, mentorName: true, clubApprovedAt: true,
      person: { select: { firstName: true, lastName: true } },
      organization: { select: { name: true, clubKind: true } },
    },
  });
  return candidates
    .filter((candidate) => areaCoordinatorMayApproveForClub(ministries, candidate.organization.clubKind))
    .map((candidate): AreaApprovalRow => {
      const startedOn = calendarDateOf(candidate.startedOn);
      const clubApprovedOn = candidate.clubApprovedAt ? calendarDateOf(candidate.clubApprovedAt) : null;
      return {
        id: candidate.id,
        organizationId: candidate.organizationId,
        clubName: candidate.organization.name,
        name: formatPersonName(candidate.person),
        startedOn,
        mentorName: candidate.mentorName,
        clubApprovedOn,
        window: masterGuideWindow(startedOn, today, clubApprovedOn),
      };
    })
    .sort((a, b) => a.clubName.localeCompare(b.clubName) || a.name.localeCompare(b.name));
}

/**
 * The Area Coordinator approves: CLUB_APPROVED to AREA_APPROVED. Only for a club of their ministries (#843, read fresh from
 * their grant) with the feature on, and only a candidate the club already approved; nothing else about the candidate can
 * change here. A club outside their ministries answers like a missing candidate.
 */
export async function approveForArea(candidateId: string, actor: MasterGuideAreaActor, now = new Date()) {
  await getPrisma().$transaction(async (tx) => {
    const candidate = await tx.masterGuideCandidate.findUnique({
      where: { id: candidateId },
      select: { id: true, organizationId: true, personId: true, status: true, organization: { select: { clubKind: true, guestEventId: true } } },
    });
    const ministries = candidate ? await coordinatorMinistriesForAccount(actor.accountId, now, tx) : [];
    if (!candidate || candidate.organization.guestEventId !== null || !areaCoordinatorMayApproveForClub(ministries, candidate.organization.clubKind)) throw new MasterGuideError("NOT_FOUND", "That candidate could not be found.");
    await assertClubAndFeature(tx, candidate.organizationId);
    const status = isMasterGuideStatus(candidate.status) ? candidate.status : null;
    if (!status || !canTransition(status, "AREA_APPROVED")) throw new MasterGuideError("WRONG_STATUS", "Only a candidate the club has approved can be approved here.");
    const result = await tx.masterGuideCandidate.updateMany({
      where: { id: candidateId, status: "CLUB_APPROVED" },
      data: { status: "AREA_APPROVED", areaApprovedAt: now, areaApprovedByAccountId: actor.accountId },
    });
    if (result.count === 0) throw new MasterGuideError("WRONG_STATUS", "Only a candidate the club has approved can be approved here.");
    await writeAuditLog({
      action: "MASTER_GUIDE_AREA_APPROVED",
      entityType: "MasterGuideCandidate",
      entityId: candidateId,
      summary: "An Area Coordinator approved a Master Guide candidate.",
      metadata: { organizationId: candidate.organizationId, personId: candidate.personId, fromStatus: "CLUB_APPROVED", toStatus: "AREA_APPROVED", actorAttendeeAccountId: actor.accountId },
    }, tx);
  });
}
