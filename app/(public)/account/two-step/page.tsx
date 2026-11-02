import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import { BackToEventsLink } from "@/components/back-to-events-link";
import { BrandLink } from "@/components/brand-link";
import { PasskeyUnlockButton } from "@/components/passkey-unlock-button";
import { RosterUnlockForm } from "@/components/roster-unlock-form";
import { TwoStepGate } from "@/components/two-step-setup";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { getAttendeeMfaStatus } from "@/modules/attendee-accounts/mfa-service";
import { getPasskeySettings } from "@/modules/attendee-accounts/passkeys";
import { attendeeReturnDestination, attendeeSignInPathFor, signInCodePathFor } from "@/modules/attendee-accounts/return-destination";
import { accountNeedsSecondStep, accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { listDirectedClubs } from "@/modules/organizations/director-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm it's you",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The second step for club and medical pages, for anyone with a club role (decision 2026-09-23, #1410). They
 * confirm with a code or passkey, or set one up first. Their own registrations, profile and payments open
 * without it, but not on a password alone: a club role without two-step sign-in enters an emailed code first,
 * and setup here is not reachable until that code has been entered.
 */
export default async function TwoStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  // The page that sent them here (#568). Validated wherever it is followed;
  // the challenge itself (code, passkey, rate limits) is unchanged.
  const next = attendeeReturnDestination(typeof rawNext === "string" ? rawNext : undefined, "");
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account) redirect(attendeeSignInPathFor(next));
  if (via !== "attendee") redirect("/account");
  // Setup must not be reachable before the emailed code (#1410): otherwise a password alone could enrol a device.
  if ((await accountNeedsSignInStep(account.id, sessionId)) === "EMAIL_CODE") redirect(signInCodePathFor(next));
  const gate = await accountNeedsSecondStep(account.id, sessionId);
  if (gate === "OK") redirect(next || "/account");
  const [mfaStatus, passkeySettings] = await Promise.all([
    getAttendeeMfaStatus(account.id),
    getPasskeySettings(account.id, sessionId),
  ]);
  const hasPasskey = passkeySettings.available && passkeySettings.passkeys.length > 0;

  const header = (
    <>
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
          <AttendeeSignOutButton />
        </div>
      </header>
      <BackToEventsLink placement="page" />
    </>
  );

  if (gate === "VERIFY") {
    return (
      <main className="public-registration-page public-manage-page account-portal">
        {header}
        <section className="public-registration-hero public-manage-hero account-page-hero">
          <div>
            <p className="public-registration-eyebrow">Two-step sign-in</p>
            <h1>Confirm it&apos;s you</h1>
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
                Two-step sign-in makes sure only you can open them, even if someone learns your password.
              </p>
            </div>
          </section>
          <section className="public-manage-card two-step-card">
            {hasPasskey && <PasskeyUnlockButton label="Continue with a passkey" />}
            {mfaStatus.status === "ACTIVE" && (
              <>
                <p className="field-help">{hasPasskey ? "Or enter" : "Enter"} the six-digit code from your authenticator app, or a recovery code.</p>
                <RosterUnlockForm label="Continue" />
              </>
            )}
          </section>
        </div>
      </main>
    );
  }

  // The club the person was opening, by name, when the way back is one of their club pages.
  const clubId = /^\/account\/clubs\/([^/?#]+)/.exec(next)?.[1];
  const clubName = clubId
    ? (await listDirectedClubs(account.id)).find((club) => club.organizationId === clubId)?.name ?? null
    : null;

  return (
    <main className="public-registration-page public-manage-page account-portal">
      {header}
      <TwoStepGate
        email={account.verifiedEmail}
        clubName={clubName}
        mfaStatus={mfaStatus}
        passkeySettings={passkeySettings}
        next={next || undefined}
      />
    </main>
  );
}
