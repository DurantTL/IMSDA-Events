"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Undo2 } from "lucide-react";
import type { RegistrantProposal } from "@/modules/cancellation-requests/domain";
import type { RegistrantRequestSummary, RegistrantRequestView } from "@/modules/cancellation-requests/views";

/**
 * Ask to cancel (#170), from the private manage link or the signed-in portal. It shows the policy's proposed outcome
 * before anything is sent, then sends a request for the event team to review. Nothing here cancels, refunds or credits
 * anything, and the page says so. The endpoint decides who may ask; this component only talks to it.
 */

type Scope = "FULL_REGISTRATION" | "ATTENDEE" | "COMPONENT";

const scopeLabels: Record<Scope, string> = {
  FULL_REGISTRATION: "The whole registration",
  ATTENDEE: "One or more attendees",
  COMPONENT: "Individual items",
};

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number) => moneyFormatter.format(cents / 100);

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const when = (iso: string) => dateFormatter.format(new Date(iso));

type OpenConflict = { id: string; status: string; scope: string };

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export function CancellationRequestPanel({
  endpoint,
  initialView,
  headingLevel = 2,
}: {
  endpoint: string;
  initialView: RegistrantRequestView;
  headingLevel?: 2 | 3;
}) {
  const uid = useId();
  const [view, setView] = useState(initialView);
  const [scope, setScope] = useState<Scope>(initialView.allowedScopes[0] ?? "FULL_REGISTRATION");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<RegistrantProposal | null>(null);
  const [reason, setReason] = useState("");
  const [contactMethod, setContactMethod] = useState<"EMAIL" | "PHONE">("EMAIL");
  const [replace, setReplace] = useState<OpenConflict[] | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [busy, setBusy] = useState<"preview" | "submit" | "withdraw" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState<string | null>(null);
  const idempotencyKey = useRef(newKey());
  const messageRef = useRef<HTMLDivElement>(null);
  const Heading = headingLevel === 2 ? "h2" : "h3";

  const selection = {
    scope,
    ...(scope === "ATTENDEE" ? { attendeeIds } : {}),
    ...(scope === "COMPONENT" ? { chargeIds } : {}),
  };
  const submitWhyOff = reason.trim().length < 3
    ? "Tell the event team why you are asking (at least 3 characters) to send your request."
    : replace && replace.length > 0 && !replaceConfirmed
      ? "Tick the box above to replace your open request, or withdraw it first."
      : null;
  const selectionReady = scope === "FULL_REGISTRATION" || (scope === "ATTENDEE" && attendeeIds.length > 0) || (scope === "COMPONENT" && chargeIds.length > 0);

  // An error is announced, and focus moves to it, because the send button it belongs to can be far below the top of the panel.
  useEffect(() => {
    if (message?.kind === "error") messageRef.current?.focus();
  }, [message]);

  /** The choice changed: what was shown no longer applies, and a request made from the new choice is a new request. */
  function resetProposal() {
    idempotencyKey.current = newKey();
    setProposal(null);
    setReplace(null);
    setReplaceConfirmed(false);
    setMessage(null);
  }

  async function post(body: unknown) {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { response, payload };
  }

  async function showOutcome() {
    setBusy("preview");
    setMessage(null);
    setReplace(null);
    try {
      const { response, payload } = await post({ action: "preview", selection });
      if (!response.ok || !payload?.proposal) {
        throw new Error(typeof payload?.message === "string" ? payload.message : "The proposed outcome could not be calculated. Try again.");
      }
      const next = payload.proposal as RegistrantProposal;
      setProposal(next);
      if (next.status !== "CALCULATED") setMessage({ kind: "error", text: next.message ?? "A proposed outcome could not be calculated for that choice." });
    } catch (error) {
      setProposal(null);
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The proposed outcome could not be calculated. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposal || proposal.status !== "CALCULATED") return;
    setBusy("submit");
    setMessage(null);
    try {
      const { response, payload } = await post({
        action: "submit",
        selection,
        reason,
        contactMethod,
        idempotencyKey: idempotencyKey.current,
        expectedRefundCents: proposal.refundCents,
        ...(replace && replaceConfirmed ? { supersedeRequestIds: replace.map((entry) => entry.id) } : {}),
      });
      if (response.status === 409 && payload?.error === "OVERLAPPING_OPEN_REQUEST") {
        setReplace((payload.open as OpenConflict[] | undefined) ?? []);
        setMessage({ kind: "error", text: typeof payload.message === "string" ? payload.message : "You already have an open request that overlaps this one." });
        return;
      }
      if (response.status === 409 && payload?.error === "OUTCOME_CHANGED") {
        setProposal((payload.proposal as RegistrantProposal | undefined) ?? null);
        setMessage({ kind: "error", text: typeof payload.message === "string" ? payload.message : "The proposed outcome changed. Review it and send again." });
        return;
      }
      if (!response.ok || !payload?.view) {
        throw new Error(typeof payload?.message === "string" ? payload.message : "Your request could not be sent. Try again.");
      }
      setView(payload.view as RegistrantRequestView);
      setProposal(null);
      setReason("");
      setAttendeeIds([]);
      setChargeIds([]);
      setReplace(null);
      setReplaceConfirmed(false);
      idempotencyKey.current = newKey();
      setMessage({ kind: "ok", text: payload.duplicate ? "You already have this request. It is shown below." : "Your request was sent. Nothing has been cancelled or refunded yet; the event team will review it." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Your request could not be sent. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(request: RegistrantRequestSummary) {
    setBusy("withdraw");
    setMessage(null);
    try {
      const { response, payload } = await post({ action: "withdraw", requestId: request.id });
      if (!response.ok || !payload?.view) {
        throw new Error(typeof payload?.message === "string" ? payload.message : "The request could not be withdrawn. Try again.");
      }
      setView(payload.view as RegistrantRequestView);
      setMessage({ kind: "ok", text: "Your request was withdrawn. Your registration was not changed." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The request could not be withdrawn. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function toggle(list: string[], id: string, set: (next: string[]) => void) {
    set(list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
    resetProposal();
  }

  return (
    <section className="public-manage-card cancel-request-panel" aria-labelledby={`${uid}-title`}>
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Cancellation</p>
        <Heading id={`${uid}-title`}>Ask to cancel</Heading>
        <p>
          Send a request and the event team will review it. Sending a request does not cancel anything, refund anything or
          change your registration.
        </p>
      </div>

      {/* Always mounted, so a change of its content is announced. */}
      <div aria-atomic="true" aria-live="polite" ref={messageRef} tabIndex={-1}>
        {message && (
          <p className={message.kind === "error" ? "form-error cancel-request-message" : "cancel-request-message is-ok"}>
            {message.kind === "error" ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />} {message.text}
          </p>
        )}
      </div>

      {view.requests.length > 0 && (
        <ul className="cancel-request-list" aria-label="Your cancellation requests">
          {view.requests.map((request) => (
            <li key={request.id}>
              <div className="cancel-request-head">
                <strong>{request.statusLabel}</strong>
                <span>Asked {when(request.createdAt)}</span>
              </div>
              <p>{request.statusDetail}</p>
              <p className="field-help">
                For {request.scope === "FULL_REGISTRATION" ? "the whole registration" : request.scope === "ATTENDEE" ? request.attendeeNames.join(", ") || "selected attendees" : request.chargeLabels.join(", ") || "selected items"}.
                {" "}Proposed refund when you asked: <span translate="no">{money(request.proposedRefundCents)}</span>. This is not a decision.
              </p>
              {request.registrantNote && (
                <p className="cancel-request-note"><strong>The event team asks:</strong> {request.registrantNote}</p>
              )}
              <ol className="cancel-request-timeline" aria-label="Status history">
                {request.timeline.map((step, index) => (
                  <li key={`${step.status}-${index}`}>{step.label}, {when(step.at)}</li>
                ))}
              </ol>
              {request.canWithdraw && confirmingWithdraw !== request.id && (
                <button
                  aria-label={`Withdraw the ${request.statusLabel.toLowerCase()} request from ${when(request.createdAt)}`}
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => setConfirmingWithdraw(request.id)}
                  type="button"
                >
                  <Undo2 size={16} aria-hidden="true" /> Withdraw this request
                </button>
              )}
              {request.canWithdraw && confirmingWithdraw === request.id && (
                <div className="cancel-request-confirm" role="group" aria-label={`Confirm withdrawing the request from ${when(request.createdAt)}`}>
                  <p>Withdraw this request? Your registration will not be changed.</p>
                  <button className="primary-button" disabled={busy !== null} onClick={async () => { await withdraw(request); setConfirmingWithdraw(null); }} type="button">
                    {busy === "withdraw" ? "Withdrawing…" : "Yes, withdraw it"}
                  </button>
                  <button className="secondary-button" disabled={busy !== null} onClick={() => setConfirmingWithdraw(null)} type="button">Keep it</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!view.available ? (
        view.unavailableReason && <p className="public-manage-readonly-note">{view.unavailableReason}</p>
      ) : (
        <form className="cancel-request-form" onSubmit={submit}>
          <fieldset>
            <legend>What would you like to cancel?</legend>
            {view.allowedScopes.map((option) => (
              <label className="cancel-request-choice" key={option}>
                <input
                  checked={scope === option}
                  name={`${uid}-scope`}
                  onChange={() => { setScope(option); resetProposal(); }}
                  type="radio"
                  value={option}
                />
                <span>{scopeLabels[option]}</span>
              </label>
            ))}
          </fieldset>

          {scope === "ATTENDEE" && (
            <fieldset>
              <legend>Which attendees?</legend>
              {view.attendees.map((attendee) => (
                <label className="cancel-request-choice" key={attendee.id}>
                  <input checked={attendeeIds.includes(attendee.id)} onChange={() => toggle(attendeeIds, attendee.id, setAttendeeIds)} type="checkbox" />
                  <span translate="no">{attendee.name}</span>
                </label>
              ))}
            </fieldset>
          )}

          {scope === "COMPONENT" && (
            <fieldset>
              <legend>Which items?</legend>
              {view.components.map((component) => (
                <label className="cancel-request-choice" key={component.id}>
                  <input checked={chargeIds.includes(component.id)} onChange={() => toggle(chargeIds, component.id, setChargeIds)} type="checkbox" />
                  <span>{component.label} <span translate="no">({money(component.amountCents)})</span></span>
                </label>
              ))}
            </fieldset>
          )}

          <button aria-describedby={selectionReady ? undefined : `${uid}-choose-why`} className="secondary-button" disabled={!selectionReady || busy !== null} onClick={showOutcome} type="button">
            {busy === "preview" ? "Calculating…" : "Show the proposed outcome"}
          </button>
          {!selectionReady && <p className="field-help" id={`${uid}-choose-why`}>{scope === "ATTENDEE" ? "Choose at least one attendee to see the proposed outcome." : "Choose at least one item to see the proposed outcome."}</p>}

          {proposal && proposal.status === "CALCULATED" && (
            <div className="cancel-request-outcome" aria-live="polite">
              <p className="public-registration-eyebrow">Proposed outcome</p>
              <p><strong>{proposal.timingLabel}</strong>: {proposal.termsText}.</p>
              {proposal.afterDeadline && <p className="field-help">The refund deadline has passed, so the after-deadline terms apply. You can still ask; the event team decides.</p>}
              <dl className="cancel-request-money">
                <div><dt>Charged on this registration</dt><dd translate="no">{money(proposal.chargedCents)}</dd></div>
                <div><dt>Paid so far</dt><dd translate="no">{money(proposal.paidCents)}</dd></div>
                <div className="is-total"><dt>Proposed refund</dt><dd translate="no">{money(proposal.refundCents)}</dd></div>
                <div><dt>Kept under the policy</dt><dd translate="no">{money(proposal.retainedCents)}</dd></div>
              </dl>
              {proposal.registrationWouldBeCancelled && <p>This would cancel the whole registration if the event team approves and carries it out.</p>}
              {proposal.creditMayBeOffered && <p>The event team may offer future-event credit instead of a refund.</p>}
              <details>
                <summary>How this was worked out</summary>
                <ul>
                  {proposal.explanation.map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              </details>
              <p className="field-help">{proposal.notice}</p>

              <label className="public-registration-field">
                <span className="public-registration-field-label">Why are you asking? <span aria-hidden="true">*</span></span>
                <textarea maxLength={1000} onChange={(event) => setReason(event.target.value)} required rows={3} value={reason} />
              </label>
              <fieldset>
                <legend>How should the event team reach you about this?</legend>
                <label className="cancel-request-choice"><input checked={contactMethod === "EMAIL"} name={`${uid}-contact`} onChange={() => setContactMethod("EMAIL")} type="radio" /><span>Email</span></label>
                <label className="cancel-request-choice"><input checked={contactMethod === "PHONE"} name={`${uid}-contact`} onChange={() => setContactMethod("PHONE")} type="radio" /><span>Phone</span></label>
              </fieldset>

              {replace && replace.length > 0 && (
                <label className="cancel-request-choice cancel-request-replace">
                  <input checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} type="checkbox" />
                  <span>Replace my open request{replace.length === 1 ? "" : "s"} with this one. The older request will show as replaced.</span>
                </label>
              )}

              {submitWhyOff && <p className="field-help" id={`${uid}-submit-why`}>{submitWhyOff}</p>}
              <button aria-describedby={submitWhyOff ? `${uid}-submit-why` : undefined} className="primary-button" disabled={busy !== null || submitWhyOff !== null} type="submit">
                {busy === "submit" ? "Sending…" : "Send request for review"}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
