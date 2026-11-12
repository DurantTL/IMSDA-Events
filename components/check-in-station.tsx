"use client";

import { Money } from "@/components/exact-value";
import { CheckCircle2, CreditCard, ShieldAlert, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatPersonName } from "@/lib/person-name";
import { CheckInPaymentDue } from "@/components/check-in-payment-due";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  classifyStationEntry,
  parseDollarsToCents,
  stationAttendeeTypeLabel,
  stationBadgeLine,
  stationResultLabel,
  type StationCheckInResult,
  type StationFamily,
  type StationPaymentSummary,
} from "@/modules/checkin-stations/domain";
import { formatCents } from "@/modules/payments/format-cents";
import styles from "@/components/check-in-station.module.css";

type JustCheckedIn = { attendeeId: string; name: string; confirmationCode: string };

const JUST_IN_KEY = "imsda-check-in-station-just-in";
const JUST_IN_MAX = 10;

/** Saved with the station's id, so a list left by another station on this device is never shown. */
function readJustIn(stationId: string): JustCheckedIn[] {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(JUST_IN_KEY) ?? "null");
    if (!saved || typeof saved !== "object" || (saved as { stationId?: unknown }).stationId !== stationId) return [];
    const parsed = (saved as { rows?: unknown }).rows;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is JustCheckedIn => Boolean(row) && typeof row.attendeeId === "string" && typeof row.name === "string" && typeof row.confirmationCode === "string")
      .slice(0, JUST_IN_MAX);
  } catch {
    return [];
  }
}

function writeJustIn(stationId: string, rows: JustCheckedIn[]) {
  try {
    if (rows.length === 0) window.sessionStorage.removeItem(JUST_IN_KEY);
    else window.sessionStorage.setItem(JUST_IN_KEY, JSON.stringify({ stationId, rows }));
  } catch {
    // Private windows and blocked storage: the list still works for this page load.
  }
}

type HandOut = { keyTypes: string[]; rooms: Array<{ attendeeId: string; label: string }>; attendeeIds: string[] };

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
  stationId,
  eventName,
  stationLabel,
  canRecordPayments,
}: {
  stationId: string;
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
  const noHandOut: HandOut = { keyTypes: [], rooms: [], attendeeIds: [] };
  const [handOut, setHandOut] = useState<HandOut>(noHandOut);
  const [justIn, setJustIn] = useState<JustCheckedIn[]>([]);
  const [undoMessage, setUndoMessage] = useState<{ text: string; name?: string } | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ kind: "undo" | "checkin" | "status"; id?: string; n: number } | null>(null);
  const undoButtons = useRef<Map<string, HTMLButtonElement>>(new Map());
  const checkInButton = useRef<HTMLButtonElement>(null);
  const undoStatus = useRef<HTMLDivElement>(null);
  const [undoing, setUndoing] = useState("");
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

  // Read after mount so the server and the first client render agree.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readJustIn(stationId);
      if (saved.length > 0) setJustIn((current) => (current.length > 0 ? current : saved));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stationId]);

  useEffect(() => {
    if (!focusTarget) return;
    const element = focusTarget.kind === "undo" && focusTarget.id
      ? undoButtons.current.get(focusTarget.id)
      : focusTarget.kind === "checkin"
        ? checkInButton.current
        : undoStatus.current;
    (element ?? undoStatus.current)?.focus();
  }, [focusTarget]);

  function updateJustIn(update: (rows: JustCheckedIn[]) => JustCheckedIn[]) {
    setJustIn((current) => {
      const next = update(current).slice(0, JUST_IN_MAX);
      writeJustIn(stationId, next);
      return next;
    });
  }

  function markStopped() {
    setJustIn([]);
    writeJustIn(stationId, []);
    setStopped(true);
  }

  function reset() {
    setHandOut(noHandOut);
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
      if (response.status === 401) markStopped();
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
    setUndoMessage(null);
    const items = family.attendees
      .filter((person) => selected.has(person.id))
      .map((person) => ({ attendeeId: person.id, idempotencyKey: keyFor(person.id) }));
    const response = await post<{ results: StationCheckInResult[]; handOutParts?: { keyTypes: string[]; rooms: Array<{ attendeeId: string; label: string }> } }>("/api/check-in-station/check-in", {
      registrationId: family.registrationId,
      items,
    });
    setBusy("");
    if (!response.ok) {
      if (response.status === 401) markStopped();
      setMessage(response.message);
      return;
    }
    const byId: Record<string, StationCheckInResult["status"]> = {};
    for (const result of response.data.results) byId[result.attendeeId] = result.status;
    setResults(byId);
    const newlyIn = family.attendees.filter((person) => byId[person.id] === "CHECKED_IN");
    if (newlyIn.length > 0) {
      setHandOut({
        keyTypes: response.data.handOutParts?.keyTypes ?? [],
        rooms: response.data.handOutParts?.rooms ?? [],
        attendeeIds: newlyIn.map((person) => person.id),
      });
      updateJustIn((rows) => [
        ...newlyIn.map((person) => ({ attendeeId: person.id, name: formatPersonName(person), confirmationCode: family.confirmationCode })).reverse(),
        ...rows.filter((row) => !newlyIn.some((person) => person.id === row.attendeeId)),
      ]);
    }
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

  async function undoCheckIn(row: JustCheckedIn) {
    if (undoing) return;
    setUndoing(row.attendeeId);
    setUndoMessage(null);
    const response = await post<{ undone: boolean }>("/api/check-in-station/undo", { attendeeId: row.attendeeId });
    setUndoing("");
    const index = justIn.findIndex((item) => item.attendeeId === row.attendeeId);
    const neighbour = justIn[index + 1] ?? justIn[index - 1];
    const onScreen = family?.attendees.some((person) => person.id === row.attendeeId) ?? false;
    // Focus goes to the next Undo, or (list now empty) the Check in button when this person can be checked in
    // again, or the status message.
    const afterRemoval = () => setFocusTarget((current) => ({
      ...(neighbour
        ? { kind: "undo" as const, id: neighbour.attendeeId }
        : { kind: onScreen ? ("checkin" as const) : ("status" as const) }),
      n: (current?.n ?? 0) + 1,
    }));
    if (!response.ok) {
      if (response.status === 401) return markStopped();
      setUndoMessage({ text: response.message });
      // Retrying cannot help once the server has answered: the person was already undone, or can only be undone at the desk.
      if (response.status >= 400 && response.status < 500) {
        updateJustIn((rows) => rows.filter((item) => item.attendeeId !== row.attendeeId));
        if (neighbour) afterRemoval();
        else setFocusTarget((current) => ({ kind: "status", n: (current?.n ?? 0) + 1 }));
      } else {
        setFocusTarget((current) => ({ kind: "undo", id: row.attendeeId, n: (current?.n ?? 0) + 1 }));
      }
      return;
    }
    updateJustIn((rows) => rows.filter((item) => item.attendeeId !== row.attendeeId));
    setUndoMessage({ text: "", name: row.name });
    setHandOut((current) => ({ ...current, attendeeIds: current.attendeeIds.filter((id) => id !== row.attendeeId) }));
    if (onScreen && family) {
      // A new key, so checking them in again is a new check-in and not a replay of the undone one.
      keys.current.delete(row.attendeeId);
      setFamily({
        ...family,
        attendees: family.attendees.map((person) => (person.id === row.attendeeId ? { ...person, checkedIn: false } : person)),
      });
      setResults((current) => {
        const next = { ...current };
        delete next[row.attendeeId];
        return next;
      });
      setSelected((current) => new Set(current).add(row.attendeeId));
    }
    afterRemoval();
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
    markStopped();
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
  const remainingIds = new Set(handOut.attendeeIds);
  const handOutRooms = [...new Set(handOut.rooms.filter((room) => remainingIds.has(room.attendeeId)).map((room) => room.label))]
    .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const handOutLines: Array<{ prefix: string; room: string | null }> = remainingIds.size === 0 ? [] : [
    { prefix: stationBadgeLine(remainingIds.size), room: null },
    ...handOut.keyTypes.flatMap((type) => handOutRooms.map((label) => ({ prefix: type, room: label }))),
  ];
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
          <div role="status" aria-live="polite">
            {handOutLines.length > 0 && (
              <section className={styles.cisHandOut} aria-labelledby="cis-handout-title">
                <h3 id="cis-handout-title">Hand out</h3>
                <ul>
                  {handOutLines.map((line) => (
                    <li key={`${line.prefix}|${line.room ?? ""}`}>
                      {line.prefix}{line.room !== null && <> <span translate="no">{line.room}</span></>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <PaymentPanel
            family={family}
            canRecordPayments={canRecordPayments}
            onPayment={(payment) => setFamily((current) => (current ? { ...current, payment } : current))}
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
                        <strong translate="no">{person.firstName} {person.lastName}</strong>
                        <span className={styles.cisType}>{stationAttendeeTypeLabel(person.attendeeType)}</span>
                        {person.checkedIn
                          ? <span className={`${styles.cisStatus} ${styles.cisStatusOk}`}>{result ? stationResultLabel(result) : "Checked in"}</span>
                          : <span className={`${styles.cisStatus} ${styles.cisStatusHold}`}>Needs desk review - send to the check-in desk</span>}
                      </span>
                    ) : (
                      <label className={`${styles.cisPersonBody} ${styles.cisPersonPick}`}>
                        <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggle(person.id)} />
                        <span>
                          <strong translate="no">{person.firstName} {person.lastName}</strong>
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
            <div className={styles.cisActions}>
              <button
                ref={checkInButton}
                type="button"
                className={`primary-button ${styles.large}`}
                disabled={busy !== "" || selected.size === 0}
                onClick={confirmCheckIn}
              >
                {busy === "confirm" ? "Checking in..." : `Check in${selected.size ? ` (${selected.size})` : ""}`}
              </button>
              <button type="button" className={`secondary-button ${styles.large}`} onClick={reset} disabled={busy !== ""}>Next person</button>
            </div>

          </section>
        </section>
      )}

      <div role="status" aria-live="polite" className={styles.cisUndoStatus} ref={undoStatus} tabIndex={-1}>
        {undoMessage && (
          <p className={styles.cisHelp}>
            {undoMessage.name ? <>Check-in undone for <span translate="no">{undoMessage.name}</span>.</> : undoMessage.text}
          </p>
        )}
      </div>
      {justIn.length > 0 && (
        <section className={styles.cisCard} aria-labelledby="cis-just-in-title">
          <h2 id="cis-just-in-title">Just checked in</h2>
          <ul className={styles.cisPeople}>
            {justIn.map((row) => (
              <li key={row.attendeeId} className={`${styles.cisPerson} ${styles.cisJustIn}`}>
                <span className={styles.cisPersonBody}>
                  <strong translate="no">{row.name}</strong>
                  <span className={styles.cisType}>Registration <span translate="no">{row.confirmationCode}</span></span>
                </span>
                <button
                  ref={(element) => {
                    if (element) undoButtons.current.set(row.attendeeId, element);
                    else undoButtons.current.delete(row.attendeeId);
                  }}
                  type="button"
                  className={`secondary-button ${styles.large}`}
                  aria-label={`Undo check-in for ${row.name}`}
                  disabled={undoing !== ""}
                  onClick={() => undoCheckIn(row)}
                >
                  {undoing === row.attendeeId ? "Undoing..." : "Undo"}
                </button>
              </li>
            ))}
          </ul>
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
