import { beforeEach, describe, expect, it, vi } from "vitest";

/** Staff training records (#1697) against a mocked database: switching on, the list, add and remove. Synthetic data only. */

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    clubRosterMember: { findMany: vi.fn(), findFirst: vi.fn() },
    clubStaffTrainingRecord: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  };
  return { prisma, writeAuditLog: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { setClubFeature } from "@/modules/club-features/repository";
import {
  StaffTrainingError,
  addStaffTrainingRecord,
  loadStaffTraining,
  removeStaffTrainingRecord,
  staffTrainingAvailable,
} from "@/modules/staff-training/repository";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const now = new Date("2026-11-12T12:00:00.000Z");
const director = clubCapabilities("DIRECTOR");
const registrar = clubCapabilities("REGISTRAR");

const createdRow = (over: Record<string, unknown> = {}) => ({
  id: "record-1", kind: "CERTIFICATION", certificationKey: "COUNSELOR", workshopCode: null, workshopTitle: null,
  completedOn: new Date("2026-01-15T00:00:00.000Z"), signedOffBy: null, createdAt: new Date("2026-11-12T12:00:00.000Z"), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubRosterMember.findFirst.mockResolvedValue({ id: "member-1" });
  mocks.prisma.clubStaffTrainingRecord.create.mockResolvedValue(createdRow());
  mocks.prisma.clubStaffTrainingRecord.deleteMany.mockResolvedValue({ count: 1 });
});

describe("switching the feature on", () => {
  it("is audited with the club, the feature and the director's account", async () => {
    await setClubFeature("club-1", "staff-training-records", true, { accountId: "account-1" });
    expect(mocks.prisma.clubOptionalFeature.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "club-1", featureKey: "staff-training-records", enabledByAccountId: "account-1" }],
      skipDuplicates: true,
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_FEATURE_ENABLED",
      entityId: "club-1",
      summary: "Turned on Staff training records for the club.",
      metadata: { organizationId: "club-1", featureKey: "staff-training-records", actorAttendeeAccountId: "account-1" },
    });
  });

  it("is off, with nothing stored, for a club that never switched it on", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(await staffTrainingAvailable("club-1", director)).toBe(false);
    expect(await loadStaffTraining("club-1", director, now)).toBeNull();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("is available to a director with it on, and never to a registrar", async () => {
    expect(await staffTrainingAvailable("club-1", director)).toBe(true);
    expect(await staffTrainingAvailable("club-1", registrar)).toBe(false);
  });
});

describe("the list", () => {
  it("covers this club year's active adults and staff with a person record, records newest first", async () => {
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([
      { personId: "p2", attendeeType: "STAFF", person: { firstName: "Zed", lastName: "Sample" } },
      { personId: "p1", attendeeType: "ADULT", person: { firstName: "Ann", lastName: "Example" } },
    ]);
    mocks.prisma.clubStaffTrainingRecord.findMany.mockResolvedValue([
      { ...createdRow({ id: "old", completedOn: new Date("2023-05-01T00:00:00.000Z") }), personId: "p1" },
      { ...createdRow({ id: "new", completedOn: new Date("2025-05-01T00:00:00.000Z"), kind: "WORKSHOP", certificationKey: null, workshopCode: "W-101", workshopTitle: "Campfire safety", signedOffBy: "Pat Example" }), personId: "p1" },
    ]);
    const list = await loadStaffTraining("club-1", director, now);
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0].where).toEqual({
      organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE", attendeeType: { in: ["ADULT", "STAFF"] }, personId: { not: null },
    });
    expect(mocks.prisma.clubStaffTrainingRecord.findMany.mock.calls[0]![0].where).toEqual({ organizationId: "club-1", personId: { in: ["p2", "p1"] } });
    expect(list!.people.map((person) => person.lastName)).toEqual(["Example", "Sample"]);
    expect(list!.people[0]!.records.map((record) => record.id)).toEqual(["new", "old"]);
    expect(list!.people[0]!.records[0]).toMatchObject({ label: "W-101 Campfire safety", completedOn: "2025-05-01", signedOffBy: "Pat Example" });
    expect(list!.people[1]!.records).toEqual([]);
  });
});

describe("adding", () => {
  const certification = { personId: "p1", kind: "CERTIFICATION", certificationKey: "COUNSELOR", completedOn: "2026-01-15" } as const;

  it("saves the record for a person on this club's roster and audits it with the actor", async () => {
    await addStaffTrainingRecord("club-1", certification, { accountId: "account-1" }, now);
    expect(mocks.prisma.clubRosterMember.findFirst.mock.calls[0]![0].where).toMatchObject({
      organizationId: "club-1", personId: "p1", clubYear: "2026-27", status: "ACTIVE", attendeeType: { in: ["ADULT", "STAFF"] },
    });
    expect(mocks.prisma.clubStaffTrainingRecord.create.mock.calls[0]![0].data).toMatchObject({
      organizationId: "club-1", personId: "p1", kind: "CERTIFICATION", certificationKey: "COUNSELOR", workshopCode: null, createdByAccountId: "account-1",
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_STAFF_TRAINING_ADDED",
      entityType: "ClubStaffTrainingRecord",
      entityId: "record-1",
      metadata: { organizationId: "club-1", personId: "p1", kind: "CERTIFICATION", certificationKey: "COUNSELOR", actorAttendeeAccountId: "account-1" },
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).not.toHaveProperty("actorUserId");
  });

  it("records a workshop's code and title, and staff acting as the director by user and act-as", async () => {
    mocks.prisma.clubStaffTrainingRecord.create.mockResolvedValue(createdRow({ kind: "WORKSHOP", certificationKey: null, workshopCode: "W-101", workshopTitle: "Campfire safety" }));
    await addStaffTrainingRecord("club-1", { personId: "p1", kind: "WORKSHOP", workshopCode: "W-101", workshopTitle: "Campfire safety", completedOn: "2026-01-15", signedOffBy: "Pat Example" }, { userId: "staff-1", actAsId: "act-1" }, now);
    expect(mocks.prisma.clubStaffTrainingRecord.create.mock.calls[0]![0].data).toMatchObject({
      kind: "WORKSHOP", certificationKey: null, workshopCode: "W-101", workshopTitle: "Campfire safety", signedOffBy: "Pat Example", createdByUserId: "staff-1",
    });
    expect(mocks.prisma.clubStaffTrainingRecord.create.mock.calls[0]![0].data).not.toHaveProperty("createdByAccountId");
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      actorUserId: "staff-1",
      metadata: { kind: "WORKSHOP", workshopCode: "W-101", certificationKey: null, actAsId: "act-1" },
    });
  });

  it("refuses a person who is not an active adult on this club's roster, and writes nothing", async () => {
    mocks.prisma.clubRosterMember.findFirst.mockResolvedValue(null);
    await expect(addStaffTrainingRecord("club-1", certification, { accountId: "account-1" }, now)).rejects.toMatchObject({ code: "PERSON_NOT_ON_ROSTER" });
    expect(mocks.prisma.clubStaffTrainingRecord.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses while the feature is off, and writes nothing", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    await expect(addStaffTrainingRecord("club-1", certification, { accountId: "account-1" }, now)).rejects.toBeInstanceOf(StaffTrainingError);
    expect(mocks.prisma.clubStaffTrainingRecord.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("removing", () => {
  const stored = { id: "record-1", personId: "p1", kind: "WORKSHOP", certificationKey: null, workshopCode: "W-101" };

  it("deletes the club's own record and audits it", async () => {
    mocks.prisma.clubStaffTrainingRecord.findFirst.mockResolvedValue(stored);
    await removeStaffTrainingRecord("club-1", "record-1", { accountId: "account-1" });
    expect(mocks.prisma.clubStaffTrainingRecord.findFirst.mock.calls[0]![0].where).toEqual({ id: "record-1", organizationId: "club-1" });
    expect(mocks.prisma.clubStaffTrainingRecord.deleteMany).toHaveBeenCalledWith({ where: { id: "record-1", organizationId: "club-1" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_STAFF_TRAINING_REMOVED",
      entityId: "record-1",
      metadata: { organizationId: "club-1", personId: "p1", kind: "WORKSHOP", workshopCode: "W-101", actorAttendeeAccountId: "account-1" },
    });
  });

  it("will not remove another club's record (not found), and writes nothing", async () => {
    mocks.prisma.clubStaffTrainingRecord.findFirst.mockResolvedValue(null);
    await expect(removeStaffTrainingRecord("club-1", "record-9", { accountId: "account-1" })).rejects.toMatchObject({ code: "RECORD_NOT_FOUND" });
    expect(mocks.prisma.clubStaffTrainingRecord.deleteMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses while the feature is off", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    await expect(removeStaffTrainingRecord("club-1", "record-1", { accountId: "account-1" })).rejects.toMatchObject({ code: "FEATURE_OFF" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
