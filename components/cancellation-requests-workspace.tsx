"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { postJson } from "@/lib/post-json";
import { formatCents } from "@/modules/cancellation-policy/rules";
import { requestStatuses, requestStatusLabels, type RequestStatus } from "@/modules/cancellation-requests/domain";
import type { StaffQueueRow, StaffRequestDetail } from "@/modules/cancellation-requests/views";

/**
 * Staff queue for cancellation requests (#170). It shows what the registrant was shown, what has changed since, and the
 * capacity and waitlist context. Deciding records the decision, by the signed-in person with a reason, and nothing
 * else: no registration is cancelled, no refund or credit is created. Every action is checked again on the server for
 * MANAGE_FINANCE on this event; hiding a button is never the protection.
 */

const filters: Array<{ value: string; label: string }> = [
  { value: "OPEN", label: "Open" },
  ...requestStatuses.map((status) => ({ value: status, label: requestStatusLabels[status] })),
];

const scopeWords = { FULL_REGISTRATION: "Whole registration", ATTENDEE: "Attendees", COMPONENT: "Items" } as const;

function when(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
}

export function CancellationRequestsWorkspace({
  eventId,
  eventName,
  timezone,
  filter,
  rows,
  detail,
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  filter: string;
  rows: StaffQueueRow[];
  detail: StaffRequestDetail | null;
}) {
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ event: eventId, status: filter, ...extra });
    return `/finance/cancellation-requests?${params.toString()}`;
  };
  return (
    <section className="page-stack cancel-requests">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Financial operations</p>
          <h2>Cancellation requests</h2>
          <p>
            Registrants ask to cancel from their private link or account for {eventName}. You decide each request, by name and
            with a reason. Approving records your decision only: it does not cancel the registration, refund money or create
            credit. Those are separate, reviewed steps.
          </p>
        </div>
      </div>

      <nav className="panel cancel-requests-filters" aria-label="Filter requests">
        {filters.map((option) => (
          <Link aria-current={filter === option.value ? "page" : undefined} className={filter === option.value ? "primary-button" : "secondary-button"} href={`/finance/cancellation-requests?event=${encodeURIComponent(eventId)}&status=${option.value}`} key={option.value}>
            {option.label}
          </Link>
        ))}
      </nav>

      <section className="panel" aria-labelledby="cancel-requests-queue">
        <div className="section-heading"><h3 id="cancel-requests-queue">{filter === "OPEN" ? "Waiting for review" : requestStatusLabels[filter as RequestStatus] ?? "Requests"}</h3></div>
        {rows.length === 0 ? (
          <p>No requests here.</p>
        ) : (
          <ul className="cancel-requests-rows">
            {rows.map((row) => (
              <li key={row.id}>
                <Link aria-current={detail?.id === row.id ? "true" : undefined} href={query({ request: row.id })}>
                  <strong translate="no">{row.registrantName}</strong>
                  <span translate="no">{row.confirmationCode}</span>
                  <span>{row.statusLabel}</span>
                  <span>{scopeWords[row.scope]}{row.afterDeadline ? ", after deadline" : ""}</span>
                  <span translate="no">Proposed refund {formatCents(row.proposedRefundCents)}</span>
                  <small>Asked {when(row.createdAt, timezone)}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && <RequestDetail detail={detail} eventId={eventId} timezone={timezone} />}
    </section>
  );
}

function RequestDetail({ detail, eventId, timezone }: { detail: StaffRequestDetail; eventId: string; timezone: string }) {
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const changes = detail.conflicts.filter((conflict) => conflict.severity === "CHANGE");
  const needsText = (action: string) => action === "REQUEST_INFORMATION" || action === "APPROVE" || action === "DECLINE";

  async function act(event: FormEvent<HTMLFormElement>, action: StaffRequestDetail["actions"][number]) {
    event.preventDefault();
    setBusy(action);
    setMessage(null);
    const body = action === "START_REVIEW" ? { action }
      : action === "REQUEST_INFORMATION" ? { action, registrantNote: text }
        : action === "APPROVE" ? { action, reason: text, acknowledgeChanges: acknowledge }
          : { action, reason: text };
    const response = await postJson(`/api/events/${encodeURIComponent(eventId)}/cancellation-requests/${encodeURIComponent(detail.id)}`, body, "The request could not be updated.");
    setBusy(null);
    if (!response.ok) {
      setMessage({ kind: "error", text: typeof response.body.message === "string" ? response.body.message : "The request could not be updated." });
      return;
    }
    setText("");
    setAcknowledge(false);
    setMessage({ kind: "ok", text: action === "APPROVE" ? "Approval recorded. Nothing was cancelled or refunded." : action === "DECLINE" ? "Decline recorded." : "Saved." });
    router.refresh();
  }

  const canAct = detail.actions.length > 0;
  return (
    <section className="panel cancel-request-detail" aria-labelledby={`${id}-title`}>
      <div className="section-heading">
        <h3 id={`${id}-title`}><span translate="no">{detail.registrantName}</span>, <span translate="no">{detail.confirmationCode}</span></h3>
        <span className="count-badge">{detail.statusLabel}</span>
      </div>
      <dl className="cancel-request-facts">
        <div><dt>Asked</dt><dd>{when(detail.createdAt, timezone)} via {detail.requestedVia === "MANAGE_LINK" ? "the private link" : "the attendee portal"}</dd></div>
        <div><dt>Scope</dt><dd>{scopeWords[detail.scope]}{detail.attendeeNames.length > 0 ? `: ${detail.attendeeNames.join(", ")}` : ""}{detail.chargeLabels.length > 0 ? `: ${detail.chargeLabels.join(", ")}` : ""}</dd></div>
        <div><dt>Prefers contact by</dt><dd>{detail.contactMethod === "PHONE" ? "Phone" : "Email"}</dd></div>
        <div><dt>Registration now</dt><dd>{detail.registrationStatus.toLowerCase()}</dd></div>
      </dl>
      <p><strong>Registrant&apos;s reason</strong></p>
      <blockquote className="cancel-request-reason">{detail.reason}</blockquote>
      {detail.registrantNote && <p className="field-help">Information requested from the registrant: {detail.registrantNote}</p>}

      <h4>Proposed outcome (as the registrant saw it)</h4>
      <p>
        Policy version {detail.policyVersion ?? "none"}. {detail.proposal.timingLabel}: {detail.proposal.termsText}.
        {detail.proposal.afterDeadline ? " Requested after the refund deadline." : ""}
      </p>
      <dl className="cancel-request-facts">
        <div><dt>Charged</dt><dd translate="no">{formatCents(detail.proposal.chargedCents)}</dd></div>
        <div><dt>Paid</dt><dd translate="no">{formatCents(detail.proposal.paidCents)}</dd></div>
        <div><dt>Proposed refund</dt><dd translate="no">{formatCents(detail.proposal.refundCents)}</dd></div>
        <div><dt>Kept</dt><dd translate="no">{formatCents(detail.proposal.retainedCents)}</dd></div>
      </dl>
      <details><summary>How it was worked out</summary><ul>{detail.proposal.explanation.map((line, index) => <li key={index}>{line}</li>)}</ul></details>

      <h4>Conflicts and changes</h4>
      {detail.conflicts.length === 0 ? <p>The registration is as it was when the request was made.</p> : (
        <ul className="cancel-request-conflicts">
          {detail.conflicts.map((conflict, index) => (
            <li className={conflict.severity === "CHANGE" ? "is-change" : ""} key={`${conflict.code}-${index}`}>
              <strong>{conflict.severity === "CHANGE" ? "Changed: " : "Note: "}</strong>{conflict.message}
            </li>
          ))}
        </ul>
      )}

      <h4>Capacity and waitlist</h4>
      <p>
        {detail.capacity.registrationWouldBeCancelled ? "Cancelling would end the whole registration" : `Cancelling would release ${detail.capacity.seatsReleased} seat${detail.capacity.seatsReleased === 1 ? "" : "s"}`}
        {detail.capacity.componentsReleased > 0 ? ` and ${detail.capacity.componentsReleased} item${detail.capacity.componentsReleased === 1 ? "" : "s"}` : ""}
        {detail.capacity.waitlistPlaceReleased ? " and a waitlist place" : ""}. {detail.capacity.waitlistedInEvent} registration{detail.capacity.waitlistedInEvent === 1 ? " is" : "s are"} waitlisted for this event. {detail.capacity.note}
      </p>

      {detail.otherOpenRequests.length > 0 && (
        <p>Other open requests on this registration: {detail.otherOpenRequests.map((other) => `${requestStatusLabels[other.status]} (${scopeWords[other.scope]})`).join(", ")}.</p>
      )}

      <h4>Timeline</h4>
      <ol className="cancel-request-timeline">
        {detail.timeline.map((step, index) => (
          <li key={`${step.status}-${index}`}>
            {step.label}, {when(step.at, timezone)}{step.actorName ? `, by ${step.actorName}` : step.actorKind === "REGISTRANT" ? ", by the registrant" : step.actorKind === "SYSTEM" ? ", replaced by a newer request" : ""}
            {step.note ? <> <span className="field-help">{step.note}</span></> : null}
          </li>
        ))}
      </ol>

      {detail.decision && (
        <p><strong>{detail.statusLabel} by <span translate="no">{detail.decision.byName}</span></strong> on {when(detail.decision.at, timezone)}: {detail.decision.reason}{detail.decision.withChanges ? " (decided after acknowledging changes to the registration)" : ""}</p>
      )}

      {message && (
        <p className={message.kind === "error" ? "form-error" : "cancel-request-message is-ok"} role={message.kind === "error" ? "alert" : "status"}>
          {message.kind === "error" ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />} {message.text}
        </p>
      )}

      {canAct && (
        <div className="cancel-request-actions">
          <h4>Your decision</h4>
          <label htmlFor={`${id}-text`}>
            Reason or note (required to ask for information, approve or decline)
            <textarea id={`${id}-text`} maxLength={1000} onChange={(event) => setText(event.target.value)} rows={3} value={text} />
          </label>
          {detail.actions.includes("APPROVE") && changes.length > 0 && (
            <label className="cancel-request-choice">
              <input checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} type="checkbox" />
              <span>I have reviewed the changes above and still want to approve.</span>
            </label>
          )}
          <div className="cancel-request-buttons">
            {detail.actions.map((action) => (
              <form key={action} onSubmit={(event) => act(event, action)}>
                <button
                  className={action === "APPROVE" ? "primary-button" : "secondary-button"}
                  disabled={busy !== null || (needsText(action) && text.trim().length < 3) || (action === "APPROVE" && changes.length > 0 && !acknowledge)}
                  type="submit"
                >
                  {busy === action ? "Saving…" : action === "START_REVIEW" ? "Start review" : action === "REQUEST_INFORMATION" ? "Ask for information" : action === "APPROVE" ? "Approve (records the decision only)" : "Decline"}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
