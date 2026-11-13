"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirm } from "@/components/use-confirm";
import type { ActiveStationRow } from "@/modules/checkin-stations/repository";
import { STATION_LABEL_MAX_LENGTH } from "@/modules/checkin-stations/domain";
import styles from "@/components/check-in-stations-panel.module.css";
import { formatInTimeZone } from "@/modules/calendar/conference-format";

function formatWhen(value: string, timeZone: string) {
  try {
    return formatInTimeZone(value, timeZone, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return new Date(value).toISOString();
  }
}

/**
 * Start a station on this device and revoke any active one (#892). Starting needs this signed-in staff session; the
 * device then holds its own station cookie. A revoked station stops working on its next request.
 */
export function CheckInStationsPanel({
  eventId,
  stations,
  timeZone,
  gateModeEnabled = false,
}: {
  eventId: string;
  stations: ActiveStationRow[];
  timeZone: string;
  /** Gate mode (#1684) as saved for this event. */
  gateModeEnabled?: boolean;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function start(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("start");
    setError("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/check-in-stations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "The station could not be started. Try again.");
        setBusy("");
        return;
      }
      router.push("/check-in-station");
    } catch {
      setError("No connection. Check the network and try again.");
      setBusy("");
    }
  }

  async function setGateMode(enabled: boolean) {
    if (busy) return;
    setBusy("gate");
    setError("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/check-in-gate-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? "Gate mode could not be changed. Try again.");
      } else {
        router.refresh();
      }
    } catch {
      setError("No connection. Check the network and try again.");
    }
    setBusy("");
  }

  async function revoke(stationId: string, stationName: string) {
    if (busy) return;
    if (!(await confirm({
      title: `Revoke ${stationName}?`,
      body: <p>That device stops working for check-in.</p>,
      confirmLabel: `Revoke ${stationName}`,
      destructive: true,
    }))) return;
    setBusy(stationId);
    setError("");
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/check-in-stations/${encodeURIComponent(stationId)}`,
        { method: "DELETE", cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? "The station could not be revoked. Try again.");
      } else {
        router.refresh();
      }
    } catch {
      setError("No connection. Check the network and try again.");
    }
    setBusy("");
  }

  return (
    <section className={`panel ${styles.cisPanel}`} aria-labelledby="cis-panel-title">
      {confirmDialog}
      <h2 id="cis-panel-title">Open as a station</h2>
      <p className={styles.cisPanelHelp}>
        Full screen for the check-in table: a staff-run tablet that checks in a whole registration from one code. It
        stays on until the event ends, and you can revoke it here at any time.
      </p>
      <form className={styles.cisPanelStart} onSubmit={start}>
        <label>
          Station name (optional)
          <input
            value={label}
            maxLength={STATION_LABEL_MAX_LENGTH}
            placeholder="Front desk tablet"
            autoComplete="off"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <button type="submit" className="primary-button" disabled={busy !== ""}>
          {busy === "start" ? "Starting..." : "Open as a station on this device"}
        </button>
      </form>
      <div className={styles.cisPanelGate}>
        <p id="cis-gate-help" className={styles.cisPanelHelp}>
          <strong>Gate mode:</strong> lets a station look up people arriving at the gate. Off by default.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={gateModeEnabled}
          aria-describedby="cis-gate-help"
          className={`secondary-button ${styles.cisPanelSwitch}`}
          disabled={busy !== ""}
          onClick={() => void setGateMode(!gateModeEnabled)}
        >
          {busy === "gate" ? "Saving..." : gateModeEnabled ? "Gate mode: On (turn off)" : "Gate mode: Off (turn on)"}
        </button>
      </div>
      <div role="status" aria-live="polite">{error && <p className="form-error">{error}</p>}</div>
      {stations.length === 0 ? (
        <p className={styles.cisPanelHelp}>No stations are active for this event.</p>
      ) : (
        <>
        <h3 className={styles.cisPanelSub}>Active stations</h3>
        <ul className={styles.cisPanelList}>
          {stations.map((station) => (
            <li key={station.id}>
              <div>
                <strong>{station.label || "Unnamed station"}</strong>
                <br />
                Started by {station.startedByName} · {formatWhen(station.startedAt, timeZone)}
                <br />
                Last seen {formatWhen(station.lastSeenAt, timeZone)} · Expires {formatWhen(station.expiresAt, timeZone)}
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={busy !== ""}
                onClick={() => void revoke(station.id, station.label || "unnamed station")}
                aria-label={`Revoke ${station.label || "unnamed station"}`}
              >
                {busy === station.id ? "Revoking..." : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
