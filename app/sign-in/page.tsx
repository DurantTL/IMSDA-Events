import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { FormsHelp } from "@/components/forms-help";
import { LoginForm } from "@/components/login-form";
import { getFormsHelpContact } from "@/modules/system-admin/platform-settings";
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
import { safeReturnTo } from "@/lib/return-to";
import { staffReturnTarget } from "@/modules/access/login-routing";
import { attendeeReturnDestination } from "@/modules/attendee-accounts/return-destination";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to IMAdventist.",
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
  searchParams: Promise<{ error?: string | string[]; next?: string | string[]; staff?: string | string[] }>;
}) {
  // Fail closed: if the switch cannot be read, the old staff sign-in is the page.
  let enabled = false;
  try {
    enabled = await isUnifiedSignInEnabled();
  } catch {
    enabled = false;
  }
  if (!enabled) redirect("/login");

  const { error, next: rawNext, staff } = await searchParams;
  // An unsafe `next` (off-site, `//host`, `/api/...`) is dropped here, before the redirects, the form or the buttons see it.
  const next = typeof rawNext === "string" ? safeReturnTo(rawNext, "") || undefined : undefined;
  const session = await getCurrentSession();
  if (session.user) redirect(await resolvePostLoginDestination(session.user, { returnTo: next }));
  // Someone whose staff side idled out (#1092, #1637) arrives here from a staff page, the header's "Staff sign-in"
  // link, or /no-access, still holding a live attendee session (7 days against the staff hour). When the visit is
  // clearly for staff (a staff-side `next`, or the explicit `staff=1` intent) the form shows instead of a bounce to
  // /account, linked or not: there is no other way to a staff sign-in short of signing out. An attendee destination
  // or no hint keeps the old redirect. Neither value becomes a return target beyond `next` itself, so role routing
  // after sign-in is untouched.
  const staffIntent = staff === "1";
  const staffTarget = Boolean(next && staffReturnTarget(next) && !attendeeReturnDestination(next, ""));
  const wantsStaff = staffTarget || staffIntent;
  if (!wantsStaff && (await getCurrentAttendee()).account) redirect(attendeeReturnDestination(next, "/account"));
  // The notice reads only this browser's own attendee session and its link, never a typed email, so it reveals
  // nothing about any address; an anonymous visitor never sees it.
  const staffTimedOut = wantsStaff ? await isStaffSessionTimedOutForLinkedAttendee() : false;

  const errorMessage = attendeeSignInErrorMessage(typeof error === "string" ? error : undefined);
  const googleAvailable = isGoogleSignInConfigured();
  // One button for both kinds of passkey (#1085); it shows when either side can sign in.
  const [staffPasskeys, attendeePasskeys] = await Promise.all([staffPasskeysConfigured(), attendeePasskeysConfigured()]);
  const passkeysAvailable = staffPasskeys || attendeePasskeys;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <BackToEventsLink />
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <h1>Sign in</h1>
          <p>Use your email and password. Some accounts will be asked for a second step after the password.</p>
        </div>
        <FormsHelp contact={await getFormsHelpContact()} />
        {staffTimedOut && <p className="form-notice" role="status">{STAFF_TIMED_OUT_NOTICE}</p>}
        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
        {(googleAvailable || passkeysAvailable) && (
          <>
            {passkeysAvailable && <CombinedPasskeySignInButton next={next} label="Sign in with a passkey" />}
            {googleAvailable && <AttendeeGoogleButton label="Sign in with Google" next={next} />}
            <p className="auth-divider"><span>or</span></p>
          </>
        )}
        <LoginForm unified next={next} securityCheck={await securityCheckConfigForPage()} />
      </section>
    </main>
  );
}
