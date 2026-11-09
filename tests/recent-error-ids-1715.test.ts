// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecentErrorIds, readRecentErrorIds, recordErrorId, resetRecentErrorIdsMemory } from "@/lib/recent-error-ids";
import { buildProblemReportDetails, problemReportDetailsSchema, type BrowserFacts } from "@/modules/support/problem-report-domain";

/** #1715: recent error ids. Ids only, never messages. Synthetic data only. */

const facts: BrowserFacts = {
  href: "/sign-in",
  userAgent: "Synthetic Browser",
  language: "en-US",
  htmlClassName: "",
  innerWidth: 390,
  innerHeight: 844,
  securityCheckLoadFailed: false,
  squareLoadFailed: false,
  now: new Date("2026-11-08T15:00:00.000Z"),
};

afterEach(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  resetRecentErrorIdsMemory();
});

describe("recent error id list", () => {
  it("keeps the newest 5, newest first, without repeats", () => {
    for (const id of ["11", "22", "33", "44", "55", "66", "33"]) recordErrorId(id);
    expect(readRecentErrorIds()).toEqual(["33", "66", "55", "44", "22"]);
  });

  it("ignores anything that is not a plain id, and never keeps an error message or stack", () => {
    const error = Object.assign(new Error("Could not save jane@example.com (Jane Example)"), { digest: undefined as string | undefined });
    recordErrorId(error.digest);
    recordErrorId(error.message);
    recordErrorId(error.stack);
    recordErrorId(error);
    recordErrorId("has space");
    recordErrorId("x".repeat(65));
    recordErrorId(42);
    recordErrorId(null);
    expect(readRecentErrorIds()).toEqual([]);
    expect(JSON.stringify(window.sessionStorage)).not.toContain("jane");
    recordErrorId("1234567890");
    expect(readRecentErrorIds()).toEqual(["1234567890"]);
  });

  it("tolerates corrupt or foreign storage content, re-checking every entry", () => {
    window.sessionStorage.setItem("imsda-recent-error-ids", "not json");
    expect(readRecentErrorIds()).toEqual([]);
    window.sessionStorage.setItem("imsda-recent-error-ids", JSON.stringify({ a: 1 }));
    expect(readRecentErrorIds()).toEqual([]);
    window.sessionStorage.setItem("imsda-recent-error-ids", JSON.stringify(["101", "jane@example.com", 7, "101", "102", "103", "104", "105", "106"]));
    expect(readRecentErrorIds()).toEqual(["101", "102", "103", "104", "105"]);
  });

  it("falls back to memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    recordErrorId("201");
    recordErrorId("202");
    expect(readRecentErrorIds()).toEqual(["202", "201"]);
  });
});

describe("error id format and clearing", () => {
  it("keeps a real Next digest with an error code, and refuses a plain word", () => {
    recordErrorId("123456789@E394");
    recordErrorId("Jane");
    recordErrorId("123@E");
    expect(readRecentErrorIds()).toEqual(["123456789@E394"]);
    expect(problemReportDetailsSchema.parse({ errorIds: ["123456789@E394"] }).errorIds).toEqual(["123456789@E394"]);
    expect(problemReportDetailsSchema.parse({ errorIds: ["123456789", "Jane"] }).errorIds).toBeUndefined();
  });

  it("forgets every id, in storage and in memory", () => {
    recordErrorId("111");
    recordErrorId("222");
    clearRecentErrorIds();
    expect(readRecentErrorIds()).toEqual([]);
    expect(window.sessionStorage.getItem("imsda-recent-error-ids")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    recordErrorId("333");
    clearRecentErrorIds();
    expect(readRecentErrorIds()).toEqual([]);
  });
});

describe("error ids in the technical details", () => {
  it("are included when present and left out when there are none", () => {
    expect(buildProblemReportDetails({ ...facts, errorIds: ["111", "222"] }).errorIds).toEqual(["111", "222"]);
    expect(buildProblemReportDetails(facts)).not.toHaveProperty("errorIds");
    expect(buildProblemReportDetails({ ...facts, errorIds: [] })).not.toHaveProperty("errorIds");
  });

  it("carry only the digest of an error whose message holds personal data", () => {
    const error = Object.assign(new Error("Failed for jane@example.com, Jane Example"), { digest: "9876543210" });
    recordErrorId(error.digest);
    recordErrorId(new Error("Failed for jane@example.com, Jane Example").message);
    const details = buildProblemReportDetails({ ...facts, errorIds: readRecentErrorIds() });
    expect(details.errorIds).toEqual(["9876543210"]);
    const json = JSON.stringify(details);
    for (const private_ of ["jane", "Jane", "example.com", "Failed"]) expect(json).not.toContain(private_);
  });

  it("are checked again by the schema: bad ids and long lists are dropped", () => {
    expect(problemReportDetailsSchema.parse({ errorIds: ["111", "222"] }).errorIds).toEqual(["111", "222"]);
    expect(problemReportDetailsSchema.parse({ errorIds: ["111", "jane@example.com"] }).errorIds).toBeUndefined();
    expect(problemReportDetailsSchema.parse({ errorIds: ["1", "2", "3", "4", "5", "6"] }).errorIds).toBeUndefined();
    expect(problemReportDetailsSchema.parse({ errorIds: "111", language: "en" })).toEqual({ language: "en" });
  });
});

describe("error boundary", () => {
  it("records only the digest, never the message", async () => {
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ErrorBoundaryView } = await import("@/components/error-boundary-view");
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);
    const error = Object.assign(new Error("Failed for jane@example.com"), { digest: "555000111" });
    await act(async () => { root.render(createElement(ErrorBoundaryView, { error, retry: () => {}, variant: "workspace" })); });
    const noDigest = new Error("Failed for jane@example.com");
    await act(async () => { root.render(createElement(ErrorBoundaryView, { error: noDigest, retry: () => {}, variant: "workspace" })); });
    expect(readRecentErrorIds()).toEqual(["555000111"]);
    expect(container.textContent).not.toContain("555000111");
    await act(async () => { root.unmount(); });
  });
});
