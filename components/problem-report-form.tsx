"use client";

import { useEffect, useRef, useState } from "react";
import { clearRecentErrorIds, readRecentErrorIds } from "@/lib/recent-error-ids";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { EmailInput, emailBlockingMessage } from "@/components/email-input";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { HoneypotField } from "@/components/honeypot-field";
import { SecurityCheck, securityCheckLoadFailed, type SecurityCheckHandle } from "@/components/security-check/security-check";
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
  return {
    href: window.location.pathname,
    userAgent: navigator.userAgent,
    language: navigator.language,
    htmlClassName: document.documentElement.className,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    securityCheckLoadFailed: securityCheckLoadFailed(),
    squareLoadFailed: Boolean(document.querySelector('[data-testid="square-load-failed"]')),
    now: new Date(),
    errorIds: readRecentErrorIds(),
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
  const [messageError, setMessageError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  // Which field to focus once its error has rendered; `n` makes a repeat of the same field fire again.
  const [focusRequest, setFocusRequest] = useState<{ field: "message" | "email"; n: number } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.field === "message" ? messageRef.current : document.getElementById("problem-report-email"))?.focus();
  }, [focusRequest]);
  const focusField = (field: "message" | "email") => setFocusRequest((current) => ({ field, n: (current?.n ?? 0) + 1 }));
  const [reference, setReference] = useState("");
  const [copySent, setCopySent] = useState(false);
  // B6: a typed, unsent report is not lost by leaving the page. The email is prefilled, so only the description counts.
  useUnsavedChangesGuard(message.trim() !== "" && reference === "", "You have typed a problem report that has not been sent. Leave this page and discard it?");

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
    setAttempted(true);
    setError("");
    setMessageError("");
    setEmailError("");
    if (message.trim().length < PROBLEM_REPORT_MESSAGE_MIN) {
      setMessageError(PROBLEM_REPORT_MESSAGE_REQUIRED_TEXT);
      focusField("message");
      return;
    }
    if (email.trim() && emailBlockingMessage("Email", email)) {
      focusField("email");
      return;
    }
    if (!check.current?.require("Send report")) return;
    setBusy(true);
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
      const body = await response.json().catch(() => ({})) as { reference?: string; message?: string; field?: string; copy?: string };
      check.current?.settle(body);
      if (!response.ok) {
        if (check.current?.isRejection(body)) return;
        const text = body.message ?? PROBLEM_REPORT_FAILED_TEXT;
        // A field problem lands next to its field.
        if (body.field === "message") { setMessageError(text); focusField("message"); }
        else if (body.field === "email") { setEmailError(text); focusField("email"); }
        else setError(text);
        return;
      }
      if (details) clearRecentErrorIds();
      setReference(body.reference ?? "");
      setCopySent(body.copy === "sent");
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
            {copySent ? " We emailed a copy to the email you gave. If we need more, we will write there." : email ? " If we need more, we will write to the email you gave." : ""}
          </p>
        ) : (
          <form className={styles.form} noValidate onSubmit={submit}>
            <div className={styles.label}>
              <label htmlFor="problem-report-message">What happened?</label>
              <textarea
                {...fieldErrorProps("problem-report-message-error", messageError, "problem-report-count")}
                id="problem-report-message"
                maxLength={PROBLEM_REPORT_MESSAGE_MAX}
                name="message"
                onChange={(event) => { setMessage(event.target.value); setMessageError(""); }}
                ref={messageRef}
                required
                value={message}
              />
              <FieldError id="problem-report-message-error">{messageError}</FieldError>
              <span className={`${styles.hint} ${styles.count}`} id="problem-report-count">{message.length} of {PROBLEM_REPORT_MESSAGE_MAX}</span>
            </div>
            <div className={styles.label}>
              <label htmlFor="problem-report-email">Email (optional, so we can follow up)</label>
              <EmailInput
                error={emailError}
                id="problem-report-email"
                label="Email"
                maxLength={PROBLEM_REPORT_EMAIL_MAX}
                name="email"
                onValueChange={(value) => { setEmailTouched(true); setEmail(value); setEmailError(""); }}
                showNow={attempted}
                value={email}
              />
            </div>
            <label className={styles.checkRow}>
              <input checked={includeDetails} name="includeDetails" onChange={(event) => setIncludeDetails(event.target.checked)} type="checkbox" />
              <span className={styles.checkText}>
                Include technical details
                <span className={styles.hint}>The page address (nothing after the ?), the time, your browser, language and window size, and the ids of any recent page errors (no messages). Never what you typed into a form.</span>
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
