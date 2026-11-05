import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { CoordinatorSummaryTiles } from "@/components/coordinator-summary-tiles";
import { areaViewedClubNavItems } from "@/modules/club-rosters/portal-nav";

const read = (path: string) => readFileSync(path, "utf8");

describe("coordinator page content uses the club portal's pieces (#1555, rule L9)", () => {
  it("draws a section title as a purple eyebrow over a heading, in the club cards' markup", () => {
    const html = renderToStaticMarkup(createElement(CoordinatorSectionHeading, { eyebrow: "Club year 2026-27", title: "Points" }));
    expect(html).toContain('class="public-manage-card-heading"');
    expect(html).toContain('<p class="public-registration-eyebrow">Club year 2026-27</p>');
    expect(html).toContain("<h2>Points</h2>");
  });

  it("draws summary tiles with the club home's tile classes and an icon beside each label", () => {
    const html = renderToStaticMarkup(createElement(CoordinatorSummaryTiles, { label: "Summary", tiles: [{ label: "Submitted", value: "2", detail: "of 15 clubs", icon: createElement("svg") }] }));
    expect(html).toContain("club-home-counts");
    expect(html).toContain('class="club-home-count"');
    expect(html).toContain("club-home-count-value");
    expect(html).toContain('aria-hidden="true"');
  });

  it("gives a viewed club one tab row: All clubs first, then the club's own view-only tabs", () => {
    const items = areaViewedClubNavItems({ organizationId: "club-1" });
    expect(items[0]).toMatchObject({ href: "/account/area-clubs/overview", label: "All clubs" });
    expect(items.map((item) => item.label)).toEqual(["All clubs", "Home", "Roster", "Honors", "Events", "Club forms", "Monthly Records", "Earned awards"]);
  });

  it("builds the viewed club's layout on the club banner and ClubPortalNav, with no second tab row or gradient hero", () => {
    const layout = read("app/(public)/account/(portal)/area/[organizationId]/layout.tsx");
    expect(layout).toContain('className="club-banner"');
    expect(layout).toContain("<ClubPortalNav");
    expect(layout).not.toContain("AccountSectionNav");
    expect(layout).not.toContain("public-registration-hero");
    // The access check and the 404 guards are unchanged.
    expect(layout).toContain("currentAreaCoordinatorViewerActive");
    expect(layout).toContain("notFound()");
  });

  it("has no separate Search button on the coordinator club search: typing and Enter search", () => {
    const form = read("components/area-club-search-form.tsx");
    expect(form).not.toContain('type="submit"');
    expect(form).toContain("search-field");
    expect(form).toContain("useSearchAsYouType");
  });

  it("keeps Open club on one line in the Club events table", () => {
    expect(read("components/coordinator-destinations.module.css")).toMatch(/\.openClub\s*\{\s*white-space:\s*nowrap/);
    expect(read("components/coordinator-destinations.tsx")).toContain("styles.openClub");
  });

  it("shows Waitlists' empty state through the shared EmptyState with a heading and a next step", () => {
    const page = read("app/(public)/account/(portal)/waitlists/page.tsx");
    expect(page).toContain("<EmptyState");
    expect(page).toContain("action={{");
  });
});
