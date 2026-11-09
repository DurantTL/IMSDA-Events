// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRecentErrorIds, recordErrorId, resetRecentErrorIdsMemory } from "@/lib/recent-error-ids";
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

beforeEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  resetRecentErrorIdsMemory();
});

describe("recent error id list", () => {
  it("keeps the newest 5, newest first, without repeats", () => {
    for (const id of ["a1", "b2", "c3", "d4", "e5", "f6", "c3"]) recordErrorId(id);
    expect(readRecentErrorIds()).toEqual(["c3", "f6", "e5", "d4", "b2"]);
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
    window.sessionStorage.setItem("imsda-recent-error-ids", JSON.stringify(["ok1", "jane@example.com", 7, "ok1", "ok2", "ok3", "ok4", "ok5", "ok6"]));
    expect(readRecentErrorIds()).toEqual(["ok1", "ok2", "ok3", "ok4", "ok5"]);
  });

  it("falls back to memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    recordErrorId("m1");
    recordErrorId("m2");
    expect(readRecentErrorIds()).toEqual(["m2", "m1"]);
  });
});

describe("error ids in the technical details", () => {
  it("are included when present and left out when there are none", () => {
    expect(buildProblemReportDetails({ ...facts, errorIds: ["a1", "b2"] }).errorIds).toEqual(["a1", "b2"]);
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
    expect(problemReportDetailsSchema.parse({ errorIds: ["a1", "b2"] }).errorIds).toEqual(["a1", "b2"]);
    expect(problemReportDetailsSchema.parse({ errorIds: ["a1", "jane@example.com"] }).errorIds).toBeUndefined();
    expect(problemReportDetailsSchema.parse({ errorIds: ["a", "b", "c", "d", "e", "f"] }).errorIds).toBeUndefined();
    expect(problemReportDetailsSchema.parse({ errorIds: "a1", language: "en" })).toEqual({ language: "en" });
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
