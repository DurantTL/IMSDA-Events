import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PeopleWorkspace } from "@/components/people-workspace";
import { helpGuides } from "@/modules/help/guides";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
}));

describe("Registrations list order (#1747)", () => {
  const markup = renderToStaticMarkup(createElement(PeopleWorkspace, {
    eventId: "event-1",
    eventSlug: "synthetic-event",
    eventTimezone: "America/Chicago",
    waitlistEnabled: false,
    initialRegistrations: [],
    canEdit: false,
    canEmail: false,
    filtersAfterSearch: createElement("p", null, "ADVANCED-FILTERS-MARKER"),
    helpSlot: createElement("p", null, "HELP-MARKER"),
  }));

  it("puts the simple search first and the filters after it", () => {
    expect(markup.indexOf("Search people")).toBeGreaterThan(-1);
    expect(markup.indexOf("Search people")).toBeLessThan(markup.indexOf("ADVANCED-FILTERS-MARKER"));
  });

  it("keeps Help in the actions row and the expected count on the count line", () => {
    const counts = markup.indexOf("expected");
    expect(markup.indexOf("HELP-MARKER")).toBeGreaterThan(markup.indexOf("intro-actions"));
    expect(markup.indexOf("HELP-MARKER")).toBeLessThan(counts);
    expect(markup.slice(markup.lastIndexOf('<div class="', counts), counts)).toContain("countLine");
  });

  it("no longer carries the explanatory paragraph on the page", () => {
    expect(markup).not.toContain("Review each party");
    expect(markup).not.toContain("Registration hub");
  });

  it("renders the advanced search through the workspace, not above it, and keeps the words in Help", () => {
    const page = readFileSync("app/(workspace)/people/page.tsx", "utf8");
    expect(page.indexOf("filtersAfterSearch")).toBeGreaterThan(-1);
    expect(page.indexOf("<OperationsSearchBar")).toBeGreaterThan(page.indexOf("filtersAfterSearch"));
    const guide = helpGuides.find((entry) => entry.id === "find-a-registration");
    expect(guide?.steps.join(" ")).toContain("Advanced search");
    expect(page).toContain('guideId="find-a-registration"');
  });

  it("keeps the count and the sort note on one line", () => {
    expect(readFileSync("components/people-list.module.css", "utf8")).toMatch(/\.countLine \{[^}]*display: flex;[^}]*flex-wrap: wrap/);
  });
});
