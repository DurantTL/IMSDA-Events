import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  StaffingError,
  assertStaffingAccess,
  type StaffingActor,
} from "@/modules/event-staffing/access";
import {
  ACTIVE_REGISTRATION_STATUSES,
  MAX_ACTIVITIES,
  assignmentConflict,
  assignmentName,
  sortAssignments,
  staffingCsv,
  summarizeStaffing,
  type ActivityInput,
  type ActivityView,
  type AssignmentInput,
  type AssignmentView,
  type TltAssignmentInput,
} from "@/modules/event-staffing/domain";
import { currentTltPersonIds, personIsCurrentTlt } from "@/modules/tlt-directory/current-tlt";
import { formatPersonName } from "@/lib/person-name";

/**
 * Reads and writes for the staffing sheet (#1678). The only tables written are `EventStaffingActivity`,
 * `EventStaffingAssignment` and the audit log: never a registration, an account or a person (a guard test reads this boundary's
 * imports). Every function here is called after `access.ts` has decided who is asking; the writes ask again.
 *
 * Who may be put on an activity is decided here, on the server, from the event itself: a person with a registration in a
 * submitted or confirmed state on THIS event, or a staff user with an active membership on THIS event. The request only names
 * an id; it never says what that id is allowed to be.
 */

/** The most people one picker lists. An event larger than this needs the tag-based picker the TLT directory brings. */
export const MAX_PICKER_PEOPLE = 3000;

const activitySelect = {
  id: true,
  name: true,
  description: true,
  location: true,
  timeText: true,
  tltsNeeded: true,
  lifeguardsNeeded: true,
  helpersNeeded: true,
  assignments: {
    select: {
      id: true,
      role: true,
      personId: true,
      userId: true,
      attendeeAccountId: true,
      person: { select: { firstName: true, lastName: true } },
      user: { select: { displayName: true } },
      attendeeAccount: { select: { displayName: true } },
    },
  },
} satisfies Prisma.EventStaffingActivitySelect;

type ActivityRow = Prisma.EventStaffingActivityGetPayload<{ select: typeof activitySelect }>;

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

/** Which of these people are still registered (or still staff) for the event. A cancelled registration or a removed staff member is not. */
async function activeAssignees(client: Client, eventId: string, rows: ReadonlyArray<{ role?: string; personId: string | null; userId: string | null; attendeeAccountId?: string | null }>) {
  const tltIds = [...new Set(rows.flatMap((row) => (row.role === "TLT" && row.personId ? [row.personId] : [])))];
  const personIds = [...new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])))];
  const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const accountIds = [...new Set(rows.flatMap((row) => (row.attendeeAccountId ? [row.attendeeAccountId] : [])))];
  const now = new Date();
  const [people, staff, coordinators, tlts] = await Promise.all([
    personIds.length === 0 ? [] : client.registrationAttendee.findMany({
      where: { eventId, personId: { in: personIds }, registration: { eventId, status: { in: [...ACTIVE_REGISTRATION_STATUSES] } } },
      select: { personId: true },
    }),
    userIds.length === 0 ? [] : client.eventMembership.findMany({ where: { eventId, userId: { in: userIds }, status: "ACTIVE" }, select: { userId: true } }),
    accountIds.length === 0 ? [] : client.areaCoordinatorGrant.findMany({
      where: { attendeeAccountId: { in: accountIds }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], attendeeAccount: { status: "ACTIVE" } },
      select: { attendeeAccountId: true },
    }),
    // A TLT counts only while they are still a current TLT as well as registered (#1678).
    currentTltPersonIds(client, tltIds, now),
  ]);
  return { people: new Set(people.map((row) => row.personId)), users: new Set(staff.map((row) => row.userId)), accounts: new Set(coordinators.map((row) => row.attendeeAccountId)), tlts };
}

function toView(row: ActivityRow, active: { people: Set<string>; users: Set<string>; accounts: Set<string>; tlts: Set<string> }): ActivityView {
  const assignments: AssignmentView[] = row.assignments.map((assignment) => {
    if (assignment.personId && assignment.person) {
      return { id: assignment.id, role: assignment.role, kind: "person", assigneeId: assignment.personId, ...assignmentName(assignment.person), active: active.people.has(assignment.personId) && (assignment.role !== "TLT" || active.tlts.has(assignment.personId)) };
    }
    if (assignment.attendeeAccountId) {
      const accountName = assignment.attendeeAccount?.displayName ?? "";
      return { id: assignment.id, role: assignment.role, kind: "account", assigneeId: assignment.attendeeAccountId, name: accountName, sortedName: accountName, active: active.accounts.has(assignment.attendeeAccountId) };
    }
    const name = assignment.user?.displayName ?? "";
    return { id: assignment.id, role: assignment.role, kind: "user", assigneeId: assignment.userId ?? "", name, sortedName: name, active: Boolean(assignment.userId && active.users.has(assignment.userId)) };
  });
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location: row.location,
    timeText: row.timeText,
    tltsNeeded: row.tltsNeeded,
    lifeguardsNeeded: row.lifeguardsNeeded,
    helpersNeeded: row.helpersNeeded,
    assignments: sortAssignments(assignments),
  };
}

async function viewsOf(client: Client, eventId: string, rows: ActivityRow[]): Promise<ActivityView[]> {
  const active = await activeAssignees(client, eventId, rows.flatMap((row) => row.assignments));
  return rows.map((row) => toView(row, active));
}

/** The whole sheet, in the order the activities were added. The caller has already passed `assertStaffingAccess`. */
export async function loadStaffingSheet(eventId: string): Promise<ActivityView[]> {
  const prisma = getPrisma();
  const rows = await prisma.eventStaffingActivity.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: activitySelect });
  return viewsOf(prisma, eventId, rows);
}

async function loadActivity(client: Client, eventId: string, activityId: string): Promise<ActivityView> {
  const row = await client.eventStaffingActivity.findFirst({ where: { id: activityId, eventId }, select: activitySelect });
  if (!row) throw new StaffingError("ACTIVITY_NOT_FOUND", "That activity could not be found. It may already be deleted.");
  return (await viewsOf(client, eventId, [row]))[0]!;
}

export type PickerPerson = {
  /** "person:<id>" or "user:<id>": what a picker option carries back to the server. */
  key: string;
  kind: "person" | "user" | "account";
  id: string;
  /** "Last, First" (staff: their display name). */
  name: string;
  /** What the person is here: their attendee type, "Event staff", or "Area Coordinator". No age, birth date or contact detail. */
  detail: string;
};

/**
 * The people who may be put on this event's activities: everyone with an active registration on the event, and the event's
 * active staff. For the picker only; names are shown to a person who may already change the sheet. Capped, sorted by name.
 */
export async function listPickerPeople(eventId: string): Promise<{ people: PickerPerson[]; truncated: boolean }> {
  const prisma = getPrisma();
  const now = new Date();
  const [attendees, staff, coordinators] = await Promise.all([
    prisma.registrationAttendee.findMany({
      where: { eventId, registration: { eventId, status: { in: [...ACTIVE_REGISTRATION_STATUSES] } } },
      distinct: ["personId"],
      orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { personId: "asc" }],
      take: MAX_PICKER_PEOPLE + 1,
      select: { personId: true, attendeeType: true, person: { select: { firstName: true, lastName: true } } },
    }),
    prisma.eventMembership.findMany({ where: { eventId, status: "ACTIVE" }, select: { userId: true, user: { select: { displayName: true } } } }),
    prisma.areaCoordinatorGrant.findMany({
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], attendeeAccount: { status: "ACTIVE" } },
      select: { attendeeAccountId: true, attendeeAccount: { select: { displayName: true } } },
    }),
  ]);
  const people: PickerPerson[] = [];
  for (const attendee of attendees.slice(0, MAX_PICKER_PEOPLE)) {
    const name = formatPersonName(attendee.person, "sorted");
    if (name) people.push({ key: `person:${attendee.personId}`, kind: "person", id: attendee.personId, name, detail: attendee.attendeeType });
  }
  for (const member of staff) {
    if (member.user.displayName.trim()) people.push({ key: `user:${member.userId}`, kind: "user", id: member.userId, name: member.user.displayName.trim(), detail: "Event staff" });
  }
  for (const grant of coordinators) {
    const name = grant.attendeeAccount.displayName.trim();
    if (name) people.push({ key: `account:${grant.attendeeAccountId}`, kind: "account", id: grant.attendeeAccountId, name, detail: "Area Coordinator" });
  }
  people.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { people, truncated: attendees.length > MAX_PICKER_PEOPLE };
}

function auditWho(actor: StaffingActor) {
  if (actor.kind === "staff") return { actorUserId: actor.userId, metadata: {} };
  return actor.kind === "tlt-director"
    ? { metadata: { actorAttendeeAccountId: actor.accountId, viaTltDirector: true } }
    : { metadata: { actorAttendeeAccountId: actor.accountId, viaAreaCoordinator: true } };
}

/** Audit rows carry ids, roles and counts only: never a name, an activity's text, or a contact detail. */
async function audit(tx: Prisma.TransactionClient, actor: StaffingActor, eventId: string, entry: { action: string; summary: string; entityType: "EventStaffingActivity" | "EventStaffingAssignment" | "Event"; entityId: string; metadata: Record<string, string | number | boolean | null> }) {
  const who = auditWho(actor);
  await writeAuditLog({
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata: { ...who.metadata, eventId, ...entry.metadata },
  }, tx);
}

const neededCounts = (input: ActivityInput) => ({ tltsNeeded: input.tltsNeeded, lifeguardsNeeded: input.lifeguardsNeeded, helpersNeeded: input.helpersNeeded });

export async function createActivity(actor: StaffingActor, eventId: string, input: ActivityInput): Promise<ActivityView> {
  await assertStaffingAccess(actor, eventId, "write");
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.eventStaffingActivity.aggregate({ where: { eventId }, _count: { _all: true }, _max: { position: true } });
    if (existing._count._all >= MAX_ACTIVITIES) throw new StaffingError("TOO_MANY", `A staffing sheet holds up to ${MAX_ACTIVITIES} activities.`);
    const created = await tx.eventStaffingActivity.create({
      data: { eventId, name: input.name, description: input.description, location: input.location, timeText: input.timeText, ...neededCounts(input), position: (existing._max.position ?? 0) + 1 },
      select: { id: true },
    });
    await audit(tx, actor, eventId, { action: "EVENT_STAFFING_ACTIVITY_ADDED", summary: "Added an activity to the staffing sheet.", entityType: "EventStaffingActivity", entityId: created.id, metadata: { activityId: created.id, ...neededCounts(input) } });
    return loadActivity(tx, eventId, created.id);
  });
}

export async function updateActivity(actor: StaffingActor, eventId: string, activityId: string, input: ActivityInput): Promise<ActivityView> {
  await assertStaffingAccess(actor, eventId, "write");
  return getPrisma().$transaction(async (tx) => {
    // The activity must belong to this event: an id from another event is the same as a missing one.
    const found = await tx.eventStaffingActivity.findFirst({ where: { id: activityId, eventId }, select: { id: true } });
    if (!found) throw new StaffingError("ACTIVITY_NOT_FOUND", "That activity could not be found. It may already be deleted.");
    await tx.eventStaffingActivity.update({ where: { id: activityId }, data: { name: input.name, description: input.description, location: input.location, timeText: input.timeText, ...neededCounts(input) } });
    await audit(tx, actor, eventId, { action: "EVENT_STAFFING_ACTIVITY_CHANGED", summary: "Changed an activity on the staffing sheet.", entityType: "EventStaffingActivity", entityId: activityId, metadata: { activityId, ...neededCounts(input) } });
    return loadActivity(tx, eventId, activityId);
  });
}

export async function deleteActivity(actor: StaffingActor, eventId: string, activityId: string): Promise<void> {
  await assertStaffingAccess(actor, eventId, "write");
  await getPrisma().$transaction(async (tx) => {
    const found = await tx.eventStaffingActivity.findFirst({ where: { id: activityId, eventId }, select: { id: true, _count: { select: { assignments: true } } } });
    if (!found) throw new StaffingError("ACTIVITY_NOT_FOUND", "That activity could not be found. It may already be deleted.");
    await tx.eventStaffingActivity.delete({ where: { id: activityId } });
    await audit(tx, actor, eventId, { action: "EVENT_STAFFING_ACTIVITY_DELETED", summary: "Deleted an activity from the staffing sheet.", entityType: "EventStaffingActivity", entityId: activityId, metadata: { activityId, assignmentCount: found._count.assignments } });
  });
}

/** Only a person registered (submitted or confirmed) on this event, or active staff on this event, may be assigned. */
async function assertOnEvent(tx: Prisma.TransactionClient, eventId: string, assignee: AssignmentInput["assignee"]): Promise<void> {
  const notOnEvent = new StaffingError("NOT_ON_EVENT", "Only people registered for this event, or on its staff, can be put on an activity.");
  if (assignee.kind === "person") {
    const registered = await tx.registrationAttendee.findFirst({
      where: { eventId, personId: assignee.id, registration: { eventId, status: { in: [...ACTIVE_REGISTRATION_STATUSES] } } },
      select: { id: true },
    });
    if (!registered) throw notOnEvent;
    return;
  }
  if (assignee.kind === "account") {
    // Lead only (the request schema says so too): an account holding an active Area Coordinator grant, the same check the access gate uses.
    const now = new Date();
    const grant = await tx.areaCoordinatorGrant.findFirst({
      where: { attendeeAccountId: assignee.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], attendeeAccount: { status: "ACTIVE" } },
      select: { id: true },
    });
    if (!grant) {
      throw new StaffingError("NOT_ON_EVENT", "Only an active Area Coordinator can be chosen from the Area Coordinators list.");
    }
    return;
  }
  const member = await tx.eventMembership.findFirst({ where: { eventId, userId: assignee.id, status: "ACTIVE" }, select: { id: true } });
  if (!member) throw notOnEvent;
}

/** Puts a person on an activity. A new lead replaces the current lead. Returns the whole activity as it now stands. */
export async function addAssignment(actor: StaffingActor, eventId: string, input: AssignmentInput): Promise<ActivityView> {
  await assertStaffingAccess(actor, eventId, "write");
  // The request schema already leaves TLT out; this keeps the service safe when called from anywhere else.
  if ((input.role as string) === "TLT") throw new StaffingError("NOT_PERMITTED", "Only the TLT director assigns TLTs.");
  try {
    return await getPrisma().$transaction(async (tx) => {
      const activity = await loadActivity(tx, eventId, input.activityId);
      const conflict = assignmentConflict(activity, { role: input.role, assignee: input.assignee });
      if (conflict) throw new StaffingError(conflict.code, conflict.message);
      if (input.assignee.kind === "account" && input.role !== "LEAD") throw new StaffingError("CONFLICT", "An Area Coordinator can be an activity's lead, not a helper or lifeguard.");
      await assertOnEvent(tx, eventId, input.assignee);
      let replacedLead = false;
      if (input.role === "LEAD") {
        replacedLead = (await tx.eventStaffingAssignment.deleteMany({ where: { activityId: input.activityId, eventId, role: "LEAD" } })).count > 0;
      }
      const created = await tx.eventStaffingAssignment.create({
        data: { eventId, activityId: input.activityId, role: input.role, ...(input.assignee.kind === "person" ? { personId: input.assignee.id } : input.assignee.kind === "user" ? { userId: input.assignee.id } : { attendeeAccountId: input.assignee.id }) },
        select: { id: true },
      });
      await audit(tx, actor, eventId, {
        action: "EVENT_STAFFING_ASSIGNED",
        summary: "Put a person on a staffing sheet activity.",
        entityType: "EventStaffingAssignment",
        entityId: created.id,
        metadata: { activityId: input.activityId, assignmentId: created.id, role: input.role, assigneeKind: input.assignee.kind, assigneeId: input.assignee.id, replacedLead },
      });
      return loadActivity(tx, eventId, input.activityId);
    });
  } catch (error) {
    // Two people adding the same person at once: the unique index decides, and the loser is told why.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StaffingError("CONFLICT", "That person, or a lead, was just added to this activity. Reload to see the current list.");
    }
    throw error;
  }
}

/**
 * The TLT director puts a TLT on an activity (#1678). The person must be registered (submitted or confirmed) for THIS event and be
 * a current TLT (a youth, ACTIVE roster member flagged TLT on an active club's roster this club year), both read from the database
 * here: the request only names an id. Audit: ids and the role only, never a name.
 */
export async function addTltAssignment(actor: StaffingActor, eventId: string, input: TltAssignmentInput, now = new Date()): Promise<ActivityView> {
  if (actor.kind !== "tlt-director") throw new StaffingError("NOT_PERMITTED", "Only the TLT director assigns TLTs.");
  await assertStaffingAccess(actor, eventId, "assign-tlt");
  try {
    return await getPrisma().$transaction(async (tx) => {
      const activity = await loadActivity(tx, eventId, input.activityId);
      const conflict = assignmentConflict(activity, { role: "TLT", assignee: input.assignee });
      if (conflict) throw new StaffingError(conflict.code, conflict.message);
      await assertOnEvent(tx, eventId, input.assignee);
      if (!(await personIsCurrentTlt(tx, input.assignee.id, now))) {
        throw new StaffingError("NOT_ON_EVENT", "Only a TLT on a current club roster can be assigned here.");
      }
      const created = await tx.eventStaffingAssignment.create({ data: { eventId, activityId: input.activityId, role: "TLT", personId: input.assignee.id }, select: { id: true } });
      await audit(tx, actor, eventId, {
        action: "EVENT_STAFFING_ASSIGNED",
        summary: "Put a TLT on a staffing sheet activity.",
        entityType: "EventStaffingAssignment",
        entityId: created.id,
        metadata: { activityId: input.activityId, assignmentId: created.id, role: "TLT", assigneeKind: "person", assigneeId: input.assignee.id, replacedLead: false },
      });
      return loadActivity(tx, eventId, input.activityId);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StaffingError("CONFLICT", "That person was just added to this activity. Reload to see the current list.");
    }
    throw error;
  }
}

export async function removeAssignment(actor: StaffingActor, eventId: string, assignmentId: string): Promise<ActivityView> {
  // The TLT director may take a TLT off and nothing else; anyone who may change the sheet may take anyone off.
  await assertStaffingAccess(actor, eventId, actor.kind === "tlt-director" ? "assign-tlt" : "write");
  return getPrisma().$transaction(async (tx) => {
    const found = await tx.eventStaffingAssignment.findFirst({ where: { id: assignmentId, eventId }, select: { id: true, activityId: true, role: true, personId: true, userId: true, attendeeAccountId: true } });
    if (!found) throw new StaffingError("ASSIGNMENT_NOT_FOUND", "That assignment could not be found. It may already be removed.");
    if (actor.kind === "tlt-director" && found.role !== "TLT") throw new StaffingError("NOT_PERMITTED", "The TLT director can take TLTs off an activity, not other people.");
    await tx.eventStaffingAssignment.delete({ where: { id: assignmentId } });
    await audit(tx, actor, eventId, {
      action: "EVENT_STAFFING_UNASSIGNED",
      summary: "Took a person off a staffing sheet activity.",
      entityType: "EventStaffingAssignment",
      entityId: assignmentId,
      metadata: { activityId: found.activityId, assignmentId, role: found.role, assigneeKind: found.personId ? "person" : found.userId ? "user" : "account", assigneeId: found.personId ?? found.userId ?? found.attendeeAccountId },
    });
    return loadActivity(tx, eventId, found.activityId);
  });
}

/** The CSV for the event's staff, with the download audited (counts only). The caller has already passed `assertStaffingAccess`. */
export async function buildStaffingExport(actor: StaffingActor, eventId: string, eventName: string): Promise<{ csv: string; slug: string | null }> {
  const [activities, event] = await Promise.all([
    loadStaffingSheet(eventId),
    getPrisma().event.findUnique({ where: { id: eventId }, select: { slug: true } }),
  ]);
  const who = auditWho(actor);
  await writeAuditLog({
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action: "EVENT_STAFFING_CSV_EXPORTED",
    entityType: "Event",
    entityId: eventId,
    summary: "Downloaded the event staffing CSV.",
    metadata: {
      ...who.metadata,
      eventId,
      activityCount: activities.length,
      assignmentCount: activities.reduce((total, activity) => total + activity.assignments.filter((assignment) => assignment.active).length, 0),
      gapCount: summarizeStaffing(activities).gaps.length,
    },
  });
  return { csv: staffingCsv(eventName, activities), slug: event?.slug ?? null };
}
