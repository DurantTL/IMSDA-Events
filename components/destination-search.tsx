"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  activeDescendantId,
  clampActiveIndex,
  destinationKeyAction,
  destinationScopeDescription,
  destinationScopeLabels,
  actionForSurface,
  buildResultLayout,
  destinationSearchStatus,
  activeIndexForKey,
  hasSearchWords,
  listDestinations,
  listExpanded,
  recordMoreNotes,
  recordSearchStatus,
  selectDestination,
  type ResultEntry,
  type SearchDestination,
} from "@/components/destination-search-model";
import { useStaffRecordSearch } from "@/components/use-staff-record-search";
import { guardedNavigate } from "@/components/unsaved-changes-registry";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";
import styles from "@/components/destination-search.module.css";

/**
 * Find a page (#1177): a labelled combobox over a listbox of the destinations
 * this viewer may already open from the menus. The list is built by the shell
 * from the canonical registry (`buildSearchDestinations`), so a destination the
 * viewer cannot open is never here. Choosing one runs the unsaved-changes guard
 * (#647) before navigating; Cancel leaves the page and the typed words alone.
 * Nothing is sent anywhere as the person types. The key and selection rules are
 * pure functions in `destination-search-model.ts`, where they are unit tested.
 *
 * With `records` on (the staff header, #1837) typed words also ask the server for clubs, events and churches the viewer
 * may open (`/api/staff/search`, debounced, one request at a time). They are listed in groups after the pages, share the
 * one active option and the one focus ring, and open through the same unsaved-changes guard. Nothing is requested for
 * an empty box.
 */
export function DestinationSearch({
  destinations,
  inputId: inputIdProp,
  onNavigated,
  escapeBubbles = false,
  records = false,
}: {
  destinations: readonly SearchDestination[];
  /** A fixed id, so the collapsed sidebar's button can focus the field. */
  inputId?: string;
  /** Called after a result is opened (the phone launcher closes itself). */
  onNavigated?: () => void;
  /** The More sheet: an Escape with nothing to undo reaches the sheet, which closes. */
  escapeBubbles?: boolean;
  /** Also search clubs, events and churches on the server (the staff header). The More sheet stays pages-only. */
  records?: boolean;
}) {
  const router = useRouter();
  const baseId = useId();
  const inputId = inputIdProp ?? `${baseId}-input`;
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // The active row is kept by its stable key: when rows change (records arriving) it stays on the same entry, or on none if that entry is gone.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was before the field took it, so Escape can hand it back.
  const returnFocus = useRef<HTMLElement | null>(null);

  const pages = useMemo(() => listDestinations(destinations, query), [destinations, query]);
  const hasQuery = hasSearchWords(query);
  const recordSearch = useStaffRecordSearch(query, records);
  // An empty box lists every page in the sidebar's groups; typed words are ranked pages (and, with records on, grouped records).
  const layout = useMemo(
    () => buildResultLayout({ pages, hasQuery, records: { enabled: records, result: recordSearch.result } }),
    [pages, hasQuery, records, recordSearch.result],
  );
  const results = layout.entries;
  const groups = layout.sections;
  const activeRaw = activeIndexForKey(results, activeKey);
  const active = clampActiveIndex(activeRaw, results.length);
  const setActive = (index: number) => setActiveKey(results[index]?.key ?? null);
  const expanded = listExpanded(open, results.length);
  const waitingOnRecords = records && hasQuery && recordSearch.pending;
  // Notes under the list (not options): groups cut short with no page to see the rest on, and a failed record search.
  const moreNotes = open && records && hasQuery && !recordSearch.pending ? recordMoreNotes(recordSearch.result) : [];
  const showFailedNote = open && records && hasQuery && recordSearch.failed && results.length > 0;
  const hasFootNotes = moreNotes.length > 0 || showFailedNote;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  function reset() {
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  function giveFocusBack() {
    const back = returnFocus.current;
    // Never the body: the previous owner if it is still there, else the field keeps focus.
    if (back && back.isConnected && !back.closest(".destination-search")) back.focus();
    else inputRef.current?.focus();
  }

  function choose(entry: ResultEntry) {
    selectDestination({
      destination: entry,
      guard: guardedNavigate,
      reset,
      navigate: (href) => {
        router.push(href);
        onNavigated?.();
      },
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const action = destinationKeyAction({
      key: event.key,
      composing: event.nativeEvent.isComposing,
      open,
      query,
      count: results.length,
      active: activeRaw,
    });
    const resolved = actionForSurface(action, escapeBubbles);
    if (!resolved.handled) return;
    // The More launcher around the phone field also reads these keys; they are handled here.
    event.preventDefault();
    event.stopPropagation();
    const next = resolved.action;
    switch (next.type) {
      case "move":
        setOpen(true);
        setActive(next.index);
        break;
      case "choose":
        choose(results[next.index]);
        break;
      case "close":
        setOpen(false);
        break;
      case "clear":
        reset();
        if (resolved.returnsFocus) giveFocusBack();
        break;
      case "restore-focus":
        giveFocusBack();
        break;
    }
  }

  return (
    <div className="destination-search" role="search">
      <div className="search-field destination-search-field" onMouseDown={focusSearchInput}>
        <Search aria-hidden="true" size={16} />
        <label className="sr-only" htmlFor={inputId}>{records ? recordsLabel : "Find a page or task"}</label>
        <input
          aria-activedescendant={activeDescendantId(expanded, active, optionId)}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={expanded}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className="destination-search-input"
          enterKeyHint="go"
          id={inputId}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={(event) => {
            const from = event.relatedTarget;
            returnFocus.current = from instanceof HTMLElement ? from : null;
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={records ? recordsPlaceholder : "Find a page or task"}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={query}
        />
        <SearchClearButton onClear={() => { setQuery(""); setActive(-1); setOpen(true); }} visible={query !== ""} />
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {records
          ? recordSearchStatus({ query, pageCount: pages.length, result: recordSearch.result, pending: recordSearch.pending, failed: recordSearch.failed })
          : destinationSearchStatus(query, results.length)}
      </p>
      <div className="destination-search-panel" hidden={!expanded && !hasFootNotes}>
      <ul
        aria-label={records ? "Matching pages and records" : "Matching pages"}
        className="destination-search-list"
        hidden={!expanded}
        id={listId}
        role="listbox"
      >
        {groups
          ? (open ? groups : []).map((group) => (
            <li aria-labelledby={`${baseId}-group-${group.id}`} className={styles.group} key={group.id} role="group">
              <span className={styles.groupHeading} id={`${baseId}-group-${group.id}`}>{group.heading}</span>
              <ul role="none">
                {group.entries.map((entry, offset) => (
                  <ResultOption
                    active={group.start + offset === active}
                    entry={entry}
                    id={optionId(group.start + offset)}
                    key={entry.key}
                    onChoose={() => choose(entry)}
                    onHover={() => setActive(group.start + offset)}
                  />
                ))}
              </ul>
            </li>
          ))
          : results.map((entry, index) => (
            <ResultOption
              active={index === active}
              entry={entry}
              id={optionId(index)}
              key={entry.key}
              onChoose={() => choose(entry)}
              onHover={() => setActive(index)}
            />
          ))}
      </ul>
      {hasFootNotes && (
        <div className={styles.notes}>
          {moreNotes.map((note) => <p className={styles.note} key={note}>{note}</p>)}
          {showFailedNote && <p className={styles.note}>Clubs, events and churches could not be searched.</p>}
        </div>
      )}
      </div>
      {open && hasQuery && results.length === 0 && !waitingOnRecords && (
        <p className="destination-search-empty">{records ? "Nothing matches. Try a different word." : "No pages match. Try a different word."}</p>
      )}
    </div>
  );
}

const recordsLabel = "Search pages, clubs, events and churches";
const recordsPlaceholder = "Search pages, clubs, events, churches";

/** One row of the list: a page or task, a record, or a "See all results" link. */
function ResultOption({ active, entry, id, onChoose, onHover }: { active: boolean; entry: ResultEntry; id: string; onChoose: () => void; onHover: () => void }) {
  if (entry.kind === "page" && entry.destination) {
    return <DestinationOption active={active} destination={entry.destination} id={id} onChoose={onChoose} onHover={onHover} />;
  }
  return (
    <li
      aria-selected={active}
      className={`destination-search-option${entry.kind === "see-all" ? ` ${styles.seeAll}` : ""}`}
      id={id}
      onClick={onChoose}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      role="option"
    >
      <span className="destination-search-label">{entry.label}</span>
      <span className="destination-search-scope" data-scope={entry.badge.toLowerCase()}>
        <span className="sr-only">{entry.badgeSpoken}. </span>
        <span aria-hidden="true">{entry.badge}</span>
      </span>
      <span className="destination-search-description">{entry.description}</span>
    </li>
  );
}

/** One result: label, scope (in text, never colour alone) and what it is for. */
export function DestinationOption({
  active,
  destination,
  id,
  onChoose,
  onHover,
}: {
  active: boolean;
  destination: SearchDestination;
  id: string;
  onChoose: () => void;
  onHover: () => void;
}) {
  return (
    <li
      aria-selected={active}
      className="destination-search-option"
      id={id}
      onClick={onChoose}
      // Keeps focus in the field so a tap or click is not a blur that closes the list first.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      role="option"
    >
      <span className="destination-search-label">
        {destination.parent ? (
          <span className={styles.parent}>
            {destination.parent}
            <span aria-hidden="true"> › </span>
            <span className="sr-only">: </span>
          </span>
        ) : null}
        {destination.label}
      </span>
      <span className="destination-search-scope" data-scope={destination.scope.toLowerCase()}>
        <span className="sr-only">Scope: {destinationScopeDescription(destination.scope)}. </span>
        <span aria-hidden="true">{destinationScopeLabels[destination.scope]}</span>
      </span>
      <span className="destination-search-description">{destination.description}</span>
    </li>
  );
}
