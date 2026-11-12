"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/staff-visiting-clubs.module.css";
import { VISITING_DECLINE_REASON_MAX } from "@/modules/visiting-clubs/domain";
import type { VisitingRequestRecord } from "@/modules/visiting-clubs/repository";

type Result = { text: string; tone: "error" | "success" };

/**
 * The Decision section of one visiting club request (#835): Approve then "Approve club", or Decline then an optional
 * reason and "Decline request". The route decides who may use it and checks the role again on every call.
 */
export function StaffVisitingDecision({ request }: { request: VisitingRequestRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Result | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (message?.tone === "success") headingRef.current?.focus();
  }, [message]);

  useUnsavedChangesGuard(mode === "decline" && reason.trim() !== "", "You have typed something here that has not been sent. Leave this page and discard it?");

  async function decide(body: object, successText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/visiting-clubs/requests/${encodeURIComponent(request.id)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The decision could not be saved.");
      setMode(null);
      setReason("");
      setMessage({ text: successText, tone: "success" });
      router.refresh();
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : "The decision could not be saved.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const pending = request.status === "PENDING";
  const result = message?.tone === "success" ? message.text : "";
  return (
    <>
      {(pending || message) && (
        <section aria-labelledby="visiting-decision-heading" className={styles.decision}>
          <h2 id="visiting-decision-heading" ref={headingRef} tabIndex={-1}>Decision</h2>
          {pending && (
            mode === null ? (
              <>
                <p className={styles.help}>Approving creates a guest club for this event and lets the director register it. Declining emails the director.</p>
                <div className={styles.actions}>
                  <button className="secondary-button" disabled={busy} onClick={() => { setMode("decline"); setReason(""); setMessage(null); }} type="button">Decline</button>
                  <button className="primary-button" disabled={busy} onClick={() => { setMode("approve"); setMessage(null); }} type="button">Approve</button>
                </div>
              </>
            ) : mode === "approve" ? (
              <form
                className={styles.decisionForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void decide({ decision: "approve" }, "Approved. The guest club was created and the director was emailed.");
                }}
              >
                <p>
                  Approving creates <strong translate="no">{request.clubName}</strong> as a guest club for <strong translate="no">{request.event.name}</strong> and emails <strong translate="no">{request.director.email}</strong>. It can&apos;t be undone from here.
                </p>
                <div className={styles.actions}>
                  <button className="secondary-button" disabled={busy} onClick={() => setMode(null)} type="button">Cancel</button>
                  <button className="primary-button" disabled={busy} type="submit">Approve club</button>
                </div>
              </form>
            ) : (
              <form
                className={styles.decisionForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void decide({ decision: "decline", declineReason: reason }, "Declined. The director was emailed.");
                }}
              >
                <label>
                  Reason (optional). The director is emailed this.
                  <textarea maxLength={VISITING_DECLINE_REASON_MAX} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
                </label>
                <div className={styles.actions}>
                  <button className="secondary-button" disabled={busy} onClick={() => setMode(null)} type="button">Cancel</button>
                  <button className="primary-button" disabled={busy} type="submit">Decline request</button>
                </div>
              </form>
            )
          )}
          {message?.tone === "error" && <p className="inline-notice error" role="alert">{message.text}</p>}
        </section>
      )}
      <p aria-live="polite" className={result ? "inline-notice success" : "sr-only"} role="status">{result}</p>
    </>
  );
}
