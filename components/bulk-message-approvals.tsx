"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cardCell } from "@/components/table-card-labels";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { MessageApprovalListItem, MessageApprovalReview } from "@/modules/bulk-actions/message-approvals";
import styles from "./bulk-actions-panel.module.css";

type Props = { eventId: string; pending: MessageApprovalListItem[]; decided: MessageApprovalListItem[] };

const dateText = (iso: string) => formatInConferenceTime(iso, { dateStyle: "medium", timeStyle: "short" });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const DELIVERY_WORDS = {
  DISABLED: "Email delivery is off, so approving writes nothing that can be delivered.",
  LOCAL_CAPTURE: "Test mode: messages are captured in the Messages log and no real email is sent.",
  EXTERNAL_EMAIL: "Real email: approving sends it to each person listed.",
} as const;
const STATUS_WORDS = { PENDING_APPROVAL: "Waiting for approval", SENDING: "Being sent", SENT: "Sent", DECLINED: "Declined" } as const;

/**
 * Messages a confirmed bulk run queued (#182). Nothing here was sent when it was queued. A person with communications access
 * reads a fresh review and approves it with the fingerprint they were shown; the server checks access and the review again.
 */
export function BulkMessageApprovals({ eventId, pending, decided }: Props) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [review, setReview] = useState<MessageApprovalReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/events/${encodeURIComponent(eventId)}/bulk-actions/messages`;

  async function loadReview(id: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "The review could not be loaded.");
        setReview(null);
        return;
      }
      setReview(data.review as MessageApprovalReview);
    } catch {
      setError("The review could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function openReview(id: string) {
    setNotice("");
    setReview(null);
    setOpenId(id);
    void loadReview(id);
  }

  function close() {
    if (busy) return;
    setOpenId(null);
    setReview(null);
    setError("");
  }

  async function approve() {
    if (!openId || !review || busy) return;
    setBusy("approve");
    setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(openId)}/approve`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewFingerprint: review.fingerprint }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "The message was not sent.");
        // The review may have changed: read it again so the next approval uses what is true now.
        if (data.error === "PREVIEW_CHANGED") await loadReview(openId);
        return;
      }
      setNotice(`Approved. ${plural(data.approval?.sendResult?.included ?? 0, "message")} written for sending.`);
      setOpenId(null);
      setReview(null);
      router.refresh();
    } catch {
      setError("The answer was lost. Reload this page to see whether the message was sent. Approving again never sends it twice.");
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (!openId || busy) return;
    setBusy("decline");
    setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(openId)}/decline`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "The message could not be declined.");
        setConfirmingDecline(false);
        return;
      }
      setNotice("Declined. The message will not be sent.");
      setConfirmingDecline(false);
      setOpenId(null);
      setReview(null);
      router.refresh();
    } catch {
      setError("The answer was lost. Reload this page to see whether the message was declined.");
    } finally {
      setBusy(null);
    }
  }

  const resultText = (item: MessageApprovalListItem) => item.sendResult
    ? `${item.sendResult.included} written, ${item.sendResult.skipped} skipped${item.sendResult.suppressed > 0 ? `, ${item.sendResult.suppressed} suppressed` : ""}`
    : "";

  return (
    <section className={styles.card} aria-labelledby="bulk-messages-title">
      <h2 className={styles.title} id="bulk-messages-title">Messages waiting for approval</h2>
      <p className={styles.sub}>A bulk message is never sent when it is queued. It goes out only when someone with communications access approves it here, after reading a fresh review.</p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {pending.length === 0 ? <p className={styles.empty}>No messages are waiting for approval.</p> : (
        <div className="report-table-wrap">
          <table role="table" className="report-table table-cards">
            <caption className="sr-only">Messages waiting for approval, oldest first</caption>
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Queued</th><th role="columnheader" scope="col">Message</th><th role="columnheader" scope="col">Queued by</th><th role="columnheader" scope="col">People</th><th role="columnheader" scope="col"><span className="sr-only">Review</span></th></tr></thead>
            <tbody role="rowgroup">
              {pending.map((item) => (
                <tr role="row" key={item.id}>
                  <th role="rowheader" scope="row">{dateText(item.queuedAt)}</th>
                  <td {...cardCell("Message")}>{item.actionLabel}: {item.title ?? item.templateLabel}{item.status === "SENDING" ? " (being sent)" : ""}</td>
                  <td {...cardCell("Queued by")}>{item.queuedByName}</td>
                  <td {...cardCell("People")}>{plural(item.queuedCount, "registration")}</td>
                  <td {...cardCell("Review")}><button type="button" className="secondary-button" onClick={() => openReview(item.id)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {decided.length > 0 && (
        <>
          <h3 className={styles.subtitle}>Recently decided</h3>
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">The last messages that were sent or declined</caption>
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Decided</th><th role="columnheader" scope="col">Message</th><th role="columnheader" scope="col">Decided by</th><th role="columnheader" scope="col">Status</th></tr></thead>
              <tbody role="rowgroup">
                {decided.map((item) => (
                  <tr role="row" key={item.id}>
                    <th role="rowheader" scope="row">{item.decidedAt ? dateText(item.decidedAt) : dateText(item.queuedAt)}</th>
                    <td {...cardCell("Message")}>{item.actionLabel}: {item.title ?? item.templateLabel}</td>
                    <td {...cardCell("Decided by")}>{item.decidedByName ?? ""}</td>
                    <td {...cardCell("Status")}>{STATUS_WORDS[item.status]}{resultText(item) ? ` (${resultText(item)})` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ConfirmDialog
        open={openId !== null}
        title="Review the message"
        confirmLabel="Approve and send"
        busyLabel={busy === "decline" ? "Declining…" : "Sending…"}
        busy={busy !== null}
        confirmDisabled={!review || loading || !review.templatePublished || Boolean(review.attachmentProblem) || review.includedCount === 0}
        error={error}
        onCancel={close}
        onConfirm={approve}
      >
        {loading && !review && <p className={styles.sub} role="status">Loading a fresh review…</p>}
        {review && (
          <div className={styles.stack}>
            <dl className={styles.facts}>
              <div className={styles.fact}><dt>Message</dt><dd>{review.actionLabel}: {review.templateLabel}</dd></div>
              {review.title && <div className={styles.fact}><dt>Title</dt><dd>{review.title}</dd></div>}
              {review.body && <div className={styles.fact}><dt>Text</dt><dd className={styles.body}>{review.body}</dd></div>}
              <div className={styles.fact}><dt>Would be sent to</dt><dd>{plural(review.includedCount, "registration")} now, of the {review.queuedCount} queued by {review.queuedByName} on {dateText(review.queuedAt)}.</dd></div>
              <div className={styles.fact}>
                <dt>Skipped now</dt>
                <dd>{review.skippedByReason.length === 0 ? "None." : (
                  <ul className={styles.list}>{review.skippedByReason.map((group) => <li key={group.reason}>{plural(group.count, "registration")}: {group.label}</li>)}</ul>
                )}</dd>
              </div>
              {review.sampleCodes.length > 0 && <div className={styles.fact}><dt>Some who would receive it</dt><dd>{review.sampleCodes.join(", ")}{review.includedCount > review.sampleCodes.length ? ", …" : ""}</dd></div>}
              <div className={styles.fact}><dt>Delivery</dt><dd>{DELIVERY_WORDS[review.deliveryMode]}</dd></div>
            </dl>
            {!review.templatePublished && <p className={`${styles.notice} ${styles.warn}`}>The {review.templateLabel} template is not published, so this cannot be sent.</p>}
            {review.attachmentProblem && <p className={`${styles.notice} ${styles.warn}`}>{review.attachmentProblem}</p>}
            {review.includedCount === 0 && <p className={`${styles.notice} ${styles.warn}`}>None of these registrations can receive it now.</p>}
            <p className={styles.sub}>This review was read just now. If anything changes before you approve, nothing is sent and you review again.</p>
            <div className={styles.actions}>
              <button type="button" className="secondary-button" onClick={() => setConfirmingDecline(true)} disabled={busy !== null || review.status !== "PENDING_APPROVAL"}>Decline, do not send</button>
            </div>
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmingDecline}
        title="Decline this message?"
        confirmLabel="Decline, do not send"
        busyLabel="Declining…"
        busy={busy === "decline"}
        destructive
        onCancel={() => setConfirmingDecline(false)}
        onConfirm={decline}
      >
        <p className={styles.sub}>It will not be sent. To send it later, queue it again from a bulk action.</p>
      </ConfirmDialog>
    </section>
  );
}
