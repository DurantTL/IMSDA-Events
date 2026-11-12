import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Master Guide tracking against a mocked database (#1698): the feature gate, the age rules, the order of the steps, the Area
 * Coordinator's narrow approval and the audit entries. Synthetic data only; the birth-date seal is stubbed (no real dates).
 */

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn(), count: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    clubRosterMember: { findFirst: vi.fn(), findMany: vi.fn() },
    masterGuideCandidate: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  };
  return { prisma, writeAuditLog: vi.fn(), logError: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/modules/club-rosters/birth-dates", () => ({
  openBirthDate: (sealed: string) => {
    if (!sealed.startsWith("sealed:")) throw new Error("cannot open");
    return sealed.replace("sealed:", "");
  },
}));

import { setClubFeature } from "@/modules/club-features/repository";
import { MasterGuideError } from "@/modules/master-guide/domain";
import {
  addCandidate,
  approveForArea,
  approveForClub,
  listAreaApprovalQueue,
  loadMasterGuide,
  removeCandidate,
  updateCandidate,
} from "@/modules/master-guide/repository";

const now = new Date("2026-11-12T15:00:00.000Z");
const director = { accountId: "account-director" };
const staffActing = { userId: "staff-1", actAsId: "act-1" };
const area = { accountId: "account-area" };

/** The club's roster row holds this birth date (sealed form), or none. */
function rosterBirthDate(birthDate: string | null) {
  mocks.prisma.clubRosterMember.findMany.mockResolvedValue(birthDate ? [{ sealedBirthDate: `sealed:${birthDate}` }] : [{ sealedBirthDate: null }]);
}

function candidate(status: string, extra: Record<string, unknown> = {}) {
  return { id: "cand-1", organizationId: "club-1", personId: "person-1", startedOn: new Date("2025-11-01T00:00:00.000Z"), mentorName: "Sam Sample", status, ...extra };
}

async function thrown(work: Promise<unknown>): Promise<MasterGuideError> {
  const error = await work.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(MasterGuideError);
  return error as MasterGuideError;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.prisma.clubRosterMember.findFirst.mockResolvedValue({ id: "member-1" });
  mocks.prisma.masterGuideCandidate.create.mockResolvedValue({ id: "cand-1" });
  mocks.prisma.masterGuideCandidate.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.masterGuideCandidate.deleteMany.mockResolvedValue({ count: 1 });
  rosterBirthDate("1995-05-05");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the feature switch for Master Guide tracking", () => {
  it("is audited like every optional feature, with the club and the feature key", async () => {
    mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 1 });
    await setClubFeature("club-1", "master-guide-tracking", true, director);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_FEATURE_ENABLED",
      entityId: "club-1",
      summary: "Turned on Master Guide tracking for the club.",
      metadata: { organizationId: "club-1", featureKey: "master-guide-tracking", actorAttendeeAccountId: "account-director" },
    });
    mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 1 });
    await setClubFeature("club-1", "master-guide-tracking", false, director);
    expect(mocks.writeAuditLog.mock.calls[1]![0]).toMatchObject({ action: "CLUB_FEATURE_DISABLED" });
  });
});

describe("with the feature off", () => {
  beforeEach(() => mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null));

  it("loads nothing, so the page answers not found", async () => {
    expect(await loadMasterGuide("club-1", now)).toBeNull();
    expect(mocks.prisma.masterGuideCandidate.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["add", () => addCandidate("club-1", { personId: "person-1", startedOn: "2026-01-05" }, director, now)],
    ["update", () => updateCandidate("club-1", "cand-1", { startedOn: "2026-01-05" }, director)],
    ["remove", () => removeCandidate("club-1", "cand-1", director)],
    ["club approval", () => approveForClub("club-1", "cand-1", director, now)],
  ])("refuses to %s and writes nothing", async (_name, run) => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    expect((await thrown(run())).code).toBe("FEATURE_OFF");
    expect(mocks.prisma.masterGuideCandidate.create).not.toHaveBeenCalled();
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.masterGuideCandidate.deleteMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses an Area Coordinator's approval for that club", async () => {
    mocks.prisma.masterGuideCandidate.findUnique.mockResolvedValue(candidate("CLUB_APPROVED"));
    expect((await thrown(approveForArea("cand-1", area, now))).code).toBe("FEATURE_OFF");
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
  });
});

describe("adding a candidate", () => {
  it("adds someone 16 or older on the start date and audits it with the status and no mentor text", async () => {
    await addCandidate("club-1", { personId: "person-1", startedOn: "2026-01-05", mentorName: "Sam Sample" }, director, now);
    expect(mocks.prisma.masterGuideCandidate.create.mock.calls[0]![0].data).toMatchObject({
      organizationId: "club-1", personId: "person-1", status: "IN_PROGRESS", mentorName: "Sam Sample", createdByAccountId: "account-director",
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "MASTER_GUIDE_CANDIDATE_ADDED",
      entityType: "MasterGuideCandidate",
      entityId: "cand-1",
      metadata: { organizationId: "club-1", personId: "person-1", toStatus: "IN_PROGRESS", actorAttendeeAccountId: "account-director" },
    });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0]![0])).not.toContain("Sam Sample");
  });

  it("records staff acting as the director by user and act-as", async () => {
    await addCandidate("club-1", { personId: "person-1", startedOn: "2026-01-05" }, staffActing, now);
    expect(mocks.prisma.masterGuideCandidate.create.mock.calls[0]![0].data).toMatchObject({ createdByUserId: "staff-1" });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "staff-1", metadata: { actAsId: "act-1" } });
  });

  it("refuses someone under 16 on the start date", async () => {
    rosterBirthDate("2011-01-06");
    expect((await thrown(addCandidate("club-1", { personId: "person-1", startedOn: "2026-01-05" }, director, now))).code).toBe("TOO_YOUNG_TO_START");
    expect(mocks.prisma.masterGuideCandidate.create).not.toHaveBeenCalled();
  });

  it("refuses someone with no birth date on the roster, in plain words", async () => {
    rosterBirthDate(null);
    const error = await thrown(addCandidate("club-1", { personId: "person-1", startedOn: "2026-01-05" }, director, now));
    expect(error.code).toBe("BIRTH_DATE_NEEDED");
    expect(error.message).toBe("Birth date needed on the roster.");
  });

  it("refuses someone who is not on this club year's active roster", async () => {
    mocks.prisma.clubRosterMember.findFirst.mockResolvedValue(null);
    expect((await thrown(addCandidate("club-1", { personId: "person-9", startedOn: "2026-01-05" }, director, now))).code).toBe("NOT_ON_ROSTER");
    expect(mocks.prisma.clubRosterMember.findFirst.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", status: "ACTIVE", clubYear: "2026-27" });
  });

  it("says so when the person is already a candidate", async () => {
    const { Prisma } = await import("@prisma/client");
    mocks.prisma.masterGuideCandidate.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
    expect((await thrown(addCandidate("club-1", { personId: "person-1", startedOn: "2026-01-05" }, director, now))).code).toBe("ALREADY_A_CANDIDATE");
  });

  it("does not refuse a start more than three years back: the window only flags", async () => {
    await addCandidate("club-1", { personId: "person-1", startedOn: "2018-01-05" }, director, now);
    expect(mocks.prisma.masterGuideCandidate.create).toHaveBeenCalledTimes(1);
  });
});

describe("changing and removing a candidate", () => {
  it("edits the start date and mentor while in progress, audited with the dates and no mentor text", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    await updateCandidate("club-1", "cand-1", { startedOn: "2025-12-01", mentorName: "Pat Placeholder" }, director);
    expect(mocks.prisma.masterGuideCandidate.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: "cand-1", organizationId: "club-1", status: "IN_PROGRESS" }, data: { mentorName: "Pat Placeholder" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "MASTER_GUIDE_CANDIDATE_UPDATED",
      metadata: { fromStartedOn: "2025-11-01", toStartedOn: "2025-12-01", mentorChanged: true, fromStatus: "IN_PROGRESS", toStatus: "IN_PROGRESS" },
    });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0]![0])).not.toContain("Pat Placeholder");
  });

  it("keeps the age rule when the start date moves", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    rosterBirthDate("2011-01-06");
    expect((await thrown(updateCandidate("club-1", "cand-1", { startedOn: "2026-01-05" }, director))).code).toBe("TOO_YOUNG_TO_START");
  });

  it.each(["CLUB_APPROVED", "AREA_APPROVED"])("does not edit or remove a candidate already %s", async (status) => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate(status));
    expect((await thrown(updateCandidate("club-1", "cand-1", { startedOn: "2025-12-01" }, director))).code).toBe("WRONG_STATUS");
    expect((await thrown(removeCandidate("club-1", "cand-1", director))).code).toBe("WRONG_STATUS");
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.masterGuideCandidate.deleteMany).not.toHaveBeenCalled();
  });

  it("removes an in-progress candidate with an audit entry", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    await removeCandidate("club-1", "cand-1", director);
    expect(mocks.prisma.masterGuideCandidate.deleteMany).toHaveBeenCalledWith({ where: { id: "cand-1", organizationId: "club-1", status: "IN_PROGRESS" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "MASTER_GUIDE_CANDIDATE_REMOVED", metadata: { personId: "person-1", fromStatus: "IN_PROGRESS" } });
  });

  it("finds a candidate only inside the club in the address, so another club's id is not found", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(null);
    expect((await thrown(removeCandidate("club-2", "cand-1", director))).code).toBe("NOT_FOUND");
    expect(mocks.prisma.masterGuideCandidate.findFirst.mock.calls[0]![0].where).toEqual({ id: "cand-1", organizationId: "club-2" });
  });
});

describe("approval by the club", () => {
  it("moves in progress to approved by the club for someone 18 or older today, with the approver and an audit entry", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    await approveForClub("club-1", "cand-1", director, now);
    expect(mocks.prisma.masterGuideCandidate.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "cand-1", organizationId: "club-1", status: "IN_PROGRESS" },
      data: { status: "CLUB_APPROVED", clubApprovedAt: now, clubApprovedByAccountId: "account-director" },
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "MASTER_GUIDE_CLUB_APPROVED",
      metadata: { organizationId: "club-1", personId: "person-1", fromStatus: "IN_PROGRESS", toStatus: "CLUB_APPROVED" },
    });
  });

  it("records staff acting as the director by user", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    await approveForClub("club-1", "cand-1", staffActing, now);
    expect(mocks.prisma.masterGuideCandidate.updateMany.mock.calls[0]![0].data).toMatchObject({ clubApprovedByUserId: "staff-1" });
  });

  it("refuses a candidate who is 17 on the approval date", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    rosterBirthDate("2008-11-13");
    expect((await thrown(approveForClub("club-1", "cand-1", director, now))).code).toBe("TOO_YOUNG_TO_APPROVE");
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a candidate who is no longer on this club year's active roster", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    mocks.prisma.clubRosterMember.findFirst.mockResolvedValue(null);
    expect((await thrown(approveForClub("club-1", "cand-1", director, now))).code).toBe("NOT_ON_ROSTER");
    expect(mocks.prisma.clubRosterMember.findFirst.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", personId: "person-1", status: "ACTIVE", clubYear: "2026-27" });
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("says a birth date could not be read, not that it is missing, when it cannot be opened", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([{ sealedBirthDate: "unopenable" }]);
    const error = await thrown(approveForClub("club-1", "cand-1", director, now));
    expect(error.code).toBe("BIRTH_DATE_UNREADABLE");
    expect(error.message).toContain("could not be read");
    expect(error.message).toContain("conference office");
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("unopenable");
  });

  it("refuses a candidate with no birth date on the roster", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    rosterBirthDate(null);
    expect((await thrown(approveForClub("club-1", "cand-1", director, now))).message).toBe("Birth date needed on the roster.");
  });

  it.each(["CLUB_APPROVED", "AREA_APPROVED"])("cannot approve a candidate that is already %s", async (status) => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate(status));
    expect((await thrown(approveForClub("club-1", "cand-1", director, now))).code).toBe("WRONG_STATUS");
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("loses cleanly when the status changed between the read and the write", async () => {
    mocks.prisma.masterGuideCandidate.findFirst.mockResolvedValue(candidate("IN_PROGRESS"));
    mocks.prisma.masterGuideCandidate.updateMany.mockResolvedValue({ count: 0 });
    expect((await thrown(approveForClub("club-1", "cand-1", director, now))).code).toBe("WRONG_STATUS");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the Area Coordinator's approval", () => {
  it("moves approved by the club to approved by the Area Coordinator, with the approver and an audit entry", async () => {
    mocks.prisma.masterGuideCandidate.findUnique.mockResolvedValue(candidate("CLUB_APPROVED"));
    await approveForArea("cand-1", area, now);
    expect(mocks.prisma.masterGuideCandidate.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "cand-1", status: "CLUB_APPROVED" },
      data: { status: "AREA_APPROVED", areaApprovedAt: now, areaApprovedByAccountId: "account-area" },
    });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "MASTER_GUIDE_AREA_APPROVED",
      metadata: { organizationId: "club-1", personId: "person-1", fromStatus: "CLUB_APPROVED", toStatus: "AREA_APPROVED", actorAttendeeAccountId: "account-area" },
    });
  });

  it("cannot skip the club: an in-progress candidate is refused", async () => {
    mocks.prisma.masterGuideCandidate.findUnique.mockResolvedValue(candidate("IN_PROGRESS"));
    expect((await thrown(approveForArea("cand-1", area, now))).code).toBe("WRONG_STATUS");
    expect(mocks.prisma.masterGuideCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("cannot approve twice", async () => {
    mocks.prisma.masterGuideCandidate.findUnique.mockResolvedValue(candidate("AREA_APPROVED"));
    expect((await thrown(approveForArea("cand-1", area, now))).code).toBe("WRONG_STATUS");
  });

  it("answers not found for a candidate that does not exist, and for a club that is no longer active", async () => {
    mocks.prisma.masterGuideCandidate.findUnique.mockResolvedValue(null);
    expect((await thrown(approveForArea("nope", area, now))).code).toBe("NOT_FOUND");
    mocks.prisma.masterGuideCandidate.findUnique.mockResolvedValue(candidate("CLUB_APPROVED"));
    mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: false });
    expect((await thrown(approveForArea("cand-1", area, now))).code).toBe("NOT_FOUND");
  });

  it("lists only candidates the club approved, in active clubs with the feature on", async () => {
    mocks.prisma.masterGuideCandidate.findMany.mockResolvedValue([{
      id: "cand-1", organizationId: "club-1", startedOn: new Date("2025-11-01T00:00:00.000Z"), mentorName: null, clubApprovedAt: new Date("2026-11-01T12:00:00.000Z"),
      person: { firstName: "Casey", lastName: "Sample" }, organization: { name: "Test Pathfinders" },
    }]);
    const rows = await listAreaApprovalQueue(now);
    expect(mocks.prisma.masterGuideCandidate.findMany.mock.calls[0]![0].where).toEqual({
      status: "CLUB_APPROVED",
      organization: { type: "CLUB", isActive: true, guestEventId: null, clubOptionalFeatures: { some: { featureKey: "master-guide-tracking" } } },
    });
    expect(rows).toEqual([expect.objectContaining({ id: "cand-1", clubName: "Test Pathfinders", name: "Casey Sample", clubApprovedOn: "2026-11-01" })]);
    // No birth date or age ever reaches the coordinator's rows.
    expect(JSON.stringify(rows)).not.toMatch(/birth|age/i);
  });
});

describe("the club's list", () => {
  it("shows candidates with their window and lists who can be added: 16 or older with a birth date, and who needs one", async () => {
    mocks.prisma.masterGuideCandidate.findMany.mockResolvedValue([{
      id: "cand-1", personId: "person-1", startedOn: new Date("2025-11-01T00:00:00.000Z"), mentorName: "Sam Sample", status: "IN_PROGRESS", clubApprovedAt: null, areaApprovedAt: null,
      person: { firstName: "Casey", lastName: "Sample" },
    }]);
    const member = (personId: string, firstName: string, birth: string | null, clubYear = "2026-27") => ({
      personId, clubYear, sealedBirthDate: birth ? `sealed:${birth}` : null, person: { firstName, lastName: "Roster" },
    });
    mocks.prisma.clubRosterMember.findMany.mockResolvedValue([
      member("person-1", "Casey", "1990-01-01"),
      member("person-2", "Adult", "1985-02-02"),
      member("person-3", "Teen", "2012-02-02"),
      member("person-4", "Nodate", null),
    ]);
    const list = await loadMasterGuide("club-1", now);
    expect(list!.rows[0]).toMatchObject({ name: "Casey Sample", startedOn: "2025-11-01", window: { earliestFinish: "2026-11-01", latestFinish: "2028-11-01", pastWindow: false }, approvalProblem: null });
    expect(list!.eligible).toEqual([{ personId: "person-2", name: "Adult Roster" }]);
    expect(list!.needBirthDate).toEqual(["Nodate Roster"]);
    expect(list!.unreadableBirthDate).toEqual([]);
    expect(JSON.stringify(list)).not.toContain("1990-01-01");
  });
});
