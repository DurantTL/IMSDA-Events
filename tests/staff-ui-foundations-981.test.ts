import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Issue #981 batch 1. Vitest has no layout engine, so these guard the stylesheet and the audit script;
// the rendered check is scripts/verify-mobile-layout.ts (text floor, overlapping text, cramped headers).
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");
const audit = read("scripts/verify-mobile-layout.ts");

describe("staff UI foundations (#981 batch 1)", () => {
  it("raises the meta floor to 14px on the staff workspace only, keeping a 12px floor for uppercase labels", () => {
    expect(css).toMatch(/@media screen \{\s*\.app-shell \{\s*--type-floor: 0\.875rem;\s*--type-label-floor: 0\.75rem;\s*\/\*[^*]*\*\/\s*--type-staff-floor: 0\.875rem;/);
    // The :root floors stay as they were (club, account and public pages keep 12px meta text).
    expect(css).toMatch(/@media screen \{\s*:root \{\s*--type-floor: 0\.75rem;\s*--type-body-floor: 0\.875rem;/);
  });

  it("never breaks a table header inside a word", () => {
    expect(css).toMatch(/\.report-table thead th,[^{]*\{\s*overflow-wrap: normal;\s*word-break: normal;/);
  });

  it("gives stacked meta lines a gap and a line height of at least 1.4", () => {
    expect(css).toMatch(/\.meta-stack \{ display: grid; gap: 4px;/);
    expect(css).toMatch(/\.meta-stack > \* \{ margin: 0; line-height: 1\.45; \}/);
    expect(css).toMatch(/\n\.app-shell \.field-help \{ margin: 0; line-height: 1\.45; \}/);
  });

  it("puts icons in an eyebrow inline with its label", () => {
    expect(css).toMatch(/\.app-shell \.eyebrow > svg,\s*\.app-shell \.hero-eyebrow > svg \{\s*display: inline-block;/);
  });

  it("shows Total, Received and Balance as labelled values on a finance card at phone width", () => {
    expect(css).toMatch(/\.finance-row\.finance-row-cards > span\[data-label\]::before \{\s*content: attr\(data-label\);/);
    const finance = read("components/finance-workspace.tsx");
    for (const label of ["Total", "Received", "Balance"]) expect(finance).toContain(`data-label="${label}"`);
  });

  it("does not let the colour, file, checkbox and radio rules reach visually hidden inputs", () => {
    expect(css).toContain('input[type="file"]:not(.sr-only, .visually-hidden) {');
    expect(css).toContain('.app-shell input[type="color"]:not(.sr-only, .visually-hidden) {');
  });

  it("declares the staff and label floors only on .app-shell, so club, account and public pages keep 12px meta text", () => {
    for (const token of ["--type-staff-floor", "--type-label-floor"]) {
      const declarations = [...css.matchAll(new RegExp(`${token}:\\s*[^;]+;`, "g"))];
      expect(declarations, token).toHaveLength(1);
      const before = css.slice(0, declarations[0].index);
      expect(before.slice(before.lastIndexOf("{") - 40, before.lastIndexOf("{")), token).toContain(".app-shell");
    }
  });

  it("keeps print's overflow: visible on report wrappers (nothing after the print block makes them scroll)", () => {
    const print = css.indexOf(".report-table-wrap { overflow: visible; }");
    expect(print).toBeGreaterThan(0);
    const after = css.slice(print + 1);
    expect(after.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/(^|\})\s*\.report-table-wrap\b[^{}]*\{[^{}]*overflow(-x)?:\s*(auto|scroll)/);
    // (Only .report-table-wrap is overridden for print; .table-wrap and .table-scroll keep their own older rules.)
  });

  it("lets an event-settings error message keep its colour and weight over the help-text rule", () => {
    expect(css).toContain(".app-shell .form-stack label > small:not(.field-error-message)");
    expect(css).toMatch(/\.event-settings-panel label > small\.field-error-message \{ color: var\(--danger, #8f3a30\);[^}]*font-weight: 700;/);
  });

  it("leaves classed toggles alone and sizes checkboxes only above 768px, where the phone block does not", () => {
    // Only an unclassed label, or .checkbox-label, gets the shared row; .event-setting-toggle and
    // .public-registration-check keep their own alignment and 3px input margin.
    expect(css).toContain('label:not([class]) > input:is([type="checkbox"], [type="radio"])');
    expect(css).not.toMatch(/\.app-shell :is\([^)]*\) input\[type="checkbox"\]/);
    const wide = css.match(/@media screen and \(min-width: 769px\) \{\s*\.app-shell :is\(\.filter-bar[^}]*\{[^}]*width: 1\.125rem;/);
    expect(wide).not.toBeNull();
    expect(css).toMatch(/@media screen and \(max-width: 768px\) \{\s*:root \{ --check-row-height: var\(--touch-target, 44px\); \}/);
  });

  it("keeps help text inside a label flush with its control: the in-label zero margin out-scores the pull-up", () => {
    // Specificity as [ids, classes/attributes/pseudo-classes, types]; :where() counts 0, :is() and :not() their largest argument.
    const specificity = (selector: string): [number, number, number] => {
      let s = selector.replace(/\[[^\]]*\]/g, ".a");
      const total: [number, number, number] = [0, 0, 0];
      const add = (part: [number, number, number]) => { total[0] += part[0]; total[1] += part[1]; total[2] += part[2]; };
      for (let match = s.match(/:(where|is|not|has)\(([^()]*)\)/); match; match = s.match(/:(where|is|not|has)\(([^()]*)\)/)) {
        if (match[1] !== "where") {
          const args = match[2].split(",").map((arg) => specificity(arg.trim()));
          args.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
          add(args[args.length - 1]);
        }
        s = s.replace(match[0], "");
      }
      total[0] += (s.match(/#[\w-]+/g) ?? []).length;
      total[1] += (s.match(/\.[\w-]+/g) ?? []).length + (s.match(/:(?!:)[\w-]+/g) ?? []).length;
      total[2] += (s.replace(/[.#:][\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
      return total;
    };
    const beats = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const pull = ".app-shell :where(input, select, textarea, .select-shell) + .field-help";
    const inLabel = ".form-stack label > .field-help";
    expect(css).toContain(`${pull},`);
    expect(css).toContain(`${inLabel}, .form-grid > label > .field-help { margin: 0; }`);
    expect(specificity(pull)).toEqual([0, 2, 0]);
    expect(beats(specificity(inLabel), specificity(pull))).toBeGreaterThan(0);
    // The old :is() form scored (0,3,0) and beat the in-label rule.
    expect(beats(specificity(".app-shell :is(input, select, textarea, .select-shell) + .field-help"), specificity(inLabel))).toBeGreaterThan(0);
  });

  it("gives .checkbox-row the same row and box rules as .checkbox-label", () => {
    expect(css).toContain(".app-shell :is(.checkbox-label, .checkbox-row) > input:is([type=\"checkbox\"], [type=\"radio\"])");
    expect(css).toContain(".app-shell .checkbox-row { display: flex;");
  });

  it("scopes the field-help margin model and the header no-break rule to the staff workspace", () => {
    expect(css).not.toMatch(/\n\.field-help \{ margin: 0;/);
    expect(css).not.toMatch(/\n\.report-table thead th,\s*\n\.table-scroll/);
    expect(css).toContain(".app-shell .report-table thead th,");
  });

  it("uses .meta-stack where stacked meta lines were touching", () => {
    expect(read("components/check-in-workspace.tsx")).toContain('className="meta-stack"');
    expect(read("components/finance-workspace.tsx")).toContain('className="meta-stack"');
  });

  it("audits the new rules on the pages the issue names", () => {
    for (const kind of ["text-too-small", "header-too-narrow"]) expect(audit).toContain(`"${kind}"`);
    for (const route of ["/people/attendees", "/finance\"", "/check-in/badges", "/admin/calendar", "/more/lodging\"", "/more/honors\"", "/more/tags", "/admin/settings"]) {
      expect(audit, route).toContain(`"${route.replace(/\\"$/, "").replace(/"$/, "")}"`);
    }
    // Every exception to the text floor carries its reason.
    expect(audit).toMatch(/selector: "\.badge-sheet", reason: "[^"]{20,}"/);
  });
});
