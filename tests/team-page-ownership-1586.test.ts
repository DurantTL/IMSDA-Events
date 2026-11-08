import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/staff", useSearchParams: () => new URLSearchParams() }));

import { StaffWorkspace } from "@/components/staff-workspace";

/** #1586: the Team page says what it is for, in one plain line, and sends the other two jobs to their own pages. Synthetic data only. */
describe("Team page ownership line (#1586)", () => {
  const html = renderToStaticMarkup(createElement(StaffWorkspace, { eventId: "event_1", eventName: "Synthetic Camporee", initialMemberships: [], currentUserId: "user-1", currentUserIsSystemAdmin: false, canAddStaff: true }));

  it("says the page is the event's staff team and what each person can do", () => {
    expect(html).toContain('data-testid="team-ownership-note"');
    expect(html).toContain("This page is the team that runs Synthetic Camporee.");
    expect(html).toContain("choose each person");
  });

  it("says it is not participant staff invitations or System account access", () => {
    expect(html).toContain("participant staff registrations (see Registrations, Review queues, Staff invitations)");
    expect(html).toContain("System account access (see Admin)");
  });

  it("keeps the membership action", () => {
    expect(html).toContain("Add staff");
  });
});
