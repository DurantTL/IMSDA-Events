import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { zodJitlessInitScript } from "../modules/security/zod-jitless";

// #1401: without this, Zod's `new Function` probe is reported as a CSP violation on every page.
describe("Zod jitless init script (#1401)", () => {
  it("sets jitless on Zod's global config, keeping any existing settings", () => {
    const sandbox: { globalThis?: unknown; __zod_globalConfig?: Record<string, unknown> } = {};
    sandbox.globalThis = sandbox;
    runInNewContext(zodJitlessInitScript, sandbox);
    expect(sandbox.__zod_globalConfig).toEqual({ jitless: true });

    const existing = { __zod_globalConfig: { customError: "kept" } as Record<string, unknown>, globalThis: undefined as unknown };
    existing.globalThis = existing;
    runInNewContext(zodJitlessInitScript, existing);
    expect(existing.__zod_globalConfig).toEqual({ customError: "kept", jitless: true });
  });

  it("runs first in the root layout's nonce'd head script", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/<script nonce=\{nonce\}[^>]*__html: zodJitlessInitScript \+ sidebarCollapseInitScript/);
  });

  it("matches the global name Zod reads", () => {
    const core = readFileSync("node_modules/zod/v4/core/core.js", "utf8");
    expect(core).toContain("globalThis.__zod_globalConfig");
    expect(readFileSync("node_modules/zod/v4/core/util.js", "utf8")).toMatch(/if \(globalConfig\.jitless\) \{\s*return false;/);
  });
});
