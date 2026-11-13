"use client";

import { useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { messageDeliverySummary } from "@/modules/communications/timeline-domain";
import type { RegistrationTimeline, RegistrationTimelineRow } from "@/modules/communications/timeline-repository";
import { dateTimeInZone as dateTime } from "@/lib/format-date-time";
import styles from "@/components/registration-communications-panel.module.css";

const confirmationTemplateKeys = new Set([
  "REGISTRATION_CONFIRMATION_PAID",
  "REGISTRATION_CONFIRMATION_UNPAID",
  "WORKER_CONFIRMATION",
]);

/** The original confirmation, not a resend copy and not one still being delivered: the only row that offers "Resend confirmation". */
export function canResendConfirmationMessage(record: Pick<RegistrationTimelineRow, "templateKey" | "retryOfMessageId" | "status">) {
  return confirmationTemplateKeys.has(record.templateKey)
    && record.retryOfMessageId === null
    && record.status !== "PENDING"
    && record.status !== "PROCESSING";
}

/**
 * A registration's communication timeline (#179): every message recorded for it in this event, newest first, loaded
 * from the staff route. The server decides what each row carries; a health-related message arrives without its subject
 * and text unless the viewer may read health information. Rows are read only. The one action, "Resend confirmation",
 * creates a new message through the existing workflow and leaves the row it repeats unchanged.
 */
export function RegistrationCommunicationsPanel({
  eventId,
  registrationId,
  timeZone,
  refreshKey,
  canResend,
  resendingMessageId,
  onResend,
}: {
  eventId: string;
  registrationId: string;
  timeZone: string;
  /** Changes when something happened that adds a message (a resend), so the timeline is read again. */
  refreshKey: number;
  canResend: boolean;
  resendingMessageId: string | null;
  onResend: (message: RegistrationTimelineRow) => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; data: RegistrationTimeline }>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetch(`/api/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/communications`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("not ok");
        return await response.json() as RegistrationTimeline;
      })
      .then((data) => { if (live) setState({ status: "ready", data }); })
      .catch(() => { if (live) setState({ status: "error" }); });
    return () => { live = false; };
  }, [eventId, registrationId, refreshKey]);

  const rows = state.status === "ready" ? state.data.rows : [];
  return (
    <section className="registration-related-panel" aria-labelledby="registration-email-history">
      <header>
        <span><Mail aria-hidden="true" size={17} /></span>
        <div><p className="eyebrow">Communication</p><h3 id="registration-email-history">Email history</h3></div>
        <strong>{state.status === "ready" ? rows.length : ""}</strong>
      </header>
      <div className="registration-related-list">
        {state.status === "loading" && <p className="quiet-copy" role="status">Loading email history…</p>}
        {state.status === "error" && <p className="quiet-copy" role="status">The email history could not be loaded.</p>}
        {rows.map((message) => {
          const delivery = messageDeliverySummary(message);
          return (
            <details className="registration-message" key={message.id} id={`message-${message.id}`}>
              <summary>
                <span>
                  <strong>{message.subject}</strong>
                  <small>{message.messageType} · To {message.recipientName ? `${message.recipientName} · ` : ""}<span translate="no">{message.recipientEmail}</span> ({message.recipientRole}) · {dateTime(delivery.date, timeZone)}</small>
                </span>
                <span className={`status-chip ${delivery.tone}`}>{delivery.label}</span>
              </summary>
              <div className="registration-message-body">
                {message.bodyText !== null
                  ? <p>{message.bodyText}</p>
                  : <p className={styles.withheld}>This message is about a health record, so its subject and text are shown only to staff who can view health information.</p>}
                <dl className={styles.facts}>
                  <div><dt>Message type</dt><dd>{message.messageType}</dd></div>
                  <div><dt>Template</dt><dd>{message.templateVersionLabel}</dd></div>
                  <div><dt>Recipient</dt><dd>{message.recipientName ? `${message.recipientName}, ` : ""}<span translate="no">{message.recipientEmail}</span> ({message.recipientRole})</dd></div>
                  <div><dt>Sent as</dt><dd>{message.senderName}</dd></div>
                  <div><dt>Replies go to</dt><dd>{message.replyTo ?? "Not set"}</dd></div>
                  {message.batch && <div><dt>Scheduled email</dt><dd>{message.batch.name}</dd></div>}
                  <div><dt>Delivery</dt><dd>{delivery.label}, {message.attemptCount} {message.attemptCount === 1 ? "attempt" : "attempts"}</dd></div>
                  <div><dt>Created</dt><dd>{dateTime(message.createdAt, timeZone)}</dd></div>
                  {message.sentAt && <div><dt>Sent</dt><dd>{dateTime(message.sentAt, timeZone)}</dd></div>}
                  {message.deliveredAt && <div><dt>Delivered</dt><dd>{dateTime(message.deliveredAt, timeZone)}</dd></div>}
                  {message.failedAt && <div><dt>Failed</dt><dd>{dateTime(message.failedAt, timeZone)}</dd></div>}
                </dl>
                {message.retryOfMessageId && (
                  <p className={styles.note}>This message is a resend of an earlier one. <a className={styles.link} href={`#message-${message.retryOfMessageId}`}>Go to the original</a></p>
                )}
                {message.resentByMessageIds.length > 0 && (
                  <p className={styles.note}>
                    This message was resent {message.resentByMessageIds.length === 1 ? "once" : `${message.resentByMessageIds.length} times`}.{" "}
                    {message.resentByMessageIds.map((id, index) => <a className={styles.link} key={id} href={`#message-${id}`}>{index === 0 ? "Go to the resend" : `Resend ${index + 1}`}{" "}</a>)}
                  </p>
                )}
                {message.lastError && <p className="form-error">Delivery issue: {message.lastError}</p>}
                {canResend && canResendConfirmationMessage(message) && (
                  <button
                    className="text-button"
                    type="button"
                    disabled={resendingMessageId === message.id}
                    onClick={() => onResend(message)}
                  >
                    <Send aria-hidden="true" size={14} />
                    {resendingMessageId === message.id ? "Resending…" : "Resend confirmation"}
                  </button>
                )}
              </div>
            </details>
          );
        })}
        {state.status === "ready" && rows.length === 0 && <p className="quiet-copy">No emails are linked to this registration yet.</p>}
        {state.status === "ready" && state.data.hasMore && <p className="quiet-copy">Only the newest {state.data.limit} messages are listed here. Older ones are not shown.</p>}
      </div>
    </section>
  );
}
