import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Coordinator workspace wrap-up (#1113): at 200% text on a phone, the coordinator's
 * card tables and the club's leaders list stay inside the page. The browser pass is
 * recorded in docs/design/role-workspaces/evidence/coordinator-implementation.md;
 * this pins the CSS that makes it so, and keeps it scoped and before the builder blocks.
 */
const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const start = css.indexOf("/* Coordinator pages at 200% text on a phone (#1113)");
const builder = css.indexOf("/* Registration form builder editor shell (#1132)");
// The block ends at the next top-level comment: other sections may also sit before the builder blocks.
const nextSection = css.indexOf("\n/* ", start + 1);
const block = css.slice(start, nextSection === -1 || nextSection > builder ? builder : nextSection);

describe("coordinator pages at 200% text (#1113)", () => {
  it("sits before the builder blocks, with no hover or small text", () => {
    expect(start).toBeGreaterThan(0);
    expect(builder).toBeGreaterThan(start);
    expect(block).not.toContain(":hover");
    expect(block).not.toMatch(/font-size/);
  });

  it("stacks card labels only in the coordinator's own tables, never in the Monthly Records grid", () => {
    expect(block).toMatch(/@container \(max-width: 15em\)/);
    const tableRules = block.split("\n").filter((line) => line.includes("table.table-cards"));
    expect(tableRules.length).toBeGreaterThan(0);
    for (const rule of tableRules) expect(rule).toContain(":is(.coordinator-overview, .coordinator-destination)");
    // The wrap is a size container through the shared table-box rule (#1457), so this block no longer declares it.
    expect(css).toContain(".reminder-recipient-table-wrap:has(> table.table-cards),");
  });

  it("puts an Open club button under its card label", () => {
    expect(block).toMatch(/td\[data-label\]:has\(> a\.secondary-button\) \{ padding-left: 0; \}/);
  });

  it("lets a long leader email wrap in a club's list", () => {
    expect(block).toContain(".public-manage-club-list { grid-template-columns: minmax(0, 1fr); }");
    expect(block).toMatch(/\.public-manage-club-list li > span:not\(\[class\]\) \{[^}]*overflow-wrap: anywhere/);
  });
});
