import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";

export const STAFF_TIMED_OUT_NOTICE =
  "Your staff session timed out after an hour of inactivity. Sign in again to use staff tools. Your registrations are still signed in.";

/**
 * Whether THIS browser is signed in as an attendee whose account is linked to a
 * staff user while it holds no live staff session (#1092): the one-sign-in
 * person whose staff side idled out (1 hour) while the attendee side (7 days)
 * is still alive.
 *
 * It reads only this browser's own sessions, and the link from the attendee
 * account the session already proves (`User.attendeeAccountId`). It never looks
 * anything up by an email a visitor typed, so it cannot tell anyone whether an
 * address belongs to staff, and an anonymous visitor always gets false. With the
 * switch off, or on any failure, it is false.
 */
export async function isStaffSessionTimedOutForLinkedAttendee(): Promise<boolean> {
  try {
    if (!(await isUnifiedSignInEnabled())) return false;
    const staff = await getCurrentSession();
    if (staff.user) return false;
    const attendee = await getCurrentAttendee();
    // `via: "staff"` is derived from a live staff session, so it is excluded: only an attendee session counts.
    if (!attendee.account || attendee.via !== "attendee") return false;
    const linked = await getPrisma().user.findFirst({
      where: { attendeeAccountId: attendee.account.id, accountStatus: "ACTIVE" },
      select: { id: true },
    });
    return Boolean(linked);
  } catch (error) {
    logError("The staff timed-out check failed", error);
    return false;
  }
}
