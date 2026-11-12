import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Profile = { personId: string; tltYear: number | null; tltYearClubYear: string | null; status: string | null };

const state = vi.hoisted(() => ({
  roster: [] as string[],
  profiles: [] as Array<{ personId: string; tltYear: number | null; tltYearClubYear: string | null; status: string | null }>,
  audit: vi.fn(),
  rosterWhere: undefined as unknown,
}));

/** Applies the same conditional update the repository sends, so a second run sees the first one's result. */
const client = {
  clubRosterMember: {
    findMany: async ({ where }: { where: { personId: { in: string[] } } }) => {
      state.rosterWhere = where;
      return state.roster.filter((id) => where.personId.in.includes(id)).map((personId) => ({ personId }));
    },
  },
  tltProfile: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { tltYear: { increment: number }; tltYearClubYear: string } }) => {
      const clubYear = ((where.AND as Array<{ OR: Array<Record<string, unknown>> }>)[1]!.OR[1]!.tltYearClubYear as { lt: string }).lt;
      const found = state.profiles.find((p: Profile) => p.personId === where.personId
        && [1, 2, 3].includes(p.tltYear ?? 0)
        && p.status !== "FINISHED" && p.status !== "LEFT"
        && (p.tltYearClubYear === null || p.tltYearClubYear < clubYear));
      if (!found) return { count: 0 };
      found.tltYear = (found.tltYear ?? 0) + data.tltYear.increment;
      found.tltYearClubYear = data.tltYearClubYear;
      return { count: 1 };
    },
  },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: state.audit }));

import { confirmTltMoveUp } from "@/modules/tlt-directory/repository";

const actor = { accountId: "account-1" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T15:00:00Z"));
  vi.clearAllMocks();
  state.roster = ["p1", "p2", "p3", "p4"];
  state.profiles = [
    { personId: "p1", tltYear: 1, tltYearClubYear: "2025-26", status: "ACTIVE" },
    { personId: "p2", tltYear: 3, tltYearClubYear: null, status: null },
    { personId: "p3", tltYear: 4, tltYearClubYear: "2025-26", status: "ACTIVE" },
    { personId: "p4", tltYear: 2, tltYearClubYear: "2026-27", status: "ACTIVE" },
  ];
});
afterEach(() => vi.useRealTimers());

describe("confirming the TLT move-up (#1686)", () => {
  it("moves the eligible, skips the rest, and records the club year", async () => {
    const result = await confirmTltMoveUp({ clubYear: "2026-27", personIds: ["p1", "p2", "p3", "p4", "p-gone"] }, actor);
    expect(result).toEqual({ moved: 2, skipped: 3 });
    expect(state.profiles.map((p) => [p.personId, p.tltYear, p.tltYearClubYear])).toEqual([
      ["p1", 2, "2026-27"], ["p2", 4, "2026-27"], ["p3", 4, "2025-26"], ["p4", 2, "2026-27"],
    ]);
  });

  it("moves nobody twice when the same request is sent again", async () => {
    await confirmTltMoveUp({ clubYear: "2026-27", personIds: ["p1", "p2"] }, actor);
    const second = await confirmTltMoveUp({ clubYear: "2026-27", personIds: ["p1", "p2"] }, actor);
    expect(second).toEqual({ moved: 0, skipped: 2 });
    expect(state.profiles.find((p) => p.personId === "p1")!.tltYear).toBe(2);
    expect(state.profiles.find((p) => p.personId === "p2")!.tltYear).toBe(4);
  });

  it("skips a TLT who is no longer a current TLT on a club roster", async () => {
    state.roster = ["p2"];
    const result = await confirmTltMoveUp({ clubYear: "2026-27", personIds: ["p1", "p2"] }, actor);
    expect(result).toEqual({ moved: 1, skipped: 1 });
    expect(state.profiles.find((p) => p.personId === "p1")!.tltYear).toBe(1);
    expect(state.rosterWhere).toMatchObject({ clubYear: "2026-27" });
  });

  it("skips someone who finished or left since the page opened", async () => {
    state.profiles[0]!.status = "FINISHED";
    state.profiles[1]!.status = "LEFT";
    expect(await confirmTltMoveUp({ clubYear: "2026-27", personIds: ["p1", "p2"] }, actor)).toEqual({ moved: 0, skipped: 2 });
  });

  it("answers a stale club year with STALE_CLUB_YEAR and changes nothing", async () => {
    await expect(confirmTltMoveUp({ clubYear: "2025-26", personIds: ["p1"] }, actor)).rejects.toMatchObject({ code: "STALE_CLUB_YEAR" });
    expect(state.profiles[0]!.tltYear).toBe(1);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("writes one audit row with ids and counts only, never a name", async () => {
    await confirmTltMoveUp({ clubYear: "2026-27", personIds: ["p1", "p2", "p3"] }, actor);
    expect(state.audit).toHaveBeenCalledTimes(1);
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({
      action: "TLT_YEAR_MOVE_UP_CONFIRMED",
      entityType: "TltProfile",
      metadata: { actorAttendeeAccountId: "account-1", clubYear: "2026-27", movedCount: 2, skippedCount: 1, movedPersonIds: ["p1", "p2"] },
    });
    expect(Object.keys(entry.metadata).sort()).toEqual(["actorAttendeeAccountId", "clubYear", "movedCount", "movedPersonIds", "skippedCount"]);
  });
});
