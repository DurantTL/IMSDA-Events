// The Questions palette registry (#1132).
//
// The editor's Questions tab is built from ONE registry of entries: the basic
// field types, the ready-made modules in modules/forms/builder-modules.ts, and
// (later, #1070) saved questions. The sidebar never lists anything by hand, so
// adding a question type or a module means registering an entry here (or adding
// the module to builderFieldModules), never editing the sidebar.
// See docs/FORM-BUILDER-PALETTE.md.
import {
  Calculator, Calendar, CircleDot, ChevronDown, Church, FileCheck2, Hash, Layers3, ListChecks, ListOrdered,
  Mail, MapPin, AlignLeft, Phone, School, SquareCheck, Tag, Type, DollarSign, Users, type LucideIcon,
} from "lucide-react";
import { builderFieldModules, planModuleInsert, type BuilderModuleDefinition } from "@/modules/forms/builder-modules";
import { acknowledgmentTypePatch } from "@/components/acknowledgment-field-settings";
import type { RegistrationFormField } from "@/modules/forms/definition";

/** What an entry's `add()` is given: the fields already on the form (for unique keys) and an id maker. */
export type PaletteInsertContext = {
  existingFields: readonly RegistrationFormField[];
  newId: () => string;
};

/**
 * What `add()` returns. `fields` are the fields to insert. A module entry also
 * names its module: the builder inserts modules through its existing module
 * insert (fixed keys, "already on the form" checks, roster switch-on, notices),
 * so `fields` is a preview of what that insert will add.
 */
export type PaletteInsert = {
  fields: RegistrationFormField[];
  module?: BuilderModuleDefinition;
  /** Saved questions (#1070): inserted fields that need the person's attention (a reference that could not be carried over), by field id. */
  repairs?: Array<{ fieldId: string; message: string }>;
};

export type PaletteEntry = {
  /** Stable and unique across the registry, for example "type:TEXT", "module:housing" or "saved:<id>". */
  id: string;
  label: string;
  /** One short line shown under the label when there is room, and searched. */
  description?: string;
  /** A group id from the registry's groups. An unknown id gets a group of its own. */
  group: string;
  icon: LucideIcon;
  /** Extra words the search matches, e.g. "e-mail", "phone number". */
  keywords: readonly string[];
  add: (context: PaletteInsertContext) => PaletteInsert;
  /**
   * Whether the entry may be used in an information form (#1149). Leave it out and the entry is tried against the
   * information-form refusal check (information-palette.ts), so a new module is allowed or hidden by what it adds, not
   * by a list. Set it only to override that.
   */
  informationForm?: boolean;
  /** Offered only in an information form, never in a registration form (#1222). */
  informationOnly?: boolean;
};

export type PaletteGroup = {
  id: string;
  label: string;
  /** Shown instead of an empty list when nothing is registered in the group yet. */
  emptyHint?: string;
};

export type PaletteSnapshot = {
  entries: readonly PaletteEntry[];
  groups: readonly PaletteGroup[];
};

export const PALETTE_GROUP_IDS = {
  general: "general",
  people: "people",
  money: "money",
  agreements: "agreements",
  modules: "modules",
  saved: "saved",
} as const;

export const defaultPaletteGroups: readonly PaletteGroup[] = [
  { id: PALETTE_GROUP_IDS.general, label: "General questions" },
  { id: PALETTE_GROUP_IDS.people, label: "People and directory" },
  { id: PALETTE_GROUP_IDS.money, label: "Money" },
  { id: PALETTE_GROUP_IDS.agreements, label: "Agreements" },
  { id: PALETTE_GROUP_IDS.modules, label: "Modules" },
  { id: PALETTE_GROUP_IDS.saved, label: "Question library", emptyHint: "Questions saved to the library appear here. Use Save to library in a question's actions menu. Adding one puts an independent copy on this form." },
];

export type PaletteRegistry = {
  /** Add an entry, or replace the one with the same id. Returns a function that removes it again. */
  register: (entry: PaletteEntry) => () => void;
  registerGroup: (group: PaletteGroup) => void;
  unregister: (id: string) => void;
  getSnapshot: () => PaletteSnapshot;
  subscribe: (listener: () => void) => () => void;
};

export function createPaletteRegistry(groups: readonly PaletteGroup[] = defaultPaletteGroups): PaletteRegistry {
  const entries = new Map<string, PaletteEntry>();
  const groupList = new Map<string, PaletteGroup>(groups.map((group) => [group.id, group]));
  const listeners = new Set<() => void>();
  let snapshot: PaletteSnapshot = { entries: [], groups: [...groupList.values()] };

  function publish() {
    snapshot = { entries: [...entries.values()], groups: [...groupList.values()] };
    listeners.forEach((listener) => listener());
  }

  function unregister(id: string) {
    if (entries.delete(id)) publish();
  }

  return {
    register(entry) {
      // Registering an id again replaces the entry in place (hot reload, or a feature registering twice, must not throw);
      // registering the very same entry again changes nothing. The returned function removes the entry only while it is
      // still the one registered, so an old cleanup cannot remove its replacement.
      if (entries.get(entry.id) !== entry) {
        entries.set(entry.id, entry);
        publish();
      }
      return () => { if (entries.get(entry.id) === entry) unregister(entry.id); };
    },
    registerGroup(group) {
      if (groupList.has(group.id)) return;
      groupList.set(group.id, group);
      publish();
    },
    unregister,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

function groupLabelFor(snapshot: PaletteSnapshot, id: string) {
  return snapshot.groups.find((group) => group.id === id)?.label
    ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, " ");
}

function haystack(snapshot: PaletteSnapshot, entry: PaletteEntry) {
  return `${entry.label} ${entry.keywords.join(" ")} ${entry.description ?? ""} ${groupLabelFor(snapshot, entry.group)}`.toLocaleLowerCase();
}

/**
 * The entries that match a search, best first: every word typed must appear in
 * the label, keywords, description or group; label matches rank above the rest.
 * With no query it returns everything in registration order.
 */
export function searchPalette(snapshot: PaletteSnapshot, query: string): PaletteEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...snapshot.entries];
  const scored: Array<{ entry: PaletteEntry; score: number; order: number }> = [];
  snapshot.entries.forEach((entry, order) => {
    const text = haystack(snapshot, entry);
    if (!words.every((word) => text.includes(word))) return;
    const label = entry.label.toLocaleLowerCase();
    const score = label === words.join(" ") ? 0
      : label.startsWith(words[0]!) ? 1
        : words.every((word) => label.includes(word)) ? 2
          : 3;
    scored.push({ entry, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((item) => item.entry);
}

/** What pressing Enter in the search box adds: the best match, and nothing at all while the box is empty. */
export function topPaletteMatch(snapshot: PaletteSnapshot, query: string): PaletteEntry | undefined {
  return query.trim() === "" ? undefined : searchPalette(snapshot, query)[0];
}

export type PaletteGroupView = { group: PaletteGroup; entries: PaletteEntry[] };

/**
 * The entries as groups, in the registry's group order. An entry whose group is
 * not registered gets a group of its own after the known ones. Empty groups are
 * kept only when they have an `emptyHint` and nothing is being searched.
 */
export function groupPalette(snapshot: PaletteSnapshot, entries: readonly PaletteEntry[], searching: boolean): PaletteGroupView[] {
  const known = new Set(snapshot.groups.map((group) => group.id));
  const groups: PaletteGroup[] = [...snapshot.groups];
  for (const entry of entries) {
    if (!known.has(entry.group)) {
      known.add(entry.group);
      groups.push({ id: entry.group, label: groupLabelFor(snapshot, entry.group) });
    }
  }
  return groups
    .map((group) => ({ group, entries: entries.filter((entry) => entry.group === group.id) }))
    .filter((view) => view.entries.length > 0 || (!searching && Boolean(view.group.emptyHint)));
}

// ---------------------------------------------------------------------------
// The default entries.

function unusedFieldKey(existing: readonly RegistrationFormField[]) {
  const used = new Set(existing.map((field) => field.key));
  let number = existing.length + 1;
  while (used.has(`new_field_${number}`)) number += 1;
  return `new_field_${number}`;
}

function baseField(context: PaletteInsertContext, label: string, type: RegistrationFormField["type"], extra: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return {
    id: context.newId(), key: unusedFieldKey(context.existingFields), label, helpText: "", type, scope: "REGISTRATION", required: false, options: [], ...extra,
  };
}

type TypeEntrySpec = {
  type: RegistrationFormField["type"];
  label: string;
  description: string;
  group: string;
  icon: LucideIcon;
  keywords: string[];
  extra?: (field: RegistrationFormField) => Partial<RegistrationFormField>;
  informationOnly?: boolean;
};

const choiceOptions = ["Option one", "Option two"];

const typeEntrySpecs: TypeEntrySpec[] = [
  { type: "TEXT", label: "Short text", description: "One line of text", group: PALETTE_GROUP_IDS.general, icon: Type, keywords: ["text", "single line", "answer", "name"] },
  { type: "LONG_TEXT", label: "Long answer", description: "A paragraph", group: PALETTE_GROUP_IDS.general, icon: AlignLeft, keywords: ["paragraph", "textarea", "notes", "comments"] },
  { type: "EMAIL", label: "Email", description: "An email address", group: PALETTE_GROUP_IDS.general, icon: Mail, keywords: ["e-mail", "address"] },
  { type: "PHONE", label: "Phone", description: "A phone number", group: PALETTE_GROUP_IDS.general, icon: Phone, keywords: ["telephone", "mobile", "cell"] },
  { type: "NUMBER", label: "Number", description: "A whole number", group: PALETTE_GROUP_IDS.general, icon: Hash, keywords: ["quantity", "count", "age"] },
  { type: "DATE", label: "Date", description: "A calendar date", group: PALETTE_GROUP_IDS.general, icon: Calendar, keywords: ["day", "birthday", "arrival"] },
  { type: "ADDRESS", label: "Address", description: "A mailing address", group: PALETTE_GROUP_IDS.general, icon: MapPin, keywords: ["street", "city", "zip", "mailing"] },
  { type: "SELECT", label: "Dropdown", description: "Pick one from a list", group: PALETTE_GROUP_IDS.general, icon: ChevronDown, keywords: ["select", "choice", "list", "pick one"], extra: () => ({ options: [...choiceOptions] }) },
  { type: "RADIO", label: "Single choice", description: "Pick one, shown as cards", group: PALETTE_GROUP_IDS.general, icon: CircleDot, keywords: ["radio", "choice", "yes no", "pick one"], extra: () => ({ options: [...choiceOptions] }) },
  { type: "MULTISELECT", label: "Multiple choice", description: "Pick any that apply", group: PALETTE_GROUP_IDS.general, icon: ListChecks, keywords: ["checkboxes", "choices", "pick many"], extra: () => ({ options: [...choiceOptions], minSelections: 1, maxSelections: 2 }) },
  { type: "RANKED_CHOICE", label: "Ranked choice", description: "Put choices in order", group: PALETTE_GROUP_IDS.general, icon: ListOrdered, keywords: ["rank", "order", "first choice", "preference"], extra: () => ({ options: [...choiceOptions], minSelections: 2, maxSelections: 2 }) },
  { type: "CHECKBOX", label: "Checkbox", description: "One box to tick", group: PALETTE_GROUP_IDS.general, icon: SquareCheck, keywords: ["tick", "agree", "yes", "confirm"], extra: () => ({ placeholder: "Yes, I agree" }) },
  { type: "ACKNOWLEDGMENT", label: "Recorded acknowledgment", description: "A signed-off agreement, recorded with its wording", group: PALETTE_GROUP_IDS.agreements, icon: FileCheck2, keywords: ["agreement", "waiver", "release", "policy", "consent", "terms"], extra: (field) => acknowledgmentTypePatch(field, "ACKNOWLEDGMENT") },
  { type: "MEMBER_LIST", label: "Member list", description: "Repeating rows of name, age, level and what they are working on", group: PALETTE_GROUP_IDS.people, icon: Users, keywords: ["members", "rows", "list", "adventurer", "club members"], informationOnly: true, extra: () => ({
    options: ["Level one", "Level two"],
    memberColumns: [
      { key: "name", label: "Name", type: "TEXT", required: true },
      { key: "age", label: "Age", type: "NUMBER", required: true },
      { key: "level", label: "Adventurer level", type: "SELECT", required: true },
      { key: "working_on", label: "Working on this year", type: "TEXT", required: false },
    ],
  }) },
  { type: "CALCULATED", label: "Automatic fee", description: "A fixed fee added to the total", group: PALETTE_GROUP_IDS.money, icon: Calculator, keywords: ["price", "registration fee", "cost", "charge", "payment"] },
];

function typeEntry(spec: TypeEntrySpec): PaletteEntry {
  return {
    id: `type:${spec.type}`,
    label: spec.label,
    description: spec.description,
    group: spec.group,
    icon: spec.icon,
    keywords: spec.keywords,
    ...(spec.informationOnly ? { informationOnly: true } : {}),
    add(context) {
      const field = baseField(context, spec.label, spec.type);
      return { fields: [{ ...field, ...spec.extra?.(field) }] };
    },
  };
}

const directorySpecs = [
  { source: "CLUBS_DIRECTORY", label: "Club picker", fieldLabel: "Club", noun: "club", icon: Users, keywords: ["club", "pathfinder", "adventurer", "directory"] },
  { source: "CHURCHES_DIRECTORY", label: "Church picker", fieldLabel: "Church", noun: "church", icon: Church, keywords: ["church", "congregation", "directory"] },
  { source: "SCHOOLS_DIRECTORY", label: "School picker", fieldLabel: "School", noun: "school", icon: School, keywords: ["school", "academy", "directory"] },
] as const;

function directoryEntry(spec: typeof directorySpecs[number]): PaletteEntry {
  return {
    id: `directory:${spec.source}`,
    label: spec.label,
    description: `Search the ${spec.noun} directory, with "Not listed"`,
    group: PALETTE_GROUP_IDS.people,
    icon: spec.icon,
    keywords: spec.keywords,
    add(context) {
      return { fields: [baseField(context, spec.fieldLabel, "SELECT", { required: true, optionSource: spec.source, helpText: `Start typing to search the ${spec.noun} directory.` })] };
    },
  };
}

const moneyFieldEntries: PaletteEntry[] = [
  {
    id: "money:priced-checkbox", label: "Paid add-on", description: "A checkbox that adds a price when ticked", group: PALETTE_GROUP_IDS.money, icon: DollarSign,
    keywords: ["price", "fee", "extra", "optional", "charge"], informationForm: false,
    add: (context) => ({ fields: [baseField(context, "Paid add-on", "CHECKBOX", { placeholder: "Yes, add this" })] }),
  },
  {
    id: "money:priced-quantity", label: "Priced quantity", description: "A number multiplied by a price", group: PALETTE_GROUP_IDS.money, icon: Tag,
    keywords: ["price per item", "tickets", "quantity", "count", "cost"], informationForm: false,
    add: (context) => ({ fields: [baseField(context, "Quantity", "NUMBER")] }),
  },
];

/** The group a ready-made module is shown under. A module can override it with an entry of its own. */
export function moduleGroupId(candidate: Pick<BuilderModuleDefinition, "key" | "category">): string {
  if (candidate.key === "promo_code" || candidate.key === "scheduled_fee" || candidate.key === "payment_method") return PALETTE_GROUP_IDS.money;
  if (candidate.key === "agreement" || candidate.key === "recorded_acknowledgment") return PALETTE_GROUP_IDS.agreements;
  if (candidate.category === "People") return PALETTE_GROUP_IDS.people;
  if (candidate.category === "Housing" || candidate.category === "Group event") return PALETTE_GROUP_IDS.modules;
  return PALETTE_GROUP_IDS.general;
}

export function moduleEntry(moduleDef: BuilderModuleDefinition, group: string = moduleGroupId(moduleDef)): PaletteEntry {
  return {
    id: `module:${moduleDef.key}`,
    label: moduleDef.name,
    description: moduleDef.description,
    group,
    icon: Layers3,
    keywords: [moduleDef.category, moduleDef.key.replace(/_/g, " "), `${moduleDef.fields.length} field${moduleDef.fields.length === 1 ? "" : "s"}`],
    add(context) {
      const plan = planModuleInsert(moduleDef, context.existingFields, context.newId);
      return { fields: plan.kind === "insert" ? (plan.fields as RegistrationFormField[]) : [], module: moduleDef };
    },
  };
}

/** Register every module in `modules` that is not registered yet. */
export function registerBuilderModules(registry: PaletteRegistry, modules: readonly BuilderModuleDefinition[] = builderFieldModules) {
  const present = new Set(registry.getSnapshot().entries.map((entry) => entry.id));
  for (const moduleDef of modules) {
    if (!present.has(`module:${moduleDef.key}`)) registry.register(moduleEntry(moduleDef));
  }
}

/** The registry the builder uses: field types, directory pickers, money entries and every builder module. */
export function createDefaultPaletteRegistry(): PaletteRegistry {
  const registry = createPaletteRegistry();
  typeEntrySpecs.forEach((spec) => registry.register(typeEntry(spec)));
  directorySpecs.forEach((spec) => registry.register(directoryEntry(spec)));
  moneyFieldEntries.forEach((entry) => registry.register(entry));
  registerBuilderModules(registry);
  return registry;
}

/** The shared registry. Feature code registers its own entries on it, e.g. `paletteRegistry.register(entry)`. */
export const paletteRegistry: PaletteRegistry = createDefaultPaletteRegistry();
