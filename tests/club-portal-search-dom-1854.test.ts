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

  it("keeps the scrolling list out of the tab order", async () => {
    const { createElement: h } = await import("react");
    mounted = await mount(h("div", null, h(ClubPortalSearch, { pages })));
    await act(async () => { input().focus(); });
    const list = mounted.container.querySelector('[role="listbox"]')!;
    expect(list.getAttribute("tabindex")).toBe("-1");
  });

  it("moves with the arrow keys and opens the active row with Enter", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    await act(async () => { input().focus(); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(nav.push).toHaveBeenCalledWith("/account/clubs/o1/roster");
  });

  it("closes the open panel when focus moves to something outside it", async () => {
    const { createElement: h } = await import("react");
    mounted = await mount(h("div", null, h(ClubPortalSearch, { pages }), h("button", { id: "after", type: "button" }, "Next")));
    const button = mounted.container.querySelector("button[aria-controls]") as HTMLButtonElement;
    const wrap = () => mounted.container.querySelector("#club-portal-search-input-wrap")!;
    await click(button);
    await act(async () => { input().focus(); });
    expect(wrap().getAttribute("data-open")).toBe("true");
    await act(async () => { mounted.container.querySelector<HTMLButtonElement>("#after")!.focus(); });
    expect(wrap().getAttribute("data-open")).toBe("false");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the panel when focus goes back to its button (as Escape hands it back)", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    const button = mounted.container.querySelector("button[aria-controls]") as HTMLButtonElement;
    const wrap = () => mounted.container.querySelector("#club-portal-search-input-wrap")!;
    await act(async () => { button.focus(); });
    await click(button);
    await act(async () => { input().focus(); });
    await act(async () => { button.focus(); });
    expect(wrap().getAttribute("data-open")).toBe("false");
  });

  it("stays open when the card itself is pressed, and hands focus to the button when the button closes it", async () => {
    mounted = await mount(createElement(ClubPortalSearch, { pages }));
    const button = mounted.container.querySelector("button[aria-controls]") as HTMLButtonElement;
    const wrap = () => mounted.container.querySelector<HTMLDivElement>("#club-portal-search-input-wrap")!;
    await click(button);
    await act(async () => { input().focus(); });
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => { wrap().dispatchEvent(press); });
    expect(press.defaultPrevented).toBe(true);
    expect(wrap().getAttribute("data-open")).toBe("true");
    await click(button);
    expect(wrap().getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});
