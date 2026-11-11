import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

// The script run for real against stub `npx`, `node` and `sudo`: apt (install-deps) always fails, as in an outage.
describe("CI Playwright browser setup during a mirror outage (#1872)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
  });

  function run(browsers: string[], { launches, downloads = true }: { launches: boolean; downloads?: boolean }) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pw-setup-1872-"));
    dirs.push(dir);
    const stub = (name: string, body: string) => {
      writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(path.join(dir, name), 0o755);
    };
    stub("npx", `if [ "$2" = "install-deps" ]; then echo "Temporary failure resolving 'azure.archive.ubuntu.com'"; exit 100; fi\nexit ${downloads ? 0 : 1}`);
    stub("node", `exit ${launches ? 0 : 1}`);
    stub("sudo", 'exec "$@"');
    return spawnSync("bash", [scriptPath, ...browsers], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        PLAYWRIGHT_SETUP_ATTEMPTS: "1",
        PLAYWRIGHT_SETUP_APT_CONF: path.join(dir, "apt.conf"),
      },
      timeout: 30_000,
    });
  }

  it("carries on with a warning when the browsers start with the runner's own libraries", () => {
    const result = run(["chromium"], { launches: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning title=Ubuntu package mirror unreachable::");
    expect(result.stdout).toContain("chromium starts with the runner image's own libraries.");
  });

  it("fails with a clear mirror message when a browser cannot start", () => {
    const result = run(["chromium", "webkit"], { launches: false });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error title=Ubuntu package mirror unreachable::");
    expect(result.stdout).toContain("chromium webkit cannot start");
  });

  it("fails with a download message when the browsers cannot be downloaded", () => {
    const result = run(["chromium"], { launches: true, downloads: false });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error title=Browser download failed::");
  });
});
