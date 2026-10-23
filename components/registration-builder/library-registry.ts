// Saved questions in the Questions palette (#1070): each library item becomes one palette entry in the `saved` group, and the
// builder shows them through a registry that layers the items over the shared one. The shared registry is never written to, so
// one organization's library cannot leak into another builder, and information mode filters the entries like any others.
import { Bookmark } from "lucide-react";
import type { QuestionLibraryItemView } from "@/modules/question-library/domain";
import { instantiateLibraryFragment } from "./library-insert";
import { PALETTE_GROUP_IDS, type PaletteEntry, type PaletteRegistry, type PaletteSnapshot } from "./palette-registry";

function describeItem(item: QuestionLibraryItemView) {
  const count = `${item.fields.length} question${item.fields.length === 1 ? "" : "s"}`;
  const labels = item.fields.map((field) => field.label).slice(0, 3).join(", ");
  // Two items can share a name, so the line says what is inside and who saved it.
  return [item.description, `${count}: ${labels}${item.fields.length > 3 ? ", …" : ""}`, item.createdBy ? `Saved by ${item.createdBy}` : ""].filter(Boolean).join(" · ");
}

export function libraryPaletteEntry(item: QuestionLibraryItemView): PaletteEntry {
  return {
    id: `saved:${item.id}`,
    label: item.name,
    description: describeItem(item),
    group: PALETTE_GROUP_IDS.saved,
    icon: Bookmark,
    keywords: ["saved question", "library", ...item.fields.map((field) => field.label)],
    add(context) {
      const copy = instantiateLibraryFragment(item, context.existingFields, context.newId);
      return { fields: copy.fields, repairs: copy.repairs };
    },
  };
}

/** A read-only view of `base` with the library's entries after its own. Registering and unregistering still go to `base`. */
export function createLibraryRegistry(base: PaletteRegistry, items: readonly QuestionLibraryItemView[]): PaletteRegistry {
  const entries = items.map(libraryPaletteEntry);
  let lastBase: PaletteSnapshot | null = null;
  let lastView: PaletteSnapshot = { entries: [], groups: [] };
  return {
    register: (entry) => base.register(entry),
    registerGroup: (group) => base.registerGroup(group),
    unregister: (id) => base.unregister(id),
    subscribe: (listener) => base.subscribe(listener),
    getSnapshot() {
      const snapshot = base.getSnapshot();
      if (snapshot !== lastBase) {
        lastBase = snapshot;
        const own = new Set(snapshot.entries.map((entry) => entry.id));
        lastView = { entries: [...snapshot.entries, ...entries.filter((entry) => !own.has(entry.id))], groups: snapshot.groups };
      }
      return lastView;
    },
  };
}
