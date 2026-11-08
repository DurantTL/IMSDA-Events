import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Caleb, 2026-11-06: a Clubs Administrator acting as an Area Coordinator reaches the area kitchen report like a system
 * administrator acting as one (ADR 0005, Addendum D). Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  eventFindUnique: vi.fn(),
  listRegistrations: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findUnique: mocks.eventFindUnique } }) }));
vi.mock("@/modules/meals/staff-coverage", () => ({ loadStaffMealServiceCounts: async () => [] }));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: mocks.listRegistrations }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => ({ account: null, via: null, sessionId: null }) }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ requireAttendeeSecondStep: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveClubsActor: vi.fn() }));

import { loadAreaKitchenReport } from "@/modules/registrations/kitchen-report-loader";

describe("area kitchen report for a staff Area Coordinator act-as", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventFindUnique.mockResolvedValue({ name: "Test Camporee", audience: "CLUB", isPublished: true });
    mocks.listRegistrations.mockResolvedValue([]);
  });

  it("opens for a Clubs Administrator's act-as, with the same anonymous report", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", organizationId: null, viaClubsAdministrator: true });
    const result = await loadAreaKitchenReport("event-1");
    expect(result?.eventName).toBe("Test Camporee");
    expect(Object.keys(result!.report).sort()).toEqual(["conferenceCovered", "conferenceMealServices", "meals", "needs", "peopleWithNeeds", "totalPeople"]);
  });

  it("stays closed with no act-as, and for a club-director act-as", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    expect(await loadAreaKitchenReport("event-1")).toBeNull();
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-1", viaClubsAdministrator: true });
    expect(await loadAreaKitchenReport("event-1")).toBeNull();
    expect(mocks.listRegistrations).not.toHaveBeenCalled();
  });
});
