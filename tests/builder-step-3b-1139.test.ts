import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { ModuleOwnedSettingRow } from "@/components/registration-builder/builder-module-owned";
import { deriveFieldChips, sourceModuleName } from "@/components/registration-builder/field-chips";
import { mealPlanPriceFor, mealsPageHref, moduleOwnedSettings } from "@/components/registration-builder/module-owned-settings";
import { inspectorAfterClose, inspectorAfterSelection } from "@/components/registration-builder/phone-inspector";
import { nextTabIndex, sidebarTabOrder, tabAfterSelectionChange } from "@/components/registration-builder/sidebar-tabs";
import { versionStateChips } from "@/components/registration-builder/version-state";
import { formTemplates, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function field(patch: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return { id: "synthetic_field", key: "synthetic_note", label: "Synthetic note", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...patch };
}

const labels = (patch: Partial<RegistrationFormField>, sectionTitle?: string) => deriveFieldChips(field(patch), sectionTitle).map((chip) => chip.label);

describe("canvas summary chips (#1139)", () => {
  it("names the scope, in words", () => {
    expect(labels({ scope: "REGISTRATION" })).toEqual(["Asked once"]);
    expect(labels({ scope: "ATTENDEE" })).toEqual(["Asked of each person"]);
  });

  it("adds Required, Has logic, a price, a capacity and Sensitive only when the definition says so", () => {
    expect(labels({ required: true })).toContain("Required");
    expect(labels({ required: false })).not.toContain("Required");
    expect(labels({ conditional: { fieldKey: "other", operator: "EQUALS", value: "Yes" } })).toContain("Has logic");
    expect(labels({})).not.toContain("Has logic");
    expect(labels({ priceCents: 2500 })).toContain("Has price");
    expect(labels({ type: "SELECT", options: ["A", "B"], choicePricesCents: { A: 500 } })).toContain("Has price");
    expect(labels({})).not.toContain("Has price");
    expect(labels({ type: "SELECT", options: ["A", "B"], choiceLimits: { A: 10 } })).toContain("Has capacity");
    expect(labels({ type: "SELECT", options: ["A", "B"] })).not.toContain("Has capacity");
    expect(labels({ sensitive: true })).toContain("Sensitive");
    expect(labels({ sensitive: false, key: "medical_notes", label: "Medical notes" })).not.toContain("Sensitive");
    expect(labels({ key: "medical_notes", label: "Medical notes" })).toContain("Sensitive");
  });

  it("names the source module, Meals for a meal ticket", () => {
    expect(labels({ key: "lunch_adult_qty", type: "NUMBER" })).toContain("From Meals");
    expect(sourceModuleName(field())).toBeNull();
    // A NUMBER with a meal key but asked of each person is not a meal ticket.
    expect(sourceModuleName(field({ key: "lunch_adult_qty", type: "NUMBER", scope: "ATTENDEE" }))).not.toBe("Meals");
    expect(labels({ key: "synthetic_note" })).not.toContain("From Meals");
  });

  it("every chip is text and the canvas adds no tab stop for them", () => {
    const canvas = read("components/registration-builder/builder-canvas.tsx");
    expect(canvas).toContain('className="fb-chips"');
    expect(canvas).toContain("fb-q-chip fb-q-chip-");
    // Chips are plain spans inside the question's one button; the button's name carries them for a screen reader.
    expect(canvas).toMatch(/chips\.map\(\(chip\) => chip\.label\)\.join/);
    expect(canvas).not.toMatch(/fb-q-chip[^>]*(tabIndex|href|onClick)/);
    expect(read("app/globals.css")).not.toMatch(/\.fb-q-chip[^{]*\{[^}]*font-size:\s*0\.[0-7]/);
  });

  it("renders the chips on the canvas", () => {
    const { markup } = renderShell({ status: "DRAFT" });
    expect(markup).toContain('class="fb-chips"');
    expect(markup).toContain("Asked once");
    expect(markup).toContain("Asked of each person");
  });
});

function mealField(): RegistrationFormField {
  return field({ id: "meal_field", key: "lunch_adult_qty", label: "Adult lunch tickets", type: "NUMBER", priceCents: 1200 });
}

describe("settings another module owns (#1139)", () => {
  it("only a meal ticket's price is owned elsewhere today", () => {
    const meal = mealField();
    const prices = { "LUNCH:ADULT": 1500 };
    expect(moduleOwnedSettings(meal, "event_1", prices)).toEqual([{ setting: "price", valueCents: 1500, label: "Price per item", owner: "Meals", href: mealsPageHref("event_1") }]);
    expect(moduleOwnedSettings(field(), "event_1", prices)).toEqual([]);
    // The plan's price, not the field's own (possibly drifted) priceCents, is what is owned.
    expect(mealPlanPriceFor(meal, prices)).toBe(1500);
    expect(meal.priceCents).toBe(1200);
    // No plan price for that meal and age group: nothing is owned, so the form's own price stays editable.
    expect(moduleOwnedSettings(meal, "event_1", {})).toEqual([]);
    expect(moduleOwnedSettings(meal, "event_1", { "LUNCH:CHILD": 900 })).toEqual([]);
    expect(mealPlanPriceFor(field({ key: "lunch_adult_qty", type: "NUMBER", scope: "ATTENDEE" }), prices)).toBeUndefined();
  });

  it("renders the value read-only with 'Set in Meals' and a link, and no input", () => {
    const markup = renderToStaticMarkup(createElement(ModuleOwnedSettingRow, {
      setting: { setting: "price", valueCents: 1200, label: "Price per item", owner: "Meals", href: mealsPageHref("event 1") },
      value: "$12.00",
    }));
    expect(markup).toContain("Set in Meals");
    expect(markup).toContain("$12.00");
    expect(markup).toContain('href="/more/meals?event=event%201"');
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<select");
  });

  it("leaves out the link when the module has no page, and the advanced options use the read-only row for it", () => {
    const markup = renderToStaticMarkup(createElement(ModuleOwnedSettingRow, { setting: { setting: "price", valueCents: 1200, label: "Price per item", owner: "Meals", href: null }, value: "No price set yet" }));
    expect(markup).toContain("Set in Meals");
    expect(markup).not.toContain("<a ");
    const advanced = read("components/registration-builder/builder-field-advanced.tsx");
    expect(advanced).toContain("<ModuleOwnedSettingRow");
    expect(advanced).toContain("!ownedPrice && ");
    expect(advanced).toContain("value={money(ownedPrice.valueCents)}");
    expect(advanced).toContain("Not priced in Meals yet — this form&apos;s price is used.");
    expect(advanced).toContain("{!ownedPrice && !hasCredit(field)");
    // Late pricing never applies to meal tickets, priced in Meals or not: the server clears it once a plan price exists.
    expect(advanced).toContain('{!isMealTicketField(field) && !hasCredit(field) && !isChoiceFieldType(field.type) && field.type !== "ADDRESS" && field.type !== "ACKNOWLEDGMENT" && <div className="field-full late-pricing-controls">');
    expect(advanced).toContain('{isMealTicketField(field) && <small className="field-full">Late pricing is not used for meal tickets.</small>}');
    // The page loads the event's plan prices server-side, for the event it already authorized, and hands them to the builder.
    const page = read("app/(workspace)/registration-builder/page.tsx");
    expect(page).toContain("mealPlanPrices={await listMealPlanPrices(event.id)}");
    expect(read("components/registration-builder/use-builder-model.ts")).toContain("mealPlanPrices");
    expect(read("modules/meals/config-repository.ts")).toContain("export async function listMealPlanPrices(eventId: string)");
  });
});

describe("the Form settings tab (#1139)", () => {
  it("is registered with the other tabs and reachable by the arrow keys", () => {
    expect(sidebarTabOrder).toEqual(["questions", "settings", "form-settings", "history"]);
    expect(nextTabIndex("ArrowRight", 1, sidebarTabOrder.length)).toBe(2);
    expect(tabAfterSelectionChange("form-settings", "a", "a")).toBe("form-settings");
  });

  it("renders the form-wide controls in the tab, once, and the header link opens it", () => {
    const { markup } = renderShell({ status: "DRAFT" });
    expect(markup).toContain('id="fb-tab-form-settings"');
    expect(markup).toContain(">Form settings</button>");
    expect(markup).toContain('id="fb-panel-form-settings"');
    const panel = markup.slice(markup.indexOf('id="fb-panel-form-settings"'), markup.indexOf('id="fb-panel-history"'));
    expect(panel).toContain("Who can this form register?");
    expect(markup.split("Who can this form register?")).toHaveLength(2);
    expect(markup).toContain('data-fb-nav="settings"');
    expect(markup).toContain('aria-controls="fb-panel-form-settings"');
    const shell = read("components/registration-builder/builder-editor-shell.tsx");
    expect(shell).toContain('setTab("form-settings")');
    expect(shell).toMatch(/function openFormSettings\(\)[\s\S]*?showSidebar\(\);/);
    expect(shell).toContain("openFormSettings(); }}>Settings &amp; payment</a>");
    expect(shell).toContain("<BuilderRosterSettings />");
  });
});

function renderShell({ status, extraVersions = [] }: { status: "DRAFT" | "PUBLISHED"; extraVersions?: Array<{ id: string; versionNumber: number; status: string }> }) {
  const definition = structuredClone(formTemplates[0].definition) as RegistrationFormDefinition;
  const make = (id: string, versionNumber: number, versionStatus: string) => ({
    id, versionNumber, status: versionStatus, definition, publishedAt: versionStatus === "PUBLISHED" ? "2028-08-01T00:00:00.000Z" : null,
    createdAt: "2028-08-01T00:00:00.000Z", updatedAt: "2028-08-01T00:00:00.000Z", createdBy: "Synthetic Staff",
    testSubmissionCount: 0, choiceUsage: {}, testSubmissions: [],
  });
  const active = make("version-1", 1, status);
  const markup = renderToStaticMarkup(createElement(RegistrationBuilderWorkspace, {
    eventId: "event-1", eventSlug: "fall-camporee-2028", eventName: "Fall Camporee 2028",
    initialForms: [{
      id: "form-1", eventId: "event-1", name: definition.title, slug: "synthetic-form", status,
      createdAt: "2028-08-01T00:00:00.000Z", updatedAt: "2028-08-01T00:00:00.000Z", createdBy: "Synthetic Staff",
      activeVersion: active, versions: [active, ...extraVersions.map((version) => make(version.id, version.versionNumber, version.status))],
    }],
    templates: [],
  } as never));
  return { markup };
}

describe("version-state chips (#1139)", () => {
  const live = { status: "PUBLISHED", versionNumber: 3 };
  const draft = { status: "DRAFT", versionNumber: 4 };
  const old = { status: "ARCHIVED", versionNumber: 2 };

  it("a live version alone", () => {
    expect(versionStateChips({ versions: [live, old], selected: live, isHistorical: false, dirty: false }).map((chip) => chip.text)).toEqual(["Live (version 3)"]);
  });

  it("a draft alone", () => {
    expect(versionStateChips({ versions: [draft], selected: draft, isHistorical: false, dirty: false }).map((chip) => chip.text)).toEqual(["Draft (version 4)"]);
  });

  it("a live version and a newer draft are both visible", () => {
    expect(versionStateChips({ versions: [draft, live, old], selected: draft, isHistorical: false, dirty: false }).map((chip) => chip.text)).toEqual(["Live (version 3)", "Draft (version 4)"]);
  });

  it("an old version is named read-only, with the live one still shown", () => {
    expect(versionStateChips({ versions: [live, old], selected: old, isHistorical: true, dirty: false }).map((chip) => chip.text)).toEqual(["Viewing old version 2 (read-only)", "Live (version 3)"]);
  });

  it("viewing the live version while a newer draft exists says live, not old", () => {
    expect(versionStateChips({ versions: [draft, live], selected: live, isHistorical: true, dirty: false }).map((chip) => chip.text)).toEqual(["Viewing live version 3 (read-only)", "Live (version 3)", "Draft (version 4)"]);
  });

  it("unsaved changes is its own chip, next to the state", () => {
    expect(versionStateChips({ versions: [live], selected: live, isHistorical: false, dirty: true }).map((chip) => chip.text)).toEqual(["Live (version 3)", "Unsaved changes"]);
  });

  it("a withdrawn form with nothing live or in draft is still named", () => {
    expect(versionStateChips({ versions: [old], selected: old, isHistorical: false, dirty: false }).map((chip) => chip.text)).toEqual(["Withdrawn (version 2)"]);
  });

  it("the top bar renders the chips as text", () => {
    const { markup } = renderShell({ status: "PUBLISHED", extraVersions: [{ id: "version-2", versionNumber: 2, status: "DRAFT" }] });
    expect(markup).toContain('aria-label="Version state"');
    expect(markup).toContain("Live (version 1)");
    expect(markup).toContain("Draft (version 2)");
    const bar = read("components/registration-builder/builder-editor-shell.tsx");
    expect(bar).toContain("<BuilderVersionChips />");
  });
});

describe("the phone inspector (#1139)", () => {
  it("opens when a different question is selected and stays as it is otherwise", () => {
    expect(inspectorAfterSelection(false, null, "a")).toBe(true);
    expect(inspectorAfterSelection(false, "a", "b")).toBe(true);
    expect(inspectorAfterSelection(false, "a", "a")).toBe(false);
    expect(inspectorAfterSelection(false, "a", null)).toBe(false);
    expect(inspectorAfterSelection(true, "a", null)).toBe(true);
  });

  it("Done and Back only close it", () => {
    expect(inspectorAfterClose()).toBe(false);
  });

  it("Done keeps the edits: it saves nothing, discards nothing and the Unsaved changes chip stays", () => {
    const shell = read("components/registration-builder/builder-editor-shell.tsx");
    const close = shell.slice(shell.indexOf("function closeInspector()"), shell.indexOf("// The \"Settings & payment\" link"));
    expect(close).toContain("setInspectorOpen(inspectorAfterClose())");
    for (const forbidden of ["saveDraft", "replaceDefinition", "beginPublish", "setDirty", "updateField", "discard", "reset"]) {
      expect(close, forbidden).not.toContain(forbidden);
    }
    // Focus goes back to the question's card.
    expect(close).toContain('request({ kind: "field", fieldId: expandedFieldId })');
    const sidebar = read("components/registration-builder/builder-sidebar.tsx");
    expect(sidebar).toContain("onClick={inspector.onBack}");
    expect(sidebar).toContain("onClick={inspector.onDone}");
    expect(shell).toContain("onBack: closeInspector, onDone: closeInspector");
    // The chip is driven by the model's dirty flag, which Done does not touch.
    expect(read("components/registration-builder/builder-top-bar.tsx")).toContain('kind === "unsaved"');
  });

  it("the stylesheet covers the screen at phone width only, and the actions are buttons, not hover", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("Form settings tab, summary chips"));
    expect(block).toMatch(/@media \(max-width: 767px\) \{[\s\S]*data-inspector="open"\] \.fb-sidebar \{ position: fixed; inset: 0/);
    expect(block).not.toMatch(/:hover/);
    const settings = read("components/registration-builder/builder-question-settings.tsx");
    expect(settings).toContain('className="fb-inspector-actions"');
    expect(settings).toContain("<button type=\"button\" className=\"fb-tool\"");
  });
});
