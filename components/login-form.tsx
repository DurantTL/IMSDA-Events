"use client";

import Link from "next/link";
import { AccountComingSoonNotice } from "@/components/account-coming-soon-notice";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { OneTimeCodeInput } from "@/components/one-time-code-input";
import {
  attendeeAuthReturnPathFromHash,
  attendeeSignUpEmailPrefill,
  removeAttendeeAuthFragment,
  takeAttendeeAuthReturnPath,
} from "@/modules/attendee-accounts/sign-up-prefill";

/**
 * A secret shown once, with the copy affordance next to it. Selecting on focus
 * is kept for anyone who prefers the keyboard, and for browsers where the
 * clipboard write is refused.
 */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mfa-copy-field">
      <span className="field-help">{label}</span>
      <div className="password-field">
        <input
          className="copy-field"
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard refused — the field is selectable, which is the
              // fallback rather than an error worth interrupting sign-in for.
            }
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
    </div>
  );
}

type MfaStep = {
  gate: "challenge" | "enrol";
  challengeToken: string;
  /** Present while enrolling: the secret to scan, shown once. */
  offer?: { secret: string; otpauthUri: string };
};

const DEFAULT_DESTINATION = "/overview";

/**
 * `demoCredentials` is passed only by a non-production render, from a server-only module. A production
 * sign-in page must never prefill or display a shared credential.
 *
 * `next` is an unvalidated deep-link target carried in from `/login`'s own
 * query string (#108 queue 1); it is resent with every sign-in request and
 * the server decides — via `resolvePostLoginDestination` — whether it, or
 * role-based routing, decides where sign-in lands.
 *
 * `unified` is the single sign-in page (#554, ADR 0013, slice (c)): the same one form and
 * one submit, posted to `/api/sign-in`, which checks the staff and the attendee credential
 * and says the same thing for every failure. Nothing on this form changes after the
 * email is typed; the staff second step appears only after the password was right.
 */
export function LoginForm({
  demoCredentials,
  next,
  unified = false,
}: {
  demoCredentials?: { email: string; password: string };
  next?: string;
  unified?: boolean;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The post-registration offer links here with the address and return path in the fragment,
    // which keeps them out of server logs. Same handling as the attendee form it replaces.
    if (!unified || !window.location.hash) return;
    attendeeAuthReturnPathFromHash(window.location.hash);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const prefill = attendeeSignUpEmailPrefill(fragment.get("email") ?? undefined);
    if (prefill && emailRef.current) emailRef.current.value = prefill;
    removeAttendeeAuthFragment();
  }, [unified]);
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfa, setMfa] = useState<MfaStep | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  /**
   * Rendered in the browser rather than fetched. The client already holds the
   * secret at this point, so drawing it here adds no exposure, while an
   * endpoint that served it would put the secret in another request.
   */
  const [qrDataUrl, setQrDataUrl] = useState("");

  async function callChallenge(body: Record<string, unknown>) {
    const response = await fetch("/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "That step could not be completed.");
    return result;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(unified ? "/api/sign-in" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to sign in.");

      if (result.mfa?.required) {
        // A correct password has not signed anyone in yet.
        const step: MfaStep = { gate: result.mfa.gate, challengeToken: result.mfa.challengeToken };
        if (step.gate === "enrol") {
          step.offer = await callChallenge({
            challengeToken: step.challengeToken,
            action: "begin-enrollment",
          });
          if (step.offer?.otpauthUri) {
            setQrDataUrl(
              await QRCode.toDataURL(step.offer.otpauthUri, {
                errorCorrectionLevel: "M",
                margin: 2,
                width: 200,
                color: { dark: "#003b5cff", light: "#ffffffff" },
              }).catch(() => ""),
            );
          }
        }
        setMfa(step);
        setBusy(false);
        return;
      }

      const landing: string = result.redirectTo ?? DEFAULT_DESTINATION;
      // Registrants return to where they came from (the account area), staff to their workspace.
      // Not while the emailed sign-in code is owed (#1410): `landing` is already the code page, which carries the way back.
      const attendeeReturn = unified && !result.signInCode?.required && (landing === "/account" || landing.startsWith("/account/")) ? takeAttendeeAuthReturnPath() : null;
      router.replace(attendeeReturn ?? landing);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfa) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await callChallenge({
        challengeToken: mfa.challengeToken,
        action: "verify",
        code: form.get("code"),
        next,
      });
      if (result.recoveryCodes?.length) {
        // Shown once. Signing straight through would lose them.
        setDestination(result.redirectTo ?? DEFAULT_DESTINATION);
        setRecoveryCodes(result.recoveryCodes);
        setBusy(false);
        return;
      }
      router.replace(result.redirectTo ?? DEFAULT_DESTINATION);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code could not be checked.");
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="auth-success">
        <strong>Save your recovery codes</strong>
        <p>
          Each of these signs you in once if you lose your authenticator. Store them somewhere
          other than the device holding the authenticator. They are shown only now.
        </p>
        <ul className="recovery-code-list">
          {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
        </ul>
        <button
          className="primary-button full-button"
          type="button"
          onClick={() => { router.replace(destination); router.refresh(); }}
        >
          I have saved them — continue
        </button>
      </div>
    );
  }

  if (mfa) {
    return (
      <form className="auth-form" onSubmit={submitCode}>
        {mfa.offer && (
          <div className="auth-success">
            <strong>Set up two-factor authentication</strong>
            <p>
              This account administers events, so it needs a second factor. Scan this with an
              authenticator app or password manager, then enter the six-digit code it shows.
            </p>
            {qrDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                className="mfa-qr"
                src={qrDataUrl}
                alt="QR code containing this account's two-factor setup key"
                width={200}
                height={200}
              />
            )}
            <p className="field-help">
              Cannot scan? Enter this key by hand, or paste the setup link into a password manager.
            </p>
            <CopyField label="Setup key" value={mfa.offer.secret} />
            <CopyField label="Setup link" value={mfa.offer.otpauthUri} />
          </div>
        )}
        <OneTimeCodeInput
          label={mfa.offer ? "Code from your authenticator" : "Six-digit code"}
          autoFocus
        />
        {!mfa.offer && (
          <p className="field-help">
            Lost your authenticator? Enter one of your recovery codes instead.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" type="submit" disabled={busy}>
          <ShieldCheck aria-hidden="true" size={17} /> {busy ? "Checking…" : "Verify and sign in"}
        </button>
        <button
          className="auth-back-link"
          type="button"
          onClick={() => { setMfa(null); setError(""); }}
        >
          Start over
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<input name="email" type="email" autoComplete="username" required defaultValue={demoCredentials?.email} ref={emailRef} /></label>
      <label>Password<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required defaultValue={demoCredentials?.password} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      <div className="auth-form-row"><label className="checkbox-label"><input type="checkbox" name="remember" /> Keep email on this device</label>{unified ? <Link href="/account/forgot-password">Forgot password?</Link> : <Link href="/forgot-password">Forgot password?</Link>}</div>
      {unified && <p className="field-help">Team member who cannot sign in? <Link href="/forgot-password">Reset a team password</Link>.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button" type="submit" disabled={busy}><LogIn aria-hidden="true" size={17} /> {busy ? "Signing in…" : "Sign in"}</button>
      {unified && (
        <div className="auth-alternate">
          <strong>New to IMSDA Events?</strong>
          <span>Want one place to manage future registrations? Create an optional account. Registration itself never requires one.</span>
          <AccountComingSoonNotice />
          <Link className="secondary-button full-button" href="/account/sign-up">Create an account</Link>
          <p className="field-help"><Link href="/recover-registration">Manage my registration without an account</Link>.</p>
        </div>
      )}
    </form>
  );
}
