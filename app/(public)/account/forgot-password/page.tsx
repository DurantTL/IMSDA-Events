import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { AttendeePasswordResetForm } from "@/components/attendee-password-reset-form";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Reset the password on your IMSDA Events account.",
  robots: { index: false, follow: false },
};

export default async function AttendeeForgotPasswordPage() {
  if ((await getCurrentAttendee()).account) redirect("/account");

  return (
    <main className="auth-page">
      <section className="auth-card">
        <BackToEventsLink />
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <p className="eyebrow">Your registrations</p>
          <h1>Reset your password</h1>
          <p>
            We will email a six-digit code to the address on your account. Enter it here with a new
            password.
          </p>
        </div>
        <AttendeePasswordResetForm securityCheck={await securityCheckConfigForPage()} />
      </section>
    </main>
  );
}
