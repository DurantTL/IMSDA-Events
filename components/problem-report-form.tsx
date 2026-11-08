"use client";

import { useRef, useState } from "react";
import { HoneypotField } from "@/components/honeypot-field";
import { SecurityCheck, type SecurityCheckHandle } from "@/components/security-check/security-check";
import formsHelpStyles from "@/components/forms-help.module.css";
import styles from "@/components/problem-report-form.module.css";
import {
  buildProblemReportDetails,
  PROBLEM_REPORT_EMAIL_MAX,
  PROBLEM_REPORT_FAILED_TEXT,
  PROBLEM_REPORT_MESSAGE_MAX,
  PROBLEM_REPORT_MESSAGE_MIN,
  PROBLEM_REPORT_MESSAGE_REQUIRED_TEXT,
  type BrowserFacts,
  type ProblemReportDetails,
} from "@/modules/support/problem-report-domain";

/**
 * "Report a problem" in the Forms help popup (#1483). Sends what happened, an optional email and, when the box is ticked,
 * a short fixed list of technical details. It never reads a form field, cookie or token (see `buildProblemReportDetails`).
 * The popup asks the server for the Security check site key and the signed-in email only when this section is first opened.
 */

const ENDPOINT = "/api/support/problem-reports";

/** The browser facts for the details, read one by one. Nothing else on the page is touched. */
export function readBrowserFacts(): BrowserFacts {
  const w = window as Window & { turnstile?: unknown; Square?: unknown };
  return {
    href: window.location.pathname,
    userAgent: navigator.userAgent,
    language: navigator.language,
    htmlClassName: document.documentElement.className,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    turnstileScriptPresent: Boolean(document.getElementById("cf-turnstile-api")),
    turnstileReady: Boolean(w.turnstile),
    squareScriptPresent: Boolean(document.querySelector('script[src*="squarecdn.com"]')),
    squareReady: Boolean(w.Square),
    now: new Date(),
  };
}

type Config = { siteKey: string | null; email: string | null };

export function ProblemReportSection() {
  const check = useRef<SecurityCheckHandle>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loadStarted, setLoadStarted] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");

  async function loadConfig() {
    if (loadStarted) return;
    setLoadStarted(true);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      const body = await response.json() as Partial<Config>;
      setConfig({ siteKey: body.siteKey ?? null, email: body.email ?? null });
      if (body.email) setEmail((current) => (emailTouched || current ? current : body.email ?? ""));
    } catch {
      // The form still works: without a site key the server decides (a blocked check never leaves anyone stuck).
      setConfig({ siteKey: null, email: null });
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The popup is a portal: a React submit bubbles to any form the popup's link sits inside (the registration form).
    event.stopPropagation();
    if (busy) return;
    if (message.trim().length < PROBLEM_REPORT_MESSAGE_MIN) {
      setError(PROBLEM_REPORT_MESSAGE_REQUIRED_TEXT);
      return;
    }
    if (!check.current?.require("Send report")) return;
    setBusy(true);
    setError("");
    let details: ProblemReportDetails | null = null;
    if (includeDetails) {
      try {
        details = buildProblemReportDetails(readBrowserFacts());
      } catch {
        details = null;
      }
    }
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...check.current?.headers() },
        body: JSON.stringify({ message, email, details, website }),
      });
      const body = await response.json().catch(() => ({})) as { reference?: string; message?: string };
      check.current?.settle(body);
      if (!response.ok) {
        if (!check.current?.isRejection(body)) setError(body.message ?? PROBLEM_REPORT_FAILED_TEXT);
        return;
      }
      setReference(body.reference ?? "");
      setMessage("");
    } catch {
      check.current?.settle();
      setError(PROBLEM_REPORT_FAILED_TEXT);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={formsHelpStyles.section} onToggle={(event) => { if (event.currentTarget.open) void loadConfig(); }}>
      <summary>Report a problem</summary>
      <div className={formsHelpStyles.body}>
        {reference ? (
          <p className={styles.thanks} role="status">
            Thanks — reference <span className={styles.reference} translate="no">{reference}</span>. The IT team has it.
            {email ? " If we need more, we will write to the email you gave." : ""}
          </p>
        ) : (
          <form className={styles.form} noValidate onSubmit={submit}>
            <label className={styles.label}>
              What happened?
              <textarea
                aria-describedby="problem-report-count"
                maxLength={PROBLEM_REPORT_MESSAGE_MAX}
                name="message"
                onChange={(event) => setMessage(event.target.value)}
                required
                value={message}
              />
              <span className={`${styles.hint} ${styles.count}`} id="problem-report-count">{message.length} of {PROBLEM_REPORT_MESSAGE_MAX}</span>
            </label>
            <label className={styles.label}>
              Email (optional, so we can follow up)
              <input
                autoComplete="email"
                maxLength={PROBLEM_REPORT_EMAIL_MAX}
                name="email"
                onChange={(event) => { setEmailTouched(true); setEmail(event.target.value); }}
                type="email"
                value={email}
              />
            </label>
            <label className={styles.checkRow}>
              <input checked={includeDetails} name="includeDetails" onChange={(event) => setIncludeDetails(event.target.checked)} type="checkbox" />
              <span className={styles.checkText}>
                Include technical details
                <span className={styles.hint}>The page address (nothing after the ?), the time, your browser, language and window size. Never what you typed into a form.</span>
              </span>
            </label>
            <HoneypotField onChange={setWebsite} value={website} />
            <SecurityCheck action="problem-report" config={config?.siteKey ? { siteKey: config.siteKey } : null} handleRef={check} />
            {error && <p className={`form-error ${styles.error}`} role="alert">{error}</p>}
            <button className={`primary-button ${styles.send}`} disabled={busy} type="submit">{busy ? "Sending…" : "Send report"}</button>
          </form>
        )}
      </div>
    </details>
  );
}
