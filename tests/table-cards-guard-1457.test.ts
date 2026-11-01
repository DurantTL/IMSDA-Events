import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule B3 (SITE-RULES, #1457): on a phone every table turns into cards the same way. This is the guard test: a source scan that
 * fails on a new `<table` in `app/` or `components/` that does not carry the shared `table-cards` class, unless its file is on the
 * allow-list below with a reason. The count per file is exact, so a second table in an allow-listed file fails too, and an entry
 * whose tables moved to table-cards must be deleted. The browser side is the mobile layout audit
 * (`table-scrolls-sideways` at every width, `table-cards-no-box`).
 */
const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const relative = `${dir}/${name}`;
    if (statSync(path.join(root, relative)).isDirectory()) return sourceFiles(relative);
    return relative.endsWith(".tsx") ? [relative] : [];
  });
}

/** The opening tag of every `<table` in a file, from `<table` to its closing `>`. */
function tableTags(file: string) {
  const source = readFileSync(path.join(root, file), "utf8");
  return Array.from(source.matchAll(/<table\b/g), (match) => source.slice(match.index, source.indexOf(">", match.index)));
}

const printed = "A printed sheet: its layout is the paper, not a phone screen.";
const ownCards = "Has its own card layout (#1045), switched by the box's width; move it onto table-cards in a follow-up.";
const fits = "Not moved to table-cards yet. It fits its box at every audited width (the audit's table-scrolls-sideways rule fails it if it stops fitting); convert it when it gains a column or fails the audit.";

/** file -> how many of its tables may lack table-cards, and why. */
const allowList: Record<string, { tables: number; reason: string }> = {
  "app/(public)/account/(portal)/clubs/[organizationId]/orders/print/page.tsx": { tables: 1, reason: printed },
  "components/check-in-book.tsx": { tables: 1, reason: printed },
  "components/emergency-reference-sheet.tsx": { tables: 1, reason: printed },
  "components/honors-print-report.tsx": { tables: 2, reason: printed },
  "components/event-health-sheet.tsx": { tables: 1, reason: printed },
  "components/staff-approval-queue.tsx": { tables: 1, reason: ownCards },
  "components/staff-invitation-list.tsx": { tables: 1, reason: ownCards },
  "components/staff-monthly-records.tsx": { tables: 1, reason: "Has its own two-line row layout (#1298), switched by the card's width; move it onto table-cards in a follow-up." },
  "app/(public)/account/(portal)/area/[organizationId]/forms/page.tsx": { tables: 1, reason: fits },
  "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/schedule/page.tsx": { tables: 1, reason: fits },
  "app/(workspace)/more/club-forms/page.tsx": { tables: 1, reason: fits },
  "app/(workspace)/more/honors/rosters/page.tsx": { tables: 4, reason: fits },
  "app/(workspace)/more/kitchen-report/scanner-import/page.tsx": { tables: 1, reason: fits },
  "app/(workspace)/more/program-assignments/[runId]/page.tsx": { tables: 1, reason: fits },
  "components/background-check-flags.tsx": { tables: 1, reason: fits },
  "components/background-check-import.tsx": { tables: 1, reason: fits },
  "components/background-check-review-panel.tsx": { tables: 7, reason: fits },
  "components/club-assignments-workspace.tsx": { tables: 2, reason: fits },
  "components/club-form-submission-view.tsx": { tables: 1, reason: fits },
  "components/club-forms-lists.tsx": { tables: 2, reason: fits },
  "components/club-guardians-panel.tsx": { tables: 1, reason: fits },
  "components/club-import-workspace.tsx": { tables: 2, reason: fits },
  "components/club-report-charts.tsx": { tables: 3, reason: fits },
  "components/club-supply-catalog-workspace.tsx": { tables: 1, reason: fits },
  "components/communications-workspace.tsx": { tables: 2, reason: fits },
  "components/csv-import-dialog.tsx": { tables: 1, reason: fits },
  "components/director-sterling-followup.tsx": { tables: 1, reason: fits },
  "components/eadventist-import-workspace.tsx": { tables: 1, reason: fits },
  "components/honors-setup-workspace.tsx": { tables: 1, reason: fits },
  "components/instructor-roster.tsx": { tables: 1, reason: fits },
  "components/issued-assets-workspace.tsx": { tables: 1, reason: fits },
  "components/lodging-assignments-panels.tsx": { tables: 5, reason: fits },
  "components/lodging-requests-workspace.tsx": { tables: 2, reason: fits },
  "components/lodging-workspace.tsx": { tables: 3, reason: fits },
  "components/meals-workspace.tsx": { tables: 4, reason: fits },
  "components/program-assignments-workspace.tsx": { tables: 2, reason: fits },
  "components/responsible-adult-review.tsx": { tables: 2, reason: fits },
  "components/roster-export-builder.tsx": { tables: 1, reason: fits },
  "components/staff-invitation-import.tsx": { tables: 1, reason: fits },
};

describe("every table is the shared card pattern or is allow-listed (rule B3, #1457)", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")];

  it("has no table without table-cards outside the allow-list, and the allow-list counts are exact", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const without = tableTags(file).filter((tag) => !tag.includes("table-cards")).length;
      if (without > 0) found[file] = without;
    }
    const expected = Object.fromEntries(Object.entries(allowList).map(([file, entry]) => [file, entry.tables]));
    expect(found).toEqual(expected);
  });

  it("gives every allow-list entry a reason", () => {
    for (const [file, entry] of Object.entries(allowList)) {
      expect(entry.reason.length, file).toBeGreaterThan(20);
      expect(entry.tables, file).toBeGreaterThan(0);
    }
  });

  it("never lets a table scroll with a scroll cue", () => {
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/scroll-cue|data-scroll-cue/);
    }
  });

  it("makes the roster, the settings tables, the Honors Classes table and the kitchen report table-cards", () => {
    const rosterTable = tableTags("components/club-roster-workspace.tsx");
    expect(rosterTable).toHaveLength(1);
    expect(rosterTable[0]).toContain("table-cards table-cards-xwide");
    for (const file of ["components/attendee-configuration-workspace.tsx", "components/tag-configuration-workspace.tsx"]) {
      const tags = tableTags(file);
      expect(tags.length, file).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, file).toContain("editable-settings-table table-cards");
    }
    for (const tag of tableTags("components/honors-setup-workspace.tsx").slice(0, 1)) expect(tag).toContain("table-cards");
    for (const tag of tableTags("components/kitchen-report-view.tsx")) expect(tag).toContain("table-cards");
    // The old card systems are gone from the stylesheet.
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    expect(css).not.toContain("roster-card-table-wide");
    expect(css).not.toMatch(/\.roster-card-table td\[data-label\]/);
    expect(css).not.toMatch(/\.editable-settings-table td\[data-label\]/);
  });

  it("switches by the width of the table's box, not the viewport", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    expect(css).toContain("@container table-box (max-width: 600px) {");
    expect(css).toContain("container: table-box / inline-size;");
    // No card rule for table-cards sits in a viewport media query any more.
    expect(css).not.toMatch(/@media[^{]*\{\s*table\.table-cards\.table-cards,/);
  });
});
