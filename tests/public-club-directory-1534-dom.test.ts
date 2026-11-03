// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublicClubDirectory } from "@/components/public-club-directory";
import { SEARCH_DEBOUNCE_MS } from "@/components/search-as-you-type";
import { buttonByText, mount, typeInto, type Mounted } from "./helpers/dom-render";

const clubs = [
  { id: "prairie", clubName: "Prairie Pathfinders", churchName: "Synthetic Church", town: "Des Moines", state: "IA", zip: "50309", meetingSchedule: "Sabbath afternoon", latitude: null, longitude: null },
  { id: "river", clubName: "River Adventurers", churchName: "Synthetic Church", town: "Columbia", state: "MO", zip: "65201", meetingSchedule: "", latitude: null, longitude: null },
];
let mounted: Mounted;
const box = () => mounted.container.querySelector<HTMLInputElement>('input[type="search"]')!;
beforeEach(() => { vi.useFakeTimers(); window.history.replaceState(null, "", "/clubs?q=Columbia"); });
afterEach(async () => { await mounted?.unmount(); vi.useRealTimers(); });

it("restores a shared club search, preserves selection, and clears the address with the results", async () => {
  mounted = await mount(createElement(StrictMode, null, createElement(PublicClubDirectory, { clubs, initialSearch: "Columbia" })));
  expect(box().value).toBe("Columbia");
  expect(mounted.container.textContent).toContain("River Adventurers");
  expect(mounted.container.textContent).not.toContain("Prairie Pathfinders");
  await act(async () => { mounted.container.querySelector<HTMLButtonElement>("li button")!.click(); });
  expect(mounted.container.textContent).toContain("Map location unavailable. This club is listed without a pin.");
  await act(async () => { buttonByText(mounted.container, "Clear filters")!.click(); });
  expect(box().value).toBe("");
  expect(window.location.search).toBe("");
  expect(mounted.container.textContent).toContain("Prairie Pathfinders");
  expect(mounted.container.querySelector('button[aria-expanded="true"]')?.textContent).toContain("River Adventurers");
});

it("keeps typing focus, announces no matches, and restores a different history entry", async () => {
  mounted = await mount(createElement(StrictMode, null, createElement(PublicClubDirectory, { clubs, initialSearch: "Columbia" })));
  box().focus();
  await typeInto(box(), "no-such-town");
  await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS); });
  expect(new URLSearchParams(window.location.search).get("q")).toBe("no-such-town");
  expect(document.activeElement).toBe(box());
  expect(mounted.container.textContent).toContain("No clubs match");
  expect(mounted.container.querySelector('[role="status"]')?.textContent).toContain("0 publicly listed clubs");
  await act(async () => {
    window.history.replaceState(null, "", "/clubs?q=Prairie");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(box().value).toBe("Prairie");
  expect(mounted.container.textContent).toContain("Prairie Pathfinders");
  expect(mounted.container.textContent).not.toContain("River Adventurers");
});
