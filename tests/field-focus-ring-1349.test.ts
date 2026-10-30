import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** One focus ring for every field (#1349): purple border plus one 2px ring, no halo. */

const css = readFileSync("app/globals.css", "utf8");

function moduleCss(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return moduleCss(path);
    return name.endsWith(".module.css") ? [path] : [];
  });
}

describe("field focus ring (#1349)", () => {
  it("has no purple halo box-shadow on any focus rule, in globals or CSS modules", () => {
    const sources = [css, ...[...moduleCss("app"), ...moduleCss("components")].map((f) => readFileSync(f, "utf8"))];
    const halos = sources.flatMap((source) => (source.match(/[^{}]*:focus[^{}]*\{[^}]*\}/g) ?? []).filter((rule) => /box-shadow:\s*0 0 0 \d+px rgba\(88, 44, 131/.test(rule)));
    expect(halos).toEqual([]);
  });

  it("sets the field border colour on focus only in the shared rule, so a per-form rule cannot beat the red invalid border", () => {
    const rules = css.match(/[^{}]*:focus(?:-within)?[^{}]*\{[^}]*\}/g) ?? [];
    const offenders = rules.filter((rule) => /border-color:\s*var\(--(field-focus|imsda-purple)\)/.test(rule) && /\b(input|select|textarea)\b|-input|-field|searchable-select/.test(rule.split("{")[0]) && !rule.trimStart().startsWith(":root:root:root"));
    // .field-select is a single attendee select with its own test (#1176).
    expect(offenders.map((r) => r.split("{")[0].trim()).filter((sel) => sel !== ".field-select:focus-visible")).toEqual([]);
  });

  it("draws one 2px field-focus ring on bare fields and wrapper boxes", () => {
    const shared = css.match(/:root:root:root :is\(input, select, textarea\)[^{]*:focus,\s*:root:root:root :is\([^)]*\.search-field[^)]*\):focus-within \{[^}]*\}/);
    expect(shared?.[0]).toMatch(/outline: 2px solid var\(--field-focus\);\s*outline-offset: 2px;/);
    expect(shared?.[0]).not.toContain("box-shadow");
  });

  it("keeps the red border on an invalid field that has focus", () => {
    const borderRule = css.match(/:root:root:root :is\([^{]*\):focus-within,\s*:root:root:root :is\(input, select, textarea\)[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(borderRule).toContain(':not([aria-invalid="true"], .public-registration-field-invalid *)');
    expect(css).toMatch(/:is\(input, select, textarea\)\[aria-invalid="true"\] \{ border-color: var\(--danger, #8f3a30\); box-shadow: 0 0 0 1px var\(--danger, #8f3a30\); \}/);
    expect(css).toMatch(/\.public-registration-field-invalid select,[^}]*border-color: var\(--coral\);/);
  });

  it("uses the gold ring on navy surfaces, including textareas and wrapper boxes", () => {
    expect(css).toMatch(/\.on-dark\)\s*:is\(input, select, textarea\)[^{]*:focus,[^{]*:focus-within \{\s*outline-color: var\(--focus-ring-on-dark\);/);
  });

  it("does not keep module copies of the field or link ring", () => {
    const monthly = readFileSync("components/coordinator-monthly-records.module.css", "utf8");
    const charts = readFileSync("components/club-report-charts.module.css", "utf8");
    expect(monthly).not.toContain("focus-visible");
    expect(charts).not.toContain("focus-visible");
    expect(css).toMatch(/a:focus-visible,\s*summary:focus-visible,/);
  });

  it("drops the halo token from the design system", () => {
    for (const file of ["tokens.css", "tokens.json", "README.md", "components/Field/README.md"]) {
      const text = readFileSync(`docs/design-system/${file}`, "utf8");
      expect(text).not.toContain("shadow-focus-halo");
      expect(text.toLowerCase()).not.toContain("soft halo");
    }
  });
});
