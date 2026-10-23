// The Questions tab (#1132). Everything in it comes from the palette registry
// (palette-registry.ts): this file lists whatever is registered and knows
// nothing about individual field types or modules.
import { useState, useSyncExternalStore, type Ref } from "react";
import { ChevronDown, ChevronRight, GripVertical, Search } from "lucide-react";
import { groupPalette, paletteRegistry, searchPalette, topPaletteMatch, type PaletteEntry, type PaletteRegistry, type PaletteSnapshot } from "./palette-registry";

export function usePaletteSnapshot(registry: PaletteRegistry = paletteRegistry): PaletteSnapshot {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

/** The groups of a snapshot with the entries that match `query`, folded or open. Presentational: it holds no state. */
export function PaletteList({ snapshot, query, openGroups, onToggleGroup, onAdd, onDragStart, onDragEnd, disabled = false, idPrefix = "fb-palette" }: {
  snapshot: PaletteSnapshot;
  query: string;
  openGroups: ReadonlySet<string>;
  onToggleGroup: (groupId: string) => void;
  onAdd: (entry: PaletteEntry) => void;
  onDragStart?: (entry: PaletteEntry) => void;
  onDragEnd?: () => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const searching = query.trim() !== "";
  const matches = searchPalette(snapshot, query);
  const groups = groupPalette(snapshot, matches, searching);
  if (matches.length === 0 && searching) return <p className="fb-palette-empty">No questions match “{query.trim()}”.</p>;
  return (
    <div className="fb-palette-groups">
      {groups.map(({ group, entries }) => {
        // A search opens every group that has a match, so no match is hidden behind a fold.
        const open = searching || openGroups.has(group.id);
        const panelId = `${idPrefix}-group-${group.id}`;
        return (
          <section className="fb-palette-group" key={group.id} data-palette-group={group.id}>
            <h3>
              <button type="button" className="fb-palette-group-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => onToggleGroup(group.id)}>
                <span>{group.label}</span>
                <span className="fb-palette-count">{entries.length}</span>
                {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
            </h3>
            <div id={panelId} hidden={!open}>
              {entries.length === 0
                ? <p className="fb-palette-empty">{group.emptyHint}</p>
                : <ul className="fb-palette-items">
                  {entries.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="fb-palette-item"
                          data-palette-entry={entry.id}
                          disabled={disabled}
                          draggable={!disabled}
                          title={entry.description}
                          onClick={() => onAdd(entry)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "copy";
                            event.dataTransfer.setData("text/plain", entry.id);
                            onDragStart?.(entry);
                          }}
                          onDragEnd={() => onDragEnd?.()}
                        >
                          <GripVertical className="fb-palette-grip" size={14} aria-hidden="true" />
                          <Icon size={16} aria-hidden="true" />
                          <span>{entry.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function BuilderPalette({ registry = paletteRegistry, searchRef, steps, targetIndex, onTargetChange, onAdd, onDragStart, onDragEnd, disabled }: {
  registry?: PaletteRegistry;
  searchRef?: Ref<HTMLInputElement>;
  /** The form's steps, for "Add to step". */
  steps: Array<{ id: string; title: string }>;
  targetIndex: number;
  onTargetChange: (index: number) => void;
  onAdd: (entry: PaletteEntry) => void;
  onDragStart: (entry: PaletteEntry) => void;
  onDragEnd: () => void;
  disabled: boolean;
}) {
  const snapshot = usePaletteSnapshot(registry);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set(["general"]));
  const matches = searchPalette(snapshot, query);
  const searching = query.trim() !== "";

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="fb-palette builder-section">
      {disabled && <p className="fb-palette-note" role="status">This version is read-only. Open the current version to add questions.</p>}
      <label className="fb-field-label" htmlFor="fb-add-to-step">Add to step
        <select id="fb-add-to-step" value={targetIndex} disabled={disabled} onChange={(event) => onTargetChange(Number(event.target.value))}>
          {steps.map((step, index) => <option key={step.id} value={index}>{index + 1}. {step.title || "Untitled step"}</option>)}
        </select>
      </label>
      <label className="fb-field-label" htmlFor="fb-palette-search">Search questions <span className="fb-hint">(press / to focus)</span>
        <span className="fb-search">
          <Search size={15} aria-hidden="true" />
          <input
            id="fb-palette-search"
            ref={searchRef}
            type="search"
            autoComplete="off"
            name="builder-rb-palette-search"
            placeholder="Name, email, roster, meals…"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const top = topPaletteMatch(snapshot, query);
                if (top && !disabled) { onAdd(top); setQuery(""); }
              } else if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </span>
      </label>
      <p className="fb-palette-status" role="status" aria-live="polite">{searching ? `${matches.length} question${matches.length === 1 ? "" : "s"} match. Press Enter to add ${matches[0]?.label ?? "the first one"}.` : ""}</p>
      <PaletteList
        snapshot={snapshot}
        query={query}
        openGroups={openGroups}
        onToggleGroup={toggleGroup}
        onAdd={(entry) => { onAdd(entry); setQuery(""); }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        disabled={disabled}
      />
      <p className="fb-hint">Drag a question onto the form, or click it to add it to the end of the chosen step. With a keyboard, add it, then use Move up and Move down on the form.</p>
    </div>
  );
}
