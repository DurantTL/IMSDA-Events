import "server-only";

import type { GlobalRole } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { checkStaffPasswordNoCount } from "@/modules/access/auth-service";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { staffSessionAllowedFor } from "@/modules/account-merge/staff-elevation";
import { checkAttendeePasswordNoCount } from "@/modules/attendee-accounts/account-service";
import { findSwitchableAttendeeAccountForStaff } from "@/modules/attendee-accounts/current-attendee";
import { createAttendeeSession } from "@/modules/attendee-accounts/session-store";

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
 *   attendee session are issued together. No attendee session is made for the
 *   same typed password in the meantime.
 * - A miss counts toward a side's lockout only when that side failed and the
 *   other side did not succeed (the one-credential sign-in of a linked person
 *   never locks the other credential).
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
  // Both checks always run, in this order, one derivation each, so the work is the
  // same for every case. Neither counts a miss yet.
  const staff = await checkStaffPasswordNoCount(email, password);
  const attendee = await checkAttendeePasswordNoCount(email, password);

  // A miss is counted on a side only when that side failed AND the other side did not
  // succeed: signing in with one credential must not lock the other. A wrong password on
  // both sides counts on both. Locked and disabled credentials are "unavailable" and are
  // never counted, exactly as today.
  if (staff.kind === "wrong" && attendee.kind !== "ok") await staff.countMiss();
  if (attendee.kind === "wrong" && staff.kind !== "ok") await attendee.countMiss();

  if (staff.kind === "ok") {
    const result = await staff.complete(userAgent);
    if (result.outcome === "mfa") return { kind: "mfa", userId: result.userId, gate: result.gate };
    if (result.outcome === "passkey_required") return { kind: "passkey_required" };
    // Staff access needs the staff-grade method. `complete` only ever returns a session for
    // the staff password, so this is that method and no other.
    if (staffSessionAllowedFor("STAFF_PASSWORD_AND_SECOND_FACTOR").allowed) {
      // A staff person's attendee side is always the LINKED one. The attendee session the
      // typed password earned is never created, so none can be left for another account.
      const linked = await issueLinkedAttendeeSession(result.userId, userAgent, { secondFactorVerified: false });
      return {
        kind: "signed_in",
        staff: { userId: result.userId, globalRole: result.globalRole, session: result.session },
        attendee: linked,
      };
    }
  }

  if (attendee.kind === "ok") {
    // An attendee password is attendee-grade (`staffSessionAllowedFor`): attendee session only.
    return { kind: "signed_in", staff: null, attendee: await attendee.complete(userAgent) };
  }
  return { kind: "refused" };
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
