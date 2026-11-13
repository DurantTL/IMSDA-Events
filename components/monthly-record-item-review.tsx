"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  ITEM_NOTE_MAX_LENGTH,
  itemLabel,
  outcomeLabel,
  type ItemDecision,
  type MonthlyRecordItemOutcome,
} from "@/modules/club-reports/area-review-domain";
import type { PointItemKey } from "@/modules/club-reports/domain";
import styles from "./monthly-record-item-review.module.css";

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * One item's current decision from the Area Coordinator (#1701), read-only: OK or Returned with the note. Staff also see
 * who decided and when (`reviewedByName` is only ever set for staff).
 */
export function ItemDecisionView({ decision }: { decision: ItemDecision }) {
  const returned = decision.outcome === "RETURNED";
  return (
    <div className={styles.decision} data-item-decision={decision.itemKey} data-outcome={decision.outcome}>
      <div className={styles.decisionRow}>
        <span className={`status-chip ${returned ? "gold" : "green"}`}>{outcomeLabel(decision.outcome)}</span>
        {decision.reviewedByName !== undefined && (
          <span className={styles.meta}>{`${decision.reviewedByName ? `by ${decision.reviewedByName}, ` : ""}${shortDate(decision.reviewedAt)}`}</span>
        )}
      </div>
      {decision.note && <p className={styles.note}>{decision.note}</p>}
    </div>
  );
}

/**
 * The Area Coordinator's OK / Return controls for one item (#1701). OK saves at once; Return asks for a note first. The
 * route checks the coordinator's access and the conference switch again.
 */
export function AreaItemReviewControls({
  organizationId,
  month,
  itemKey,
  decision,
}: {
  organizationId: string;
  month: string;
  itemKey: PointItemKey;
  decision: ItemDecision | undefined;
}) {
  const router = useRouter();
  const noteId = useId();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const label = itemLabel(itemKey);

  async function send(outcome: MonthlyRecordItemOutcome, noteText: string) {
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/attendee/area-clubs/monthly-records/item-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, month, itemKey, outcome, ...(noteText ? { note: noteText } : {}) }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "That could not be saved.");
        return;
      }
      setSaved(outcome === "OK" ? `${label} marked OK.` : `${label} returned to the club.`);
      setReturning(false);
      setNote("");
      router.refresh();
    } catch {
      setError("That could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.controls} data-item-review-controls={itemKey}>
      {decision && <ItemDecisionView decision={decision} />}
      {!returning && (
        <div className={styles.buttons}>
          <button
            aria-pressed={decision?.outcome === "OK"}
            className={decision?.outcome === "OK" ? "primary-button" : "secondary-button"}
            disabled={saving}
            onClick={() => void send("OK", "")}
            type="button"
          >
            OK<span className="sr-only">{`: ${label}`}</span>
          </button>
          <button
            aria-pressed={decision?.outcome === "RETURNED"}
            className={decision?.outcome === "RETURNED" ? "primary-button" : "secondary-button"}
            disabled={saving}
            onClick={() => { setReturning(true); setNote(decision?.outcome === "RETURNED" ? decision.note : ""); setSaved(""); }}
            type="button"
          >
            Return<span className="sr-only">{`: ${label}`}</span>
          </button>
        </div>
      )}
      {returning && (
        <div className={styles.noteField}>
          <label htmlFor={noteId}>{`Note for the club about ${label} (required)`}</label>
          <textarea id={noteId} maxLength={ITEM_NOTE_MAX_LENGTH} onChange={(event) => setNote(event.target.value)} value={note} />
          <div className={styles.buttons}>
            <button className="primary-button" disabled={saving || note.trim().length === 0} onClick={() => void send("RETURNED", note)} type="button">
              {saving ? "Saving…" : "Return to the club"}
            </button>
            <button className="secondary-button" disabled={saving} onClick={() => { setReturning(false); setError(""); }} type="button">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {saved && <p className={styles.meta} role="status">{saved}</p>}
    </div>
  );
}

/** What the director reads above the record when items were returned (#1701). */
export function ReturnedItemsNotice({ text }: { text: string }) {
  return <div className={`inline-notice ${styles.notice}`} data-returned-notice="" role="status">{text}</div>;
}
