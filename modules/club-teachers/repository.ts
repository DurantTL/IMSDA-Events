import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { isModuleEnabled } from "@/modules/event-modules/service";
import {
  canTeach,
  teacherStatus,
  teacherWarning,
  type TeacherEntriesInput,
  type TeacherRule,
  type TeacherStatus,
} from "@/modules/club-teachers/domain";

export class ClubTeacherError extends Error {
  constructor(
    public readonly code: "NOT_AVAILABLE" | "MEMBER_INVALID" | "LOCATION_INVALID" | "TEACHERS_REQUIRED" | "EVENT_NOT_FOUND" | "NOT_A_CLUB_EVENT",
    message: string,
  ) {
    super(message);
    this.name = "ClubTeacherError";
  }
}

/** Who made a change: an attendee account (a club director or Area Coordinator) or a staff user, never both. */
export type TeacherActor = { accountId: string } | { userId: string; actAsId?: string };

export function auditActor(actor: TeacherActor): { actorUserId?: string; metadata: Prisma.InputJsonObject } {
  if ("accountId" in actor) return { metadata: { actorAttendeeAccountId: actor.accountId } };
  return { actorUserId: actor.userId, metadata: actor.actAsId ? { actAsId: actor.actAsId } : {} };
}

type RuleRow = { baseTeachers: number; largerClubOver: number | null; largerClubTeachers: number; requireTeachers: boolean };

export function ruleFromRow(row: RuleRow): TeacherRule {
  return {
    baseTeachers: row.baseTeachers,
    largerClubOver: row.largerClubOver,
    largerClubTeachers: row.largerClubTeachers,
    requireTeachers: row.requireTeachers,
  };
}

/** The saved rule, even while the module is off (turning it off keeps the data). */
export async function getTeacherRule(eventId: string): Promise<TeacherRule | null> {
  const row = await getPrisma().clubTeacherRule.findUnique({ where: { eventId } });
  return row ? ruleFromRow(row) : null;
}

/**
 * The rule clubs are held to: only while the Club teachers module is on for the event AND a rule has been saved.
 * Switching the module on alone changes nothing for a club; it needs the rule too. Null means the tool is not in use.
 */
export async function activeTeacherRule(eventId: string): Promise<TeacherRule | null> {
  if (!(await isModuleEnabled(eventId, "club-teachers"))) return null;
  return getTeacherRule(eventId);
}

export type ClubTeacherStep = {
  rule: TeacherRule;
  /** People the club is bringing, for the larger-club number: the registration's people, else the draft's. */
  headcount: number;
  registered: boolean;
  status: TeacherStatus;
  warning: string | null;
  /** Active adult and staff roster members of the club for this club year: the only people who can be named. */
  candidates: Array<{ memberId: string; name: string; role: string }>;
  teachers: Array<{ memberId: string; name: string; honorName: string; locationId: string | null }>;
  locations: Array<{ id: string; name: string }>;
};

function personName(person: { firstName: string; lastName: string } | null): string {
  return person ? `${person.lastName}, ${person.firstName}`.trim() : "Unnamed person";
}

async function clubEvent(eventId: string) {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, isPublished: true, archivedAt: null, audience: "CLUB" },
    select: { id: true, startsAt: true },
  });
  if (!event) throw new ClubTeacherError("EVENT_NOT_FOUND", "That club event could not be found.");
  return event;
}

/** How many people a club is bringing: its registration's people when it has one, otherwise the draft's picks and guests. */
async function clubHeadcount(eventId: string, organizationId: string): Promise<{ headcount: number; registered: boolean }> {
  const prisma = getPrisma();
  const registration = await prisma.clubEventRegistration.findFirst({
    where: { eventId, organizationId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    select: { registration: { select: { _count: { select: { attendees: true } } } } },
  });
  if (registration) return { headcount: registration.registration._count.attendees, registered: true };
  const draft = await prisma.clubRegistrationDraft.findFirst({ where: { eventId, organizationId }, orderBy: { updatedAt: "desc" }, select: { selectedMemberIds: true, guests: true } });
  const guests = Array.isArray(draft?.guests) ? draft.guests.length : 0;
  return { headcount: (draft?.selectedMemberIds.length ?? 0) + guests, registered: false };
}

/** What a club director sees on the registration page. Null when the tool is not in use for the event. */
export async function loadClubTeacherStep(organizationId: string, eventId: string): Promise<ClubTeacherStep | null> {
  const rule = await activeTeacherRule(eventId);
  if (!rule) return null;
  const prisma = getPrisma();
  const event = await clubEvent(eventId);
  const [members, rows, locations, count] = await Promise.all([
    prisma.clubRosterMember.findMany({
      where: { organizationId, clubYear: clubYearFor(event.startsAt), status: "ACTIVE", personId: { not: null }, attendeeType: { in: ["ADULT", "STAFF"] } },
      select: { id: true, role: true, person: { select: { firstName: true, lastName: true } } },
    }),
    prisma.clubEventTeacher.findMany({ where: { eventId, organizationId }, select: { rosterMemberId: true, honorName: true, locationId: true, rosterMember: { select: { person: { select: { firstName: true, lastName: true } } } } } }),
    prisma.eventLocation.findMany({ where: { eventId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    clubHeadcount(eventId, organizationId),
  ]);
  const candidates = members.map((member) => ({ memberId: member.id, name: personName(member.person), role: member.role })).sort((a, b) => a.name.localeCompare(b.name));
  const teachers = rows
    .map((row) => ({ memberId: row.rosterMemberId, name: personName(row.rosterMember.person), honorName: row.honorName ?? "", locationId: row.locationId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const status = teacherStatus(rule, count.headcount, teachers.length);
  return {
    rule,
    headcount: count.headcount,
    registered: count.registered,
    status,
    warning: teacherWarning(status, rule.requireTeachers),
    candidates,
    teachers,
    locations,
  };
}

/** Replaces the club's named teachers. Only the club's own active adults and staff, and only this event's own sites. */
export async function setClubTeachers(organizationId: string, eventId: string, actor: TeacherActor, input: TeacherEntriesInput) {
  const rule = await activeTeacherRule(eventId);
  if (!rule) throw new ClubTeacherError("NOT_AVAILABLE", "Club teachers are not being collected for this event.");
  const event = await clubEvent(eventId);
  const prisma = getPrisma();
  const ids = input.teachers.map((teacher) => teacher.rosterMemberId);
  const members = ids.length === 0 ? [] : await prisma.clubRosterMember.findMany({
    where: { id: { in: ids }, organizationId, clubYear: clubYearFor(event.startsAt), status: "ACTIVE", personId: { not: null } },
    select: { id: true, attendeeType: true },
  });
  const allowed = new Set(members.filter((member) => canTeach(member.attendeeType)).map((member) => member.id));
  if (ids.some((id) => !allowed.has(id))) {
    throw new ClubTeacherError("MEMBER_INVALID", "Teachers must be adults or staff on your club roster.");
  }
  const locationIds = [...new Set(input.teachers.flatMap((teacher) => (teacher.locationId ? [teacher.locationId] : [])))];
  if (locationIds.length > 0) {
    const real = await prisma.eventLocation.count({ where: { id: { in: locationIds }, eventId, isActive: true } });
    if (real !== locationIds.length) throw new ClubTeacherError("LOCATION_INVALID", "Choose a weekend or site this event offers.");
  }
  const who = auditActor(actor);
  await prisma.$transaction(async (tx) => {
    await tx.clubEventTeacher.deleteMany({ where: { eventId, organizationId } });
    if (input.teachers.length > 0) {
      await tx.clubEventTeacher.createMany({
        data: input.teachers.map((teacher) => ({ eventId, organizationId, rosterMemberId: teacher.rosterMemberId, honorName: teacher.honorName, locationId: teacher.locationId })),
      });
    }
    await writeAuditLog({
      eventId,
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_TEACHERS_SET",
      entityType: "ClubEventTeacher",
      entityId: organizationId,
      summary: "Named the teachers a club is bringing.",
      // Counts only: the names stay on the roster.
      metadata: { ...who.metadata, organizationId, teacherCount: input.teachers.length },
    }, tx);
  });
  return loadClubTeacherStep(organizationId, eventId);
}

/**
 * The "require" rule at submit (#1681): when staff chose to block, a club below its number cannot submit. Does nothing
 * while the tool is off, no rule is saved, or the rule only warns, so every other club event is unaffected.
 */
export async function assertTeachersMeetRule(eventId: string, organizationId: string, headcount: number): Promise<void> {
  const rule = await activeTeacherRule(eventId);
  if (!rule || !rule.requireTeachers) return;
  const named = await getPrisma().clubEventTeacher.count({ where: { eventId, organizationId } });
  const status = teacherStatus(rule, headcount, named);
  if (!status.met) throw new ClubTeacherError("TEACHERS_REQUIRED", teacherWarning(status, true)!);
}
