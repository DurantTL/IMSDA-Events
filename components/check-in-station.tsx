"use client";

import { Money } from "@/components/exact-value";
import { CheckCircle2, Clock, CreditCard, ShieldAlert, Square, TriangleAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatPersonName } from "@/lib/person-name";
import { CheckInPaymentDue } from "@/components/check-in-payment-due";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { CHECK_IN_AUTO_RETRY_MS, CHECK_IN_REQUEST_TIMEOUT_MS } from "@/components/use-offline-check-in-queue";
import {
  STATION_LOOKUP_OFFLINE_MESSAGE,
  STATION_PAYMENTS_OFFLINE_NOTE,
  STATION_QUEUED_LABEL,
  mapStationSyncResponse,
  purgeOtherStationQueues,
  readStationQueue,
  stationAttentionLine,
  stationQueueBanner,
  stationQueuedAttendeeIds,
  stationQueuedPeopleCount,
  stationStopQueueWarning,
  stationUnsyncedNotice,
  writeStationQueue,
  type StationQueuedBatch,
  type StationSyncOutcome,
} from "@/modules/checkin-stations/offline-queue";
import {
  STATION_BALANCE_NOTE_MAX_LENGTH,
  STATION_BALANCE_REASONS,
  classifyStationEntry,
  parseDollarsToCents,
  stationAttendeeTypeLabel,
  stationBadgeLine,
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

type CheckInAnswer = {
  results: StationCheckInResult[];
  paymentHistory?: StationPaymentHistoryEntry[];
  handOutParts?: { keyTypes: string[]; rooms: Array<{ attendeeId: string; label: string }> };
};

type AttentionEntry = { id: string; name: string; text: string };

type ApiFailure = { error?: string; message?: string };

type PostResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };
type Send = <T>(path: string, body: unknown, timeoutMs?: number) => Promise<PostResult<T>>;

const UNDO_OFFLINE_NOTE = "Undo waits until you're back online.";

function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** No answer (offline, or past the timeout) comes back as status 0. */
async function post<T>(path: string, body: unknown, timeoutMs?: number): Promise<PostResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: timeoutMs && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined,
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
  const [reasonCode, setReasonCode] = useState<StationBalanceReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const [stopped, setStopped] = useState(false);
  const [unsyncedNames, setUnsyncedNames] = useState<string[]>([]);
  const queuedHeading = useRef<HTMLHeadingElement>(null);
  const noHandOut: HandOut = { keyTypes: [], rooms: [], attendeeIds: [] };
  const [handOut, setHandOut] = useState<HandOut>(noHandOut);
  const [justIn, setJustIn] = useState<JustCheckedIn[]>([]);
  const [undoMessage, setUndoMessage] = useState<{ text: string; name?: string } | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ kind: "undo" | "checkin" | "status" | "queued"; id?: string; n: number } | null>(null);
  const undoButtons = useRef<Map<string, HTMLButtonElement>>(new Map());
  const checkInButton = useRef<HTMLButtonElement>(null);
  const undoStatus = useRef<HTMLDivElement>(null);
  const [undoing, setUndoing] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Offline (#1577): check-ins that could not be sent wait on this device, with the same keys, and retry on their own.
  const [online, setOnline] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [queue, setQueue] = useState<StationQueuedBatch[]>([]);
  const queueRef = useRef<StationQueuedBatch[]>([]);
  const [storageFailed, setStorageFailed] = useState(false);
  const [attention, setAttentionState] = useState<AttentionEntry[]>([]);
  // Kept in a ref too, so a stop that happens inside the sync loop sees entries added a moment earlier.
  const attentionRef = useRef<AttentionEntry[]>([]);
  function setAttention(update: (current: AttentionEntry[]) => AttentionEntry[]) {
    attentionRef.current = update(attentionRef.current);
    setAttentionState(attentionRef.current);
  }
  const syncingRef = useRef(false);
  const stoppedRef = useRef(false);
  const familyRef = useRef<StationFamily | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const offline = !online || unreachable;
  const waiting = stationQueuedPeopleCount(queue);
  const queuedIds = stationQueuedAttendeeIds(queue);
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

  // Every request goes through here, so a request with no answer marks the station offline and any answer clears it.
  const send: Send = async (path, body, timeoutMs) => {
    const result = await post<never>(path, body, timeoutMs);
    if (!result.ok && result.status === 0) setUnreachable(true);
    else setUnreachable(false);
    return result;
  };

  function persist(next: StationQueuedBatch[]) {
    queueRef.current = next;
    setQueue(next);
    const kept = writeStationQueue(deviceStorage(), stationId, next);
    setStorageFailed(next.length > 0 && !kept);
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
        : focusTarget.kind === "queued"
          ? queuedHeading.current
          : undoStatus.current;
    (element ?? undoStatus.current)?.focus();
  }, [focusTarget]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      purgeOtherStationQueues(deviceStorage(), stationId);
      const saved = readStationQueue(deviceStorage(), stationId);
      if (saved === null) {
        setStorageFailed(true);
      } else if (saved.length > 0) {
        queueRef.current = saved;
        setQueue(saved);
        void syncRef.current();
      }
    }, 0);
    const goOnline = () => {
      setMessage((current) => (current === STATION_LOOKUP_OFFLINE_MESSAGE ? "" : current));
      setOnline(true);
      setUnreachable(false);
      void syncRef.current();
    };
    const goOffline = () => setOnline(false);
    // A weak link keeps navigator.onLine true, so waiting check-ins also retry on a timer, oldest first, same keys.
    const interval = window.setInterval(() => {
      if (!navigator.onLine) return;
      if (queueRef.current.length > 0) void syncRef.current();
      else setUnreachable(false);
    }, CHECK_IN_AUTO_RETRY_MS);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [stationId]);

  // Only when the device could not keep the queue: leaving the page would lose the waiting check-ins.
  useUnsavedChangesGuard(storageFailed && waiting > 0, "Check-ins are waiting to sync and this device could not save them. Leave this page and lose them?");

  async function syncQueue() {
    if (syncingRef.current || stoppedRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    try {
      for (;;) {
        const batch = queueRef.current[0];
        if (!batch || stoppedRef.current) break;
        const response = await send<CheckInAnswer>("/api/check-in-station/check-in", {
          registrationId: batch.registrationId,
          items: batch.items.map(({ attendeeId, idempotencyKey }) => ({ attendeeId, idempotencyKey })),
          ...(batch.balanceReason ? { balanceReason: batch.balanceReason } : {}),
        }, CHECK_IN_REQUEST_TIMEOUT_MS);
        const outcome = mapStationSyncResponse(batch, response);
        if (outcome.kind === "STOPPED") {
          markStopped();
          break;
        }
        if (outcome.kind === "RETRY_LATER") break;
        persist(queueRef.current.filter((entry) => entry.id !== batch.id));
        applySyncOutcome(batch, outcome, response.ok ? response.data : null);
      }
    } finally {
      syncingRef.current = false;
    }
  }

  function applySyncOutcome(batch: StationQueuedBatch, outcome: Extract<StationSyncOutcome, { kind: "ANSWERED" }>, data: CheckInAnswer | null) {
    const nameOf = (attendeeId: string) => batch.items.find((item) => item.attendeeId === attendeeId)?.name ?? "This person";
    const newlyIn = batch.items.filter((item) => outcome.confirmed.some((entry) => entry.attendeeId === item.attendeeId && entry.newlyCheckedIn));
    if (newlyIn.length > 0) {
      updateJustIn((rows) => [
        ...newlyIn.map((item) => ({ attendeeId: item.attendeeId, name: item.name, confirmationCode: batch.confirmationCode })).reverse(),
        ...rows.filter((row) => !newlyIn.some((item) => item.attendeeId === row.attendeeId)),
      ]);
    }
    if (outcome.attention.length > 0) {
      setAttention((current) => [
        ...current,
        ...outcome.attention.map((entry) => ({ id: `${batch.id}:${entry.attendeeId}`, name: nameOf(entry.attendeeId), text: stationAttentionLine(nameOf(entry.attendeeId), entry) })),
      ]);
    }
    // The hand-out box and the on-screen ticks only matter while that registration is the one in front of staff.
    if (familyRef.current?.registrationId !== batch.registrationId) return;
    const byId: Record<string, StationCheckInResult["status"]> = {};
    for (const entry of outcome.confirmed) byId[entry.attendeeId] = entry.newlyCheckedIn ? "CHECKED_IN" : "ALREADY_CHECKED_IN";
    for (const attendeeId of outcome.needsDeskReview) byId[attendeeId] = "NEEDS_DESK_REVIEW";
    setResults((current) => ({ ...current, ...byId }));
    if (newlyIn.length > 0) {
      setHandOut({
        keyTypes: data?.handOutParts?.keyTypes ?? [],
        rooms: data?.handOutParts?.rooms ?? [],
        attendeeIds: newlyIn.map((item) => item.attendeeId),
      });
    }
    setFamily((current) => (current && current.registrationId === batch.registrationId
      ? {
        ...current,
        paymentHistory: data?.paymentHistory ?? current.paymentHistory,
        attendees: current.attendees.map((person) => {
          const status = byId[person.id];
          return status === "CHECKED_IN" || status === "ALREADY_CHECKED_IN"
            ? { ...person, checkedIn: true }
            : status === "NEEDS_DESK_REVIEW"
              ? { ...person, needsDeskReview: true }
              : person;
        }),
      }
      : current));
  }

  function saveBatchOnDevice(current: StationFamily, items: Array<{ attendeeId: string; idempotencyKey: string }>) {
    const batch: StationQueuedBatch = {
      id: crypto.randomUUID(),
      queuedAt: new Date().toISOString(),
      registrationId: current.registrationId,
      confirmationCode: current.confirmationCode,
      ...(current.payment.state === "DUE" && reasonCode ? { balanceReason: { code: reasonCode, note: reasonNote.trim() } } : {}),
      items: items.map((item) => {
        const person = current.attendees.find((entry) => entry.id === item.attendeeId);
        return { ...item, name: person ? formatPersonName(person) : "Guest" };
      }),
    };
    persist([...queueRef.current, batch]);
    setSelected(new Set());
    // The Check in button is about to stop applying to these people: move focus to where they now are.
    setFocusTarget((previous) => ({ kind: "queued", n: (previous?.n ?? 0) + 1 }));
  }

  useEffect(() => {
    familyRef.current = family;
    syncRef.current = syncQueue;
  });

  function updateJustIn(update: (rows: JustCheckedIn[]) => JustCheckedIn[]) {
    setJustIn((current) => {
      const next = update(current).slice(0, JUST_IN_MAX);
      writeJustIn(stationId, next);
      return next;
    });
  }

  function markStopped() {
    stoppedRef.current = true;
    // Only names are kept, so staff can send these people to the desk; the saved batches themselves are cleared.
    setUnsyncedNames([...new Set([
      ...queueRef.current.flatMap((batch) => batch.items.map((item) => item.name)),
      ...attentionRef.current.map((entry) => entry.name),
    ])]);
    persist([]);
    setAttention(() => []);
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
    if (!navigator.onLine) {
      setMessage(STATION_LOOKUP_OFFLINE_MESSAGE);
      return;
    }
    setBusy("lookup");
    setMessage("");
    setDeskNotice("");
    const response = await send<{ family: StationFamily }>("/api/check-in-station/lookup", lookupInput);
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
    setReasonCode("");
    setReasonNote("");
    setFamily(response.data.family);
    // People still waiting to sync on this device are not ticked: they are already on their way.
    const waitingIds = stationQueuedAttendeeIds(queueRef.current);
    setSelected(new Set(response.data.family.attendees.filter((person) => !person.checkedIn && !person.needsDeskReview && !waitingIds.has(person.id)).map((person) => person.id)));
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
    const ticked = family?.attendees.filter((person) => selected.has(person.id) && !person.checkedIn && !person.needsDeskReview && !queuedIds.has(person.id)) ?? [];
    if (!family || busy || ticked.length === 0) return;
    setBusy("confirm");
    setMessage("");
    setUndoMessage(null);
    const items = ticked
      .map((person) => ({ attendeeId: person.id, idempotencyKey: keyFor(person.id) }));
    if (!navigator.onLine) {
      setOnline(false);
      saveBatchOnDevice(family, items);
      setBusy("");
      return;
    }
    const response = await send<CheckInAnswer>("/api/check-in-station/check-in", {
      registrationId: family.registrationId,
      items,
      ...(family.payment.state === "DUE" && reasonCode
        ? { balanceReason: { code: reasonCode, note: reasonNote.trim() } }
        : {}),
    }, CHECK_IN_REQUEST_TIMEOUT_MS);
    setBusy("");
    if (!response.ok) {
      if (response.status === 401) markStopped();
      // No answer: the server may or may not have it. Save the batch with the same keys; the server replays safely.
      else if (response.status === 0) saveBatchOnDevice(family, items);
      else setMessage(response.message);
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

  async function undoCheckIn(row: JustCheckedIn) {
    if (undoing || offline) return;
    setUndoing(row.attendeeId);
    setUndoMessage(null);
    const response = await send<{ undone: boolean }>("/api/check-in-station/undo", { attendeeId: row.attendeeId });
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
    const response = await send<{ family: StationFamily }>("/api/check-in-station/lookup", { kind: "confirmation", value: family.confirmationCode });
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
    markStopped();
  }

  if (stopped) {
    return (
      <main className={styles.cisShell}>
        <section className={styles.cisCard}>
          <h1>Check-in station</h1>
          <p>This station is not active. Ask a staff member to start it again from Check-in.</p>
          {unsyncedNames.length > 0 && (
            <p role="status" className={styles.cisDeskNotice}>
              <ShieldAlert aria-hidden="true" size={18} />
              <span>{stationUnsyncedNotice(unsyncedNames.length)} <span translate="no">{unsyncedNames.join(", ")}</span></span>
            </p>
          )}
          <p className={styles.cisActions}>
            <Link href="/check-in" className={`secondary-button ${styles.large}`}>Go to Check-in</Link>
          </p>
        </section>
      </main>
    );
  }

  const selectable = family?.attendees.filter((person) => !person.checkedIn && !person.needsDeskReview && !queuedIds.has(person.id)) ?? [];
  const tickedCount = selectable.filter((person) => selected.has(person.id)).length;
  const banner = stationQueueBanner({ offline, waiting, storageFailed });
  const balanceDue = family?.payment.state === "DUE";
  const reasonMissing = balanceDue && (reasonCode === "" || (reasonCode === "OTHER" && reasonNote.trim() === ""));
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

      <div role="status" aria-live="polite" className={styles.cisConnection}>
        {banner && (
          <div className={`${styles.cisBanner} ${banner.tone === "offline" ? styles.cisBannerOffline : styles.cisBannerSyncing}`}>
            <p>
              {banner.tone === "offline" ? <WifiOff aria-hidden="true" size={18} /> : <Clock aria-hidden="true" size={18} />}
              <strong>{banner.text}</strong>
              {banner.waitingLabel && <span className={styles.cisBannerCount}> {banner.waitingLabel}</span>}
            </p>
            {banner.storageWarning && <p className={styles.cisBannerWarn}>{banner.storageWarning}</p>}
          </div>
        )}
      </div>

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
            key={family.registrationId}
            family={family}
            canRecordPayments={canRecordPayments}
            offline={offline}
            send={send}
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
                        <strong translate="no">{person.firstName} {person.lastName}</strong>
                        <span className={styles.cisType}>{stationAttendeeTypeLabel(person.attendeeType)}</span>
                        {person.checkedIn
                          ? <span className={`${styles.cisStatus} ${styles.cisStatusOk}`}><CheckCircle2 aria-hidden="true" size={14} /> {result ? stationResultLabel(result) : "Checked in"}</span>
                          : <span className={`${styles.cisStatus} ${styles.cisStatusHold}`}><TriangleAlert aria-hidden="true" size={14} /> Needs desk review - send to the check-in desk</span>}
                      </span>
                    ) : queuedIds.has(person.id) ? (
                      <span className={styles.cisPersonBody}>
                        <strong translate="no">{formatPersonName(person)}</strong>
                        <span className={styles.cisType}>{stationAttendeeTypeLabel(person.attendeeType)}</span>
                        <span className={`${styles.cisStatus} ${styles.cisStatusQueued}`}><Clock aria-hidden="true" size={14} /> {STATION_QUEUED_LABEL}</span>
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
                ref={checkInButton}
                type="button"
                className={`primary-button ${styles.large}`}
                disabled={busy !== "" || tickedCount === 0 || (reasonMissing && selectable.length > 0)}
                onClick={confirmCheckIn}
              >
                {busy === "confirm" ? "Checking in..." : `Check in${tickedCount ? ` (${tickedCount})` : ""}`}
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
      {queue.length > 0 && (
        <section className={styles.cisCard} aria-labelledby="cis-queued-title">
          <h2 id="cis-queued-title" ref={queuedHeading} tabIndex={-1}>Saved on this device</h2>
          <ul className={styles.cisPeople}>
            {queue.flatMap((batch) => batch.items.map((item) => (
              <li key={`${batch.id}:${item.attendeeId}`} className={`${styles.cisPerson} ${styles.cisQueuedRow}`}>
                <span className={styles.cisPersonBody}>
                  <strong translate="no">{item.name}</strong>
                  <span className={styles.cisType}>Registration <span translate="no">{batch.confirmationCode}</span></span>
                  <span className={`${styles.cisStatus} ${styles.cisStatusQueued}`}><Clock aria-hidden="true" size={14} /> {STATION_QUEUED_LABEL}</span>
                </span>
              </li>
            )))}
          </ul>
        </section>
      )}
      {attention.length > 0 && (
        <section className={`${styles.cisCard} ${styles.cisAttention}`} aria-labelledby="cis-attention-title">
          <h2 id="cis-attention-title">Needs attention</h2>
          <ul className={styles.cisPeople}>
            {attention.map((entry) => (
              <li key={entry.id} className={`${styles.cisPerson} ${styles.cisJustIn}`}>
                <span className={styles.cisPersonBody}>
                  <span className={`${styles.cisStatus} ${styles.cisStatusConflict}`}><TriangleAlert aria-hidden="true" size={14} /> Needs the desk</span>
                  <span translate="no">{entry.text}</span>
                </span>
                <button
                  type="button"
                  className={`secondary-button ${styles.large}`}
                  onClick={() => {
                    setAttention((current) => current.filter((item) => item.id !== entry.id));
                    setFocusTarget((current) => ({ kind: "status", n: (current?.n ?? 0) + 1 }));
                  }}
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {justIn.length > 0 && (
        <section className={styles.cisCard} aria-labelledby="cis-just-in-title">
          <h2 id="cis-just-in-title">Just checked in</h2>
          {offline && <p className={styles.cisHelp}>{UNDO_OFFLINE_NOTE}</p>}
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
                  disabled={undoing !== "" || offline}
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
        {waiting > 0 && <p><strong>{stationStopQueueWarning(waiting)}</strong></p>}
      </ConfirmDialog>
    </main>
  );
}

function PaymentPanel({
  family,
  canRecordPayments,
  offline,
  send: post,
  onPayment,
  onRefresh,
  busy,
  setBusy,
}: {
  family: StationFamily;
  canRecordPayments: boolean;
  offline: boolean;
  send: Send;
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
  const [alreadyHasPayment, setAlreadyHasPayment] = useState(false);
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
    if (offline) return setError(STATION_PAYMENTS_OFFLINE_NOTE);
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
    if (offline) return;
    setSquareOpen(true);
    setNoteOpen(false);
    setError("");
    setNotice("");
    if (!canRecordPayments) return;
    setLoadingCandidates(true);
    setSquareUnavailable(false);
    setAlreadyHasPayment(false);
    const response = await post<{ candidates: StationSquareCandidate[]; unavailable: boolean; alreadyHasPayment: boolean }>(
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
    setAlreadyHasPayment(response.data.alreadyHasPayment === true);
  }

  function closeSquare() {
    setSquareOpen(false);
    setNoteOpen(false);
    setCandidates(null);
    setSquareUnavailable(false);
    setAlreadyHasPayment(false);
    setConfirmCandidate(null);
  }

  function openNoteForm() {
    setNoteOpen(true);
    // The form mounts on the next render; move focus to its first field then.
    setTimeout(() => document.getElementById("cis-square-amount")?.focus(), 0);
  }

  async function matchPayment(candidate: StationSquareCandidate) {
    if (offline) return setError(STATION_PAYMENTS_OFFLINE_NOTE);
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
    if (offline) return setError(STATION_PAYMENTS_OFFLINE_NOTE);
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

          {offline && <p className={styles.cisWarn}>{STATION_PAYMENTS_OFFLINE_NOTE}</p>}
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
                <button type="submit" className={`primary-button ${styles.large}`} disabled={busy || amountOver || offline}>
                  {busy ? "Saving..." : method === "CASH" ? "Record cash received" : "Record check received"}
                </button>
              </fieldset>
            </form>
          )}

          {!squareOpen ? (
            <button type="button" className={`secondary-button ${styles.large}`} onClick={openSquare} disabled={offline}>
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
                    {!loadingCandidates && alreadyHasPayment && (
                      <p className={styles.cisWarn}>This registration already shows a payment, so card payments are matched by finance. Note it for finance to match later.</p>
                    )}
                    {!loadingCandidates && !squareUnavailable && !alreadyHasPayment && candidates !== null && candidates.length === 0 && (
                      <p className={styles.cisHelp}>No unmatched Square payment for this registration yet.</p>
                    )}
                    {candidates && candidates.length > 0 && (
                      <ul className={styles.cisMatchList}>
                        {candidates.map((candidate) => (
                          <li key={candidate.providerPaymentId} className={styles.cisMatchRow}>
                            <span>
                              <strong><Money cents={candidate.amountCents} /></strong>
                              {candidate.whenLabel && <span className={styles.cisType}> {candidate.whenLabel}</span>}
                              {candidate.overBalance && (
                                <span className={styles.cisHelp} id={`cis-over-${candidate.providerPaymentId}`}>
                                  More than the balance due (card fee?)
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className={`primary-button ${styles.large}`}
                              disabled={busy || offline}
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
                      <button type="button" className={`secondary-button ${styles.large}`} onClick={openNoteForm} disabled={busy || loadingCandidates || offline}>
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
                      <button type="submit" className={`primary-button ${styles.large}`} disabled={busy || noteAmountOver || offline}>Note card payment</button>
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
          This Square payment is {confirmCandidate ? <Money cents={confirmCandidate.amountCents} /> : null}, more than the balance due of <Money cents={balanceCents} />.
          That is usually the card fee. The whole amount is recorded, and finance reviews the difference.
        </p>
      </ConfirmDialog>
    </section>
  );
}
