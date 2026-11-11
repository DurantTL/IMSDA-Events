import { z } from "zod";
import { rosterRoleOrDefault } from "@/modules/club-rosters/domain";
import { guardiansInputSchema, guardiansUpdateSchema } from "@/modules/club-rosters/guardians-domain";

const classLevel = z.enum(["FRIEND", "COMPANION", "EXPLORER", "RANGER", "VOYAGER", "GUIDE", "BASIC_STAFF_TRAINING", "MASTER_GUIDE"]).nullable();

const schoolGrade = z.enum(["GRADE_K", "GRADE_1", "GRADE_2", "GRADE_3", "GRADE_4", "GRADE_5", "GRADE_6", "GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10", "GRADE_11", "GRADE_12", "NOT_IN_SCHOOL"]).nullable();
const schoolType = z.enum(["ADVENTIST_SCHOOL", "PUBLIC_SCHOOL", "HOMESCHOOL", "OTHER"]).nullable();
const churchMember = z.enum(["YES", "NO", "NOT_SURE"]).nullable();

const name = (label: string) => z.string().trim().min(1, `Enter the ${label}.`).max(80);

/**
 * Left blank, a youth's role saves as "Pathfinder" and anyone else's stays
 * empty (#424). The default depends on the type, so it's applied on the whole
 * object for a new member, and by `updateRosterMember` for an edit (which
 * knows the stored type when the edit doesn't send one).
 */
const role = z.string().trim().max(60);

/**
 * Stays nullable in the stored shape — imports and other callers may
 * legitimately have no gender on file — but the roster form and edit dialog
 * always send one, so `.refine` below requires a choice whenever the field
 * is actually present in the request (#424). An edit that leaves the field
 * out is checked against the stored gender by `updateRosterMember`
 * (`requireGender`), so an existing member with no gender must choose one
 * the next time their details are edited.
 */
const gender = z.enum(["FEMALE", "MALE"]).nullable();

/**
 * The app no longer has any driving feature (#544). An older client may
 * still send `willingToDrive`; it is accepted, whatever its value, and
 * dropped by `withoutWillingToDrive` before the data reaches a write, so it
 * is never stored and never causes a 400.
 */
const ignoredWillingToDrive = z.unknown().optional();

function withoutWillingToDrive<T extends { willingToDrive?: unknown }>(data: T): Omit<T, "willingToDrive"> {
  const { willingToDrive, ...rest } = data;
  void willingToDrive;
  return rest;
}

export const rosterMemberInputSchema = z.object({
  firstName: name("first name"),
  lastName: name("last name"),
  birthDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the birth date."),
  attendeeType: z.enum(["YOUTH", "STAFF", "ADULT", "UNDERAGE"]),
  role: role.default(""),
  classLevel: classLevel.default(null),
  /** Teen Leadership Training (#1851): a yes/no on youth members; the write drops it for any other type. */
  isTlt: z.boolean().optional(),
  /** School grade, school type and church membership (#1664, #1668): optional, youth only. */
  schoolGrade: schoolGrade.optional(),
  schoolType: schoolType.optional(),
  churchMember: churchMember.optional(),
  gender: gender.default(null),
  /** Guardian contacts (#510): replaces the set when sent; only a club director or deputy may send it (the route checks). */
  guardians: guardiansInputSchema.optional(),
  willingToDrive: ignoredWillingToDrive,
}).strict()
  .refine((data) => data.gender !== null, { message: "Choose Male or Female.", path: ["gender"] })
  .transform((data) => ({ ...withoutWillingToDrive(data), role: rosterRoleOrDefault(data.role, data.attendeeType) }));

export const rosterMemberUpdateSchema = z.object({
  firstName: name("first name"),
  lastName: name("last name"),
  birthDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the birth date."),
  attendeeType: z.enum(["YOUTH", "STAFF", "ADULT", "UNDERAGE"]),
  role,
  classLevel,
  isTlt: z.boolean(),
  schoolGrade,
  schoolType,
  churchMember,
  gender,
  status: z.enum(["ACTIVE", "INACTIVE"]),
  guardians: guardiansUpdateSchema,
  willingToDrive: ignoredWillingToDrive,
}).partial().strict().refine((data) => !("gender" in data) || data.gender !== null, {
  message: "Choose Male or Female.",
  path: ["gender"],
}).transform(withoutWillingToDrive);

export const rosterRemoveSchema = z.object({
  confirm: z.literal(true, "Confirm that this person should be removed."),
}).strict();

export const rosterUnlockSchema = z.object({
  code: z.string().trim().min(6, "Enter the code from your authenticator app.").max(20),
}).strict();

export type RosterMemberInput = z.infer<typeof rosterMemberInputSchema>;
export type RosterMemberUpdate = z.infer<typeof rosterMemberUpdateSchema>;
