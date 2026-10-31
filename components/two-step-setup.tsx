"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Fingerprint, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { MfaManager, type MfaStatus } from "@/components/mfa-manager";
import { PasskeyManager } from "@/components/passkey-manager";
import styles from "@/components/two-step-setup.module.css";
import type { PasskeySummary } from "@/modules/attendee-accounts/passkeys";

type Method = "passkey" | "authenticator";

/**
 * The "Two-step sign-in is on" screen (#1410). Continues to the page the person wanted (a club page, with its
 * name when known), otherwise the security page.
 */
export function TwoStepFinished({
  next,
  clubName,
  method = "authenticator",
}: {
  next?: string;
  clubName?: string | null;
  method?: Method;
}) {
  const used = method === "passkey" ? "your passkey" : "your authenticator app";
  return (
    <section className={`public-manage-card two-step-card auth-success ${styles.finish}`}>
      <Check aria-hidden="true" size={22} />
      <p>
        {clubName ? <>{clubName} is open. </> : null}
        Next time you sign in, you&apos;ll use {used} instead of an emailed code.
      </p>
      <div className="two-step-finish-actions">
        <Link className="primary-button" href={next ?? "/account/profile?twoStep=on"}>
          {clubName && next ? `Open ${clubName}` : next ? "Continue" : "Continue to Sign-in & security"}
        </Link>
      </div>
    </section>
  );
}

/**
 * The gate a club role meets when it opens club pages without two-step sign-in (#1410): why it is needed, then
 * how to set it up (a passkey first, as the easiest, or an authenticator app), then a finish screen that sends
 * them back where they were going. The setup itself is the existing authenticator and passkey components.
 */
export function TwoStepGate({
  email,
  clubName,
  mfaStatus,
  passkeySettings,
  next,
}: {
  email: string;
  /** The club the person was opening, when the way back is a club page. */
  clubName: string | null;
  /** A validated page to continue to; without one, setup ends on the security page. */
  next?: string;
  mfaStatus: MfaStatus;
  passkeySettings: {
    available: boolean;
    hasAuthenticator: boolean;
    passkeys: PasskeySummary[];
  };
}) {
  const [step, setStep] = useState<"intro" | "choose" | "setup" | "done">("intro");
  const [choice, setChoice] = useState<Method>(passkeySettings.available ? "passkey" : "authenticator");
  const [method, setMethod] = useState<Method>("authenticator");
  const [doneWith, setDoneWith] = useState<Method>("authenticator");

  const heading = step === "intro"
    ? "Turn on two-step sign-in to open club pages"
    : step === "done"
      ? "Two-step sign-in is on"
      : "Choose how to confirm it’s you";

  function startSetup() {
    if (passkeySettings.available) {
      setStep("choose");
      return;
    }
    // Passkeys aren't switched on here: setup opens on the authenticator.
    setMethod("authenticator");
    setStep("setup");
  }

  function finish(used: Method) {
    setDoneWith(used);
    setStep("done");
  }

  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">
            {step === "intro" ? <><Lock size={14} aria-hidden="true" /> {clubName ?? "Two-step sign-in"}</> : (clubName ?? "Two-step sign-in")}
          </p>
          <h1>{heading}</h1>
          <p>Signed in as <strong>{email}</strong></p>
        </div>
      </section>
      <div className="account-page-body two-step-body">
        {step === "intro" && (
          <>
            <section className={styles.why} aria-labelledby="two-step-why">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <strong id="two-step-why">Why this is needed</strong>
                <p>
                  Club pages show records about young people: names, birthdays, health forms and medical notes.
                  Two-step sign-in makes sure only you can open them, even if someone learns your password.
                </p>
              </div>
            </section>
            <section className="public-manage-card two-step-card">
              <ul className={styles.checks}>
                <li><Check size={16} aria-hidden="true" /> Takes about two minutes</li>
                <li><Check size={16} aria-hidden="true" /> Use your phone&apos;s fingerprint, face or PIN, or an authenticator app</li>
                <li><Check size={16} aria-hidden="true" /> After this, you skip the emailed sign-in code</li>
              </ul>
              <button className={`primary-button ${styles.primary}`} type="button" onClick={startSetup}>
                Set up two-step sign-in
              </button>
              <Link className={styles.skip} href="/account/registrations">Not now, go to my registrations</Link>
              <p className={styles.muted}>Your registrations, profile and payments open without it.</p>
            </section>
          </>
        )}

        {step === "choose" && (
          <section className="public-manage-card two-step-card">
            <fieldset className={styles.options}>
              <legend className="sr-only">How would you like to confirm it&apos;s you?</legend>
              <label className={`${styles.option} ${choice === "passkey" ? styles.selected : ""}`}>
                <input type="radio" name="method" value="passkey" checked={choice === "passkey"} onChange={() => setChoice("passkey")} />
                <Fingerprint size={22} aria-hidden="true" />
                <span>
                  <strong>This phone or computer <em className={styles.chip}>Easiest</em></strong>
                  <small>Use your fingerprint, face or PIN. Called a passkey.</small>
                </span>
              </label>
              <label className={`${styles.option} ${choice === "authenticator" ? styles.selected : ""}`}>
                <input type="radio" name="method" value="authenticator" checked={choice === "authenticator"} onChange={() => setChoice("authenticator")} />
                <Smartphone size={22} aria-hidden="true" />
                <span>
                  <strong>An authenticator app</strong>
                  <small>Google Authenticator, Microsoft Authenticator or similar.</small>
                </span>
              </label>
            </fieldset>
            <button className={`primary-button ${styles.primary}`} type="button" onClick={() => { setMethod(choice); setStep("setup"); }}>
              Continue
            </button>
            <p className={styles.muted}>One is enough. You can add a backup later.</p>
          </section>
        )}

        {step === "setup" && (
          <>
            {method === "authenticator" ? (
              <MfaManager
                attendee
                endpoint="/api/attendee/mfa"
                initialStatus={mfaStatus}
                otherMethodAvailable={passkeySettings.available && passkeySettings.passkeys.length > 0}
                onEnrolled={() => finish("authenticator")}
                heading="An authenticator app"
                eyebrow="Two-step sign-in"
                hideIntro
              />
            ) : (
              <PasskeyManager
                available={passkeySettings.available}
                hasAuthenticator={passkeySettings.hasAuthenticator}
                initialPasskeys={passkeySettings.passkeys}
                needsConfirmation={false}
                onAdded={() => finish("passkey")}
                heading="This phone or computer"
                eyebrow="Two-step sign-in"
                hideIntro
              />
            )}
            {passkeySettings.available && (
              <button className={styles.skip} type="button" onClick={() => setStep("choose")}>
                Choose a different way
              </button>
            )}
            <p className="field-help two-step-setup-hint">One is enough. You can add a backup later.</p>
          </>
        )}

        {step === "done" && <TwoStepFinished next={next} clubName={clubName} method={doneWith} />}
      </div>
    </>
  );
}
