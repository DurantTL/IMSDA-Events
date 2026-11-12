import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  grantCount: vi.fn(),
  rosterFindMany: vi.fn(),
  honorFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  orgFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
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
const both = { canAdministerClub: true, clubsAdministration: true };

beforeEach(() => {
  vi.clearAllMocks();
  db.grantCount.mockResolvedValue(2);
  db.rosterFindMany.mockResolvedValue([{ personId: "p1" }]);
  db.honorFindMany.mockResolvedValue([{ personId: "p1", honorId: "h1", status: "COMPLETED", void: null }]);
  db.reportFindMany.mockResolvedValue([{ reportMonth: "2026-09" }]);
  db.orgFindUnique.mockResolvedValue({ createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null });
});

describe("loadClubCardStatuses (#1587)", () => {
  it("reads the current admins, honors and records for the club year", async () => {
    expect(await loadClubCardStatuses("club-1", "2026-27", both, now)).toEqual({ admins: 2, honors: 1, records: { submitted: 1, missing: 1 } });
    const where = db.grantCount.mock.calls[0]![0].where;
    expect(where).toMatchObject({ organizationId: "club-1", revokedAt: null, effectiveFrom: { lte: now } });
    expect(db.rosterFindMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE" });
    expect(db.reportFindMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", clubYear: "2026-27", status: "SUBMITTED" });
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
