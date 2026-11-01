import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule B1 guard (#1458): every staff and admin table sorts from its column headers, and the one count line is
 * `ListPager`'s "Showing 1\u201325 of 140". A `.tsx` under app/ or components/ that renders a `<table>` with a `<thead>`
 * but no `SortableHeader` (or `ColumnHeader`, its server wrapper), or that writes the word "Showing" outside
 * components/list-pager.tsx, must be on a list below with its reason. Reasons are plain: "set order", "short fixed list",
 * "print sheet", or "round 2 (#1458)" for a table the next round will make sortable. Remove a file from a list when it is fixed.
 */

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "components"))].map((file) => ({
  relative: path.relative(root, file).split(path.sep).join("/"),
  source: readFileSync(file, "utf8"),
}));

/** Tables that are not sortable, and why. */
const unsortedTables: Record<string, string> = {
  "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/schedule/page.tsx": "set order: schedule",
  "app/(public)/account/(portal)/clubs/[organizationId]/exports/class-tracking/page.tsx": "print sheet",
  "app/(public)/account/(portal)/clubs/[organizationId]/orders/print/page.tsx": "print sheet",
  "app/(workspace)/more/reports/packets/page.tsx": "print sheet",
  "components/honors-print-report.tsx": "print sheet",
  "components/emergency-reference-sheet.tsx": "print sheet",
  "components/event-health-sheet.tsx": "print sheet",
  "components/check-in-book.tsx": "print sheet",
  "components/kitchen-counts-table.tsx": "short fixed list: kitchen meal counts in meal order",
  "components/kitchen-meals-served.tsx": "short fixed list: kitchen meals served in meal order",
  "components/kitchen-report-view.tsx": "short fixed list: kitchen report in meal order",
  "components/attendee-configuration-workspace.tsx": "short fixed list: settings table",
  "components/cancellation-policy-workspace.tsx": "set order: refund tiers by date",
  "components/event-features-table.tsx": "short fixed list: event feature settings",
  "components/tag-configuration-workspace.tsx": "short fixed list: settings table",
  "components/calendar-feeds-panel.tsx": "short fixed list: settings table",
  "components/csv-import-dialog.tsx": "set order: import preview in file order",
  "components/club-import-workspace.tsx": "set order: import preview in file order",
  "components/eadventist-import-workspace.tsx": "set order: import preview in file order",
  "components/health-import-workspace.tsx": "set order: import preview in file order",
  "components/background-check-import.tsx": "set order: import preview in file order",
  "components/staff-invitation-import.tsx": "set order: import preview in file order",
  "components/scanner-import-workspace.tsx": "set order: import preview in file order",
  "app/(workspace)/more/kitchen-report/scanner-import/page.tsx": "set order: import preview in file order",
  "app/(public)/account/(portal)/area/[organizationId]/forms/page.tsx": "round 2 (#1458)",
  "app/(workspace)/admin/analytics/page.tsx": "round 2 (#1458)",
  "app/(workspace)/admin/club-forms/page.tsx": "round 2 (#1458)",
  "app/(workspace)/admin/form-templates/page.tsx": "round 2 (#1458)",
  "app/(workspace)/admin/forms/page.tsx": "round 2 (#1458)",
  "app/(workspace)/more/clubs/page.tsx": "round 2 (#1458)",
  "app/(workspace)/more/honors/rosters/page.tsx": "round 2 (#1458)",
  "app/(workspace)/more/program-assignments/[runId]/page.tsx": "round 2 (#1458)",
  "app/(workspace)/more/reports/clubs/page.tsx": "round 2 (#1458)",
  "app/(workspace)/more/reports/page.tsx": "round 2 (#1458)",
  "components/asset-closeout-workspace.tsx": "round 2 (#1458)",
  "components/asset-issue-desk.tsx": "round 2 (#1458)",
  "components/asset-return-panel.tsx": "round 2 (#1458)",
  "components/background-check-flags.tsx": "round 2 (#1458)",
  "components/background-check-review-panel.tsx": "round 2 (#1458)",
  "components/church-map-locations-workspace.tsx": "round 2 (#1458)",
  "components/club-assignments-workspace.tsx": "round 2 (#1458)",
  "components/club-directors-workspace.tsx": "round 2 (#1458)",
  "components/club-form-submission-view.tsx": "round 2 (#1458)",
  "components/club-guardians-panel.tsx": "round 2 (#1458)",
  "components/club-new-year-status.tsx": "round 2 (#1458)",
  "components/club-records-to-review.tsx": "round 2 (#1458)",
  "components/club-report-charts.tsx": "round 2 (#1458)",
  "components/club-reports-conference.tsx": "round 2 (#1458)",
  "components/club-roster-carry-forward.tsx": "round 2 (#1458)",
  "components/club-supply-catalog-workspace.tsx": "round 2 (#1458)",
  "components/club-year-end-conference.tsx": "round 2 (#1458)",
  "components/clubs-forms-missing-list.tsx": "round 2 (#1458)",
  "components/communications-workspace.tsx": "round 2 (#1458)",
  "components/director-sterling-followup.tsx": "round 2 (#1458)",
  "components/email-delivery-section.tsx": "round 2 (#1458)",
  "components/honor-catalog-workspace.tsx": "round 2 (#1458)",
  "components/honors-setup-workspace.tsx": "round 2 (#1458)",
  "components/information-form-responses-view.tsx": "round 2 (#1458)",
  "components/information-forms-home.tsx": "round 2 (#1458)",
  "components/instructor-roster.tsx": "round 2 (#1458)",
  "components/issued-assets-workspace.tsx": "round 2 (#1458)",
  "components/lodging-assignments-panels.tsx": "round 2 (#1458)",
  "components/lodging-requests-workspace.tsx": "round 2 (#1458)",
  "components/lodging-workspace.tsx": "round 2 (#1458)",
  "components/meal-closeout.tsx": "round 2 (#1458)",
  "components/meals-workspace.tsx": "round 2 (#1458)",
  "components/member-class-history.tsx": "round 2 (#1458)",
  "components/notifications-workspace.tsx": "round 2 (#1458)",
  "components/program-assignments-workspace.tsx": "round 2 (#1458)",
  "components/responsible-adult-review.tsx": "round 2 (#1458)",
  "components/roster-export-builder.tsx": "round 2 (#1458)",
  "components/staff-approval-queue.tsx": "round 2 (#1458)",
  "components/staff-invitation-list.tsx": "round 2 (#1458)",
};

/** Files that write "Showing", and why. */
const showingWords: Record<string, string> = {
  "app/(workspace)/admin/organizations/[organizationId]/club/page.tsx": "not a count: club year banner",
  "app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx": "not a count: club year banner",
  "components/club-home.tsx": "not a count: club year banner",
  "components/club-roster-workspace.tsx": "not a count: filter note",
  "components/public-club-directory.tsx": "not a count: map caption",
  "components/site-content-workspace.tsx": "not a count: revision status",
  "components/merchandise-admin-workspace.tsx": "not a count: preview status",
  "components/event-activity-panel.tsx": "not a count: filter note",
  "components/attendance-reconciliation.tsx": "not a count: snapshot banner",
  "components/import-workspace.tsx": "not a count: import step heading",
  "app/(workspace)/more/ledger-health/page.tsx": "round 2 (#1458): cap notice",
  "app/(workspace)/more/health/page.tsx": "round 2 (#1458): cap notice",
  "components/calendar-admin-workspace.tsx": "round 2 (#1458): cap notice",
  "components/club-leaders-list.tsx": "round 2 (#1458): cap notice",
  "components/people-directory.tsx": "round 2 (#1458): cap notice for the pending invites",
  "components/staff-invitation-list.tsx": "round 2 (#1458): cap notice",
  "components/communications-workspace.tsx": "round 2 (#1458): cap notice",
  "components/staff-invitation-import.tsx": "set order: import preview in file order",
  "components/scanner-import-workspace.tsx": "set order: import preview in file order",
  "app/(workspace)/more/kitchen-report/scanner-import/page.tsx": "set order: import preview in file order",
};

describe("sorting and the pager, rule B1 (#1458)", () => {
  it("every table with a header row has sortable headers or is on the allowlist with a reason", () => {
    const unlisted = files
      .filter(({ source }) => /<table\b/.test(source) && /<thead\b/.test(source) && !/<(SortableHeader|ColumnHeader)\b/.test(source))
      .map(({ relative }) => relative)
      .filter((relative) => !(relative in unsortedTables));
    expect(unlisted).toEqual([]);
  });

  it("writes no count line of its own: \"Showing\" belongs to ListPager", () => {
    const unlisted = files
      .filter(({ relative, source }) => relative !== "components/list-pager.tsx" && /\bShowing\b/.test(source))
      .map(({ relative }) => relative)
      .filter((relative) => !(relative in showingWords));
    expect(unlisted).toEqual([]);
  });

  it("keeps the allowlists honest: every entry still needs its exception and has a plain reason", () => {
    const bySource = new Map(files.map((file) => [file.relative, file.source]));
    const stale: string[] = [];
    for (const [relative, reason] of Object.entries(unsortedTables)) {
      const source = bySource.get(relative);
      if (source === undefined) stale.push(`${relative}: file is gone`);
      else if (/<(SortableHeader|ColumnHeader)\b/.test(source)) stale.push(`${relative}: now sortable, remove it`);
      else if (!reason.trim()) stale.push(`${relative}: no reason`);
    }
    for (const [relative, reason] of Object.entries(showingWords)) {
      const source = bySource.get(relative);
      if (source === undefined) stale.push(`${relative}: file is gone`);
      else if (!/\bShowing\b/.test(source)) stale.push(`${relative}: no longer says Showing, remove it`);
      else if (!reason.trim()) stale.push(`${relative}: no reason`);
    }
    expect(stale).toEqual([]);
  });

  it("the round A tables are sortable, not allowlisted", () => {
    const sortable = [
      "app/(workspace)/admin/clubs/summary/page.tsx",
      "components/staff-monthly-records.tsx",
      "components/area-clubs-views.tsx",
      "app/(workspace)/people/attendees/page.tsx",
      "components/club-roster-workspace.tsx",
      "app/(workspace)/admin/organizations/directory/page.tsx",
      "app/(workspace)/admin/organizations/background-checks/page.tsx",
      "components/club-forms-lists.tsx",
      "app/(workspace)/more/club-forms/page.tsx",
      "components/club-honors-workspace.tsx",
      "components/club-earned-awards-workspace.tsx",
      "components/coordinator-points.tsx",
      "components/coordinator-overview.tsx",
      "components/coordinator-destinations.tsx",
      "components/coordinator-monthly-records.tsx",
    ];
    for (const relative of sortable) expect(relative in unsortedTables, relative).toBe(false);
  });
});
