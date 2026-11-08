import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { BrandLink } from "@/components/brand-link";
import { SignOutButton } from "@/components/sign-out-button";
import { isActiveClubsAdministrator } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { CLUBS_ADMIN_HOME_PATH, EVENT_PICKER_PATH, staffSignInLinkFor } from "@/modules/access/login-routing";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeStaffPageCopy, CLUBS_ADMIN_NO_ACCESS_REASONS, noAccessCopy } from "@/modules/access/no-access-copy";
import { listEventsForUser } from "@/modules/events/repository";

export const metadata: Metadata = { title: "No event access", robots: { index: false, follow: false } };

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ from?: string | string[]; next?: string | string[] }> }) {
  const session = await getCurrentSession();
  if (!session.user) {
    // Signed in as an attendee or club leader (staff pages sent them here): say so instead of asking for a staff
    // sign-in again, which would look like being signed out. No redirect back, so no loop. Signed out still signs in.
    const attendee = await getCurrentAttendee();
    if (!attendee.account || attendee.via !== "attendee") redirect(await staffLoginRedirectPath());
    const { next } = await searchParams;
    // The page they asked for rides along (validated by staffLoginPathFor); without one the link says "staff" instead.
    const staffLink = staffSignInLinkFor(typeof next === "string" ? next : null);
    const copy = attendeeStaffPageCopy(attendee.account.verifiedEmail);
    return <main className="auth-page"><section className="auth-card no-access-card"><BrandLink className="auth-brand" wordmark /><AccessRestricted title={copy.heading} detail={copy.body} whoToAsk={copy.whoToAsk} headingLevel={1} showHelpLink={false} /><Link className="primary-button full-button" href="/account">Go to my account</Link><Link className="secondary-button full-button" href={staffLink}>Sign in with a staff account</Link></section></main>;
  }
  if (session.user.globalRole === "SYSTEM_ADMIN") redirect("/event-setup");
  const { from } = await searchParams;
  // Event Admins and anyone working in an event are sent here from the event-creation pages (#1411).
  const hasEvents = (await listEventsForUser(session.user.id, false, { clubEvents: "exclude" })).length > 0;
  const clubsAdmin = await isActiveClubsAdministrator(session.user.id);
  // No reason given (a page that needs an event, the picker, a stale link): a Clubs Administrator's home is Club administration.
  if (clubsAdmin && !(typeof from === "string" && (CLUBS_ADMIN_NO_ACCESS_REASONS as readonly string[]).includes(from))) redirect(CLUBS_ADMIN_HOME_PATH);
  const copy = noAccessCopy({ from: typeof from === "string" ? from : null, hasEvents, email: session.user.email, clubsAdmin });
  return <main className="auth-page"><section className="auth-card no-access-card"><BrandLink className="auth-brand" wordmark /><AccessRestricted title={copy.heading} detail={copy.body} whoToAsk={copy.whoToAsk} headingLevel={1} />{copy.showClubs && <Link className="primary-button full-button" href="/admin/clubs">Back to Club administration</Link>}{copy.showEvents && <Link className="primary-button full-button" href={EVENT_PICKER_PATH}>Back to your events</Link>}<SignOutButton className="secondary-button full-button" /></section></main>;
}
