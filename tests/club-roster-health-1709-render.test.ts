import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ClubHomeRosterHealth } from "@/components/club-home-roster-health";
import { ClubOptionalFeatures } from "@/components/club-optional-features";
import { ClubRosterHealthTable } from "@/components/club-roster-health";
import { rosterHealthCounts } from "@/modules/club-features/domain";
import type { RosterHealthRow } from "@/modules/club-features/roster-health";

/** The roster health list, the Home counts and the Club settings switch, as markup (#1709). Synthetic data only. */

const rows: RosterHealthRow[] = [
  { id: "m1", firstName: "Sam", lastName: "Rivers", attendeeType: "YOUTH", typeLabel: "Youth", lastUpdated: "2025-02-01T12:00:00.000Z", flags: ["OUTDATED", "NO_EMERGENCY_CONTACT"] },
  { id: "m2", firstName: "Alex", lastName: "Lake", attendeeType: "STAFF", typeLabel: "Staff", lastUpdated: null, flags: ["NO_STERLING_CHECK"] },
];

describe("the roster health table", () => {
  const html = renderToStaticMarkup(createElement(ClubRosterHealthTable, { rows }));

  it("uses the shared table classes, with card labels that match the header text exactly", () => {
    expect(html).toContain('class="report-table table-cards"');
    const headers = [...html.matchAll(/<th[^>]*scope="col"[^>]*>(?:<button[^>]*>)?([^<]*)/g)].map((match) => match[1]);
    expect(headers).toEqual(["Person", "Type", "Last updated", "Needs attention"]);
    const labels = [...new Set([...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]))];
    expect(labels).toEqual(["Type", "Last updated", "Needs attention"]);
  });

  it("says only what is missing or old, with the shared status chip, and the date in the conference's time", () => {
    expect(html).toContain('<span class="status-chip gold">Not updated in over a year</span>');
    expect(html).toContain("No emergency contact");
    expect(html).toContain("No Sterling check");
    expect(html).toContain("Feb 1, 2025");
    expect(html).toContain("Not known");
  });

  it("marks the names as exact values, written the shared way", () => {
    expect(html).toContain('translate="no">Sam Rivers</th>');
  });

  it("pages with the shared count line, 25 to a page", () => {
    const many: RosterHealthRow[] = Array.from({ length: 30 }, (_, index) => ({ ...rows[0]!, id: `m${index}`, firstName: `Pat${index}` }));
    const html30 = renderToStaticMarkup(createElement(ClubRosterHealthTable, { rows: many }));
    expect(html30).toContain("Showing 1–25 of 30 people");
    expect(html30.match(/<tr role="row">/g)).toHaveLength(26);
    expect(html30).toContain('aria-label="Roster health pages"');
    expect(html).toContain("Showing 1–2 of 2 people");
  });

  it("says nobody is flagged instead of drawing an empty table", () => {
    const empty = renderToStaticMarkup(createElement(ClubRosterHealthTable, { rows: [] }));
    expect(empty).toContain("Nobody on this year&#x27;s roster has anything flagged.");
    expect(empty).not.toContain("<table");
  });
});

describe("the Home counts", () => {
  it("shows counts and a link, and no names", () => {
    const counts = rosterHealthCounts(rows);
    const html = renderToStaticMarkup(createElement(ClubHomeRosterHealth, { counts, href: "/account/clubs/club-1/roster-health" }));
    expect(html).toContain("Roster health");
    expect(html).toContain("People with something to check");
    expect(html).toContain('href="/account/clubs/club-1/roster-health"');
    expect(html).not.toContain("Rivers");
    expect(html).not.toContain("Alex");
  });
});

describe("counts for checks that never ran", () => {
  it("reads Not checked, never zero, on the list page's and Home's counts", () => {
    const counts = rosterHealthCounts(rows);
    const home = renderToStaticMarkup(createElement(ClubHomeRosterHealth, { counts, notChecked: ["NO_HEALTH_RECORD", "NO_PHOTO_RELEASE"], href: "/x" }));
    expect(home.match(/Not checked/g)).toHaveLength(2);
    expect(home).toMatch(/No health record<\/dt><dd class="club-home-count-value">Not checked/);
    expect(home).toMatch(/No emergency contact<\/dt><dd class="club-home-count-value">1</);
    const checked = renderToStaticMarkup(createElement(ClubHomeRosterHealth, { counts, href: "/x" }));
    expect(checked).not.toContain("Not checked");
  });
});

describe("the Club settings switch", () => {
  it("is off by default and offers no link to the list", () => {
    const html = renderToStaticMarkup(createElement(ClubOptionalFeatures, { organizationId: "club-1", initialEnabled: [] }));
    expect(html).toContain("Optional features");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).not.toContain("checked");
    expect(html).not.toContain("/roster-health");
    expect(html).toContain("Save optional features");
  });

  it("links to the list once it is on", () => {
    const html = renderToStaticMarkup(createElement(ClubOptionalFeatures, { organizationId: "club-1", initialEnabled: ["roster-health-flags"] }));
    expect(html).toContain("checked");
    expect(html).toContain('href="/account/clubs/club-1/roster-health"');
  });
});
