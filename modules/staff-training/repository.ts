import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import { clubRosterAttendeeTypeLabels, clubYearFor } from "@/modules/club-rosters/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";
import {
  STAFF_TRAINING_ATTENDEE_TYPES,
  STAFF_TRAINING_FEATURE_KEY,
  canManageStaffTraining,
  recordAuditName,
  recordLabel,
  sortRecordsNewestFirst,
  type NadCertificationKey,
  type StaffTrainingKind,
  type StaffTrainingRecordView,
} from "@/modules/staff-training/domain";
import type { StaffTrainingAddInput } from "@/modules/staff-training/schemas";

/**
 * Staff training records (#1697): the certifications and workshops recorded for the adults on a club's roster. The
 * callers (the page, the route handlers) have already checked the club role; every function here also needs the feature
 * switched on, and a person on this club's active roster for this club year. Every add and remove is audited.
 */

/** Who recorded it: the attendee account of a director or deputy, or a staff user acting as the club's director (#442). */
export type StaffTrainingActor = { accountId: string } | { userId: string; actAsId?: string; viaClubsAdministrator?: true };

export class StaffTrainingError extends Error {
  constructor(public readonly code: "FEATURE_OFF" | "PERSON_NOT_ON_ROSTER" | "RECORD_NOT_FOUND", message: string) {
    super(message);
    this.name = "StaffTrainingError";
  }
}

export type StaffTrainingPerson = {
  personId: string;
  firstName: string;
  lastName: string;
  typeLabel: string;
  records: StaffTrainingRecordView[];
};

export type StaffTrainingList = { clubYear: string; people: StaffTrainingPerson[] };

/**
 * Whether this viewer and club may use staff training records: the one check the page, the links and the route handlers
 * share, so a link is shown exactly when the page would open.
 */
export async function staffTrainingAvailable(organizationId: string, capabilities: Pick<ClubCapabilities, "editProfile">): Promise<boolean> {
  if (!canManageStaffTraining(capabilities)) return false;
  return isClubFeatureEnabled(organizationId, STAFF_TRAINING_FEATURE_KEY);
}

function toView(row: {
  id: string; kind: string; certificationKey: string | null; workshopCode: string | null; workshopTitle: string | null;
  completedOn: Date; signedOffBy: string | null; createdAt: Date;
}): StaffTrainingRecordView & { createdAt: string } {
  return {
    id: row.id,
    kind: row.kind as StaffTrainingKind,
    label: recordLabel(row),
    certificationKey: row.certificationKey as NadCertificationKey | null,
    workshopCode: row.workshopCode,
    workshopTitle: row.workshopTitle,
    completedOn: row.completedOn.toISOString().slice(0, 10),
    signedOffBy: row.signedOffBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function withoutCreatedAt(record: ReturnType<typeof toView>): StaffTrainingRecordView {
  const view: StaffTrainingRecordView & { createdAt?: string } = { ...record };
  delete view.createdAt;
  return view;
}

/** The list for this club year's active adult roster members, or null when this viewer or club may not have one. */
export async function loadStaffTraining(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  now = new Date(),
): Promise<StaffTrainingList | null> {
  if (!(await staffTrainingAvailable(organizationId, capabilities))) return null;
  const prisma = getPrisma();
  const clubYear = clubYearFor(now);
  const members = await prisma.clubRosterMember.findMany({
    where: { organizationId, clubYear, status: "ACTIVE", attendeeType: { in: [...STAFF_TRAINING_ATTENDEE_TYPES] }, personId: { not: null } },
    select: { personId: true, attendeeType: true, person: { select: { firstName: true, lastName: true } } },
  });
  const byPerson = new Map<string, (typeof members)[number]>();
  for (const member of members) if (member.personId && member.person && !byPerson.has(member.personId)) byPerson.set(member.personId, member);
  const personIds = [...byPerson.keys()];
  const records = personIds.length > 0
    ? await prisma.clubStaffTrainingRecord.findMany({
      where: { organizationId, personId: { in: personIds } },
      select: { id: true, personId: true, kind: true, certificationKey: true, workshopCode: true, workshopTitle: true, completedOn: true, signedOffBy: true, createdAt: true },
    })
    : [];
  const recordsByPerson = new Map<string, ReturnType<typeof toView>[]>();
  for (const row of records) recordsByPerson.set(row.personId, [...(recordsByPerson.get(row.personId) ?? []), toView(row)]);
  const people = [...byPerson.entries()]
    .map(([personId, member]) => ({
      personId,
      firstName: member.person!.firstName,
      lastName: member.person!.lastName,
      typeLabel: clubRosterAttendeeTypeLabels[member.attendeeType],
      records: sortRecordsNewestFirst(recordsByPerson.get(personId) ?? []).map(withoutCreatedAt),
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.personId.localeCompare(b.personId));
  return { clubYear, people };
}

function actorFields(actor: StaffTrainingActor) {
  return "accountId" in actor ? { createdByAccountId: actor.accountId } : { createdByUserId: actor.userId };
}

function auditActor(actor: StaffTrainingActor) {
  return "accountId" in actor
    ? { metadata: { actorAttendeeAccountId: actor.accountId } }
    : {
      actorUserId: actor.userId,
      metadata: { ...(actor.actAsId ? { actAsId: actor.actAsId } : {}), ...(actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}) },
    };
}

/**
 * Records a certification or workshop for a person on this club's active adult roster this club year. Needs the feature
 * on. Writes an audit entry naming the club, the person, the kind and the certification or workshop code.
 */
export async function addStaffTrainingRecord(organizationId: string, input: StaffTrainingAddInput, actor: StaffTrainingActor, now = new Date()) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    if (!(await isClubFeatureEnabled(organizationId, STAFF_TRAINING_FEATURE_KEY))) {
      throw new StaffTrainingError("FEATURE_OFF", "That page could not be found.");
    }
    const member = await tx.clubRosterMember.findFirst({
      where: { organizationId, personId: input.personId, clubYear: clubYearFor(now), status: "ACTIVE", attendeeType: { in: [...STAFF_TRAINING_ATTENDEE_TYPES] } },
      select: { id: true },
    });
    if (!member) throw new StaffTrainingError("PERSON_NOT_ON_ROSTER", "That person is not an adult on this club's roster.");
    const created = await tx.clubStaffTrainingRecord.create({
      data: {
        organizationId,
        personId: input.personId,
        kind: input.kind,
        certificationKey: input.kind === "CERTIFICATION" ? input.certificationKey : null,
        workshopCode: input.kind === "WORKSHOP" ? input.workshopCode : null,
        workshopTitle: input.kind === "WORKSHOP" ? input.workshopTitle : null,
        completedOn: new Date(`${input.completedOn}T00:00:00.000Z`),
        signedOffBy: input.signedOffBy ?? null,
        ...actorFields(actor),
      },
      select: { id: true, kind: true, certificationKey: true, workshopCode: true, workshopTitle: true, completedOn: true, signedOffBy: true, createdAt: true },
    });
    const who = auditActor(actor);
    await writeAuditLog({
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_STAFF_TRAINING_ADDED",
      entityType: "ClubStaffTrainingRecord",
      entityId: created.id,
      summary: `Recorded ${recordAuditName(created)} for a person on the club's roster.`,
      metadata: {
        organizationId,
        personId: input.personId,
        kind: created.kind,
        certificationKey: created.certificationKey,
        workshopCode: created.workshopCode,
        ...who.metadata,
      },
    }, tx);
    return toView(created);
  });
}

/** Removes one record of this club. Needs the feature on. Writes an audit entry with the same details as the add. */
export async function removeStaffTrainingRecord(organizationId: string, recordId: string, actor: StaffTrainingActor) {
  return getPrisma().$transaction(async (tx) => {
    if (!(await isClubFeatureEnabled(organizationId, STAFF_TRAINING_FEATURE_KEY))) {
      throw new StaffTrainingError("FEATURE_OFF", "That page could not be found.");
    }
    const record = await tx.clubStaffTrainingRecord.findFirst({
      where: { id: recordId, organizationId },
      select: { id: true, personId: true, kind: true, certificationKey: true, workshopCode: true },
    });
    if (!record) throw new StaffTrainingError("RECORD_NOT_FOUND", "That record could not be found.");
    const removed = await tx.clubStaffTrainingRecord.deleteMany({ where: { id: record.id, organizationId } });
    if (removed.count === 0) throw new StaffTrainingError("RECORD_NOT_FOUND", "That record could not be found.");
    const who = auditActor(actor);
    await writeAuditLog({
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_STAFF_TRAINING_REMOVED",
      entityType: "ClubStaffTrainingRecord",
      entityId: record.id,
      summary: `Removed ${recordAuditName(record)} from a person on the club's roster.`,
      metadata: {
        organizationId,
        personId: record.personId,
        kind: record.kind,
        certificationKey: record.certificationKey,
        workshopCode: record.workshopCode,
        ...who.metadata,
      },
    }, tx);
  });
}
