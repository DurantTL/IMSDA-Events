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
      expect((text.match(/<PageHeader\b/g) ?? []).length).toBe(1);
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
    expect(text).toContain("<PageHeader title={staffPageTitles.imports}");
    expect(text).not.toContain("Build 5 staging");
    expect(text).not.toContain("duplicate-page-title");
    expect(source("app/(workspace)/imports/page.tsx")).toContain("help={<StaffContextualHelp");
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
});
