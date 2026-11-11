import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The club roster's Honors button is a 44px target at every width, with a mouse too (#1863). It was 36px outside the
 * touch block, so a desktop with a mouse drew it 41px tall.
 */
const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const audit = readFileSync(path.join(process.cwd(), "scripts/verify-mobile-layout.ts"), "utf8");

describe("roster Honors button target (#1863)", () => {
  it("has one top-level rule at 44px, outside any media block", () => {
    const rules = [...css.matchAll(/^([^{}\n]*\.roster-honors-button[^{}\n]*)\{([^}]*)\}/gm)];
    expect(rules).toHaveLength(1);
    const [, selector, body] = rules[0]!;
    expect(selector!.startsWith(" ")).toBe(false);
    expect(body).toMatch(/min-height: 44px/);
    expect(body).toMatch(/min-width: 44px/);
  });

  it("is never sized smaller anywhere else", () => {
    const sized = [...css.matchAll(/\.roster-honors-button[^{}]*\{[^}]*min-(?:height|width):\s*(\d+)px/g)].map((match) => Number(match[1]));
    for (const size of sized) expect(size).toBeGreaterThanOrEqual(44);
  });

  it("is measured by the mobile layout audit at every width", () => {
    expect(audit).toMatch(/const alwaysTouchTargets = \[[^\]]*"\.roster-honors-button"/);
    expect(audit).toContain("alwaysTargetsInPage, { selectors: alwaysTouchTargets");
  });
});
