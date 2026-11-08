import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { formatPersonName } from "@/lib/person-name";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ageOn, clubYearFor } from "@/modules/club-rosters/domain";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { isModuleEnabled } from "@/modules/event-modules/service";
import {
  canTeach,
  teacherAgeUnknownMessage,
  teacherEligibility,
  teacherEligibilityLabel,
  teacherStatus,
  teacherUnderAgeMessage,
  teacherWarning,
  type TeacherEligibility,
  type TeacherEntriesInput,
  type TeacherRule,
  type TeacherStatus,
} from "@/modules/club-teachers/domain";

export class ClubTeacherError extends Error {
  constructor(
    public readonly code: "NOT_AVAILABLE" | "MEMBER_INVALID" | "TEACHER_UNDER_18" | "TEACHER_AGE_UNKNOWN" | "LOCATION_INVALID" | "TEACHERS_REQUIRED" | "NOT_PERMITTED" | "EVENT_NOT_FOUND" | "NOT_A_CLUB_EVENT",
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

/**
 * A roster person's whole-years age on the event's first day (in the event's time zone): from the roster birth date, else
 * the age a form reported (used as reported). Null when neither is known. The birth date is opened here and never leaves.
 */
export function rosterAgeOn(member: { sealedBirthDate: string | null; reportedAge: number | null }, eventDate: string): number | null {
  if (member.sealedBirthDate) {
    try {
      const age = ageOn(openBirthDate(member.sealedBirthDate), eventDate);
      if (age !== null) return age;
    } catch {
      // An unreadable birth date falls back to the reported age; it never makes someone eligible.
    }
  }
  return member.reportedAge;
}

const ageFields = { sealedBirthDate: true, reportedAge: true } as const;

/** The event's first calendar day, for working out ages. */
function teacherAgeDate(event: { startsAt: Date; timezone: string }) {
  return calendarDateInEventTimeZone(event.startsAt, event.timezone);
}

export type ClubTeacherStep = {
  rule: TeacherRule;
  /** People the club is bringing, for the larger-club number: the registration's people, else the draft's. */
  headcount: number;
  registered: boolean;
  status: TeacherStatus;
  warning: string | null;
  /** Active adult and staff roster members of the club for this club year who are 18 or older: the only people who can be named. */
  candidates: Array<{ memberId: string; name: string; role: string }>;
  /** Adults and staff on the roster who cannot be named yet (under 18, or no birth date or age), with why. */
  unavailable: Array<{ memberId: string; name: string; role: string; reason: string }>;
  /** `flag` is set for a saved teacher who cannot teach ("Under 18, can't teach"); they stay stored until the club replaces them. */
  teachers: Array<{ memberId: string; name: string; honorName: string; locationId: string | null; eligibility: TeacherEligibility; flag: string | null }>;
  locations: Array<{ id: string; name: string }>;
};

function personName(person: { firstName: string; lastName: string } | null): string {
  return formatPersonName(person ?? {}, "sorted") || "Unnamed person";
}

async function clubEvent(eventId: string) {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, isPublished: true, archivedAt: null, audience: "CLUB" },
    select: { id: true, startsAt: true, timezone: true },
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
  const ageDate = teacherAgeDate(event);
  const [members, rows, locations, count] = await Promise.all([
    prisma.clubRosterMember.findMany({
      where: { organizationId, clubYear: clubYearFor(event.startsAt), status: "ACTIVE", personId: { not: null }, attendeeType: { in: ["ADULT", "STAFF"] } },
      select: { id: true, role: true, ...ageFields, person: { select: { firstName: true, lastName: true } } },
    }),
    prisma.clubEventTeacher.findMany({ where: { eventId, organizationId }, select: { rosterMemberId: true, honorName: true, locationId: true, rosterMember: { select: { ...ageFields, person: { select: { firstName: true, lastName: true } } } } } }),
    prisma.eventLocation.findMany({ where: { eventId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    clubHeadcount(eventId, organizationId),
  ]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const assessed = members.map((member) => ({ member, eligibility: teacherEligibility(rosterAgeOn(member, ageDate)) }));
  const candidates = assessed.filter((row) => row.eligibility === "ok").map(({ member }) => ({ memberId: member.id, name: personName(member.person), role: member.role })).sort(byName);
  const unavailable = assessed
    .filter((row) => row.eligibility !== "ok")
    .map(({ member, eligibility }) => ({ memberId: member.id, name: personName(member.person), role: member.role, reason: teacherEligibilityLabel(eligibility)! }))
    .sort(byName);
  const teachers = rows
    .map((row) => {
      const eligibility = teacherEligibility(rosterAgeOn(row.rosterMember, ageDate));
      return { memberId: row.rosterMemberId, name: personName(row.rosterMember.person), honorName: row.honorName ?? "", locationId: row.locationId, eligibility, flag: teacherEligibilityLabel(eligibility) };
    })
    .sort(byName);
  // Someone who cannot teach is kept on the list but does not count toward the number.
  const status = teacherStatus(rule, count.headcount, teachers.filter((teacher) => teacher.eligibility === "ok").length);
  return {
    rule,
    headcount: count.headcount,
    registered: count.registered,
    status,
    warning: teacherWarning(status, rule.requireTeachers),
    candidates,
    unavailable,
    teachers,
    locations,
  };
}

/** The step for a registration page: a failed read hides the step and never the page. */
export async function loadClubTeacherStepOrNull(organizationId: string, eventId: string): Promise<ClubTeacherStep | null> {
  try {
    return await loadClubTeacherStep(organizationId, eventId);
  } catch (error) {
    logError("Club teachers step read failed", error, { eventId });
    return null;
  }
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
    select: { id: true, attendeeType: true, ...ageFields },
  });
  const allowed = new Set(members.filter((member) => canTeach(member.attendeeType)).map((member) => member.id));
  if (ids.some((id) => !allowed.has(id))) {
    throw new ClubTeacherError("MEMBER_INVALID", "Teachers must be adults or staff on your club roster.");
  }
  // Teachers must be 18 or older (#1727), on the event's first day. Anyone under 18, or with no known age, is refused.
  const ageDate = teacherAgeDate(event);
  const eligibilities = members.map((member) => teacherEligibility(rosterAgeOn(member, ageDate)));
  if (eligibilities.includes("under-18")) throw new ClubTeacherError("TEACHER_UNDER_18", teacherUnderAgeMessage);
  if (eligibilities.includes("age-unknown")) throw new ClubTeacherError("TEACHER_AGE_UNKNOWN", teacherAgeUnknownMessage);
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
  const event = await clubEvent(eventId);
  const rows = await getPrisma().clubEventTeacher.findMany({ where: { eventId, organizationId }, select: { rosterMember: { select: ageFields } } });
  // Only teachers who are 18 or older count toward the number (#1727).
  const ageDate = teacherAgeDate(event);
  const named = rows.filter((row) => teacherEligibility(rosterAgeOn(row.rosterMember, ageDate)) === "ok").length;
  const status = teacherStatus(rule, headcount, named);
  if (!status.met) throw new ClubTeacherError("TEACHERS_REQUIRED", teacherWarning(status, true)!);
}
