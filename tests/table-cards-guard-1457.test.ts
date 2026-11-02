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

/**
 * Every `<table ...>` in a source: its opening tag (scanned to the real closing `>`, so a `=>` inside an attribute expression or a
 * quoted string does not end it early) and its body up to `</table>`.
 */
export function tablesIn(source: string) {
  const tables: Array<{ tag: string; body: string }> = [];
  for (const match of source.matchAll(/<table\b/g)) {
    let depth = 0;
    let quote = "";
    let end = match.index + 6;
    for (; end < source.length; end += 1) {
      const char = source[end]!;
      if (quote) {
        if (char === quote && source[end - 1] !== "\\") quote = "";
      } else if (char === '"' || char === "'" || (char === "`" && depth > 0)) quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && source[end - 1] !== "=") break;
    }
    const close = source.indexOf("</table>", end);
    tables.push({ tag: source.slice(match.index, end + 1), body: source.slice(end + 1, close === -1 ? source.length : close) });
  }
  return tables;
}

/** The class tokens of an opening tag: `table-cards` has to be a whole token, `table-cards-wide` is a variant, `no-table-cards` is neither. */
export function classTokens(tag: string) {
  const attribute = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/.exec(tag);
  const value = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? "";
  return value.split(/\s+/).filter((token) => token && !token.startsWith("${"));
}

const cardsTable = (tag: string) => classTokens(tag).includes("table-cards");

function tableTags(file: string) {
  return tablesIn(readFileSync(path.join(root, file), "utf8")).map((table) => table.tag);
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

/** table-cards files whose tables have no row header, and why. Empty unless a table truly has no text that names its row. */
const noRowHeader: Record<string, string> = {};

describe("every table is the shared card pattern or is allow-listed (rule B3, #1457)", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")];

  it("has no table without table-cards outside the allow-list, and the allow-list counts are exact", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const without = tableTags(file).filter((tag) => !cardsTable(tag)).length;
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

  it("keeps the table semantics on every table-cards table: role, a row header and labelled cells", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      const tables = tablesIn(source).filter((table) => cardsTable(table.tag));
      tables.forEach((table, index) => {
        checked += 1;
        const name = `${file} #${index + 1}`;
        if (!/\brole="table"/.test(table.tag)) problems.push(`${name}: no role="table" (display changes drop native table semantics)`);
        // A body that renders a row component (<MoneyRow .../>) keeps its cells in that component, in the same file.
        const scan = /<[A-Z]\w*Row\b/.test(table.body) ? source : table.body;
        const rowHeader = /role="rowheader"|scope="row"/.test(scan);
        if (!rowHeader && !noRowHeader[file]) problems.push(`${name}: no row header (role="rowheader" / scope="row"), so a card has no heading`);
        if (rowHeader && noRowHeader[file]) problems.push(`${name}: has a row header, remove ${file} from noRowHeader`);
        if (!/cardCell\(|data-label/.test(scan)) problems.push(`${name}: its body cells use neither cardCell( nor data-label, so a card shows no column labels`);
      });
    }
    expect(checked).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });

  it("treats table-cards as a whole class token and scans a tag past => inside an attribute", () => {
    expect(classTokens('<table className="report-table table-cards table-cards-wide">')).toEqual(["report-table", "table-cards", "table-cards-wide"]);
    expect(classTokens('<table className="no-table-cards-here">')).not.toContain("table-cards");
    expect(classTokens("<table className={`report-table table-cards ${styles.table}`} role=\"table\">")).toContain("table-cards");
    const [table] = tablesIn('<table onClick={() => go()} className="a b"><tbody><tr><th role="rowheader">x</th></tr></tbody></table>');
    expect(table!.tag).toBe('<table onClick={() => go()} className="a b">');
    expect(table!.body).toContain('role="rowheader"');
  });

  it("fails the tags table as it was before it had a row header", () => {
    const before = `<table className="editable-settings-table table-cards table-cards-xwide" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Color</th></tr></thead><tbody role="rowgroup">{tags.map((row) => <tr key={row.id} role="row"><td {...cardCell("Color")}><input type="color" /></td></tr>)}</tbody></table>`;
    const [table] = tablesIn(before);
    expect(cardsTable(table!.tag)).toBe(true);
    expect(/role="rowheader"|scope="row"/.test(table!.body)).toBe(false);
    const fixed = tablesIn(readFileSync(path.join(root, "components/tag-configuration-workspace.tsx"), "utf8"))[0]!;
    expect(/role="rowheader"[^>]*scope="row"|scope="row"[^>]*role="rowheader"/.test(fixed.body)).toBe(true);
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

  it("sizes every card label from the staff floor (14px on staff pages), keeping the portal's own floor", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    const labelRules = css.split("\n").filter((line) => line.includes("content: attr(data-label)") || /font-weight: 700; font-size: max\(var\(--type-staff-floor/.test(line));
    expect(css.match(/font-weight: 700; font-size: max\(var\(--type-staff-floor, 0px\), var\(--type-floor, 0px\), 0\.68rem\);/g)).toHaveLength(5);
    expect(css).not.toContain("font-weight: 700; font-size: max(var(--type-floor, 0px), 0.68rem);");
    expect(labelRules.length).toBeGreaterThan(5);
  });

  it("switches by the width of the table's box, not the viewport", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    expect(css).toContain("@container table-box (max-width: 600px) {");
    expect(css).toContain("container: table-box / inline-size;");
    // No card rule for table-cards sits in a viewport media query any more.
    expect(css).not.toMatch(/@media[^{]*\{\s*table\.table-cards\.table-cards,/);
  });
});

describe("sorting stays usable on cards (#1457, #1458)", () => {
  const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  it.each(["table-cards", "table-cards-tablet", "table-cards-wide", "table-cards-xwide", "table-cards-max"])(
    "%s shows its sortable headers as a visible Sort by row of 44px buttons in card mode",
    (variant) => {
      const head = `table.${variant}.${variant} > thead:has(.table-sort-button)`;
      expect(globals).toContain(`${head} { position: static; display: block;`);
      expect(globals).toContain(`${head} > tr::before { content: "Sort by";`);
      expect(globals).toMatch(new RegExp(`${head.replace(/[.()>:-]/g, "\\$&")} > tr > th > \\.table-sort-button \\{[^}]*min-height: 44px`));
    },
  );
  it("keeps the sort links in the tab order", () => {
    expect(readFileSync(path.join(process.cwd(), "components/phone-hidden-sort-link.tsx"), "utf8")).not.toContain("tabIndex");
  });
});
