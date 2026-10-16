import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Issue #981: the mobile layout audit's text and form rules (heading-style, label-input, focus-ring-overlap, text-overlap,
// disabled-contrast) run on every page. Vitest has no layout engine, so these guard the default and the source patterns the
// findings were fixed with; the rendered check is scripts/verify-mobile-layout.ts.
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");
const audit = read("scripts/verify-mobile-layout.ts");

describe("text rules run on every page (#981)", () => {
  it("applies the text rules to every page by default and only narrows them on request", () => {
    expect(audit).toMatch(/const textRulesOnlyPbe = process\.env\.MOBILE_LAYOUT_TEXT_RULES === "pbe";/);
    expect(audit).toMatch(/function textRulesApply\(pageName: string\) \{\s*return !textRulesOnlyPbe \|\| \/\^\(staff-\)\?pbe-\/\.test\(pageName\);/);
    expect(audit).not.toContain("textRulesEverywhere");
  });

  it("is not narrowed in the workflow", () => {
    expect(read(".github/workflows/mobile-layout.yml")).not.toContain("MOBILE_LAYOUT_TEXT_RULES");
  });

  it("puts every issued-assets form and panel on the shared form-stack pattern", () => {
    for (const file of ["issued-assets-workspace", "asset-issue-desk", "asset-return-panel", "asset-closeout-workspace"]) {
      const source = read(`components/${file}.tsx`);
      expect(source.match(/<form onSubmit/g) ?? [], `${file} has a form without a class`).toHaveLength(0);
      expect(source.match(/<(section|article) className="panel"/g) ?? [], `${file} has a panel without form-stack`).toHaveLength(0);
      expect(source).toContain("form-stack");
    }
  });

  it("styles the small headings the audit found unstyled", () => {
    expect(read("app/(workspace)/admin/system-admin.module.css")).toMatch(/\.taskGroup h2 \{[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.event-packet-sheet section h2 \{[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.public-manage-help-card h2 \{[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.panel h2,\s*\.section-head h1 \{\s*margin: 0;/);
  });

  it("keeps disabled builder buttons at 3:1 instead of fading them", () => {
    expect(css).toMatch(/\.drag-handle:disabled \{[^}]*opacity: 1;/);
    expect(css).not.toMatch(/\.field-actions button:disabled \{[^}]*opacity: 0\.35/);
  });

  it("keeps the builder field list from growing wider than its box", () => {
    expect(css).toMatch(/\.builder-fields \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("gives the phone sort fields the filter-bar label layout and headings room above focus rings", () => {
    expect(css).toMatch(/\.filter-bar > \.attendee-sort-phone > label,\s*\.filter-bar > \.field-row \{/);
    expect(css).toMatch(/:is\(h2, h3, h4\) \+ :is\(\.filter-bar, \.form-stack, \.field-row\) \{ margin-top: 10px; \}/);
    expect(css).toMatch(/\.profile-readonly-field > \.field-help \{ margin-top: 8px; \}/);
    expect(read("components/background-check-review-panel.tsx")).toContain('<form className="filter-bar background-check-lookup-form" onSubmit={(event) => void runLookup(event)}>');
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/exports/class-tracking/page.tsx")).toContain('className="report-actions filter-bar"');
  });
});
