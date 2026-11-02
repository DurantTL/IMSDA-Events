"use client";

import { Money } from "@/components/exact-value";
import { CheckCircle2, CreditCard, ShieldAlert, Square } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { CheckInPaymentDue } from "@/components/check-in-payment-due";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  classifyStationEntry,
  parseDollarsToCents,
  stationAttendeeTypeLabel,
  stationResultLabel,
  type StationCheckInResult,
  type StationFamily,
  type StationPaymentSummary,
} from "@/modules/checkin-stations/domain";
import { formatCents } from "@/modules/payments/format-cents";
import styles from "@/components/check-in-station.module.css";

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
    const response = await post<{ results: StationCheckInResult[] }>("/api/check-in-station/check-in", {
      registrationId: family.registrationId,
      items,
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
    if (response.ok) setFamily((current) => (current ? { ...current, payment: response.data.family.payment } : current));
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
        </section>
      </main>
    );
  }

  const selectable = family?.attendees.filter((person) => !person.checkedIn && !person.needsDeskReview) ?? [];
  const allDone = family !== null && family.attendees.length > 0 && family.attendees.every((person) => person.checkedIn);

  return (
    <main className={styles.cisShell}>
      <header className={styles.cisHeader}>
        <div>
          <p className={styles.cisEyebrow}>Check-in station</p>
          <h1>{eventName}</h1>
          <p className={styles.cisSub}>{stationLabel ? `Station: ${stationLabel}` : "Staff-run station"}</p>
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
            <p className={styles.cisHelp}>Untick anyone who is not here, then confirm.</p>
          )}
          <div className={styles.cisActions}>
            <button
              type="button"
              className={`primary-button ${styles.large}`}
              disabled={busy !== "" || selected.size === 0}
              onClick={confirmCheckIn}
            >
              {busy === "confirm" ? "Checking in..." : `Confirm check-in${selected.size ? ` (${selected.size})` : ""}`}
            </button>
            <button type="button" className={`secondary-button ${styles.large}`} onClick={reset} disabled={busy !== ""}>Next person</button>
          </div>

          <PaymentPanel
            family={family}
            canRecordPayments={canRecordPayments}
            onPayment={(payment) => setFamily((current) => (current ? { ...current, payment } : current))}
            onRefresh={refreshPayment}
            busy={busy === "payment"}
            setBusy={(value) => setBusy(value ? "payment" : "")}
          />
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
  onPayment: (payment: StationPaymentSummary) => void;
  onRefresh: () => Promise<void>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const [method, setMethod] = useState<"CASH" | "CHECK">("CASH");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [squareOpen, setSquareOpen] = useState(false);
  const [squareAmount, setSquareAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const payment = family.payment;
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
    setBusy(true);
    attemptKey.current ??= crypto.randomUUID();
    const response = await post<{ payment: StationPaymentSummary }>("/api/check-in-station/payment", {
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
    onPayment(response.data.payment);
    setNotice(`${method === "CASH" ? "Cash" : "Check"} of ${formatCents(cents)} recorded.`);
    setAmount("");
    setCheckNumber("");
  }

  async function noteSquare(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const cents = parseDollarsToCents(squareAmount);
    if (!cents) return setError("Enter the amount applied to the balance, like 25.00.");
    setBusy(true);
    const response = await post<{ payment: StationPaymentSummary }>("/api/check-in-station/square-app-note", {
      registrationId: family.registrationId,
      amountCents: cents,
      receiptNumber: receipt.trim(),
    });
    setBusy(false);
    if (!response.ok) return setError(response.message);
    onPayment(response.data.payment);
    setNotice("Card payment noted - finance will match it from Square.");
    setSquareOpen(false);
    setSquareAmount("");
    setReceipt("");
  }

  return (
    <section className={styles.cisPayment} aria-labelledby="cis-payment-title">
      <h3 id="cis-payment-title">Payment</h3>
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
                  onChange={(event) => changed(setAmount)(event.target.value)}
                />
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
                <button type="submit" className={`primary-button ${styles.large}`} disabled={busy}>
                  {busy ? "Saving..." : method === "CASH" ? "Record cash received" : "Record check received"}
                </button>
              </fieldset>
            </form>
          )}

          {!squareOpen ? (
            <button type="button" className={`secondary-button ${styles.large}`} onClick={() => { setSquareOpen(true); setError(""); }}>
              <Square aria-hidden="true" size={16} /> Paid by card in Square app
            </button>
          ) : (
            <form className={styles.cisForm} onSubmit={noteSquare}>
              <fieldset>
                <legend>Paid by card in Square app</legend>
                <p className={styles.cisHelp}>This only notes the payment. Finance attaches the real Square payment, so nothing is counted twice.</p>
                <label htmlFor="cis-square-amount">Amount applied to the balance (without the card fee)</label>
                <input id="cis-square-amount" inputMode="decimal" autoComplete="off" value={squareAmount} onChange={(event) => setSquareAmount(event.target.value)} />
                <label htmlFor="cis-square-receipt">Receipt number (optional)</label>
                <input id="cis-square-receipt" autoComplete="off" value={receipt} maxLength={60} onChange={(event) => setReceipt(event.target.value)} />
                <div className={styles.cisActions}>
                  <button type="submit" className={`primary-button ${styles.large}`} disabled={busy}>Note card payment</button>
                  <button type="button" className={`secondary-button ${styles.large}`} onClick={() => setSquareOpen(false)} disabled={busy}>Cancel</button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      <div role="status" aria-live="polite">
        {error && <p className={styles.cisError}>{error}</p>}
        {notice && <p className={styles.cisOk}>{notice}</p>}
      </div>
    </section>
  );
}
