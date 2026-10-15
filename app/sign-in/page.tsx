import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";
import { AttendeeGoogleButton, attendeeSignInErrorMessage } from "@/components/attendee-google-button";
import { PasskeySignInButton } from "@/components/passkey-sign-in-button";
import { StaffPasskeySignInButton } from "@/components/staff-passkey-sign-in-button";
import { isGoogleSignInConfigured } from "@/integrations/oauth/google";
import { getCurrentSession } from "@/modules/access/current-session";
import { passkeysConfigured as staffPasskeysConfigured } from "@/modules/access/passkeys";
import { resolvePostLoginDestination } from "@/modules/access/post-login-destination";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
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
  if (!(await isUnifiedSignInEnabled())) redirect("/login");

  const { error, next: rawNext } = await searchParams;
  const next = typeof rawNext === "string" ? rawNext : undefined;
  const session = await getCurrentSession();
  if (session.user) redirect(await resolvePostLoginDestination(session.user, { returnTo: next }));
  if ((await getCurrentAttendee()).account) redirect(attendeeReturnDestination(next, "/account"));

  const errorMessage = attendeeSignInErrorMessage(typeof error === "string" ? error : undefined);
  const googleAvailable = isGoogleSignInConfigured();
  const [staffPasskeys, attendeePasskeys] = await Promise.all([staffPasskeysConfigured(), attendeePasskeysConfigured()]);

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
        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
        {(googleAvailable || staffPasskeys || attendeePasskeys) && (
          <>
            {staffPasskeys && <StaffPasskeySignInButton next={next} label="Sign in with a team passkey" />}
            {attendeePasskeys && <PasskeySignInButton next={next} label="Sign in with an account passkey" />}
            {googleAvailable && <AttendeeGoogleButton label="Sign in with Google" next={next} />}
            <p className="auth-divider"><span>or</span></p>
          </>
        )}
        <LoginForm unified next={next} />
      </section>
    </main>
  );
}
