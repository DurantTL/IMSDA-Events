import { unstable_rethrow } from "next/navigation";
import { PublicHeaderLinks } from "@/components/public-header-links";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";

/**
 * Reads who is signed in and the single sign-in switch for the public header
 * (#1009). The switch is read the way `redirectToUnifiedSignInWhenEnabled`
 * reads it: a failure counts as off. Any failure reading the sessions renders
 * the signed-out header instead of failing the public page, and is logged (no
 * user or cookie data) so a broken session store does not go unnoticed. Next's
 * own control-flow errors are rethrown. The switch is only read for a
 * signed-out visitor.
 */
export async function PublicHeaderSessionLinks() {
  let staffSignedIn = false;
  let attendeeSignedIn = false;
  let unifiedSignInEnabled = false;
  try {
    const [session, attendee] = await Promise.all([getCurrentSession(), getCurrentAttendee()]);
    staffSignedIn = Boolean(session.user);
    attendeeSignedIn = Boolean(attendee.account);
    if (!staffSignedIn && !attendeeSignedIn) unifiedSignInEnabled = await isUnifiedSignInEnabled();
  } catch (error) {
    unstable_rethrow(error);
    logError("Public header session read failed", error);
    staffSignedIn = false;
    attendeeSignedIn = false;
    unifiedSignInEnabled = false;
  }
  return <PublicHeaderLinks staffSignedIn={staffSignedIn} attendeeSignedIn={attendeeSignedIn} unifiedSignInEnabled={unifiedSignInEnabled} />;
}
