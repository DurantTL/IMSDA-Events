"use client";

import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ComponentType } from "react";
import { List, MapPin, Search, UsersRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";
import { useClientSearch } from "@/components/search-as-you-type";
import type { PublicClubListing } from "@/modules/organizations/public-club-directory";
import type { PublicClubMapStatus } from "@/components/public-club-map";
import { announcedCountText, createRetryableLoader, effectiveView, unmappedSentence } from "@/components/public-club-finder-logic";
import { locationKey } from "@/components/public-club-map-content";
import styles from "./public-club-directory.module.css";

type MapProps = ComponentProps<typeof import("@/components/public-club-map").PublicClubMap>;

const loadMap = createRetryableLoader(() => import("@/components/public-club-map").then((mod) => mod.PublicClubMap));

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
  const search = useClientSearch();
  const query = search.term;
  const [selection, setSelection] = useState<{ id: string; fromMap: boolean } | null>(null);
  const selectedId = selection?.id ?? null;
  const [view, setView] = useState<"list" | "map">("list");
  const [mapStatus, setMapStatus] = useState<PublicClubMapStatus>("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [MapComponent, setMapComponent] = useState<ComponentType<MapProps> | null>(null);
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
  const shownView = effectiveView(view, filtered.length, mapProblem);
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

  // Load the map code; a failed load is retried by Retry, not cached.
  useEffect(() => {
    if (!anyMappable) return;
    let cancelled = false;
    loadMap().then(
      (component) => { if (!cancelled) setMapComponent(() => component as ComponentType<MapProps>); },
      () => { if (!cancelled) setMapStatus("unavailable"); },
    );
    return () => { cancelled = true; };
  }, [anyMappable, mapAttempt]);

  // The list and this count follow the search term, which settles once typing pauses, so screen readers hear it once.
  const countText = announcedCountText(filtered.length, mappable.length, !mapProblem);

  function clearSearch() {
    search.setValue("");
    searchRef.current?.focus();
  }

  function retryMap() {
    // Remounting the map only: the search and the selection live here.
    setMapStatus("loading");
    setMapComponent(null);
    setMapAttempt((attempt) => attempt + 1);
  }

  return (
    <div className={styles.layout}>
      <div className={styles.searchBlock}>
        <label className={styles.searchLabel} htmlFor={searchId}>Search town, ZIP, club or church</label>
        <div className={`search-field ${styles.search}`} onMouseDown={focusSearchInput}>
          <Search aria-hidden="true" size={17} />
          <input
            id={searchId}
            {...search.inputProps}
            placeholder="Town, ZIP, club or church"
            ref={searchRef}
            type="search"
          />
          <SearchClearButton onClear={clearSearch} visible={search.value !== ""} />
        </div>
      </div>

      {clubs.length > 0 && (
        <div className={styles.status}>
          <p className={styles.count}>
            {countText}
            {unmappedShown > 0 && <small> {unmappedSentence(unmappedShown)}</small>}
          </p>
          <p className="sr-only" role="status">{countText}</p>
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
              <button aria-pressed={shownView === "list"} onClick={() => setView("list")} type="button">
                <List aria-hidden="true" size={16} /> List
              </button>
              <button aria-pressed={shownView === "map"} onClick={() => setView("map")} type="button">
                <MapPin aria-hidden="true" size={16} /> Map
              </button>
            </div>
          )}
        </div>
      )}

      {clubs.length === 0 ? (
        <EmptyState className="empty-state panel" headingLevel={2} icon={<MapPin aria-hidden="true" size={26} />} title="No clubs are listed publicly yet">Check back soon.</EmptyState>
      ) : (
        <div className={styles.content} data-view={shownView}>
          {anyMappable && (
            <div className={styles.mapPane}>
              {MapComponent ? (
                <MapComponent clubs={mappable} key={mapAttempt} onSelect={selectFromMap} onStatus={setMapStatus} selectedId={selectedId} />
              ) : (
                <div className={styles.mapLoading}>{mapStatus === "unavailable" ? "Map unavailable" : "Loading map…"}</div>
              )}
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
