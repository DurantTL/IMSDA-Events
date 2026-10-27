"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { Eye, EyeOff, LogIn, MailCheck, UserPlus } from "lucide-react";
import { OneTimeCodeInput } from "@/components/one-time-code-input";
import {
  allPasswordRequirementsMet,
  PasswordRequirementsChecklist,
} from "@/components/password-requirements-checklist";
import {
  attendeeAuthReturnPathFromHash,
  attendeeSignUpEmailPrefill,
  removeAttendeeAuthFragment,
  takeAttendeeAuthReturnPath,
} from "@/modules/attendee-accounts/sign-up-prefill";

/**
 * Creating an attendee account: details, then the code that arrives by email.
 *
 * The second step is a code rather than a link on purpose. A link in an inbox is
 * spendable by whoever opens it — including the address's real owner clicking to
 * see what an unexpected email was, which would verify somebody else's sign-up
 * onto their registrations. A code has to be typed back into this page.
 *
 * That also shapes what this component says while waiting. It cannot tell the
 * person whether the address already had an account, because the server does not
 * tell it either, so the waiting copy has to be true in both cases.
 */
export function AttendeeSignUpForm({
  initialEmail = "",
}: {
  initialEmail?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const emailRef = useRef<HTMLInputElement>(null);
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  /** Only ever set by a development server with no account email configured. */
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);

  useEffect(() => {
    if (!window.location.hash) return;
    attendeeAuthReturnPathFromHash(window.location.hash);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const prefill = attendeeSignUpEmailPrefill(fragment.get("email") ?? undefined);
    if (!initialEmail && prefill && emailRef.current) {
      emailRef.current.value = prefill;
      setEmail(prefill);
    }
    removeAttendeeAuthFragment();
  }, [initialEmail]);

  // Kept in memory only, so Try again after a restart sends what was typed (#1263). Never stored.
  const pendingRef = useRef<{ kind: "details" | "code"; body: Record<string, unknown> } | null>(null);

  async function send(kind: "details" | "code", body: Record<string, unknown>) {
    if (busy) return;
    pendingRef.current = { kind, body };
    setSiteUpdating(false);
    setBusy(true);
    setError("");
    const email = String(body.email ?? "");
    try {
      const response = await submitJson(kind === "details" ? "/api/attendee/sign-up" : "/api/attendee/verify-email", body);
      if (response.unavailable) {
        setSiteUpdating(unavailableMessage(response));
        setBusy(false);
        return;
      }
      pendingRef.current = null;
      const result = response.body as { message?: string; developmentCode?: string };
      if (kind === "code") {
        if (!response.ok) throw new Error(result.message ?? "That code could not be checked.");
        router.replace(takeAttendeeAuthReturnPath() ?? "/account");
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error(result.message ?? "Unable to create an account.");
      setDevelopmentCode(result.developmentCode ?? null);
      setSentTo(email);
      setBusy(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : kind === "code" ? "That code could not be checked." : "Unable to create an account.");
      setBusy(false);
    }
  }

  function submitDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send("details", { email: String(form.get("email") ?? ""), displayName: form.get("displayName"), password: form.get("password") });
  }

  function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send("code", { code: form.get("code") });
  }

  const retryNotice = siteUpdating
    ? <SubmitRetryNotice busy={busy} onRetry={() => { const pending = pendingRef.current; if (pending) void send(pending.kind, pending.body); }} />
    : null;

  if (sentTo) {
    return (
      <form className="auth-form" onSubmit={submitCode}>
        <div className="auth-success">
          <strong>Check {sentTo}</strong>
          <p>
            If an account can be created for that address, a six-digit code is on its way. Enter it
            here — it only works in this browser, and it expires in twenty minutes.
          </p>
        </div>
        {developmentCode && (
          <div className="local-credentials">
            <strong>Development code</strong>
            <span>{developmentCode}</span>
            <small>Shown only because this server cannot send email</small>
          </div>
        )}
        <OneTimeCodeInput label="Six-digit code" autoFocus disabled={busy} />
        {retryNotice}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" type="submit" disabled={busy}>
          <MailCheck aria-hidden="true" size={17} /> {busy ? "Checking…" : "Verify and continue"}
        </button>
        <button
          className="auth-back-link"
          type="button"
          onClick={() => { setSentTo(null); setDevelopmentCode(null); setError(""); }}
        >
          Use a different address
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={submitDetails}>
      <label>
        Your name
        <input
          name="displayName"
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          defaultValue={initialEmail}
          ref={emailRef}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <p className="field-help">
        Use the address your registrations were made with. That is what connects them to your
        account — nothing else does.
      </p>
      <label>
        Password
        <span className="password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      <PasswordRequirementsChecklist password={password} owner={{ email, displayName }} />
      {retryNotice}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        className="primary-button full-button"
        type="submit"
        disabled={busy || !allPasswordRequirementsMet(password, { email, displayName })}
      >
        <UserPlus aria-hidden="true" size={17} /> {busy ? "Creating…" : "Create account"}
      </button>
      <div className="auth-alternate">
        <strong>Already have an account?</strong>
        <Link className="secondary-button full-button" href="/account/sign-in">
          <LogIn aria-hidden="true" size={17} /> Sign in instead
        </Link>
      </div>
    </form>
  );
}
