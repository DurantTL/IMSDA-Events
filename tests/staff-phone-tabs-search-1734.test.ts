import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/people",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => createElement("button", { type: "button" }, "Sign out") }));

import { AppShell } from "@/components/app-shell";
import { StaffHeaderSearch } from "@/components/staff-header-search";
import { StaffTabRow } from "@/components/staff-tab-row";
import { tabRowFits } from "@/components/staff-tab-row-model";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** Phone tabs and search (#1734). */
describe("the fit decision for a tab row", () => {
  it("keeps the row when it fits, at any width, and collapses it only when it would not", () => {
    // Two tabs on a phone: 160px of tabs in a 358px line fit, so Home keeps "Needs you" and "Coming up".
    expect(tabRowFits(160, 358)).toBe(true);
    expect(tabRowFits(358, 358)).toBe(true);
    expect(tabRowFits(359, 358)).toBe(false);
    // Eight tabs on a phone, and a wide row on a narrow desktop window, do not fit.
    expect(tabRowFits(720, 358)).toBe(false);
    expect(tabRowFits(1100, 1000)).toBe(false);
    // A wide screen with room keeps the row.
    expect(tabRowFits(720, 1100)).toBe(true);
  });

  it("allows half a pixel of rounding, and treats an unmeasured row as fitting", () => {
    expect(tabRowFits(358.4, 358)).toBe(true);
    expect(tabRowFits(358.6, 358)).toBe(false);
    expect(tabRowFits(0, 358)).toBe(true);
    expect(tabRowFits(300, 0)).toBe(true);
  });
});

describe("the tab row component", () => {
  const tabs = [
    { key: "needs", label: "Needs you", href: "/home", current: true },
    { key: "soon", label: "Coming up", href: "/home/coming-up" },
  ];
  const render = () => renderToStaticMarkup(createElement(StaffTabRow, { label: "Home", menuLabel: "Home menu", title: "Home menu", tabs }));

  it("renders both tabs and a menu line, starting as fitting (the browser measures, not a screen width)", () => {
    const markup = render();
    expect(markup).toContain('data-fit="ok"');
    expect(markup).toContain(">Needs you<");
    expect(markup).toContain(">Coming up<");
    expect(markup).toContain("data-staff-menu-line");
  });

  it("decides with the fit check at every width and never by a width query", () => {
    const source = read("components/staff-tab-row.tsx");
    expect(source).toContain("tabRowFits(");
    expect(source).toContain("new ResizeObserver(measure)");
    expect(source).not.toMatch(/matchMedia|min-width: 1024px/);
    const css = read("components/staff-shell.module.css");
    expect(css).not.toMatch(/@media \(max-width: 1023\.98px\)/);
    expect(css).toMatch(/\.tabline\[data-fit="tight"\] \.menuline \{ display: flex; \}/);
  });
});

describe("the phone header search", () => {
  it("is a 44px icon button named Find a page or task that opens the same search", () => {
    const markup = renderToStaticMarkup(createElement(StaffHeaderSearch, { destinations: [], inputId: "destination-search-input" }));
    expect(markup).toMatch(/aria-controls="destination-search-input-wrap"/);
    expect(markup).toContain(`id="destination-search-input-wrap"`);
    expect(markup).toMatch(/<button[^>]*aria-label="Find a page or task"[^>]*aria-expanded="false"/);
    expect(markup).toContain('id="destination-search-input"');
    const css = read("components/staff-shell.module.css");
    expect(css).toMatch(/\.searchToggle \{[^}]*min-width: 44px; min-height: 44px/);
    expect(css).toMatch(/@media \(max-width: 800px\) \{[\s\S]*\.searchToggle \{ display: inline-flex;/);
    expect(css).toMatch(/\.search\[data-open="true"\] \{ display: block;/);
    // An icon in the header row (the global phone rule makes .secondary-button full width), so its width is pinned.
    expect(css).toMatch(/\.topbar \.searchToggle \{[^}]*flex: none; width: 44px;/);
  });
});

describe("the phone search row's closing rules", () => {
  const source = read("components/staff-header-search.tsx");
  it("closes on a route change, on a window wider than the phone, and on Escape with focus back on the button", () => {
    expect(source).toContain("const open = openPath === pathname;");
    expect(source).toContain('matchMedia("(min-width: 801px)")');
    expect(source).toMatch(/event\.key !== "Escape"/);
    expect(source).toContain("toggleRef.current?.focus()");
  });
});

describe("the event bar on a phone", () => {
  const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
  const markup = renderToStaticMarkup(createElement(AppShellElement, {
    events: [{ id: "evt_one", slug: "one", name: "Synthetic Event", permissions: ["MANAGE_CHECK_IN"] }],
    user: { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null },
    defaultEventId: "evt_one",
  }, createElement("p", null, "content")));

  it("makes Archived events the switcher's last choice, with no separate link (#1747)", () => {
    const start = markup.indexOf('id="event-picker"');
    const select = markup.slice(start, markup.indexOf("</select>", start));
    expect(select.trimEnd().endsWith("Archived events…</option>")).toBe(true);
    expect(markup).not.toContain('href="/archived-events"');
    expect(read("components/app-shell.tsx")).toContain('router.push("/archived-events")');
    expect(read("components/staff-shell.module.css")).not.toContain("archivedLink");
  });

  it("puts the name and Switch event on one row without repeating the name in the switcher on a phone", () => {
    expect(markup).toContain('aria-label="Switch event"');
    expect(markup).toContain(">Switch</span>");
    const css = read("components/staff-shell.module.css");
    expect(css).toMatch(/\.eventBar \{ flex-wrap: wrap;/);
    expect(css).toMatch(/\.eventName \{ flex: 1 1 7rem; min-width: 7rem;/);
    expect(css).toMatch(/\.pickerPhoneLabel \{ display: none; \}/);
  });
});
