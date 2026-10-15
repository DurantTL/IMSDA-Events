/**
 * Pure rules for linking a staff `User` to an `AttendeeAccount` (#554, ADR 0013,
 * slice (b)). No database and no `server-only`, so the rules are unit-tested on
 * their own and the service code below them stays thin.
 */

export function normalizeLinkEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type LinkCandidateAccount = {
  email: string;
  status: "PENDING_VERIFICATION" | "ACTIVE";
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
  /** The staff user already linked to this account, if any. */
  linkedUserId: string | null;
};

/**
 * Whether an existing attendee account may be linked to a staff user with this
 * email (ADR 0013, decision 4): the normalised emails are equal, the account's
 * email is VERIFIED, it is active and not disabled, and it is not linked to
 * anyone else. An unverified account is never reused or "verified" on the
 * strength of a staff activation, because someone other than the staff member
 * may have created it and may hold its password.
 */
export function canReuseAttendeeAccount(
  account: LinkCandidateAccount,
  staffEmail: string,
  staffUserId: string | null = null,
): boolean {
  if (normalizeLinkEmail(account.email) !== normalizeLinkEmail(staffEmail)) return false;
  if (!account.emailVerifiedAt) return false;
  if (account.status !== "ACTIVE") return false;
  if (account.disabledAt) return false;
  if (account.linkedUserId && account.linkedUserId !== staffUserId) return false;
  return true;
}
