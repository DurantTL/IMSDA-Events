import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #996, UI recheck batch 1. These pin the stylesheet and markup decisions behind the visual fixes so they do not
 * drift back; the real-browser audit (npm run test:mobile-layout) is the check that they look right.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

describe("registration cards (bug 1)", () => {
  it("keep a name column that is never starved by the badges", () => {
    expect(rule(".record-card")).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/@container \(min-width: 36rem\)\s*\{\s*\.record-card \{ grid-template-columns: auto minmax\(0, 1fr\) auto; \}/);
    expect(rule(".record-card-shell")).toMatch(/container-type:\s*inline-size/);
    expect(read("components/people-workspace.tsx")).toContain('className="record-badges"');
  });
});

describe("the public review step (bug 2)", () => {
  it("is one full-width column of label-above-value rows", () => {
    expect(rule(".public-registration-review")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.public-registration-review-answers > div \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.public-registration-review-answers dd \{[^}]*overflow-wrap: break-word;/);
    expect(css).toMatch(/\.public-registration-review-answers dd\.is-code \{ overflow-wrap: anywhere; \}/);
  });
});

describe("the registration step bar and focus (bug 3), and the club event bar (bug 8)", () => {
  it("stays in the page until the reader scrolls past the heading, then pins", () => {
    expect(css).toMatch(/\.public-registration-form-column > \.public-registration-step-actions\.is-sticky-cta \{[^}]*position: static;/);
    expect(css).toMatch(/\.public-registration-step-actions\.is-sticky-cta\.is-pinned \{ position: sticky; \}/);
    expect(rule(".club-sticky-bar")).toMatch(/position: static;/);
    expect(rule(".club-sticky-bar.is-pinned")).toMatch(/position: sticky;/);
    expect(read("components/public-registration-form.tsx")).toContain("usePinAfterScroll(stepHeadingRef)");
    expect(read("components/club-registration-workspace.tsx")).toContain("usePinAfterScroll(introRef)");
  });

  it("keeps only the current step's label on a phone, the others for screen readers", () => {
    expect(css).toMatch(/\.public-registration-progress li:not\(\.is-current\) > small \{ position: absolute; width: 1px; height: 1px;/);
  });

  it("outlines the step heading for keyboard focus only", () => {
    expect(css).toContain(".public-registration-step-heading h2:focus-visible {");
    expect(css).not.toContain(".public-registration-step-heading h2:focus {");
  });
});

describe("the Honors Classes table (bug 7)", () => {
  it("is cards up to 1180px, keeps the actions inside a cell, and names a combined class by its count", () => {
    const source = read("components/honors-setup-workspace.tsx");
    expect(source).toContain('<table className="report-table roster-card-table roster-card-table-wide">');
    expect(source).toContain('<td className="roster-card-actions">');
    expect(source).toContain('<div className="honor-row-actions">');
    expect(source).toContain("`Edit class with ${editing.honors.length} honors`");
    expect(css).toMatch(/@media \(min-width: 721px\) and \(max-width: 1180px\) \{\s*\.roster-card-table\.roster-card-table-wide,/);
    expect(css).toMatch(/\.honor-inline-form > \.eyebrow \{ flex: 1 0 100%; margin: 0; \}/);
  });
});

describe("calendar chips at dot size", () => {
  it("leave the tab order and the accessibility tree when they are dots", async () => {
    const { calendarChipAccessibility, CALENDAR_DOT_QUERY } = await import("@/components/calendar-month-chip");
    expect(calendarChipAccessibility(true)).toEqual({ item: { "aria-hidden": true }, link: { tabIndex: -1 } });
    expect(calendarChipAccessibility(false)).toEqual({ item: {}, link: {} });
    expect(CALENDAR_DOT_QUERY).toBe("(max-width: 760px)");
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.calendar-day \{ min-height: 54px;/);
  });
});

describe("text that ran together (bug 5)", () => {
  it("puts a checkbox's bold label and its description on separate lines", () => {
    expect(css).toMatch(/\.checkbox-label > span:has\(> strong \+ small\) \{ display: grid;/);
    // The copy-from-past-event counts (a strong, then a span) stay on one line.
    expect(css).not.toContain("span:has(> strong, > small)");
  });

  it("gives the scholarship fund lists block names, notes and a code that never splits", () => {
    expect(css).toMatch(/\.scholarship-fund-list \.finance-row > span > :is\(strong, small\) \{ display: block; \}/);
    expect(css).toMatch(/\n\.scholarship-fund-code-link \{ white-space: nowrap; \}/);
    expect(read("components/scholarship-fund-workspace.tsx").match(/scholarship-fund-list/g)?.length).toBe(4);
  });
});

describe("the public card and dialog fixes (bugs 9, 10, 11)", () => {
  it("wraps the registered title and the QR caption in one box each", () => {
    const page = read("app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx");
    expect(page).toContain('<CheckCircle2 size={20} aria-hidden="true" /> <span>{workspace.registration.teamName');
    expect(page).toMatch(/<QrCode aria-hidden="true" size=\{15\} \/>\s*<span>\s*Show this at check-in/);
  });

  it("closes the Honors dialogs with the same icon button as the other dialogs", () => {
    for (const file of ["components/club-honors-workspace.tsx", "components/club-member-honors-dialog.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain('type="button">×</button>');
      expect(source, file).toContain('<X aria-hidden="true" size={18} />');
    }
  });

  it("gives the gallery photo a frame that cannot collapse", () => {
    expect(css).toMatch(/\.event-gallery-dialog img \{[^}]*min-height: min\(12rem, 40dvh\);/);
  });
});
