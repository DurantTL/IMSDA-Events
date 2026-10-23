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
