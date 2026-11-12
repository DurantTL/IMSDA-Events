import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Profile = { personId: string; tltYear: number | null; tltYearClubYear: string | null; status: string | null };

const state = vi.hoisted(() => ({
  roster: [] as string[],
  profiles: [] as Array<{ personId: string; tltYear: number | null; tltYearClubYear: string | null; status: string | null }>,
  audit: vi.fn(),
  rosterWhere: undefined as unknown,
}));

/**
 * Applies the same conditional update the repository sends (the SQL's values are, in order: club year, account, ids, club
 * year), so a second run sees the first one's result. The real statement is run against PostgreSQL by
 * scripts/verify-tlt-move-up.ts.
 */
const client = {
  clubRosterMember: {
    findMany: async ({ where }: { where: { personId: { in: string[] } } }) => {
      state.rosterWhere = where;
      return state.roster.filter((id) => where.personId.in.includes(id)).map((personId) => ({ personId }));
    },
  },
  $queryRaw: async (sql: { sql: string; values: unknown[] }) => {
    const [clubYear, , ids] = sql.values as [string, string, string[]];
    const moving = sql.sql.includes('"tltYear" + 1');
    const rows: Array<{ personId: string }> = [];
    for (const p of state.profiles as Profile[]) {
      if (!ids.includes(p.personId)) continue;
      if (![1, 2, 3].includes(p.tltYear ?? 0) || p.status === "FINISHED" || p.status === "LEFT") continue;
      if (!(p.tltYearClubYear === null || p.tltYearClubYear < clubYear)) continue;
      if (moving) p.tltYear = (p.tltYear ?? 0) + 1;
      p.tltYearClubYear = clubYear;
      rows.push({ personId: p.personId });
    }
    return rows;
  },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: state.audit }));

import { confirmTltMoveUp, recordTltMoveUpView } from "@/modules/tlt-directory/repository";

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
  const get = (id: string) => state.profiles.find((p) => p.personId === id)!;

  it("moves the ticked eligible, skips the rest, and records the club year", async () => {
    const result = await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1", "p2", "p3", "p4", "p-gone"], keepIds: [] }, actor);
    expect(result).toEqual({ moved: 2, kept: 0, skipped: 3 });
    expect(state.profiles.map((p) => [p.personId, p.tltYear, p.tltYearClubYear])).toEqual([
      ["p1", 2, "2026-27"], ["p2", 4, "2026-27"], ["p3", 4, "2025-26"], ["p4", 2, "2026-27"],
    ]);
  });

  it("holds the unticked at their year for this club year, so they are not offered again", async () => {
    const result = await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1"], keepIds: ["p2", "p3", "p4"] }, actor);
    expect(result).toEqual({ moved: 1, kept: 1, skipped: 2 });
    expect([get("p1").tltYear, get("p2").tltYear, get("p2").tltYearClubYear]).toEqual([2, 3, "2026-27"]);
    expect(get("p3")).toMatchObject({ tltYear: 4, tltYearClubYear: "2025-26" });
  });

  it("allows a confirm with no moves when someone is kept", async () => {
    expect(await confirmTltMoveUp({ clubYear: "2026-27", moveIds: [], keepIds: ["p1"] }, actor)).toEqual({ moved: 0, kept: 1, skipped: 0 });
    expect(get("p1")).toMatchObject({ tltYear: 1, tltYearClubYear: "2026-27" });
  });

  it("moves nobody twice when the same request is sent again", async () => {
    await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1", "p2"], keepIds: [] }, actor);
    const second = await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1", "p2"], keepIds: [] }, actor);
    expect(second).toEqual({ moved: 0, kept: 0, skipped: 2 });
    expect(get("p1").tltYear).toBe(2);
    expect(get("p2").tltYear).toBe(4);
  });

  it("skips a TLT who is no longer a current TLT on a club roster", async () => {
    state.roster = ["p2"];
    const result = await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1", "p2"], keepIds: [] }, actor);
    expect(result).toEqual({ moved: 1, kept: 0, skipped: 1 });
    expect(get("p1").tltYear).toBe(1);
    expect(state.rosterWhere).toMatchObject({ clubYear: "2026-27" });
  });

  it("skips someone who finished or left since the page opened", async () => {
    state.profiles[0]!.status = "FINISHED";
    state.profiles[1]!.status = "LEFT";
    expect(await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1"], keepIds: ["p2"] }, actor)).toEqual({ moved: 0, kept: 0, skipped: 2 });
  });

  it("answers a stale club year with STALE_CLUB_YEAR and changes nothing", async () => {
    await expect(confirmTltMoveUp({ clubYear: "2025-26", moveIds: ["p1"], keepIds: [] }, actor)).rejects.toMatchObject({ code: "STALE_CLUB_YEAR" });
    expect(get("p1").tltYear).toBe(1);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("writes one audit row with ids and counts only, never a name", async () => {
    await confirmTltMoveUp({ clubYear: "2026-27", moveIds: ["p1", "p2"], keepIds: ["p3", "p4"] }, actor);
    expect(state.audit).toHaveBeenCalledTimes(1);
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({
      action: "TLT_YEAR_MOVE_UP_CONFIRMED",
      entityType: "TltProfile",
      metadata: { actorAttendeeAccountId: "account-1", clubYear: "2026-27", movedCount: 2, keptCount: 0, skippedCount: 2, movedPersonIds: ["p1", "p2"], keptPersonIds: [] },
    });
    expect(Object.keys(entry.metadata).sort()).toEqual(["actorAttendeeAccountId", "clubYear", "keptCount", "keptPersonIds", "movedCount", "movedPersonIds", "skippedCount"]);
  });
});

describe("opening the move-up page (#1686)", () => {
  it("writes one audit row with counts only", async () => {
    await recordTltMoveUpView({ clubYear: "2026-27", proposed: [{ personId: "p1", name: "Casey Sample", clubName: "Test", fromYear: 1, toYear: 2 }], lastLevel: [], notSet: [], alreadyThisYear: 3 }, actor);
    const entry = state.audit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "TLT_YEAR_MOVE_UP_VIEWED", metadata: { clubYear: "2026-27", proposedCount: 1, lastLevelCount: 0, notSetCount: 0, alreadyThisYearCount: 3 } });
    expect(JSON.stringify(entry)).not.toMatch(/Casey|Sample|p1/);
  });
});
