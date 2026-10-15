import "server-only";

import { getPrisma } from "@/lib/prisma";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";

/**
 * Staff and attendee accounts stay separate (#442 decision): a system
 * administrator acting as a club's director may give club team roles the way
 * a real director would, but never to their own email — that would hand
 * their own attendee account a club role through the act-as.
 */
export const ACT_AS_OWN_ACCOUNT_MESSAGE =
  "While acting as a club director you can't give a club role to your own email or attendee account. Ask the club's director, or use the staff tools.";

/**
 * True when `actor` is a staff act-as and `email` is that staff member's own email.
 *
 * With the one-sign-in switch on (#554, ADR 0013) the staff member's linked
 * attendee account counts as their own too: its email is refused as well, so an
 * act-as can never hand a club role to the acting person's own attendee side
 * even if the two emails have drifted apart. With the switch off this is the
 * email check alone, as before.
 */
export async function isActingAdminsOwnEmail(
  actor: { accountId: string } | { userId: string; actAsId?: string },
  email: string,
) {
  if (!("userId" in actor)) return false;
  const user = await getPrisma().user.findUnique({
    where: { id: actor.userId },
    select: { email: true, attendeeAccount: { select: { email: true } } },
  });
  const normalized = email.trim().toLowerCase();
  if (user && user.email.trim().toLowerCase() === normalized) return true;
  const linkedEmail = user?.attendeeAccount?.email;
  if (linkedEmail && linkedEmail.trim().toLowerCase() === normalized) return isUnifiedSignInEnabled();
  return false;
}
