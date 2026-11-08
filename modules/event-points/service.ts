import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { formatPersonName } from "@/lib/person-name";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubYearFor } from "@/modules/club-rosters/domain";
import {
  ATTENDANCE_POINTS_MAX,
  evaluateClub,
  isDirectorRole,
  type ClubOverride,
  type PointsBasis,
  type PointsCapabilities,
  type PointsPerson,
  type PointsRole,
  type AttendancePointsAction,
} from "@/modules/event-points/domain";
import {
  ScopedToggleError,
  assertScopedToggleAllowed,
  loadScopedToolEvent,
  requireAreaCoordinatorToggleActor,
  requireStaffToggleAccess,
  scopedActorAudit,
  scopedModuleIsOn,
  writeScopedModuleSwitch,
  type ScopedToggleActor,
} from "@/modules/event-modules/scoped-toggle";
import { eventModuleDefinition } from "@/modules/event-modules/catalog";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import type { MembershipLookup, Session } from "@/modules/access/authorization";

/**
 * Attendance points (#1677): the optional tool an Area Coordinator, the Clubs Administrator or staff turn on for a club
 * event. The switch is the shared helper `modules/event-modules/scoped-toggle.ts` (the same path Club teachers and Camporee
 * scoring use). The rules are in `domain.ts`.
 *
 * Who may do what:
 *   - switch it on or off, set the points, and read the review with counts by club: a system administrator, an Event Admin
 *     or the Clubs Administrator (staff), or an active Area Coordinator after the second sign-in step on a published club
 *     event. An Area Coordinator sees counts and reasons by club, never a person's name;
 *   - see names on the review list, mark an Area Coordinator's child, override one club (with a reason), apply the points
 *     and undo them: staff administrators only. An Area Coordinator gains no other write.
 * Applied points are rows in `ClubEventPointAward`, which the club points board adds to a club's total with the event as the
 * reason. Switching the tool off hides it and keeps everything, applied points included.
 */

const moduleKey = "attendance-points" as const;

export class AttendancePointsError extends Error {
  constructor(
    public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND" | "NOT_PERMITTED" | "INVALID" | "NOT_FOUND",
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "AttendancePointsError";
  }
}

export type AttendancePointsActor = ScopedToggleActor;

export function pointsCapabilities(actor: AttendancePointsActor): PointsCapabilities {
  return actor.kind === "area-coordinator"
    ? { canSwitch: true, canSetUp: true, canSeeNames: false, canMark: false, canOverride: false, canApply: false }
    : { canSwitch: true, canSetUp: true, canSeeNames: true, canMark: true, canOverride: true, canApply: true };
}

/** Staff who may use the tool: administrators only (system administrator, Event Admin, Clubs Administrator). */
export async function requireStaffPointsAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<AttendancePointsActor> {
  return requireStaffToggleAccess(session, eventId, lookup);
}

/** The signed-in Area Coordinator (grant active, second step passed), or a 404-shaped refusal. */
export async function requireAreaCoordinatorPointsActor(): Promise<AttendancePointsActor> {
  try {
    return await requireAreaCoordinatorToggleActor();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new AttendancePointsError(error.code, error.message);
    throw error;
  }
}

async function scopedEvent(eventId: string, actor: AttendancePointsActor["kind"]) {
  try {
    return await loadScopedToolEvent(eventId, actor, "That club event could not be found. It may be archived or not a club event.");
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new AttendancePointsError(error.code, error.message);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const roles: readonly PointsRole[] = ["Pathfinder", "TLT", "Staff", "Child"];

function ageFrom(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && number < 120 ? Math.trunc(number) : null;
}

type RosterFacts = { attendeeType: string; role: string; classLevel: string | null };

/** The registration's own "role" answer first; when the form has none, the club roster's type. */
function resolveRole(answer: unknown, member: RosterFacts | undefined): PointsRole | null {
  const text = typeof answer === "string" ? answer.trim() : "";
  const found = roles.find((role) => role === text);
  if (found) return found;
  if (!member) return null;
  if (member.attendeeType === "STAFF" || member.attendeeType === "ADULT") return "Staff";
  if (member.attendeeType === "UNDERAGE") return "Child";
  if (member.attendeeType === "YOUTH") return member.classLevel === "TLT" ? "TLT" : "Pathfinder";
  return null;
}

type ClubPeople = { organizationId: string; name: string; people: PointsPerson[] };

/** Every club registered for the event (teams of one club together) with each registered person, ready for the rules. */
async function loadClubPeople(eventId: string): Promise<ClubPeople[]> {
  const prisma = getPrisma();
  const [rows, marks] = await Promise.all([
    prisma.clubEventRegistration.findMany({
      where: { eventId, registration: { status: { in: [...activeRegistrationStatuses] } } },
      select: {
        organizationId: true,
        organization: { select: { name: true } },
        registration: {
          select: {
            attendees: {
              select: {
                id: true,
                profileSnapshot: true,
                formResponses: true,
                person: { select: { firstName: true, lastName: true } },
                checkIns: { where: { undoneAt: null }, select: { id: true }, take: 1 },
              },
            },
          },
        },
      },
    }),
    prisma.attendancePointsMark.findMany({ where: { eventId }, select: { attendeeId: true } }),
  ]);
  const rosterIds = new Set<string>();
  for (const row of rows) {
    for (const attendee of row.registration.attendees) {
      const id = record(attendee.profileSnapshot).clubRosterMemberId;
      if (typeof id === "string") rosterIds.add(id);
    }
  }
  const members = rosterIds.size === 0 ? [] : await prisma.clubRosterMember.findMany({
    where: { id: { in: [...rosterIds] } },
    select: { id: true, attendeeType: true, role: true, classLevel: true },
  });
  const memberById = new Map<string, RosterFacts>(members.map((member) => [member.id, { attendeeType: member.attendeeType, role: member.role, classLevel: member.classLevel }]));
  const marked = new Set(marks.map((mark) => mark.attendeeId));
  const clubs = new Map<string, ClubPeople>();
  for (const row of rows) {
    const club = clubs.get(row.organizationId) ?? { organizationId: row.organizationId, name: row.organization.name, people: [] };
    for (const attendee of row.registration.attendees) {
      const rosterId = record(attendee.profileSnapshot).clubRosterMemberId;
      const member = typeof rosterId === "string" ? memberById.get(rosterId) : undefined;
      const responses = record(attendee.formResponses);
      club.people.push({
        id: attendee.id,
        name: formatPersonName(attendee.person, "display") || "Unnamed person",
        role: resolveRole(responses.attendee_type, member),
        isDirector: Boolean(member && isDirectorRole(member.role)),
        age: ageFrom(responses.attendee_age),
        checkedIn: attendee.checkIns.length > 0,
        marked: marked.has(attendee.id),
      });
    }
    clubs.set(row.organizationId, club);
  }
  return [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type ReviewPerson = { attendeeId: string; name: string; role: string; counted: boolean; reason: string; marked: boolean; canMark: boolean };

export type ReviewClub = {
  organizationId: string;
  name: string;
  registered: number;
  present: number;
  leaders: number;
  tlts: number;
  pathfinders: number;
  computedEarns: boolean;
  computedReason: string;
  override: ClubOverride | null;
  earns: boolean;
  /** Points the rules (and any override) give this club right now. */
  points: number;
  reason: string;
  /** Points on the board for this club from this event, once applied. */
  appliedPoints: number | null;
  /** Names are for staff only: null for an Area Coordinator. */
  people: ReviewPerson[] | null;
};

export type AttendancePointsView = {
  eventName: string;
  enabled: boolean;
  capabilities: PointsCapabilities;
  usesCheckIn: boolean;
  /** People with an active check-in, for "Based on check-in (N checked in)". */
  checkedIn: number;
  basis: PointsBasis;
  settings: { points: number; requiresPathfinders: boolean } | null;
  appliedAt: string | null;
  /** False until the event has ended: nothing can be applied before then. */
  eventEnded: boolean;
  clubs: ReviewClub[];
  totals: { clubsReviewed: number; clubsEarning: number; points: number };
};

/** The state shown to whoever may use the tool. Reads whatever was entered, even while the tool is off. */
export async function loadAttendancePointsView(eventId: string, actor: AttendancePointsActor, now = new Date()): Promise<AttendancePointsView> {
  const event = await scopedEvent(eventId, actor.kind);
  const prisma = getPrisma();
  const capabilities = pointsCapabilities(actor);
  const [enabled, setting, checkIns, eventRow, overrides, awards] = await Promise.all([
    scopedModuleIsOn(eventId, moduleKey),
    prisma.attendancePointsSetting.findUnique({ where: { eventId } }),
    prisma.checkIn.count({ where: { eventId, undoneAt: null } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { endsAt: true } }),
    prisma.attendancePointsOverride.findMany({ where: { eventId }, select: { organizationId: true, outcome: true, reason: true } }),
    prisma.clubEventPointAward.findMany({ where: { eventId }, select: { organizationId: true, points: true } }),
  ]);
  const usesCheckIn = checkIns > 0;
  const basis: PointsBasis = usesCheckIn ? "CHECK_IN" : "REGISTRATION";
  const base = {
    eventName: event.name,
    enabled,
    capabilities,
    usesCheckIn,
    checkedIn: checkIns,
    basis,
    settings: setting ? { points: setting.points, requiresPathfinders: setting.requiresPathfinders } : null,
    appliedAt: setting?.appliedAt?.toISOString() ?? null,
    eventEnded: !eventRow || eventRow.endsAt <= now,
  };
  if (!setting) return { ...base, clubs: [], totals: { clubsReviewed: 0, clubsEarning: 0, points: 0 } };

  const rule = { basis, requiresPathfinders: setting.requiresPathfinders, points: setting.points };
  const overrideByClub = new Map(overrides.map((row) => [row.organizationId, { outcome: row.outcome, reason: row.reason } satisfies ClubOverride]));
  const appliedByClub = new Map(awards.map((row) => [row.organizationId, row.points]));
  const clubs = (await loadClubPeople(eventId)).map((club): ReviewClub => {
    const verdict = evaluateClub(rule, { people: club.people, override: overrideByClub.get(club.organizationId) ?? null });
    const byId = new Map(verdict.people.map((person) => [person.id, person]));
    return {
      organizationId: club.organizationId,
      name: club.name,
      registered: verdict.registered,
      present: verdict.present,
      leaders: verdict.leaders,
      tlts: verdict.tlts,
      pathfinders: verdict.pathfinders,
      computedEarns: verdict.computed.earns,
      computedReason: verdict.computed.reason,
      // A staff override's free-text reason is for staff: an Area Coordinator only sees that staff decided.
      override: verdict.override && !capabilities.canSeeNames ? { outcome: verdict.override.outcome, reason: "" } : verdict.override,
      earns: verdict.earns,
      points: verdict.points,
      reason: verdict.override && !capabilities.canSeeNames ? `Staff ${verdict.override.outcome === "AWARD" ? "awarded" : "withheld"} the points.` : verdict.reason,
      appliedPoints: appliedByClub.get(club.organizationId) ?? null,
      people: capabilities.canSeeNames
        ? club.people.map((person) => {
          const judged = byId.get(person.id)!;
          return {
            attendeeId: person.id,
            name: person.name,
            role: person.role ?? "No role",
            counted: judged.counted,
            reason: judged.reason,
            marked: person.marked,
            // Directors and staff always count, so they can't be marked.
            canMark: judged.kind !== "leader",
          };
        })
        : null,
    };
  });
  return {
    ...base,
    clubs,
    totals: {
      clubsReviewed: clubs.length,
      clubsEarning: clubs.filter((club) => club.earns).length,
      points: clubs.reduce((sum, club) => sum + club.points, 0),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

function auditEntry(actor: AttendancePointsActor, eventId: string, action: string, entityType: string, entityId: string, summary: string, extra: Record<string, string | number | boolean | null | string[]>) {
  const who = scopedActorAudit(actor);
  return {
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType,
    entityId,
    summary,
    // Ids and numbers only: no club or person name, and no override reason, is written to the audit log.
    metadata: { ...who.metadata, eventId, moduleKey, ...extra },
  };
}

const lockedMessage = "These points are applied. Undo them first to change anything.";

/**
 * Inside a write's own transaction: refuses when the points are applied. The update takes a lock on the setting row, so an
 * apply running at the same moment finishes first and this write then sees it (or this one finishes before the apply starts).
 */
async function assertNotAppliedIn(tx: Prisma.TransactionClient, eventId: string) {
  await tx.attendancePointsSetting.updateMany({ where: { eventId, appliedAt: null }, data: { updatedAt: new Date() } });
  const setting = await tx.attendancePointsSetting.findUnique({ where: { eventId }, select: { appliedAt: true } });
  if (setting?.appliedAt) throw new AttendancePointsError("NOT_PERMITTED", lockedMessage);
}

/**
 * Applies one action and returns the new state. Each action checks who the caller is and what they may do, then the
 * event, then the rule, so a refused call changes nothing.
 */
export async function applyAttendancePointsAction(actor: AttendancePointsActor, eventId: string, action: AttendancePointsAction): Promise<AttendancePointsView> {
  try {
    await assertScopedToggleAllowed(moduleKey, actor);
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new AttendancePointsError(error.code, error.message);
    throw error;
  }
  await scopedEvent(eventId, actor.kind);
  const capabilities = pointsCapabilities(actor);
  const refuse = (message: string) => new AttendancePointsError("NOT_PERMITTED", message);

  if (action.action === "switch") {
    if (!capabilities.canSwitch) throw refuse("Only an Area Coordinator, the Clubs Administrator or event administrators can turn Attendance points on or off.");
    await getPrisma().$transaction((tx) => writeScopedModuleSwitch(tx, { actor, eventId, moduleKey, enabled: action.enabled }));
    return loadAttendancePointsView(eventId, actor);
  }
  if (!(await scopedModuleIsOn(eventId, moduleKey))) throw new AttendancePointsError("NOT_AVAILABLE", "Attendance points is off for this event. Turn it on first.");

  switch (action.action) {
    case "saveSettings":
      if (!capabilities.canSetUp) throw refuse("Only an Area Coordinator, the Clubs Administrator or event administrators can set the points.");
      await saveSettings(actor, eventId, action.points, action.requiresPathfinders);
      break;
    case "markChild":
      if (!capabilities.canMark) throw refuse("Only the Clubs Administrator or event administrators can mark an Area Coordinator's child.");
      await markChild(actor, eventId, action.attendeeId, action.marked);
      break;
    case "override":
      if (!capabilities.canOverride) throw refuse("Only the Clubs Administrator or event administrators can override a club.");
      await setOverride(actor, eventId, action.organizationId, action.outcome, action.reason);
      break;
    case "apply":
    case "undo":
      if (!capabilities.canApply) throw refuse("Only the Clubs Administrator or event administrators can apply or undo points.");
      if (action.action === "apply") await applyPoints(actor, eventId);
      else await undoPoints(actor, eventId);
      break;
  }
  return loadAttendancePointsView(eventId, actor);
}

async function isApplied(eventId: string): Promise<boolean> {
  const setting = await getPrisma().attendancePointsSetting.findUnique({ where: { eventId }, select: { appliedAt: true } });
  return Boolean(setting?.appliedAt);
}

async function saveSettings(actor: AttendancePointsActor, eventId: string, points: number, requiresPathfinders: boolean) {
  // The routes' schema checks this too; a service called from anywhere else stays safe, and the database refuses the rest.
  if (!Number.isInteger(points) || points < 1 || points > ATTENDANCE_POINTS_MAX) {
    throw new AttendancePointsError("INVALID", `Points must be a whole number from 1 to ${ATTENDANCE_POINTS_MAX.toLocaleString("en-US")}.`, "points");
  }
  if (await isApplied(eventId)) throw new AttendancePointsError("NOT_PERMITTED", lockedMessage);
  const prisma = getPrisma();
  const existing = await prisma.attendancePointsSetting.findUnique({ where: { eventId }, select: { points: true, requiresPathfinders: true } });
  if (existing && existing.points === points && existing.requiresPathfinders === requiresPathfinders) return;
  await prisma.$transaction(async (tx) => {
    await assertNotAppliedIn(tx, eventId);
    await tx.attendancePointsSetting.upsert({ where: { eventId }, create: { eventId, points, requiresPathfinders }, update: { points, requiresPathfinders } });
    await writeAuditLog(auditEntry(actor, eventId, "ATTENDANCE_POINTS_SETTINGS_SAVED", "AttendancePointsSetting", eventId, "Saved the attendance points for the event.", {
      points,
      requiresPathfinders,
      beforePoints: existing?.points ?? null,
      beforeRequiresPathfinders: existing?.requiresPathfinders ?? null,
    }), tx);
  });
}

async function markChild(actor: AttendancePointsActor, eventId: string, attendeeId: string, marked: boolean) {
  if (await isApplied(eventId)) throw new AttendancePointsError("NOT_PERMITTED", lockedMessage);
  const prisma = getPrisma();
  const people = await loadClubPeople(eventId);
  const person = people.flatMap((club) => club.people).find((candidate) => candidate.id === attendeeId);
  if (!person) throw new AttendancePointsError("NOT_FOUND", "That person isn't registered for this event with a club.");
  if (marked && (person.role === "Staff" || person.isDirector)) {
    throw new AttendancePointsError("INVALID", "Directors and staff count for their club whatever other role they hold, so they can't be marked.", "person");
  }
  if (marked === person.marked) return;
  const organizationId = people.find((club) => club.people.some((candidate) => candidate.id === attendeeId))!.organizationId;
  await prisma.$transaction(async (tx) => {
    await assertNotAppliedIn(tx, eventId);
    if (marked) await tx.attendancePointsMark.create({ data: { eventId, attendeeId, setByUserId: actor.kind === "staff" ? actor.userId : null } });
    else await tx.attendancePointsMark.deleteMany({ where: { eventId, attendeeId } });
    await writeAuditLog(auditEntry(actor, eventId, marked ? "ATTENDANCE_POINTS_CHILD_MARKED" : "ATTENDANCE_POINTS_CHILD_UNMARKED", "AttendancePointsMark", attendeeId, marked ? "Marked a registered person as an Area Coordinator's child." : "Took the Area Coordinator's child mark off a registered person.", { attendeeId, organizationId }), tx);
  });
}

async function setOverride(actor: AttendancePointsActor, eventId: string, organizationId: string, outcome: "AWARD" | "WITHHOLD" | null, reason: string) {
  if (await isApplied(eventId)) throw new AttendancePointsError("NOT_PERMITTED", lockedMessage);
  const prisma = getPrisma();
  const registered = await prisma.clubEventRegistration.findFirst({
    where: { eventId, organizationId, registration: { status: { in: [...activeRegistrationStatuses] } } },
    select: { id: true },
  });
  if (!registered) throw new AttendancePointsError("INVALID", "Choose a club registered for this event.", "club");
  if (outcome !== null && reason.trim() === "") throw new AttendancePointsError("INVALID", "Give a reason for the override.", "reason");
  const existing = await prisma.attendancePointsOverride.findUnique({ where: { eventId_organizationId: { eventId, organizationId } }, select: { outcome: true, reason: true } });
  if (outcome === null) {
    if (!existing) return;
    await prisma.$transaction(async (tx) => {
      await assertNotAppliedIn(tx, eventId);
      await tx.attendancePointsOverride.deleteMany({ where: { eventId, organizationId } });
      await writeAuditLog(auditEntry(actor, eventId, "ATTENDANCE_POINTS_OVERRIDE_REMOVED", "AttendancePointsOverride", organizationId, "Took an attendance points override off a club.", { organizationId, before: existing.outcome }), tx);
    });
    return;
  }
  if (existing && existing.outcome === outcome && existing.reason === reason.trim()) return;
  await prisma.$transaction(async (tx) => {
    await assertNotAppliedIn(tx, eventId);
    await tx.attendancePointsOverride.upsert({
      where: { eventId_organizationId: { eventId, organizationId } },
      create: { eventId, organizationId, outcome, reason: reason.trim(), setByUserId: actor.kind === "staff" ? actor.userId : null },
      update: { outcome, reason: reason.trim(), setByUserId: actor.kind === "staff" ? actor.userId : null },
    });
    await writeAuditLog(auditEntry(actor, eventId, "ATTENDANCE_POINTS_OVERRIDE_SET", "AttendancePointsOverride", organizationId, outcome === "AWARD" ? "Awarded a club the attendance points by override." : "Withheld a club's attendance points by override.", { organizationId, outcome, before: existing?.outcome ?? null }), tx);
  });
}

async function applyPoints(actor: AttendancePointsActor, eventId: string) {
  const prisma = getPrisma();
  const view = await loadAttendancePointsView(eventId, actor);
  if (!view.settings) throw new AttendancePointsError("INVALID", "Set the points first.");
  if (view.appliedAt) throw new AttendancePointsError("NOT_PERMITTED", "These points are already applied.");
  if (!view.eventEnded) throw new AttendancePointsError("INVALID", "The event hasn't ended yet. Apply the points after the event.");
  const winners = view.clubs.filter((club) => club.earns);
  if (winners.length === 0) throw new AttendancePointsError("INVALID", "No club earned points, so there is nothing to apply. Override a club if one should.");
  const event = await getPrisma().event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, startsAt: true } });
  const clubYear = clubYearFor(event.startsAt);
  const userId = actor.kind === "staff" ? actor.userId : null;
  await prisma.$transaction(async (tx) => {
    // The guard row: only one apply wins when two run at once. It also re-reads the points inside the transaction, so a
    // save that landed after the review above can't be applied with the old value.
    const claimed = await tx.attendancePointsSetting.updateMany({ where: { eventId, appliedAt: null }, data: { appliedAt: new Date(), appliedByUserId: userId } });
    if (claimed.count === 0) throw new AttendancePointsError("NOT_PERMITTED", "These points are already applied.");
    const current = await tx.attendancePointsSetting.findUniqueOrThrow({ where: { eventId }, select: { points: true, requiresPathfinders: true } });
    if (current.points !== view.settings!.points || current.requiresPathfinders !== view.settings!.requiresPathfinders) {
      throw new AttendancePointsError("INVALID", "The points changed while you were applying them. Review the clubs and try again.");
    }
    const points = current.points;
    await tx.clubEventPointAward.createMany({
      data: winners.map((club) => ({
        eventId,
        organizationId: club.organizationId,
        clubYear,
        eventName: event.name,
        points,
        basis: view.basis,
        overridden: club.override !== null,
        appliedByUserId: userId,
      })),
    });
    await writeAuditLog(auditEntry(actor, eventId, "ATTENDANCE_POINTS_APPLIED", "AttendancePointsSetting", eventId, `Applied ${eventModuleDefinition(moduleKey).title.toLowerCase()} to club points.`, {
      clubYear,
      points,
      clubs: winners.length,
      totalPoints: points * winners.length,
      basis: view.basis,
      organizationIds: winners.map((club) => club.organizationId),
    }), tx);
  });
}

async function undoPoints(actor: AttendancePointsActor, eventId: string) {
  const prisma = getPrisma();
  if (!(await isApplied(eventId))) throw new AttendancePointsError("INVALID", "These points aren't applied.");
  await prisma.$transaction(async (tx) => {
    const released = await tx.attendancePointsSetting.updateMany({ where: { eventId, appliedAt: { not: null } }, data: { appliedAt: null, appliedByUserId: null } });
    if (released.count === 0) throw new AttendancePointsError("INVALID", "These points aren't applied.");
    const removed = await tx.clubEventPointAward.findMany({ where: { eventId }, select: { organizationId: true, points: true } });
    await tx.clubEventPointAward.deleteMany({ where: { eventId } });
    await writeAuditLog(auditEntry(actor, eventId, "ATTENDANCE_POINTS_UNDONE", "AttendancePointsSetting", eventId, "Took the applied attendance points off the clubs' points.", {
      clubs: removed.length,
      totalPoints: removed.reduce((sum, row) => sum + row.points, 0),
      organizationIds: removed.map((row) => row.organizationId),
    }), tx);
  });
}
