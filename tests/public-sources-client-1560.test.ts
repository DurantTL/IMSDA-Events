// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** #1560: the browser side of referring sites and campaign tags. Synthetic addresses only. */

vi.mock("next/web-vitals", () => ({ useReportWebVitals: () => undefined }));

import { PublicWebVitals, resetVitalsForTests } from "@/components/public-metrics-beacon";

const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
const readBlob = (blob: Blob) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
const sent = async () => Promise.all(sendBeacon.mock.calls.map(async ([, blob]) => JSON.parse(await readBlob(blob as unknown as Blob))));

function setup(options: { path?: string; referrer?: string; navigation?: string; gpc?: boolean; dnt?: string | null }) {
  window.history.pushState({}, "", options.path ?? "/events");
  Object.defineProperty(document, "referrer", { value: options.referrer ?? "", configurable: true });
  Object.defineProperty(navigator, "globalPrivacyControl", { value: options.gpc, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: options.dnt ?? null, configurable: true });
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: options.navigation ?? "navigate" }] as unknown as PerformanceEntryList);
}

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(PublicWebVitals)); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  resetVitalsForTests();
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("landing sources", () => {
  it("sends only the referrer's host and the three utm tags", async () => {
    setup({ path: "/events?utm_source=Flyer&utm_medium=print&utm_campaign=Fall&token=abc&q=secret", referrer: "https://www.Example.org/some/page?id=7" });
    await mount();
    expect(await sent()).toEqual([
      { metric: "REFERRER_SITE", dimension: "www.example.org" },
      { metric: "CAMPAIGN_VISIT", dimension: "flyer / print / fall" },
    ]);
  });
  it("skips a same-site referrer, a missing utm_source and a non-http referrer", async () => {
    setup({ path: "/events?utm_medium=print", referrer: `${window.location.origin}/calendar` });
    await mount();
    expect(await sent()).toEqual([]);
    sendBeacon.mockClear(); resetVitalsForTests(); document.body.replaceChildren();
    setup({ referrer: "android-app://com.example.app" });
    await mount();
    expect(await sent()).toEqual([]);
  });
  it("skips a reload and back/forward", async () => {
    for (const navigation of ["reload", "back_forward"]) {
      resetVitalsForTests(); document.body.replaceChildren();
      setup({ path: "/events?utm_source=flyer", referrer: "https://example.org/", navigation });
      await mount();
    }
    expect(await sent()).toEqual([]);
  });
  it("skips the staff workspace and a visitor who opted out", async () => {
    setup({ path: "/admin/analytics?utm_source=flyer", referrer: "https://example.org/" });
    await mount();
    expect(await sent()).toEqual([]);
    for (const signal of [{ gpc: true }, { dnt: "1" }]) {
      resetVitalsForTests(); document.body.replaceChildren();
      setup({ path: "/events?utm_source=flyer", referrer: "https://example.org/", ...signal });
      await mount();
    }
    expect(await sent()).toEqual([]);
  });
  it("drops campaign tags that hold an email or a long number, but still sends the referrer", async () => {
    setup({ path: "/events?utm_source=jane@example.org", referrer: "https://example.org/" });
    await mount();
    expect(await sent()).toEqual([{ metric: "REFERRER_SITE", dimension: "example.org" }]);
  });
});
