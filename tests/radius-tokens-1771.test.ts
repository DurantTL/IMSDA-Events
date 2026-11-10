import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** #1771: radii named by job, as aliases of today's values. Source scans only. */
const css = readFileSync("app/globals.css", "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const tokens = JSON.parse(readFileSync("docs/design-system/tokens.json", "utf8")) as { radius: { tokens: { name: string; value: string; usage: string }[] } };
const designCss = readFileSync("docs/design-system/tokens.css", "utf8");
const designValue = (name: string) => tokens.radius.tokens.find((token) => token.name === name)?.value;
const rule = (selector: string) => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:,[^{]*)? \\{([^}]*)\\}`));
  return match?.[1] ?? "";
};

describe("radius tokens by job (#1771)", () => {
  it("defines the four tokens as aliases of the older values", () => {
    expect(root).toMatch(/--radius-element:\s*var\(--field-radius\);/);
    expect(root).toMatch(/--field-radius:\s*10px;/);
    expect(root).toMatch(/--radius-container:\s*var\(--radius-card\);/);
    expect(root).toMatch(/--radius-overlay:\s*var\(--radius-modal\);/);
    expect(root).toMatch(/--radius-pill:\s*999px;/);
    expect(root).toMatch(/--radius-card:\s*12px;/);
    expect(root).toMatch(/--radius-modal:\s*20px;/);
  });

  it("lists them in tokens.json and tokens.css with the same values and a usage note", () => {
    expect(designValue("radius-element")).toBe(designValue("radius-field"));
    expect(designValue("radius-container")).toBe(designValue("radius-card"));
    expect(designValue("radius-overlay")).toBe(designValue("radius-modal"));
    for (const name of ["radius-element", "radius-container", "radius-overlay", "radius-pill"]) {
      expect(tokens.radius.tokens.find((token) => token.name === name)?.usage.length).toBeGreaterThan(5);
      expect(designCss).toContain(`--${name}: ${designValue(name)};`);
    }
  });

  it("uses them in the shared button, field, notice, dialog and chip rules", () => {
    expect(css).toMatch(/:where\(\.app-shell[^)]*\)\s*:where\(input:not[\s\S]*?\{[^}]*border-radius: var\(--radius-element\)/);
    expect(rule(".primary-button")).toContain("border-radius: var(--radius-element)");
    expect(rule(".filter-field")).toContain("border-radius: var(--radius-element)");
    expect(rule(".review-badge")).toContain("border-radius: var(--radius-pill)");
    expect(rule(".inline-notice")).toContain("border-radius: var(--radius-container)");
    expect(rule(".modal-card")).toContain("border-radius: var(--radius-overlay)");
  });
});
