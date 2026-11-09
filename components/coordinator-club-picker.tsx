"use client";

import { Search } from "lucide-react";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";
import { useClientSearch } from "@/components/search-as-you-type";
import styles from "./coordinator-club-picker.module.css";

/** The clubs whose name contains the typed text (any case). Empty text keeps every club (S1). */
export function filterPickerClubs<T extends { name: string }>(clubs: readonly T[], text: string): T[] {
  const wanted = text.trim().toLocaleLowerCase("en-US");
  return wanted ? clubs.filter((club) => club.name.toLocaleLowerCase("en-US").includes(wanted)) : clubs.slice();
}

/**
 * Club choice for the coordinator roster export (#1760): All clubs, or a checkbox list narrowed by typing. The list
 * filters on every keystroke, with no Enter and no form (S4); an empty filter shows every club (S1). Ticked clubs stay
 * ticked while the list is narrowed.
 */
export function CoordinatorClubPicker({
  clubs,
  allClubs,
  selectedIds,
  onChange,
}: {
  clubs: { id: string; name: string }[];
  allClubs: boolean;
  selectedIds: string[];
  onChange: (next: { all: boolean; ids: string[] }) => void;
}) {
  const search = useClientSearch();
  const shown = filterPickerClubs(clubs, search.term);
  const selected = new Set(selectedIds);

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange({ all: false, ids: clubs.filter((club) => next.has(club.id)).map((club) => club.id) });
  }

  return (
    <fieldset className={styles.picker}>
      <legend>Clubs</legend>
      <label className={styles.choice}>
        <input checked={allClubs} name="club-scope" onChange={() => onChange({ all: true, ids: [] })} type="radio" />
        All clubs ({clubs.length})
      </label>
      <label className={styles.choice}>
        <input checked={!allClubs} name="club-scope" onChange={() => onChange({ all: false, ids: selectedIds })} type="radio" />
        Pick clubs
      </label>
      {!allClubs && (
        <>
          <div className={styles.filter}>
            <label htmlFor="coordinator-club-filter">Find a club</label>
            <span className="search-field" onMouseDown={focusSearchInput}>
              <Search aria-hidden="true" size={16} />
              <input
                autoComplete="off"
                id="coordinator-club-filter"
                {...search.inputProps}
                placeholder="Club name"
                type="search"
              />
              <SearchClearButton onClear={() => search.setValue("")} visible={search.value !== ""} />
            </span>
          </div>
          <p aria-live="polite" className={styles.help} role="status">
            {selected.size} chosen. {shown.length} of {clubs.length} clubs listed.
          </p>
          {shown.length === 0 ? (
            <p className={styles.help}>
              No club name matches “{search.term}”.{" "}
              <button className="text-button" onClick={() => search.setValue("")} type="button">Clear filters</button>
            </p>
          ) : (
            <ul aria-label="Clubs" className={styles.list}>
              {shown.map((club) => (
                <li key={club.id}>
                  <label className={styles.choice}>
                    <input checked={selected.has(club.id)} onChange={(event) => toggle(club.id, event.target.checked)} type="checkbox" />
                    {club.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}
