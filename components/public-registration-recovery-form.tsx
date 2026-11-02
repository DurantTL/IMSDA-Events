"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { LockKeyhole, MailCheck } from "lucide-react";
import { HoneypotField } from "@/components/honeypot-field";
import { SecurityCheck, type SecurityCheckConfig, type SecurityCheckHandle } from "@/components/security-check/security-check";

export function PublicRegistrationRecoveryForm({
  returnTo,
  securityCheck = null,
}: {
  returnTo?: string;
  securityCheck?: SecurityCheckConfig;
}) {
  // One box per form: each form has its own Submit, and a token is single-use.
  const accessCheck = useRef<SecurityCheckHandle>(null);
  const emailCheck = useRef<SecurityCheckHandle>(null);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState<"access" | "email" | null>(null);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(false);
  const requestIds = useRef<Record<"access" | "email", {
    fingerprint: string;
    id: string;
  } | null>>({ access: null, email: null });

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
    action: "access" | "email",
  ) {
    event.preventDefault();
    const check = action === "access" ? accessCheck : emailCheck;
    if (!check.current?.require(action === "access" ? "Manage my registration" : "Email a private link")) return;
    setBusy(action);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const confirmationCode = action === "access"
      ? String(form.get("confirmationCode") ?? "").trim().toUpperCase()
      : "";
    const fingerprint = [email, confirmationCode, action === "access" ? returnTo ?? "" : ""]
      .join("\u0000");
    if (requestIds.current[action]?.fingerprint !== fingerprint) {
      requestIds.current[action] = {
        fingerprint,
        id: crypto.randomUUID(),
      };
    }
    const clientRequestId = requestIds.current[action]!.id;
    try {
      const response = await fetch("/api/public/registration-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...check.current?.headers() },
        body: JSON.stringify({
          action,
          clientRequestId,
          ...(action === "access"
            ? { confirmationCode, ...(returnTo ? { returnTo } : {}) }
            : {}),
          email,
          website,
        }),
      });
      const result = await response.json();
      check.current?.settle(result);
      if (!response.ok && check.current?.isRejection(result)) return;
      if (!response.ok) {
        requestIds.current[action] = null;
        throw new Error(result.message ?? "The recovery request could not be submitted.");
      }
      if (action === "access") {
        if (typeof result.managePath !== "string") {
          throw new Error("The recovery request could not be completed.");
        }
        requestIds.current.access = null;
        window.location.assign(result.managePath);
      } else {
        requestIds.current.email = null;
        setRequested(true);
      }
    } catch (caught) {
      check.current?.settle();
      setError(caught instanceof Error
        ? caught.message
        : "The recovery request could not be submitted.");
    } finally {
      setBusy(null);
    }
  }

  if (requested) {
    return (
      <div className="auth-form">
        <div className="auth-success" role="status">
          <strong>Check the registration contact inbox</strong>
          <p>
            If those details match an active registration, a new private link is
            on its way. For privacy, this page cannot confirm whether a match was
            found.
          </p>
        </div>
        <Link className="auth-back-link" href="/recover-registration">
          Recover another registration
        </Link>
      </div>
    );
  }

  return (
    <div>
      <form className="auth-form" onSubmit={(event) => submit(event, "access")}>
        <label>
          Confirmation code
          <input
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={80}
            name="confirmationCode"
            required
          />
        </label>
        <label>
          Registration contact email (to use with your code)
          <input
            autoComplete="email"
            maxLength={160}
            name="email"
            required
            type="email"
          />
        </label>
        <HoneypotField onChange={setWebsite} value={website} />
        <SecurityCheck config={securityCheck} action="registration-recovery" handleRef={accessCheck} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={busy !== null} type="submit">
          <LockKeyhole aria-hidden="true" size={17} />
          {busy === "access" ? "Checking…" : "Manage my registration"}
        </button>
      </form>

      <form className="auth-form" onSubmit={(event) => submit(event, "email")}>
        <p className="field-help">
          Lost the code? Request a private link using only the registration contact email.
        </p>
        <label>
          Registration contact email (to get a link by email)
          <input
            autoComplete="email"
            maxLength={160}
            name="email"
            required
            type="email"
          />
        </label>
        <SecurityCheck config={securityCheck} action="registration-recovery" handleRef={emailCheck} />
        <button className="secondary-button full-button" disabled={busy !== null} type="submit">
          <MailCheck aria-hidden="true" size={17} />
          {busy === "email" ? "Requesting…" : "Email a private link"}
        </button>
        <p className="field-help">
          No account is required. If you have one, you can also <Link className="inline-text-link" href="/account/sign-in">sign in</Link>.
        </p>
      </form>
    </div>
  );
}
