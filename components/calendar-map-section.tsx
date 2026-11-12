"use client";

import { useEffect, useState, type ComponentProps, type ComponentType } from "react";
import { createRetryableLoader } from "@/components/public-club-finder-logic";
import { mapNoteText, type CalendarMapData } from "@/components/calendar-map-content";
import type { CalendarMapStatus } from "@/components/calendar-event-map";
import styles from "./calendar-map-section.module.css";

type MapProps = ComponentProps<typeof import("@/components/calendar-event-map").CalendarEventMap>;

// Loaded client-side only, and a failed load is retried by Retry rather than cached.
const loadMap = createRetryableLoader(() => import("@/components/calendar-event-map").then((mod) => mod.CalendarEventMap));

/**
 * The map section on the calendar's Upcoming view (#1212). The page sends the
 * already-filtered events' pins; the list below the section stays the full
 * record, so a map that cannot load costs nothing but the picture.
 */
export function CalendarMapSection({ data }: { data: CalendarMapData }) {
  const [MapComponent, setMapComponent] = useState<ComponentType<MapProps> | null>(null);
  const [status, setStatus] = useState<CalendarMapStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadMap().then(
      (component) => { if (!cancelled) setMapComponent(() => component as ComponentType<MapProps>); },
      () => { if (!cancelled) setStatus("unavailable"); },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  // A full reload, not a remount: when the page arrived by client navigation it kept the previous page's
  // Content-Security-Policy, and only a document load gets the calendar's own, which admits the map tiles.
  function retry() {
    if (status === "tiles-failed") {
      window.location.reload();
      return;
    }
    setStatus("loading");
    setMapComponent(null);
    setAttempt((value) => value + 1);
  }

  const problem = status === "unavailable" || status === "tiles-failed";

  return (
    <section aria-labelledby="calendar-map-heading" className={styles.section}>
      <h2 id="calendar-map-heading">Where events are happening</h2>
      <p className={styles.note}>{mapNoteText(data.mappedEvents, data.unmappedEvents)}</p>
      {/* Always mounted, so a screen reader hears the text appear. */}
      <p className={styles.problem} role="status">
        {problem && (
          <>
            {status === "unavailable"
              ? "The map could not load. The list below still works."
              : "Map pictures could not load. Pins and the list still work."}{" "}
            <button className={`secondary-button ${styles.retry}`} onClick={retry} type="button">Retry map</button>
          </>
        )}
      </p>
      {MapComponent ? (
        <MapComponent groups={data.groups} key={attempt} onStatus={setStatus} />
      ) : (
        <div className={styles.loading}>{status === "unavailable" ? "Map unavailable" : "Loading map…"}</div>
      )}
    </section>
  );
}
