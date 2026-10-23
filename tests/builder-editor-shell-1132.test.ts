import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Tag } from "lucide-react";
import { BuilderSidebar } from "@/components/registration-builder/builder-sidebar";
import { PaletteList } from "@/components/registration-builder/builder-palette";
import { FieldPreviewControl } from "@/components/registration-builder/builder-canvas";
import { buildCanvasRows, locateField } from "@/components/registration-builder/canvas-rows";
import {
  DEFAULT_EDITOR_LAYOUT, EDITOR_LAYOUT_STORAGE_KEY, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STEP, browserLayoutStorage,
  clampSidebarWidth, createEditorLayoutStore, parseEditorLayout, readEditorLayout, resizeSidebar, widthFromPointer, writeEditorLayout,
  type LayoutStorage,
} from "@/components/registration-builder/editor-layout";
import { avoidCollisions, planPaletteInsert } from "@/components/registration-builder/palette-insert";
import { planFieldDrop } from "@/components/registration-builder/field-drop";
import { autoFieldKey, isReservedFieldKey, uniqueFieldKey } from "@/components/registration-builder/field-keys";
import { focusTargetAction, isSearchShortcut } from "@/components/registration-builder/shell-keys";
import { useBuilderEdits } from "@/components/registration-builder/use-builder-edits";
import { displayedSidebarWidth, maxSidebarWidthFor, revealSidebar } from "@/components/registration-builder/editor-layout";
import {
  createDefaultPaletteRegistry, createPaletteRegistry, groupPalette, moduleEntry, moduleGroupId, searchPalette, topPaletteMatch,
  type PaletteEntry,
} from "@/components/registration-builder/palette-registry";
import { nextTabIndex, tabAfterSelectionChange } from "@/components/registration-builder/sidebar-tabs";
import { builderFieldModules, type BuilderModuleDefinition } from "@/modules/forms/builder-modules";
import { formFieldTypes, getFormTemplate, registrationFormDefinitionSchema, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function sampleDefinition(): RegistrationFormDefinition {
  const template = getFormTemplate("honors_weekend");
  if (!template) throw new Error("honors_weekend template missing");
  return structuredClone(template.definition);
}

function idMaker() {
  let count = 0;
  return () => `synthetic_id_${++count}`;
}

// A synthetic module that exists only in this test.
const syntheticModule: BuilderModuleDefinition = {
  key: "synthetic_swag_table",
  category: "Group event",
  name: "Swag table pickup",
  description: "Where a club collects its welcome bags",
  fields: [
    { key: "swag_pickup_time", label: "Swag pickup time", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
    { key: "swag_pickup_notes", label: "Swag pickup notes", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] },
  ],
};

function memoryStorage(initial: Record<string, string> = {}): LayoutStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

const throwingStorage: LayoutStorage = {
  getItem: () => { throw new Error("storage blocked"); },
  setItem: () => { throw new Error("storage blocked"); },
  removeItem: () => { throw new Error("storage blocked"); },
};

describe("the palette registry (#1132)", () => {
  const registry = createDefaultPaletteRegistry();
  const snapshot = registry.getSnapshot();

  it("has the six groups in the agreed order", () => {
    expect(snapshot.groups.map((group) => group.label)).toEqual([
      "General questions", "People and directory", "Money", "Agreements", "Modules", "Question library",
    ]);
  });

  it("gives every entry an id, label, group, icon, keywords and add(), with unique ids", () => {
    const ids = new Set<string>();
    for (const entry of snapshot.entries) {
      expect(entry.id).toBeTruthy();
      expect(ids.has(entry.id), entry.id).toBe(false);
      ids.add(entry.id);
      expect(entry.label).toBeTruthy();
      expect(snapshot.groups.some((group) => group.id === entry.group), `${entry.id} group`).toBe(true);
      expect(entry.icon).toBeTruthy();
      expect(Array.isArray(entry.keywords)).toBe(true);
      expect(typeof entry.add).toBe("function");
    }
  });

  it("covers every field type and every builder module", () => {
    const ids = new Set(snapshot.entries.map((entry) => entry.id));
    for (const type of formFieldTypes) expect(ids.has(`type:${type}`), type).toBe(true);
    for (const candidate of builderFieldModules) expect(ids.has(`module:${candidate.key}`), candidate.key).toBe(true);
  });

  it("puts modules under the agreed groups", () => {
    const groupOf = (key: string) => snapshot.entries.find((entry) => entry.id === `module:${key}`)?.group;
    expect(groupOf("housing")).toBe("modules");
    expect(groupOf("meal_tickets")).toBe("modules");
    expect(groupOf("campsite")).toBe("modules");
    expect(groupOf("promo_code")).toBe("money");
    expect(groupOf("guest_roster")).toBe("people");
    expect(moduleGroupId({ key: "anything", category: "Common" })).toBe("general");
  });

  it("shows a test module that is registered, with no change to the sidebar", () => {
    const own = createDefaultPaletteRegistry();
    const before = renderToStaticMarkup(createElement(PaletteList, {
      snapshot: own.getSnapshot(), query: "", openGroups: new Set(["modules"]), onToggleGroup: () => {}, onAdd: () => {},
    }));
    expect(before).not.toContain(syntheticModule.name);

    const unregister = own.register(moduleEntry(syntheticModule));
    const after = renderToStaticMarkup(createElement(PaletteList, {
      snapshot: own.getSnapshot(), query: "", openGroups: new Set(["modules"]), onToggleGroup: () => {}, onAdd: () => {},
    }));
    expect(after).toContain(syntheticModule.name);
    expect(after).toContain('data-palette-entry="module:synthetic_swag_table"');
    // It is found by search too.
    expect(searchPalette(own.getSnapshot(), "swag").map((entry) => entry.id)).toEqual(["module:synthetic_swag_table"]);
    // And removing it takes it away again.
    unregister();
    expect(own.getSnapshot().entries.some((entry) => entry.id === "module:synthetic_swag_table")).toBe(false);

    // The sidebar files list whatever is registered; they never name a field type or a module.
    for (const file of ["components/registration-builder/builder-palette.tsx", "components/registration-builder/builder-sidebar.tsx", "components/registration-builder/builder-editor-shell.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain("builderFieldModules");
      expect(source, file).not.toContain("modules/forms/builder-modules");
      expect(source, file).not.toMatch(/module:|type:[A-Z]/);
    }
  });

  it("registers a plain entry in a group of its own without touching the sidebar", () => {
    const own = createPaletteRegistry();
    own.register({ id: "saved:synthetic", label: "Synthetic saved question", group: "library-extras", icon: Tag, keywords: ["library"], add: () => ({ fields: [] }) });
    const groups = groupPalette(own.getSnapshot(), own.getSnapshot().entries, false);
    expect(groups.map((view) => view.group.id)).toContain("library-extras");
    expect(groups.find((view) => view.group.id === "library-extras")?.group.label).toBe("Library extras");
  });

  it("replaces an entry registered again, ignores the identical one, and tells subscribers about each change", () => {
    const own = createPaletteRegistry();
    const listener = vi.fn();
    const stop = own.subscribe(listener);
    const entry: PaletteEntry = { id: "x:1", label: "One", group: "general", icon: Tag, keywords: [], add: () => ({ fields: [] }) };
    own.register(entry);
    own.register(entry);
    expect(listener).toHaveBeenCalledTimes(1);
    own.unregister("x:1");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    own.register(entry);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the Question library group, with its hint, until something is saved", () => {
    const groups = groupPalette(snapshot, snapshot.entries, false);
    const saved = groups.find((view) => view.group.id === "saved");
    expect(saved?.entries).toEqual([]);
    expect(saved?.group.emptyHint).toBeTruthy();
    expect(groupPalette(snapshot, searchPalette(snapshot, "email"), true).some((view) => view.group.id === "saved")).toBe(false);
  });
});

describe("palette search (#1132)", () => {
  const snapshot = createDefaultPaletteRegistry().getSnapshot();

  it("returns everything with no query, in registration order", () => {
    expect(searchPalette(snapshot, "  ").length).toBe(snapshot.entries.length);
  });

  it("matches labels and keywords, and every word typed must match", () => {
    expect(searchPalette(snapshot, "email")[0]?.id).toBe("type:EMAIL");
    expect(searchPalette(snapshot, "e-mail").map((entry) => entry.id)).toContain("type:EMAIL");
    expect(searchPalette(snapshot, "housing").map((entry) => entry.id)).toContain("module:housing");
    expect(searchPalette(snapshot, "club directory").map((entry) => entry.id)).toContain("directory:CLUBS_DIRECTORY");
    expect(searchPalette(snapshot, "zzzz nothing")).toEqual([]);
  });

  it("ranks a label match above a keyword match", () => {
    const ids = searchPalette(snapshot, "phone").map((entry) => entry.id);
    expect(ids[0]).toBe("type:PHONE");
  });

  it("adds the top match on Enter, and nothing while the box is empty", () => {
    expect(topPaletteMatch(snapshot, "")).toBeUndefined();
    expect(topPaletteMatch(snapshot, "   ")).toBeUndefined();
    expect(topPaletteMatch(snapshot, "long")?.id).toBe("type:LONG_TEXT");
  });
});

describe("what an entry adds (#1132)", () => {
  const registry = createDefaultPaletteRegistry();
  const entryFor = (id: string) => registry.getSnapshot().entries.find((entry) => entry.id === id)!;

  it("every entry's fields are valid in a form, with unused keys", () => {
    const definition = sampleDefinition();
    const newId = idMaker();
    for (const entry of registry.getSnapshot().entries) {
      const plan = planPaletteInsert(definition, entry, 0, undefined, newId);
      if (plan.kind === "nothing") continue; // a singleton module already on the form
      if (plan.kind === "module") {
        expect(plan.module.key, entry.id).toBe(entry.id.replace("module:", ""));
        continue;
      }
      expect(plan.kind, entry.id).toBe("inserted");
      if (plan.kind !== "inserted") continue;
      const parsed = registrationFormDefinitionSchema.safeParse({ ...definition, sections: plan.sections });
      if (entry.id === "type:ACKNOWLEDGMENT") {
        // A new acknowledgment waits for its wording, exactly as when the type is changed in the settings.
        expect(parsed.success).toBe(false);
        if (!parsed.success) expect(parsed.error.issues.every((issue) => issue.path.includes("acknowledgment"))).toBe(true);
      } else {
        expect(parsed.success, `${entry.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
      }
      const keys = plan.sections.flatMap((section) => section.fields.map((field) => field.key));
      expect(new Set(keys).size, `${entry.id} keys are unique`).toBe(keys.length);
    }
  });

  it("gives choice entries two options and an acknowledgment its wording setup", () => {
    const ctx = { existingFields: [] as RegistrationFormField[], newId: idMaker() };
    expect(entryFor("type:RADIO").add(ctx).fields[0]?.options).toEqual(["Option one", "Option two"]);
    expect(entryFor("type:MULTISELECT").add(ctx).fields[0]).toMatchObject({ minSelections: 1, maxSelections: 2 });
    expect(entryFor("type:ACKNOWLEDGMENT").add(ctx).fields[0]?.acknowledgment).toBeTruthy();
    expect(entryFor("directory:CHURCHES_DIRECTORY").add(ctx).fields[0]).toMatchObject({ type: "SELECT", optionSource: "CHURCHES_DIRECTORY", scope: "REGISTRATION" });
  });

  it("returns a module's fields and the module itself", () => {
    const insert = entryFor("module:housing").add({ existingFields: [], newId: idMaker() });
    expect(insert.module?.key).toBe("housing");
    expect(insert.fields.map((field) => field.key)).toContain("housing_selection");
  });
});

describe("adding to a step (#1132)", () => {
  const registry = createDefaultPaletteRegistry();
  const shortText = registry.getSnapshot().entries.find((entry) => entry.id === "type:TEXT")!;

  it("puts the question at the end of the chosen step and selects it", () => {
    const definition = sampleDefinition();
    const target = definition.sections.length - 1;
    const before = definition.sections[target]!.fields.length;
    const plan = planPaletteInsert(definition, shortText, target, undefined, idMaker());
    expect(plan.kind).toBe("inserted");
    if (plan.kind !== "inserted") return;
    const fields = plan.sections[target]!.fields;
    expect(fields).toHaveLength(before + 1);
    expect(fields[fields.length - 1]?.id).toBe(plan.selectedFieldId);
    // Other steps are untouched.
    plan.sections.forEach((section, index) => { if (index !== target) expect(section).toBe(definition.sections[index]); });
  });

  it("inserts at a dropped position, clamped to the step", () => {
    const definition = sampleDefinition();
    const first = planPaletteInsert(definition, shortText, 0, 0, idMaker());
    const clamped = planPaletteInsert(definition, shortText, 0, 999, idMaker());
    const negative = planPaletteInsert(definition, shortText, 0, -4, idMaker());
    if (first.kind !== "inserted" || clamped.kind !== "inserted" || negative.kind !== "inserted") throw new Error("expected inserts");
    expect(first.sections[0]!.fields[0]?.id).toBe(first.selectedFieldId);
    expect(negative.sections[0]!.fields[0]?.id).toBe(negative.selectedFieldId);
    const length = definition.sections[0]!.fields.length;
    expect(clamped.sections[0]!.fields[length]?.id).toBe(clamped.selectedFieldId);
  });

  it("refuses to grow a step past 20 fields, and a missing step is ignored", () => {
    const definition = sampleDefinition();
    const full = definition.sections[0]!;
    full.fields = Array.from({ length: 20 }, (_, index) => ({ ...full.fields[0]!, id: `f${index}`, key: `key_${index}` }));
    expect(planPaletteInsert(definition, shortText, 0, undefined, idMaker()).kind).toBe("error");
    expect(planPaletteInsert(definition, shortText, 99, undefined, idMaker()).kind).toBe("nothing");
  });

  it("hands modules to the builder's module insert, with the drop position", () => {
    const definition = sampleDefinition();
    const plan = planPaletteInsert(definition, registry.getSnapshot().entries.find((entry) => entry.id === "module:housing")!, 0, 1, idMaker());
    expect(plan).toMatchObject({ kind: "module", atIndex: 1 });
  });

  it("does not change the draft when nothing is inserted", () => {
    const definition = sampleDefinition();
    const copy = structuredClone(definition);
    planPaletteInsert(definition, shortText, 0, undefined, idMaker());
    expect(definition).toEqual(copy);
  });
});

describe("selection and tabs (#1132)", () => {
  it("opens Question settings when a question becomes selected, however it was selected", () => {
    expect(tabAfterSelectionChange("questions", null, "field_1")).toBe("settings");
    expect(tabAfterSelectionChange("history", "field_1", "field_2")).toBe("settings");
  });

  it("leaves the tab alone when the selection is unchanged or cleared", () => {
    expect(tabAfterSelectionChange("questions", "field_1", "field_1")).toBe("questions");
    expect(tabAfterSelectionChange("settings", "field_1", null)).toBe("settings");
    expect(tabAfterSelectionChange("questions", null, null)).toBe("questions");
  });

  it("moves between tabs with the arrow keys, wrapping, plus Home and End", () => {
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextTabIndex("Home", 2, 3)).toBe(0);
    expect(nextTabIndex("End", 0, 3)).toBe(2);
    expect(nextTabIndex("a", 0, 3)).toBeNull();
  });

  it("renders tablist semantics: one selected tab, its panel shown, the others hidden", () => {
    const markup = renderToStaticMarkup(createElement(BuilderSidebar, {
      tabs: [
        { id: "questions", label: "Questions", panel: "Q panel" },
        { id: "settings", label: "Question settings", panel: "S panel" },
        { id: "history", label: "History", panel: "H panel" },
      ],
      activeTab: "settings", onTabChange: () => {}, layout: DEFAULT_EDITOR_LAYOUT, shownWidth: 380, maxWidth: 600, onResize: () => {}, containerRef: { current: null },
    }));
    expect(markup).toContain('role="tablist"');
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(markup).toMatch(/id="fb-tab-settings"[^>]*aria-selected="true"/);
    expect(markup).toMatch(/id="fb-tab-questions"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(markup).toMatch(/role="tabpanel" id="fb-panel-questions"[^>]*hidden/);
    expect(markup).toMatch(/role="tabpanel" id="fb-panel-settings" aria-labelledby="fb-tab-settings"(?![^>]*hidden)/);
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-valuenow="380"');
  });

  it("renders palette group headers as buttons with aria-expanded, folded groups hidden", () => {
    const snapshot = createDefaultPaletteRegistry().getSnapshot();
    const markup = renderToStaticMarkup(createElement(PaletteList, {
      snapshot, query: "", openGroups: new Set(["general"]), onToggleGroup: () => {}, onAdd: () => {},
    }));
    expect(markup).toMatch(/<button type="button" class="fb-palette-group-toggle" aria-expanded="true" aria-controls="fb-palette-group-general"/);
    expect(markup).toMatch(/aria-expanded="false" aria-controls="fb-palette-group-money"/);
    expect(markup).toMatch(/<div id="fb-palette-group-money" hidden/);
    expect(markup).toContain("Question library");
    expect(markup).toContain("Questions saved to the library appear here.");
  });

  it("opens every group that has a match while searching, and says when nothing matches", () => {
    const snapshot = createDefaultPaletteRegistry().getSnapshot();
    const found = renderToStaticMarkup(createElement(PaletteList, { snapshot, query: "housing", openGroups: new Set<string>(), onToggleGroup: () => {}, onAdd: () => {} }));
    expect(found).toMatch(/aria-expanded="true" aria-controls="fb-palette-group-modules"/);
    expect(found).not.toContain("Question library");
    const none = renderToStaticMarkup(createElement(PaletteList, { snapshot, query: "qqqq", openGroups: new Set<string>(), onToggleGroup: () => {}, onAdd: () => {} }));
    expect(none).toContain("No questions match");
  });
});

describe("the canvas (#1132)", () => {
  const field = (id: string, group?: string): RegistrationFormField => ({ id, key: id, label: id, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...(group ? { group } : {}) });

  it("lays consecutive fields with the same group side by side and every other field on its own row", () => {
    const rows = buildCanvasRows([field("a"), field("b", "1. Pastor"), field("c", "1. Pastor"), field("d", "2. Elder"), field("e")]);
    expect(rows.map((row) => row.cells.map((cell) => cell.field.id))).toEqual([["a"], ["b", "c"], ["d"], ["e"]]);
    expect(rows[1]?.groupLabel).toBe("1. Pastor");
    expect(rows[1]?.cells.map((cell) => cell.fieldIndex)).toEqual([1, 2]);
  });

  it("finds a selected field's step and place, and nothing for a removed one", () => {
    const sections = [{ id: "s1", fields: [field("a")] }, { id: "s2", fields: [field("b"), field("c")] }];
    expect(locateField(sections, "c")).toMatchObject({ sectionIndex: 1, fieldIndex: 1 });
    expect(locateField(sections, "gone")).toBeNull();
    expect(locateField(sections, null)).toBeNull();
  });

  it("shows real labels' controls: a directory picker, choices and a fee", () => {
    const directory = renderToStaticMarkup(createElement(FieldPreviewControl, { field: { ...field("x"), type: "SELECT", optionSource: "CLUBS_DIRECTORY" } }));
    expect(directory).toContain("Search clubs");
    const choices = renderToStaticMarkup(createElement(FieldPreviewControl, { field: { ...field("y"), type: "RADIO", options: ["Adult", "Teen"] } }));
    expect(choices).toContain("Adult");
    expect(choices).toContain("Teen");
    const fee = renderToStaticMarkup(createElement(FieldPreviewControl, { field: { ...field("z"), type: "CALCULATED", priceCents: 12500 } }));
    expect(fee).toContain("$125.00");
  });
});

describe("the movable sidebar layout (#1132)", () => {
  it("defaults to a visible sidebar on the right", () => {
    expect(DEFAULT_EDITOR_LAYOUT).toMatchObject({ sidebarVisible: true, side: "right" });
  });

  it("clamps the width to the minimum and maximum", () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(5000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_EDITOR_LAYOUT.width);
    expect(resizeSidebar(DEFAULT_EDITOR_LAYOUT, SIDEBAR_WIDTH_STEP).width).toBe(DEFAULT_EDITOR_LAYOUT.width + SIDEBAR_WIDTH_STEP);
    expect(resizeSidebar({ ...DEFAULT_EDITOR_LAYOUT, width: MIN_SIDEBAR_WIDTH }, -SIDEBAR_WIDTH_STEP).width).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("turns a drag of the edge into a width, for either side", () => {
    expect(widthFromPointer("right", 700, 0, 1100)).toBe(400);
    expect(widthFromPointer("left", 450, 100, 1100)).toBe(350);
    expect(widthFromPointer("right", 1090, 0, 1100)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("falls back to the default for missing, malformed or out-of-range stored values", () => {
    expect(parseEditorLayout(null)).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(parseEditorLayout("not json")).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(parseEditorLayout("[1,2]")).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(parseEditorLayout(JSON.stringify({ sidebarVisible: "yes", side: "up", width: "wide" }))).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(parseEditorLayout(JSON.stringify({ sidebarVisible: false, side: "left", width: 9999 }))).toEqual({ sidebarVisible: false, side: "left", width: MAX_SIDEBAR_WIDTH });
  });

  it("remembers a layout in storage and reads it back", () => {
    const storage = memoryStorage();
    expect(writeEditorLayout({ sidebarVisible: false, side: "left", width: 450 }, storage)).toBe(true);
    expect(storage.data.has(EDITOR_LAYOUT_STORAGE_KEY)).toBe(true);
    expect(readEditorLayout(storage)).toEqual({ sidebarVisible: false, side: "left", width: 450 });
  });

  it("a store persists changes across a reload, and Reset layout restores the default and forgets it", () => {
    const storage = memoryStorage();
    const first = createEditorLayoutStore(() => storage);
    const listener = vi.fn();
    first.subscribe(listener);
    expect(first.getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
    first.set({ sidebarVisible: true, side: "left", width: 520 });
    expect(listener).toHaveBeenCalledTimes(1);

    const reloaded = createEditorLayoutStore(() => storage);
    expect(reloaded.getSnapshot()).toEqual({ sidebarVisible: true, side: "left", width: 520 });

    reloaded.reset();
    expect(reloaded.getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(storage.data.has(EDITOR_LAYOUT_STORAGE_KEY)).toBe(false);
    expect(createEditorLayoutStore(() => storage).getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
  });

  it("keeps working, in memory, when storage is missing", () => {
    const store = createEditorLayoutStore(() => null);
    expect(store.getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
    store.set({ sidebarVisible: false, side: "left", width: 400 });
    expect(store.getSnapshot()).toEqual({ sidebarVisible: false, side: "left", width: 400 });
    store.reset();
    expect(store.getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
  });

  it("never throws when storage refuses every read and write", () => {
    expect(readEditorLayout(throwingStorage)).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(writeEditorLayout(DEFAULT_EDITOR_LAYOUT, throwingStorage)).toBe(false);
    const store = createEditorLayoutStore(() => throwingStorage);
    expect(store.getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(() => store.set({ sidebarVisible: true, side: "left", width: 333 })).not.toThrow();
    expect(store.getSnapshot().width).toBe(333);
    expect(() => store.reset()).not.toThrow();
    expect(store.getSnapshot()).toEqual(DEFAULT_EDITOR_LAYOUT);
  });

  it("treats a localStorage property that throws as no storage", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("blocked"); } } });
    try {
      expect(browserLayoutStorage()).toBeNull();
      expect(readEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);
      expect(writeEditorLayout(DEFAULT_EDITOR_LAYOUT)).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original); else delete (globalThis as { window?: unknown }).window;
    }
  });
});

describe("the editor shell, rendered (#1132)", () => {
  async function renderShell(options: { selectFirstField?: boolean; status?: string; readOnly?: boolean } = {}) {
    const { BuilderContext } = await import("@/components/registration-builder/builder-context");
    const { BuilderEditorShell } = await import("@/components/registration-builder/builder-editor-shell");
    const { useBuilderModel } = await import("@/components/registration-builder/use-builder-model");
    const definition = sampleDefinition();
    const version = {
      id: "v1", versionNumber: 2, status: options.status ?? "DRAFT", definition, publishedAt: null,
      createdAt: "2028-08-01T00:00:00.000Z", updatedAt: "2028-08-01T00:00:00.000Z", createdBy: "Synthetic Staff",
      testSubmissionCount: 0, choiceUsage: {}, testSubmissions: [],
    };
    const form = {
      id: "form-1", eventId: "event-1", name: "Synthetic Weekend", slug: "synthetic-weekend", status: "DRAFT",
      createdAt: version.createdAt, updatedAt: version.updatedAt, createdBy: "Synthetic Staff", activeVersion: version, versions: [version],
    };
    const focusTarget = options.selectFirstField ? { formId: "form-1", fieldId: definition.sections[0]!.fields[0]!.id } : null;
    function Harness() {
      const model = useBuilderModel({ eventId: "event-1", eventSlug: "synthetic", eventName: "Synthetic Event", initialForms: [form], templates: [], focusTarget, canEditNotifications: false }, (async () => true) as never);
      return createElement(BuilderContext.Provider, { value: options.readOnly ? { ...model, canEdit: false } : model }, createElement(BuilderEditorShell, { focusTarget }));
    }
    return { markup: renderToStaticMarkup(createElement(Harness)), definition };
  }

  it("shows the top bar, the form as steps with real labels, and the five sidebar tabs", async () => {
    const { markup, definition } = await renderShell();
    expect(markup).toContain('class="fb-topbar"');
    expect(markup).toContain("Synthetic Weekend");
    expect(markup).toContain("Draft (version 2)");
    for (const label of ["Editor", "Settings &amp; payment", "Preview &amp; test", "Publish version"]) expect(markup).toContain(label);
    expect(markup).toContain('aria-label="Layout options"');
    for (const section of definition.sections) expect(markup).toContain(`Step ${definition.sections.indexOf(section) + 1}`);
    expect(markup).toContain(definition.sections[0]!.fields[0]!.label);
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(5);
    expect(markup).toContain("Rule summary");
    expect(markup).toMatch(/id="fb-tab-questions"[^>]*aria-selected="true"/);
    expect(markup).toContain("Add a question to step 1");
    expect(markup).toContain("Select a question on the form to change its settings.");
    // The first test is still required before a first publish.
    expect(markup).toContain("Run a test submission first");
  });

  it("selecting a question (here, arriving from a setup warning) opens its settings, basic ones first", async () => {
    const { markup, definition } = await renderShell({ selectFirstField: true });
    const first = definition.sections[0]!.fields[0]!;
    expect(markup).toMatch(/id="fb-tab-settings"[^>]*aria-selected="true"/);
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain(`Move ${first.label} down`);
    expect(markup).toContain(`Remove ${first.label}`);
    expect(markup).toContain(`Duplicate ${first.label}`);
    expect(markup).toContain('id="fb-setting-label"');
    expect(markup).toContain("Asked once");
    expect(markup).toContain("Asked of each person");
    expect(markup.indexOf('id="fb-setting-label"')).toBeLessThan(markup.indexOf("<summary>Advanced</summary>"));
    // The first field cannot move up, but the button stays focusable.
    expect(markup).toMatch(new RegExp(`aria-label="Move ${first.label.replace(/[()?.]/g, "\\$&")} up" aria-disabled="true"`));
  });

});

describe("the editor shell in read-only mode (#1132)", () => {
  it("shows no toolbar, add buttons or step add, and disables the palette", async () => {
    const { BuilderContext } = await import("@/components/registration-builder/builder-context");
    const { BuilderEditorShell } = await import("@/components/registration-builder/builder-editor-shell");
    const { useBuilderModel } = await import("@/components/registration-builder/use-builder-model");
    const definition = sampleDefinition();
    const version = {
      id: "v1", versionNumber: 1, status: "ARCHIVED", definition, publishedAt: null, createdAt: "2028-08-01T00:00:00.000Z",
      updatedAt: "2028-08-01T00:00:00.000Z", createdBy: "Synthetic Staff", testSubmissionCount: 0, choiceUsage: {}, testSubmissions: [],
    };
    const form = { id: "form-1", eventId: "event-1", name: "Synthetic", slug: "synthetic", status: "DRAFT", createdAt: version.createdAt, updatedAt: version.updatedAt, createdBy: "Synthetic Staff", activeVersion: version, versions: [version] };
    const focusTarget = { formId: "form-1", fieldId: definition.sections[0]!.fields[0]!.id };
    function Harness() {
      const model = useBuilderModel({ eventId: "event-1", eventSlug: "synthetic", eventName: "Synthetic Event", initialForms: [form], templates: [], focusTarget }, (async () => true) as never);
      return createElement(BuilderContext.Provider, { value: { ...model, canEdit: false } }, createElement(BuilderEditorShell, { focusTarget }));
    }
    const markup = renderToStaticMarkup(createElement(Harness));
    expect(markup).not.toContain('class="fb-toolbar"');
    expect(markup).not.toContain("data-fb-step-add");
    expect(markup).not.toContain("Add another section");
    expect(markup).toContain("This version is read-only");
    expect(markup).toMatch(/class="fb-palette-item"[^>]*disabled/);
    // Selecting still works to read a question's settings, which are disabled inputs.
    expect(markup).toMatch(/id="fb-setting-label"[^>]*disabled/);
  });
});

describe("dragging a field to a new place (#1132)", () => {
  const field = (id: string): RegistrationFormField => ({ id, key: id, label: id, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] });
  const sections = (...lists: string[][]) => lists.map((ids, index) => ({ id: `s${index}`, title: `S${index}`, description: "", fields: ids.map(field) }));
  const order = (plan: ReturnType<typeof planFieldDrop>, step = 0) => plan.kind === "moved" ? plan.sections[step]!.fields.map((candidate) => candidate.id) : plan.kind;

  it("dropping on a later field puts the dragged field in front of it", () => {
    // a b c d: drag a onto c (index 2) -> b a c d. Before the fix this gave b c a d.
    expect(order(planFieldDrop(sections(["a", "b", "c", "d"]), { sectionIndex: 0, fieldIndex: 0 }, { sectionIndex: 0, fieldIndex: 2 }))).toEqual(["b", "a", "c", "d"]);
  });

  it("dropping on an earlier field, or at the end of the step", () => {
    expect(order(planFieldDrop(sections(["a", "b", "c", "d"]), { sectionIndex: 0, fieldIndex: 3 }, { sectionIndex: 0, fieldIndex: 1 }))).toEqual(["a", "d", "b", "c"]);
    expect(order(planFieldDrop(sections(["a", "b", "c"]), { sectionIndex: 0, fieldIndex: 0 }, { sectionIndex: 0, fieldIndex: 3 }))).toEqual(["b", "c", "a"]);
  });

  it("dropping where it already is changes nothing", () => {
    expect(planFieldDrop(sections(["a", "b", "c"]), { sectionIndex: 0, fieldIndex: 1 }, { sectionIndex: 0, fieldIndex: 1 }).kind).toBe("nothing");
    expect(planFieldDrop(sections(["a", "b", "c"]), { sectionIndex: 0, fieldIndex: 1 }, { sectionIndex: 0, fieldIndex: 2 }).kind).toBe("nothing");
  });

  it("moves between steps to the dropped index, keeping each step at least one field", () => {
    const plan = planFieldDrop(sections(["a", "b"], ["c", "d"]), { sectionIndex: 0, fieldIndex: 1 }, { sectionIndex: 1, fieldIndex: 1 });
    expect(order(plan, 0)).toEqual(["a"]);
    expect(order(plan, 1)).toEqual(["c", "b", "d"]);
    expect(planFieldDrop(sections(["a"], ["c"]), { sectionIndex: 0, fieldIndex: 0 }, { sectionIndex: 1, fieldIndex: 0 }).kind).toBe("error");
  });

  it("refuses to push another step past 20 fields, but allows a reorder inside a full step", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `f${index}`);
    const full = sections(["a", "b"], twenty);
    expect(planFieldDrop(full, { sectionIndex: 0, fieldIndex: 0 }, { sectionIndex: 1, fieldIndex: 3 }).kind).toBe("error");
    expect(planFieldDrop(sections(twenty), { sectionIndex: 0, fieldIndex: 0 }, { sectionIndex: 0, fieldIndex: 5 }).kind).toBe("moved");
  });

  it("does not change the definition it is given", () => {
    const input = sections(["a", "b", "c"]);
    const copy = structuredClone(input);
    planFieldDrop(input, { sectionIndex: 0, fieldIndex: 0 }, { sectionIndex: 0, fieldIndex: 3 });
    expect(input).toEqual(copy);
  });
});

describe("keys made up by the editor (#1132)", () => {
  const field = (id: string, key: string): RegistrationFormField => ({ id, key, label: key, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] });

  it("keeps an auto key unique with a suffix", () => {
    expect(autoFieldKey("Team name", [])).toBe("team_name");
    expect(autoFieldKey("Team name", ["team_name"])).toBe("team_name_2");
    expect(autoFieldKey("Team name", ["team_name", "team_name_2"])).toBe("team_name_3");
  });

  it("never auto-produces the promo code, an age key or a meal-ticket key", () => {
    expect(isReservedFieldKey("promo_code")).toBe(true);
    expect(isReservedFieldKey("age")).toBe(true);
    expect(autoFieldKey("Promo code", [])).toBe("promo_code_2");
    expect(autoFieldKey("Age", [])).toBe("age_2");
    const mealKey = ["sabbath_lunch_adult", "lunch_adult", "dinner_adult"].find((key) => isReservedFieldKey(key));
    if (mealKey) expect(autoFieldKey(mealKey.replace(/_/g, " "), [])).not.toBe(mealKey);
    expect(isReservedFieldKey("team_name")).toBe(false);
    expect(uniqueFieldKey("promo_code", new Set(), { avoidReserved: false })).toBe("promo_code");
  });

  it("a typed label with the key placeholder gets the unique key through the palette's own fields too", () => {
    const entry: PaletteEntry = { id: "saved:clash", label: "Clash", group: "saved", icon: Tag, keywords: [], add: () => ({ fields: [{ ...field("field_x", "email"), conditional: { fieldKey: "email_other", operator: "NOT_EMPTY", value: "" } }, field("field_y", "email_other")] }) };
    const definition = sampleDefinition();
    const existing = definition.sections.flatMap((section) => section.fields);
    const clashingKey = existing[0]!.key;
    const clashingId = existing[0]!.id;
    const entryWithClash: PaletteEntry = { ...entry, add: () => ({ fields: [{ ...field(clashingId, clashingKey), conditional: undefined }, { ...field("fresh", "other"), conditional: { fieldKey: clashingKey, operator: "NOT_EMPTY", value: "" } }] }) };
    const plan = planPaletteInsert(definition, entryWithClash, 0, undefined, idMaker());
    if (plan.kind !== "inserted") throw new Error("expected insert");
    const inserted = plan.sections[0]!.fields.slice(-2);
    expect(inserted[0]!.id).not.toBe(clashingId);
    expect(inserted[0]!.key).toBe(`${clashingKey}_2`);
    expect(inserted[1]!.conditional?.fieldKey).toBe(`${clashingKey}_2`);
    const keys = plan.sections.flatMap((section) => section.fields.map((candidate) => candidate.key));
    const ids = plan.sections.flatMap((section) => section.fields.map((candidate) => candidate.id));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lets a Number question labelled Age have the age key, but not other types", () => {
    expect(autoFieldKey("Age", [], "NUMBER")).toBe("age");
    expect(autoFieldKey("Age", [], "TEXT")).toBe("age_2");
    expect(isReservedFieldKey("age", "NUMBER")).toBe(false);
    expect(isReservedFieldKey("age", "SELECT")).toBe(true);
    expect(isReservedFieldKey("promo_code", "NUMBER")).toBe(true);
  });

  it("follows the label as it is typed, reaching the full key, and keeps following when the label is cleared", () => {
    const typed = ["T", "Te", "Tea", "Team", "Team n", "Team name"].map((label) => autoFieldKey(label, []));
    expect(typed[typed.length - 1]).toBe("team_name");
    expect(typed[0]).toBe("t");
    expect(autoFieldKey("", [])).toBe("new_field");
    expect(autoFieldKey("Team", [])).toBe("team");
  });

  it("cuts a key to 60 characters only when a suffix is needed, leaving room for it", () => {
    const long = "k".repeat(60);
    expect(uniqueFieldKey(long, new Set())).toBe(long);
    const suffixed = uniqueFieldKey(long, new Set([long]));
    expect(suffixed).toHaveLength(60);
    expect(suffixed.endsWith("_2")).toBe(true);
  });

  it("a key follows its label until it is edited by hand or the draft is saved", () => {
    const state = read("components/registration-builder/use-builder-state.ts");
    expect(state).toContain("autoKeyFieldIds");
    expect(state).toMatch(/if \(!dirty\) setAutoKeyFieldIds\(new Set\(\)\)/);
    expect(read("components/registration-builder/builder-field-settings.tsx")).toContain("autoKeyFieldIds.has(field.id)");
    expect(read("components/registration-builder/builder-field-advanced.tsx")).toContain("next.delete(field.id)");
  });

  it("avoidCollisions leaves clean fields alone, even when their key is a special one", () => {
    const [kept] = avoidCollisions([field("new_id", "age")], [field("old", "email")], idMaker());
    expect(kept).toMatchObject({ id: "new_id", key: "age" });
  });
});

// The edits hook calls no React hooks (it only builds closures), so it runs here with plain stand-ins for the state.
const buildEdits = useBuilderEdits;

describe("the edits behind the palette, run for real (#1132)", () => {
  function editsFor(definition: RegistrationFormDefinition) {
    const calls = { definition: null as RegistrationFormDefinition | null, expanded: undefined as string | null | undefined, error: "", previewAttendees: 0, dirty: false };
    const allFields = definition.sections.flatMap((section) => section.fields);
    const edits = buildEdits({
      definition, setDefinition: (next: RegistrationFormDefinition) => { calls.definition = next; }, setPreviewAttendees: () => { calls.previewAttendees += 1; },
      history: { past: [], future: [], lastKey: null, lastAt: 0, baseline: null }, setHistory: () => {}, setDirty: () => { calls.dirty = true; }, setNotice: () => {}, setError: (message: string) => { calls.error = message; }, setTestIssues: () => {},
      dragging: null, setDragging: () => {}, setExpandedFieldId: (id: string | null) => { calls.expanded = id; }, previewRef: { current: null }, closeModuleLibrary: () => {},
    } as never, { totalFields: allFields.length, allFields } as never);
    return { edits, calls };
  }
  const base = () => {
    const definition = sampleDefinition();
    const section = definition.sections[0]!;
    section.fields = section.fields.slice(0, 3);
    definition.attendeeRoster = undefined;
    return definition;
  };
  const registry = createDefaultPaletteRegistry();
  const entryFor = (id: string) => registry.getSnapshot().entries.find((entry) => entry.id === id)!;

  it("addPaletteEntry puts a question at the end, or at an index, selects it and marks the draft dirty", () => {
    const definition = base();
    const original = definition.sections[0]!.fields.map((field) => field.id);
    const end = editsFor(definition);
    end.edits.addPaletteEntry(entryFor("type:TEXT"), 0);
    expect(end.calls.definition!.sections[0]!.fields.map((field) => field.id).slice(0, 3)).toEqual(original);
    expect(end.calls.definition!.sections[0]!.fields).toHaveLength(4);
    expect(end.calls.expanded).toBe(end.calls.definition!.sections[0]!.fields[3]!.id);
    expect(end.calls.dirty).toBe(true);

    const middle = editsFor(definition);
    middle.edits.addPaletteEntry(entryFor("type:EMAIL"), 0, 1);
    const fields = middle.calls.definition!.sections[0]!.fields;
    expect(fields[1]!.type).toBe("EMAIL");
    expect([fields[0]!.id, fields[2]!.id, fields[3]!.id]).toEqual(original);
    expect(middle.calls.expanded).toBe(fields[1]!.id);
  });

  it("addPaletteEntry reports a full step and leaves the draft alone", () => {
    const definition = base();
    const first = definition.sections[0]!;
    first.fields = Array.from({ length: 20 }, (_, index) => ({ ...first.fields[0]!, id: `f${index}`, key: `key_${index}` }));
    const run = editsFor(definition);
    run.edits.addPaletteEntry(entryFor("type:TEXT"), 0);
    expect(run.calls.definition).toBeNull();
    expect(run.calls.error).toContain("does not fit in this step");
  });

  it("addModule at an index inserts there, keeps the module's fixed keys and switches the roster on", () => {
    const definition = base();
    const original = definition.sections[0]!.fields.map((field) => field.key);
    const run = editsFor(definition);
    const roster = builderFieldModules.find((candidate) => candidate.key === "guest_roster")!;
    run.edits.addModule(0, roster, 1);
    const next = run.calls.definition!;
    const keys = next.sections[0]!.fields.map((field) => field.key);
    expect(keys[0]).toBe(original[0]);
    expect(keys.slice(1, 1 + roster.fields.length)).toEqual(roster.fields.map((field) => field.key));
    expect(keys.slice(1 + roster.fields.length)).toEqual(original.slice(1));
    expect(next.attendeeRoster?.enabled).toBe(true);
    expect(run.calls.previewAttendees).toBe(1);
  });

  it("addModule without an index still appends", () => {
    const definition = base();
    const run = editsFor(definition);
    run.edits.addModule(0, builderFieldModules.find((candidate) => candidate.key === "address")!);
    const keys = run.calls.definition!.sections[0]!.fields.map((field) => field.key);
    expect(keys[keys.length - 1]).toBe("mailing_address");
  });
});

describe("shell keyboard and layout rules (#1132)", () => {
  const press = (over: Partial<Parameters<typeof isSearchShortcut>[0]> = {}) => isSearchShortcut({ key: "/", metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, fromTypingTarget: false, dialogOpen: false, ...over });

  it("'/' focuses the search, except while typing, with a modifier, already handled, or under a dialog", () => {
    expect(press()).toBe(true);
    expect(press({ key: "a" })).toBe(false);
    expect(press({ fromTypingTarget: true })).toBe(false);
    expect(press({ ctrlKey: true })).toBe(false);
    expect(press({ metaKey: true })).toBe(false);
    expect(press({ altKey: true })).toBe(false);
    expect(press({ defaultPrevented: true })).toBe(false);
    expect(press({ dialogOpen: true })).toBe(false);
  });

  it("the shell checks for open dialogs and shows a hidden sidebar when selecting or arriving from a warning", () => {
    const shell = read("components/registration-builder/builder-editor-shell.tsx");
    expect(shell).toContain("dialogIsOpen()");
    expect(shell).toMatch(/function selectField[\s\S]*?showSidebar\(\);/);
    expect(shell).toContain("focusTargetAction({");
    expect(shell).toContain("Math.min(shownWidth + SIDEBAR_WIDTH_STEP, maxWidth)");
    expect(shell).not.toContain("aria-haspopup");
    expect(read("components/registration-builder/builder-canvas.tsx")).not.toContain('role="toolbar"');
  });

  it("arriving from a warning waits for hydration, then shows a sidebar the stored layout hides, then focuses", () => {
    const stored = memoryStorage({ [EDITOR_LAYOUT_STORAGE_KEY]: JSON.stringify({ sidebarVisible: false, side: "left", width: 420 }) });
    const hidden = createEditorLayoutStore(() => stored).getSnapshot();
    expect(hidden.sidebarVisible).toBe(false);
    const base = { handled: false, selected: true, settingsOpen: true };
    // While hydrating the layout is still the default the server rendered: do nothing yet.
    expect(focusTargetAction({ ...base, hydrated: false, sidebarVisible: DEFAULT_EDITOR_LAYOUT.sidebarVisible })).toBe("skip");
    // Once hydrated it sees the real, hidden layout and shows the sidebar first.
    expect(focusTargetAction({ ...base, hydrated: true, sidebarVisible: hidden.sidebarVisible })).toBe("reveal");
    expect(focusTargetAction({ ...base, hydrated: true, sidebarVisible: true })).toBe("focus");
    expect(focusTargetAction({ ...base, hydrated: true, sidebarVisible: true, handled: true })).toBe("skip");
    expect(focusTargetAction({ ...base, hydrated: true, sidebarVisible: true, selected: false })).toBe("skip");
    expect(focusTargetAction({ ...base, hydrated: true, sidebarVisible: true, settingsOpen: false })).toBe("skip");
    expect(read("components/registration-builder/builder-editor-shell.tsx")).toContain("const hydrated = useHydrated();");
  });

  it("shows a hidden sidebar without writing when it is already shown", () => {
    const shown = { sidebarVisible: true, side: "right" as const, width: 400 };
    expect(revealSidebar(shown)).toBe(shown);
    expect(revealSidebar({ ...shown, sidebarVisible: false })).toEqual(shown);
  });

  it("a drag changes the layout in memory and is written once, at its end", () => {
    const storage = memoryStorage();
    const store = createEditorLayoutStore(() => storage);
    store.set({ ...DEFAULT_EDITOR_LAYOUT, width: 420 }, false);
    store.set({ ...DEFAULT_EDITOR_LAYOUT, width: 450 }, false);
    expect(store.getSnapshot().width).toBe(450);
    expect(storage.data.has(EDITOR_LAYOUT_STORAGE_KEY)).toBe(false);
    store.set({ ...DEFAULT_EDITOR_LAYOUT, width: 450 });
    expect(readEditorLayout(storage).width).toBe(450);
  });

  it("holds the shown width inside what the page has room for, so the controls and the separator agree", () => {
    expect(maxSidebarWidthFor(null)).toBe(MAX_SIDEBAR_WIDTH);
    expect(maxSidebarWidthFor(2000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(maxSidebarWidthFor(800)).toBe(400);
    expect(maxSidebarWidthFor(500)).toBe(MIN_SIDEBAR_WIDTH);
    expect(displayedSidebarWidth(500, 400)).toBe(400);
    expect(displayedSidebarWidth(350, 400)).toBe(350);
    const markup = renderToStaticMarkup(createElement(BuilderSidebar, {
      tabs: [{ id: "questions", label: "Questions", panel: "Q" }], activeTab: "questions", onTabChange: () => {}, layout: { ...DEFAULT_EDITOR_LAYOUT, width: 500 },
      shownWidth: 400, maxWidth: 400, onResize: () => {}, containerRef: { current: null },
    }));
    expect(markup).toContain('aria-valuenow="400"');
    expect(markup).toContain('aria-valuemax="400"');
  });

  it("the resize handle's hit area is 44px wide, and the sticky offset follows the measured top bar", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.fb-resize-handle \{[^}]*width: var\(--touch-target, 44px\)/);
    expect(css).toMatch(/\.fb-sidebar \{[^}]*top: calc\(var\(--fb-topbar-height, 64px\) \+ 12px\)/);
    expect(css).not.toMatch(/\.fb-sidebar \{ max-width: 46%/);
  });
});

describe("the editor shell wiring (#1132)", () => {
  it("every width gets the shell; phone width swaps in the phone list and sheets after hydration (#1071)", () => {
    const workspace = read("components/registration-builder-workspace.tsx");
    expect(workspace).not.toContain("useEditorShellViewport");
    expect(workspace).toContain("showShell ? <BuilderEditorShell");
    expect(workspace).toContain('<div className="builder-layout">');
    const hook = read("components/registration-builder/use-editor-layout.ts");
    expect(hook).toContain('"(max-width: 767px)"');
    expect(hook).toMatch(/\(\) => false,\n\s*\);/); // the server renders the desktop shell: no flash of the phone layout on a desktop
  });

  it("the form template editor still uses the section cards", () => {
    expect(read("components/form-template-editor.tsx")).toContain("BuilderSectionCard");
  });

  it("the top bar keeps today's Save draft and Publish, Preview and the layout menu", () => {
    const shell = read("components/registration-builder/builder-editor-shell.tsx");
    expect(shell).toContain("<BuilderSaveDraftButton");
    expect(shell).toContain("<BuilderPublishButton");
    expect(shell).toContain("onClick={showPreview}");
    expect(shell).toContain('aria-label="Layout options"');
    expect(shell).toContain("aria-expanded={menuOpen}");
    expect(shell).toContain("Reset layout");
    expect(shell).toContain("Settings &amp; payment");
    const bar = read("components/registration-builder/builder-top-bar.tsx");
    expect(bar).toContain("disabled={Boolean(publishBlockedReason) || busy !== null}");
    expect(bar).toContain("Run a test submission first. A valid test is required only before a form&apos;s first publish");
  });

  it("registers the shell's behaviour for '/' and the removal confirmation", () => {
    const shell = read("components/registration-builder/builder-editor-shell.tsx");
    expect(shell).toContain("isSearchShortcut({");
    expect(shell).toContain("openRemoveField(sectionIndex, fieldIndex)");
    expect(shell).toContain("moveField(sectionIndex, fieldIndex");
    expect(shell).toContain("duplicateField(sectionIndex, fieldIndex)");
  });

  it("the stylesheet gives the shell's controls 44px targets and leaves the shared rules alone", () => {
    const css = read("app/globals.css");
    const start = css.indexOf("Registration form builder editor shell (#1132)");
    expect(start).toBeGreaterThan(0);
    const block = css.slice(start);
    for (const selector of [".fb-btn", ".fb-tool", ".fb-tab", ".fb-palette-item", ".fb-palette-group-toggle", ".fb-add-button", ".fb-icon-button"]) {
      const rule = new RegExp(`${selector.replace(".", "\\.")} \\{[^}]*(min-height|height): var\\(--touch-target, 44px\\)`);
      expect(block, selector).toMatch(rule);
    }
    expect(block).not.toMatch(/font-size:\s*0\.[0-7]\d*rem/);
  });

  it("documents how to add a module", () => {
    const doc = read("docs/FORM-BUILDER-PALETTE.md");
    expect(doc).toContain("builderFieldModules");
    expect(doc).toContain("paletteRegistry.register");
  });
});
