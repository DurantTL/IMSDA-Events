"use client";

import { StaffPageHeader } from "@/components/staff-page-header";
import { useState } from "react";
import Link from "next/link";
import {
  SCREENING_DECISION_LINKS,
  TICK_RECORD_NOTE,
  buildRemainingSetup,
  readinessKinds,
  screeningBehavior,
} from "@/modules/system-admin/readiness-copy";
import type { SystemReadiness, ManualReadinessRow } from "@/modules/system-admin/readiness-repository";
import styles from "./system-readiness-workspace.module.css";

const statusLabel = {
  ok: "Checked: OK",
  attention: "Needs attention",
  info: "For information",
  unknown: "Could not check",
} as const;

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function SystemReadinessWorkspace({ initialReadiness }: { initialReadiness: SystemReadiness }) {
  const [readiness, setReadiness] = useState(initialReadiness);
  // The item whose tick or untick form is open, and which one.
  const [open, setOpen] = useState<{ key: string; mode: "tick" | "untick" } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(item: ManualReadinessRow, mode: "tick" | "untick") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/system-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "tick"
            ? { action: "tick", key: item.key, note: text }
            : { action: "untick", key: item.key, reason: text },
        ),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.readiness) {
        throw new Error(result.message ?? "The checklist could not be updated.");
      }
      setReadiness(result.readiness);
      setOpen(null);
      setText("");
      setNotice(mode === "tick" ? "Ticked and recorded in the audit log." : "Unticked and recorded in the audit log.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The checklist could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const { summary } = readiness;
  const remaining = buildRemainingSetup(readiness);

  return (
    <section className="page-stack">
      <StaffPageHeader
        description={(
          <>
            What the app can check by itself, and what a person has to confirm before real club data and the next
            event. Ticking an item only records that someone did the work. It never deploys, migrates, sends or
            unlocks anything.{" "}
            <strong>
              {summary.automaticAttention === 0
                ? "No automatic check needs attention."
                : `${summary.automaticAttention} automatic ${summary.automaticAttention === 1 ? "check needs" : "checks need"} attention.`}{" "}
              {readiness.ticksAvailable
                ? `${summary.manualDone} of ${summary.manualTotal} manual items ticked.`
                : "Manual ticks could not be read."}
            </strong>
          </>
        )}
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <section className="panel" aria-labelledby="readiness-kinds" data-testid="readiness-kinds">
        <div className="section-heading">
          <div>
            <p className="eyebrow">How to read this page</p>
            <h2 id="readiness-kinds">Four different things</h2>
          </div>
        </div>
        <ul className={styles.list}>
          {readinessKinds.map((kind) => (
            <li className={styles.row} key={kind.key} data-kind={kind.key}>
              <p className={styles.title}>{kind.title}</p>
              <p className={styles.detail}>{kind.text}</p>
            </li>
          ))}
        </ul>
        <p className={styles.detail}>Live health readings are on the <Link href="/admin#system-health">System health panel</Link>, not on this page. The <Link href="/admin/system-report">System report</Link> lists every reading in full.</p>
      </section>

      <section className="panel" aria-labelledby="readiness-behavior" data-testid="readiness-behavior">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Implemented behavior</p>
            <h2 id="readiness-behavior">{screeningBehavior.title}</h2>
          </div>
        </div>
        <p className={styles.detail}>{screeningBehavior.intro}</p>
        <ul className={styles.bullets}>
          {screeningBehavior.points.map((point) => <li key={point}>{point}</li>)}
        </ul>
        <p className={styles.meta}>
          Decision:{" "}
          {SCREENING_DECISION_LINKS.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? " · " : ""}
              <a className={styles.decisionLink} href={link.href} rel="noreferrer" target="_blank">{link.label}</a>
            </span>
          ))}
        </p>
        <p className={styles.meta}>{screeningBehavior.evidenceNote}</p>
      </section>

      <section className="panel" aria-labelledby="readiness-remaining" data-testid="readiness-remaining">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Remaining setup</p>
            <h2 id="readiness-remaining">What is still to do</h2>
          </div>
        </div>
        {remaining.needsAttention.length + remaining.unreadable.length + remaining.unticked.length === 0 && !remaining.ticksUnknown ? (
          <p className={styles.detail}>Every automatic check passed and every manual item is ticked. That is a record of evidence, not a live health reading.</p>
        ) : (
          <ul className={styles.bullets}>
            {remaining.needsAttention.map((title) => <li key={`a-${title}`}>Needs attention: {title}</li>)}
            {remaining.unreadable.map((title) => <li key={`u-${title}`}>Could not be checked, so not counted as done: {title}</li>)}
            {remaining.ticksUnknown
              ? <li>Manual ticks could not be read, so which items are still open is not known.</li>
              : remaining.unticked.map((title) => <li key={`m-${title}`}>Not ticked yet: {title}</li>)}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="readiness-automatic">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Checked automatically</p>
            <h2 id="readiness-automatic">What the app can verify</h2>
          </div>
        </div>
        <ul className={styles.list}>
          {readiness.automatic.map((row) => (
            <li className={styles.row} key={row.key}>
              <div className={styles.head}>
                <p className={styles.title}>{row.title}</p>
                <span className={`${styles.badge} ${styles[row.status]}`}>{statusLabel[row.status]}</span>
              </div>
              <p className={styles.detail}>{row.summary}</p>
              {row.people.length > 0 && (
                <ul className={styles.people} aria-label="Accounts to fix">
                  {row.people.map((name) => <li key={name}>{name}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.meta}>Checked {formatDate(readiness.generatedAt)}. Reload the page to check again. A check that could not be read says so; it is never shown as OK.</p>
      </section>

      {readiness.groups.map((group) => (
        <section className="panel" key={group.id} aria-labelledby={`readiness-${group.id}`}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ticked by a person</p>
              <h2 id={`readiness-${group.id}`}>{group.title}</h2>
            </div>
          </div>
          <ul className={styles.list}>
            {group.items.map((item) => {
              const isOpen = open?.key === item.key;
              return (
                <li className={styles.row} key={item.key}>
                  <div className={styles.head}>
                    <p className={styles.title}>{item.title}</p>
                    <span className={styles.headControls}>
                      <span className={`${styles.badge} ${item.tick ? styles.ok : styles.unknown}`}>
                        {!readiness.ticksAvailable ? "Could not read ticks" : item.tick ? "Ticked" : "Not ticked"}
                      </span>
                      {!isOpen && readiness.ticksAvailable ? (
                        <button
                          aria-label={`${item.tick ? "Untick" : "Tick"}: ${item.title}`}
                          className="secondary-button"
                          type="button"
                          onClick={() => {
                            setError("");
                            setNotice("");
                            setText("");
                            setOpen({ key: item.key, mode: item.tick ? "untick" : "tick" });
                          }}
                        >
                          {item.tick ? "Untick" : "Tick"}
                        </button>
                      ) : null}
                    </span>
                  </div>
                  <p className={styles.detail}>{item.detail}</p>
                  <p className={styles.meta}>{item.reference}</p>
                  <p className={styles.meta}>{TICK_RECORD_NOTE}</p>
                  {item.tick && (
                    <p className={styles.meta}>
                      Ticked by {item.tick.tickedByName} on {formatDate(item.tick.tickedAt)}
                      {item.tick.note ? `. Note: ${item.tick.note}` : "."}
                    </p>
                  )}
                  {isOpen ? (
                    <form
                      className={styles.form}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(item, open.mode);
                      }}
                    >
                      <label>
                        {open.mode === "tick" ? "Note (optional). Never paste keys, passwords or addresses." : "Why is this being unticked?"}
                        <textarea
                          maxLength={300}
                          required={open.mode === "untick"}
                          rows={2}
                          value={text}
                          onChange={(event) => setText(event.target.value)}
                        />
                      </label>
                      <div className={styles.actions}>
                        <button className="primary-button" disabled={busy} type="submit">
                          {open.mode === "tick" ? "Confirm tick" : "Confirm untick"}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy}
                          type="button"
                          onClick={() => { setOpen(null); setText(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
