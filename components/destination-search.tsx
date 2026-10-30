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
  destinationSearchStatus,
  groupDestinationsByScope,
  hasSearchWords,
  listDestinations,
  listExpanded,
  selectDestination,
  type SearchDestination,
} from "@/components/destination-search-model";
import { guardedNavigate } from "@/components/unsaved-changes-registry";
import styles from "@/components/destination-search.module.css";

/**
 * Find a page (#1177): a labelled combobox over a listbox of the destinations
 * this viewer may already open from the menus. The list is built by the shell
 * from the canonical registry (`buildSearchDestinations`), so a destination the
 * viewer cannot open is never here. Choosing one runs the unsaved-changes guard
 * (#647) before navigating; Cancel leaves the page and the typed words alone.
 * Nothing is sent anywhere as the person types. The key and selection rules are
 * pure functions in `destination-search-model.ts`, where they are unit tested.
 */
export function DestinationSearch({
  destinations,
  inputId: inputIdProp,
  onNavigated,
  escapeBubbles = false,
}: {
  destinations: readonly SearchDestination[];
  /** A fixed id, so the collapsed sidebar's button can focus the field. */
  inputId?: string;
  /** Called after a result is opened (the phone launcher closes itself). */
  onNavigated?: () => void;
  /** The More sheet: an Escape with nothing to undo reaches the sheet, which closes. */
  escapeBubbles?: boolean;
}) {
  const router = useRouter();
  const baseId = useId();
  const inputId = inputIdProp ?? `${baseId}-input`;
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeRaw, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was before the field took it, so Escape can hand it back.
  const returnFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => listDestinations(destinations, query), [destinations, query]);
  const active = clampActiveIndex(activeRaw, results.length);
  const expanded = listExpanded(open, results.length);
  const hasQuery = hasSearchWords(query);
  // An empty box lists everything in the sidebar's groups; typed words are ranked, so they are not grouped.
  const groups = hasQuery ? null : groupDestinationsByScope(results);
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

  function choose(destination: SearchDestination) {
    selectDestination({
      destination,
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
      <label className="search-field destination-search-field" htmlFor={inputId}>
        <Search aria-hidden="true" size={16} />
        <span className="sr-only">Find a page or task</span>
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
          placeholder="Find a page or task"
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={query}
        />
      </label>
      <p aria-live="polite" className="sr-only" role="status">
        {destinationSearchStatus(query, results.length)}
      </p>
      <ul
        aria-label="Matching pages"
        className="destination-search-list"
        hidden={!expanded}
        id={listId}
        role="listbox"
      >
        {groups
          ? (open ? groups : []).map((group) => (
            <li aria-labelledby={`${baseId}-group-${group.scope}`} className={styles.group} key={group.scope} role="group">
              <span className={styles.groupHeading} id={`${baseId}-group-${group.scope}`}>{destinationScopeDescription(group.scope)}</span>
              <ul role="none">
                {group.items.map((destination, offset) => (
                  <DestinationOption
                    active={group.start + offset === active}
                    destination={destination}
                    id={optionId(group.start + offset)}
                    key={destination.key}
                    onChoose={() => choose(destination)}
                    onHover={() => setActive(group.start + offset)}
                  />
                ))}
              </ul>
            </li>
          ))
          : results.map((destination, index) => (
            <DestinationOption
              active={index === active}
              destination={destination}
              id={optionId(index)}
              key={destination.key}
              onChoose={() => choose(destination)}
              onHover={() => setActive(index)}
            />
          ))}
      </ul>
      {open && hasQuery && results.length === 0 && (
        <p className="destination-search-empty">No pages match. Try a different word.</p>
      )}
    </div>
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
      <span className="destination-search-label">{destination.label}</span>
      <span className="destination-search-scope" data-scope={destination.scope.toLowerCase()}>
        <span className="sr-only">Scope: {destinationScopeDescription(destination.scope)}. </span>
        <span aria-hidden="true">{destinationScopeLabels[destination.scope]}</span>
      </span>
      <span className="destination-search-description">{destination.description}</span>
    </li>
  );
}
