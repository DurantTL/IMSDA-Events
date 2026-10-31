import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  grantFind: vi.fn(),
  requireSecondStep: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.grantFind } }) }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveClubsActor: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: vi.fn() }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ requireAttendeeSecondStep: mocks.requireSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: vi.fn() }));

import { requireSecondStepForAreaCoordinator } from "@/modules/organizations/area-coordinators";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "a1" }, via: "attendee", sessionId: "s1" });
});

describe("area pages (#1410)", () => {
  it("sends an Area Coordinator without a real second step to the gate", async () => {
    mocks.grantFind.mockResolvedValue({ revokedAt: null, expiresAt: null });
    await requireSecondStepForAreaCoordinator();
    expect(mocks.requireSecondStep).toHaveBeenCalledOnce();
  });

  it("leaves a club director who is not a coordinator alone, so the page answers 404 at once", async () => {
    mocks.grantFind.mockResolvedValue(null);
    await requireSecondStepForAreaCoordinator();
    mocks.grantFind.mockResolvedValue({ revokedAt: new Date(), expiresAt: null });
    await requireSecondStepForAreaCoordinator();
    expect(mocks.requireSecondStep).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out visitor or a staff act-as", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    await requireSecondStepForAreaCoordinator();
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "a1" }, via: "staff", sessionId: null });
    await requireSecondStepForAreaCoordinator();
    expect(mocks.grantFind).not.toHaveBeenCalled();
  });
});
