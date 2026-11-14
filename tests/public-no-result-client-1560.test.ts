// @vitest-environment jsdom
import { createElement, act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** #1560: a no-result search is sent once, as its final term, when the page is hidden or left. Synthetic terms only. */

import { NoResultSearchBeacon, resetNoResultForTests } from "@/components/public-metrics-beacon";

const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
const readBlob = (blob: Blob) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
const sent = async () => Promise.all(sendBeacon.mock.calls.map(async ([, blob]) => JSON.parse(await readBlob(blob as unknown as Blob))));

let root: Root;
const show = (term: string | null) => act(async () => { root.render(createElement(NoResultSearchBeacon, { term })); });
const pagehide = () => act(async () => { window.dispatchEvent(new Event("pagehide")); });
const navigationType = (type: string) => vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type }] as unknown as PerformanceEntryList);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  resetNoResultForTests();
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  navigationType("navigate");
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("no-result search beacon", () => {
  it("sends nothing while the visitor is still typing, then only the final term on pagehide", async () => {
    await show("qua");
    await show("quark");
    await show("quark smi");
    expect(await sent()).toEqual([]);
    await pagehide();
    expect(await sent()).toEqual([{ metric: "SEARCH_NO_RESULTS", dimension: "quark smi" }]);
  });
  it("never sends a term replaced by a results state", async () => {
    await show("quark");
    await show(null);
    await pagehide();
    expect(await sent()).toEqual([]);
  });
  it("sends a hidden tab once and does not resend the same term", async () => {
    await show("quark");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await pagehide();
    await pagehide();
    expect(await sent()).toHaveLength(1);
  });
  it("skips a reload or back/forward while the term is the one the page loaded with", async () => {
    navigationType("reload");
    await show("quark");
    await pagehide();
    expect(await sent()).toEqual([]);
    navigationType("back_forward");
    await show("quark");
    await pagehide();
    expect(await sent()).toEqual([]);
  });
  it("still sends a new term typed after a reload", async () => {
    navigationType("reload");
    await show("quark");
    await show("quarks");
    await pagehide();
    expect(await sent()).toEqual([{ metric: "SEARCH_NO_RESULTS", dimension: "quarks" }]);
  });
  it("does not count a double mount as leaving, and sends nothing for an opted-out visitor", async () => {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(NoResultSearchBeacon, { term: "quark" }))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(await sent()).toEqual([]);
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    await pagehide();
    expect(await sent()).toEqual([]);
  });
  it("sends the last term when the visitor leaves the events list", async () => {
    await show("quark");
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(await sent()).toEqual([{ metric: "SEARCH_NO_RESULTS", dimension: "quark" }]);
    root = createRoot(document.body.firstElementChild as HTMLElement);
  });
});
