import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Recording, reusing and voiding printed certificates, and the public lookup (#2052), against a mocked database. Synthetic data only. */

const mocks = vi.hoisted(() => {
  const prisma = {
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn() },
    clubRosterMember: { findMany: vi.fn() },
    memberClassCompletion: { findMany: vi.fn() },
    clubCertificate: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  };
  return { prisma, writeAuditLog: vi.fn(), listClubHonorsPage: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/honors/member-honor-repository", () => ({ listClubHonorsPage: mocks.listClubHonorsPage }));

import { findCertificateForCheck, loadCertificateSheets, loadClubCertificates, voidClubCertificate } from "@/modules/club-certificates/repository";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const now = new Date("2026-11-12T12:00:00.000Z");
const director = clubCapabilities("DIRECTOR");
const registrar = clubCapabilities("REGISTRAR");
const actor = { accountId: "account-1" };
const staffActor = { userId: "staff-1", actAsId: "act-1" };
const uniqueError = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
const ACTIVE_KEY = "club-1|p1|HONOR|h1|2026-10-04";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.organization.findUnique.mockResolvedValue({ name: "Test Pathfinders" });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.listClubHonorsPage.mockResolvedValue([
    { memberId: "m1", firstName: "Ann", lastName: "Example", classLevel: null, honors: [
      { honorId: "h1", honorCode: "A", honorName: "Archery", status: "COMPLETED", completionDate: "2026-10-04", createdAt: "", recordedAtOrganizationId: "club-1" },
    ] },
  ]);
  mocks.prisma.clubRosterMember.findMany.mockResolvedValue([{ id: "m1", personId: "p1", person: { firstName: "Ann", lastName: "Example" } }]);
  mocks.prisma.memberClassCompletion.findMany.mockResolvedValue([]);
  mocks.prisma.clubCertificate.findMany.mockResolvedValue([]);
  mocks.prisma.clubCertificate.findUnique.mockResolvedValue(null);
  let made = 0;
  mocks.prisma.clubCertificate.create.mockImplementation(async ({ data }: { data: { code: string } }) => ({ id: `cert-${++made}`, code: data.code }));
});

describe("printing records a certificate", () => {
  it("makes one record with an 8-character number, a snapshot of what was printed, and the director who printed it", async () => {
    const result = await loadCertificateSheets("club-1", director, "h:m1:h1", actor, now);
    const created = mocks.prisma.clubCertificate.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ organizationId: "club-1", personId: "p1", kind: "HONOR", refId: "h1", title: "Archery", completedOn: "2026-10-04", clubName: "Test Pathfinders", activeKey: ACTIVE_KEY, issuedByAccountId: "account-1" });
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(result?.sheets).toHaveLength(1);
    expect(result?.sheets[0]).toMatchObject({ key: "h:m1:h1", code: created.code });
  });

  it("records a staff user acting as the director by user id, and audits the print with ids only", async () => {
    await loadCertificateSheets("club-1", director, "h:m1:h1", staffActor, now);
    expect(mocks.prisma.clubCertificate.create.mock.calls[0]![0].data).toMatchObject({ issuedByUserId: "staff-1" });
    expect(mocks.prisma.clubCertificate.create.mock.calls[0]![0].data).not.toHaveProperty("issuedByAccountId");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "CLUB_CERTIFICATES_ISSUED", actorUserId: "staff-1", metadata: { organizationId: "club-1", count: 1, certificateIds: ["cert-1"], actAsId: "act-1" } });
    expect(JSON.stringify(entry)).not.toMatch(/Ann|Example|Archery/);
  });

  it("reuses the same number on a reprint, creating and auditing nothing", async () => {
    mocks.prisma.clubCertificate.findMany.mockResolvedValue([{ activeKey: ACTIVE_KEY, code: "ABCD2345" }]);
    const result = await loadCertificateSheets("club-1", director, "h:m1:h1", actor, now);
    expect(result?.sheets[0]?.code).toBe("ABCD2345");
    expect(mocks.prisma.clubCertificate.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.prisma.clubCertificate.findMany.mock.calls[0]![0].where).toEqual({ activeKey: { in: [ACTIVE_KEY] } });
  });

  it("issues a new number after a certificate was voided, because only valid ones are looked up", async () => {
    // A voided row has no activeKey, so the lookup by key finds nothing and a new record is made.
    const result = await loadCertificateSheets("club-1", director, "h:m1:h1", actor, now);
    expect(mocks.prisma.clubCertificate.create).toHaveBeenCalledTimes(1);
    expect(result?.sheets[0]?.code).toBeTruthy();
  });

  it("uses the winner's number when two prints race for the same completion", async () => {
    mocks.prisma.clubCertificate.create.mockRejectedValueOnce(uniqueError());
    mocks.prisma.clubCertificate.findUnique.mockResolvedValueOnce({ code: "WINNER23" });
    const result = await loadCertificateSheets("club-1", director, "h:m1:h1", actor, now);
    expect(result?.sheets[0]?.code).toBe("WINNER23");
    expect(mocks.prisma.clubCertificate.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.clubCertificate.findUnique).toHaveBeenCalledWith({ where: { activeKey: ACTIVE_KEY }, select: { code: true } });
  });

  it("draws another number when the number collides", async () => {
    mocks.prisma.clubCertificate.create.mockRejectedValueOnce(uniqueError());
    const result = await loadCertificateSheets("club-1", director, "h:m1:h1", actor, now);
    expect(mocks.prisma.clubCertificate.create).toHaveBeenCalledTimes(2);
    expect(result?.sheets).toHaveLength(1);
  });

  it("gives up with a plain error when every number collides, and lets other errors through", async () => {
    mocks.prisma.clubCertificate.create.mockRejectedValue(uniqueError());
    await expect(loadCertificateSheets("club-1", director, "h:m1:h1", actor, now)).rejects.toThrow("could not be made");
    mocks.prisma.clubCertificate.create.mockReset();
    mocks.prisma.clubCertificate.create.mockRejectedValue(new Error("database down"));
    await expect(loadCertificateSheets("club-1", director, "h:m1:h1", actor, now)).rejects.toThrow("database down");
  });

  it("records nothing for a club without the feature, for a registrar, and for items that are not current completions", async () => {
    expect(await loadCertificateSheets("club-1", registrar, "h:m1:h1", actor, now)).toBeNull();
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(await loadCertificateSheets("club-1", director, "h:m1:h1", actor, now)).toBeNull();
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
    const result = await loadCertificateSheets("club-1", director, "h:m9:h1,junk", actor, now);
    expect(result?.sheets).toEqual([]);
    expect(mocks.prisma.clubCertificate.create).not.toHaveBeenCalled();
  });
});

describe("the printed certificates list", () => {
  it("is this club's, newest first, capped, with the full count", async () => {
    mocks.prisma.clubCertificate.count.mockResolvedValue(73);
    mocks.prisma.clubCertificate.findMany.mockResolvedValue([
      { id: "c1", code: "ABCD2345", title: "Archery", kind: "HONOR", completedOn: "2026-10-04", issuedAt: new Date("2026-11-01T10:00:00Z"), voidedAt: null, person: { firstName: "Ann", lastName: "Example" } },
      { id: "c2", code: "WXYZ6789", title: "Explorer Class", kind: "CLASS", completedOn: "2026-06-20", issuedAt: new Date("2026-10-01T10:00:00Z"), voidedAt: new Date("2026-10-02T10:00:00Z"), person: { firstName: "Zed", lastName: "Sample" } },
    ]);
    const list = await loadClubCertificates("club-1", director, now);
    const query = mocks.prisma.clubCertificate.findMany.mock.calls[0]![0];
    expect(query).toMatchObject({ where: { organizationId: "club-1" }, take: 50, orderBy: [{ issuedAt: "desc" }, { id: "desc" }] });
    expect(mocks.prisma.clubCertificate.count).toHaveBeenCalledWith({ where: { organizationId: "club-1" } });
    expect(list?.issued.total).toBe(73);
    expect(list?.issued.rows.map((row) => [row.code, row.voidedAt])).toEqual([["ABCD2345", null], ["WXYZ6789", "2026-10-02T10:00:00.000Z"]]);
  });
});

describe("voiding", () => {
  it("voids only a valid certificate of this club: clears the key, keeps the row, records who and audits it", async () => {
    mocks.prisma.clubCertificate.updateMany.mockResolvedValue({ count: 1 });
    expect(await voidClubCertificate("club-1", "cert-9", director, actor, now)).toBe(true);
    expect(mocks.prisma.clubCertificate.updateMany).toHaveBeenCalledWith({
      where: { id: "cert-9", organizationId: "club-1", voidedAt: null },
      data: { voidedAt: now, activeKey: null, voidedByAccountId: "account-1" },
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "CLUB_CERTIFICATE_VOIDED", entityId: "cert-9", metadata: { organizationId: "club-1", certificateId: "cert-9", actorAttendeeAccountId: "account-1" } });
  });

  it("records staff acting as the director by user id", async () => {
    mocks.prisma.clubCertificate.updateMany.mockResolvedValue({ count: 1 });
    await voidClubCertificate("club-1", "cert-9", director, staffActor, now);
    expect(mocks.prisma.clubCertificate.updateMany.mock.calls[0]![0].data).toMatchObject({ voidedByUserId: "staff-1" });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "staff-1" });
  });

  it("does nothing, and says nothing, for another club's certificate or one already voided", async () => {
    mocks.prisma.clubCertificate.updateMany.mockResolvedValue({ count: 0 });
    expect(await voidClubCertificate("club-1", "cert-of-club-2", director, actor, now)).toBe(false);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("is refused before any write for a registrar and for a club with the feature off", async () => {
    expect(await voidClubCertificate("club-1", "cert-9", registrar, actor, now)).toBe(false);
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(await voidClubCertificate("club-1", "cert-9", director, actor, now)).toBe(false);
    expect(mocks.prisma.clubCertificate.updateMany).not.toHaveBeenCalled();
  });
});

describe("the public lookup", () => {
  it("reads only the check fields, by the normalized number, with no feature or club check", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    mocks.prisma.clubCertificate.findUnique.mockResolvedValue({ kind: "HONOR", title: "Archery", completedOn: "2026-10-04", clubName: "Test Pathfinders", voidedAt: null });
    const found = await findCertificateForCheck("abcd-2345");
    expect(found).toMatchObject({ title: "Archery" });
    expect(mocks.prisma.clubCertificate.findUnique).toHaveBeenCalledWith({ where: { code: "ABCD2345" }, select: { kind: true, title: true, completedOn: true, clubName: true, voidedAt: true } });
    expect(mocks.prisma.clubOptionalFeature.findUnique).not.toHaveBeenCalled();
  });

  it("does not touch the database for a malformed number, and returns null for an unknown one", async () => {
    expect(await findCertificateForCheck("nope")).toBeNull();
    expect(mocks.prisma.clubCertificate.findUnique).not.toHaveBeenCalled();
    expect(await findCertificateForCheck("ABCD2345")).toBeNull();
  });
});

describe("a person with printed certificates is never renamed in place", () => {
  it("counts certificates in the amendment's only-this-attendee check", () => {
    expect(readFileSync("modules/registrations/amendments-repository.ts", "utf8")).toContain("clubCertificates: true");
  });
});
