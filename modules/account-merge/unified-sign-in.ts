import "server-only";

import type { GlobalRole } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { authenticateWithPassword } from "@/modules/access/auth-service";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { staffSessionAllowedFor } from "@/modules/account-merge/staff-elevation";
import { authenticateAttendee } from "@/modules/attendee-accounts/account-service";
import { findSwitchableAttendeeAccountForStaff } from "@/modules/attendee-accounts/current-attendee";
import { createAttendeeSession, revokeAttendeeSession } from "@/modules/attendee-accounts/session-store";

/**
 * The single sign-in (#554, ADR 0013, slice (c)). Everything here runs only
 * while `PlatformSettings.unifiedSignInEnabled` is true; the routes check it.
 *
 * One form, one submit. The email and password are checked against BOTH
 * credential tables, independently and always: the staff `AuthCredential` (with
 * its lockout, pending/disabled rules and second-factor gate) through the
 * unchanged `authenticateWithPassword`, and the attendee `AttendeeCredential`
 * through the unchanged `authenticateAttendee`. Each side does exactly one
 * password hash whether the address is unknown, wrong, locked, disabled or
 * right, so what a caller can observe does not depend on what exists.
 *
 * What it grants:
 *
 * - Staff password right, no second step needed: the staff session AND the
 *   person's linked attendee session.
 * - Staff password right, second step needed: no session yet, only the staff
 *   challenge (`mfa`, or `passkey_required`). Once the staff second factor is
 *   completed (`/api/auth/mfa/challenge`) the staff session and the linked
 *   attendee session are issued together. An attendee session that the same
 *   typed password earned is not left behind in the meantime.
 * - Only the attendee password right: the attendee session only. An attendee
 *   password is an attendee-grade method (`staffSessionAllowedFor`) and never
 *   yields a staff session, whatever follows, including a valid staff TOTP code:
 *   a staff challenge is issued only by the STAFF password check above.
 * - Neither: one refusal, identical for every reason.
 */

export type UnifiedSignInOutcome =
  | { kind: "refused" }
  | { kind: "passkey_required" }
  | { kind: "mfa"; userId: string; gate: "challenge" | "enrol" }
  | {
    kind: "signed_in";
    staff: { userId: string; globalRole: GlobalRole | null; session: { token: string; expiresAt: Date } } | null;
    attendee: { accountId: string; session: { token: string; expiresAt: Date } } | null;
  };

export async function unifiedPasswordSignIn(
  email: string,
  password: string,
  userAgent: string | null,
): Promise<UnifiedSignInOutcome> {
  // Both checks always run, in this order, so the work is the same for every case.
  const staff = await authenticateWithPassword(email, password, userAgent);
  const attendee = await authenticateAttendee(email, password, userAgent);

  if (staff?.outcome === "mfa" || staff?.outcome === "passkey_required") {
    // A staff second step is pending: nothing is issued until it is passed.
    if (attendee) await revokeAttendeeSession(attendee.session.token);
    return staff.outcome === "mfa"
      ? { kind: "mfa", userId: staff.userId, gate: staff.gate }
      : { kind: "passkey_required" };
  }

  // Staff access needs the staff-grade method. `authenticateWithPassword` only ever
  // returns a session for the staff password, so this is that method and no other.
  const staffSession = staff?.outcome === "session"
    && staffSessionAllowedFor("STAFF_PASSWORD_AND_SECOND_FACTOR").allowed
    ? { userId: staff.userId, globalRole: staff.globalRole, session: staff.session }
    : null;

  let attendeeSession = attendee ? { accountId: attendee.accountId, session: attendee.session } : null;
  if (staffSession && !attendeeSession) {
    // A staff person has both sessions: the linked attendee side, with no second factor claimed.
    attendeeSession = await issueLinkedAttendeeSession(staffSession.userId, userAgent, { secondFactorVerified: false });
  }

  if (!staffSession && !attendeeSession) return { kind: "refused" };
  return { kind: "signed_in", staff: staffSession, attendee: attendeeSession };
}

/**
 * The attendee session for a staff person who just passed a staff-grade sign-in.
 * Only while the switch is on; null when there is no usable linked account
 * (unlinked, disabled, unverified). Never throws: the staff session is already
 * issued and must not be lost to a failure on the attendee side.
 *
 * `secondFactorVerified` marks the attendee session as having passed the second
 * step (a staff TOTP or recovery code, or a user-verified staff passkey), so a
 * staff director is not asked twice for the club second step.
 */
export async function issueLinkedAttendeeSession(
  userId: string,
  userAgent: string | null,
  options: { secondFactorVerified: boolean },
): Promise<{ accountId: string; session: { token: string; expiresAt: Date } } | null> {
  try {
    if (!(await isUnifiedSignInEnabled())) return null;
    const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) return null;
    const account = await findSwitchableAttendeeAccountForStaff(user.email, user.id);
    if (!account) return null;
    const session = await createAttendeeSession(
      account.id,
      userAgent,
      options.secondFactorVerified ? { secondFactorVerifiedAt: new Date() } : {},
    );
    return { accountId: account.id, session };
  } catch (error) {
    logError("The linked attendee session could not be issued after a staff sign-in", error);
    return null;
  }
}
