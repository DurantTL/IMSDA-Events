// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }), usePathname: () => "/account/area-clubs/overview", useSearchParams: () => new URLSearchParams() }));

import { AreaCoordinatorSearch } from "@/components/club-portal-search";
import { click, mount, typeInto, type Mounted } from "./helpers/dom-render";

/** The coordinator banner search in a DOM (#1854): the empty box lists the tabs, typing asks the area endpoint, "See all" and the focus rules work. Synthetic data. */

const pages = [
  { href: "/account/area-clubs/overview", label: "Overview" },
  { href: "/account/area-clubs/clubs", label: "Clubs" },
];
const answer = {
  query: "path",
  clubs: { items: [{ id: "o1", name: "Alpha Pathfinders", sponsoringChurch: "Synthville Church", href: "/account/area/o1" }], more: true, seeAllHref: "/account/area-clubs/clubs?q=path" },
};

let mounted: Mounted;
const input = () => mounted.container.querySelector<HTMLInputElement>("#area-search-input")!;
const wrap = () => mounted.container.querySelector<HTMLDivElement>("#area-search-input-wrap")!;
const toggle = () => mounted.container.querySelector("button[aria-controls]") as HTMLButtonElement;
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

describe("AreaCoordinatorSearch", () => {
  it("has a named icon button controlling the panel, and lists the tabs for an empty box without asking the server", async () => {
    mounted = await mount(createElement(AreaCoordinatorSearch, { pages }));
    expect(toggle().getAttribute("aria-label")).toBe("Search coordinator pages and clubs");
    expect(toggle().className).toContain("icon-button");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await act(async () => { input().focus(); });
    expect(options()).toEqual(["Overview", "Clubs"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks the area endpoint after the pause and shows the Clubs group with See all", async () => {
    mounted = await mount(createElement(AreaCoordinatorSearch, { pages }));
    await act(async () => { input().focus(); });
    await typeInto(input(), "path");
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/attendee/area-search?q=path");
    expect(options()).toEqual(["Alpha Pathfinders", "See all club results"]);
    expect([...mounted.container.querySelectorAll('[role="group"]')].map((group) => group.querySelector("span")?.textContent)).toEqual(["Clubs"]);
  });

  it("opens See all on the Clubs page with the words typed", async () => {
    mounted = await mount(createElement(AreaCoordinatorSearch, { pages }));
    await act(async () => { input().focus(); });
    await typeInto(input(), "path");
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(nav.push).toHaveBeenCalledWith("/account/area-clubs/clubs?q=path");
  });

  it("closes when focus moves outside, stays open when the card is pressed, and returns focus to the button when it closes", async () => {
    mounted = await mount(createElement("div", null, createElement(AreaCoordinatorSearch, { pages }), createElement("button", { id: "after", type: "button" }, "Next")));
    await click(toggle());
    await act(async () => { input().focus(); });
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => { wrap().dispatchEvent(press); });
    expect(press.defaultPrevented).toBe(true);
    expect(wrap().getAttribute("data-open")).toBe("true");
    await act(async () => { mounted.container.querySelector<HTMLButtonElement>("#after")!.focus(); });
    expect(wrap().getAttribute("data-open")).toBe("false");
    await click(toggle());
    await act(async () => { input().focus(); });
    await click(toggle());
    expect(wrap().getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });
});
