import { beforeEach, describe, expect, it, vi } from "vitest";

/** Class and honor certificates (#1696) against a mocked database: switching on, the list and the print re-check. Synthetic data only. */

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    clubRosterMember: { findMany: vi.fn() },
    memberClassCompletion: { findMany: vi.fn() },
  };
  return { prisma, writeAuditLog: vi.fn(), listClubHonorsPage: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/honors/member-honor-repository", () => ({ listClubHonorsPage: mocks.listClubHonorsPage }));

import { setClubFeature } from "@/modules/club-features/repository";
import { clubCertificatesAvailable, loadCertificateSheets, loadClubCertificates } from "@/modules/club-certificates/repository";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const now = new Date("2026-11-12T12:00:00.000Z");
const director = clubCapabilities("DIRECTOR");
const registrar = clubCapabilities("REGISTRAR");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders" });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 1 });
  mocks.listClubHonorsPage.mockResolvedValue([
    { memberId: "m1", firstName: "Ann", lastName: "Example", classLevel: null, honors: [
      { honorId: "h1", honorCode: "A", honorName: "Archery", status: "COMPLETED", completionDate: "2026-10-04", createdAt: "" },
      { honorId: "h2", honorCode: "B", honorName: "Knots", status: "IN_PROGRESS", completionDate: "", createdAt: "" },
    ] },
  ]);
  mocks.prisma.clubRosterMember.findMany.mockResolvedValue([
    { id: "m1", personId: "p1", person: { firstName: "Ann", lastName: "Example" } },
    { id: "m2", personId: "p2", person: { firstName: "Zed", lastName: "Sample" } },
  ]);
  mocks.prisma.memberClassCompletion.findMany.mockResolvedValue([{ personId: "p2", classLevel: "RANGER", completedOn: "2026-06-20" }]);
});

describe("switching the feature on and off", () => {
  it("is audited when switched on, with the club, the feature and the director's account", async () => {
    await setClubFeature("club-1", "completion-certificates", true, { accountId: "account-1" });
    expect(mocks.prisma.clubOptionalFeature.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "club-1", featureKey: "completion-certificates", enabledByAccountId: "account-1" }],
      skipDuplicates: true,
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_FEATURE_ENABLED",
      summary: "Turned on Class and honor certificates for the club.",
      metadata: { organizationId: "club-1", featureKey: "completion-certificates", actorAttendeeAccountId: "account-1" },
    });
  });

  it("is off, with nothing read, for a club that never switched it on, and for a registrar", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(await clubCertificatesAvailable("club-1", director)).toBe(false);
    expect(await loadClubCertificates("club-1", director, now)).toBeNull();
    expect(await loadCertificateSheets("club-1", director, "h:m1:h1", now)).toBeNull();
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
    expect(await clubCertificatesAvailable("club-1", registrar)).toBe(false);
    expect(mocks.listClubHonorsPage).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("holds this club's completed honors and class completions only, with no in-progress honor", async () => {
    const list = await loadClubCertificates("club-1", director, now);
    expect(list?.clubName).toBe("Test Pathfinders");
    expect(list?.candidates.map((item) => item.key)).toEqual(["h:m1:h1", "c:m2:RANGER"]);
    expect(mocks.prisma.memberClassCompletion.findMany.mock.calls[0]![0].where).toEqual({ organizationId: "club-1", personId: { in: ["p1", "p2"] } });
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", status: "ACTIVE" });
  });
});

describe("the print", () => {
  it("keeps current completions here and silently drops anything else", async () => {
    const result = await loadCertificateSheets("club-1", director, "c:m2:RANGER,h:m9:h1,h:m1:h2,h:m1:h1,junk", now);
    expect(result?.sheets.map((item) => item.key)).toEqual(["c:m2:RANGER", "h:m1:h1"]);
  });

  it("reads nothing when no valid item is asked for", async () => {
    const result = await loadCertificateSheets("club-1", director, "junk", now);
    expect(result).toEqual({ clubName: "Test Pathfinders", sheets: [] });
    expect(mocks.listClubHonorsPage).not.toHaveBeenCalled();
  });
});
