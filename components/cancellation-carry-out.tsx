"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { postJson } from "@/lib/post-json";
import { formatCents } from "@/modules/cancellation-policy/rules";
import { refundMethodLabels, type RefundMethod } from "@/modules/cancellation-execution/domain";
import type { CarryOutPanel } from "@/modules/cancellation-execution/views";

/**
 * "Carry out" for an approved cancellation request (#171). Pressing it is the human act: it cancels the approved scope,
 * releases its seats, and makes or records the approved refund, all at once and only for what was approved. Nothing here
 * runs by itself. The server checks MANAGE_FINANCE and the approved state again; a disabled button is never the protection.
 */

const stepWords = { PENDING: "Not done yet", DONE: "Done", FAILED: "Needs attention" } as const;

const failureWords: Record<string, string> = {
  SQUARE_UNCERTAIN: "Square did not confirm the request. It is safe to send again.",
  PROVIDER_DECLINED: "Square declined the refund.",
  PROVIDER_FAILED: "Square reported the refund as failed.",
  SQUARE_MISMATCH: "Square made a refund that does not match what was asked. Check it in Square.",
  SQUARE_NOT_CONFIGURED: "Square is not configured for this site.",
  PAYMENT_NOT_REFUNDABLE_IN_SQUARE: "This payment cannot be refunded through Square.",
  REFUND_EXCEEDS_AVAILABLE: "The payment has less left to refund than approved.",
};

function failureText(code: string | null) {
  if (!code) return null;
  if (failureWords[code]) return failureWords[code];
  if (code.startsWith("SQUARE_REJECTED")) return "Square rejected the refund request.";
  return `Could not finish (${code.toLowerCase().replaceAll("_", " ")}).`;
}

export function CancellationCarryOut({
  eventId,
  requestId,
  panel,
  scope,
  attendeeCount,
}: {
  eventId: string;
  requestId: string;
  panel: CarryOutPanel;
  scope: "FULL_REGISTRATION" | "ATTENDEE" | "COMPONENT";
  attendeeCount: number;
}) {
  const id = useId();
  const router = useRouter();
  const { execution, options } = panel;
  const [method, setMethod] = useState<RefundMethod | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [resolveConfirmed, setResolveConfirmed] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  // A failed attempt moves focus to what went wrong, so a keyboard or screen reader user lands on it.
  useEffect(() => {
    if (message?.kind === "error") messageRef.current?.focus();
  }, [message]);

  const needsMethod = Boolean(options && options.approvedRefundCents > 0);
  const startBlocked = options ? (options.reReviewReason ?? options.blockedReason ?? (options.scopeSupported ? null : "Only a whole registration or approved attendees can be carried out here.")) : null;
  const chosen = options?.methods.find((option) => option.method === method);
  const noMethod = Boolean(needsMethod && options && options.methods.every((option) => option.unavailableReason || !option.sufficient));
  const whyOff = (): string | null => {
    if (execution) return null;
    if (noMethod) return "Neither refund method can cover the approved refund right now, so this cannot be carried out. The reasons are listed above.";
    if (needsMethod && !method) return "Choose how the refund is made first.";
    if (needsMethod && chosen && (chosen.unavailableReason || !chosen.sufficient)) return chosen.unavailableReason ?? "This method cannot cover the approved refund.";
    if (!confirmed) return "Tick the box to confirm you are carrying this out.";
    return null;
  };

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await postJson(
      `/api/events/${encodeURIComponent(eventId)}/cancellation-requests/${encodeURIComponent(requestId)}/carry-out`,
      { confirm: true, ...(method ? { method } : {}) },
      "The cancellation could not be carried out.",
    );
    setBusy(false);
    if (!response.ok) {
      setMessage({ kind: "error", text: typeof response.body.message === "string" ? response.body.message : "The cancellation could not be carried out." });
      router.refresh();
      return;
    }
    setConfirmed(false);
    setMessage({ kind: "ok", text: "Saved. The steps below show where it stands." });
    router.refresh();
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await postJson(
      `/api/events/${encodeURIComponent(eventId)}/cancellation-requests/${encodeURIComponent(requestId)}/carry-out/resolve`,
      { confirm: true, note },
      "The refund could not be recorded as resolved.",
    );
    setBusy(false);
    if (!response.ok) {
      setMessage({ kind: "error", text: typeof response.body.message === "string" ? response.body.message : "The refund could not be recorded as resolved." });
      return;
    }
    setNote("");
    setResolveConfirmed(false);
    setMessage({ kind: "ok", text: "Recorded. No money moved here." });
    router.refresh();
  }

  const resolveOff = note.trim().length < 5 ? "Write a note of at least 5 characters first." : !resolveConfirmed ? "Tick the box to confirm." : null;
  const off = whyOff();
  return (
    <section className="cancel-request-actions" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Carry out</h4>
      {!execution && options && (
        <>
          <p>
            Carrying out is a separate step from approving, and only a named staff member can do it. It applies exactly what was
            approved: {scope === "FULL_REGISTRATION" ? "cancel the whole registration" : `remove ${attendeeCount} approved attendee${attendeeCount === 1 ? "" : "s"}`},
            release their seats{options.waitlistedInEvent > 0 ? ` (${options.waitlistedInEvent} registration${options.waitlistedInEvent === 1 ? " is" : "s are"} on the waitlist and may be offered them)` : ""},
            and {needsMethod ? <>refund <strong translate="no">{formatCents(options.approvedRefundCents)}</strong></> : "refund nothing, because the approved refund is zero"}.
            Nothing is credited toward a future event; that comes later.
          </p>
          {noMethod && (
            <ul className="field-help">
              {options.methods.map((option) => <li key={option.method}>{refundMethodLabels[option.method]}: {option.unavailableReason ?? "These payments do not cover the approved refund."}</li>)}
            </ul>
          )}
          {startBlocked ? (
            <p className="form-error"><AlertCircle size={16} aria-hidden="true" /> {startBlocked}</p>
          ) : (
            <form onSubmit={send}>
              {needsMethod && (
                <fieldset className="cancel-request-form">
                  <legend>How is the refund made?</legend>
                  {options.methods.map((option) => (
                    <label className="cancel-request-choice" key={option.method}>
                      <input
                        checked={method === option.method}
                        disabled={Boolean(option.unavailableReason) || !option.sufficient}
                        name={`${id}-method`}
                        onChange={() => setMethod(option.method)}
                        type="radio"
                        value={option.method}
                      />
                      <span>
                        {refundMethodLabels[option.method]}
                        {option.unavailableReason ? <small className="field-help"> {option.unavailableReason}</small> : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="cancel-request-choice">
                <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                <span>I am carrying out this approved cancellation now. It cannot be undone from here.</span>
              </label>
              {off && <p className="field-help" id={`${id}-why`}>{off}</p>}
              <button aria-describedby={off ? `${id}-why` : undefined} className="primary-button" disabled={busy || off !== null} type="submit">
                {busy ? "Carrying out…" : "Carry out"}
              </button>
            </form>
          )}
        </>
      )}

      {execution && (
        <>
          <p>
            <strong>{execution.statusLabel}.</strong> Started by <span translate="no">{execution.executedByName}</span>, attempt {execution.attempts}.
            {execution.method ? ` Method: ${refundMethodLabels[execution.method]}.` : ""}
          </p>
          <ul className="cancel-request-steps">
            <li>
              {scope === "FULL_REGISTRATION" ? "Cancel the registration" : "Remove the approved attendees"}: <strong>{stepWords[execution.cancelStatus]}</strong>
              {failureText(execution.cancelFailureCode) ? <> <span className="field-help">{failureText(execution.cancelFailureCode)}</span></> : null}
            </li>
            {execution.legs.map((leg) => (
              <li key={leg.id}>
                Refund <span translate="no">{formatCents(leg.amountCents)}</span>: <strong>{leg.withProcessor ? "Waiting for Square" : stepWords[leg.status]}</strong>
                {failureText(leg.failureCode) ? <> <span className="field-help">{failureText(leg.failureCode)}</span></> : null}
                {leg.resolved ? <> <span className="field-help">Recorded as settled outside this tool by <span translate="no">{leg.resolvedByName}</span>: {leg.resolutionNote}</span></> : null}
              </li>
            ))}
            {execution.legs.length === 0 && <li>Refund: none, the approved refund is zero.</li>}
          </ul>
          <p className="field-help">{execution.nextStep}</p>
          {execution.canResolve && (
            <form className="cancel-request-form" onSubmit={resolve}>
              <label htmlFor={`${id}-note`}>
                How was the failed refund settled outside this tool? (required)
                <textarea id={`${id}-note`} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
              </label>
              <label className="cancel-request-choice">
                <input checked={resolveConfirmed} onChange={(event) => setResolveConfirmed(event.target.checked)} type="checkbox" />
                <span>This was settled outside this tool. Recording it moves no money.</span>
              </label>
              {resolveOff && <p className="field-help" id={`${id}-resolve-why`}>{resolveOff}</p>}
              <button aria-describedby={resolveOff ? `${id}-resolve-why` : undefined} className="secondary-button" disabled={busy || resolveOff !== null} type="submit">
                {busy ? "Saving…" : "Record as settled outside this tool"}
              </button>
            </form>
          )}
          {execution.canContinue && (
            <form onSubmit={send}>
              <button className="secondary-button" disabled={busy} type="submit">
                {busy ? "Working…" : execution.status === "PROCESSOR_PENDING" ? "Check status" : "Continue"}
              </button>
            </form>
          )}
        </>
      )}

      {/* Always mounted, so a change of its content is announced. */}
      <div aria-atomic="true" aria-live="polite" id={`${id}-message`} ref={messageRef} tabIndex={-1}>
        {message && (
          <p className={message.kind === "error" ? "form-error" : "cancel-request-message is-ok"}>
            {message.kind === "error" ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />} {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
