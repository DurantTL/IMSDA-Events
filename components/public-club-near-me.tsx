"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { LocateFixed } from "lucide-react";
import type { DistanceOrigin } from "@/components/club-distance";
import { loadPlaceIndex, lookUpPlace, placeLookupMessage } from "@/components/place-lookup";
import styles from "./public-club-near-me.module.css";

export type LocationProblem = "blocked" | "unavailable" | "unsupported";

/** The plain-words message for each way the browser can say no (#2056, #1445). */
export function locationProblemMessage(problem: LocationProblem) {
  switch (problem) {
    case "blocked":
      return "Location is off or blocked for this site, so the list stays in its usual order. You can enter a town or ZIP instead.";
    case "unavailable":
      return "Your location could not be found, so the list stays in its usual order. You can enter a town or ZIP instead.";
    case "unsupported":
      return "This browser can't share a location here, so the list stays in its usual order. You can enter a town or ZIP instead.";
  }
}

/** A GeolocationPositionError code: 1 refused or blocked (also a site or browser policy), 2 unavailable, 3 timed out. */
export function problemFromErrorCode(code: number): LocationProblem {
  return code === 1 ? "blocked" : "unavailable";
}

// The browser gives up after this long once location is allowed. The page stops waiting later, counting the
// time the permission prompt is open, in case a privacy browser never answers at all (a late answer still sorts the list).
const LOCATE_TIMEOUT_MS = 15_000;
const LOCATE_WATCHDOG_MS = 30_000;

const subscribeNothing = () => () => {};

/**
 * "Near me" on Find a club (#2056). Sorts the list by distance from the
 * visitor's location, when their browser shares it, or from a town or ZIP
 * they type. The location stays in this browser tab: it is not sent to the
 * server (the town and ZIP table is bundled; see components/place-lookup.ts),
 * not stored, not put in the web address and not measured.
 *
 * Shown only once the page's scripts run, since both ways need them; without
 * scripts the list and search still work as before.
 */
export function PublicClubNearMe({ origin, onOriginChange }: { origin: DistanceOrigin | null; onOriginChange: (origin: DistanceOrigin | null) => void }) {
  const scriptsRunning = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const [place, setPlace] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const requestRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeInputRef = useRef<HTMLInputElement | null>(null);
  const nearMeButtonRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const headingId = `${id}-heading`;
  const placeId = `${id}-place`;
  const placeErrorId = `${id}-place-error`;

  useEffect(() => () => {
    // Leaving the page: ignore any answer still on its way.
    requestRef.current += 1;
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
  }, []);

  if (!scriptsRunning) return null;

  function stopWatchdog() {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }

  function locate() {
    const request = ++requestRef.current;
    setPlaceError(null);
    setPlaceBusy(false);
    setProblem(null);
    const geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geolocation || (typeof window !== "undefined" && window.isSecureContext === false)) {
      setProblem("unsupported");
      return;
    }
    setLocating(true);
    stopWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (request !== requestRef.current) return;
      setLocating(false);
      setProblem("unavailable");
    }, LOCATE_WATCHDOG_MS);
    try {
      geolocation.getCurrentPosition(
        (position) => {
          if (request !== requestRef.current) return;
          stopWatchdog();
          setLocating(false);
          setProblem(null);
          onOriginChange({ latitude: position.coords.latitude, longitude: position.coords.longitude, label: "your location", source: "device" });
        },
        (error) => {
          if (request !== requestRef.current) return;
          stopWatchdog();
          setLocating(false);
          setProblem(problemFromErrorCode(error.code));
        },
        { enableHighAccuracy: false, maximumAge: 600_000, timeout: LOCATE_TIMEOUT_MS },
      );
    } catch {
      stopWatchdog();
      setLocating(false);
      setProblem("unsupported");
    }
  }

  async function lookUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = ++requestRef.current;
    stopWatchdog();
    setLocating(false);
    setProblem(null);
    setPlaceBusy(true);
    try {
      const index = await loadPlaceIndex();
      if (request !== requestRef.current) return;
      const result = lookUpPlace(index, place);
      if (result.status === "found") {
        setPlaceError(null);
        onOriginChange(result.origin);
      } else {
        setPlaceError(placeLookupMessage(result));
        placeInputRef.current?.focus();
      }
    } catch {
      if (request !== requestRef.current) return;
      setPlaceError("Town and ZIP lookup could not load. Try again, or use Near me.");
    } finally {
      if (request === requestRef.current) setPlaceBusy(false);
    }
  }

  function showUsualOrder() {
    requestRef.current += 1;
    stopWatchdog();
    setLocating(false);
    setProblem(null);
    setPlaceError(null);
    setPlaceBusy(false);
    onOriginChange(null);
    // This button goes away with the sort, so keyboard focus returns to Near me.
    nearMeButtonRef.current?.focus();
  }

  const sortedNote = origin ? `Sorted by distance from ${origin.label}. Distances are straight-line miles.` : "";
  // An error is read out here too: submitting with Enter leaves focus in the box, so focusing it again says nothing.
  const announcement = locating
    ? "Finding your location…"
    : problem
      ? locationProblemMessage(problem)
      : placeError ?? sortedNote;

  return (
    <section aria-labelledby={headingId} className={styles.nearMe}>
      <h3 className={styles.heading} id={headingId}>Sort by distance</h3>
      <div className={styles.controls}>
        <button aria-busy={locating} className={`secondary-button ${styles.nearMeButton}`} disabled={locating} onClick={locate} ref={nearMeButtonRef} type="button">
          <LocateFixed aria-hidden="true" size={16} /> {locating ? "Finding your location…" : "Near me"}
        </button>
        <form aria-label="Distance from a town or ZIP" className={styles.placeForm} noValidate onSubmit={lookUp}>
          <label className={styles.placeLabel} htmlFor={placeId}>Or from a town or ZIP</label>
          <div className={styles.placeRow}>
            <input
              aria-describedby={placeError ? placeErrorId : undefined}
              aria-invalid={placeError ? true : undefined}
              autoComplete="off"
              className={styles.placeInput}
              id={placeId}
              onChange={(event) => { setPlace(event.target.value); if (placeError) setPlaceError(null); }}
              placeholder="Town or ZIP"
              ref={placeInputRef}
              spellCheck={false}
              type="text"
              value={place}
            />
            <button className="secondary-button" disabled={placeBusy} type="submit">{placeBusy ? "Finding…" : "Sort"}</button>
          </div>
          {placeError && <small className="field-error-message" id={placeErrorId}>{placeError}</small>}
        </form>
      </div>
      {problem && <p className={styles.problem}>{locationProblemMessage(problem)}</p>}
      {origin && (
        <p className={styles.sortedNote}>
          <span>{sortedNote}</span>
          <button className="secondary-button" onClick={showUsualOrder} type="button">Show usual order</button>
        </p>
      )}
      {origin?.source === "place" && (
        <p className={styles.credit}>
          Town and ZIP locations from <a href="https://www.geonames.org/" rel="noreferrer" target="_blank">GeoNames</a> (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer" target="_blank">CC BY 4.0</a>)
        </p>
      )}
      <p className="sr-only" role="status">{announcement}</p>
    </section>
  );
}
