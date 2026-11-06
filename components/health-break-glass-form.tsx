"use client";

import { useId, useState } from "react";
import { postJson } from "@/lib/post-json";
import { HEALTH_SNAPSHOT_REASON_MAX, HEALTH_SNAPSHOT_REASON_MIN } from "@/modules/health-records/snapshot-retention";
import styles from "@/components/health-access.module.css";

/**
 * Start break-glass for one person (#1617): the typed reason posts to the existing route, which checks who is asking,
 * the privacy acknowledgment, and audits it. The lengths mirror the server's; the server is the authority. On
 * success the page reloads so the record opens. Only a system administrator is shown this (the page decides).
 * Nothing here reads or shows a health value.
 */
export function HealthBreakGlassForm({ personId, message }: { personId: string; message?: string }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const length = reason.trim().length;
  const valid = length >= HEALTH_SNAPSHOT_REASON_MIN && length <= HEALTH_SNAPSHOT_REASON_MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const result = await postJson("/api/staff/health-snapshots/break-glass", { personId, reason: reason.trim() }, "Break-glass could not be started.");
    if (!result.ok) {
      setError(typeof result.body.message === "string" ? result.body.message : "Break-glass could not be started.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <form className={styles.card} onSubmit={(event) => void submit(event)}>
      {message && <p className={styles.copy}>{message}</p>}
      <label className={styles.field} htmlFor={`${id}-reason`}>
        Reason for reading this record
        <textarea
          id={`${id}-reason`}
          aria-describedby={`${id}-hint`}
          maxLength={HEALTH_SNAPSHOT_REASON_MAX}
          minLength={HEALTH_SNAPSHOT_REASON_MIN}
          onChange={(event) => setReason(event.target.value)}
          required
          rows={3}
          value={reason}
        />
      </label>
      <p className={styles.hint} id={`${id}-hint`}>
        {HEALTH_SNAPSHOT_REASON_MIN} to {HEALTH_SNAPSHOT_REASON_MAX} characters. Your reason and every use of this access are recorded and reviewed.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.actions}>
        <button className="primary-button" disabled={!valid || busy} type="submit">{busy ? "Starting..." : "Start break-glass"}</button>
      </div>
    </form>
  );
}
