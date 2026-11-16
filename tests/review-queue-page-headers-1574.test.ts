import { describe, expect, it } from "vitest";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";
import { buildReviewQueuesView } from "@/modules/review-queues/review-queues-model";
import { source } from "./helpers/page-sources-1772";

// #1574: the seven review pages each draw one titled PageHeader whose title is the hub card that opened them. Synthetic data only.
const pages = [
  { route: "/people/responsible-adults", files: ["components/responsible-adult-review.tsx"], title: "Responsible adults" },
  { route: "/people/duplicates", files: ["app/(workspace)/people/duplicates/page.tsx"], title: "Find duplicates" },
  { route: "/people/directory-review", files: ["app/(workspace)/people/directory-review/page.tsx"], title: "Directory review" },
  { route: "/people/pending-teams", files: ["app/(workspace)/people/pending-teams/page.tsx"], title: "Teams waiting for a club" },
  { route: "/people/staff-invitations", files: ["app/(workspace)/people/staff-invitations/page.tsx"], title: "Staff invitations" },
  { route: "/people/staff-invitations/approvals", files: ["app/(workspace)/people/staff-invitations/approvals/page.tsx"], title: "Staff approvals" },
] as const;

const hubCards = buildReviewQueuesView({ permissions: ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"], audience: "GENERAL" }, "evt_1", { responsibleAdults: 0, directoryEntries: 0, pendingTeams: 0, approvalsWaiting: 0 })
  .groups.flatMap((group) => group.cards);

describe("review pages draw one titled header (#1574)", () => {
  for (const { route, files, title } of pages) {
    it(`${route} has one PageHeader titled like its hub card`, () => {
      const text = files.map((file) => source(file)).join("\n");
      // The bare `<PageHeader title=... />` above a restricted or not-available state is checked below.
      expect((text.replace(/<PageHeader title=(?:"[^"]*"|\{[^}]*\}) \/>/g, "").match(/<PageHeader\b/g) ?? []).length).toBe(1);
      expect(text).toContain(`title="${title}"`);
      expect(text).not.toContain("page-intro");
      expect(text).not.toContain("duplicate-page-title");
      expect(text).not.toMatch(/<h1\b/);
      expect(hubCards.some((card) => card.href.startsWith(route + "?") && card.title === title), route).toBe(true);
      expect(pageOwnsHeader(route), route).toBe(true);
    });
  }

  it("/imports draws its header from the staff page title, with help in the header and no stale eyebrow", () => {
    const text = source("components/import-workspace.tsx");
    const page = source("app/(workspace)/imports/page.tsx");
    expect(text).not.toContain("<PageHeader");
    expect(text).not.toContain("Build 5 staging");
    expect(text).not.toContain("duplicate-page-title");
    expect(page).toContain("<PageHeader title={staffPageTitles.imports} description=");
    expect(page).toMatch(/extra=\{<div className=\{styles\.helpSlot\}><StaffContextualHelp/);
    expect(pageOwnsHeader("/imports")).toBe(true);
    expect(staffPageTitles.imports).toBe("Imports");
  });

  it("keeps the staff invitation safety facts on the page", () => {
    const text = source("app/(workspace)/people/staff-invitations/page.tsx");
    expect(text).toContain("importing a file never emails anyone");
    expect(text).toContain("in one");
    expect(text).toContain("spouse, and children or dependants up to age 18");
  });

  it("keeps the duplicate section headings without eyebrows that restate them", () => {
    const text = source("app/(workspace)/people/duplicates/page.tsx");
    expect(text).not.toContain("Same person, more than once");
    expect(text).not.toContain("One contact, several registrations");
    expect(text).toContain("attendee match");
    expect(text).toContain("contact match");
  });

  // The shell draws no h1 on these routes, so a restricted or not-available return carries the titled header too.
  const guarded = [
    { file: "app/(workspace)/people/responsible-adults/page.tsx", title: '"Responsible adults"', restricted: 1, unavailable: 0 },
    { file: "app/(workspace)/people/duplicates/page.tsx", title: '"Find duplicates"', restricted: 1, unavailable: 0 },
    { file: "app/(workspace)/people/directory-review/page.tsx", title: '"Directory review"', restricted: 1, unavailable: 0 },
    { file: "app/(workspace)/people/pending-teams/page.tsx", title: '"Teams waiting for a club"', restricted: 1, unavailable: 0 },
    { file: "app/(workspace)/people/staff-invitations/page.tsx", title: '"Staff invitations"', restricted: 1, unavailable: 1 },
    { file: "app/(workspace)/people/staff-invitations/approvals/page.tsx", title: '"Staff approvals"', restricted: 1, unavailable: 1 },
    { file: "app/(workspace)/imports/page.tsx", title: "{staffPageTitles.imports}", restricted: 1, unavailable: 0 },
    { file: "app/(workspace)/people/attendees/page.tsx", title: "{staffPageTitles.attendeeList}", restricted: 1, unavailable: 0 },
    { file: "app/(workspace)/people/page.tsx", title: "{staffPageTitles.registrations}", restricted: 1, unavailable: 0 },
  ];
  for (const { file, title, restricted, unavailable } of guarded) {
    it(`${file} puts the titled header above every restricted and not-available state`, () => {
      const text = source(file);
      const header = `<PageHeader title=${title} />`;
      const states = [...text.matchAll(/<(AccessRestricted|NotAvailableForEvent)\b/g)].map((match) => match[1]);
      expect(states.filter((name) => name === "AccessRestricted")).toHaveLength(restricted);
      expect(states.filter((name) => name === "NotAvailableForEvent")).toHaveLength(unavailable);
      expect(text.split(header).length - 1, "one bare header before each state").toBe(restricted + unavailable);
      for (const match of text.matchAll(/<(AccessRestricted|NotAvailableForEvent)\b/g)) {
        expect(text.slice(0, match.index).trimEnd().endsWith(header), `${match[1]} follows the header`).toBe(true);
      }
    });
  }
});
