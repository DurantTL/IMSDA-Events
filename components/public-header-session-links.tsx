import { unstable_rethrow } from "next/navigation";
import { PublicHeaderLinks } from "@/components/public-header-links";
import { PublicHeaderNavLinks } from "@/components/public-header-nav-links";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { isStaffSessionTimedOutForLinkedAttendee } from "@/modules/account-merge/staff-timeout";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";
import type { HubLink } from "@/modules/site-content/hub-content-domain";

/**
 * Reads who is signed in and the single sign-in switch for the public header
 * (#1009). The switch is read the way `redirectToUnifiedSignInWhenEnabled`
 * reads it: a failure counts as off. Any failure reading the sessions renders
 * the signed-out header instead of failing the public page, and is logged (no
 * user or cookie data) so a broken session store does not go unnoticed. Next's
 * own control-flow errors are rethrown. The switch is only read for a
 * signed-out visitor.
 */
export async function PublicHeaderSessionLinks({ navLinks }: { navLinks?: readonly HubLink[] } = {}) {
  // The preview passes the draft's links; every other page shows the published ones (#111). Never fails the header.
  const extraLinks = navLinks ?? (await getPublishedHubContent()).navLinks;
  let staffSignedIn = false;
  let attendeeSignedIn = false;
  let unifiedSignInEnabled = false;
  let staffTimedOut = false;
  try {
    const [session, attendee] = await Promise.all([getCurrentSession(), getCurrentAttendee()]);
    staffSignedIn = Boolean(session.user);
    attendeeSignedIn = Boolean(attendee.account);
    if (!staffSignedIn && !attendeeSignedIn) unifiedSignInEnabled = await isUnifiedSignInEnabled();
    // (#1092) Never throws and is false for anyone not signed in as an attendee linked to staff.
    if (!staffSignedIn && attendee.account && attendee.via === "attendee") staffTimedOut = await isStaffSessionTimedOutForLinkedAttendee();
  } catch (error) {
    unstable_rethrow(error);
    logError("Public header session read failed", error);
    staffSignedIn = false;
    attendeeSignedIn = false;
    unifiedSignInEnabled = false;
  }
  return (
    <>
      <PublicHeaderNavLinks links={extraLinks} />
      <PublicHeaderLinks staffSignedIn={staffSignedIn} attendeeSignedIn={attendeeSignedIn} unifiedSignInEnabled={unifiedSignInEnabled} staffTimedOut={staffTimedOut} />
    </>
  );
}
