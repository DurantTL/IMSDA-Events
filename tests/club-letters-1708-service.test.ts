import { beforeEach, describe, expect, it, vi } from "vitest";

/** Fill-in letters (#1708) against a mocked database: switching on, the list, create, change, delete and printing. Synthetic data only. */

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    clubRosterMember: { findMany: vi.fn() },
    clubLetterTemplate: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  };
  return { prisma, writeAuditLog: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { setClubFeature } from "@/modules/club-features/repository";
import {
  ClubLetterError,
  clubLettersAvailable,
  createClubLetter,
  deleteClubLetter,
  loadClubLetterSheets,
  loadClubLetters,
  updateClubLetter,
} from "@/modules/club-letters/repository";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const now = new Date("2026-11-12T12:00:00.000Z");
const director = clubCapabilities("DIRECTOR");
const registrar = clubCapabilities("REGISTRAR");
const account = { accountId: "account-1" };
const input = { kind: "LETTER", title: "Welcome", body: "Dear {first_name}," } as const;
const row = (over: Record<string, unknown> = {}) => ({ id: "letter-1", kind: "LETTER", title: "Welcome", body: "Dear {first_name} {last_name} of {club_name}", updatedAt: new Date("2026-11-12T12:00:00.000Z"), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders" });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubLetterTemplate.count.mockResolvedValue(0);
  mocks.prisma.clubLetterTemplate.create.mockResolvedValue(row());
  mocks.prisma.clubLetterTemplate.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubLetterTemplate.findFirst.mockResolvedValue(row());
  mocks.prisma.clubLetterTemplate.deleteMany.mockResolvedValue({ count: 1 });
});

describe("switching the feature on and off", () => {
  it("is audited when it is switched on, with the club, the feature and the director's account", async () => {
    await setClubFeature("club-1", "fill-in-letters", true, account);
    expect(mocks.prisma.clubOptionalFeature.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "club-1", featureKey: "fill-in-letters", enabledByAccountId: "account-1" }],
      skipDuplicates: true,
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_FEATURE_ENABLED",
      entityId: "club-1",
      summary: "Turned on Fill-in letters and certificates for the club.",
      metadata: { organizationId: "club-1", featureKey: "fill-in-letters", actorAttendeeAccountId: "account-1" },
    });
  });

  it("is audited when it is switched off, and writes nothing when nothing changed", async () => {
    await setClubFeature("club-1", "fill-in-letters", false, { userId: "staff-1", actAsId: "act-1" });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "CLUB_FEATURE_DISABLED", actorUserId: "staff-1", metadata: { featureKey: "fill-in-letters", actAsId: "act-1" } });
    mocks.writeAuditLog.mockClear();
    mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 0 });
    await setClubFeature("club-1", "fill-in-letters", false, account);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("is off, with nothing read, for a club that never switched it on", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(await clubLettersAvailable("club-1", director)).toBe(false);
    expect(await loadClubLetters("club-1", director, now)).toBeNull();
    expect(mocks.prisma.clubLetterTemplate.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("is available to a director with it on, and never to a registrar", async () => {
    expect(await clubLettersAvailable("club-1", director)).toBe(true);
    expect(await clubLettersAvailable("club-1", registrar)).toBe(false);
  });
});

describe("the list", () => {
  it("holds this club's templates and this club year's active roster, once each, by last name", async () => {
    mocks.prisma.clubLetterTemplate.findMany.mockResolvedValue([row()]);
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([
      { personId: "p2", attendeeType: "STAFF", person: { firstName: "Zed", lastName: "Sample" } },
      { personId: "p1", attendeeType: "YOUTH", person: { firstName: "Ann", lastName: "Example" } },
      { personId: "p1", attendeeType: "YOUTH", person: { firstName: "Ann", lastName: "Example" } },
    ]);
    const list = await loadClubLetters("club-1", director, now);
    expect(mocks.prisma.clubLetterTemplate.findMany.mock.calls[0]![0].where).toEqual({ organizationId: "club-1" });
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0].where).toEqual({ organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE", personId: { not: null } });
    expect(list!.letters).toEqual([{ id: "letter-1", kind: "LETTER", title: "Welcome", body: row().body, updatedAt: "2026-11-12T12:00:00.000Z" }]);
    expect(list!.people.map((person) => person.lastName)).toEqual(["Example", "Sample"]);
    expect(list!.people.map((person) => person.typeLabel)).toEqual(["Youth", "Staff"]);
  });
});

describe("creating", () => {
  it("saves the template and audits it with the actor", async () => {
    const created = await createClubLetter("club-1", input, account);
    expect(created.id).toBe("letter-1");
    expect(mocks.prisma.clubLetterTemplate.create.mock.calls[0]![0].data).toEqual({ organizationId: "club-1", kind: "LETTER", title: "Welcome", body: "Dear {first_name},", createdByAccountId: "account-1" });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_LETTER_CREATED",
      entityType: "ClubLetterTemplate",
      entityId: "letter-1",
      metadata: { organizationId: "club-1", kind: "LETTER", actorAttendeeAccountId: "account-1" },
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).not.toHaveProperty("actorUserId");
  });

  it("attributes staff acting as the director by user and act-as, and a Clubs Administrator as one", async () => {
    await createClubLetter("club-1", input, { userId: "staff-1", actAsId: "act-1", viaClubsAdministrator: true });
    const data = mocks.prisma.clubLetterTemplate.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ createdByUserId: "staff-1" });
    expect(data).not.toHaveProperty("createdByAccountId");
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "staff-1", metadata: { actAsId: "act-1", actorRole: "CLUBS_ADMINISTRATOR" } });
  });

  it("refuses the 51st template and writes nothing", async () => {
    mocks.prisma.clubLetterTemplate.count.mockResolvedValue(50);
    await expect(createClubLetter("club-1", input, account)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect(mocks.prisma.clubLetterTemplate.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses while the feature is off, and writes nothing", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    await expect(createClubLetter("club-1", input, account)).rejects.toBeInstanceOf(ClubLetterError);
    expect(mocks.prisma.clubLetterTemplate.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("changing", () => {
  it("changes only this club's template and audits it", async () => {
    await updateClubLetter("club-1", "letter-1", { ...input, kind: "CERTIFICATE" }, account);
    expect(mocks.prisma.clubLetterTemplate.updateMany).toHaveBeenCalledWith({ where: { id: "letter-1", organizationId: "club-1" }, data: { kind: "CERTIFICATE", title: "Welcome", body: "Dear {first_name}," } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "CLUB_LETTER_UPDATED", entityId: "letter-1", metadata: { organizationId: "club-1", actorAttendeeAccountId: "account-1" } });
  });

  it("will not change another club's template (not found), and writes nothing", async () => {
    mocks.prisma.clubLetterTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateClubLetter("club-1", "letter-9", input, account)).rejects.toMatchObject({ code: "LETTER_NOT_FOUND" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses while the feature is off", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    await expect(updateClubLetter("club-1", "letter-1", input, account)).rejects.toMatchObject({ code: "FEATURE_OFF" });
    expect(mocks.prisma.clubLetterTemplate.updateMany).not.toHaveBeenCalled();
  });
});

describe("deleting", () => {
  it("keeps the typed title out of the audit entry", async () => {
    await createClubLetter("club-1", input, account);
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0]![0])).not.toContain("Welcome");
  });

  it("deletes the club's own template and audits it", async () => {
    mocks.prisma.clubLetterTemplate.findFirst.mockResolvedValue({ id: "letter-1", kind: "CERTIFICATE", title: "Thanks" });
    await deleteClubLetter("club-1", "letter-1", account);
    expect(mocks.prisma.clubLetterTemplate.deleteMany).toHaveBeenCalledWith({ where: { id: "letter-1", organizationId: "club-1" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_LETTER_DELETED",
      entityId: "letter-1",
      metadata: { organizationId: "club-1", kind: "CERTIFICATE", actorAttendeeAccountId: "account-1" },
    });
  });

  it("will not delete another club's template, and writes nothing", async () => {
    mocks.prisma.clubLetterTemplate.findFirst.mockResolvedValue(null);
    await expect(deleteClubLetter("club-1", "letter-9", account)).rejects.toMatchObject({ code: "LETTER_NOT_FOUND" });
    expect(mocks.prisma.clubLetterTemplate.deleteMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses while the feature is off", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    await expect(deleteClubLetter("club-1", "letter-1", account)).rejects.toMatchObject({ code: "FEATURE_OFF" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("printing", () => {
  it("fills in one page per person kept, asking the roster only for the people named, this year, active", async () => {
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([
      { personId: "p2", attendeeType: "STAFF", person: { firstName: "Zed", lastName: "Sample" } },
      { personId: "p1", attendeeType: "YOUTH", person: { firstName: "Ann", lastName: "Example" } },
    ]);
    const result = await loadClubLetterSheets("club-1", director, "letter-1", "p1,p2,outsider", now);
    expect(mocks.prisma.clubLetterTemplate.findFirst.mock.calls[0]![0].where).toEqual({ id: "letter-1", organizationId: "club-1" });
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0].where).toEqual({
      organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE", personId: { in: ["p1", "p2", "outsider"] },
    });
    expect(result!.kind).toBe("LETTER");
    expect(result!.sheets).toEqual([
      { personId: "p1", name: "Ann Example", text: "Dear Ann Example of Test Pathfinders" },
      { personId: "p2", name: "Zed Sample", text: "Dear Zed Sample of Test Pathfinders" },
    ]);
  });

  it("silently drops anyone the roster does not return, and prints nothing when nobody is left", async () => {
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([]);
    expect((await loadClubLetterSheets("club-1", director, "letter-1", "outsider", now))!.sheets).toEqual([]);
    mocks.prisma.clubRosterMember.findMany.mockClear();
    expect((await loadClubLetterSheets("club-1", director, "letter-1", undefined, now))!.sheets).toEqual([]);
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("caps a print at 200 people", async () => {
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([]);
    await loadClubLetterSheets("club-1", director, "letter-1", Array.from({ length: 250 }, (_, i) => `p${i}`).join(","), now);
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0].where.personId.in).toHaveLength(200);
  });

  it("is nothing for another club's template, a registrar, or a club with the feature off", async () => {
    mocks.prisma.clubLetterTemplate.findFirst.mockResolvedValue(null);
    expect(await loadClubLetterSheets("club-1", director, "letter-of-club-2", "p1", now)).toBeNull();
    mocks.prisma.clubLetterTemplate.findFirst.mockResolvedValue(row());
    expect(await loadClubLetterSheets("club-1", registrar, "letter-1", "p1", now)).toBeNull();
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(await loadClubLetterSheets("club-1", director, "letter-1", "p1", now)).toBeNull();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });
});
