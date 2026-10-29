// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicClubDirectory } from "@/components/public-club-directory";
import type { PublicClubListing } from "@/modules/organizations/public-club-directory";

vi.mock("@/components/public-club-map", () => ({ PublicClubMap: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function club(over: Partial<PublicClubListing>): PublicClubListing {
  return {
    id: "c", clubName: "Synthetic Club", churchName: "Synthetic Church", town: "Exampleton", state: "XX",
    zip: "00000", meetingSchedule: "Sabbath 3 pm", latitude: 40, longitude: -93, ...over,
  };
}

const clubs = [
  club({ id: "a", clubName: "Eagles Pathfinders", churchName: "Riverton Church", town: "Riverton", zip: "50001" }),
  club({ id: "b", clubName: "Adventurers", churchName: "Riverton Church", town: "Riverton", zip: "50001" }),
  club({ id: "c", clubName: "Brookside Explorers", churchName: "Brookside Church", town: "Brookside", zip: "50002", latitude: null, longitude: null }),
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

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const clearButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Clear search"));

describe("find a club search flow (#1306)", () => {
  it("filters, offers Clear search, and restores the full list and count", () => {
    act(() => root.render(createElement(PublicClubDirectory, { clubs })));
    const input = container.querySelector("input[type=search]") as HTMLInputElement;
    expect(container.textContent).toContain("3 publicly listed clubs found · 2 shown on map");
    expect(container.textContent).toContain("1 club has no map location and is listed only.");
    expect(clearButton()).toBeUndefined();

    type(input, "riverton");
    expect(container.textContent).toContain("2 publicly listed clubs found · 2 shown on map");
    expect(container.textContent).not.toContain("no map location");
    expect(container.textContent).not.toContain("Brookside Explorers");
    expect(clearButton()).toBeDefined();

    type(input, "brookside");
    expect(container.textContent).toContain("1 publicly listed club found · 0 shown on map");
    expect(container.textContent).toContain("1 club has no map location and is listed only.");

    act(() => clearButton()!.click());
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(clearButton()).toBeUndefined();
    expect(container.textContent).toContain("3 publicly listed clubs found · 2 shown on map");
    expect(container.textContent).toContain("1 club has no map location and is listed only.");
    expect(container.textContent).toContain("Brookside Explorers");
    expect(container.textContent).toContain("Eagles Pathfinders");
  });

  it("announces the count politely after typing stops", () => {
    vi.useFakeTimers();
    try {
      act(() => root.render(createElement(PublicClubDirectory, { clubs })));
      const input = container.querySelector("input[type=search]") as HTMLInputElement;
      type(input, "riverton");
      const status = container.querySelector('[role="status"]')!;
      expect(status.textContent).not.toContain("2 publicly listed clubs found");
      act(() => { vi.advanceTimersByTime(700); });
      expect(status.textContent).toContain("2 publicly listed clubs found");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("calendar bar dates are whole or not shown (#1306)", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  const marker = css.indexOf("/* Registration form builder editor shell (#1132)");

  it("lets the dates wrap to a clipped line instead of shrinking", () => {
    expect(css).toMatch(/\.calendar-bar \{[^}]*flex-wrap: wrap;[^}]*height: 20px;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.calendar-bar-dates \{ flex: 0 0 auto; font-weight: 500; \}/);
    expect(css).not.toMatch(/\.calendar-bar-dates \{[^}]*(flex: 0 1 auto|text-overflow)/);
    expect(css).toMatch(/\.calendar-bar-edge-end \{ position: absolute;/);
    expect(css.indexOf(".calendar-bar-dates {")).toBeLessThan(marker);
  });
});
