import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Member = {
  id: string; clubYear: string; attendeeType: string; isTlt: boolean; status: string; personId: string | null; schoolGrade: string | null;
  reportedAge: number | null; sealedBirthDate: string | null; updatedAt: Date; first: string; last: string; org: { id: string; name: string; type: string; isActive: boolean; church?: string };
};

const state = vi.hoisted(() => ({
  members: [] as unknown[],
  profiles: [] as Array<Record<string, unknown>>,
  positions: [] as Array<{ id: string; name: string; retiredAt: Date | null }>,
  tags: [] as Array<{ id: string; name: string; retiredAt: Date | null; seedKey?: string }>,
  profileTags: [] as Array<{ profileId: string; tagId: string }>,
  audit: vi.fn(),
  rosterFindFirst: vi.fn(),
  answers: [] as Array<Record<string, unknown>>,
  queryRaw: vi.fn(),
  seedTagQueries: 0,
  profileTagCreate: vi.fn(),
  profileUpsert: vi.fn(),
}));

const matches = (member: Record<string, unknown>, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, want]) => {
  if (key === "organization") {
    const org = member.org as Record<string, unknown>;
    return Object.entries(want as Record<string, unknown>).every(([k, v]) => org[k] === v);
  }
  const got = member[key];
  if (want && typeof want === "object" && "not" in (want as object)) return got !== (want as { not: unknown }).not;
  return got === want;
});

const client = {
  clubRosterMember: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => (state.members as Member[])
      .filter((member) => matches(member as unknown as Record<string, unknown>, where))
      .map((member) => ({ ...member, person: { firstName: member.first, lastName: member.last }, organization: { id: member.org.id, name: member.org.name, parentOrganization: member.org.church ? { name: member.org.church } : null } })),
    findFirst: state.rosterFindFirst,
  },
  tltProfile: {
    findMany: async () => state.profiles.map((profile) => ({
      ...profile,
      positionType: state.positions.find((p) => p.id === profile.positionTypeId) ?? null,
      tags: state.profileTags.filter((link) => link.profileId === profile.id).map((link) => ({ tag: { ...state.tags.find((t) => t.id === link.tagId)!, sortOrder: 0 } })),
    })),
    findUnique: vi.fn(async () => null),
    upsert: (...args: unknown[]) => state.profileUpsert(...args),
  },
  tltPositionType: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.positions.find((p) => p.id === where.id) ?? null) },
  tltHelpTag: {
    findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; seedKey?: { in: string[] } } }) => {
      if (where.seedKey) { state.seedTagQueries += 1; return state.tags.filter((t) => where.seedKey!.in.includes(t.seedKey ?? "") && t.retiredAt === null); }
      return state.tags.filter((t) => where.id!.in.includes(t.id) && t.retiredAt === null);
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.tags.find((t) => t.id === where.id) ?? null),
  },
  tltProfileTag: { deleteMany: vi.fn(), createMany: (...args: unknown[]) => state.profileTagCreate(...args) },
  $queryRaw: (...args: unknown[]) => state.queryRaw(...args),
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-tlt-tests" }) }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: state.audit }));

import { Prisma } from "@prisma/client";
import { sealBirthDate } from "@/modules/club-rosters/birth-dates";
import { TltDirectoryError, parseTltFilters } from "@/modules/tlt-directory/domain";
import { acceptTltTagSuggestion, listTltDirectoryRows, recordTltDirectoryView, runTltExport, updateTltProfile } from "@/modules/tlt-directory/repository";

const club = { id: "club-1", name: "Test Pathfinders", type: "CLUB", isActive: true, church: "Sample Church" };
const member = (overrides: Partial<Member>): Member => ({
  id: "m", clubYear: "2026-27", attendeeType: "YOUTH", isTlt: true, status: "ACTIVE", personId: "p", schoolGrade: "GRADE_10", reportedAge: null,
  sealedBirthDate: sealBirthDate("2011-03-04"), updatedAt: new Date("2026-10-01T00:00:00Z"), first: "Casey", last: "Sample", org: club, ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  vi.clearAllMocks();
  state.profiles = [];
  state.answers = [];
  state.seedTagQueries = 0;
  state.queryRaw.mockImplementation(async () => state.answers);
  state.profileUpsert.mockResolvedValue({ id: "profile-1" });
  state.profileTags = [];
  state.positions = [{ id: "pos-1", name: "Outreach", retiredAt: null }, { id: "pos-old", name: "Old", retiredAt: new Date("2026-01-01T00:00:00Z") }];
  state.tags = [{ id: "tag-1", name: "Setup", retiredAt: null, seedKey: "setup" }, { id: "tag-games", name: "Games", retiredAt: null, seedKey: "games" }, { id: "tag-old", name: "Old tag", retiredAt: new Date("2026-01-01T00:00:00Z"), seedKey: "town-crier" }];
  state.members = [
    member({ id: "m1", personId: "p1", first: "Casey", last: "Sample" }),
    member({ id: "m2", personId: "p2", isTlt: false, first: "Notatlt", last: "Member" }),
    member({ id: "m3", personId: "p3", status: "REMOVED", first: "Removed", last: "Member" }),
    member({ id: "m4", personId: "p4", status: "INACTIVE", first: "Inactive", last: "Member" }),
    member({ id: "m5", personId: "p5", attendeeType: "ADULT", first: "Adult", last: "Flagged" }),
    member({ id: "m6", personId: "p6", attendeeType: "STAFF", first: "Staff", last: "Flagged" }),
    member({ id: "m7", personId: "p7", clubYear: "2025-26", first: "Last", last: "Year" }),
    member({ id: "m8", personId: "p8", org: { ...club, id: "club-2", isActive: false }, first: "Closed", last: "Club" }),
    member({ id: "m9", personId: "p9", org: { ...club, id: "club-3", name: "Another Club", church: undefined }, sealedBirthDate: null, reportedAge: 16, schoolGrade: null, first: "Dana", last: "Example" }),
    member({ id: "m10", personId: null, first: "No", last: "Person" }),
  ];
});

afterEach(() => vi.useRealTimers());

describe("who appears in the TLT directory (#1686)", () => {
  it("lists only active youth flagged TLT on an active club's roster for this club year", async () => {
    const rows = await listTltDirectoryRows();
    expect(rows.map((row) => row.name).sort()).toEqual(["Casey Sample", "Dana Example"]);
  });

  it("shows an age and grade, never a birth date or anything sealed", async () => {
    const rows = await listTltDirectoryRows();
    const casey = rows.find((row) => row.personId === "p1")!;
    expect(casey).toMatchObject({ age: 15, grade: "10th grade", clubName: "Test Pathfinders", church: "Sample Church", tltYear: null, status: null, tags: [] });
    const dana = rows.find((row) => row.personId === "p9")!;
    expect(dana).toMatchObject({ age: null, reportedAge: 16, grade: null, church: "" });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("2011");
    expect(dump).not.toMatch(/sealed|birth|schoolType|churchMember/i);
  });

  it("keeps one row per person when two active rows exist, the newest roster row winning", async () => {
    state.members.push(member({ id: "m11", personId: "p1", org: { ...club, id: "club-3", name: "Another Club" }, updatedAt: new Date("2026-11-01T00:00:00Z") }));
    const rows = (await listTltDirectoryRows()).filter((row) => row.personId === "p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clubName).toBe("Another Club");
  });

  it("follows the person: the record is read by person, so a carried-forward roster row keeps it", async () => {
    state.profiles = [{ id: "profile-1", personId: "p1", tltYear: 2, positionTypeId: "pos-1", status: "ACTIVE" }];
    state.profileTags = [{ profileId: "profile-1", tagId: "tag-1" }];
    // The next club year's row is a different roster row for the same Person.
    state.members = [member({ id: "m-next", personId: "p1", clubYear: "2026-27" })];
    const [row] = await listTltDirectoryRows();
    expect(row).toMatchObject({ rosterMemberId: "m-next", tltYear: 2, positionName: "Outreach", status: "ACTIVE", tags: [{ id: "tag-1", name: "Setup" }] });
  });
});

describe("saving a TLT record (#1686)", () => {
  const actor = { accountId: "account-1" };
  const input = { personId: "p1", tltYear: 2 as const, expectedTltYear: null, positionTypeId: "pos-1", status: "ACTIVE" as const, tagIds: ["tag-1"] };

  it("refuses someone who is not a current TLT", async () => {
    state.rosterFindFirst.mockResolvedValue(null);
    await expect(updateTltProfile(input, actor)).rejects.toMatchObject({ code: "NOT_A_TLT" });
    expect(state.profileUpsert).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("looks for an active youth TLT on an active club's roster for the current club year", async () => {
    state.rosterFindFirst.mockResolvedValue(null);
    await updateTltProfile(input, actor).catch(() => undefined);
    expect(state.rosterFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ personId: "p1", clubYear: "2026-27", attendeeType: "YOUTH", isTlt: true, status: "ACTIVE" }),
    }));
  });

  it("will not newly choose a retired position type or tag", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    await expect(updateTltProfile({ ...input, positionTypeId: "pos-old" }, actor)).rejects.toBeInstanceOf(TltDirectoryError);
    await expect(updateTltProfile({ ...input, tagIds: ["tag-old"] }, actor)).rejects.toMatchObject({ code: "TAG_NOT_AVAILABLE" });
    await expect(updateTltProfile({ ...input, positionTypeId: "nope" }, actor)).rejects.toMatchObject({ code: "POSITION_NOT_AVAILABLE" });
    expect(state.profileUpsert).not.toHaveBeenCalled();
  });

  it("saves the four fields only and audits ids, never a name", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    await updateTltProfile(input, actor);
    expect(state.profileUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { personId: "p1", tltYear: 2, tltYearClubYear: "2026-27", positionTypeId: "pos-1", status: "ACTIVE", updatedByAccountId: "account-1" },
    }));
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "TLT_DIRECTORY_PROFILE_UPDATED", entityType: "TltProfile", entityId: "profile-1" });
    expect(entry.metadata).toMatchObject({ actorAttendeeAccountId: "account-1", personId: "p1", changed: ["tltYear", "positionType", "status", "tags"] });
    expect(JSON.stringify(entry)).not.toMatch(/Casey|Sample/);
  });
});

describe("the club year a TLT year applies to (#1686 move-up)", () => {
  const actor = { accountId: "account-1" };
  const existing = { id: "profile-1", tltYear: 2, positionTypeId: null, status: "ACTIVE", tags: [] };
  const base = { personId: "p1", expectedTltYear: 2 as const, positionTypeId: null, status: "ACTIVE" as const, tagIds: [] };

  it("records the current club year when the year changes", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    vi.mocked(client.tltProfile.findUnique).mockResolvedValueOnce(existing as never);
    await updateTltProfile({ ...base, tltYear: 3 }, actor);
    expect(state.profileUpsert.mock.calls[0]![0].update).toMatchObject({ tltYear: 3, tltYearClubYear: "2026-27" });
  });

  it("refuses with YEAR_CHANGED when the stored year is not the one the editor loaded, saving nothing", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    vi.mocked(client.tltProfile.findUnique).mockResolvedValueOnce({ ...existing, tltYear: 3 } as never);
    await expect(updateTltProfile({ ...base, tltYear: 4 }, actor)).rejects.toMatchObject({ code: "YEAR_CHANGED" });
    expect(state.profileUpsert).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("clears it when the year is cleared", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    vi.mocked(client.tltProfile.findUnique).mockResolvedValueOnce(existing as never);
    await updateTltProfile({ ...base, tltYear: null }, actor);
    expect(state.profileUpsert.mock.calls[0]![0].update).toMatchObject({ tltYear: null, tltYearClubYear: null });
  });

  it("leaves it alone when only the status changes", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    vi.mocked(client.tltProfile.findUnique).mockResolvedValueOnce(existing as never);
    await updateTltProfile({ ...base, tltYear: 2, status: "APPROVED" }, actor);
    expect(state.profileUpsert.mock.calls[0]![0].update).not.toHaveProperty("tltYearClubYear");
  });
});

describe("the CSV (#1686)", () => {
  it("is audited with counts and filter keys only, never a search text or a name", async () => {
    const result = await runTltExport(parseTltFilters({ q: "casey", club: "club-1" }), { accountId: "account-1" });
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain("Casey Sample");
    expect(result.csv).toContain("Sample Church");
    expect(result.csv).not.toMatch(/2011|birth/i);
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "TLT_DIRECTORY_EXPORTED", metadata: { actorAttendeeAccountId: "account-1", clubYear: "2026-27", rowCount: 1, filters: ["q", "club"], sort: "name" } });
    expect(JSON.stringify(entry)).not.toMatch(/casey/i);
  });
});

describe("opening the directory (#1686)", () => {
  it("writes one audit row with counts and filter keys only, never a search text or a name", async () => {
    const filters = parseTltFilters({ q: "casey", status: "ACTIVE", sort: "club" });
    await recordTltDirectoryView({ filters, shown: 1, matching: 1, total: 2, page: 1 }, { accountId: "account-1" });
    expect(state.audit).toHaveBeenCalledTimes(1);
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "TLT_DIRECTORY_VIEWED", entityType: "TltProfile", metadata: { actorAttendeeAccountId: "account-1", clubYear: "2026-27", rowsShown: 1, rowsMatching: 1, totalTlts: 2, page: 1, filters: ["q", "status"], sort: "club" } });
    expect(JSON.stringify(entry)).not.toMatch(/casey|sample/i);
  });
});

const answerRow = (overrides: Record<string, unknown>) => ({ personId: "p1", opportunities: null, attendeeCount: BigInt(1), needShirt: null, shirtType: null, shirtSize: null, ...overrides });

describe("TLT Opportunities answers on the directory (#1686)", () => {
  it("offers the mapped tags as suggestions, minus tags the TLT already has and retired tags, and never applies them", async () => {
    state.answers = [answerRow({ opportunities: ["Come early to set up campsites, fire rings, decorations, chairs/pavilion and trash barrels", "Help with games Saturday night", "Town Crier"] })];
    state.profiles = [{ id: "profile-1", personId: "p1", tltYear: null, positionTypeId: null, status: null }];
    state.profileTags = [{ profileId: "profile-1", tagId: "tag-1" }];
    const rows = await listTltDirectoryRows();
    const casey = rows.find((row) => row.personId === "p1")!;
    expect(casey.suggestedTags).toEqual([{ id: "tag-games", name: "Games" }]);
    expect(casey.tags).toEqual([{ id: "tag-1", name: "Setup" }]);
    expect(state.profileTagCreate).not.toHaveBeenCalled();
    expect(state.profileUpsert).not.toHaveBeenCalled();
    expect(rows.find((row) => row.personId === "p9")!.suggestedTags).toEqual([]);
  });

  it("shows the shirt and nothing else from the answers", async () => {
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"], needShirt: "Yes", shirtType: "Polo", shirtSize: "Adult M", health: "synthetic-private-note" })];
    const rows = await listTltDirectoryRows();
    expect(rows.find((row) => row.personId === "p1")!.shirt).toEqual({ needed: true, type: "Polo", size: "Adult M" });
    expect(rows.find((row) => row.personId === "p9")!.shirt).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("synthetic-private-note");
  });

  it("reads the answers in one batched query for every person, plus one tag lookup, not one per row", async () => {
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"] }), answerRow({ personId: "p9", opportunities: ["Town Crier"] })];
    await listTltDirectoryRows();
    expect(state.queryRaw).toHaveBeenCalledTimes(1);
    expect(state.seedTagQueries).toBe(1);
    const sql = state.queryRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(sql.values).toContainEqual(["p1", "p9"]);
    expect(sql.sql).toContain('"SeededFormTemplate"');
    // Only the four answers are pulled out of the stored responses.
    expect(sql.sql.match(/'[A-Za-z_]+'/g)).toEqual(["'leadership_opportunities'", "'need_tlt_shirt'", "'shirt_type'", "'shirt_size'", "'SUBMITTED'", "'CONFIRMED'", "'WAITLISTED'"]);
  });

  it("puts the shirt in the CSV and leaves suggestions out of it", async () => {
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"], needShirt: "Yes", shirtType: "T-Shirt", shirtSize: "Adult L" })];
    const result = await runTltExport(parseTltFilters({ q: "casey" }), { accountId: "account-1" });
    expect(result.headers.slice(-3)).toEqual(["TLT shirt", "Shirt type", "Shirt size"]);
    expect(result.rows[0]!.slice(-3)).toEqual(["Yes", "T-Shirt", "Adult L"]);
    expect(result.csv).not.toContain("Games");
  });
});

describe("accepting a suggested tag (#1686)", () => {
  const actor = { accountId: "account-1" };

  it("adds the tag the answers suggest, creating the record if needed, and audits ids only", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"] })];
    await acceptTltTagSuggestion({ personId: "p1", tagId: "tag-games" }, actor);
    expect(state.profileUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: { personId: "p1", tltYear: null, positionTypeId: null, status: null, updatedByAccountId: "account-1" } }));
    expect(state.profileTagCreate).toHaveBeenCalledWith({ data: [{ profileId: "profile-1", tagId: "tag-games" }], skipDuplicates: true });
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "TLT_DIRECTORY_TAG_SUGGESTION_ACCEPTED", metadata: { actorAttendeeAccountId: "account-1", personId: "p1", tagId: "tag-games" } });
    expect(JSON.stringify(entry)).not.toMatch(/Casey|Sample|Games/);
  });

  it.each([
    ["a tag the answers do not suggest", "tag-1", true],
    ["a retired tag", "tag-old", true],
    ["a tag that does not exist", "nope", true],
    ["a TLT with no answers", "tag-games", false],
  ])("refuses %s", async (_label, tagId, hasAnswers) => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    state.answers = hasAnswers ? [answerRow({ opportunities: ["Help with games Saturday night", "Town Crier"] })] : [];
    await expect(acceptTltTagSuggestion({ personId: "p1", tagId }, actor)).rejects.toMatchObject({ code: "NOT_SUGGESTED" });
    expect(state.profileTagCreate).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("runs again once when two accepts race to create the record (unique index), and then succeeds", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"] })];
    state.profileUpsert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" }));
    await acceptTltTagSuggestion({ personId: "p1", tagId: "tag-games" }, actor);
    expect(state.profileUpsert).toHaveBeenCalledTimes(2);
    expect(state.profileTagCreate).toHaveBeenCalledTimes(1);
    expect(state.audit).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures, or a second unique failure", async () => {
    state.rosterFindFirst.mockResolvedValue({ id: "m1" });
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"] })];
    state.profileUpsert.mockRejectedValue(new Error("down"));
    await expect(acceptTltTagSuggestion({ personId: "p1", tagId: "tag-games" }, actor)).rejects.toThrow("down");
    expect(state.profileUpsert).toHaveBeenCalledTimes(1);
  });

  it("refuses someone who is not a current TLT", async () => {
    state.rosterFindFirst.mockResolvedValue(null);
    state.answers = [answerRow({ opportunities: ["Help with games Saturday night"] })];
    await expect(acceptTltTagSuggestion({ personId: "p1", tagId: "tag-games" }, actor)).rejects.toMatchObject({ code: "NOT_A_TLT" });
    expect(state.profileTagCreate).not.toHaveBeenCalled();
  });
});
