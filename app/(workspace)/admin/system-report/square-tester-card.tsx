"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CreditCard, Send, ShieldCheck } from "lucide-react";
import type { SquareCheckKey, SquareCheckRow, SquareCheckState, SquareTestResult } from "@/modules/system-admin/system-report/square-tester";
import { clockTime, useLimitExpiry } from "./tester-format";
import styles from "./testers.module.css";

const CHECKS: Record<SquareCheckKey, { name: string; description: string }> = {
  account: { name: "Account", description: "The access token works and the environment is the one expected" },
  location: { name: "Location", description: "Active and can take card payments" },
  notices: { name: "Notice setup", description: "A Square notice subscription points to this site with the events the app needs" },
  test: { name: "Test notice", description: "Square sends its test notice; we confirm it arrived and the signature is ours" },
  link: { name: "Pay on Square link", description: "A $1 link is made and deleted at once, never paid" },
};
const ORDER: SquareCheckKey[] = ["account", "location", "notices", "test", "link"];

const STATE_CHIP: Record<SquareCheckState | "running", { color: string; label: string; quiet?: boolean }> = {
  ok: { color: "green", label: "OK" },
  attention: { color: "coral", label: "Needs attention" },
  watch: { color: "gold", label: "Check soon" },
  unavailable: { color: "neutral", label: "Unavailable", quiet: true },
  skipped: { color: "neutral", label: "Skipped", quiet: true },
  idle: { color: "neutral", label: "Not run yet", quiet: true },
  running: { color: "gold", label: "Checking" },
};
const ROW_CLASS: Partial<Record<SquareCheckState, string>> = { attention: styles.isAttention, watch: styles.isWatch, unavailable: styles.isQuiet, skipped: styles.isQuiet };

function Chip({ kind }: { kind: SquareCheckState | "running" }) {
  const chip = STATE_CHIP[kind];
  return <span className={`status-chip ${chip.color} ${styles.chip} ${chip.quiet ? styles.chipQuiet : ""}`}>{chip.label}</span>;
}

function Row({ check, row, running }: { check: SquareCheckKey; row: SquareCheckRow | null; running: boolean }) {
  const copy = CHECKS[check];
  const kind: SquareCheckState | "running" = running ? "running" : row?.state ?? "idle";
  const text = running ? "Waiting for Square…" : row ? row.text : "Not run yet";
  return (
    <li className={`${styles.row} ${(!running && row && ROW_CLASS[row.state]) || ""}`} data-check={check} data-state={kind}>
      <div className={styles.rowName}><strong>{copy.name}</strong><span>{copy.description}</span></div>
      <div className={styles.rowResult}>
        <Chip kind={kind} />
        <span>{text}{!running && row?.at && row.state !== "skipped" ? ` At ${clockTime(row.at)}.` : ""}</span>
        {!running && row?.next && <span className={styles.next}><b>Next:</b> {row.next}</span>}
        {!running && row?.fixHref && <Link className={styles.fix} href={row.fixHref}>{row.fixLabel ?? "Open"}<ArrowRight aria-hidden="true" size={14} /></Link>}
      </div>
    </li>
  );
}

/**
 * The Square tester card (#1383). One POST runs the checks in order and returns every row; nothing here can charge or
 * refund (the server only sends the allow-listed requests). The $1 link check is off until ticked, per run.
 */
export function SquareTesterCard() {
  const [includeLink, setIncludeLink] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SquareTestResult | null>(null);
  const [message, setMessage] = useState<{ tone: "bad" | "warn"; title: string; text?: string } | null>(null);
  const [limitedUntil, setLimitedUntil] = useState<string | null>(null);
  useLimitExpiry(limitedUntil, () => setLimitedUntil(null));

  const limited = limitedUntil !== null;

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/system-report/square-test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeLink }),
      });
      const body = await response.json().catch(() => ({})) as { result?: SquareTestResult; message?: string; nextAllowedAt?: string };
      if (response.status === 429 && body.nextAllowedAt) {
        setLimitedUntil(body.nextAllowedAt);
        setMessage({ tone: "warn", title: body.message ?? "Limit reached.", text: `You can run it again at ${clockTime(body.nextAllowedAt, false)}.${result ? " Your last result is below." : ""}` });
      } else if (!response.ok || !body.result) {
        setMessage({ tone: "bad", title: body.message ?? "The Square checks could not be run." });
      } else {
        setResult(body.result);
      }
    } catch {
      setMessage({ tone: "bad", title: "The Square checks could not be run.", text: "Check your connection and try again." });
    } finally {
      setRunning(false);
    }
  }

  const rowOf = (key: SquareCheckKey) => result?.rows.find((row) => row.key === key) ?? null;
  const head: SquareCheckState | "running" = running ? "running" : result ? (result.overall === "ok" ? "ok" : result.overall === "watch" ? "watch" : result.overall === "attention" ? "attention" : "unavailable") : "idle";
  const headingId = "square-tester-heading";
  return (
    <section className={styles.card} aria-labelledby={headingId} data-testid="square-tester">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true"><CreditCard size={18} /></span>
        <h3 id={headingId}>Square tester</h3>
        <Chip kind={head} />
      </div>
      <div className={styles.body}>
        <p className={styles.safety}><ShieldCheck aria-hidden="true" size={16} /><span>Never charges a card and never refunds. Shows no customer or card details. Each test is logged.</span></p>
        <div aria-live="polite">
          {message && (
            <div className={`${styles.result} ${message.tone === "bad" ? styles.resultBad : styles.resultWarn}`} role="status">
              <strong>{message.title}</strong>
              {message.text && <p>{message.text}</p>}
            </div>
          )}
        </div>
        <ul className={styles.rows} aria-label="Square checks" aria-busy={running}>
          {ORDER.map((key) => (
            <Row
              key={key}
              check={key}
              running={running && (key !== "link" || includeLink)}
              row={key === "link" && result && !result.linkTested ? null : rowOf(key)}
            />
          ))}
        </ul>
        <label className={styles.check} htmlFor="square-tester-link">
          <input id="square-tester-link" type="checkbox" checked={includeLink} onChange={(event) => setIncludeLink(event.target.checked)} disabled={running} />
          <span><b>Also test a Pay on Square link</b><small>Makes a $1 link and deletes it straight away. It is never paid.</small></span>
        </label>
        <div className={styles.actions}>
          <button className={`primary-button ${styles.button}`} type="button" onClick={run} disabled={running || limited} aria-busy={running}>
            <Send aria-hidden="true" size={16} />{running ? "Checking Square…" : result ? "Run Square checks again" : "Run Square checks"}
          </button>
        </div>
        <p className={styles.meta}>{result ? `Last run ${clockTime(result.ranAt, false)} · ref ${result.ref}` : "Up to 5 runs an hour."}</p>
      </div>
    </section>
  );
}
