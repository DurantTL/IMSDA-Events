import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #1838 part 2: the phone and tablet roster card. Name first, then Type and Current class, then what needs attention (Details
// chips, Sterling Volunteers), then the less-used facts in a compact grid, then Edit and Actions side by side. Layout only: the
// cells, column headers and what each viewer sees are the table's.
const root = process.cwd();
const css = readFileSync(path.join(root, "components/club-roster-table.module.css"), "utf8");
const workspace = readFileSync(path.join(root, "components/club-roster-workspace.tsx"), "utf8");
const cardQuery = "@container table-box (max-width: 1100px)";

function block(source: string, opener: string) {
  const start = source.indexOf(opener);
  expect(start, `${opener} is missing`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${opener} is not closed`);
}

describe("club roster phone cards (#1838)", () => {
  const cards = block(css, cardQuery);

  it("lays each card out as a grid that fits two columns on a phone and more on a tablet", () => {
    expect(cards).toMatch(/> tbody > tr \{\s*display: grid; grid-template-columns: repeat\(auto-fill, minmax\(8\.5rem, 1fr\)\);/);
  });

  it("orders the card: Type and class, then status, then the other facts, then the actions", () => {
    expect(cards).toMatch(/td\.cardPrimary \{\s*order: 1;/);
    expect(cards).toMatch(/td\.cardStatus \{ order: 2; grid-column: 1 \/ -1; \}/);
    expect(cards).toMatch(/td\.cardFact \{\s*order: 3;/);
    expect(cards).toMatch(/td:not\(\[data-label\]\) \{ order: 4; grid-column: 1 \/ -1;/);
  });

  it("tags each roster cell with its card group", () => {
    for (const label of ["Type", "Current class"]) expect(workspace).toContain(`<td {...cardCell("${label}")} className={tableStyles.cardPrimary}`);
    for (const label of ['"Age"', '"Birth date"', '"Grade"', '"School"', "CHURCH_MEMBER_LABEL", '"Gender"']) {
      expect(workspace).toContain(`<td {...cardCell(${label})} className={tableStyles.cardFact}`);
    }
    expect(workspace).toMatch(/cardCell\("Details"\)\} className=\{`roster-card-flags \$\{tableStyles\.cardStatus\}/);
    expect(workspace).toMatch(/cardCell\("Sterling Volunteers"\)\} className=\{`\$\{tableStyles\.cardStatus\}/);
  });

  it("gives an empty status cell no room on the card but keeps its text for screen readers", () => {
    expect(cards).toContain("td.cardStatus.cardNothing { block-size: 0; padding: 0; overflow: hidden; }");
    expect(cards).not.toMatch(/td\.cardStatus\.cardNothing \{[^}]*display: none/);
  });

  it("keeps 44px targets: Class history on a card, and Edit and Actions side by side", () => {
    expect(cards).toMatch(/roster-class-history-link\) \{\s*display: inline-flex; align-items: center; min-height: 44px;/);
    expect(cards).toContain(":global(.roster-row-action-set) > :is(button, a) { flex: 1 1 0;");
    expect(cards).toContain(":global(.roster-row-action-set) > :global(.actions-menu) { flex: 1 1 0; }");
  });

  it("raises the card rules above the shared card rules with the roster wrap, so no other table changes", () => {
    const selectors = cards.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("."));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) expect(selector.startsWith(".rosterTableWrap :global(table.table-cards-xwide.roster-card-table)")).toBe(true);
  });
});
