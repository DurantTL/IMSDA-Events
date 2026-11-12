import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  grantCount: vi.fn(),
  rosterFindMany: vi.fn(),
  honorFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  orgFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubDirectorGrant: { count: db.grantCount },
    clubRosterMember: { findMany: db.rosterFindMany },
    memberHonorEntry: { findMany: db.honorFindMany },
    clubMonthlyReport: { findMany: db.reportFindMany },
    organization: { findUnique: db.orgFindUnique },
  }),
}));

import { loadClubCardStatuses } from "@/modules/club-reports/club-card-statuses";

const now = new Date("2026-11-12T15:00:00Z");
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterAll(() => { vi.useRealTimers(); });
const both = { canAdministerClub: true, clubsAdministration: true };

beforeEach(() => {
  vi.clearAllMocks();
  db.grantCount.mockResolvedValue(2);
  db.rosterFindMany.mockResolvedValue([{ personId: "p1" }]);
  db.honorFindMany.mockResolvedValue([{ personId: "p1", honorId: "h1", status: "COMPLETED", void: null }]);
  db.reportFindMany.mockResolvedValue([{ reportMonth: "2026-09", status: "SUBMITTED", totalPoints: 100, onTimePoints: 50 }]);
  db.orgFindUnique.mockResolvedValue({ createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null });
});

describe("loadClubCardStatuses (#1587)", () => {
  it("reads the current admins, honors and records for the club year", async () => {
    expect(await loadClubCardStatuses("club-1", "2026-27", both, now)).toEqual({ admins: 2, honors: 1, records: { submitted: 1, missing: 1 } });
    const where = db.grantCount.mock.calls[0]![0].where;
    expect(where).toMatchObject({ organizationId: "club-1", revokedAt: null, effectiveFrom: { lte: now } });
    expect(db.rosterFindMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE" });
    expect(db.reportFindMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", clubYear: "2026-27", });
  });

  it("does not count an overdue draft as missing, and counts honors for the year the Honors page shows", async () => {
    db.reportFindMany.mockResolvedValue([
      { reportMonth: "2026-09", status: "SUBMITTED", totalPoints: 100, onTimePoints: 50 },
      { reportMonth: "2026-10", status: "DRAFT", totalPoints: 0, onTimePoints: 0 },
    ]);
    expect((await loadClubCardStatuses("club-1", "2026-27", both, now)).records).toEqual({ submitted: 1, missing: 0 });
    // 2024-25 is outside previous/current/next: the page falls back to the current year, so does the count
    await loadClubCardStatuses("club-1", "2024-25", both, now);
    expect(db.rosterFindMany.mock.calls.at(-1)![0].where).toMatchObject({ clubYear: "2026-27" });
    await loadClubCardStatuses("club-1", "2025-26", both, now);
    expect(db.rosterFindMany.mock.calls.at(-1)![0].where).toMatchObject({ clubYear: "2025-26" });
  });

  it("makes no read for a card the viewer cannot see", async () => {
    expect(await loadClubCardStatuses("club-1", "2026-27", { canAdministerClub: false, clubsAdministration: true }, now)).toEqual({ records: { submitted: 1, missing: 1 } });
    expect(db.grantCount).not.toHaveBeenCalled();
    expect(db.honorFindMany).not.toHaveBeenCalled();
    vi.clearAllMocks();
    expect(await loadClubCardStatuses("club-1", "2026-27", { canAdministerClub: true, clubsAdministration: false }, now)).toEqual({ admins: 2, honors: 1 });
    expect(db.reportFindMany).not.toHaveBeenCalled();
    expect(await loadClubCardStatuses("club-1", "2026-27", { canAdministerClub: false, clubsAdministration: false }, now)).toEqual({});
    expect(await loadClubCardStatuses("club-1", "2026-27", { ...both, clubActive: false }, now)).toMatchObject({ admins: 2 });
    expect((await loadClubCardStatuses("club-1", "2026-27", { ...both, clubActive: false }, now)).records).toBeUndefined();
  });

  it("marks only the failed read as null", async () => {
    db.grantCount.mockRejectedValue(new Error("down"));
    db.reportFindMany.mockRejectedValue(new Error("down"));
    expect(await loadClubCardStatuses("club-1", "2026-27", both, now)).toEqual({ admins: null, honors: 1, records: null });
  });

  it("counts zero honors without reading entries when the roster has no linked people", async () => {
    db.rosterFindMany.mockResolvedValue([]);
    expect((await loadClubCardStatuses("club-1", "2026-27", both, now)).honors).toBe(0);
    expect(db.honorFindMany).not.toHaveBeenCalled();
  });
});
