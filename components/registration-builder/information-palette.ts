// The Questions palette in information mode (#1149): the same registry, filtered by one flag per entry.
// An entry is allowed when what it would add passes the information-form refusal check (the server's own function),
// unless the entry sets `informationForm` itself. There is no second list of modules to keep in step.
import type { PaletteEntry, PaletteRegistry, PaletteSnapshot } from "./palette-registry";
import { informationFieldsAllowed } from "./information-mode";

const allowedCache = new WeakMap<PaletteEntry, boolean>();

export function informationEntryAllowed(entry: PaletteEntry): boolean {
  if (entry.informationForm !== undefined) return entry.informationForm;
  const cached = allowedCache.get(entry);
  if (cached !== undefined) return cached;
  let counter = 0;
  const insert = entry.add({ existingFields: [], newId: () => `probe_${++counter}` });
  // A module that switches the attendee roster on is a roster question, whatever its fields say.
  const allowed = !insert.module?.enablesAttendeeRoster && insert.fields.length > 0 && informationFieldsAllowed(insert.fields);
  allowedCache.set(entry, allowed);
  return allowed;
}

/** A read-only view of `source` that lists only the entries `keep` allows. Registering still goes to the source. */
export function filterPaletteRegistry(source: PaletteRegistry, keep: (entry: PaletteEntry) => boolean = informationEntryAllowed): PaletteRegistry {
  let lastSource: PaletteSnapshot | null = null;
  let lastView: PaletteSnapshot = { entries: [], groups: [] };
  return {
    register: (entry) => source.register(entry),
    registerGroup: (group) => source.registerGroup(group),
    unregister: (id) => source.unregister(id),
    subscribe: (listener) => source.subscribe(listener),
    getSnapshot() {
      const snapshot = source.getSnapshot();
      if (snapshot !== lastSource) {
        lastSource = snapshot;
        lastView = { entries: snapshot.entries.filter(keep), groups: snapshot.groups };
      }
      return lastView;
    },
  };
}
