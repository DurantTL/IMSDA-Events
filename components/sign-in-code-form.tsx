"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OneTimeCodeInput } from "@/components/one-time-code-input";
import styles from "@/components/sign-in-code-form.module.css";

/**
 * Step 2 of 2 for a club role without two-step sign-in (#1410): the six-digit code emailed after the password.
 * "Tired of codes?" continues to two-step setup, but only after the code is accepted: setup is not reachable before.
 */
export function SignInCodeForm({
  next,
  setupPath,
  codeAlreadySent,
}: {
  /** Where to go once the code is accepted (already validated by the page). */
  next: string;
  /** The two-step page, carrying the same way back. */
  setupPath: string;
  codeAlreadySent: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(codeAlreadySent ? "" : "No code has been sent yet. Choose Send a new code.");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const wantsSetup = submitter?.dataset.intent === "setup";
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/attendee/sign-in-code/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: String(form.get("code") ?? "") }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "That code couldn't be checked.");
      router.replace(wantsSetup ? setupPath : next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code couldn't be checked.");
      setBusy(false);
    }
  }

  async function resend() {
    setSending(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/attendee/sign-in-code/send", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "We couldn't send a code right now.");
      setStatus(result.message ?? "We sent a new code.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send a code right now.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <OneTimeCodeInput label="Sign-in code" autoFocus disabled={busy} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {status && <p className={styles.status} role="status">{status}</p>}
      <button className="primary-button full-button" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className={styles.links}>
        <button className={styles.linkButton} type="button" onClick={resend} disabled={sending || busy}>
          {sending ? "Sending…" : "Send a new code"}
        </button>
      </div>
      <div className={styles.notice}>
        <p><strong>Tired of codes?</strong> Set up two-step sign-in and use your fingerprint, face or PIN instead.</p>
        <button className={styles.linkButton} type="submit" data-intent="setup" disabled={busy}>
          Enter your code, then set up two-step sign-in
        </button>
      </div>
    </form>
  );
}
