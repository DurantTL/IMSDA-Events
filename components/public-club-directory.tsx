"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { List, MapPin, Search, UsersRound, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { PublicClubListing } from "@/modules/organizations/public-club-directory";
import type { PublicClubMapStatus } from "@/components/public-club-map";
import { locationKey } from "@/components/public-club-map-content";
import styles from "./public-club-directory.module.css";

const PublicClubMap = dynamic(
  () => import("@/components/public-club-map").then((mod) => mod.PublicClubMap),
  { ssr: false, loading: () => <div className={styles.mapLoading}>Loading map…</div> },
);

/** A failed map chunk must not take the working list down with it. */
class MapBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function matches(club: PublicClubListing, query: string) {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  return [club.town, club.zip, club.clubName, club.churchName]
    .some((field) => field.toLowerCase().includes(needle));
}

/**
 * The public club listing and map (#437): search by town, ZIP, club or church, a list
 * that stays in sync with the map — filtering the list filters the pins,
 * selecting one highlights the other. Only ever shown here: church name,
 * club name, town, and meeting day/time — whatever the server sent, which
 * is already nothing more (see modules/organizations/public-club-directory).
 */
export function PublicClubDirectory({ clubs }: { clubs: PublicClubListing[] }) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ id: string; fromMap: boolean } | null>(null);
  const selectedId = selection?.id ?? null;
  const [view, setView] = useState<"list" | "map">("list");
  const [mapStatus, setMapStatus] = useState<PublicClubMapStatus>("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowIdPrefix = useId();
  const searchId = `${rowIdPrefix}-search`;

  const filtered = useMemo(() => clubs.filter((club) => matches(club, query)), [clubs, query]);
  const mappable = useMemo(() => filtered.filter((club) => club.latitude !== null && club.longitude !== null), [filtered]);
  // Whether to show a map at all depends on every listed club, not the
  // search: the map stays mounted while typing, even when no pin matches.
  const anyMappable = useMemo(() => clubs.some((club) => club.latitude !== null && club.longitude !== null), [clubs]);
  const selected = useMemo(
    () => filtered.find((club) => club.id === selectedId) ?? null,
    [filtered, selectedId],
  );
  const selectedPoint = selected && selected.latitude !== null && selected.longitude !== null
    ? locationKey(selected.latitude, selected.longitude)
    : null;
  const unmappedShown = filtered.length - mappable.length;
  const mapProblem = mapStatus === "unavailable" || mapStatus === "tiles-failed";
  const selectedUnmapped = selected !== null && selectedPoint === null;
  const rowId = (id: string) => `${rowIdPrefix}-club-${id}`;

  function selectFromList(id: string) {
    setSelection((current) => (current?.id === id ? null : { id, fromMap: false }));
  }

  function selectFromMap(id: string) {
    setSelection({ id, fromMap: true });
  }

  // A tapped pin brings its club's row into view (on phones the list sits
  // below the map).
  useEffect(() => {
    if (!selection?.fromMap) return;
    document.getElementById(`${rowIdPrefix}-club-${selection.id}`)?.scrollIntoView({ block: "nearest" });
  }, [selection, rowIdPrefix]);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  function retryMap() {
    // Remounting the map only: the search and the selection live here.
    setMapStatus("loading");
    setMapAttempt((attempt) => attempt + 1);
  }

  return (
    <div className={styles.layout}>
      <div className={styles.searchBlock}>
        <label className={styles.searchLabel} htmlFor={searchId}>Search town, ZIP, club or church</label>
        <div className={styles.search}>
          <Search aria-hidden="true" size={17} />
          <input
            id={searchId}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Town, ZIP, club or church"
            ref={searchRef}
            type="search"
            value={query}
          />
          {query && (
            <button className={styles.clearButton} onClick={clearSearch} type="button">
              <X aria-hidden="true" size={15} /> Clear search
            </button>
          )}
        </div>
      </div>

      {clubs.length > 0 && (
        <div className={styles.status}>
          <p aria-live="polite" className={styles.count} role="status">
            {filtered.length} publicly listed {plural(filtered.length, "club", "clubs")} found · {mappable.length} shown on map
            {unmappedShown > 0 && (
              <small>
                {" "}{unmappedShown} {plural(unmappedShown, "club has", "clubs have")} no map location and {plural(unmappedShown, "is", "are")} listed only.
              </small>
            )}
          </p>
          {mapProblem && (
            <p className={styles.mapProblem}>
              {mapStatus === "unavailable"
                ? "The map could not load. The list below still works."
                : "Map pictures could not load. Pins and the list still work."}{" "}
              <button className={styles.retryButton} onClick={retryMap} type="button">Retry map</button>
            </p>
          )}
          {anyMappable && (
            <div aria-label="Show results as" className={styles.viewToggle} role="group">
              <button aria-pressed={view === "list"} onClick={() => setView("list")} type="button">
                <List aria-hidden="true" size={16} /> List
              </button>
              <button aria-pressed={view === "map"} onClick={() => setView("map")} type="button">
                <MapPin aria-hidden="true" size={16} /> Map
              </button>
            </div>
          )}
        </div>
      )}

      {clubs.length === 0 ? (
        <EmptyState className="empty-state panel" headingLevel={2} icon={<MapPin aria-hidden="true" size={26} />} title="No clubs are listed publicly yet">Check back soon.</EmptyState>
      ) : (
        <div className={styles.content} data-view={view}>
          {anyMappable && (
            <div className={styles.mapPane}>
              <MapBoundary key={mapAttempt} onFail={() => setMapStatus("unavailable")}>
                <PublicClubMap clubs={mappable} onSelect={selectFromMap} onStatus={setMapStatus} selectedId={selectedId} />
              </MapBoundary>
            </div>
          )}

          <ul className={styles.list}>
            {filtered.length === 0 ? (
              <li><EmptyState announce={false} className="empty-state panel" headingLevel={2} icon={<Search aria-hidden="true" size={26} />} title={`No clubs match “${query.trim()}”`}>
                Try a different town, ZIP, club or church name.
                <button className={styles.resetButton} onClick={clearSearch} type="button">Clear search</button>
              </EmptyState></li>
            ) : (
              filtered.map((club) => {
                const isSelected = selectedId === club.id;
                const sharesPin = !isSelected && selectedPoint !== null
                  && club.latitude !== null && club.longitude !== null
                  && locationKey(club.latitude, club.longitude) === selectedPoint;
                const className = [
                  styles.clubButton,
                  isSelected ? styles.selected : "",
                  sharesPin ? styles.samePin : "",
                ].filter(Boolean).join(" ");
                return (
                  <li id={rowId(club.id)} key={club.id}>
                    <button
                      aria-expanded={isSelected}
                      className={className}
                      onClick={() => selectFromList(club.id)}
                      type="button"
                    >
                      <span className={styles.clubIcon}><UsersRound aria-hidden="true" size={16} /></span>
                      <span className={styles.clubText}>
                        <strong>{club.clubName}</strong>
                        <small>{club.churchName}{club.town ? ` · ${club.town}` : ""}</small>
                        {sharesPin && <small className={styles.samePinNote}>Same church, same pin</small>}
                      </span>
                    </button>
                    {isSelected && (
                      <>
                      <dl className={styles.details}>
                        <div>
                          <dt>Church</dt>
                          <dd>{club.churchName || "Not given"}</dd>
                        </div>
                        <div>
                          <dt>Town</dt>
                          <dd>{club.town || "Not given"}</dd>
                        </div>
                        <div>
                          <dt>Meets</dt>
                          <dd>{club.meetingSchedule || "Not given"}</dd>
                        </div>
                        {club.latitude === null || club.longitude === null ? (
                          <div>
                            <dt>Map</dt>
                            <dd>Map location unavailable. This club is listed without a pin.</dd>
                          </div>
                        ) : null}
                      </dl>
                      <p className={styles.disclaimer}>
                        A listing does not show current openings or membership, and is not an invitation to visit any address.
                      </p>
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      <p aria-live="polite" className={styles.selectionNote}>
        {selected && (
          <>
            <MapPin aria-hidden="true" size={14} /> Showing {selected.clubName}.
            {selectedUnmapped && " Map location unavailable."}
          </>
        )}
      </p>
    </div>
  );
}
