"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { postJson } from "@/lib/post-json";
import { useConfirm } from "@/components/use-confirm";
import { formatGrantInstant } from "@/components/health-access-grants";
import { HEALTH_SNAPSHOT_REASON_MAX, HEALTH_SNAPSHOT_REASON_MIN } from "@/modules/health-records/snapshot-retention";
import styles from "@/components/health-access.module.css";

export type HoldRow = {
  id: string;
  scope: "PERSON" | "EVENT";
  personId: string | null;
  eventId: string | null;
  reason: string;
  placedAt: string;
  liftedAt: string | null;
  liftReason: string | null;
  snapshotsCovered: number;
};

const failure = (body: Record<string, unknown>, fallback: string) => (typeof body.message === "string" ? body.message : fallback);

/**
 * Legal holds on sealed health copies (#1617): the list, placing one and lifting one. Placing and lifting each ask
 * for a confirmation first, then post to the existing routes, which keep every check and audit. They work with
 * HEALTH_RECORDS_ENABLED off, the same as the routes. Ids, reasons, dates and counts only; never a health value.
 */
export function HealthAccessHolds({ holds }: { holds: readonly HoldRow[] }) {
  const router = useRouter();
  const { confirm, ask, confirmDialog } = useConfirm();
  const id = useId();
  const [scope, setScope] = useState<"PERSON" | "EVENT">("PERSON");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const reasonLength = reason.trim().length;
  const reasonValid = reasonLength >= HEALTH_SNAPSHOT_REASON_MIN && reasonLength <= HEALTH_SNAPSHOT_REASON_MAX;
  const ready = reasonValid && target.trim().length > 0 && !busy;
  const noun = scope === "PERSON" ? "person" : "event";

  async function place(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const ok = await confirm({
      title: `Place a hold on this ${noun}`,
      body: <p>Sealed health copies for the {noun} with id {target.trim()} will be kept and not deleted until the hold is lifted. This is recorded with your reason.</p>,
      confirmLabel: "Place hold",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    setDone("");
    const payload = scope === "PERSON" ? { scope, personId: target.trim(), reason: reason.trim() } : { scope, eventId: target.trim(), reason: reason.trim() };
    const result = await postJson("/api/staff/health-snapshots/holds", payload, "The hold could not be placed.");
    setBusy(false);
    if (!result.ok) {
      setError(failure(result.body, "The hold could not be placed."));
      return;
    }
    setTarget("");
    setReason("");
    setDone("Hold placed.");
    router.refresh();
  }

  async function lift(hold: HoldRow) {
    const liftReason = await ask({
      title: "Lift this hold",
      body: <p>Sealed health copies covered by this hold can be deleted again by the retention rules. This is recorded with your reason.</p>,
      confirmLabel: "Lift hold",
      destructive: true,
      input: { label: "Reason for lifting the hold", required: true, multiline: true, minLength: HEALTH_SNAPSHOT_REASON_MIN, maxLength: HEALTH_SNAPSHOT_REASON_MAX, hint: `${HEALTH_SNAPSHOT_REASON_MIN} to ${HEALTH_SNAPSHOT_REASON_MAX} characters.` },
    });
    if (liftReason === null) return;
    setError("");
    setDone("");
    const result = await postJson(`/api/staff/health-snapshots/holds/${encodeURIComponent(hold.id)}/lift`, { reason: liftReason }, "The hold could not be lifted.");
    if (!result.ok) {
      setError(failure(result.body, "The hold could not be lifted."));
      return;
    }
    setDone("Hold lifted.");
    router.refresh();
  }

  return (
    <section aria-labelledby="legal-holds" className={styles.card}>
      <h2 id="legal-holds">Legal holds</h2>
      <p className={styles.copy}>A hold keeps a person&apos;s or an event&apos;s sealed health copies from being deleted. Placing and lifting a hold work even when health records are switched off.</p>
      <form className="form-stack" onSubmit={(event) => void place(event)}>
        <div className={styles.row}>
          <label className={styles.field} htmlFor={`${id}-scope`}>
            Hold on
            <select id={`${id}-scope`} onChange={(event) => setScope(event.target.value as "PERSON" | "EVENT")} value={scope}>
              <option value="PERSON">A person</option>
              <option value="EVENT">An event</option>
            </select>
          </label>
          <label className={styles.field} htmlFor={`${id}-target`}>
            {scope === "PERSON" ? "Person id" : "Event id"}
            <input autoComplete="off" id={`${id}-target`} maxLength={64} onChange={(event) => setTarget(event.target.value)} required value={target} />
          </label>
        </div>
        <label className={styles.field} htmlFor={`${id}-reason`}>
          Reason for the hold
          <textarea
            aria-describedby={`${id}-hint`}
            id={`${id}-reason`}
            maxLength={HEALTH_SNAPSHOT_REASON_MAX}
            minLength={HEALTH_SNAPSHOT_REASON_MIN}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </label>
        <p className={styles.hint} id={`${id}-hint`}>{HEALTH_SNAPSHOT_REASON_MIN} to {HEALTH_SNAPSHOT_REASON_MAX} characters.</p>
        <div className={styles.actions}>
          <button className="primary-button" disabled={!ready} type="submit">Place hold</button>
        </div>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {done && <p className={styles.ok} role="status">{done}</p>}
      {holds.length === 0 ? <p className={styles.copy}>No legal holds.</p> : (
        <ul className={styles.list}>
          {holds.map((hold) => (
            <li className={styles.item} key={hold.id}>
              <span className={hold.liftedAt ? `${styles.status} ${styles.statusLifted}` : styles.status}>{hold.liftedAt ? "Lifted" : "Active"}</span>
              <dl>
                <dt>{hold.scope === "PERSON" ? "Person id" : "Event id"}</dt>
                <dd>{hold.scope === "PERSON" ? hold.personId : hold.eventId}</dd>
                <dt>Placed</dt>
                <dd>{formatGrantInstant(hold.placedAt)}</dd>
                <dt>Reason</dt>
                <dd>{hold.reason}</dd>
                <dt>Sealed copies kept</dt>
                <dd>{hold.snapshotsCovered}</dd>
                {hold.liftedAt && (
                  <>
                    <dt>Lifted</dt>
                    <dd>{formatGrantInstant(hold.liftedAt)}</dd>
                    <dt>Lift reason</dt>
                    <dd>{hold.liftReason}</dd>
                  </>
                )}
              </dl>
              {!hold.liftedAt && <button className="secondary-button" onClick={() => void lift(hold)} type="button">Lift hold</button>}
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
