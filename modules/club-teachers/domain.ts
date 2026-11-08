import { z } from "zod";

/**
 * Club teachers (#1681), pure rules and no database: how many teachers a club is asked for, whether it has enough,
 * and the words that say so. The tool is optional: an Area Coordinator, the Clubs Administrator or staff turn it on for a
 * club event and set the rule; clubs see it only while it is on.
 */

export type TeacherRule = {
  /** Teachers every club is asked for. */
  baseTeachers: number;
  /** A club bringing MORE than this many people is asked for `largerClubTeachers`. Null: no larger-club number. */
  largerClubOver: number | null;
  largerClubTeachers: number;
  /** A club below its number cannot submit. Off by default: a warning only. */
  requireTeachers: boolean;
};

export const defaultTeacherRule: TeacherRule = { baseTeachers: 1, largerClubOver: null, largerClubTeachers: 2, requireTeachers: false };

const count = (label: string, minimum: number) =>
  z.number({ error: `${label} must be a whole number.` }).int(`${label} must be a whole number.`).min(minimum, `${label} must be at least ${minimum}.`).max(20, `${label} can be at most 20.`);

export const teacherRuleSchema = z.object({
  baseTeachers: count("Teachers per club", 0),
  largerClubOver: count("The larger-club size", 1).nullable(),
  largerClubTeachers: count("Teachers for a larger club", 0),
  requireTeachers: z.boolean(),
}).strict().superRefine((rule, context) => {
  if (rule.largerClubOver !== null && rule.largerClubTeachers < rule.baseTeachers) {
    context.addIssue({ code: "custom", path: ["largerClubTeachers"], message: "A larger club is asked for at least as many teachers as any club." });
  }
});

/** What the person turning the tool on, or changing it, sends. `enabled` omitted leaves the switch as it is. */
export const teacherSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  rule: teacherRuleSchema.optional(),
}).strict().refine((input) => input.enabled !== undefined || input.rule !== undefined, "Send the switch, the rule, or both.");

export type TeacherSettingsInput = z.infer<typeof teacherSettingsSchema>;

/** How many teachers a club bringing `headcount` people is asked for. */
export function requiredTeachers(rule: TeacherRule, headcount: number): number {
  if (rule.largerClubOver !== null && headcount > rule.largerClubOver) return Math.max(rule.baseTeachers, rule.largerClubTeachers);
  return rule.baseTeachers;
}

export type TeacherStatus = { required: number; named: number; short: number; met: boolean };

export function teacherStatus(rule: TeacherRule, headcount: number, named: number): TeacherStatus {
  const required = requiredTeachers(rule, headcount);
  const short = Math.max(0, required - named);
  return { required, named, short, met: short === 0 };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The warning a club sees, or null when it has enough. Plain words; it never blocks on its own. */
export function teacherWarning(status: TeacherStatus, blocksRegistration: boolean): string | null {
  if (status.met) return null;
  const base = `This event asks for ${plural(status.required, "teacher")} from your club. You have named ${status.named}.`;
  return blocksRegistration
    ? `${base} Name ${plural(status.short, "more teacher")} before you submit your registration.`
    : `${base} You can still register. Clubs that bring teachers are placed on their weekend first.`;
}

/** The sentence that explains the rule, for the club and the Area Coordinator. */
export function teacherRuleSummary(rule: TeacherRule): string {
  const base = `${plural(rule.baseTeachers, "teacher")} per club`;
  if (rule.largerClubOver === null || rule.largerClubTeachers <= rule.baseTeachers) return base;
  return `${base}, ${rule.largerClubTeachers} for a club bringing more than ${rule.largerClubOver} ${rule.largerClubOver === 1 ? "person" : "people"}`;
}

/** Only an adult or staff member on the roster can teach: adult names only (#1681). */
export const teacherAttendeeTypes = ["ADULT", "STAFF"] as const;

export function canTeach(attendeeType: string): boolean {
  return (teacherAttendeeTypes as readonly string[]).includes(attendeeType);
}

/** Teachers are adults: 16- and 17-year-old staff are Pathfinders and TLTs, not adults (#1727). */
export const youngestTeacherAge = 18;

export type TeacherEligibility = "ok" | "under-18" | "age-unknown";

/**
 * Whether an adult or staff roster person may teach, from their whole-years age on the event's first day (the roster
 * birth date, else the age a form reported). An unknown age is not eligible: the club is asked to add the birth date.
 */
export function teacherEligibility(age: number | null): TeacherEligibility {
  if (age === null) return "age-unknown";
  return age >= youngestTeacherAge ? "ok" : "under-18";
}

export const teacherUnderAgeLabel = "Under 18, can't teach";
export const teacherAgeUnknownLabel = "Age needed, add a birth date on your roster";
export const teacherUnderAgeMessage = "Teachers must be 18 or older. Remove anyone under 18 and name an adult instead.";
export const teacherAgeUnknownMessage = "A teacher's age is needed. Add the birth date on your roster first.";

export function teacherEligibilityLabel(eligibility: TeacherEligibility): string | null {
  if (eligibility === "under-18") return teacherUnderAgeLabel;
  if (eligibility === "age-unknown") return teacherAgeUnknownLabel;
  return null;
}

export const teacherEntriesSchema = z.object({
  teachers: z.array(z.object({
    rosterMemberId: z.string().trim().min(1).max(64),
    honorName: z.string().trim().max(120).nullish().transform((value) => (value ? value : null)),
    locationId: z.string().trim().max(64).nullish().transform((value) => (value ? value : null)),
  }).strict()).max(20, "Name at most 20 teachers."),
}).strict().superRefine((input, context) => {
  const seen = new Set<string>();
  input.teachers.forEach((teacher, index) => {
    if (seen.has(teacher.rosterMemberId)) context.addIssue({ code: "custom", path: ["teachers", index, "rosterMemberId"], message: "Each person can be named once." });
    seen.add(teacher.rosterMemberId);
  });
});

export type TeacherEntriesInput = z.infer<typeof teacherEntriesSchema>;
