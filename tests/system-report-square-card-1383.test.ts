// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never) }));

import { SquareTesterCard } from "@/app/(workspace)/admin/system-report/square-tester-card";

/** #1383: the Square card announces a one-line result, and says nothing while a run is in progress. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows = (states: string[]) => ["account", "location", "notices", "test"].map((key, index) => ({ key, state: states[index], text: "Synthetic.", next: null, at: null }));

let container: HTMLDivElement;
let root: Root;
let release: (response: Response) => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const summaryLine = () => container.querySelector('p.sr-only[role="status"]')!;

async function runWith(result: object) {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  act(() => root.render(createElement(SquareTesterCard)));
  expect(summaryLine().textContent).toBe("");
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Run Square checks"))!;
  await act(async () => { button.click(); });
  // While the run is in progress the line stays empty.
  expect(summaryLine().textContent).toBe("");
  expect(container.textContent).toContain("Checking Square…");
  await act(async () => { release(Response.json({ result })); });
}

describe("the Square card's spoken summary", () => {
  it("says all OK when every check passed", async () => {
    await runWith({ ref: "T-3M9P", linkId: null, linkOutcome: "not-run", ranAt: "2026-10-31T19:15:40.000Z", linkTested: false, overall: "ok", rows: rows(["ok", "ok", "ok", "ok"]) });
    expect(summaryLine().textContent).toBe("Square checks finished: all OK");
  });

  it("counts what needs attention", async () => {
    await runWith({ ref: "T-3M9P", linkId: null, linkOutcome: "not-run", ranAt: "2026-10-31T19:15:40.000Z", linkTested: false, overall: "attention", rows: rows(["ok", "ok", "attention", "attention"]) });
    expect(summaryLine().textContent).toBe("Square checks finished: 2 need attention");
  });
});
