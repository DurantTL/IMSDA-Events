"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Clock, Mail, MoreHorizontal, Send, ShieldCheck, X } from "lucide-react";
import type { EmailTestStatus } from "@/modules/system-admin/system-report/email-tester";
import { clockTime, useLimitExpiry } from "./tester-format";
import styles from "./testers.module.css";

const POLL_MS = 5_000;
const STOP_POLLING_AFTER_MS = 12 * 60 * 1000;

type Phase = "idle" | "sending";
type StepKind = "done" | "fail" | "wait" | "warn";

const stepIcon = { done: Check, fail: X, wait: MoreHorizontal, warn: Clock } as const;
const stepClass: Record<StepKind, string> = { done: styles.stepDone, fail: styles.stepFail, wait: styles.stepWait, warn: styles.stepWarn };

function Step({ kind, title, sub, time }: { kind: StepKind; title: string; sub?: string; time: string }) {
  const Icon = stepIcon[kind];
  return (
    <li className={`${styles.step} ${stepClass[kind]}`}>
      <span className={styles.dot} aria-hidden="true"><Icon size={15} strokeWidth={3} /></span>
      <span className={styles.what}><strong>{title}</strong>{sub && <span>{sub}</span>}</span>
      <time>{time}</time>
    </li>
  );
}

function headChip(status: EmailTestStatus | null, phase: Phase) {
  if (phase === "sending") return { color: "gold", label: "Waiting for notice" };
  if (!status) return { color: "neutral", label: "Not run yet", quiet: true };
  switch (status.state) {
    case "delivered": return { color: "green", label: "OK" };
    case "bounced": case "complained": case "failed": case "suppressed": return { color: "coral", label: "Needs attention" };
    case "no-notice": return { color: "gold", label: "Check soon" };
    case "unavailable": return { color: "neutral", label: "Unavailable", quiet: true };
    default: return { color: "gold", label: "Waiting for notice" };
  }
}

function seconds(from: string, to: string | null) {
  if (!to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
}

function Timeline({ status }: { status: EmailTestStatus }) {
  const provider = status.provider ?? "the email provider";
  const steps: ReactNode[] = [
    <Step key="q" kind="done" title="Queued in the outbox" sub="Same outbox as real mail" time={clockTime(status.queuedAt)} />,
  ];
  if (status.state === "queued") {
    steps.push(<Step key="s" kind="wait" title="Sent to the email provider" sub="Waiting to be picked up." time="—" />);
  } else if (!status.sentAt && status.state === "unavailable") {
    steps.push(<Step key="u" kind="warn" title="Not confirmed as sent" sub={status.reason ?? undefined} time={clockTime(status.outcomeAt)} />);
  } else if (!status.sentAt) {
    steps.push(<Step key="f" kind="fail" title="Could not be sent" sub={status.reason ?? undefined} time={clockTime(status.outcomeAt)} />);
  } else {
    steps.push(<Step key="s" kind="done" title={`Sent to ${provider}`} sub="Same provider and sender as real mail" time={clockTime(status.sentAt)} />);
    switch (status.state) {
      case "delivered": steps.push(<Step key="o" kind="done" title="Delivered" sub={`${provider} says the receiving server accepted it`} time={clockTime(status.outcomeAt)} />); break;
      case "bounced": steps.push(<Step key="o" kind="fail" title="Bounced" sub={status.reason ?? undefined} time={clockTime(status.outcomeAt)} />); break;
      case "complained": steps.push(<Step key="o" kind="fail" title="Marked as spam" sub={status.reason ?? undefined} time={clockTime(status.outcomeAt)} />); break;
      case "failed": steps.push(<Step key="o" kind="fail" title="Failed" sub={status.reason ?? undefined} time={clockTime(status.outcomeAt)} />); break;
      case "suppressed": steps.push(<Step key="o" kind="fail" title="Not sent" sub={status.reason ?? undefined} time={clockTime(status.outcomeAt)} />); break;
      case "no-notice": steps.push(<Step key="o" kind="warn" title="No notice yet" sub={`${provider} has not reported delivered or bounced after 5 minutes`} time={clockTime(status.outcomeAt)} />); break;
      default: steps.push(<Step key="o" kind="wait" title="Delivered, bounced or complained" sub={`Waiting for ${provider}'s notice. Usually under a minute.`} time="—" />);
    }
  }
  return <ol className={styles.timeline} aria-label="What happened to the test email">{steps}</ol>;
}

function Result({ status }: { status: EmailTestStatus }) {
  const ref = <p className={styles.ref}>Test ref {status.ref} · in the audit log</p>;
  switch (status.state) {
    case "delivered": {
      const took = seconds(status.queuedAt, status.outcomeAt);
      return (
        <div className={`${styles.result} ${styles.resultOk}`}>
          <strong>Email works end to end.</strong>
          {status.provider && <p>Sent through {status.provider}.</p>}
          <p>{took === null ? "" : `Took ${took} ${took === 1 ? "second" : "seconds"} from queue to delivery. `}Check the inbox for “IMSDA Events test email”.</p>
          {ref}
        </div>
      );
    }
    case "bounced": case "complained":
      return (
        <div className={`${styles.result} ${styles.resultBad}`}>
          <strong>{status.state === "bounced" ? "The test email bounced." : "The test email was marked as spam."}</strong>
          <p>Sending works, but this address could not take it.</p>
          <ol>
            <li>Check the address for typos and send again.</li>
            <li>Try a different address you own.</li>
            <li>If every address bounces, open Email settings and check the sending domain.</li>
          </ol>
          {ref}
        </div>
      );
    case "suppressed":
      return (
        <div className={`${styles.result} ${styles.resultBad}`}>
          <strong>The test email was not sent.</strong>
          <p>{status.reason}</p>
          <ol>
            <li>Try a different address you own.</li>
            <li>Or re-enable this address under the do-not-send list in Email settings.</li>
          </ol>
          {ref}
        </div>
      );
    case "failed":
      return (
        <div className={`${styles.result} ${styles.resultBad}`}>
          <strong>The test email could not be sent.</strong>
          <p>{status.reason}</p>
          <ol>
            <li>Check the email provider key and the sender address in Email settings.</li>
            <li>Run Test connections, then send again.</li>
          </ol>
          {ref}
        </div>
      );
    case "unavailable":
      return (
        <div className={`${styles.result} ${styles.resultWarn}`}>
          <strong>The test email was not confirmed as sent.</strong>
          <p>{status.reason}</p>
          <ol>
            <li>Check the inbox for “IMSDA Events test email” in case it went out anyway.</li>
            <li>If it does not, try again later. If it keeps happening, run Test connections and check Email settings.</li>
          </ol>
          {ref}
        </div>
      );
    case "no-notice":
      return (
        <div className={`${styles.result} ${styles.resultWarn}`}>
          <strong>Sent, but no delivery notice came back.</strong>
          <p>The email may still have arrived. The problem is usually the notice link, not sending.</p>
          <ol>
            <li>Check the inbox for “IMSDA Events test email”.</li>
            <li>If it arrived, check Email settings → delivery notices: the notice address should be this site.</li>
            <li>If it did not arrive, wait 10 minutes and send again.</li>
          </ol>
          {ref}
        </div>
      );
    default:
      return null;
  }
}

/**
 * The email tester card (#1383). It posts to the guarded route, then polls that one test's status until it is final.
 * Everything it shows comes from fixed states and sentences in the route's answer.
 */
export function EmailTesterCard({ defaultEmail, backupConfigured = false }: { defaultEmail: string; backupConfigured?: boolean }) {
  const [to, setTo] = useState(defaultEmail);
  const [viaBackup, setViaBackup] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<EmailTestStatus | null>(null);
  const [message, setMessage] = useState<{ tone: "bad" | "warn"; title: string; text?: string } | null>(null);
  const [limitedUntil, setLimitedUntil] = useState<string | null>(null);
  useLimitExpiry(limitedUntil, () => setLimitedUntil(null));
  const startedAt = useRef(0);

  const testId = status?.testId ?? null;
  const final = status?.final ?? true;
  useEffect(() => {
    if (!testId || final) return;
    const timer = window.setTimeout(async () => {
      if (Date.now() - startedAt.current > STOP_POLLING_AFTER_MS) return;
      try {
        const response = await fetch(`/api/admin/system-report/email-test?id=${encodeURIComponent(testId)}`, { credentials: "same-origin", cache: "no-store" });
        if (response.ok) {
          const body = await response.json() as { status: EmailTestStatus };
          setStatus(body.status);
          return;
        }
      } catch {
        // A missed poll is not an error; the next one tries again.
      }
      setStatus((current) => (current ? { ...current } : current));
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [testId, final, status]);

  const limited = limitedUntil !== null;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setPhase("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/system-report/email-test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backupConfigured && viaBackup ? { to, backup: true } : { to }),
      });
      const body = await response.json().catch(() => ({})) as { status?: EmailTestStatus; error?: string; message?: string; nextAllowedAt?: string };
      if (response.status === 429 && body.nextAllowedAt) {
        setLimitedUntil(body.nextAllowedAt);
        setMessage({ tone: "warn", title: body.message ?? "Limit reached.", text: `You can send the next one at ${clockTime(body.nextAllowedAt, false)}.${status ? " Your last result is below." : ""}` });
      } else if (!response.ok || !body.status) {
        setMessage({ tone: "bad", title: body.message ?? "The test email could not be started." });
      } else {
        startedAt.current = Date.now();
        setStatus(body.status);
      }
    } catch {
      setMessage({ tone: "bad", title: "The test email could not be started.", text: "Check your connection and try again." });
    } finally {
      setPhase("idle");
    }
  }

  const sending = phase === "sending";
  const chip = headChip(status, phase);
  const headingId = "email-tester-heading";
  return (
    <section className={styles.card} aria-labelledby={headingId} data-testid="email-tester">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true"><Mail size={18} /></span>
        <h3 id={headingId}>Email tester</h3>
        <span className={`status-chip ${chip.color} ${styles.chip} ${chip.quiet ? styles.chipQuiet : ""}`}>{chip.label}</span>
      </div>
      <form className={styles.body} onSubmit={send}>
        <p className={styles.safety}><ShieldCheck aria-hidden="true" size={16} /><span>Sends one test email, only to the address below. No attendee details, never to a list. Each test is logged.</span></p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email-tester-to">Send to</label>
          <div className={styles.sendRow}>
            <input
              id="email-tester-to"
              className={styles.input}
              type="email"
              name="to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              autoComplete="email"
              required
              maxLength={254}
              readOnly={sending}
              aria-describedby="email-tester-help"
            />
            <button className={`primary-button ${styles.button}`} type="submit" disabled={sending || limited || to.trim() === ""} aria-busy={sending}>
              <Send aria-hidden="true" size={16} />{sending ? "Sending…" : "Send test email"}
            </button>
          </div>
          <p className={styles.help} id="email-tester-help">Starts as your own address. One address per test, up to 3 tests an hour.</p>
        </div>
        {backupConfigured && (
          <label className={styles.checkRow} htmlFor="email-tester-backup">
            <input
              id="email-tester-backup"
              className={styles.checkbox}
              type="checkbox"
              aria-describedby="email-tester-backup-help"
              checked={viaBackup}
              onChange={(event) => setViaBackup(event.target.checked)}
              disabled={sending}
            />
            <span>Send through the backup (Resend)</span>
          </label>
        )}
        {backupConfigured && (
          <p className={styles.help} id="email-tester-backup-help">This test skips Amazon SES and goes straight to Resend.</p>
        )}
        <div aria-live="polite">
          {message && (
            <div className={`${styles.result} ${message.tone === "bad" ? styles.resultBad : styles.resultWarn}`} role="status">
              <strong>{message.title}</strong>
              {message.text && <p>{message.text}</p>}
            </div>
          )}
        </div>
        {status && <Timeline status={status} />}
        {status && <div aria-live="polite"><Result status={status} /></div>}
        {!status && !message && <p className={styles.meta}>No test sent yet.</p>}
      </form>
    </section>
  );
}
