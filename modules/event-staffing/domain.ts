import { z } from "zod";
import { formatPersonName } from "@/lib/person-name";
import { toCsv } from "@/modules/reporting/csv";

/**
 * The optional event staffing sheet (#1678). Pure and database-free: the rules for an activity and an assignment, the gaps,
 * and the CSV.
 *
 * This boundary is the first slice of the planned volunteers and shifts work (#65, #201, #203; the reserved event "Operations"
 * tab in #1559). That work should extend it, not replace it: an activity is the thing people are needed for, an assignment is
 * one person in one role on it, and the role list already holds TLT so assigning TLTs (by help-area tag, once the TLT directory
 * exists) is a new way to add a row, not a new table. Shifts would add a time window to an activity or an assignment.
 *
 * Names of people, minors included, are read from registrations and staff accounts when the sheet is opened. Nothing here
 * stores a name, a contact detail or an age, and neither the CSV nor the audit log holds one beyond the name and role asked for.
 */

export const STAFFING_MODULE_KEY = "event-staffing" as const;

/** Every role the table can hold. TLT rows are written only by the TLT director's own path (`tltAssignmentInputSchema`); `ASSIGNABLE_ROLES` is what an ordinary editor may write. */
export const STAFFING_ROLES = ["LEAD", "HELPER", "LIFEGUARD", "TLT"] as const;
export type StaffingRole = (typeof STAFFING_ROLES)[number];

/** What an Area Coordinator or event administrator can put a person in. TLTs are assigned by the TLT director only. */
export const ASSIGNABLE_ROLES = ["LEAD", "HELPER", "LIFEGUARD"] as const satisfies readonly StaffingRole[];

export const ROLE_LABELS: Record<StaffingRole, string> = { LEAD: "Lead", HELPER: "Adult helper", LIFEGUARD: "Lifeguard", TLT: "TLT" };
/** Used in a gap: "2 of 4 lifeguards". */
const ROLE_NOUNS: Record<Exclude<StaffingRole, "LEAD">, [string, string]> = { HELPER: ["adult helper", "adult helpers"], LIFEGUARD: ["lifeguard", "lifeguards"], TLT: ["TLT", "TLTs"] };
const roleNoun = (role: Exclude<StaffingRole, "LEAD">, count: number) => ROLE_NOUNS[role][count === 1 ? 0 : 1];

/** Registrations that count as "registered for the event": the same active states the budget sheet and the reports use. */
export const ACTIVE_REGISTRATION_STATUSES = ["SUBMITTED", "CONFIRMED"] as const;

export const MAX_NAME_LENGTH = 80;
export const MAX_TEXT_LENGTH = 200;
export const MAX_NEEDED = 200;
/** A sheet is a short list of camporee events, not a schedule. */
export const MAX_ACTIVITIES = 100;
export const MAX_ASSIGNMENTS_PER_ACTIVITY = 60;

const needed = (label: string) =>
  z.number({ error: `Enter how many ${label} are needed.` }).int(`${label[0]!.toUpperCase()}${label.slice(1)} needed must be a whole number.`)
    .min(0, "A number needed cannot be negative.").max(MAX_NEEDED, `Keep each number needed to ${MAX_NEEDED} or fewer.`).default(0);

const optionalText = (label: string) => z.string().trim().max(MAX_TEXT_LENGTH, `Keep the ${label} under ${MAX_TEXT_LENGTH} characters.`).default("");

export const activityInputSchema = z.object({
  name: z.string({ error: "Enter the activity's name." }).trim().min(1, "Enter the activity's name.").max(MAX_NAME_LENGTH, `Keep the name under ${MAX_NAME_LENGTH} characters.`),
  description: optionalText("description"),
  location: optionalText("location"),
  timeText: optionalText("time"),
  tltsNeeded: needed("TLTs"),
  lifeguardsNeeded: needed("lifeguards"),
  helpersNeeded: needed("other helpers"),
}).strict();
export type ActivityInput = z.infer<typeof activityInputSchema>;

export const activityUpdateSchema = activityInputSchema.extend({ id: z.string().min(1).max(64) }).strict();
export const activityDeleteSchema = z.object({ id: z.string().min(1).max(64) }).strict();

/**
 * Who is being assigned, by id: a registered person, an event staff user, or an Area Coordinator's account (lead only). The
 * server checks they belong to the event, or hold an active Area Coordinator grant.
 */
export const assigneeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), id: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("user"), id: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("account"), id: z.string().min(1).max(64) }).strict(),
]);
export type Assignee = z.infer<typeof assigneeSchema>;

export const assignmentInputSchema = z.object({
  activityId: z.string().min(1).max(64),
  role: z.enum(ASSIGNABLE_ROLES, { error: "Choose lead, adult helper or lifeguard." }),
  assignee: assigneeSchema,
}).strict().refine((input) => input.assignee.kind !== "account" || input.role === "LEAD", { message: "An Area Coordinator can be an activity's lead, not a helper or lifeguard.", path: ["role"] });
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

/**
 * What the TLT director sends to assign a TLT (#1678): the role is fixed and the assignee is a person, so a body asking for any
 * other role or kind is refused before the server looks at the event. The server then checks the person is registered for the
 * event and is a current TLT.
 */
export const tltAssignmentInputSchema = z.object({
  activityId: z.string().min(1).max(64),
  role: z.literal("TLT", { error: "The TLT director assigns TLTs only." }),
  assignee: z.object({ kind: z.literal("person", { error: "A TLT is chosen from the registered TLTs." }), id: z.string().min(1).max(64) }).strict(),
}).strict();
export type TltAssignmentInput = z.infer<typeof tltAssignmentInputSchema>;

export const assignmentDeleteSchema = z.object({ id: z.string().min(1).max(64) }).strict();

/** The switch body, the same as the other optional tools. */
export const staffingSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export type StaffingSettingsInput = z.infer<typeof staffingSettingsSchema>;

export type AssignmentView = {
  id: string;
  role: StaffingRole;
  kind: "person" | "user" | "account";
  /** The person's, staff user's or coordinator account's id, so a picker can leave out people already on the activity. */
  assigneeId: string;
  /** First Last (staff: their display name). */
  name: string;
  /** "Last, First" for exports and sorted lists. */
  sortedName: string;
  /** False once the person is no longer registered (cancelled) or left the event's staff: they stay on the sheet but count for nothing. */
  active: boolean;
};

export type ActivityView = {
  id: string;
  name: string;
  description: string;
  location: string;
  timeText: string;
  tltsNeeded: number;
  lifeguardsNeeded: number;
  helpersNeeded: number;
  assignments: AssignmentView[];
};

export type StaffingGap = {
  activityId: string;
  activityName: string;
  /** "lead" for the missing lead, otherwise the role short of its number. */
  role: StaffingRole;
  needed: number;
  assigned: number;
  /** "Surprise: no lead", "Canoe: 2 of 4 lifeguards", "Frisbee: 0 of 3 TLTs". */
  text: string;
  /** The same without the activity's name: "no lead", "2 of 4 lifeguards". */
  shortText: string;
};

export type RoleCount = { role: Exclude<StaffingRole, "LEAD">; needed: number; assigned: number };

function countAssigned(activity: ActivityView, role: StaffingRole): number {
  return activity.assignments.filter((assignment) => assignment.role === role && assignment.active).length;
}

/** The numbers each non-lead role needs and has, in the order the sheet shows them. Roles nobody needs are left out. */
export function roleCounts(activity: ActivityView): RoleCount[] {
  const rows: RoleCount[] = [
    { role: "TLT", needed: activity.tltsNeeded, assigned: countAssigned(activity, "TLT") },
    { role: "LIFEGUARD", needed: activity.lifeguardsNeeded, assigned: countAssigned(activity, "LIFEGUARD") },
    { role: "HELPER", needed: activity.helpersNeeded, assigned: countAssigned(activity, "HELPER") },
  ];
  return rows.filter((row) => row.needed > 0 || row.assigned > 0);
}

/** What one activity is still short of: no lead, and each role with fewer people than needed. More than needed is not a gap. */
export function activityGaps(activity: ActivityView): StaffingGap[] {
  const gaps: StaffingGap[] = [];
  if (countAssigned(activity, "LEAD") === 0) {
    gaps.push({ activityId: activity.id, activityName: activity.name, role: "LEAD", needed: 1, assigned: 0, text: `${activity.name}: no lead`, shortText: "no lead" });
  }
  for (const row of roleCounts(activity)) {
    if (row.assigned < row.needed) {
      gaps.push({ activityId: activity.id, activityName: activity.name, role: row.role, needed: row.needed, assigned: row.assigned, text: `${activity.name}: ${row.assigned} of ${row.needed} ${roleNoun(row.role, row.needed)}`, shortText: `${row.assigned} of ${row.needed} ${roleNoun(row.role, row.needed)}` });
    }
  }
  return gaps;
}

export type StaffingSummary = { activityCount: number; activitiesWithGaps: number; gaps: StaffingGap[] };

export function summarizeStaffing(activities: readonly ActivityView[]): StaffingSummary {
  const gaps = activities.flatMap(activityGaps);
  return { activityCount: activities.length, activitiesWithGaps: new Set(gaps.map((gap) => gap.activityId)).size, gaps };
}

/** Why an assignment was refused before the server looked at the event, in words a person can act on. */
export function assignmentConflict(activity: ActivityView, input: { role: StaffingRole; assignee: Assignee }): { code: "CONFLICT" | "TOO_MANY"; message: string } | null {
  if (activity.assignments.some((assignment) => assignment.kind === input.assignee.kind && assignment.assigneeId === input.assignee.id)) {
    return { code: "CONFLICT", message: "That person is already on this activity. Remove them first to change their role." };
  }
  if (activity.assignments.length >= MAX_ASSIGNMENTS_PER_ACTIVITY) {
    return { code: "TOO_MANY", message: `An activity holds up to ${MAX_ASSIGNMENTS_PER_ACTIVITY} people.` };
  }
  return null;
}

export function assignmentName(person: { firstName?: string | null; lastName?: string | null }): { name: string; sortedName: string } {
  return { name: formatPersonName(person), sortedName: formatPersonName(person, "sorted") };
}

const ROLE_ORDER: Record<StaffingRole, number> = { LEAD: 0, TLT: 1, LIFEGUARD: 2, HELPER: 3 };

/** People in the order a sheet lists them: lead first, then by role, then by name. */
export function sortAssignments(assignments: readonly AssignmentView[]): AssignmentView[] {
  return [...assignments].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.sortedName.localeCompare(b.sortedName) || a.id.localeCompare(b.id));
}

/**
 * The CSV for the event's staff: one row per person (activity, role, name), then the numbers still needed. Names, activity and
 * role only: no email, phone, age, birth date or health detail is ever in it. Names are "Last, First", as the other exports write them.
 */
export function staffingCsv(eventName: string, activities: readonly ActivityView[]): string {
  const rows: Array<Array<string | number>> = [["Event staffing", eventName, ""], ["Activity", "Role", "Name"]];
  for (const activity of activities) {
    for (const assignment of sortAssignments(activity.assignments)) {
      if (assignment.active) rows.push([activity.name, ROLE_LABELS[assignment.role], assignment.sortedName]);
    }
  }
  rows.push(["", "", ""], ["Still needed", "Role", "Short by"]);
  for (const gap of summarizeStaffing(activities).gaps) {
    rows.push([gap.activityName, ROLE_LABELS[gap.role], gap.needed - gap.assigned]);
  }
  return toCsv(rows);
}
