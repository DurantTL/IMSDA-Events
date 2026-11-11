// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROSTER_DESKTOP_TABLE_QUERY, RosterTableScroll } from "@/components/roster-table-scroll";

// #1861: on a desktop window the roster table (#1838) shows the tablet cards when it is wider than its card, instead of scrolling
// sideways (the staff club page at 1024px, or Show gender / Show school details / Show baptized on), and goes back to the table
// once the card is as wide as the table needed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The wrap's box is `box` wide; the table needs `table`, and the cards always fit.
const size = { box: 812, table: 876 };
const resizeCallbacks: Array<() => void> = [];

function render(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: desktop && query === ROSTER_DESKTOP_TABLE_QUERY, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.box);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.fit === "cards" ? size.box : Math.max(size.box, size.table);
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(RosterTableScroll, { fitKey: "name,age", label: "Members, scrolls sideways" }, createElement("table"))));
  return { root, wrap: host.querySelector<HTMLElement>(".report-table-wrap")! };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resizeCallbacks.length = 0;
  document.body.innerHTML = "";
  Object.assign(size, { box: 812, table: 876 });
});

describe("roster table fit on a desktop window (#1861)", () => {
  it("shows cards when the table is wider than its card, and the table again once the card is wide enough", () => {
    const { root, wrap } = render(true);
    expect(wrap.dataset.fit).toBe("cards");
    expect(wrap.getAttribute("role")).toBeNull();

    size.box = 900;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(wrap.dataset.fit).toBeUndefined();
    expect(wrap.getAttribute("role")).toBeNull();
    act(() => root.unmount());
  });

  it("keeps the table when it fits", () => {
    size.table = 800;
    const { root, wrap } = render(true);
    expect(wrap.dataset.fit).toBeUndefined();
    act(() => root.unmount());
  });

  it("leaves a touch screen or a narrow window to the CSS, which shows cards there already", () => {
    size.box = 700;
    const { root, wrap } = render(false);
    expect(wrap.dataset.fit).toBeUndefined();
    act(() => root.unmount());
  });

  it("keeps the card container while the wrap is marked for cards, and passes the columns as the fit key", () => {
    const css = readFileSync(path.join(process.cwd(), "components/club-roster-table.module.css"), "utf8");
    expect(css).toContain(`@media ${ROSTER_DESKTOP_TABLE_QUERY}`);
    expect(css).toContain('.rosterTableWrap:global(.report-table-wrap):not([data-fit="cards"]):has(> :global(table.table-cards[data-cards="touch"])) { container: none; }');
    const workspace = readFileSync(path.join(process.cwd(), "components/club-roster-workspace.tsx"), "utf8");
    expect(workspace).toContain('<RosterTableScroll fitKey={columns.join(",")}');
  });
});

describe("roster table fit in a box wider than the cards' limit (#1861)", () => {
  it("keeps the table (scrolling inside its wrap) when the box is too wide for cards", () => {
    size.box = 1228;
    size.table = 1292;
    const { root, wrap } = render(true);
    expect(wrap.dataset.fit).toBeUndefined();
    expect(wrap.getAttribute("role")).toBe("region");
    act(() => root.unmount());
  });
});
