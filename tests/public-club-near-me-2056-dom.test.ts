// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DistanceOrigin } from "@/components/club-distance";
import { PublicClubDirectory } from "@/components/public-club-directory";
import type { PublicClubListing } from "@/modules/organizations/public-club-directory";
import { buttonByText, mount, typeInto, type Mounted } from "./helpers/dom-render";

const mapProps: { origin?: DistanceOrigin | null }[] = [];
vi.mock("@/components/public-club-map", () => ({
  PublicClubMap: (props: { origin?: DistanceOrigin | null }) => { mapProps.push(props); return null; },
}));


function club(over: Partial<PublicClubListing>): PublicClubListing {
  return {
    id: "c", clubName: "Synthetic Club", churchName: "Synthetic Church", town: "Exampleton", state: "IA",
    zip: "50001", meetingSchedule: "Sabbath 3 pm", latitude: null, longitude: null, ...over,
  };
}

// In the usual (A to Z) order; the nearest to Columbia, Missouri is last.
const clubs = [
  club({ id: "ames", clubName: "Ames Pathfinders", churchName: "Ames Church", town: "Ames", latitude: 42.03, longitude: -93.62 }),
  club({ id: "brookside", clubName: "Brookside Explorers", churchName: "Brookside Church", town: "Brookside" }),
  club({ id: "columbia", clubName: "Columbia Adventurers", churchName: "Columbia Church", town: "Columbia", state: "MO", latitude: 38.95, longitude: -92.33 }),
];

type Geolocation = { getCurrentPosition: ReturnType<typeof vi.fn> };
let mounted: Mounted;
const realGeolocation = Object.getOwnPropertyDescriptor(window.navigator, "geolocation");

function setGeolocation(value: Geolocation | undefined) {
  Object.defineProperty(window.navigator, "geolocation", { configurable: true, value });
}

const names = () => [...mounted.container.querySelectorAll("li strong")].map((node) => node.textContent);
const nearMeButton = () => buttonByText(mounted.container, "Near me")!;
const placeBox = () => document.getElementById(mounted.container.querySelector("label[for$='-place']")!.getAttribute("for")!) as HTMLInputElement;

async function render() {
  mounted = await mount(createElement(StrictMode, null, createElement(PublicClubDirectory, { clubs })));
}

async function lookUp(value: string) {
  await typeInto(placeBox(), value);
  await act(async () => { placeBox().form!.requestSubmit(); });
  // The town table loads with a dynamic import.
  await vi.waitFor(() => expect(buttonByText(mounted.container, "Sort")).toBeTruthy());
}

const fetchSpy = vi.fn();
const beaconSpy = vi.fn();

beforeEach(() => {
  mapProps.length = 0;
  window.history.replaceState(null, "", "/clubs");
  vi.stubGlobal("fetch", fetchSpy);
  Object.defineProperty(window.navigator, "sendBeacon", { configurable: true, value: beaconSpy });
});

afterEach(async () => {
  await mounted?.unmount();
  if (realGeolocation) Object.defineProperty(window.navigator, "geolocation", realGeolocation);
  else Reflect.deleteProperty(window.navigator, "geolocation");
  vi.unstubAllGlobals();
  // Nothing about the location was sent, measured or put in the address.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(beaconSpy).not.toHaveBeenCalled();
  expect(window.location.search).toBe("");
  fetchSpy.mockReset();
  beaconSpy.mockReset();
});

describe("Near me on Find a club (#2056)", () => {
  it("with location allowed, sorts nearest first, shows miles, centers the map, and goes back to the usual order", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: 38.95, longitude: -92.33 } } as GeolocationPosition));
    setGeolocation({ getCurrentPosition });
    await render();
    expect(names()).toEqual(["Ames Pathfinders", "Brookside Explorers", "Columbia Adventurers"]);

    await act(async () => { nearMeButton().click(); });
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: false }));
    expect(names()).toEqual(["Columbia Adventurers", "Ames Pathfinders", "Brookside Explorers"]);
    expect(mounted.container.textContent).toContain("Columbia Church · Columbia · Under 1 mi");
    expect(mounted.container.textContent).toMatch(/Ames Church · Ames · \d{3} mi/);
    expect(mounted.container.textContent).toContain("Brookside Church · Brookside");
    expect(mounted.container.textContent).toContain("Sorted by distance from your location. Distances are straight-line miles.");
    expect(mounted.container.textContent).not.toContain("GeoNames");
    expect(mapProps.at(-1)?.origin).toMatchObject({ latitude: 38.95, longitude: -92.33 });

    await act(async () => { buttonByText(mounted.container, "Show usual order")!.click(); });
    expect(names()).toEqual(["Ames Pathfinders", "Brookside Explorers", "Columbia Adventurers"]);
    expect(document.activeElement).toBe(nearMeButton());
    expect(mounted.container.textContent).not.toMatch(/\d mi\b|Under 1 mi/);
    expect(mapProps.at(-1)?.origin).toBeNull();
  });

  it("when location is refused or blocked, says so and keeps the usual order", async () => {
    setGeolocation({ getCurrentPosition: vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 1 } as GeolocationPositionError)) });
    await render();
    await act(async () => { nearMeButton().click(); });
    expect(mounted.container.textContent).toContain("Location is off or blocked for this site, so the list stays in its usual order.");
    expect(names()).toEqual(["Ames Pathfinders", "Brookside Explorers", "Columbia Adventurers"]);
    expect(mounted.container.querySelector('[role="status"]:not(:empty)')).toBeTruthy();
  });

  it("when the location can't be found, or the browser can't share one, says so", async () => {
    setGeolocation({ getCurrentPosition: vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 3 } as GeolocationPositionError)) });
    await render();
    await act(async () => { nearMeButton().click(); });
    expect(mounted.container.textContent).toContain("Your location could not be found");
    await mounted.unmount();

    setGeolocation(undefined);
    await render();
    await act(async () => { nearMeButton().click(); });
    expect(mounted.container.textContent).toContain("This browser can't share a location here");
    expect(names()).toEqual(["Ames Pathfinders", "Brookside Explorers", "Columbia Adventurers"]);
  });

  it("stops waiting when the browser never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setGeolocation({ getCurrentPosition: vi.fn() });
      await render();
      await act(async () => { nearMeButton().click(); });
      expect(buttonByText(mounted.container, "Finding your location…")?.disabled).toBe(true);
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(mounted.container.textContent).toContain("Your location could not be found");
      expect(nearMeButton().disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sorts from a town or ZIP typed in, all in the browser", async () => {
    setGeolocation(undefined);
    await render();
    await lookUp("Columbia, MO");
    expect(names()).toEqual(["Columbia Adventurers", "Ames Pathfinders", "Brookside Explorers"]);
    expect(mounted.container.textContent).toContain("Sorted by distance from Columbia, MO.");
    expect(mounted.container.textContent).toContain("Town and ZIP locations from GeoNames (CC BY 4.0)");

    await lookUp("50010");
    expect(names()).toEqual(["Ames Pathfinders", "Columbia Adventurers", "Brookside Explorers"]);
    expect(mounted.container.textContent).toContain("Sorted by distance from ZIP 50010 (Ames, IA).");
  });

  it("returns focus to Near me after Show usual order, even while a location request is waiting", async () => {
    setGeolocation({ getCurrentPosition: vi.fn() });
    await render();
    await lookUp("Columbia, MO");
    await act(async () => { nearMeButton().click(); });
    expect(buttonByText(mounted.container, "Finding your location…")?.disabled).toBe(true);
    await act(async () => { buttonByText(mounted.container, "Show usual order")!.click(); });
    expect(nearMeButton().disabled).toBe(false);
    expect(document.activeElement).toBe(nearMeButton());
  });

  it("frees the Sort button when Near me is pressed while the town table is still loading", async () => {
    setGeolocation({ getCurrentPosition: vi.fn((success: PositionCallback) => success({ coords: { latitude: 42.03, longitude: -93.62 } } as GeolocationPosition)) });
    await render();
    await typeInto(placeBox(), "Columbia, MO");
    await act(async () => {
      placeBox().form!.requestSubmit();
      nearMeButton().click();
    });
    await vi.waitFor(() => expect(buttonByText(mounted.container, "Sort").disabled).toBe(false));
    // The later answer (Near me) wins; the slower town lookup is ignored.
    expect(mounted.container.textContent).toContain("Sorted by distance from your location.");
    expect(names()[0]).toBe("Ames Pathfinders");
  });

  it("says next to the box when a town can't be found", async () => {
    setGeolocation(undefined);
    await render();
    await lookUp("Atlantis");
    const box = placeBox();
    expect(box.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(box.getAttribute("aria-describedby")!);
    expect(message?.classList.contains("field-error-message")).toBe(true);
    expect(message?.textContent).toBe("We couldn't find “Atlantis” in Iowa or Missouri. Check the spelling or try a ZIP code.");
    expect([...mounted.container.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(" ")).toContain("We couldn't find “Atlantis”");
    expect(names()).toEqual(["Ames Pathfinders", "Brookside Explorers", "Columbia Adventurers"]);
  });

  it("keeps Near me buttons and the town box at least 44px through the shared classes", async () => {
    setGeolocation(undefined);
    await render();
    expect(nearMeButton().classList.contains("secondary-button")).toBe(true);
    expect(buttonByText(mounted.container, "Sort")!.classList.contains("secondary-button")).toBe(true);
    expect(placeBox().hasAttribute("name")).toBe(false);
  });
});
