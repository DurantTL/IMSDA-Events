import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { TwoStepRecoveryForm } from "@/components/two-step-recovery-form";
import { SIGN_IN_CODE_LIFETIME_MINUTES } from "@/modules/attendee-accounts/codes";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import {
  attendeeReturnDestination,
  attendeeSignInPathFor,
  signInCodePathFor,
  twoStepPathFor,
} from "@/modules/attendee-accounts/return-destination";
import { accountHasSecondStepAccess, accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { accountHasTwoStepMethod, hasPendingAttendeeTwoStepRecovery } from "@/modules/attendee-accounts/two-step-recovery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recover two-step sign-in",
  robots: { index: false, follow: false, nocache: true },
};

const PROFILE_SECURITY_PATH = "/profile#profile-security";

/**
 * Lost-device recovery (#221). Only for a signed-in attendee session, so the password (or Google) is already
 * proven; this page adds proof of the account email with an emailed code. It sits outside the account portal
 * layout, like the two-step page, so it is reachable while a club role's second step is still owed. It never
 * sends on GET: "Email me a code" is a separate request.
 */
export default async function TwoStepRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = attendeeReturnDestination(typeof rawNext === "string" ? rawNext : undefined, "");
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account) redirect(attendeeSignInPathFor(next));
  if (via !== "attendee" || !sessionId) redirect("/account");
  // A session that still owes the emailed sign-in code finishes that first (and then has no method to recover).
  if ((await accountNeedsSignInStep(account.id, sessionId)) === "EMAIL_CODE") redirect(signInCodePathFor(next));
  const [hasMethod, hasAccess, codeAlreadySent] = await Promise.all([
    accountHasTwoStepMethod(account.id),
    accountHasSecondStepAccess(account.id),
    hasPendingAttendeeTwoStepRecovery(account.id, sessionId),
  ]);
  const setupPath = hasAccess ? twoStepPathFor(next) : PROFILE_SECURITY_PATH;

  return (
    <main className="public-registration-page public-manage-page account-portal">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
          <AttendeeSignOutButton />
        </div>
      </header>
      <BackToEventsLink placement="page" />
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">Two-step sign-in</p>
          <h1>Recover two-step sign-in</h1>
          <p>Signed in as <strong>{account.verifiedEmail}</strong></p>
        </div>
      </section>
      <div className="account-page-body two-step-body">
        <section className="public-manage-security-note">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Why this is needed</strong>
            <p>
              Club pages show records about young people: names, birthdays, health forms and medical notes.
              Two-step sign-in protects them, so you set it up again on a device you have.
            </p>
          </div>
        </section>
        <section className="public-manage-card two-step-card">
          {hasMethod ? (
            <>
              <p>
                We&apos;ll email a code to <strong>{account.verifiedEmail}</strong>. When you enter it, we&apos;ll remove
                your passkeys and authenticator app (and its recovery codes), sign out your other devices, and you&apos;ll
                set up two-step sign-in again.
              </p>
              <p className="field-help">The code works for {SIGN_IN_CODE_LIFETIME_MINUTES} minutes. Nothing changes until you enter it.</p>
              <TwoStepRecoveryForm setupPath={setupPath} profilePath={PROFILE_SECURITY_PATH} codeAlreadySent={codeAlreadySent} />
            </>
          ) : (
            <>
              <p>There is no passkey or authenticator app on this account to recover.</p>
              <Link className="primary-button" href={setupPath}>Set up two-step sign-in</Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
