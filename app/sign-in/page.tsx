import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";
import { AttendeeGoogleButton, attendeeSignInErrorMessage } from "@/components/attendee-google-button";
import { CombinedPasskeySignInButton } from "@/components/combined-passkey-sign-in-button";
import { isGoogleSignInConfigured } from "@/integrations/oauth/google";
import { getCurrentSession } from "@/modules/access/current-session";
import { passkeysConfigured as staffPasskeysConfigured } from "@/modules/access/passkeys";
import { resolvePostLoginDestination } from "@/modules/access/post-login-destination";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { isStaffSessionTimedOutForLinkedAttendee, STAFF_TIMED_OUT_NOTICE } from "@/modules/account-merge/staff-timeout";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { passkeysConfigured as attendeePasskeysConfigured } from "@/modules/attendee-accounts/passkeys";
import { attendeeReturnDestination } from "@/modules/attendee-accounts/return-destination";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to IMSDA Events.",
  robots: { index: false, follow: false },
};

/**
 * The single sign-in (#554, ADR 0013, slice (c)): one form for staff and
 * registrants. It never changes after the email is typed and never says whether
 * an address belongs to staff. With the one-sign-in switch off this page sends
 * visitors to the staff sign-in, as before.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  // Fail closed: if the switch cannot be read, the old staff sign-in is the page.
  let enabled = false;
  try {
    enabled = await isUnifiedSignInEnabled();
  } catch {
    enabled = false;
  }
  if (!enabled) redirect("/login");

  const { error, next: rawNext } = await searchParams;
  const next = typeof rawNext === "string" ? rawNext : undefined;
  const session = await getCurrentSession();
  if (session.user) redirect(await resolvePostLoginDestination(session.user, { returnTo: next }));
  // A linked person whose staff side idled out (#1092) arrives here from a staff page (or the
  // header's "Staff sign-in" link) with a `next`, still holding a live attendee session. They stay
  // on this page with a notice instead of being sent on to /account. The check reads only this
  // browser's own attendee session and its link, never a typed email, so nothing about staff
  // accounts is revealed; an anonymous visitor never sees the notice.
  // Only for a staff-side target: an attendee or profile destination keeps the old redirect.
  const staffTimedOut = next && !attendeeReturnDestination(next, "") ? await isStaffSessionTimedOutForLinkedAttendee() : false;
  if (!staffTimedOut && (await getCurrentAttendee()).account) redirect(attendeeReturnDestination(next, "/account"));

  const errorMessage = attendeeSignInErrorMessage(typeof error === "string" ? error : undefined);
  const googleAvailable = isGoogleSignInConfigured();
  // One button for both kinds of passkey (#1085); it shows when either side can sign in.
  const [staffPasskeys, attendeePasskeys] = await Promise.all([staffPasskeysConfigured(), attendeePasskeysConfigured()]);
  const passkeysAvailable = staffPasskeys || attendeePasskeys;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span><strong>IMSDA</strong><small>Events</small></span>
        </div>
        <div className="auth-heading">
          <h1>Sign in</h1>
          <p>Use your email and password. Some accounts will be asked for a second step after the password.</p>
        </div>
        {staffTimedOut && <p className="form-notice" role="status">{STAFF_TIMED_OUT_NOTICE}</p>}
        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
        {(googleAvailable || passkeysAvailable) && (
          <>
            {passkeysAvailable && <CombinedPasskeySignInButton next={next} label="Sign in with a passkey" />}
            {googleAvailable && <AttendeeGoogleButton label="Sign in with Google" next={next} />}
            <p className="auth-divider"><span>or</span></p>
          </>
        )}
        <LoginForm unified next={next} />
      </section>
    </main>
  );
}
