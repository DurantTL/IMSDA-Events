import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { SignInCodeForm } from "@/components/sign-in-code-form";
import styles from "@/components/sign-in-code-form.module.css";
import { SIGN_IN_CODE_LIFETIME_MINUTES } from "@/modules/attendee-accounts/codes";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import {
  attendeeReturnDestination,
  attendeeSignInPathFor,
  twoStepPathFor,
} from "@/modules/attendee-accounts/return-destination";
import { hasPendingAttendeeSignInCode } from "@/modules/attendee-accounts/sign-in-code-service";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check your email",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Step 2 of 2 of sign-in for a club role that has not set up two-step sign-in (#1410). It sits outside the
 * account portal layout, so it is reachable while the code is owed, and it never sends on GET: the code was
 * sent by the sign-in itself, and "Send a new code" is a separate request.
 */
export default async function SignInCodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = attendeeReturnDestination(typeof rawNext === "string" ? rawNext : undefined, "");
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account) redirect(attendeeSignInPathFor(next));
  if (via !== "attendee" || !sessionId) redirect("/account");
  const step = await accountNeedsSignInStep(account.id, sessionId);
  if (step === "OK") redirect(next || "/account");
  if (step === "VERIFY") redirect(twoStepPathFor(next));
  const codeAlreadySent = await hasPendingAttendeeSignInCode(account.id, sessionId);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <BackToEventsLink />
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <span className={styles.icon}><Mail size={22} aria-hidden="true" /></span>
          <p className="eyebrow">Step 2 of 2</p>
          <h1>Check your email</h1>
          <p>
            {codeAlreadySent
              ? <>We sent a six-digit code to <strong>{account.verifiedEmail}</strong>. It works for {SIGN_IN_CODE_LIFETIME_MINUTES} minutes.</>
              : <>To finish signing in, we&apos;ll email a six-digit code to <strong>{account.verifiedEmail}</strong>.</>}
          </p>
        </div>
        <SignInCodeForm
          next={next || "/account"}
          setupPath={twoStepPathFor(next)}
          codeAlreadySent={codeAlreadySent}
        />
        <div className={styles.links}>
          <AttendeeSignOutButton className={styles.linkButton} label="Use a different email" />
        </div>
      </section>
    </main>
  );
}
