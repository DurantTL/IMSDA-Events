import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { AttendeeSignUpForm } from "@/components/attendee-sign-up-form";
import {
  AttendeeGoogleButton,
  attendeeSignInErrorMessage,
} from "@/components/attendee-google-button";
import { isGoogleSignInConfigured } from "@/integrations/oauth/google";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { AccountComingSoonNotice } from "@/components/account-coming-soon-notice";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create an IMSDA Events account to see every registration made with your email address.",
  robots: { index: false, follow: false },
};

export default async function AttendeeSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
  }>;
}) {
  if ((await getCurrentAttendee()).account) redirect("/account");

  const parameters = await searchParams;
  const error = typeof parameters.error === "string"
    ? parameters.error
    : undefined;
  const errorMessage = attendeeSignInErrorMessage(error);
  const googleAvailable = isGoogleSignInConfigured();

  return (
    <main className="auth-page">
      <section className="auth-card">
        <BackToEventsLink />
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <p className="eyebrow">Your registrations</p>
          <h1>Create your account</h1>
          <p>
            One place for every registration you have made, across every event, instead of hunting
            through your inbox for the right link.
          </p>
        </div>
        <AccountComingSoonNotice />
        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
        {googleAvailable && (
          <>
            {/* Above the form on purpose: it is the shorter path, and it needs
              * no password and no emailed code at all. */}
            <AttendeeGoogleButton label="Continue with Google" />
            <p className="auth-divider"><span>or sign up with a password</span></p>
          </>
        )}
        <AttendeeSignUpForm securityCheck={await securityCheckConfigForPage()} />
      </section>
    </main>
  );
}
