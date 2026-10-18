import { PublicHeaderLinks } from "@/components/public-header-links";
import { getCurrentSession } from "@/modules/access/current-session";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";

/**
 * Reads who is signed in and the single sign-in switch for the public header
 * (#1009). The switch is read the way `redirectToUnifiedSignInWhenEnabled`
 * reads it: a failure counts as off. It is only read for a signed-out visitor.
 */
export async function PublicHeaderSessionLinks() {
  const [session, attendee] = await Promise.all([getCurrentSession(), getCurrentAttendee()]);
  const staffSignedIn = Boolean(session.user);
  const attendeeSignedIn = Boolean(attendee.account);
  let unifiedSignInEnabled = false;
  if (!staffSignedIn && !attendeeSignedIn) {
    try {
      unifiedSignInEnabled = await isUnifiedSignInEnabled();
    } catch {
      unifiedSignInEnabled = false;
    }
  }
  return <PublicHeaderLinks staffSignedIn={staffSignedIn} attendeeSignedIn={attendeeSignedIn} unifiedSignInEnabled={unifiedSignInEnabled} />;
}
