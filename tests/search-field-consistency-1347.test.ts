// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HonorCombobox } from "@/components/honor-combobox";
import { searchWatchCatalog } from "@/modules/honors/watch-domain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One search field look and the empty-search rule (#1347). Synthetic names only. */

const options = [
  { id: "h1", name: "Fire Building" },
  { id: "h2", name: "Knot Tying" },
  { id: "h3", name: "Map Reading" },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("honor combobox opens on focus (#1347)", () => {
  it("is closed until the field takes focus, then lists every honor for an empty box", () => {
    act(() => root.render(createElement(HonorCombobox, { label: "Honor", onChange: () => {}, options, value: "" })));
    const input = container.querySelector("input[role=combobox]") as HTMLInputElement;
    const list = container.querySelector("ul[role=listbox]") as HTMLElement;
    expect(list.hidden).toBe(true);
    expect(input.placeholder).toBe("Search honors");
    // Tab focus fires focus, never click.
    act(() => input.focus());
    expect(list.hidden).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("[role=option]")).toHaveLength(3);
  });

  it("draws the box with the shared search field wrapper", () => {
    act(() => root.render(createElement(HonorCombobox, { label: "Honor", onChange: () => {}, options, value: "" })));
    expect(container.querySelector(".honor-combobox > .search-field > input[role=combobox]")).not.toBeNull();
  });
});

describe("honor watch search (#1347)", () => {
  const catalog = [
    { id: "a", code: "RE-001", name: "Fire Building" },
    { id: "b", code: "RE-002", name: "Knot Tying" },
    { id: "c", code: "NA-003", name: "Birds" },
  ];

  it("lists the whole catalog, minus chosen honors, for an empty search (no two-character minimum)", () => {
    expect(searchWatchCatalog(catalog, [], "").map((honor) => honor.id)).toEqual(["a", "b", "c"]);
    expect(searchWatchCatalog(catalog, ["b"], "   ").map((honor) => honor.id)).toEqual(["a", "c"]);
  });

  it("narrows from the first character, by name or code", () => {
    expect(searchWatchCatalog(catalog, [], "b").map((honor) => honor.id)).toEqual(["a", "c"]);
    expect(searchWatchCatalog(catalog, [], "na-").map((honor) => honor.id)).toEqual(["c"]);
    expect(searchWatchCatalog(catalog, [], "zzz")).toEqual([]);
  });

  it("caps typed results but not the empty list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, code: `C-${i}`, name: `Honor ${i}` }));
    expect(searchWatchCatalog(many, [], "honor")).toHaveLength(8);
    expect(searchWatchCatalog(many, [], "")).toHaveLength(30);
  });
});

describe("one search field in the CSS (#1347)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m"))?.[1] ?? "";

  it("draws one wrapper: 44px, 10px radius, border tokens, one ring, inner input bare", () => {
    const field = rule(".search-field");
    expect(field).toContain("min-height: var(--touch-target, 44px)");
    expect(field).toContain("border-radius: var(--field-radius)");
    expect(field).not.toContain("#5a6e79");
    expect(css).toContain(".search-field:focus-within { border-color: var(--field-focus); outline: 2px solid var(--field-focus); outline-offset: 2px; }");
    const input = rule(".search-field input");
    expect(input).toMatch(/border: 0/);
    expect(input).toMatch(/outline: 0/);
    expect(input).toMatch(/box-shadow: none/);
  });

  it("hides the native clear x on every search input and gives the clear button a 44px target", () => {
    expect(css).toContain('input[type="search"]::-webkit-search-cancel-button');
    expect(rule(".search-field-clear")).toContain("width: var(--touch-target, 44px)");
    expect(css).toMatch(/\.searchable-select-control > button \{[^}]*width: var\(--touch-target, 44px\)/);
  });

  it("keeps the destination search on the wrapper, with no second ring on its input", () => {
    expect(css).not.toMatch(/^\.destination-search-field[ :{]/m);
    expect(css).not.toMatch(/^\.destination-search-input:focus/m);
    expect(readFileSync("components/destination-search.tsx", "utf8")).toContain('className="search-field destination-search-field"');
  });

  it("drops the halo and the odd radii from the select controls, the More search, and the honor list", () => {
    expect(css).not.toMatch(/\.searchable-select-(control|picker-search):focus-within \{[^}]*box-shadow: 0 0 0 4px/);
    expect(css).not.toMatch(/\.searchable-select-(control|picker-search) \{[^}]*border-radius: 11px/);
    expect(css).not.toContain(".more-task-search .search-field { padding: 0 14px; border-radius: 12px; }");
    expect(rule(".honor-combobox-list")).toContain("border: 1px solid var(--field-border)");
  });

  it("strips module borders, rings and the 12px radius from the three directory searches", () => {
    const finder = readFileSync("components/public-club-directory.module.css", "utf8");
    const roster = readFileSync("components/club-roster-sections.module.css", "utf8");
    const events = readFileSync("app/(public)/events/events-directory.module.css", "utf8");
    expect(finder).not.toMatch(/\.search \{[^}]*border/);
    expect(finder).not.toMatch(/\.search \{[^}]*border-radius: 12px/);
    expect(roster).not.toMatch(/\.rosterSearchInput[^{]*\{[^}]*(border|outline)/);
    expect(events).toContain(".eventsDirectoryField .search-field input { min-height: 42px; border: 0;");
    expect(readFileSync("components/public-club-directory.tsx", "utf8")).toContain("search-field ${styles.search}");
    expect(readFileSync("components/club-roster-workspace.tsx", "utf8")).toContain("search-field ${styles.rosterSearchInput}");
  });
});
