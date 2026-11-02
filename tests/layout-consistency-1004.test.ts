import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutoEventHeader } from "@/components/auto-event-info-cards";
import { ClubOrderWorkspace, type ClubOrderWorkspaceData } from "@/components/club-order-workspace";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { EmptyState } from "@/components/empty-state";
import { LocationFilter } from "@/components/location-filter";
import { PublicClubDirectory } from "@/components/public-club-directory";
import { rosterRowMissingFields } from "@/modules/club-rosters/domain";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

/**
 * UI recheck batch 3b (#1004): layout consistency. Markup is asserted by rendering; the stylesheet is only read
 * for rules a browser audit cannot name (the column counts that decide whether a tile is ever alone on a row).
 * Synthetic data only.
 */

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

describe("one tab-group style (#1004 item 2)", () => {
  it("marks the selected location with aria-current and uses the shared chip row, not filled buttons", () => {
    const html = renderToStaticMarkup(createElement(LocationFilter, {
      basePath: "/people",
      locations: [{ id: "loc-1", name: "North" }, { id: "loc-2", name: "South" }],
      params: { event: "event-a" },
      selectedId: "loc-2",
    }));
    expect(html).toContain('class="location-filter tab-chips"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*href="[^"]*location=loc-2"/);
    expect(html).not.toContain("primary-button");
    expect(html).not.toContain("secondary-button");
  });

  it("styles the selected chip from the same attributes assistive tech reads", () => {
    expect(css).toContain('[aria-current]:not([aria-current="false"]), [aria-pressed="true"], [aria-selected="true"]');
  });
});

describe("roster cards (#1004 item 6)", () => {
  const member = (overrides: Partial<RosterMemberRecord>): RosterMemberRecord => ({
    id: "m1", firstName: "Pat", lastName: "Pathfinder", attendeeType: "YOUTH", role: "Member", classLevel: "FRIEND",
    gender: "FEMALE", status: "ACTIVE", source: "DIRECTOR", age: 12, reportedAge: null, birthDateNeeded: true,
    updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(), ...overrides,
  } as RosterMemberRecord);

  it("leaves an active person's missing birth date to the banner, and still names other gaps", () => {
    expect(rosterRowMissingFields(member({}))).toEqual([]);
    expect(rosterRowMissingFields(member({ gender: null }))).toEqual(["Gender"]);
    expect(rosterRowMissingFields(member({ status: "INACTIVE" }))).toEqual(["Birth date"]);
  });

  it("says the birth date once: in the banner, not again as a pill on the card", () => {
    const html = renderToStaticMarkup(createElement(ClubRosterWorkspace, {
      canSeeBirthDates: false, clubYear: "2026", initialMembers: [member({})], organizationId: "org-1", readOnly: true,
    }));
    expect(html).toContain("1 person needs a birth date");
    expect(html).not.toContain("Missing info");
  });
});

describe("orders (#1004 item 7)", () => {
  const data: ClubOrderWorkspaceData = {
    helper: [],
    batches: [],
    unmatched: [{ sourceId: "s1", personId: "p1", sourceLabel: "Orienteering", honorId: null }],
    awardable: [],
    waiting: Array.from({ length: 3 }, (_, index) => ({
      needId: `n${index}`, sourceType: "HONOR" as const, itemName: "Camping Skills", sourceLabel: "Camping Skills", sourceDate: "2025-05-01",
      firstName: `Sample${index}`, lastName: "Person", beforeFirstOrder: true,
    })),
    firstOrderAt: null,
  };
  const html = renderToStaticMarkup(createElement(ClubOrderWorkspace, {
    organizationId: "club-1", initial: data, stock: [], printHref: "/account/clubs/club-1/orders/print", readOnly: false,
  }));

  it("keeps the completed-honors list inside a closed disclosure", () => {
    expect(html).toMatch(/<details[^>]*>\s*<summary>Show the 3 honors<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.indexOf("<details")).toBeLessThan(html.indexOf("Sample0"));
  });

  it("shows the no-matching-catalog note as a neutral note, not a warning", () => {
    const note = html.slice(html.indexOf("no matching catalog item") - 400, html.indexOf("no matching catalog item"));
    expect(note).toContain('role="status"');
    expect(note).not.toContain("lucide-triangle-alert");
    expect(readFileSync(path.join(process.cwd(), "components/club-orders.module.css"), "utf8")).toMatch(/\.flag \{[^}]*border: 1px solid var\(--line\)/);
  });
});

describe("one hero on the public event page (#1004 item 8)", () => {
  it("does not repeat the event title in the club event header when a banner shows it", () => {
    const header = { eyebrow: "Club event", title: "Synthetic Camporee", tagline: "A weekend away" } as never;
    const withBanner = renderToStaticMarkup(createElement(AutoEventHeader, { header, dateLabel: "January 1, 2027", titleMode: "hidden" }));
    expect(withBanner).not.toContain("Synthetic Camporee");
    expect(withBanner).not.toContain("<h1");
    expect(withBanner).not.toContain("<h2");
    const asText = renderToStaticMarkup(createElement(AutoEventHeader, { header, dateLabel: "January 1, 2027", titleMode: "text" }));
    expect(asText).toContain('<p class="auto-info-name">Synthetic Camporee</p>');
    expect(asText).not.toContain("<h1");
    const alone = renderToStaticMarkup(createElement(AutoEventHeader, { header, dateLabel: "January 1, 2027" }));
    expect(alone).toContain("<h1 id=\"auto-info-title\">Synthetic Camporee</h1>");
  });

  it("the page source draws the plain details row, not a second hero, when a banner exists", () => {
    const source = readFileSync(path.join(process.cwd(), "app/(public)/events/[eventSlug]/page.tsx"), "utf8");
    expect(source).toContain('className="public-event-facts"');
    expect(source).not.toContain("public-event-demoted-title");
    expect(source.match(/<h1>\{landing\.event\.name\}<\/h1>/g)).toHaveLength(1);
  });
});

describe("find a club empty states (#1004 items 5 and 10)", () => {
  it("uses the standard empty state, in a card with an icon", () => {
    const html = renderToStaticMarkup(createElement(PublicClubDirectory, { clubs: [] }));
    expect(html).toContain('class="empty-state panel"');
    expect(html).toContain("<svg");
    expect(html).toContain("<h2>No clubs are listed publicly yet</h2>");
  });

  it("widens the search box", () => {
    const moduleCss = readFileSync(path.join(process.cwd(), "components/public-club-directory.module.css"), "utf8");
    expect(moduleCss).toMatch(/\.search \{[^}]*max-width: 760px/);
  });

  it("the shared empty state renders icon, title and text in one card", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { className: "empty-state panel", icon: createElement("svg"), title: "Nothing yet" }, "Soon."));
    expect(html).toBe('<div class="empty-state panel" role="status"><svg></svg><h3>Nothing yet</h3><p>Soon.</p></div>');
  });
});

describe("stat tiles and home tiles (#1004 items 4 and 9)", () => {
  it("splits four and eight report tiles evenly and spans an odd last tile on two-up grids", () => {
    expect(css).toContain(".report-summary-grid:has(> :nth-child(4):last-child) { grid-template-columns: repeat(2, minmax(0, 1fr)); }");
    expect(css).toContain(".report-summary-grid:has(> :nth-child(8):last-child) { grid-template-columns: repeat(4, minmax(0, 1fr)); }");
    expect(css).toContain(":is(.metric-grid, .finance-summary) > :last-child:nth-child(odd) { grid-column: 1 / -1; }");
  });

  it("shows the four home tiles four across, or two by two, never three and one", () => {
    expect(css).toContain(".home-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }");
    expect(css).toMatch(/@media \(max-width: 1099px\) \{\s*\.home-actions \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    expect(css).not.toContain(".home-actions { display: grid; grid-template-columns: repeat(3");
  });

  it("gives the system home task tile's text the room on the narrowest phones", () => {
    const moduleCss = readFileSync(path.join(process.cwd(), "app/(workspace)/admin/system-admin.module.css"), "utf8");
    expect(moduleCss).toMatch(/@media \(max-width: 420px\) \{\s*\.taskCard \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\.taskIcon \{\s*display: none;/);
  });
});

describe("paired buttons (#1004 item 1)", () => {
  it("makes the pair two equal columns", () => {
    expect(css).toContain(".button-pair { display: grid; grid-template-columns: repeat(2, 1fr);");
  });
});

describe("print and screen scope (#1004 review)", () => {
  it("hides only the honors-roster and team-level navs in print, never the shared location filter", () => {
    const printRule = css.split("\n").find((line) => line.includes(".honor-seat-override { display: none !important; }")) ?? "";
    expect(printRule).toContain(".honor-roster-tabs");
    expect(printRule).toContain(".team-level-tabs");
    expect(printRule).not.toContain(".tab-chips");
    expect(css).not.toMatch(/@media print \{\s*\.tab-chips/);
    const filter = renderToStaticMarkup(createElement(LocationFilter, { basePath: "/people", locations: [{ id: "l1", name: "North" }], params: {}, selectedId: "l1" }));
    expect(filter).not.toContain("honor-roster-tabs");
    expect(filter).not.toContain("team-level-tabs");
  });

  it("keeps every tile rule inside a screen-only media query", () => {
    const start = css.indexOf("/* --- Stat tiles never leave one tile alone on a row (#1004)");
    const end = css.indexOf("/* With a header banner the page has one hero.");
    const block = css.slice(start, end);
    const queries = block.match(/@media [^{]+\{/g) ?? [];
    expect(queries.length).toBeGreaterThanOrEqual(5);
    for (const query of queries) expect(query).toMatch(/^@media screen and /);
    // The last tile alone on a row spans it at every column count: 5 across, 4 across, 3 across and 2 across.
    for (const rule of [":nth-child(5n + 1)", ":nth-child(4n + 1)", ":nth-child(3n + 1):not(:nth-child(4))", ":nth-child(odd)"]) {
      expect(block).toContain(rule);
    }
    // The three-across rule stops at 721px: below that the grid is two across, where 10 tiles must not span the last.
    expect(block).toMatch(/@media screen and \(min-width: 721px\) and \(max-width: 1120px\) \{[^}]*:nth-child\(3n \+ 1\):not\(:nth-child\(4\)\)/);
  });
});

describe("empty state headings and announcements (#1004 review)", () => {
  it("draws the title at the level the page's outline needs, h3 by default", () => {
    expect(renderToStaticMarkup(createElement(EmptyState, { title: "A" }))).toContain("<h3>A</h3>");
    expect(renderToStaticMarkup(createElement(EmptyState, { title: "A", headingLevel: 2 }))).toContain("<h2>A</h2>");
    expect(renderToStaticMarkup(createElement(EmptyState, { title: "A", headingLevel: 4 }))).toContain("<h4>A</h4>");
  });

  it("can be a plain visible result with no live region", () => {
    expect(renderToStaticMarkup(createElement(EmptyState, { title: "A" }))).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(EmptyState, { title: "A", announce: false }))).not.toContain("role=");
  });

  it("find a club: h2 under the page's h1, and the no-match state is not a live region", () => {
    const html = renderToStaticMarkup(createElement(PublicClubDirectory, { clubs: [] }));
    expect(html).toContain("<h2>No clubs are listed publicly yet</h2>");
    const source = readFileSync(path.join(process.cwd(), "components/public-club-directory.tsx"), "utf8");
    expect(source).toMatch(/<EmptyState announce=\{false\}[^>]*headingLevel=\{2\}/);
  });
});

describe("orders prompt (#1004 review)", () => {
  it("keeps Not now outside the closed list so the prompt can be dismissed without opening it", () => {
    const data: ClubOrderWorkspaceData = {
      helper: [], batches: [], unmatched: [], awardable: [],
      waiting: [{ needId: "n1", sourceType: "HONOR", itemName: "Camping Skills", sourceLabel: "Camping Skills", sourceDate: "2025-05-01", firstName: "Sample", lastName: "Person", beforeFirstOrder: true }],
      firstOrderAt: null,
    };
    const html = renderToStaticMarkup(createElement(ClubOrderWorkspace, { organizationId: "club-1", initial: data, stock: [], printHref: "/x", readOnly: false }));
    const open = html.indexOf("<details");
    const close = html.indexOf("</details>");
    expect(open).toBeGreaterThan(-1);
    const notNow = html.indexOf("Not now");
    expect(notNow).toBeGreaterThan(close);
  });
});
