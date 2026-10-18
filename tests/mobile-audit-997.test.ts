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

describe("#997 wide-table audit rule", () => {
  it("records table-wider-than-box on every page at the widths where tables stay tables", () => {
    expect(script).toContain('record("table-wider-than-box", spec.name, width, problem)');
    expect(script).toContain("if (!args.cards) {");
  });

  it("lets a table scroll only with an opted-in box that draws a gradient edge cue", () => {
    expect(script).toContain('box.hasAttribute("data-scroll-cue")');
    expect(script).toContain('style.backgroundImage.includes("gradient")');
    expect(script).toContain('box.classList.contains("scroll-cue")');
    expect(script).toContain("paint a solid background over the scroll cue");
    expect(script).toContain("the box clips it, so the columns past the edge cannot be reached");
  });

  it("injects a defect for the rule in the self-test", () => {
    for (const marker of ["self-test clipped wide table", "self-test cue claimed, none drawn"]) expect(script, marker).toContain(marker);
  });

  it("still accepts no finding", () => {
    expect(script).toContain("const acceptedFindings: Array<{ match: string; reason: string }> = [];");
  });
});

describe("#997 shared layout CSS", () => {
  it("draws a gradient scroll cue for .scroll-cue", () => {
    const block = css.slice(css.indexOf("  .scroll-cue {"));
    expect(block.slice(0, 900)).toContain("linear-gradient");
  });

  it("lets the staff column fill the room beside the sidebar, up to a maximum", () => {
    expect(css).toContain(".workspace-content { max-width: 1600px; }");
    // The sidebar keeps its width; tables decide cards or scroll by their own box (a container query), not the viewport.
    expect(css).not.toContain("--sidebar-width: 224px");
    expect(css).toContain(".card-box { container-type: inline-size; }");
    expect(css).toContain("@container (max-width: 760px)");
  });

  it("has one copy of the tab-strip and long-name CSS, and does not clip a card-box that shows cards", () => {
    expect(css.split("/* Tab strips that scroll (#997)")).toHaveLength(2);
    expect(css.split("/* A long club name (#997)")).toHaveLength(2);
    expect(css).toContain(".card-box:has(> table:is(.table-cards-tablet, .table-cards-compact)) { overflow: visible; }");
  });

  it("checks rows, row groups and footers for a solid background over the scroll cue", () => {
    expect(script).toContain("tfoot > tr > *");
    expect(script).toContain("thead tr");
  });

  it("keeps ordinary words whole in cards: break-word, with anywhere only for emails and codes", () => {
    expect(css).toContain('.break-anywhere.break-anywhere, table td :is(code, a[href^="mailto:"], .team-email) { overflow-wrap: anywhere; }');
  });
});
