import type { Metadata } from "next";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { PasswordResetRequestForm } from "@/components/password-reset-request-form";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

// This page describes what the deployment will actually do with the request, so
// it cannot be decided at build time — a build has no sender address set.
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const linkShownOnPage = !isAccountEmailConfigured();

  return (
    <main className="auth-page">
      <section className="auth-card">
        <BackToEventsLink />
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <p className="eyebrow">Account recovery</p>
          <h1>Reset your password</h1>
          <p>
            {linkShownOnPage
              ? "Enter your staff email. This build has no account email configured, so the reset link appears on this page instead of being sent."
              : "Enter your staff email. If an account exists, a one-time link is on its way — it expires thirty minutes after it is sent."}
          </p>
        </div>
        <PasswordResetRequestForm securityCheck={await securityCheckConfigForPage()} />
      </section>
    </main>
  );
}
