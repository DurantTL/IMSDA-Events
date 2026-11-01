// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }) }));

import { BackgroundCheckReviewPanel } from "@/components/background-check-review-panel";
import { SEARCH_DEBOUNCE_MS, SearchAsYouTypeForm, SearchDisclosure } from "@/components/search-as-you-type";
import { mount, typeInto, type Mounted } from "./helpers/dom-render";

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

  it("applies a select change at once, and submit (Enter) at once, cancelling the pending timer", async () => {
    mounted = await mount(form());
    const select = mounted.container.querySelector("select")!;
    await act(async () => { select.value = "needs-attention"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace.mock.calls[0]![0]).toContain("attention=needs-attention");

    nav.replace.mockClear();
    await typeInto(q(), "river");
    await act(async () => { mounted.container.querySelector("form")!.requestSubmit(); });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    await pause(SEARCH_DEBOUNCE_MS * 2);
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
