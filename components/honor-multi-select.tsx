"use client";

import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ListPager } from "@/components/list-pager";
import { paginate } from "@/lib/pagination";
import { filterHonorsByWordPrefix } from "@/modules/honors/honor-search";

export type HonorMultiSelectOption = { id: string; name: string; code: string };

/** Matches drawn per page; the catalog can hold hundreds, so the list is paged and typing narrows it. */
const PAGE_SIZE = 80;

/**
 * Choose one or more honors from the catalog for one class (#812): a
 * type-to-search box (the #819 word-prefix rule) over a checkbox list. The
 * chosen honors stay listed above the search in the order they were chosen;
 * the first is the class's primary honor. The parent owns `value`; nothing is
 * posted by the field.
 */
export function HonorMultiSelect({
  options,
  value,
  onChange,
  label = "Honors",
  kind = "taught",
}: {
  options: readonly HonorMultiSelectOption[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  label?: string;
  /** The class's prerequisite honors (#832) read and test separately from the honors it teaches. */
  kind?: "taught" | "prerequisite";
}) {
  const prerequisite = kind === "prerequisite";
  const baseId = useId();
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const chosen = new Set(value);
  const matches = useMemo(() => filterHonorsByWordPrefix(options, query), [options, query]);
  const [page, setPage] = useState(1);
  const slice = useMemo(() => paginate(matches, page, PAGE_SIZE), [matches, page]);
  const listed = slice.items;

  function toggle(id: string) {
    onChange(chosen.has(id) ? value.filter((existing) => existing !== id) : [...value, id]);
  }

  return (
    <fieldset className="honor-bulk-members honor-multi-select" data-testid={prerequisite ? "honor-multi-prerequisite" : "honor-multi-taught"}>
      <legend>{label}</legend>
      <ul aria-label={`${prerequisite ? "Chosen prerequisite honors" : "Chosen honors"} (${value.length})`} className="honor-multi-chosen">
        {value.map((id, index) => {
          const option = byId.get(id);
          return (
            <li key={id}>
              <span translate="no">{option ? `${option.name} (${option.code})` : id}</span>
              {index === 0 && value.length > 1 && <small>primary</small>}
              <button aria-label={`Remove ${option?.name ?? "honor"}`} className="text-button" onClick={() => toggle(id)} type="button">Remove</button>
            </li>
          );
        })}
        {value.length === 0 && <li className="field-help">{prerequisite ? "No prerequisite honor chosen." : "No honor chosen yet."}</li>}
      </ul>
        <div className="honor-bulk-members-tools">
          <label className="honor-name-search">
            <span className="sr-only">{prerequisite ? "Search the honor catalog for prerequisite honors" : "Search the honor catalog"}</span>
            <span className="honor-name-search-field">
              <Search aria-hidden="true" size={14} />
              <input
                autoComplete="off"
                id={`${baseId}-search`}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                // Enter in the search box must not submit the class form.
                onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                placeholder={prerequisite ? "Type to search prerequisite honors" : "Type to search honors"}
                type="search"
                value={query}
              />
            </span>
          </label>
        </div>
        <ul className="honor-bulk-member-list" data-testid={prerequisite ? "honor-multi-prerequisite-options" : "honor-multi-options"}>
          {listed.map((honor) => (
            <li key={honor.id}>
              <label className="checkbox-hit">
                <input checked={chosen.has(honor.id)} onChange={() => toggle(honor.id)} type="checkbox" />
                <span>
                  <strong translate="no">{honor.name}</strong>
                  <small translate="no">{honor.code}</small>
                </span>
              </label>
            </li>
          ))}
          {matches.length === 0 && <li className="field-help">No honor matches that search.</li>}
        </ul>
        <ListPager label={prerequisite ? "Prerequisite honor pages" : "Honor pages"} onPage={setPage} slice={slice} />
    </fieldset>
  );
}
