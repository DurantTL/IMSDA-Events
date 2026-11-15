import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ClubRosterCharts } from "@/components/club-roster-charts";
import type { RosterChartsView } from "@/modules/club-roster-charts/repository";

const view = (birthdayView: RosterChartsView["birthdayView"]): RosterChartsView => ({
  clubYear: "2026-27",
  peopleCount: 2,
  byClassLevel: [],
  bySchoolGrade: [],
  byMemberType: [],
  attendance: [],
  birthdayView,
});

describe("roster charts while birth dates are locked (#1652)", () => {
  it("shows a locked note instead of age groups and birthdays", () => {
    const html = renderToStaticMarkup(createElement(ClubRosterCharts, { action: "/x", view: view({ month: 10, ageBands: [], birthdays: [], locked: true }) }));
    expect(html).toContain("Locked: the personal-data key is unavailable right now");
    expect(html).not.toContain("Members by age group");
    expect(html).not.toContain("Birthdays in");
  });

  it("shows them as usual when not locked", () => {
    const html = renderToStaticMarkup(createElement(ClubRosterCharts, { action: "/x", view: view({ month: 10, ageBands: [], birthdays: [], locked: false }) }));
    expect(html).not.toContain("Locked:");
    expect(html).toContain("Birthdays in October");
  });
});
