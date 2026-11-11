"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/staff-club-applications.module.css";
import { sponsorOptionLabel } from "@/modules/organizations/domain";
import { DECLINE_REASON_MAX } from "@/modules/club-applications/domain";
import type { NewClubApplicationRecord } from "@/modules/club-applications/repository";

type Result = { text: string; tone: "error" | "success" };

/**
 * The Decision section of one application's page (#1589): Approve then "Approve and send invite", or Decline then a reason
 * and "Decline application". Same two steps, same route and same checks as before; the route decides who may use it.
 * After a decision the page refreshes to the new state and this section keeps its result, so the message survives the
 * refresh. It draws nothing for an application that was decided before this visit.
 */
export function StaffApplicationDecision({ application, churches }: { application: NewClubApplicationRecord; churches: Array<{ id: string; name: string; type: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [churchChoice, setChurchChoice] = useState("");
  const [message, setMessage] = useState<Result | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // After a decision the buttons are gone, so focus goes to the Decision heading instead of falling to the page.
  useEffect(() => {
    if (message?.tone === "success") headingRef.current?.focus();
  }, [message]);

  // Typed text not yet sent: an open decline reason. The church select is a choice, not typed text, so it does not count.
  useUnsavedChangesGuard(mode === "decline" && reason.trim() !== "", "You have typed something here that has not been sent. Leave this page and discard it?");

  async function decide(body: object, successText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/club-applications/${encodeURIComponent(application.id)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The decision could not be saved.");
      setMode(null);
      setReason("");
      setChurchChoice("");
      setMessage({ text: successText, tone: "success" });
      router.refresh();
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : "The decision could not be saved.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const pending = application.status === "PENDING";
  const result = message?.tone === "success" ? message.text : "";
  return (
    <>
      {(pending || message) && (
    <section aria-labelledby="application-decision-heading" className={styles.decision}>
      <h2 id="application-decision-heading" ref={headingRef} tabIndex={-1}>Decision</h2>
      {pending && (
        mode === null ? (
          <>
            <p className={styles.decisionHelp}>Approving creates the club and emails the director the club invite. Declining emails the applicant.</p>
            <div className={styles.actions}>
              <button className="secondary-button" disabled={busy} onClick={() => { setMode("decline"); setReason(""); setMessage(null); }} type="button">Decline</button>
              <button className="primary-button" disabled={busy} onClick={() => { setMode("approve"); setChurchChoice(""); setMessage(null); }} type="button">Approve</button>
            </div>
          </>
        ) : mode === "approve" ? (
          <form
            className={styles.decisionForm}
            onSubmit={(event) => {
              event.preventDefault();
              void decide(
                application.church.needsChoice ? { decision: "approve", sponsoringChurchId: churchChoice } : { decision: "approve" },
                "Approved. The club was created and the director was emailed the club invite.",
              );
            }}
          >
            <p>
              Approving creates the club and emails <strong translate="no">{application.director.email}</strong> the club director invite. It can&apos;t be undone from here.
            </p>
            {application.church.needsChoice && (
              <label>
                Sponsoring church or company from the directory
                <select required value={churchChoice} onChange={(event) => setChurchChoice(event.target.value)}>
                  <option value="">Choose a church or company…</option>
                  {churches.map((church) => <option key={church.id} value={church.id}>{sponsorOptionLabel(church)}</option>)}
                </select>
                <small>
                  {application.church.name
                    ? <>The applicant&apos;s church, &ldquo;{application.church.name}&rdquo;, isn&apos;t an active church or company in the directory. </>
                    : "The applicant's church is no longer in the directory. "}
                  Every club needs one.
                </small>
              </label>
            )}
            <div className={styles.actions}>
              <button className="secondary-button" disabled={busy} onClick={() => { setMode(null); setChurchChoice(""); }} type="button">Cancel</button>
              <button className="primary-button" disabled={busy || (application.church.needsChoice && !churchChoice)} type="submit">Approve and send invite</button>
            </div>
          </form>
        ) : (
          <form
            className={styles.decisionForm}
            onSubmit={(event) => {
              event.preventDefault();
              void decide({ decision: "decline", declineReason: reason }, "Declined. The applicant was emailed.");
            }}
          >
            <label>
              Reason (optional). The applicant is emailed this.
              <textarea maxLength={DECLINE_REASON_MAX} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
            </label>
            <div className={styles.actions}>
              <button className="secondary-button" disabled={busy} onClick={() => setMode(null)} type="button">Cancel</button>
              <button className="primary-button" disabled={busy} type="submit">Decline application</button>
            </div>
          </form>
        )
      )}
      {message?.tone === "error" && <p className="inline-notice error" role="alert">{message.text}</p>}
    </section>
      )}
      {/* Always mounted, so the result is announced even though the buttons are gone after the refresh. */}
      <p aria-live="polite" className={result ? "inline-notice success" : "sr-only"} role="status">{result}</p>
    </>
  );
}
