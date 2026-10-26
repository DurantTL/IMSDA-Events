import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1221: who counts as an active Area Coordinator for sending links. Real grant rules, synthetic accounts. */
const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  grantFindUnique: vi.fn(),
  currentStaffActingContext: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.grantFindUnique } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/club-rosters/access", () => ({ requireRosterAccess: vi.fn() }));

import { requireAreaCoordinatorViewer } from "@/modules/club-forms/access";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-2" }, via: "attendee", sessionId: "s-1" });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
});

describe("an Area Coordinator for sending club form links (#1221)", () => {
  it("accepts an active grant", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
    await expect(requireAreaCoordinatorViewer()).resolves.toEqual({ kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } });
  });

  it("accepts a grant whose end is still ahead", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date("2026-10-27T00:00:00Z") });
    await expect(requireAreaCoordinatorViewer()).resolves.toMatchObject({ kind: "AREA_COORDINATOR" });
  });

  it("refuses a revoked grant", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null });
    await expect(requireAreaCoordinatorViewer()).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an expired grant", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date("2026-10-25T00:00:00Z") });
    await expect(requireAreaCoordinatorViewer()).rejects.toMatchObject({ status: 403 });
  });

  it("refuses someone with no grant, and someone who has not passed the second step", async () => {
    mocks.grantFindUnique.mockResolvedValue(null);
    await expect(requireAreaCoordinatorViewer()).rejects.toMatchObject({ status: 403 });
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
    mocks.accountNeedsSecondStep.mockResolvedValue("SETUP");
    await expect(requireAreaCoordinatorViewer()).rejects.toMatchObject({ status: 403 });
  });

  it("accepts a system administrator acting as an Area Coordinator, but not as a club director", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "admin-1", actAsId: "act-2" });
    await expect(requireAreaCoordinatorViewer()).resolves.toEqual({ kind: "AREA_COORDINATOR", actor: { kind: "STAFF_ACTING", userId: "admin-1", actAsId: "act-2" } });
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", userId: "admin-1", actAsId: "act-3" });
    await expect(requireAreaCoordinatorViewer()).rejects.toMatchObject({ status: 403 });
  });
});
