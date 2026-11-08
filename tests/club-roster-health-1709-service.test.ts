import { beforeEach, describe, expect, it, vi } from "vitest";

/** The optional feature switch and the roster health list (#1709), against a mocked database. Synthetic data only. */

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    clubRosterMember: { findMany: vi.fn() },
    clubFormTemplate: { findUnique: vi.fn() },
    clubFormSubmission: { findMany: vi.fn() },
  };
  return {
    prisma,
    writeAuditLog: vi.fn(),
    healthRecordsEnabled: vi.fn(),
    healthRecordFlagsForRoster: vi.fn(),
    clubRosterComplianceStatuses: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: mocks.healthRecordsEnabled }));
vi.mock("@/modules/health-records/repository", () => ({ healthRecordFlagsForRoster: mocks.healthRecordFlagsForRoster }));
vi.mock("@/modules/background-checks/repository", () => ({ clubRosterComplianceStatuses: mocks.clubRosterComplianceStatuses }));

import { ClubFeatureError, isClubFeatureEnabled, listEnabledClubFeatures, setClubFeature } from "@/modules/club-features/repository";
import { HEALTH_RECORD_NOT_CHECKED, PHOTO_RELEASE_NOT_CHECKED, loadRosterHealth, loadRosterHealthCounts } from "@/modules/club-features/roster-health";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const now = new Date("2026-11-08T12:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const director = clubCapabilities("DIRECTOR");
const deputy = clubCapabilities("DEPUTY");
const registrar = clubCapabilities("REGISTRAR");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
  mocks.prisma.clubOptionalFeature.findMany.mockResolvedValue([]);
  mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 1 });
  mocks.healthRecordsEnabled.mockReturnValue(true);
  mocks.healthRecordFlagsForRoster.mockResolvedValue({});
  mocks.clubRosterComplianceStatuses.mockResolvedValue({ statuses: {}, notInCompliance: 0, expiringSoon: 0, missing: 0 });
  mocks.prisma.clubFormTemplate.findUnique.mockResolvedValue({ enabled: true });
  mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([]);
});

describe("the optional feature switch", () => {
  it("is off for a club with no row, and lists nothing", async () => {
    expect(await isClubFeatureEnabled("club-1", "roster-health-flags")).toBe(false);
    expect(await listEnabledClubFeatures("club-1")).toEqual([]);
  });

  it("lists only the keys the typed list knows", async () => {
    mocks.prisma.clubOptionalFeature.findMany.mockResolvedValue([{ featureKey: "roster-health-flags" }, { featureKey: "retired-thing" }]);
    expect(await listEnabledClubFeatures("club-1")).toEqual(["roster-health-flags"]);
  });

  it("switches on with an audit entry naming the club, the feature and the director's account, and no person", async () => {
    await setClubFeature("club-1", "roster-health-flags", true, { accountId: "account-1" });
    expect(mocks.prisma.clubOptionalFeature.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "club-1", featureKey: "roster-health-flags", enabledByAccountId: "account-1" }],
      skipDuplicates: true,
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_FEATURE_ENABLED",
      entityType: "ClubOptionalFeature",
      entityId: "club-1",
      metadata: { organizationId: "club-1", featureKey: "roster-health-flags", actorAttendeeAccountId: "account-1" },
    });
  });

  it("records a staff user acting as the director by user id and act-as", async () => {
    await setClubFeature("club-1", "roster-health-flags", true, { userId: "staff-1", actAsId: "act-1" });
    expect(mocks.prisma.clubOptionalFeature.createMany.mock.calls[0]![0].data[0]).toMatchObject({ enabledByUserId: "staff-1" });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "staff-1", metadata: { actAsId: "act-1" } });
  });

  it("switches off with its own audit entry", async () => {
    await setClubFeature("club-1", "roster-health-flags", false, { accountId: "account-1" });
    expect(mocks.prisma.clubOptionalFeature.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "club-1", featureKey: "roster-health-flags" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "CLUB_FEATURE_DISABLED" });
  });

  it("writes no audit entry when nothing changed", async () => {
    mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 0 });
    await setClubFeature("club-1", "roster-health-flags", true, { accountId: "account-1" });
    mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 0 });
    await setClubFeature("club-1", "roster-health-flags", false, { accountId: "account-1" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a church, an inactive club or a missing organization as not found", async () => {
    for (const club of [{ type: "CHURCH", isActive: true }, { type: "CLUB", isActive: false }, null]) {
      mocks.prisma.organization.findUnique.mockResolvedValue(club);
      await expect(setClubFeature("club-1", "roster-health-flags", true, { accountId: "account-1" })).rejects.toBeInstanceOf(ClubFeatureError);
    }
    expect(mocks.prisma.clubOptionalFeature.createMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

type Stamp = { createdAt: Date; updatedAt: Date };
function member(id: string, overrides: Partial<{ attendeeType: string; createdAt: Date; updatedAt: Date; guardians: Array<{ name: string; relationship: string; email: string; phone: string } & Stamp> }> = {}) {
  const createdAt = overrides.createdAt ?? day("2026-09-01");
  return {
    id,
    personId: `person-${id}`,
    attendeeType: overrides.attendeeType ?? "YOUTH",
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    person: { firstName: `First${id}`, lastName: `Last${id}` },
    guardians: overrides.guardians ?? [{ name: "Pat Sample", relationship: "Parent", email: "", phone: "(515) 555-0100", createdAt, updatedAt: createdAt }],
  };
}
/** The two roster queries: this year's active rows, then every year's rows for the same people. */
function rosterIs(rows: ReturnType<typeof member>[], history?: Array<{ personId: string } & Stamp & { guardians: Stamp[] }>) {
  mocks.prisma.clubRosterMember.findMany
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(history ?? rows.map((row) => ({ personId: row.personId, createdAt: row.createdAt, updatedAt: row.updatedAt, guardians: row.guardians })));
}
function featureOn() {
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
}

describe("loadRosterHealth", () => {
  it("shows nothing new for a club that has not switched it on: no list, no counts, and no roster read", async () => {
    expect(await loadRosterHealth("club-1", director, now)).toBeNull();
    expect(await loadRosterHealthCounts("club-1", director, now)).toBeNull();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("gives a registrar nothing even when the club has it on, before reading anything", async () => {
    featureOn();
    expect(await loadRosterHealth("club-1", registrar, now)).toBeNull();
    expect(mocks.prisma.clubOptionalFeature.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("gives the director and the deputy the same list when it is on", async () => {
    featureOn();
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }]);
    rosterIs([member("a", { guardians: [] })]);
    const asDirector = await loadRosterHealth("club-1", director, now);
    rosterIs([member("a", { guardians: [] })]);
    const asDeputy = await loadRosterHealth("club-1", deputy, now);
    expect(asDirector?.rows.map((row) => row.flags)).toEqual([["NO_EMERGENCY_CONTACT"]]);
    expect(asDeputy).toEqual(asDirector);
  });

  it("lists nobody when everything is on file, and counts the people checked", async () => {
    featureOn();
    rosterIs([member("a"), member("b")]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true, b: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }, { rosterMemberId: "b" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows).toEqual([]);
    expect(list?.counts.people).toBe(2);
    expect(list?.counts.flagged).toBe(0);
    expect(list?.notChecked).toEqual([]);
  });

  it("flags a person not updated in over a year, using the last real edit across years", async () => {
    featureOn();
    const row = member("a", { createdAt: day("2026-08-20"), updatedAt: day("2026-08-20") });
    rosterIs([row], [
      { personId: row.personId, createdAt: day("2024-09-10"), updatedAt: day("2025-02-01"), guardians: [] },
      { personId: row.personId, createdAt: day("2026-08-20"), updatedAt: day("2026-08-20"), guardians: [] },
    ]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows).toHaveLength(1);
    expect(list?.rows[0]).toMatchObject({ id: "a", flags: ["OUTDATED"], lastUpdated: "2025-02-01T12:00:00.000Z" });
  });

  it("flags a missing emergency contact, and treats an all-blank contact as missing", async () => {
    featureOn();
    const blank = { name: " ", relationship: "", email: "", phone: "", createdAt: day("2026-09-01"), updatedAt: day("2026-09-01") };
    rosterIs([member("a", { guardians: [] }), member("b", { guardians: [blank] }), member("c")]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true, b: true, c: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }, { rosterMemberId: "b" }, { rosterMemberId: "c" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows.map((row) => [row.id, row.flags])).toEqual([["a", ["NO_EMERGENCY_CONTACT"]], ["b", ["NO_EMERGENCY_CONTACT"]]]);
  });

  it("flags a missing health record from the existing presence check only", async () => {
    featureOn();
    rosterIs([member("a"), member("b")]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ b: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }, { rosterMemberId: "b" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows.map((row) => [row.id, row.flags])).toEqual([["a", ["NO_HEALTH_RECORD"]]]);
    expect(mocks.healthRecordFlagsForRoster).toHaveBeenCalledWith("club-1", ["a", "b"]);
  });

  it("says health records are not checked, and flags none, while the Health Record feature is off", async () => {
    featureOn();
    mocks.healthRecordsEnabled.mockReturnValue(false);
    rosterIs([member("a")]);
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows).toEqual([]);
    expect(list?.notChecked).toEqual([{ flag: "NO_HEALTH_RECORD", reason: HEALTH_RECORD_NOT_CHECKED }]);
    expect(mocks.healthRecordFlagsForRoster).not.toHaveBeenCalled();
  });

  it("flags a missing photo release for a minor with a submitted release missing, ignoring other people's", async () => {
    featureOn();
    rosterIs([member("a"), member("b"), member("c", { attendeeType: "STAFF" })]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true, b: true, c: true });
    mocks.clubRosterComplianceStatuses.mockResolvedValue({ statuses: { c: { state: "CLEAR", note: null, reasons: [] } }, notInCompliance: 0, expiringSoon: 0, missing: 0 });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows.map((row) => [row.id, row.flags])).toEqual([["b", ["NO_PHOTO_RELEASE"]]]);
    // Only submitted releases of this club's members count.
    expect(mocks.prisma.clubFormSubmission.findMany.mock.calls[0]![0].where).toMatchObject({
      organizationId: "club-1",
      status: "SUBMITTED",
      template: { key: "pathfinder_photo_video_release" },
      rosterMemberId: { in: ["a", "b", "c"] },
    });
  });

  it("says photo releases are not checked while the release form is off", async () => {
    featureOn();
    mocks.prisma.clubFormTemplate.findUnique.mockResolvedValue({ enabled: false });
    rosterIs([member("a")]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true });
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows).toEqual([]);
    expect(list?.notChecked).toEqual([{ flag: "NO_PHOTO_RELEASE", reason: PHOTO_RELEASE_NOT_CHECKED }]);
  });

  it("flags a missing Sterling check only for an adult with no record, not a flagged or expired one", async () => {
    featureOn();
    rosterIs([member("a", { attendeeType: "STAFF" }), member("b", { attendeeType: "ADULT" }), member("c", { attendeeType: "STAFF" }), member("d")]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true, b: true, c: true, d: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "d" }]);
    mocks.clubRosterComplianceStatuses.mockResolvedValue({
      statuses: {
        a: { state: "NO_RECORD", note: null, reasons: [] },
        b: { state: "NOT_COMPLIANT", note: null, reasons: [] },
        c: { state: "CLEAR", note: null, reasons: [] },
      },
      notInCompliance: 1,
      expiringSoon: 0,
      missing: 1,
    });
    const list = await loadRosterHealth("club-1", director, now);
    expect(list?.rows.map((row) => [row.id, row.flags])).toEqual([["a", ["NO_STERLING_CHECK"]]]);
    // Notes are never asked for.
    expect(mocks.clubRosterComplianceStatuses).toHaveBeenCalledWith("club-1", "2026-27", { includeNotes: false });
  });

  it("returns only that something is missing: names, type and a date, never a record's contents", async () => {
    featureOn();
    rosterIs([member("a", { guardians: [] })]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }]);
    const list = await loadRosterHealth("club-1", director, now);
    expect(Object.keys(list!.rows[0]!).sort()).toEqual(["attendeeType", "firstName", "flags", "id", "lastName", "lastUpdated", "typeLabel"]);
    expect(JSON.stringify(list)).not.toContain("555");
    expect(JSON.stringify(list)).not.toContain("Pat Sample");
  });

  it("reads only this club's active roster for the current club year", async () => {
    featureOn();
    rosterIs([member("a")]);
    await loadRosterHealth("club-1", director, now);
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0].where).toEqual({ organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE" });
    expect(mocks.prisma.clubRosterMember.findMany.mock.calls[1]![0].where).toMatchObject({ organizationId: "club-1" });
  });

  it("counts for Home match the list", async () => {
    featureOn();
    rosterIs([member("a", { guardians: [] }), member("b")]);
    mocks.healthRecordFlagsForRoster.mockResolvedValue({ a: true, b: true });
    mocks.prisma.clubFormSubmission.findMany.mockResolvedValue([{ rosterMemberId: "a" }, { rosterMemberId: "b" }]);
    const counts = await loadRosterHealthCounts("club-1", director, now);
    expect(counts?.counts).toMatchObject({ people: 2, flagged: 1, byFlag: { NO_EMERGENCY_CONTACT: 1 } });
  });
});
