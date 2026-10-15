/**
 * Which sign-in methods may open a STAFF session (#554, ADR 0013, slice (b)).
 *
 * Pure, so every method has its own test. Slice (c) builds the single sign-in
 * page and must route every staff session through this decision; until then no
 * route calls it, and the existing staff sign-in functions (`authenticateWithPassword`,
 * `completeMfaChallenge`, the staff passkey sign-in) remain the only code that
 * creates a `UserSession`.
 *
 * The rule (ADR 0003, kept by ADR 0013):
 *
 * - STAFF_PASSWORD_AND_SECOND_FACTOR and STAFF_PASSKEY are the staff-grade
 *   methods, exactly as today.
 * - Attendee password, Google, email link, and an attendee passkey on its own
 *   are attendee-grade. They NEVER yield a staff session, whatever follows,
 *   and whether or not the switch is on and the person is linked.
 * - An attendee passkey counts only as the SECOND FACTOR after the staff
 *   password, and only when the sign-in assertion was itself verified with
 *   user verification (decision 5, Oct 15). It is never a first factor.
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

export type AttendeePasskeySecondFactorInput = {
  /** The one-sign-in switch (`PlatformSettings.unifiedSignInEnabled`). */
  switchEnabled: boolean;
  /** The STAFF password for this sign-in was already verified, in this same attempt. */
  staffPasswordVerified: boolean;
  /** The account the passkey belongs to, and the account this staff user is linked to. */
  passkeyAccountId: string;
  linkedAttendeeAccountId: string | null;
  /** The assertion was verified with `userVerification: required` and the authenticator reported the user as verified. */
  assertionUserVerified: boolean;
};

export type AttendeePasskeySecondFactorDecision =
  | { counts: true }
  | {
      counts: false;
      reason:
        | "SWITCH_OFF"
        | "STAFF_PASSWORD_REQUIRED_FIRST"
        | "NOT_LINKED"
        | "PASSKEY_OF_ANOTHER_ACCOUNT"
        | "USER_VERIFICATION_REQUIRED";
    };

/**
 * Whether an attendee-side passkey assertion counts as the staff second factor
 * (decision 5). Every condition must hold; the first one that fails is the reason.
 */
export function attendeePasskeyCountsAsStaffSecondFactor(
  input: AttendeePasskeySecondFactorInput,
): AttendeePasskeySecondFactorDecision {
  if (!input.switchEnabled) return { counts: false, reason: "SWITCH_OFF" };
  if (!input.staffPasswordVerified) return { counts: false, reason: "STAFF_PASSWORD_REQUIRED_FIRST" };
  if (!input.linkedAttendeeAccountId) return { counts: false, reason: "NOT_LINKED" };
  if (input.passkeyAccountId !== input.linkedAttendeeAccountId) {
    return { counts: false, reason: "PASSKEY_OF_ANOTHER_ACCOUNT" };
  }
  if (input.assertionUserVerified !== true) return { counts: false, reason: "USER_VERIFICATION_REQUIRED" };
  return { counts: true };
}
