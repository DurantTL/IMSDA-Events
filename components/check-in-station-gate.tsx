"use client";

import { CheckCircle2, ShieldAlert, WifiOff, XCircle } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import {
  GATE_NAME_MESSAGE,
  GATE_NAME_MIN_LENGTH,
  classifyGateEntry,
  gateStateLabel,
  gateStateReminder,
  type GateArrivalResponse,
  type GateLookupResponse,
  type GateResult,
  type GateState,
} from "@/modules/checkin-stations/domain";
import styles from "@/components/check-in-station-gate.module.css";

export type StationMode = "check-in" | "gate";

type SendResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };
type GateSend = <T>(path: string, body: unknown) => Promise<SendResult<T>>;

export const GATE_OFFLINE_MESSAGE = "You're offline. Gate lookups need a connection, so nothing is saved for later. Look the person up again once you're back online.";

/** Check-in | Gate. Only shown while the event has gate mode on. */
export function StationModeSwitch({ mode, onChange }: { mode: StationMode; onChange: (mode: StationMode) => void }) {
  return (
    <div className={styles.modeSwitch} role="group" aria-label="Station mode">
      {(["check-in", "gate"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={`secondary-button ${styles.modeButton}`}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {value === "gate" ? "Gate" : "Check-in"}
        </button>
      ))}
    </div>
  );
}

function StateIcon({ state }: { state: GateState }) {
  if (state === "REGISTERED") return <CheckCircle2 aria-hidden="true" size={22} />;
  if (state === "STERLING_NOT_CURRENT") return <ShieldAlert aria-hidden="true" size={22} />;
  return <XCircle aria-hidden="true" size={22} />;
}

function stateClass(state: GateState) {
  return state === "REGISTERED" ? styles.stateGreen : state === "STERLING_NOT_CURRENT" ? styles.stateYellow : styles.stateRed;
}

/**
 * Gate mode (#1684): one box for a name or a scanned pass, large result cards with the status in words, and an
 * optional "Log arrival at gate". Lookups need a connection and are never queued. Shows only what the server sends:
 * name, club, registered or not, Sterling for adults.
 */
export function CheckInStationGate({
  offline,
  send,
  onStopped,
}: {
  offline: boolean;
  send: GateSend;
  onStopped: () => void;
}) {
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [response, setResponse] = useState<GateLookupResponse | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, string>>({});
  const [arriving, setArriving] = useState("");
  const [arrivalError, setArrivalError] = useState("");
  const keys = useRef(new Map<string, string>());
  const inputRef = useRef<HTMLInputElement>(null);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    const input = classifyGateEntry(entry);
    if (!input || busy) return;
    if (input.kind === "name" && input.value.length < GATE_NAME_MIN_LENGTH) {
      setFieldError(GATE_NAME_MESSAGE);
      setResponse(null);
      inputRef.current?.focus();
      return;
    }
    setFieldError("");
    if (offline || !navigator.onLine) {
      setError(GATE_OFFLINE_MESSAGE);
      return;
    }
    setBusy(true);
    setError("");
    setArrivalError("");
    const result = await send<GateLookupResponse>("/api/check-in-station/gate-lookup", input);
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401) onStopped();
      setResponse(null);
      setError(result.message);
      return;
    }
    setResponse(result.data);
    // A pass is a one-time scan: clear the box for the next one. A typed name stays so it can be refined.
    if (input.kind === "pass") setEntry("");
  }

  async function logArrival(person: GateResult) {
    if (arriving) return;
    if (offline || !navigator.onLine) {
      setArrivalError(GATE_OFFLINE_MESSAGE);
      return;
    }
    setArriving(person.attendeeId);
    setArrivalError("");
    // One key per person until it succeeds, so a retry after a lost answer is the same arrival.
    const key = keys.current.get(person.attendeeId) ?? crypto.randomUUID();
    keys.current.set(person.attendeeId, key);
    const result = await send<GateArrivalResponse>("/api/check-in-station/gate-arrival", {
      attendeeId: person.attendeeId,
      idempotencyKey: key,
    });
    setArriving("");
    if (!result.ok) {
      if (result.status === 401) onStopped();
      setArrivalError(result.message);
      return;
    }
    keys.current.delete(person.attendeeId);
    setArrivals((current) => ({ ...current, [person.attendeeId]: result.data.arrivedAtLabel }));
  }

  const results = response?.results ?? [];
  return (
    <section className={styles.gate} aria-label="Gate lookup">
      <form className={styles.gateCard} onSubmit={lookup}>
        <label htmlFor="cis-gate-entry"><strong>Search a name or scan a pass</strong></label>
        <div className={styles.gateRow}>
          <input
            id="cis-gate-entry"
            ref={inputRef}
            value={entry}
            onChange={(event) => { setEntry(event.target.value); setFieldError(""); }}
            maxLength={768}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby={fieldError ? "cis-gate-help cis-gate-field-error" : "cis-gate-help"}
            aria-invalid={fieldError ? true : undefined}
          />
          <button type="submit" className={`primary-button ${styles.gateButton}`} disabled={busy || !entry.trim()}>
            {busy ? "Looking up..." : "Look up"}
          </button>
        </div>
        <p id="cis-gate-help" className={styles.gateHelp}>Shows only name, club and whether they are registered. Sterling status shows for adults.</p>
        {offline && (
          <p className={styles.gateOffline}>
            <WifiOff aria-hidden="true" size={18} /> <span>{GATE_OFFLINE_MESSAGE}</span>
          </p>
        )}
      </form>

      <div role="status" aria-live="polite" className={styles.gateResults}>
        {fieldError && <p id="cis-gate-field-error" className={styles.gateError}>{fieldError}</p>}
        {error && <p className={styles.gateError}>{error}</p>}
        {(response?.outcome === "SEARCH_BY_NAME" || response?.outcome === "NAME_OR_PASS_ONLY") && <p className={styles.gateNotice}>{response.message}</p>}
        {response?.outcome === "NOT_REGISTERED" && (
          <article className={`${styles.gateResult} ${stateClass("NOT_REGISTERED")}`}>
            <p className={styles.gateStatus}><StateIcon state="NOT_REGISTERED" /> {gateStateLabel("NOT_REGISTERED")}</p>
            <p className={styles.gateReminder}>{gateStateReminder("NOT_REGISTERED")}</p>
          </article>
        )}
        {results.map((person) => {
          const arrivedLabel = arrivals[person.attendeeId] ?? person.arrivedAtLabel;
          return (
            <article key={person.attendeeId} className={`${styles.gateResult} ${stateClass(person.state)}`}>
              <h2 className={styles.gateName} translate="no">{person.displayName}</h2>
              {person.clubName && <p className={styles.gateClub} translate="no">{person.clubName}</p>}
              <p className={styles.gateStatus}>
                <StateIcon state={person.state} /> {gateStateLabel(person.state)}
              </p>
              <p className={styles.gateReminder}>{gateStateReminder(person.state)}</p>
              {arrivedLabel ? (
                <p className={styles.gateArrived}>Arrived at gate {arrivedLabel}</p>
              ) : (
                <button
                  type="button"
                  className={`secondary-button ${styles.gateButton}`}
                  disabled={arriving !== "" || offline}
                  onClick={() => void logArrival(person)}
                >
                  {arriving === person.attendeeId ? "Logging..." : "Log arrival at gate"}
                </button>
              )}
            </article>
          );
        })}
        {response?.moreAvailable && <p className={styles.gateNotice}>More people match. Type more of the name to narrow it down.</p>}
        {arrivalError && <p className={styles.gateError}>{arrivalError}</p>}
      </div>
    </section>
  );
}
