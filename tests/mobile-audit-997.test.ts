import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #997: the wide-table audit rule and the layout patterns it holds. The browser audit itself is `npm run test:mobile-layout`;
 * these keep its rule, its self-test defects and the shared CSS from being dropped by accident.
 */
const root = process.cwd();
const script = readFileSync(path.join(root, "scripts/verify-mobile-layout.ts"), "utf8");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");

describe("#997 wide-table audit rule (no table scrolls sideways, #1457)", () => {
  it("records table-wider-than-box and table-scrolls-sideways on every page at every width", () => {
    expect(script).toContain('record("table-wider-than-box", spec.name, width, problem)');
    expect(script).toContain('record("table-scrolls-sideways", spec.name, width, table)');
    // No width gate: the scrolling check used to run only at card widths and the wide check only above them.
    expect(script).not.toContain("if (!args.cards) {");
    expect(script).not.toContain("if (args.cards) {");
  });

  it("lets no table scroll, with or without a scroll cue", () => {
    expect(script).not.toContain('box.hasAttribute("data-scroll-cue")');
    expect(script).not.toContain("paint a solid background over the scroll cue");
    expect(script).toContain("the box clips it, so the columns past the edge cannot be reached");
    expect(script).toContain("with no scroll-cue exemption");
  });

  it("checks that a table-cards table sits in a table-box container", () => {
    expect(script).toContain('record("table-cards-no-box", spec.name, width, problem)');
  });

  it("injects defects for the rules in the self-test, including a scrolling table that claims a scroll cue", () => {
    for (const marker of ["self-test clipped wide table", "self-test scrolling table with a cue", "wide cell"]) expect(script, marker).toContain(marker);
  });

  it("still accepts no finding", () => {
    expect(script).toContain("const acceptedFindings: Array<{ match: string; reason: string }> = [];");
  });
});

describe("#997 shared layout CSS", () => {
  it("has no scroll-cue shadow any more: a table that does not fit is cards", () => {
    expect(css).not.toContain("  .scroll-cue {");
  });

  it("lets the staff column fill the room beside the sidebar, up to a maximum", () => {
    expect(css).toContain(".workspace-content { max-width: 1600px; }");
    // The sidebar keeps its width; tables decide cards or scroll by their own box (a container query), not the viewport.
    expect(css).not.toContain("--sidebar-width: 224px");
    expect(css).toContain(".card-box { container: table-box / inline-size; }");
    expect(css).toContain("@container table-box (min-width: 601px) and (max-width: 760px)");
  });

  it("has one copy of the tab-strip and long-name CSS, and does not clip a card-box that shows cards", () => {
    expect(css.split("/* Tab strips that scroll (#997)")).toHaveLength(2);
    expect(css.split("/* A long club name (#997)")).toHaveLength(2);
    expect(css).toContain(".card-box:has(> table.table-cards) { overflow: visible; }");
  });



  it("keeps ordinary words whole in cards: break-word, with anywhere only for emails and codes", () => {
    expect(css).toContain('.break-anywhere.break-anywhere, table td :is(code, a[href^="mailto:"], .team-email) { overflow-wrap: anywhere; }');
  });

  it("keeps the tighter tablet page padding on screen only, so it cannot undo the print rule's zero padding", () => {
    // A print page is about 816px wide, inside 801-1180px: unscoped, the 20px padding widened the badge sheet and
    // Chrome shrank the PDF to 97.6% (Badge print check).
    expect(css).toMatch(/@media screen and \(min-width: 801px\) and \(max-width: 1180px\) \{\s*\.workspace \{ padding-inline: 20px; \}/);
    expect(css).not.toMatch(/@media \(min-width: 801px\) and \(max-width: 1180px\) \{\s*\.workspace \{ padding-inline/);
  });
});
