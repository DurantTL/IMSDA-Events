import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Roster section headings (Staff, Members) stand out from the people rows in every layout. */
const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

describe("roster section heading highlight", () => {
  const start = css.lastIndexOf(".roster-section-row > th.roster-section-heading.roster-section-heading {");
  const rule = css.slice(start, css.indexOf("}", start));

  it("draws a tinted band with a navy edge", () => {
    expect(start).toBeGreaterThan(-1);
    expect(rule).toContain("box-shadow: inset 4px 0 0 var(--imsda-navy);");
    expect(rule).toMatch(/background: rgba\(0, 59, 92, 0\.\d+\);/);
  });

  it("outranks the card layouts that clear the heading's background", () => {
    // Card modes use `.roster-card-table.roster-card-table-wide .roster-section-heading` (0,3,0); this rule is (0,3,1) and comes last.
    expect(css.indexOf(".roster-card-table.roster-card-table-wide .roster-section-heading")).toBeLessThan(start);
    expect(css.lastIndexOf(".roster-card-table .roster-section-heading {")).toBeLessThan(start);
  });

  it("stays translucent so a scrolling table's edge cue shows through", () => {
    expect(rule).not.toMatch(/background: (#|var\()/);
  });
});
