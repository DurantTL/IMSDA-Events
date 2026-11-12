import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

/**
 * #1894 part 2: on a phone the roster's search and filter controls are one bottom sheet opened by a
 * "Search and filters" button next to Add to roster. One set of controls: the same elements sit in the page on a computer.
 * Rendered without a DOM, so these check the first (server) markup and the source. Synthetic data only.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const source = read("components/club-roster-workspace.tsx");
const css = read("components/club-roster-sections.module.css");

function member(id: string): RosterMemberRecord {
  return {
    id, firstName: "Sam", lastName: `Fixture-${id}`, attendeeType: "YOUTH", role: "Pathfinder", classLevel: "FRIEND", gender: "FEMALE",
    status: "ACTIVE", source: "DIRECTOR", age: 12, reportedAge: null, birthDateNeeded: false, updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
  } as RosterMemberRecord;
}
const html = () => renderToStaticMarkup(createElement(ClubRosterWorkspace, {
  canSeeBirthDates: true, clubYear: "2026-27", initialMembers: [member("a"), member("b")], organizationId: "org-1",
}));

describe("roster Search and filters sheet (#1894)", () => {
  it("puts the button in the heading row right after Add to roster, with no count when nothing is on", () => {
    const out = html();
    const add = out.indexOf("Add to roster");
    const trigger = out.indexOf("data-roster-sheet-trigger");
    expect(add).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(add);
    expect(out).toMatch(/aria-haspopup="dialog"[^>]*data-roster-sheet-trigger=""[^>]*>.*?Search and filters<\/button>/);
    expect(out).not.toContain("Search and filters ·");
  });

  it("renders every control once, inline in the first render, in the sheet's order", () => {
    const out = html();
    const order = ["roster-search", "Details needed", "Show gender", "Show baptized", "roster-grade-filter", "Show inactive people", "roster-sort-menu", "Show birth dates", "Show 2 people"];
    let at = -1;
    for (const needle of order) {
      const next = out.indexOf(needle, at + 1);
      expect(next, needle).toBeGreaterThan(at);
      at = next;
    }
    expect(out.match(/id="roster-search"/g)).toHaveLength(1);
    expect(out.match(/id="roster-grade-filter"/g)).toHaveLength(1);
    // The server render is the computer layout: no dialog role until the sheet is opened on a phone.
    expect(out).not.toContain('role="dialog"');
    expect(out).toContain("Search and filters</h2>");
  });

  it("keeps the result line on the page for the phone, and the one result id on the panel until a phone is known", () => {
    const out = html();
    expect(out.match(/id="roster-result-text"/g)).toHaveLength(1);
    // Page summary, panel line, and the screen-reader line.
    expect(out.match(/Showing 1–2 of 2 people/g)).toHaveLength(3);
  });

  it("makes the sheet a labelled modal dialog with the shared hook, a Close button and focus back to the trigger", () => {
    expect(source).toContain('useAccessibleDialog<HTMLDivElement>(sheetModal, closeSheet');
    expect(source).toContain("returnFocus: () => sheetTrigger.current");
    expect(source).toContain('role={sheetModal ? "dialog" : undefined}');
    expect(source).toContain('aria-modal={sheetModal ? true : undefined}');
    expect(source).toContain('aria-labelledby={sheetModal ? "roster-sheet-title" : undefined}');
    expect(source).toContain('aria-label="Close"');
    expect(source).toContain("modal-backdrop");
  });

  it("counts the filters and toggles that are on", () => {
    expect(source).toContain("`Search and filters · ${sheetCount}`");
    for (const flag of ["query.trim() !== \"\"", "detailsOnly", "complianceFilterOn", "gradeFilter !== \"\"", "showInactive", "showGender", "showBaptized", "Boolean(birthDates)"]) {
      expect(source).toContain(flag);
    }
  });

  it("sorts from the sheet through the same address sort the table headers use", () => {
    expect(source).toContain("rosterSort.toggle(event.target.value as RosterSortColumn)");
    expect(source).toContain('rosterSort.toggle(activeSort.key, activeSort.dir === "asc" ? "desc" : "asc")');
  });

  it("hides the trigger and sheet-only parts on a computer, and the Sort by chips on a phone, in the module", () => {
    expect(css).toMatch(/button\.sheetTrigger \{ display: none; \}/);
    expect(css).toMatch(/\.sheetInline, \.sheetInlineCard \{ display: contents; \}/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.sheetInline \{ display: none; \}/);
    expect(css).toContain(":has(:global(.table-sort-button))");
  });
});
