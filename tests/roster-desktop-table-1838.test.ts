import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #1838: a desktop window with a mouse (1024px or wider) shows the club roster as a table in every browser. The shared cards switch
// at a 1100px box (table-cards-xwide), which the roster's box only reaches in a window about 1250px wide (1310px on the staff club
// page), so a laptop window that was not full width showed phone cards. Phones and tablets (touch, or under 1024px) keep the cards.
const css = readFileSync(path.join(process.cwd(), "components/club-roster-table.module.css"), "utf8");
const desktopQuery = "@media (hover: hover) and (pointer: fine) and (min-width: 1024px)";

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

describe("club roster on a desktop window (#1838)", () => {
  it("keeps the roster table on a desktop window with a mouse by dropping the card container", () => {
    const desktop = block(css, desktopQuery);
    expect(desktop).toContain('.rosterTableWrap:global(.report-table-wrap):has(> :global(table.table-cards[data-cards="touch"])) { container: none; }');
  });

  it("marks the roster table, and the mobile layout audit exempts only that marker on a desktop window", () => {
    const workspace = readFileSync(path.join(process.cwd(), "components/club-roster-workspace.tsx"), "utf8");
    expect(workspace).toContain('className="report-table table-cards table-cards-xwide roster-card-table" data-cards="touch"');
    const audit = readFileSync(path.join(process.cwd(), "scripts/verify-mobile-layout.ts"), "utf8");
    expect(audit).toContain('table.getAttribute("data-cards") === "touch" && matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)").matches');
  });

  it("gives the desktop table the same tightened columns and stacked actions as a wide box", () => {
    const desktop = block(css, desktopQuery);
    const wide = block(css, "@container table-box (min-width: 1101px)");
    const rules = (text: string) => text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith(":global(.roster-card-table)"));
    expect(rules(wide).length).toBeGreaterThan(0);
    expect(rules(desktop)).toEqual(rules(wide));
  });

  it("still lets the roster wrap scroll sideways rather than spill out of its card", () => {
    expect(css).toMatch(/\.rosterTableWrap:global\(\.report-table-wrap\):has\(> :global\(table\.table-cards\)\) \{ overflow-x: auto;/);
  });
});
