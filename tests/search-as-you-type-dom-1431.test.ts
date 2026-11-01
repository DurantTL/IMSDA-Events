// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: nav.push }) }));

import { BackgroundCheckReviewPanel } from "@/components/background-check-review-panel";
import { ClubOrderWorkspace } from "@/components/club-order-workspace";
import { ClubSupplyStockWorkspace } from "@/components/club-supply-stock-workspace";
import { addressModeFor, SEARCH_DEBOUNCE_MS, SearchAsYouTypeForm, SearchDisclosure, useClientSearch } from "@/components/search-as-you-type";
import type { ClubStockRow } from "@/modules/club-supplies/repository";
import { buttonByText, mount, typeInto, type Mounted } from "./helpers/dom-render";

/** The shared hook in a real DOM, with fake timers and a mocked router (#1431). Synthetic data only. */
function form() {
  return createElement(
    SearchAsYouTypeForm,
    { action: "/admin/clubs" },
    createElement("input", { name: "year", type: "hidden", value: "2026" }),
    createElement("input", { "aria-label": "Search", defaultValue: "", id: "q", name: "q", type: "search" }),
    createElement("select", { "aria-label": "Show", defaultValue: "all", name: "attention" },
      createElement("option", { value: "all" }, "All"),
      createElement("option", { value: "needs-attention" }, "Needs attention")),
    createElement("a", { href: "/admin/clubs?year=2026", onClick: (event: { preventDefault: () => void }) => event.preventDefault() }, "Clear"),
    createElement("button", { type: "submit" }, "Search"),
  );
}

const pause = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
let mounted: Mounted;

beforeEach(() => {
  vi.useFakeTimers();
  nav.replace.mockReset();
  nav.push.mockReset();
  window.history.replaceState(null, "", "/admin/clubs?year=2026&page=3");
});
afterEach(async () => {
  await mounted?.unmount();
  vi.useRealTimers();
});

describe("SearchAsYouTypeForm in a DOM", () => {
  const q = () => mounted.container.querySelector<HTMLInputElement>("#q")!;

  it("waits for the pause after typing, then replaces the address (page 1, scroll kept)", async () => {
    mounted = await mount(form());
    await typeInto(q(), "eag");
    await pause(SEARCH_DEBOUNCE_MS - 1);
    expect(nav.replace).not.toHaveBeenCalled();
    await typeInto(q(), "eagl");
    await pause(SEARCH_DEBOUNCE_MS - 1);
    expect(nav.replace).not.toHaveBeenCalled();
    await pause(1);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/admin/clubs?year=2026&q=eagl&attention=all", { scroll: false });
  });

  it("pushes a select change at once (Back undoes it) and a submit (Enter) at once, cancelling the pending timer (rule B2, #1456)", async () => {
    mounted = await mount(form());
    const select = mounted.container.querySelector("select")!;
    await act(async () => { select.value = "needs-attention"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.push.mock.calls[0]![0]).toContain("attention=needs-attention");

    nav.push.mockClear();
    await typeInto(q(), "river");
    await act(async () => { mounted.container.querySelector("form")!.requestSubmit(); });
    expect(nav.push).toHaveBeenCalledTimes(1);
    await pause(SEARCH_DEBOUNCE_MS * 2);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("replaces for typed text (one history entry per search) and pushes for a checkbox", async () => {
    mounted = await mount(createElement(
      SearchAsYouTypeForm,
      { action: "/people/attendees" },
      createElement("input", { id: "q", name: "q", type: "search" }),
      createElement("input", { "aria-label": "Dietary", name: "dietary", type: "checkbox", value: "1" }),
    ));
    await typeInto(q(), "ann");
    await pause(SEARCH_DEBOUNCE_MS);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    const box = mounted.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { box.click(); });
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push.mock.calls[0]![0]).toBe("/people/attendees?q=ann&dietary=1");
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("does not navigate when the address would not change", async () => {
    window.history.replaceState(null, "", "/admin/clubs?year=2026&attention=all");
    mounted = await mount(form());
    await act(async () => { mounted.container.querySelector("form")!.requestSubmit(); });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a link inside the form drops a pending search", async () => {
    mounted = await mount(form());
    await typeInto(q(), "old");
    await act(async () => { mounted.container.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    await pause(SEARCH_DEBOUNCE_MS * 2);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("re-syncs fields after the URL changes, but never the focused one", async () => {
    mounted = await mount(form());
    await typeInto(q(), "typed");
    nav.replace.mockClear();
    const select = mounted.container.querySelector("select")!;
    q().focus();
    window.history.replaceState(null, "", "/admin/clubs?year=2026&q=fromurl&attention=needs-attention");
    // A re-render of the form (as after a navigation) runs the sync.
    await act(async () => { mounted.root.render(form()); });
    expect(q().value).toBe("typed");
    expect(select.value).toBe("needs-attention");
    q().blur();
    window.history.replaceState(null, "", "/admin/clubs?year=2026&q=other");
    await act(async () => { mounted.root.render(form()); });
    expect(q().value).toBe("other");
    expect(select.value).toBe("all");
  });
});

describe("addressModeFor (rule B2, #1456)", () => {
  const make = (tag: string, type?: string) => {
    const element = document.createElement(tag);
    if (type) element.setAttribute("type", type);
    return element;
  };
  it("pushes for a select, checkbox and radio, and replaces for typed text", () => {
    expect(addressModeFor(make("select"))).toBe("push");
    expect(addressModeFor(make("input", "checkbox"))).toBe("push");
    expect(addressModeFor(make("input", "radio"))).toBe("push");
    expect(addressModeFor(make("input", "search"))).toBe("replace");
    expect(addressModeFor(make("input", "text"))).toBe("replace");
    expect(addressModeFor(make("textarea"))).toBe("replace");
  });
});

describe("status checkboxes follow the URL (comma lists and defaults)", () => {
  const statusForm = () => createElement(
    SearchAsYouTypeForm,
    { action: "/people/attendees" },
    createElement("input", { id: "q", name: "q", type: "search" }),
    createElement("select", { "aria-label": "Meal", defaultValue: "", name: "meal" },
      createElement("option", { value: "" }, "All"), createElement("option", { value: "vegan" }, "Vegan")),
    createElement("input", { "data-default-checked": "", defaultChecked: true, name: "statuses", type: "checkbox", value: "CONFIRMED" }),
    createElement("input", { defaultChecked: false, name: "statuses", type: "checkbox", value: "WAITLISTED" }),
  );
  const boxes = () => [...mounted.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((box) => box.checked);

  it("ticks every status of a comma list, ticks only the default when the URL has none, and keeps the filter on the next keystroke", async () => {
    window.history.replaceState(null, "", "/people/attendees");
    mounted = await mount(statusForm());
    window.history.replaceState(null, "", "/people/attendees?statuses=CONFIRMED,WAITLISTED&sort=name");
    await act(async () => { mounted.root.render(statusForm()); });
    expect(boxes()).toEqual([true, true]);
    await typeInto(mounted.container.querySelector<HTMLInputElement>("#q")!, "ann");
    await pause(SEARCH_DEBOUNCE_MS);
    expect(nav.replace.mock.calls.at(-1)![0]).toBe("/people/attendees?q=ann&statuses=CONFIRMED&statuses=WAITLISTED");

    window.history.replaceState(null, "", "/people/attendees?statuses=WAITLISTED");
    await act(async () => { mounted.root.render(statusForm()); });
    expect(boxes()).toEqual([false, true]);

    // Reset: the link has no statuses, and the list shows Confirmed, so Confirmed is the ticked box.
    window.history.replaceState(null, "", "/people/attendees");
    await act(async () => { mounted.root.render(statusForm()); });
    expect(boxes()).toEqual([true, false]);
  });
});

describe("background-check lookup ignores stale answers", () => {
  it("shows the newest lookup even when an older one answers last", async () => {
    const waiting: Array<{ name: string; resolve: (total: number) => void }> = [];
    const lookup = (name: string, total: number) => ({
      query: name, hasList: true, rows: [], people: [], pairs: [], rejected: [],
      rowsPage: { page: 1, pageCount: 1, total, from: 0, to: 0 },
      peoplePage: { page: 1, pageCount: 1, total: 0, from: 0, to: 0 },
    });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/lookup?")) {
        const name = decodeURIComponent(new URL(url, "http://x").searchParams.get("name") ?? "");
        return new Promise((resolve) => waiting.push({
          name,
          resolve: (total) => resolve({ ok: true, json: async () => ({ lookup: lookup(name, total) }) }),
        }));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));
    mounted = await mount(createElement(BackgroundCheckReviewPanel));
    await pause(1);
    const box = mounted.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await typeInto(box, "a");
    await pause(SEARCH_DEBOUNCE_MS);
    await typeInto(box, "ab");
    await pause(SEARCH_DEBOUNCE_MS);
    expect(waiting.map((item) => item.name)).toEqual(["a", "ab"]);
    await act(async () => { waiting[1]!.resolve(2); await Promise.resolve(); });
    await act(async () => { waiting[0]!.resolve(1); await Promise.resolve(); });
    const status = [...mounted.container.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(" | ");
    expect(status).toContain("2 list rows and 0 people found");
    expect(status).not.toContain("1 list row and");
    vi.unstubAllGlobals();
  });
});

describe("SearchDisclosure (#1431)", () => {
  const panel = (open: boolean) => createElement(SearchDisclosure, { className: "operations-search-disclosure", open }, createElement("summary", null, "Advanced search"), createElement("input", { name: "q", type: "search" }));
  const details = () => mounted.container.querySelector("details")!;

  it("stays open when clearing the box removes the last filter, and opens when the server opens it", async () => {
    mounted = await mount(panel(true));
    expect(details().open).toBe(true);
    await act(async () => { mounted.root.render(panel(false)); });
    expect(details().open).toBe(true);
  });

  it("starts closed when no filter is active, and opens when one becomes active", async () => {
    mounted = await mount(panel(false));
    expect(details().open).toBe(false);
    await act(async () => { mounted.root.render(panel(true)); });
    expect(details().open).toBe(true);
  });
});

describe("useClientSearch (#1431)", () => {
  /** A box and a list filtered on the settled `term`, as the converted workspaces do. */
  function Box({ names }: { names: string[] }) {
    const search = useClientSearch();
    const shown = names.filter((name) => name.toLowerCase().includes(search.term.trim().toLowerCase()));
    return createElement(
      "div",
      null,
      createElement("input", { ...search.inputProps, "aria-label": "Find", type: "search" }),
      createElement("button", { onClick: () => search.setValue(""), type: "button" }, "Reset"),
      createElement("ul", null, shown.map((name) => createElement("li", { key: name }, name))),
    );
  }
  const names = ["Eagle Patch", "Eagle Ribbon", "Bear Patch"];
  const box = () => mounted.container.querySelector<HTMLInputElement>("input")!;
  const items = () => [...mounted.container.querySelectorAll("li")].map((item) => item.textContent);
  const enter = () => act(async () => { box().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" })); });

  it("shows every keystroke at once but filters the list only after the pause", async () => {
    mounted = await mount(createElement(Box, { names }));
    await typeInto(box(), "eag");
    expect(box().value).toBe("eag");
    expect(items()).toEqual(names);
    await pause(SEARCH_DEBOUNCE_MS - 1);
    expect(items()).toEqual(names);
    await typeInto(box(), "eagle r");
    await pause(SEARCH_DEBOUNCE_MS - 1);
    expect(items()).toEqual(names);
    await pause(1);
    expect(items()).toEqual(["Eagle Ribbon"]);
  });

  it("applies at once on Enter, and swallows Enter when the box is not in a form", async () => {
    mounted = await mount(createElement(Box, { names }));
    await typeInto(box(), "bear");
    expect(items()).toEqual(names);
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
    await act(async () => { box().dispatchEvent(event); });
    expect(items()).toEqual(["Bear Patch"]);
    expect(event.defaultPrevented).toBe(true);
    // The pause that was waiting is gone: nothing changes later.
    await pause(SEARCH_DEBOUNCE_MS * 2);
    expect(items()).toEqual(["Bear Patch"]);
  });

  it("leaves Enter to the form when the box is inside one, and still applies", async () => {
    const submitted = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    function InForm() {
      const search = useClientSearch();
      return createElement("form", { onSubmit: submitted }, createElement("input", { ...search.inputProps, "aria-label": "Find", type: "search" }), createElement("p", { id: "term" }, search.term));
    }
    mounted = await mount(createElement(InForm));
    await typeInto(box(), "bear");
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
    await act(async () => { box().dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(mounted.container.querySelector("#term")!.textContent).toBe("bear");
  });

  it("shows the full list at once when the box is cleared, by hand or by a Reset", async () => {
    mounted = await mount(createElement(Box, { names }));
    await typeInto(box(), "bear");
    await enter();
    expect(items()).toEqual(["Bear Patch"]);
    await typeInto(box(), "");
    expect(items()).toEqual(names);
    await typeInto(box(), "bear");
    await enter();
    await act(async () => { mounted.container.querySelector("button")!.click(); });
    expect(box().value).toBe("");
    expect(items()).toEqual(names);
  });

  it("applies at once when the box loses focus, so a click never lands on a list that changes under it", async () => {
    mounted = await mount(createElement(Box, { names }));
    const input = box();
    input.focus();
    await typeInto(input, "bear");
    expect(items()).toEqual(names);
    await act(async () => { input.blur(); });
    expect(items()).toEqual(["Bear Patch"]);
    await pause(SEARCH_DEBOUNCE_MS * 2);
    expect(items()).toEqual(["Bear Patch"]);
  });

  it("keeps focus on the same input while the list changes", async () => {
    mounted = await mount(createElement(Box, { names }));
    const input = box();
    input.focus();
    await typeInto(input, "patch");
    await pause(SEARCH_DEBOUNCE_MS);
    expect(items()).toEqual(["Eagle Patch", "Bear Patch"]);
    expect(box()).toBe(input);
    expect(document.activeElement).toBe(input);
  });
});

describe("a converted club-portal list searches as you type, no Enter (#1431)", () => {
  const row = (itemId: string, name: string, catalogNumber: string): ClubStockRow => ({
    itemId, section: "MISCELLANEOUS", name, catalogNumber, sizeLabel: null, isActive: true, quantityOnHand: 0,
  });
  const stock = [row("a", "Polo Shirt", "UN-204"), row("b", "Neckerchief", "NK-1"), row("c", "Polo Hat", "UN-310")];
  const box = () => mounted.container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const names = () => [...mounted.container.querySelectorAll("li strong")].map((node) => node.textContent);

  it("narrows the supply stock list after the pause, announces the count, and clears at once", async () => {
    mounted = await mount(createElement(ClubSupplyStockWorkspace, { organizationId: "club-1", initialStock: stock }));
    expect(names()).toHaveLength(3);
    await typeInto(box(), "polo");
    expect(names()).toHaveLength(3);
    await pause(SEARCH_DEBOUNCE_MS);
    expect(names()).toHaveLength(2);
    expect(mounted.container.querySelector('p.sr-only[role="status"]')!.textContent).toBe("2 items shown.");
    await typeInto(box(), "");
    expect(names()).toHaveLength(3);
  });
});

describe("a list goes back to page 1 when the search settles (#1431)", () => {
  it("club order picker: page 2, type, and after the pause it is page 1 of the narrowed list", async () => {
    const many: ClubStockRow[] = Array.from({ length: 250 }, (_, index) => ({
      itemId: `i${index}`, section: "MISCELLANEOUS", name: `Patch ${index}`, catalogNumber: `P-${index}`, sizeLabel: null, isActive: true, quantityOnHand: 0,
    }));
    mounted = await mount(createElement(ClubOrderWorkspace, {
      organizationId: "club-1",
      initial: { helper: [], batches: [], unmatched: [], awardable: [], waiting: [], firstOrderAt: null },
      stock: many,
    }));
    const pager = () => mounted.container.querySelector('nav[aria-label="Honor and item pages"]');
    const pageText = () => pager()?.textContent ?? "";
    await act(async () => { buttonByText(mounted.container, "Next").click(); });
    expect(pageText()).toContain("Showing 101–200 of 250");
    const box = mounted.container.querySelector<HTMLInputElement>("#club-order-picker-search")!;
    await typeInto(box, "patch 24");
    // Still on page 2 until the list actually changes.
    expect(pageText()).toContain("Showing 101–200 of 250");
    await pause(SEARCH_DEBOUNCE_MS);
    expect(pageText()).not.toContain("101–200");
    expect(mounted.container.querySelector("#club-order-picker-results")!.textContent).toContain("13 items match");
  });
});
