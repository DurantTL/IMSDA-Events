// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }), usePathname: () => "/account/clubs/o1", useSearchParams: () => new URLSearchParams() }));

import { ClubPortalSearch } from "@/components/club-portal-search";
import { click, mount, typeInto, type Mounted } from "./helpers/dom-render";

/** The club masthead search in a DOM (#1854): the empty box lists the pages, typing asks the club endpoint, keys and Enter work. Synthetic data. */

const pages = [
  { href: "/account/clubs/o1", label: "Home" },
  { href: "/account/clubs/o1/roster", label: "Roster" },
];
const answer = {
  query: "ada",
  clubs: { items: [], more: false, seeAllHref: null },
  members: { items: [{ name: "Ada Lovelace", club: null, href: "/account/clubs/o1/roster?q=Ada+Lovelace" }], more: true, seeAllHref: "/account/clubs/o1/roster?q=ada" },
};

let mounted: Mounted;
const input = () => mounted.container.querySelector<HTMLInputElement>("#club-portal-search-input")!;
const options = () => [...mounted.container.querySelectorAll('[role="option"]')].map((option) => option.querySelector(".destination-search-label")?.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  nav.push.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
});
afterEach(async () => {
  await mounted?.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ClubPortalSearch", () => {
  it("lists the pages for an empty box without asking the server", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    await act(async () => { input().focus(); });
    expect(options()).toEqual(["Home", "Roster"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(input().getAttribute("role")).toBe("combobox");
  });

  it("has an icon button of its own for a phone, named and controlling the search row", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    const button = mounted.container.querySelector("button[aria-controls]") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Search this club's pages, your clubs and members");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("asks the club endpoint after the pause, and shows members and a See all link in groups", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    await act(async () => { input().focus(); });
    await typeInto(input(), "ada");
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/attendee/club-search?q=ada");
    expect(options()).toEqual(["Ada Lovelace", "See all member results"]);
    expect([...mounted.container.querySelectorAll('[role="group"]')].map((group) => group.querySelector("span")?.textContent)).toEqual(["Members"]);
  });

  it("moves focus on to the next real control on Tab, never to the list", async () => {
    const { createElement: h } = await import("react");
    mounted = await mount(h("div", null, h(ClubPortalSearch, { pages }), h("button", { id: "after", type: "button" }, "After")));
    await act(async () => { input().focus(); });
    const list = mounted.container.querySelector('[role="listbox"]')!;
    expect(list.getAttribute("tabindex")).toBe("-1");
    // Tab order as a browser builds it: real controls and anything with a tabindex of 0 or more, in document order.
    const tabbable = [...mounted.container.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), [tabindex]")].filter((el) => el.getAttribute("tabindex") !== "-1");
    expect(tabbable).not.toContain(list);
    const next = tabbable[tabbable.indexOf(input()) + 1];
    expect(next).toBeDefined();
    expect(["BUTTON", "A"]).toContain(next.tagName);
  });

  it("moves with the arrow keys and opens the active row with Enter", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    await act(async () => { input().focus(); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(nav.push).toHaveBeenCalledWith("/account/clubs/o1/roster");
  });
});
