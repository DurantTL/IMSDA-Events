import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/more/clubs", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("server-only", () => ({}));

import { EventClubsSummary } from "@/components/event-clubs-summary";
import { EventClubsViewsStrip } from "@/components/event-clubs-views-strip";
import { eventClubsSummary } from "@/modules/club-rosters/event-clubs-summary";
import { eventClubsViews } from "@/modules/club-rosters/event-clubs-views-model";

const read = (path: string) => readFileSync(path, "utf8");
const labels = (views: ReturnType<typeof eventClubsViews>) => views.map((view) => view.label);

describe("eventClubsViews (#1582)", () => {
  it("gives an event administrator who can manage assignments all three pages, in order, with ?event", () => {
    const views = eventClubsViews("ev 1", { oversight: true, assignments: true }, "assignments");
    expect(labels(views)).toEqual(["Clubs attending", "Club assignments", "Monthly Records"]);
    expect(views.map((view) => view.href)).toEqual([
      "/more/clubs?event=ev%201",
      "/more/club-assignments?event=ev%201",
      "/more/clubs/reports?event=ev%201",
    ]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["assignments"]);
  });

  it("gives oversight alone Clubs attending and Monthly Records", () => {
    expect(labels(eventClubsViews("e", { oversight: true, assignments: false }))).toEqual(["Clubs attending", "Monthly Records"]);
  });

  it("gives assignments alone one page, which a strip renders as nothing", () => {
    expect(labels(eventClubsViews("e", { oversight: false, assignments: true }))).toEqual(["Club assignments"]);
    const markup = renderToStaticMarkup(createElement(EventClubsViewsStrip, { eventId: "e", access: { oversight: false, assignments: true }, current: "assignments" }));
    expect(markup).toBe("");
  });

  it("gives nobody without either check nothing, and marks no page current without one", () => {
    expect(eventClubsViews("e", { oversight: false, assignments: false })).toEqual([]);
    expect(eventClubsViews("e", { oversight: true, assignments: true }).some((view) => view.current)).toBe(false);
  });

  it("renders the strip with its label and the current page", () => {
    const markup = renderToStaticMarkup(createElement(EventClubsViewsStrip, { eventId: "e1", access: { oversight: true, assignments: true }, current: "attending" }));
    expect(markup).toContain('aria-label="Event club pages"');
    expect(markup).toContain('href="/more/club-assignments?event=e1"');
    expect(markup).toContain('aria-current="page"');
  });
});

describe("eventClubsSummary (#1582)", () => {
  const club = (organizationId: string, teamName: string | null, attendeeCount: number) => ({ organizationId, teamName, attendeeCount });

  it("counts clubs, teams and people in their own units, and Sterling once per person, not per team", () => {
    const items = eventClubsSummary({
      clubs: [club("a", "Team One", 5), club("a", "Team Two", 4), club("b", null, 7)],
      backgroundFlags: { people: [{ personId: "p1", organizationId: "a" }, { personId: "p2", organizationId: "b" }] },
    });
    expect(items.map((item) => [item.key, item.value])).toEqual([["clubs", 2], ["teams", 2], ["going", 16], ["sterling", 2]]);
    expect(items.find((item) => item.key === "sterling")?.label).toBe("adults need Sterling Volunteers");
  });

  it("counts an adult on two teams' registrations once, skips rows without a club, and matches the table's total", () => {
    const people = [
      { personId: "p1", organizationId: "a" }, { personId: "p1", organizationId: "a" },
      { personId: "p2", organizationId: "a" }, { personId: "p3", organizationId: null },
    ];
    const items = eventClubsSummary({ clubs: [club("a", "Team One", 2), club("a", "Team Two", 2)], backgroundFlags: { people } });
    expect(items.find((item) => item.key === "sterling")?.value).toBe(2);
    // The table's per-club count (rows with an organizationId) summed over clubs, with each person once.
    const perClub = new Map<string, Set<string>>();
    for (const person of people) if (person.organizationId) perClub.set(person.organizationId, (perClub.get(person.organizationId) ?? new Set()).add(person.personId));
    expect([...perClub.values()].reduce((sum, set) => sum + set.size, 0)).toBe(2);
  });

  it("leaves out teams when no club has them, and Sterling when the event does not check adults", () => {
    const items = eventClubsSummary({ clubs: [club("a", null, 1)], backgroundFlags: null });
    expect(items.map((item) => item.key)).toEqual(["clubs", "going"]);
    expect(items.map((item) => item.label)).toEqual(["club", "person going"]);
  });

  it("shows zero adults needing Sterling Volunteers when the event checks and none are flagged", () => {
    const html = renderToStaticMarkup(createElement(EventClubsSummary, { clubs: [club("a", null, 3)], backgroundFlags: { people: [] } }));
    expect(html).toContain("0</strong> adults need Sterling Volunteers");
  });
});

describe("page wiring (#1582)", () => {
  it("puts the strip on all three pages and their restricted states, and the old links are gone", () => {
    const clubs = read("app/(workspace)/more/clubs/page.tsx");
    const reports = read("app/(workspace)/more/clubs/reports/page.tsx");
    const assignments = read("app/(workspace)/more/club-assignments/page.tsx");
    expect(clubs.match(/\{strip\}/g)?.length).toBe(3);
    expect(reports.match(/\{strip\}/g)?.length).toBe(2);
    expect(assignments.match(/\{strip\}/g)?.length).toBe(3);
    expect(clubs).toContain('current="attending"');
    expect(reports).toContain('current="records"');
    expect(assignments).toContain('current="assignments"');
    expect(clubs).not.toContain("All clubs&apos; Monthly Records");
    expect(clubs).not.toContain("page-intro");
    expect(clubs).toContain("<StaffPageHeader");
    expect(clubs).toContain("/more/team-results?event=");
    expect(reports).not.toContain("Back to clubs");
    expect(reports).not.toContain("BackLink");
  });

  it("labels the club page's assignments as event-set and links Club assignments only for those who can manage them", () => {
    const source = read("app/(workspace)/more/clubs/[organizationId]/page.tsx");
    expect(source).toContain("Back to clubs attending");
    expect(source).toContain("<h2>Event assignments</h2>");
    expect(source).toContain("Set by event staff for {event.name}.");
    expect(source).toMatch(/canManageClubAssignments\(permissions\) && <p><Link className="text-button" href=\{`\/more\/club-assignments\$\{query\}`\}>Change on Club assignments<\/Link><\/p>/);
  });

  it("keeps the event and club visible on the monthly record and draws the assignments header without a duplicate title", () => {
    expect(read("app/(workspace)/more/clubs/reports/[organizationId]/[month]/page.tsx")).toContain("{event.name} · Monthly Record · view only");
    const workspace = read("components/club-assignments-workspace.tsx");
    expect(workspace).toContain("<StaffPageHeader");
    expect(workspace).not.toContain('className="page-intro"');
    expect(workspace).toContain("You can change these.");
  });

  it("keeps the sensitive-data reads unchanged on the club page", () => {
    const source = read("app/(workspace)/more/clubs/[organizationId]/page.tsx");
    expect(source).toContain("includeNotes: canSeeIssuesText(user)");
    expect(source).toContain("resolveStaffGuardianViewer(event.id)");
  });
});
