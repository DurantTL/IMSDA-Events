"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  destinationScopeDescription,
  destinationScopeLabels,
  destinationSearchStatus,
  nextDestinationIndex,
  searchDestinations,
  type SearchDestination,
} from "@/components/destination-search-model";
import { guardedNavigate } from "@/components/unsaved-changes-registry";

/**
 * Find a page (#1177): a labelled combobox over a listbox of the destinations
 * this viewer may already open from the menus. The list is built by the shell
 * from the canonical registry (`buildSearchDestinations`), so a destination the
 * viewer cannot open is never here. Choosing one runs the unsaved-changes guard
 * (#647) before navigating; Cancel leaves the page and the typed words alone.
 * Nothing is sent anywhere as the person types.
 */
export function DestinationSearch({ destinations }: { destinations: readonly SearchDestination[] }) {
  const router = useRouter();
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Where focus was before the field took it, so Escape can hand it back.
  const returnFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => searchDestinations(destinations, query), [destinations, query]);
  const hasQuery = query.trim() !== "";
  const expanded = open && hasQuery && results.length > 0;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  function reset() {
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  function choose(destination: SearchDestination) {
    // Cancel at the unsaved-changes prompt changes nothing.
    guardedNavigate(() => {
      reset();
      router.push(destination.href);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => nextDestinationIndex(open ? current : -1, results.length, event.key) ?? current);
    } else if (event.key === "Enter") {
      if (!hasQuery) return;
      event.preventDefault();
      const target = results[active] ?? results[0];
      if (target) choose(target);
    } else if (event.key === "Escape") {
      if (open || hasQuery) {
        // First Escape closes the list, the next clears the words.
        event.preventDefault();
        if (expanded) setOpen(false);
        else reset();
        return;
      }
      const back = returnFocus.current;
      if (back && back.isConnected) back.focus();
      else event.currentTarget.blur();
    }
  }

  return (
    <div className="destination-search" role="search">
      <label className="destination-search-field" htmlFor={inputId}>
        <Search aria-hidden="true" size={16} />
        <span className="sr-only">Find a page or task</span>
        <input
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={statusId}
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
            if (hasQuery) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Find a page or task"
          role="combobox"
          spellCheck={false}
          type="text"
          value={query}
        />
      </label>
      <p aria-live="polite" className="sr-only" id={statusId} role="status">
        {destinationSearchStatus(query, results.length)}
      </p>
      <ul
        aria-label="Matching pages"
        className="destination-search-list"
        hidden={!expanded}
        id={listId}
        role="listbox"
      >
        {results.map((destination, index) => (
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
