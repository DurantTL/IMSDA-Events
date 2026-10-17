import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #996: the phone audit gained rules for squeezed text, an action bar over text when a page opens, and the loading
 * screen, plus pages it had never visited. The audit itself needs a browser, so this pins that the rules, the pages and
 * their self-test defects stay in the script and that nothing was accepted or loosened to get them passing.
 */
const script = readFileSync(path.join(process.cwd(), "scripts/verify-mobile-layout.ts"), "utf8");

describe("the phone audit's #996 rules", () => {
  it("runs the new rules on every page and in every walked state, not behind the narrowing switch", () => {
    expect(script).toContain('record("squeezed-text", name, width, problem)');
    expect(script).toContain('record("bar-over-text", name, width, problem)');
    expect(script).toContain('record("loading-screen", name, width,');
    const calls = script.match(/await auditSqueezeAndBars\(page, /g) ?? [];
    expect(calls.length).toBe(2);
    expect(script.indexOf("await auditSqueezeAndBars(page, spec.name, width);")).toBeLessThan(script.indexOf("if (textRulesApply(spec.name)) {"));
  });

  it("waits out the shell's loading fallback before measuring a page", () => {
    expect(script).toContain("await waitForShell(page);");
    expect(script).toContain('document.querySelector(".shell-loading")');
  });

  it("visits the pages it never had, including the invalid-link states", () => {
    for (const route of ["/login", "/forgot-password", "/reset-password", "/profile/sign-in", "/recover-registration", "/calendar", "/clubs", "/select-event", "/archived-events"]) {
      expect(script, route).toContain(`path: "${route}"`);
    }
    for (const prefix of ["/manage/", "/unsubscribe/", "/staff-invite/"]) expect(script, prefix).toContain(`path: \`${prefix}\${P}-invalid-link-token`);
  });

  it("injects a defect for each new rule in the self-test", () => {
    for (const marker of ["self-test squeezed text", "Pathfinder Registration", "self-test bar action", "shell-loading"]) expect(script, marker).toContain(marker);
  });

  it("accepts no finding and keeps the existing thresholds", () => {
    expect(script).toContain("const acceptedFindings: Array<{ match: string; reason: string }> = [];");
    expect(script).toContain("const touchTarget = 44;");
    expect(script).toContain("const staffTextFloorPx = 14;");
  });
});
