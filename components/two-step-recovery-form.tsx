"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OneTimeCodeInput } from "@/components/one-time-code-input";
import styles from "@/components/sign-in-code-form.module.css";

/**
 * Lost-device recovery (#221): "email me a code", then the six-digit code. Nothing is removed until the code is
 * entered. The code field and its patterns are the sign-in code page's. After success it goes to two-step setup
 * for a club role (a new method is needed before club pages) and to the profile's security section otherwise.
 */
export function TwoStepRecoveryForm({
  setupPath,
  profilePath,
  codeAlreadySent,
}: {
  /** The two-step page, carrying the same way back (validated by the page). */
  setupPath: string;
  profilePath: string;
  codeAlreadySent: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"intro" | "code">(codeAlreadySent ? "code" : "intro");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");

  async function send() {
    setSending(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/attendee/two-step-recovery/send", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "We couldn't send a code right now.");
      setStatus(result.message ?? "If this account can be recovered, a code is on its way.");
      // Only a development deployment with no email provider configured ever returns this.
      setDevelopmentCode(typeof result.developmentCode === "string" ? result.developmentCode : "");
      setStage("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send a code right now.");
    } finally {
      setSending(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/attendee/two-step-recovery/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: String(form.get("code") ?? "") }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "That code couldn't be checked.");
      router.replace(result.setupRequired ? setupPath : profilePath);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code couldn't be checked.");
      setBusy(false);
    }
  }

  if (stage === "intro") {
    return (
      <div className={styles.form}>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" type="button" onClick={send} disabled={sending}>
          {sending ? "Sending…" : "Email me a code"}
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <OneTimeCodeInput label="Recovery code" autoFocus disabled={busy} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {status && <p className={styles.status} role="status">{status}</p>}
      {developmentCode && <p className={styles.status} data-development-code={developmentCode}>Development code: {developmentCode}</p>}
      <button className="primary-button full-button" type="submit" disabled={busy}>
        {busy ? "Recovering…" : "Remove my old two-step sign-in"}
      </button>
      <div className={styles.links}>
        <button className={styles.linkButton} type="button" onClick={send} disabled={sending || busy}>
          {sending ? "Sending…" : "Send a new code"}
        </button>
      </div>
    </form>
  );
}
