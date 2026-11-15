import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/staff", useSearchParams: () => new URLSearchParams() }));

import { StaffWorkspace } from "@/components/staff-workspace";

/** #1586: the Team page says what it is for, in one plain line, and sends the other two jobs to their own pages. Synthetic data only. */
describe("Team page ownership line (#1586)", () => {
  const html = renderToStaticMarkup(createElement(StaffWorkspace, { eventId: "event_1", eventName: "Synthetic Camporee", initialMemberships: [], currentUserId: "user-1", currentUserIsSystemAdmin: false, canAddStaff: true }));

  it("says what the page is for once, in the header, and keeps the note to what the header does not say", () => {
    expect(html).toContain("Choose who can work in Synthetic Camporee and the event role each person has.");
    expect(html).toContain('data-testid="team-ownership-note"');
    expect(html).toContain("Remove someone&#x27;s access here when their work on this event is done.");
    expect(html).not.toContain("This page is the team that runs");
    expect(html).not.toContain("choose each person");
  });

  it("says it is not participant staff invitations or System account access", () => {
    expect(html).toContain("participant staff registrations (in Registrations)");
    expect(html).toContain("System account access (see Admin)");
  });

  it("keeps the membership action", () => {
    expect(html).toContain("Add staff");
  });
});
