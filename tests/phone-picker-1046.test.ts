import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchableSelect } from "@/components/searchable-select";
import {
  filterSearchableChoices,
  nounFromLabel,
  PICKER_SEARCH_ATTRIBUTES,
  pickerViewportBox,
  resultCountLabel,
  trappedTabIndex,
} from "@/modules/forms/searchable-choice";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const select = read("components/searchable-select.tsx");
const css = read("app/globals.css");

const clubs = [
  { value: "a", label: "Invented Hollow Pathfinders" },
  { value: "b", label: "Not listed" },
];

describe("full-screen phone picker (#1046)", () => {
  it("sizes the picker to the visual viewport, so the list ends at the keyboard", () => {
    expect(pickerViewportBox({ height: 410.4, offsetTop: 0 })).toEqual({ top: 0, height: 410 });
    expect(pickerViewportBox({ height: 400, offsetTop: 36.6 })).toEqual({ top: 37, height: 400 });
    expect(pickerViewportBox({ height: 400, offsetTop: -5 })).toEqual({ top: 0, height: 400 });
    expect(pickerViewportBox(null)).toBeNull();
    expect(pickerViewportBox({ height: 0, offsetTop: 0 })).toBeNull();
    expect(select).toContain('window.visualViewport');
    expect(select).toContain('viewport?.addEventListener("resize", fit)');
    expect(select).toContain('viewport?.addEventListener("scroll", fit)');
  });

  it("announces the result count", () => {
    expect(resultCountLabel(12, { singular: "club", plural: "clubs" })).toBe("12 clubs");
    expect(resultCountLabel(1)).toBe("1 choice");
    expect(resultCountLabel(0)).toBe("No matching choices");
    expect(select).toMatch(/role="status" aria-live="polite">\{countText\}/);
  });

  it("derives the announced noun from the field label, and names the trigger as a combobox", () => {
    expect(nounFromLabel("Pathfinder club")).toEqual({ singular: "pathfinder club", plural: "pathfinder clubs" });
    expect(nounFromLabel("Church")?.plural).toBe("churches");
    expect(nounFromLabel("Country")?.plural).toBe("countries");
    expect(nounFromLabel(undefined)).toBeUndefined();
    expect(select).toMatch(/role="combobox"\s+aria-haspopup="dialog"[\s\S]*?aria-required=\{required \|\| undefined\}\s+aria-invalid=\{invalid \|\| undefined\}/);
    expect(select).toContain("pushOpenDialog()");
    expect(select).toContain("removeOpenDialog(dialogToken)");
    expect(select).toContain("aria-label={`Clear ${label");
    expect(css).toContain(".searchable-select-control > button:not(.searchable-select-trigger):hover");
  });

  it("gives the search box attributes iOS respects and no contact words", () => {
    expect(PICKER_SEARCH_ATTRIBUTES).toMatchObject({
      name: "directory-search",
      autoComplete: "off",
      autoCorrect: "off",
      autoCapitalize: "none",
      spellCheck: false,
      enterKeyHint: "search",
    });
    const words = `${PICKER_SEARCH_ATTRIBUTES.name} ${PICKER_SEARCH_ATTRIBUTES["aria-label"]}`;
    expect(words).not.toMatch(/contact|name\b|email|phone|address|tel/i);
    expect(select).toContain("{...PICKER_SEARCH_ATTRIBUTES}");
  });

  it("starts the search empty and filters", () => {
    expect(select).toMatch(/function openPicker\(\) \{[^}]*setQuery\(""\)/);
    expect(filterSearchableChoices(clubs, "")).toEqual(clubs);
    expect(filterSearchableChoices(clubs, "hollow")).toEqual([clubs[0]]);
    expect(filterSearchableChoices(clubs, "not listed")).toEqual([clubs[1]]);
  });

  it("is a modal dialog named by the field, with Close, a labelled search, a listbox and a focus trap", () => {
    expect(select).toContain('role="dialog"');
    expect(select).toContain('aria-modal="true"');
    expect(select).toContain("aria-labelledby={headingId}");
    expect(select).toContain("<span>Close</span>");
    expect(select).toContain('role="combobox"');
    expect(select).toContain('role="listbox"');
    expect(select).toContain('role="option"');
    expect(select).toContain("aria-activedescendant");
    expect(select).toContain("makeBackgroundInert(dialog)");
    expect(trappedTabIndex(2, 3, false)).toBe(0);
    expect(trappedTabIndex(0, 3, true)).toBe(2);
    expect(trappedTabIndex(1, 3, false)).toBeNull();
    expect(trappedTabIndex(-1, 3, true)).toBe(2);
    expect(trappedTabIndex(0, 0, false)).toBeNull();
  });

  it("choosing closes and returns focus to the field; Escape and Close change nothing", () => {
    expect(select).toMatch(/function choose\(nextValue: string\) \{[\s\S]*?onChange\(option\.value\);\s*setOpen\(false\);/);
    expect(select).toMatch(/wasOpen\.current && !open\) triggerRef\.current\?\.focus/);
    expect(select).toMatch(/key === "Escape"[\s\S]*?event\.stopPropagation\(\);\s*setOpen\(false\);/);
    expect(select).toMatch(/className="searchable-select-picker-close" onClick=\{\(\) => setOpen\(false\)\}/);
  });

  it("is full screen above everything with 44px targets, and the page behind cannot scroll", () => {
    expect(css).toMatch(/\.searchable-select-picker \{[^}]*position: fixed;[^}]*height: var\(--picker-height, 100dvh\)/);
    expect(css).toMatch(/\.searchable-select-picker-close \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.searchable-select-trigger \{[^}]*min-height: 44px/);
    expect(css).toContain("html.has-attendee-sheet, html.has-attendee-sheet body { overflow: hidden; }");
  });

  it("leaves desktop (and the first server render) as the inline combobox", () => {
    const html = renderToStaticMarkup(createElement(SearchableSelect, {
      id: "club",
      value: "",
      options: clubs,
      sheet: true,
      label: "Pathfinder club",
      onChange: () => undefined,
    }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="club"');
    expect(html).not.toContain("searchable-select-trigger");
    expect(html).not.toContain('role="dialog"');
  });

  it("covers every phone-facing caller", () => {
    expect(read("components/public-registration-form.tsx")).toMatch(/sheet=\{!embedded\}\s+label=\{field\.label\}/);
    expect(read("components/attendee-registration-answers-form.tsx")).toMatch(/<SearchableSelect[\s\S]*?\bsheet\b[\s\S]*?label=\{field\.label\}/);
    expect(read("components/registration-builder/builder-preview.tsx")).toContain("<SearchableSelect id={inputId} sheet label={field.label}");
  });
});
