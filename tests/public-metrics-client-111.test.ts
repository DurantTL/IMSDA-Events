// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** #111: the browser side. One stable web-vitals callback, no counting for GPC/DNT or the staff workspace. Synthetic data only. */

const hooks = vi.hoisted(() => ({ registered: [] as unknown[] }));
vi.mock("next/web-vitals", () => ({ useReportWebVitals: (callback: unknown) => { hooks.registered.push(callback); } }));

import { PublicMetricsBeacon, PublicWebVitals, reportVital, resetVitalsForTests } from "@/components/public-metrics-beacon";

const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
const readBlob = (blob: Blob) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
const sent = async () => Promise.all(sendBeacon.mock.calls.map(async ([, blob]) => JSON.parse(await readBlob(blob as unknown as Blob))));

function setPath(path: string) {
  window.history.pushState({}, "", path);
}
function setSignals(signals: { gpc?: boolean; dnt?: string | null }) {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: signals.gpc, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: signals.dnt ?? null, configurable: true });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  resetVitalsForTests();
  hooks.registered.length = 0;
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
  setSignals({});
  setPath("/events");
});
afterEach(() => document.body.replaceChildren());

async function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { root, rerender: (next: ReturnType<typeof createElement>) => act(async () => root.render(next)) };
}

describe("web vitals", () => {
  it("hands Next the same callback on every render, so the listeners are registered once", async () => {
    const view = await mount(createElement(PublicWebVitals));
    await view.rerender(createElement(PublicWebVitals));
    await view.rerender(createElement(PublicWebVitals));
    expect(hooks.registered.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hooks.registered).size).toBe(1);
    expect(hooks.registered[0]).toBe(reportVital);
  });

  it("reports a known measure once per page load, as a name and rating only", async () => {
    reportVital({ name: "LCP", rating: "good" });
    reportVital({ name: "LCP", rating: "poor" });
    reportVital({ name: "FID", rating: "good" });
    reportVital({ name: "CLS", rating: "bogus" });
    expect(await sent()).toEqual([{ metric: "WEB_VITAL", dimension: "LCP:good" }]);
  });

  it("is silent in the staff workspace, even after a client-side navigation", async () => {
    setPath("/admin/people");
    reportVital({ name: "TTFB", rating: "good" });
    reportVital({ name: "INP", rating: "good" });
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("web vitals and where the visit began", () => {
  it("judge the page the visit landed on, not where the visitor has navigated since", async () => {
    setPath("/events");
    await mount(createElement(PublicWebVitals));
    setPath("/admin/people");
    reportVital({ name: "LCP", rating: "good" });
    expect(await sent()).toEqual([{ metric: "WEB_VITAL", dimension: "LCP:good" }]);
  });

  it("stay silent for a visit that began in the staff workspace, even after navigating to a public page", async () => {
    setPath("/admin/people");
    await mount(createElement(PublicWebVitals));
    setPath("/events");
    reportVital({ name: "LCP", rating: "good" });
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("the beacon", () => {
  it("sends its hits as plain text, with only the metric and the allowlisted dimension", async () => {
    await mount(createElement(PublicMetricsBeacon, { hits: [{ metric: "EVENT_PAGE_VIEW", dimension: "public-camp" }, { metric: "DIRECTORY_SEARCH" }] }));
    expect(await sent()).toEqual([{ metric: "EVENT_PAGE_VIEW", dimension: "public-camp" }, { metric: "DIRECTORY_SEARCH" }]);
    expect((sendBeacon.mock.calls[0][1] as unknown as Blob).type).toBe("text/plain");
  });

  it("sends nothing when the browser signals Global Privacy Control", async () => {
    setSignals({ gpc: true });
    await mount(createElement(PublicMetricsBeacon, { hits: [{ metric: "EVENT_PAGE_VIEW", dimension: "public-camp" }], notFound: true }));
    reportVital({ name: "CLS", rating: "good" });
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("sends nothing when the browser signals Do Not Track", async () => {
    setSignals({ dnt: "1" });
    await mount(createElement(PublicMetricsBeacon, { hits: [{ metric: "DIRECTORY_SEARCH" }] }));
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("counts a missing public page by its first segment, and never a missing staff page", async () => {
    setPath("/events/nope?q=secret");
    await mount(createElement(PublicMetricsBeacon, { notFound: true }));
    expect(await sent()).toEqual([{ metric: "NOT_FOUND", dimension: "events" }]);
    sendBeacon.mockClear();
    setPath("/admin/anything");
    await mount(createElement(PublicMetricsBeacon, { notFound: true }));
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
