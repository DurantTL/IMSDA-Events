"use client";

import { Money } from "@/components/exact-value";
import { CheckCircle2, CreditCard, ShieldAlert, Square } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { CheckInPaymentDue } from "@/components/check-in-payment-due";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  STATION_BALANCE_NOTE_MAX_LENGTH,
  STATION_BALANCE_REASONS,
  classifyStationEntry,
  parseDollarsToCents,
  stationAttendeeTypeLabel,
  stationResultLabel,
  type StationBalanceReasonCode,
  type StationCheckInResult,
  type StationFamily,
  type StationPaymentHistoryEntry,
  type StationPaymentSummary,
  type StationSquareCandidate,
} from "@/modules/checkin-stations/domain";
import { formatCents } from "@/modules/payments/format-cents";
import styles from "@/components/check-in-station.module.css";

type MoneyUpdate = { payment: StationPaymentSummary; paymentHistory?: StationPaymentHistoryEntry[] };

type ApiFailure = { error?: string; message?: string };

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as T & ApiFailure;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: data.message ?? "That did not work. Try again, or send this person to the check-in desk.",
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, message: "No connection. Check the network and try again." };
  }
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The staff-run check-in station screen (#892). It shows only the scanned registration's names and a Paid or
 * Balance due line. Absent people are unticked before Confirm; held people are never selectable; there is no card
 * entry, no badge printing and no self check-in.
 */
export function CheckInStationScreen({
  eventName,
  stationLabel,
  canRecordPayments,
}: {
  eventName: string;
  stationLabel: string;
  canRecordPayments: boolean;
}) {
  const [entry, setEntry] = useState("");
  const [family, setFamily] = useState<StationFamily | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, StationCheckInResult["status"]>>({});
  const [message, setMessage] = useState("");
  const [deskNotice, setDeskNotice] = useState("");
  const [busy, setBusy] = useState<"" | "lookup" | "confirm" | "payment" | "stop">("");
  const [reasonCode, setReasonCode] = useState<StationBalanceReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const [stopped, setStopped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // One key per person for as long as this family is on screen, so a double tap or a retry replays safely.
  const keys = useRef<Map<string, string>>(new Map());

  function keyFor(attendeeId: string) {
    let key = keys.current.get(attendeeId);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(attendeeId, key);
    }
    return key;
  }

  function reset() {
    setFamily(null);
    setSelected(new Set());
    setResults({});
    setMessage("");
    setDeskNotice("");
    setReasonCode("");
    setReasonNote("");
    keys.current = new Map();
    setEntry("");
    inputRef.current?.focus();
  }

  async function lookup(event: FormEvent) {
    event.preventDefault();
    const lookupInput = classifyStationEntry(entry);
    if (!lookupInput || busy) return;
    setBusy("lookup");
    setMessage("");
    setDeskNotice("");
    const response = await post<{ family: StationFamily }>("/api/check-in-station/lookup", lookupInput);
    setBusy("");
    if (!response.ok) {
      if (response.status === 401) setStopped(true);
      setFamily(null);
      if (response.status === 409) setDeskNotice(response.message);
      else setMessage(response.message);
      setEntry("");
      inputRef.current?.focus();
      return;
    }
    keys.current = new Map();
    setResults({});
    setReasonCode("");
    setReasonNote("");
    setFamily(response.data.family);
    setSelected(new Set(response.data.family.attendees.filter((person) => !person.checkedIn && !person.needsDeskReview).map((person) => person.id)));
    setEntry("");
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmCheckIn() {
    if (!family || busy || selected.size === 0) return;
    setBusy("confirm");
    setMessage("");
    const items = family.attendees
      .filter((person) => selected.has(person.id))
      .map((person) => ({ attendeeId: person.id, idempotencyKey: keyFor(person.id) }));
    const response = await post<{ results: StationCheckInResult[]; paymentHistory?: StationPaymentHistoryEntry[] }>("/api/check-in-station/check-in", {
      registrationId: family.registrationId,
      items,
      ...(family.payment.state === "DUE" && reasonCode
        ? { balanceReason: { code: reasonCode, note: reasonNote.trim() } }
        : {}),
    });
    setBusy("");
    if (!response.ok) {
      if (response.status === 401) setStopped(true);
      setMessage(response.message);
      return;
    }
    const byId: Record<string, StationCheckInResult["status"]> = {};
    for (const result of response.data.results) byId[result.attendeeId] = result.status;
    setResults(byId);
    setFamily({
      ...family,
      paymentHistory: response.data.paymentHistory ?? family.paymentHistory,
      attendees: family.attendees.map((person) => {
        const status = byId[person.id];
        return status === "CHECKED_IN" || status === "ALREADY_CHECKED_IN"
          ? { ...person, checkedIn: true }
          : status === "NEEDS_DESK_REVIEW"
            ? { ...person, needsDeskReview: true }
            : person;
      }),
    });
    setSelected(new Set());
  }

  // After a network error on a payment: ask the server for the registration's current balance.
  async function refreshPayment() {
    if (!family) return;
    const response = await post<{ family: StationFamily }>("/api/check-in-station/lookup", { kind: "confirmation", value: family.confirmationCode });
    if (response.ok) {
      setFamily((current) => (current
        ? { ...current, payment: response.data.family.payment, paymentHistory: response.data.family.paymentHistory }
        : current));
    }
  }

  async function stopStation() {
    setBusy("stop");
    setStopError("");
    const response = await post<{ stopped: boolean }>("/api/check-in-station/stop", {});
    setBusy("");
    if (!response.ok && response.status !== 401) {
      setStopError(response.message);
      return;
    }
    setStopping(false);
    setStopped(true);
  }

  if (stopped) {
    return (
      <main className={styles.cisShell}>
        <section className={styles.cisCard}>
          <h1>Check-in station</h1>
          <p>This station is not active. Ask a staff member to start it again from Check-in.</p>
          <p className={styles.cisActions}>
            <Link href="/check-in" className={`secondary-button ${styles.large}`}>Go to Check-in</Link>
          </p>
        </section>
      </main>
    );
  }

  const selectable = family?.attendees.filter((person) => !person.checkedIn && !person.needsDeskReview) ?? [];
  const balanceDue = family?.payment.state === "DUE";
  const reasonMissing = balanceDue && (reasonCode === "" || (reasonCode === "OTHER" && reasonNote.trim() === ""));
  const allDone = family !== null && family.attendees.length > 0 && family.attendees.every((person) => person.checkedIn);

  return (
    <main className={styles.cisShell}>
      <header className={styles.cisBar}>
        <div>
          {stationLabel && <p className={styles.cisEyebrow}>Check-in station</p>}
          <h1>{stationLabel || "Check-in station"}</h1>
          <p className={styles.cisSub}>{eventName}</p>
        </div>
        <button type="button" className={`secondary-button ${styles.large}`} onClick={() => { setStopError(""); setStopping(true); }}>
          Stop station
        </button>
      </header>

      <form className={`${styles.cisCard} ${styles.cisLookup}`} onSubmit={lookup}>
        <label htmlFor="cis-code"><strong>Scan a pass or type the confirmation code</strong></label>
        <div className={styles.cisLookupRow}>
          <input
            id="cis-code"
            ref={inputRef}
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby="cis-code-help"
          />
          <button type="submit" className={`primary-button ${styles.large}`} disabled={busy !== "" || !entry.trim()}>
            {busy === "lookup" ? "Looking up..." : "Find family"}
          </button>
        </div>
        <p id="cis-code-help" className={styles.cisHelp}>A scanner that types the code and presses Enter works here.</p>
        <div role="status" aria-live="polite">
          {message && <p className={styles.cisError}>{message}</p>}
          {deskNotice && <p className={styles.cisDeskNotice}><ShieldAlert aria-hidden="true" size={18} /> {deskNotice}</p>}
        </div>
      </form>

      {family && (
        <section className={styles.cisCard} aria-labelledby="cis-family-title">
          <h2 id="cis-family-title">Registration <span translate="no">{family.confirmationCode}</span></h2>
          {allDone && <p className={styles.cisOk}><CheckCircle2 aria-hidden="true" size={18} /> Everyone on this registration is checked in.</p>}
          <PaymentPanel
            family={family}
            canRecordPayments={canRecordPayments}
            onPayment={({ payment, paymentHistory }) => setFamily((current) => (current
              ? { ...current, payment, paymentHistory: paymentHistory ?? current.paymentHistory }
              : current))}
            onRefresh={refreshPayment}
            busy={busy === "payment"}
            setBusy={(value) => setBusy(value ? "payment" : "")}
          />
          <section className={styles.cisWho} aria-labelledby="cis-who-title">
            <h3 id="cis-who-title">Who is here?</h3>
            <ul className={styles.cisPeople}>
              {family.attendees.map((person) => {
                const result = results[person.id];
                return (
                  <li key={person.id} className={styles.cisPerson}>
                    {person.checkedIn || person.needsDeskReview ? (
                      <span className={styles.cisPersonBody}>
                        <strong>{person.firstName} {person.lastName}</strong>
                        <span className={styles.cisType}>{stationAttendeeTypeLabel(person.attendeeType)}</span>
                        {person.checkedIn
                          ? <span className={`${styles.cisStatus} ${styles.cisStatusOk}`}>{result ? stationResultLabel(result) : "Checked in"}</span>
                          : <span className={`${styles.cisStatus} ${styles.cisStatusHold}`}>Needs desk review - send to the check-in desk</span>}
                      </span>
                    ) : (
                      <label className={`${styles.cisPersonBody} ${styles.cisPersonPick}`}>
                        <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggle(person.id)} />
                        <span>
                          <strong>{person.firstName} {person.lastName}</strong>
                          <span className={styles.cisType}>{stationAttendeeTypeLabel(person.attendeeType)}</span>
                          {result && <span className={`${styles.cisStatus} ${styles.cisStatusHold}`}>{stationResultLabel(result)}</span>}
                        </span>
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            {selectable.length > 0 && (
              <p className={styles.cisHelp}>Untick anyone who is not here yet.</p>
            )}
            {balanceDue && selectable.length > 0 && (
              <fieldset className={styles.cisReason} aria-describedby="cis-reason-help">
                <legend>Why check in with a balance due?</legend>
                <p id="cis-reason-help" className={styles.cisHelp}>Pick one before checking anyone in. It is saved to this registration&apos;s payment history.</p>
                <div className={styles.cisReasonChoices}>
                  {STATION_BALANCE_REASONS.map((reason) => (
                    <label key={reason.code}>
                      <input
                        type="radio"
                        name="cis-balance-reason"
                        checked={reasonCode === reason.code}
                        onChange={() => setReasonCode(reason.code)}
                      />
                      {reason.label}
                    </label>
                  ))}
                </div>
                <label htmlFor="cis-reason-note">{reasonCode === "OTHER" ? "Note (required)" : "Note (optional)"}</label>
                <input
                  id="cis-reason-note"
                  autoComplete="off"
                  maxLength={STATION_BALANCE_NOTE_MAX_LENGTH}
                  value={reasonNote}
                  required={reasonCode === "OTHER"}
                  onChange={(event) => setReasonNote(event.target.value)}
                />
              </fieldset>
            )}
            <div className={styles.cisActions}>
              <button
                type="button"
                className={`primary-button ${styles.large}`}
                disabled={busy !== "" || selected.size === 0 || (reasonMissing && selectable.length > 0)}
                onClick={confirmCheckIn}
              >
                {busy === "confirm" ? "Checking in..." : `Check in${selected.size ? ` (${selected.size})` : ""}`}
              </button>
              <button type="button" className={`secondary-button ${styles.large}`} onClick={reset} disabled={busy !== ""}>Next person</button>
            </div>

          </section>
        </section>
      )}

      <ConfirmDialog
        busy={busy === "stop"}
        busyLabel="Stopping..."
        confirmLabel="Stop station"
        destructive
        error={stopError}
        onCancel={() => setStopping(false)}
        onConfirm={stopStation}
        open={stopping}
        title="Stop this station?"
      >
        <p>This device will go back to the &quot;not active&quot; screen. Staff can start it again from Check-in.</p>
      </ConfirmDialog>
    </main>
  );
}

function PaymentPanel({
  family,
  canRecordPayments,
  onPayment,
  onRefresh,
  busy,
  setBusy,
}: {
  family: StationFamily;
  canRecordPayments: boolean;
  onPayment: (update: MoneyUpdate) => void;
  onRefresh: () => Promise<void>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const [method, setMethod] = useState<"CASH" | "CHECK">("CASH");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [squareOpen, setSquareOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [candidates, setCandidates] = useState<StationSquareCandidate[] | null>(null);
  const [squareUnavailable, setSquareUnavailable] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [confirmCandidate, setConfirmCandidate] = useState<StationSquareCandidate | null>(null);
  const [squareAmount, setSquareAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const payment = family.payment;
  const balanceCents = payment.state === "DUE" ? payment.balanceCents : 0;
  const noteFormVisible = squareOpen && (!canRecordPayments || noteOpen);
  const typedCents = parseDollarsToCents(amount);
  const typedNoteCents = parseDollarsToCents(squareAmount);
  const overBalanceMessage = `That is more than the balance due of ${formatCents(balanceCents)}. Enter the amount actually received, up to the balance.`;
  const amountOver = typedCents !== null && typedCents > balanceCents;
  const noteAmountOver = typedNoteCents !== null && typedNoteCents > balanceCents;
  // Unsaved work: a typed cash or check amount or check number, or an open card-note form holding an amount or receipt,
  // until it is recorded or cancelled. The lookup box and attendee ticks are not (#1468).
  useUnsavedChangesGuard(amount.trim() !== "" || (method === "CHECK" && checkNumber.trim() !== "") || (squareOpen && (squareAmount.trim() !== "" || receipt.trim() !== "")));
  // One key per submission attempt: kept across retries of the same attempt, replaced after a success or when the
  // form changes, so a lost response never records the same money twice.
  const attemptKey = useRef<string | null>(null);
  function changed<T>(setter: (value: T) => void) {
    return (value: T) => {
      attemptKey.current = null;
      setter(value);
    };
  }

  async function recordReceived(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const cents = parseDollarsToCents(amount || (payment.state === "DUE" ? (payment.balanceCents / 100).toFixed(2) : ""));
    if (!cents) return setError("Enter the amount received, like 25.00.");
    if (method === "CHECK" && !checkNumber.trim()) return setError("Enter the check number.");
    if (cents > balanceCents) return setError(overBalanceMessage);
    setBusy(true);
    attemptKey.current ??= crypto.randomUUID();
    const response = await post<MoneyUpdate>("/api/check-in-station/payment", {
      registrationId: family.registrationId,
      method,
      amountCents: cents,
      checkNumber: method === "CHECK" ? checkNumber.trim() : "",
      idempotencyKey: attemptKey.current,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      // No answer, or a server error: the payment may or may not have been saved. Refresh the balance, and do not
      // invite a plain resubmit. The same attempt key stays, so a repeat of this exact entry replays safely.
      if (response.status === 0 || response.status >= 500) {
        await onRefresh();
        setError("This payment may already be recorded. Check the balance above before recording again.");
      }
      return;
    }
    attemptKey.current = null;
    onPayment(response.data);
    setNotice(`${method === "CASH" ? "Cash" : "Check"} of ${formatCents(cents)} recorded.`);
    setAmount("");
    setCheckNumber("");
  }

  async function openSquare() {
    setSquareOpen(true);
    setNoteOpen(false);
    setError("");
    setNotice("");
    if (!canRecordPayments) return;
    setLoadingCandidates(true);
    setSquareUnavailable(false);
    const response = await post<{ candidates: StationSquareCandidate[]; unavailable: boolean }>(
      "/api/check-in-station/square-unmatched",
      { registrationId: family.registrationId },
    );
    setLoadingCandidates(false);
    if (!response.ok) {
      setCandidates([]);
      setSquareUnavailable(true);
      return;
    }
    setCandidates(response.data.candidates);
    setSquareUnavailable(response.data.unavailable);
  }

  function closeSquare() {
    setSquareOpen(false);
    setNoteOpen(false);
    setCandidates(null);
    setSquareUnavailable(false);
    setConfirmCandidate(null);
  }

  async function matchPayment(candidate: StationSquareCandidate) {
    setError("");
    setNotice("");
    setBusy(true);
    const response = await post<MoneyUpdate>("/api/check-in-station/square-match", {
      registrationId: family.registrationId,
      providerPaymentId: candidate.providerPaymentId,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      if (response.status === 0 || response.status >= 500) await onRefresh();
      return;
    }
    setConfirmCandidate(null);
    onPayment(response.data);
    setNotice(`Card payment of ${formatCents(candidate.amountCents)} matched.`);
    closeSquare();
  }

  async function noteSquare(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const cents = parseDollarsToCents(squareAmount);
    if (!cents) return setError("Enter the amount applied to the balance, like 25.00.");
    if (cents > balanceCents) return setError(overBalanceMessage);
    setBusy(true);
    const response = await post<MoneyUpdate>("/api/check-in-station/square-app-note", {
      registrationId: family.registrationId,
      amountCents: cents,
      receiptNumber: receipt.trim(),
    });
    setBusy(false);
    if (!response.ok) return setError(response.message);
    onPayment(response.data);
    setNotice("Card payment noted - finance will match it from Square.");
    setSquareOpen(false);
    setNoteOpen(false);
    setSquareAmount("");
    setReceipt("");
  }

  return (
    <section className={styles.cisPayment} aria-labelledby="cis-payment-title">
      <h3 id="cis-payment-title">Money</h3>
      {payment.state === "BILLED_TO_GROUP" && <p className={styles.cisOk}>Billed to the church/group. Nothing to collect here.</p>}
      {payment.state === "PAID" && <p className={styles.cisOk}><CheckCircle2 aria-hidden="true" size={18} /> Paid</p>}
      {payment.state === "DUE" && (
        <>
          <p className={styles.cisDue}><CreditCard aria-hidden="true" size={18} /> <strong>Balance due <Money cents={payment.balanceCents} /></strong></p>
          {payment.squareAppNote && (
            <p className={styles.cisHelp}>Card payment noted - finance will match it from Square. The balance stays until they do.</p>
          )}
          <CheckInPaymentDue
            balanceCents={payment.balanceCents}
            confirmationCode={family.confirmationCode}
            partySize={family.attendees.length}
          />
          <p className={styles.cisHelp}>
            The payer can also pay privately on their phone from the manage link in their confirmation email.
          </p>

          {canRecordPayments && (
            <form className={styles.cisForm} onSubmit={recordReceived}>
              <fieldset>
                <legend>Cash or check received</legend>
                <div className={styles.cisChoice}>
                  <label><input type="radio" name="cis-method" checked={method === "CASH"} onChange={() => changed(setMethod)("CASH")} /> Cash</label>
                  <label><input type="radio" name="cis-method" checked={method === "CHECK"} onChange={() => changed(setMethod)("CHECK")} /> Check</label>
                </div>
                <label htmlFor="cis-amount">Amount received</label>
                <input
                  id="cis-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  placeholder={(payment.balanceCents / 100).toFixed(2)}
                  aria-describedby={amountOver ? "cis-amount-warning" : undefined}
                  aria-invalid={amountOver || undefined}
                  onChange={(event) => changed(setAmount)(event.target.value)}
                />
                {amountOver && <p id="cis-amount-warning" className={styles.cisWarn}>{overBalanceMessage}</p>}
                {method === "CHECK" && (
                  <>
                    <label htmlFor="cis-check-number">Check number</label>
                    <input
                      id="cis-check-number"
                      autoComplete="off"
                      value={checkNumber}
                      maxLength={40}
                      onChange={(event) => changed(setCheckNumber)(event.target.value)}
                      required
                    />
                  </>
                )}
                <button type="submit" className={`primary-button ${styles.large}`} disabled={busy || amountOver}>
                  {busy ? "Saving..." : method === "CASH" ? "Record cash received" : "Record check received"}
                </button>
              </fieldset>
            </form>
          )}

          {!squareOpen ? (
            <button type="button" className={`secondary-button ${styles.large}`} onClick={openSquare}>
              <Square aria-hidden="true" size={16} /> Paid by card in Square app
            </button>
          ) : (
            <section className={styles.cisForm} aria-labelledby="cis-square-title">
              <fieldset>
                <legend id="cis-square-title">Paid by card in Square app</legend>
                {canRecordPayments && (
                  <div className={styles.cisMatch}>
                    <p className={styles.cisHelp}>Today&apos;s card payments from the reader that Square ties to this registration.</p>
                    {loadingCandidates && <p className={styles.cisHelp} role="status">Looking for today&apos;s Square payments...</p>}
                    {!loadingCandidates && squareUnavailable && (
                      <p className={styles.cisWarn}>Square could not be reached. Note it for finance to match later.</p>
                    )}
                    {!loadingCandidates && !squareUnavailable && candidates !== null && candidates.length === 0 && (
                      <p className={styles.cisHelp}>No unmatched Square payment for this registration yet.</p>
                    )}
                    {candidates && candidates.length > 0 && (
                      <ul className={styles.cisMatchList}>
                        {candidates.map((candidate) => (
                          <li key={candidate.providerPaymentId} className={styles.cisMatchRow}>
                            <span>
                              <strong>{formatCents(candidate.amountCents)}</strong>
                              {candidate.createdAt && <span className={styles.cisType}> {formatTime(candidate.createdAt)}</span>}
                              {candidate.overBalance && (
                                <span className={styles.cisHelp} id={`cis-over-${candidate.providerPaymentId}`}>
                                  More than the balance due (card fee?)
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className={`primary-button ${styles.large}`}
                              disabled={busy}
                              aria-describedby={candidate.overBalance ? `cis-over-${candidate.providerPaymentId}` : undefined}
                              onClick={() => (candidate.overBalance ? setConfirmCandidate(candidate) : matchPayment(candidate))}
                            >
                              Match
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!noteOpen && (
                      <button type="button" className={`secondary-button ${styles.large}`} onClick={() => setNoteOpen(true)} disabled={busy || loadingCandidates}>
                        Not listed? Note it for finance to match later
                      </button>
                    )}
                  </div>
                )}
                {noteFormVisible && (
                  <form className={styles.cisNoteForm} onSubmit={noteSquare}>
                    <p className={styles.cisHelp}>This only notes the payment. Finance attaches the real Square payment, so nothing is counted twice.</p>
                    <label htmlFor="cis-square-amount">Amount applied to the balance (without the card fee)</label>
                    <input
                      id="cis-square-amount"
                      inputMode="decimal"
                      autoComplete="off"
                      value={squareAmount}
                      aria-describedby={noteAmountOver ? "cis-square-warning" : undefined}
                      aria-invalid={noteAmountOver || undefined}
                      onChange={(event) => setSquareAmount(event.target.value)}
                    />
                    {noteAmountOver && <p id="cis-square-warning" className={styles.cisWarn}>{overBalanceMessage}</p>}
                    <label htmlFor="cis-square-receipt">Receipt number (optional)</label>
                    <input id="cis-square-receipt" autoComplete="off" value={receipt} maxLength={60} onChange={(event) => setReceipt(event.target.value)} />
                    <div className={styles.cisActions}>
                      <button type="submit" className={`primary-button ${styles.large}`} disabled={busy || noteAmountOver}>Note card payment</button>
                    </div>
                  </form>
                )}
                <div className={styles.cisActions}>
                  <button type="button" className={`secondary-button ${styles.large}`} onClick={closeSquare} disabled={busy}>Cancel</button>
                </div>
              </fieldset>
            </section>
          )}
        </>
      )}
      <div role="status" aria-live="polite">
        {error && <p className={styles.cisError}>{error}</p>}
        {notice && <p className={styles.cisOk}>{notice}</p>}
      </div>
      {family.paymentHistory.length > 0 && (
        <div className={styles.cisHistory}>
          <h4 id="cis-history-title">Payment history</h4>
          <ul aria-labelledby="cis-history-title">
            {family.paymentHistory.map((entry) => (
              <li key={entry.id}>
                <span>{entry.text}</span>
                <span className={styles.cisHelp}>{entry.whenLabel}{entry.stationLabel ? ` at ${entry.stationLabel}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        busy={busy}
        busyLabel="Matching..."
        confirmLabel="Match this payment"
        error={confirmCandidate ? error : ""}
        onCancel={() => { setConfirmCandidate(null); setError(""); }}
        onConfirm={() => (confirmCandidate ? matchPayment(confirmCandidate) : Promise.resolve())}
        open={confirmCandidate !== null}
        title="Match a payment that is more than the balance?"
      >
        <p>
          This Square payment is {confirmCandidate ? formatCents(confirmCandidate.amountCents) : ""}, more than the balance due of {formatCents(balanceCents)}.
          That is usually the card fee. The whole amount is recorded, and finance reviews the difference.
        </p>
      </ConfirmDialog>
    </section>
  );
}
