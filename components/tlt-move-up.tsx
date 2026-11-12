"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { moveUpResultMessage, type TltMoveUpPlan } from "@/modules/tlt-directory/domain";
import styles from "./tlt-directory.module.css";

/**
 * The club-year TLT move-up review (#1686): every proposed move is ticked, she can untick, and Confirm asks once more
 * with the number. Presentation only: the server checks access and works out again who may move.
 */
export function TltMoveUp({ plan }: { plan: TltMoveUpPlan }) {
  const router = useRouter();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  const chosen = plan.proposed.filter((row) => !unchecked.has(row.personId));
  const kept = plan.proposed.filter((row) => unchecked.has(row.personId));
  const toggle = (personId: string) => setUnchecked((current) => {
    const next = new Set(current);
    if (next.has(personId)) next.delete(personId); else next.add(personId);
    return next;
  });

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/attendee/area-clubs/tlt-directory/move-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubYear: plan.clubYear, moveIds: chosen.map((row) => row.personId), keepIds: kept.map((row) => row.personId) }),
      });
      const body = await response.json().catch(() => ({})) as { moved?: number; kept?: number; skipped?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? "That could not be done. Try again.");
      setResult(moveUpResultMessage(body.moved ?? 0, body.skipped ?? 0, body.kept ?? 0));
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be done. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p aria-live="polite" className={result ? styles.moveResult : "sr-only"} ref={resultRef} role="status" tabIndex={-1}>{result}</p>

      {plan.proposed.length === 0 ? (
        <p>No TLTs need to move up a year right now.</p>
      ) : (
        <>
          <h2 className={styles.moveSubhead}>Proposed moves ({plan.proposed.length})</h2>
          <ul className={styles.moveList}>
            {plan.proposed.map((row) => {
              const id = `tlt-move-${row.personId}`;
              return (
                <li className={styles.moveRow} key={row.personId}>
                  <input checked={!unchecked.has(row.personId)} id={id} onChange={() => toggle(row.personId)} type="checkbox" />
                  <label className={styles.moveWho} htmlFor={id}>
                    <span>{row.name}</span>
                    <span className={styles.moveClub}>{row.clubName}</span>
                  </label>
                  <span className={styles.moveYears}>Year {row.fromYear} → Year {row.toYear}</span>
                </li>
              );
            })}
          </ul>
          <p>
            <button className="primary-button" onClick={() => { setError(""); setConfirming(true); }} type="button">
              Confirm choices
            </button>
          </p>
        </>
      )}

      <p className={styles.entryNote}>{plan.alreadyThisYear} {plan.alreadyThisYear === 1 ? "TLT is" : "TLTs are"} already set for this club year.</p>

      {plan.lastLevel.length > 0 ? (
        <>
          <h2 className={styles.moveSubhead}>Year 4: last level, not moved ({plan.lastLevel.length})</h2>
          <ul className={styles.moveList}>
            {plan.lastLevel.map((row) => <li className={styles.moveRow} key={row.personId}><span className={styles.moveWho}><span>{row.name}</span><span className={styles.moveClub}>{row.clubName}</span></span></li>)}
          </ul>
        </>
      ) : null}

      {plan.notSet.length > 0 ? (
        <>
          <h2 className={styles.moveSubhead}>No year set yet ({plan.notSet.length})</h2>
          <p className={styles.entryNote}>Set a year for these TLTs in the directory.</p>
          <ul className={styles.moveList}>
            {plan.notSet.map((row) => <li className={styles.moveRow} key={row.personId}><span className={styles.moveWho}><span>{row.name}</span><span className={styles.moveClub}>{row.clubName}</span></span></li>)}
          </ul>
        </>
      ) : null}

      <ConfirmDialog
        busy={busy}
        busyLabel={chosen.length > 0 ? "Moving…" : "Saving…"}
        confirmLabel="Confirm"
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void confirm()}
        open={confirming}
        title={chosen.length > 0 ? "Move TLTs up a year?" : "Confirm your choices?"}
      >
        <p>
          {chosen.length > 0 ? `Move ${chosen.length} up a year` : "Move no one up"}
          {kept.length > 0 ? ` and keep ${kept.length} at their current year` : ""} for {yearLabel(plan.clubYear)}. Anyone who has changed since this page opened is skipped. This is recorded in the log.
        </p>
      </ConfirmDialog>
    </>
  );
}
