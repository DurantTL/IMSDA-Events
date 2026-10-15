import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { calendarDateOf, isMinorRosterPerson } from "@/modules/club-rosters/domain";
import {
  GUARDIAN_SLOTS,
  guardianAuditActor,
  guardianSlotsFrom,
  guardianViewerCanRead,
  type GuardianInput,
  type GuardianRecord,
  type GuardianViewer,
} from "@/modules/club-rosters/guardians-domain";

/**
 * Emergency contact storage (#510), kept in the `ClubRosterGuardian` table. Plain text by decision, so the protection
 * is who may ask: every read below takes a `GuardianViewer`, which callers are
 * expected to build only through `guardians-access.ts` (the type is
 * structural, so that is a convention, not a compile-time guarantee), and the
 * read checks it again.
 *
 * Audit entries and logs carry field names and counts only, never a name,
 * email, phone number or relationship.
 */

export class GuardianAccessError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "You don't have access to emergency contacts for this club.") {
    super(message);
    this.name = "GuardianAccessError";
  }
}

function assertCanRead(viewer: GuardianViewer, organizationId: string) {
  if (!guardianViewerCanRead(viewer, organizationId)) throw new GuardianAccessError();
}

const guardianSelect = {
  position: true,
  name: true,
  relationship: true,
  email: true,
  phone: true,
} satisfies Prisma.ClubRosterGuardianSelect;

function toRecord(row: { position: number; name: string; relationship: string; email: string; phone: string }): GuardianRecord {
  return { position: row.position, name: row.name, relationship: row.relationship, email: row.email, phone: row.phone };
}

/** The member fields minor status is worked out from. The sealed birth date is opened here and never returned. */
const minorSelect = { attendeeType: true, reportedAge: true, sealedBirthDate: true } satisfies Prisma.ClubRosterMemberSelect;

type MinorFields = { attendeeType: string; reportedAge: number | null; sealedBirthDate: string | null };

/**
 * Whether a stored member is a minor today (#510), on the roster's own age
 * rules (`isMinorRosterPerson`). Emergency contacts are for minors only, so
 * every read below drops a member who is not one: an adult's old row (from
 * before the Oct 15 decision) stays stored but is never shown or exported.
 */
export function storedMemberIsMinor(member: MinorFields, today = calendarDateOf(new Date())) {
  return isMinorRosterPerson(
    member.attendeeType,
    member.sealedBirthDate ? openBirthDate(member.sealedBirthDate) : null,
    today,
    member.reportedAge,
  );
}

/**
 * Replaces one member's whole guardian set inside the caller's transaction:
 * each non-blank slot is stored under its position, every other position is
 * deleted. Returns counts only, for the caller's audit entry. The caller has
 * already checked that the actor may edit guardians for this club.
 */
export async function replaceGuardians(
  tx: Prisma.TransactionClient,
  rosterMemberId: string,
  guardians: readonly GuardianInput[],
): Promise<{ stored: number; cleared: number }> {
  const slots = guardianSlotsFrom(guardians);
  const kept = new Set(slots.map((slot) => slot.position));
  for (const slot of slots) {
    const values = { name: slot.name, relationship: slot.relationship, email: slot.email, phone: slot.phone };
    await tx.clubRosterGuardian.upsert({
      where: { rosterMemberId_position: { rosterMemberId, position: slot.position } },
      create: { rosterMemberId, position: slot.position, ...values },
      update: values,
    });
  }
  const positionsToClear = Array.from({ length: GUARDIAN_SLOTS }, (_, index) => index + 1).filter((position) => !kept.has(position));
  const cleared = await tx.clubRosterGuardian.deleteMany({ where: { rosterMemberId, position: { in: positionsToClear } } });
  return { stored: slots.length, cleared: cleared.count };
}

/** Deletes every guardian of a member (removal, transfer-out). Returns how many went. */
export async function deleteGuardiansForMember(tx: Prisma.TransactionClient, rosterMemberId: string): Promise<number> {
  const result = await tx.clubRosterGuardian.deleteMany({ where: { rosterMemberId } });
  return result.count;
}

/**
 * The club's guardians keyed by roster member id, for the club leader's roster
 * dialog. Members who were removed have none (their rows were deleted).
 */
export async function listGuardiansByMember(
  viewer: GuardianViewer,
  organizationId: string,
  clubYear: string,
): Promise<Record<string, GuardianRecord[]>> {
  assertCanRead(viewer, organizationId);
  const rows = await getPrisma().clubRosterGuardian.findMany({
    where: { rosterMember: { organizationId, clubYear, status: { not: "REMOVED" } } },
    orderBy: [{ rosterMemberId: "asc" }, { position: "asc" }],
    select: { rosterMemberId: true, ...guardianSelect, rosterMember: { select: minorSelect } },
  });
  const today = calendarDateOf(new Date());
  const byMember: Record<string, GuardianRecord[]> = {};
  for (const row of rows) {
    if (storedMemberIsMinor(row.rosterMember, today)) (byMember[row.rosterMemberId] ??= []).push(toRecord(row));
  }
  return byMember;
}

export type ClubGuardianContact = {
  memberId: string;
  firstName: string;
  lastName: string;
  attendeeType: string;
  status: string;
  guardians: GuardianRecord[];
};

/**
 * Everyone on a club's roster who has at least one guardian on file, with the
 * guardians, for the read-only panel on a club page. A leader reading their own
 * club is the club's normal work and isn't audited; an Area Coordinator or
 * staff opening the list is audited first (who, which club, how many people
 * and contacts), and nothing is returned if that write fails.
 */
export async function listGuardianContactsForClub(
  viewer: GuardianViewer,
  organizationId: string,
  clubYear: string,
): Promise<ClubGuardianContact[]> {
  assertCanRead(viewer, organizationId);
  const members = await getPrisma().clubRosterMember.findMany({
    where: { organizationId, clubYear, status: { not: "REMOVED" }, guardians: { some: {} } },
    select: {
      id: true,
      attendeeType: true,
      reportedAge: true,
      sealedBirthDate: true,
      status: true,
      person: { select: { firstName: true, lastName: true } },
      guardians: { orderBy: { position: "asc" }, select: guardianSelect },
    },
  });
  const today = calendarDateOf(new Date());
  const contacts = members
    .filter((member) => storedMemberIsMinor(member, today))
    .map((member) => ({
      memberId: member.id,
      firstName: member.person?.firstName ?? "",
      lastName: member.person?.lastName ?? "",
      attendeeType: member.attendeeType,
      status: member.status,
      guardians: member.guardians.map(toRecord),
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.memberId.localeCompare(b.memberId));
  if (viewer.kind !== "CLUB_LEADER") {
    const who = guardianAuditActor(viewer);
    await writeAuditLog({
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_ROSTER_GUARDIANS_VIEWED",
      entityType: "Organization",
      entityId: organizationId,
      summary: "Opened the emergency contacts on a club roster.",
      metadata: {
        ...who.metadata,
        organizationId,
        clubYear,
        memberCount: contacts.length,
        guardianCount: contacts.reduce((total, contact) => total + contact.guardians.length, 0),
      },
    });
  }
  return contacts;
}

/**
 * Guardians for a set of members, for the export builder. The caller (the
 * export) has already confirmed the actor may see guardians for this club.
 */
export async function guardiansForExport(organizationId: string, clubYear: string, memberIds: string[] | null) {
  const rows = await getPrisma().clubRosterGuardian.findMany({
    where: {
      rosterMember: { organizationId, clubYear, status: { not: "REMOVED" } },
      ...(memberIds ? { rosterMemberId: { in: memberIds } } : {}),
    },
    orderBy: [{ rosterMemberId: "asc" }, { position: "asc" }],
    select: { rosterMemberId: true, ...guardianSelect, rosterMember: { select: minorSelect } },
  });
  const today = calendarDateOf(new Date());
  const byMember: Record<string, GuardianRecord[]> = {};
  for (const row of rows) {
    if (storedMemberIsMinor(row.rosterMember, today)) (byMember[row.rosterMemberId] ??= []).push(toRecord(row));
  }
  return byMember;
}
