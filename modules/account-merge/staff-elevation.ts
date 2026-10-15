/**
 * Which sign-in methods may open a STAFF session (#554, ADR 0013, slice (b)).
 *
 * Pure, so every method has its own test. The single sign-in flow
 * (`modules/account-merge/unified-sign-in.ts`, slice (c)) routes every staff
 * session through this decision. The staff sign-in functions
 * (`authenticateWithPassword`, `completeMfaChallenge`, the staff passkey sign-in)
 * remain the only code that creates a `UserSession`.
 *
 * The rule (ADR 0003, kept by ADR 0013):
 *
 * - STAFF_PASSWORD_AND_SECOND_FACTOR and STAFF_PASSKEY are the staff-grade
 *   methods, exactly as today.
 * - Attendee password, Google, email link, and an attendee passkey on its own
 *   are attendee-grade. They NEVER yield a staff session, whatever follows,
 *   and whether or not the switch is on and the person is linked.
 * - An attendee passkey NEVER counts as a staff second factor (Caleb, Oct 15,
 *   2026, latest decision, replacing decision 5). Only the staff side's own
 *   second factors count: an ACTIVE `UserMfaEnrollment` code or recovery code,
 *   or a staff `UserPasskey`. An attendee passkey still signs people in on the
 *   attendee side. There is deliberately no function that could wire it in.
 */

export type StaffSignInMethod =
  | "STAFF_PASSWORD_AND_SECOND_FACTOR"
  | "STAFF_PASSKEY"
  | "ATTENDEE_PASSWORD"
  | "ATTENDEE_GOOGLE"
  | "ATTENDEE_EMAIL_LINK"
  | "ATTENDEE_PASSKEY";

export const ATTENDEE_GRADE_METHODS: readonly StaffSignInMethod[] = [
  "ATTENDEE_PASSWORD",
  "ATTENDEE_GOOGLE",
  "ATTENDEE_EMAIL_LINK",
  "ATTENDEE_PASSKEY",
];

export type StaffElevationDecision =
  | { allowed: true }
  | { allowed: false; reason: "ATTENDEE_GRADE_METHOD" };

/** Whether this method, by itself or with the staff steps that follow it, may open a staff session. */
export function staffSessionAllowedFor(method: StaffSignInMethod): StaffElevationDecision {
  if (method === "STAFF_PASSWORD_AND_SECOND_FACTOR" || method === "STAFF_PASSKEY") return { allowed: true };
  return { allowed: false, reason: "ATTENDEE_GRADE_METHOD" };
}
