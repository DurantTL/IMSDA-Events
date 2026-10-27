"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ActiveStationRow } from "@/modules/checkin-stations/repository";
import { STATION_LABEL_MAX_LENGTH } from "@/modules/checkin-stations/domain";

function formatWhen(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
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
}: {
  eventId: string;
  stations: ActiveStationRow[];
  timeZone: string;
}) {
  const router = useRouter();
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

  async function revoke(stationId: string) {
    if (busy) return;
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
    <section className="panel cis-panel" aria-labelledby="cis-panel-title">
      <h2 id="cis-panel-title">Check-in stations</h2>
      <p className="cis-panel-help">
        A station is a staff-run tablet that checks in a whole registration from one code. It works until the event
        ends, and you can revoke it here at any time.
      </p>
      <form className="cis-panel-start" onSubmit={start}>
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
          {busy === "start" ? "Starting..." : "Start a station on this device"}
        </button>
      </form>
      <div role="status" aria-live="polite">{error && <p className="form-error">{error}</p>}</div>
      {stations.length === 0 ? (
        <p className="cis-panel-help">No stations are active for this event.</p>
      ) : (
        <ul className="cis-panel-list">
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
                onClick={() => revoke(station.id)}
                aria-label={`Revoke ${station.label || "unnamed station"}`}
              >
                {busy === station.id ? "Revoking..." : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
