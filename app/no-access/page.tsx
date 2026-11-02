import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { BrandLink } from "@/components/brand-link";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { EVENT_PICKER_PATH } from "@/modules/access/login-routing";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeStaffPageCopy, noAccessCopy } from "@/modules/access/no-access-copy";
import { listEventsForUser } from "@/modules/events/repository";

export const metadata: Metadata = { title: "No event access", robots: { index: false, follow: false } };

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const session = await getCurrentSession();
  if (!session.user) {
    // Signed in as an attendee or club leader (staff pages sent them here): say so instead of asking for a staff
    // sign-in again, which would look like being signed out. No redirect back, so no loop. Signed out still signs in.
    const attendee = await getCurrentAttendee();
    if (!attendee.account || attendee.via !== "attendee") redirect(await staffLoginRedirectPath());
    const copy = attendeeStaffPageCopy(attendee.account.verifiedEmail);
    return <main className="auth-page"><section className="auth-card no-access-card"><BrandLink className="auth-brand" wordmark /><AccessRestricted title={copy.heading} detail={copy.body} whoToAsk={copy.whoToAsk} headingLevel={1} showHelpLink={false} /><Link className="primary-button full-button" href="/account">Go to my account</Link><Link className="secondary-button full-button" href="/login">Sign in with a staff account</Link></section></main>;
  }
  if (session.user.globalRole === "SYSTEM_ADMIN") redirect("/event-setup");
  const { from } = await searchParams;
  // Event Admins and anyone working in an event are sent here from the event-creation pages (#1411).
  const hasEvents = (await listEventsForUser(session.user.id, false)).length > 0;
  const copy = noAccessCopy({ from: typeof from === "string" ? from : null, hasEvents, email: session.user.email });
  return <main className="auth-page"><section className="auth-card no-access-card"><BrandLink className="auth-brand" wordmark /><AccessRestricted title={copy.heading} detail={copy.body} whoToAsk={copy.whoToAsk} headingLevel={1} />{copy.showEvents && <Link className="primary-button full-button" href={EVENT_PICKER_PATH}>Back to your events</Link>}<SignOutButton className="secondary-button full-button" /></section></main>;
}
