import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #1872: every workflow installs Playwright browsers through one shared script that survives an Ubuntu mirror outage.
const workflowsDir = path.join(process.cwd(), ".github/workflows");
const scriptPath = path.join(process.cwd(), "scripts/ci/install-playwright-browsers.sh");
const workflows = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({ name, text: readFileSync(path.join(workflowsDir, name), "utf8") }));

describe("CI Playwright browser setup (#1872)", () => {
  it("never calls `playwright install` directly in a workflow", () => {
    const direct = workflows.filter(({ text }) => /playwright install/.test(text)).map(({ name }) => name);
    expect(direct).toEqual([]);
  });

  it("uses the shared script wherever Playwright browsers are installed", () => {
    const users = workflows.filter(({ text }) => text.includes("scripts/ci/install-playwright-browsers.sh"));
    expect(users.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining(["browser-privacy.yml", "browser-translation.yml", "ci.yml"]),
    );
  });

  it("is executable, retries apt with time limits, and fails with a clear mirror message", () => {
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("npx playwright install-deps");
    expect(script).toContain("timeout --kill-after=30");
    expect(script).toContain('Acquire::Retries "3";');
    expect(script).toContain("Ubuntu package mirror unreachable");
    // The fallback proves each browser starts instead of skipping anything.
    expect(script).toContain('require("playwright")[name].launch()');
  });
});
