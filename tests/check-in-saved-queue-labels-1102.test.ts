import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("saved-queue labels and screening guidance (#1102)", () => {
  const workspace = read("components/check-in-workspace.tsx");

  it("uses one queued label for a saved row and the queue list", () => {
    expect(workspace).not.toContain("Not saved — tap to retry");
    expect(workspace.match(/Queued — not confirmed/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workspace).toContain("Saved on this device");
  });

  it("reports guidance matching the #874 check-in gate", () => {
    const report = read("app/(workspace)/more/reports/page.tsx");
    expect(report).not.toContain("check-in aren&apos;t blocked");
    expect(report).toContain("Registration stays open");
    expect(report).toContain("can override with a recorded reason");
  });
});

describe("phone visibility and first-attempt wording (#1102 review)", () => {
  it("keeps the queue-state label visible on phones without changing the plain-time rule", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(".arrival-time { display: none; }");
    expect(css).toContain(".arrival-time.is-queue-state { display: block; }");
    expect(readFileSync("components/check-in-workspace.tsx", "utf8")).toContain("is-queue-state");
  });

  it("says Confirming on the first attempt and Retrying after a failure", () => {
    const src = readFileSync("components/check-in-workspace.tsx", "utf8");
    expect(src).toContain("attempts === 0 ? \"Confirming…\" : \"Retrying…\"");
    expect(src).toContain("retry automatically while online");
  });
});
