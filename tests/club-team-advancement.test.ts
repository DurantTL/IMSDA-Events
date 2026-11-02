import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);

/**
 * Teams advance from Area to Conference and Union inside one event (#945): the placement rule with ties, staff overrides that
 * survive a recompute and are audited with ids only, the Conference list and its exports, level-aware check-in, the notices that
 * are queued only when staff press "Send notices", the between-levels edit window, and staff-only permissions. Session,
 * membership and database are stubbed; the domain, the repositories and the permission checks are real.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  processQueued: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: mocks.processQueued }));

import { POST as postNotices, GET as getNoticePreview } from "@/app/api/events/[eventId]/team-results/notices/route";
import { POST as postRecompute } from "@/app/api/events/[eventId]/team-results/recompute/route";
import { PUT as putCheckIn } from "@/app/api/events/[eventId]/team-results/[registrationId]/check-in/route";
import { GET as getRoster } from "@/app/api/events/[eventId]/team-results/roster/route";
import { GET as getResults } from "@/app/api/events/[eventId]/team-results/route";
import { sendAdvancementNotices } from "@/modules/club-teams/advancement-notices";
import { listLevelTeams, setTeamLevelCheckIn, splitTeamPeople } from "@/modules/club-teams/level-repository";
import { recomputeAdvancement, saveTeamResult } from "@/modules/club-teams/results-repository";
import {
  advancementNotice,
  advancementNoticeKey,
  advancesByPlacement,
  betweenLevelsEditOpen,
  currentLevelOf,
  effectiveAdvance,
  levelFromParam,
  levelRosterCsvRows,
  levelWhenWhere,
  ordinal,
  placementLabel,
  teamIsAtLevel,
  teamResultsCsvRows,
  teamsAtLevel,
  type TeamResultView,
  type TeamResultsRow,
} from "@/modules/club-teams/results-domain";
import type { TeamLevel } from "@/modules/club-teams/domain";

const staff = { id: "staff-1", email: "staff@example.test", displayName: "Staff Member" };
const membership = (role: string) => ({ eventId: "event-1", userId: "staff-1", role, status: "ACTIVE", permissions: [] });
const eventCtx = { params: Promise.resolve({ eventId: "event-1" }) };
const teamCtx = { params: Promise.resolve({ eventId: "event-1", registrationId: "cer-1" }) };
const post = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
  method: "POST", headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body),
});
const put = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
  method: "PUT", headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body),
});

const view = (level: TeamLevel, overrides: Partial<TeamResultView> = {}): TeamResultView => ({
  level, placement: "", placementRank: null, advanceOverride: null, qualified: false, needsReentry: false, notes: "", updatedAt: "2027-01-16T20:00:00.000Z", ...overrides,
});
const team = (id: string, name: string, results: Partial<Record<TeamLevel, TeamResultView>>): TeamResultsRow => ({
  clubEventRegistrationId: id, teamName: name, clubName: `${name} Club`, church: null, confirmationCode: `PBE-${id}`, status: "CONFIRMED",
  locationId: "loc-iowa", locationName: "Iowa", permissionsPending: 0,
  results: { AREA: results.AREA ?? null, CONFERENCE: results.CONFERENCE ?? null, UNION: results.UNION ?? null },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: staff });
  mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER"));
  mocks.processQueued.mockResolvedValue(undefined);
});

describe("the placement rule", () => {
  it("advances 1st and 2nd, and a tie shares its number so two 2nds both advance", () => {
    expect([1, 2, 3, 4, null].map(advancesByPlacement)).toEqual([true, true, false, false, false]);
    const area = [view("AREA", { placementRank: 1 }), view("AREA", { placementRank: 2 }), view("AREA", { placementRank: 2 }), view("AREA", { placementRank: 4 })];
    expect(area.map((result) => effectiveAdvance("AREA", result))).toEqual([true, true, true, false]);
  });

  it("lets staff override either way, and nothing advances from the last level", () => {
    expect(effectiveAdvance("AREA", view("AREA", { placementRank: 6, advanceOverride: true }))).toBe(true);
    expect(effectiveAdvance("AREA", view("AREA", { placementRank: 1, advanceOverride: false }))).toBe(false);
    expect(effectiveAdvance("UNION", view("UNION", { placementRank: 1, advanceOverride: true }))).toBe(false);
  });

  it("keeps an old free-text row's earlier decision until staff re-enter it as a number", () => {
    const legacy = view("AREA", { placement: "2nd place", qualified: true, needsReentry: true });
    expect(effectiveAdvance("AREA", legacy)).toBe(true);
    expect(effectiveAdvance("AREA", { ...legacy, qualified: false })).toBe(false);
    expect(effectiveAdvance("AREA", { ...legacy, placementRank: 5 })).toBe(false);
  });

  it("reads the place as an ordinal, with the old text for a row not yet re-entered", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "112th"]);
    expect(placementLabel(view("AREA", { placementRank: 2 }))).toBe("2nd");
    expect(placementLabel(view("AREA", { placement: "412 points", needsReentry: true }))).toBe("412 points");
    expect(placementLabel(null)).toBe("");
  });
});

describe("who is at a level", () => {
  const rows = [
    team("a", "Aces", { AREA: view("AREA", { placementRank: 1, qualified: true }), CONFERENCE: view("CONFERENCE", { placementRank: 2, qualified: true }) }),
    team("b", "Bees", { AREA: view("AREA", { placementRank: 3, qualified: false }), CONFERENCE: view("CONFERENCE", { placementRank: 1, qualified: true }) }),
    team("c", "Cubs", { AREA: view("AREA", { placementRank: 2, qualified: true }) }),
    team("d", "Doves", {}),
  ];

  it("lists every team at Area, only teams that advanced at Conference, and only those that advanced twice at Union", () => {
    expect(teamsAtLevel(rows, "AREA").map((row) => row.teamName)).toEqual(["Aces", "Bees", "Cubs", "Doves"]);
    expect(teamsAtLevel(rows, "CONFERENCE").map((row) => row.teamName)).toEqual(["Aces", "Cubs"]);
    // Bees has a stray Conference result but did not advance from Area, so it never appears, nor does it reach Union.
    expect(teamsAtLevel(rows, "UNION").map((row) => row.teamName)).toEqual(["Aces"]);
    expect(teamIsAtLevel(rows[1]!, "CONFERENCE")).toBe(false);
    expect(currentLevelOf(rows[0]!)).toBe("UNION");
    expect(currentLevelOf(rows[3]!)).toBe("AREA");
  });

  it("filters the results CSV to the level and never lists a team that did not advance", () => {
    const csv = teamResultsCsvRows(rows, "CONFERENCE");
    expect(csv[0]).toEqual(["Team", "Club", "Church", "Confirmation", "Area", "AC permission pending", "Conference place", "Conference advancing", "Conference notes"]);
    expect(csv.slice(1).map((line) => line[0])).toEqual(["Aces", "Cubs"]);
    expect(csv[1]!.slice(6)).toEqual(["2nd", "Yes", ""]);
    expect(teamResultsCsvRows(rows).slice(1)).toHaveLength(4);
  });

  it("writes the roster CSV with each person's role and no private detail", () => {
    const csv = levelRosterCsvRows([{
      clubEventRegistrationId: "a", teamName: "Aces", clubName: "Aces Club", church: "Test SDA Church", confirmationCode: "PBE-a", areaName: "Iowa",
      members: ["Pat Test", "Sam Test"], alternate: "Alex Test", coaches: ["Coach Test"], checkedInAt: null, noticeQueued: false,
    }]);
    expect(csv[0]).toEqual(["Team", "Club", "Church", "Confirmation", "Area", "Role", "Name"]);
    expect(csv.slice(1).map((line) => line.slice(5))).toEqual([["Team member", "Pat Test"], ["Team member", "Sam Test"], ["Alternate", "Alex Test"], ["Coach", "Coach Test"]]);
    expect(csv[1]!.slice(0, 5)).toEqual(["Aces", "Aces Club", "Test SDA Church", "PBE-a", "Iowa"]);
  });

  it("splits a team's people into members, the alternate and coaches by name only", () => {
    const people = splitTeamPeople([
      { profileSnapshot: { firstName: "Pat", lastName: "Test", teamRole: "MEMBER" }, formResponses: {} },
      { profileSnapshot: { firstName: "Alex", lastName: "Test", teamRole: "MEMBER" }, formResponses: { alternate: true } },
      { profileSnapshot: { firstName: "Coach", lastName: "Test", teamRole: "COACH", birthDate: "2001-01-01" }, formResponses: {} },
    ]);
    expect(people).toEqual({ members: ["Pat Test"], alternate: "Alex Test", coaches: ["Coach Test"] });
  });

  it("reads a level from a query string, defaulting to Area", () => {
    expect(["CONFERENCE", "UNION", "AREA", "regional", null, undefined].map(levelFromParam)).toEqual(["CONFERENCE", "UNION", "AREA", "AREA", "AREA", "AREA"]);
  });
});

describe("the notice and the between-levels window", () => {
  const info = { date: "2027-03-20", place: "Camp Heritage" };

  it("carries the next level's date and place, and says when they are not set", () => {
    const notice = advancementNotice({ eventName: "PBE 2027", directorName: "Dana Test", clubName: "Aces Club", teamName: "Aces", fromLevel: "AREA", toLevel: "CONFERENCE", info, link: "https://events.imsda.test/account/clubs/o1/events/e1" });
    expect(notice.subject).toBe("Aces (Aces Club) advanced to Conference");
    expect(notice.text).toContain("Conference date: March 20, 2027");
    expect(notice.text).toContain("Conference place: Camp Heritage");
    expect(notice.text).toContain("do not need to register again");
    const unset = advancementNotice({ eventName: "PBE 2027", directorName: "", clubName: "Aces Club", teamName: null, fromLevel: "CONFERENCE", toLevel: "UNION", info: null, link: "x" });
    expect(unset.text).toContain("Union date: to be announced");
    expect(unset.text).toContain("Hello there,");
    expect(levelWhenWhere({ date: "2027-03-20", place: "" })).toBe("March 20, 2027");
    expect(levelWhenWhere(null)).toBe("");
  });

  it("keys a notice by team and level, so it can be queued once", () => {
    expect(advancementNoticeKey("cer-1", "CONFERENCE")).toBe("club-team-advancement-notice:cer-1:CONFERENCE");
    expect(advancementNoticeKey("cer-1", "UNION")).not.toBe(advancementNoticeKey("cer-1", "CONFERENCE"));
  });

  it("opens a director's edit between levels only for an advanced team, until its next level is held", () => {
    const levelInfo = [{ level: "CONFERENCE" as const, date: "2027-03-20", place: "Camp Heritage" }];
    const advanced = team("a", "Aces", { AREA: view("AREA", { qualified: true }) });
    expect(betweenLevelsEditOpen(advanced, levelInfo, "2027-03-01")).toEqual({ open: true, level: "CONFERENCE" });
    // The window closes on the level's own day.
    expect(betweenLevelsEditOpen(advanced, levelInfo, "2027-03-19")).toEqual({ open: true, level: "CONFERENCE" });
    expect(betweenLevelsEditOpen(advanced, levelInfo, "2027-03-20")).toEqual({ open: false });
    expect(betweenLevelsEditOpen(advanced, levelInfo, "2027-03-21")).toEqual({ open: false });
    // ...or as soon as the team is checked in for the level, before the day is over.
    expect(betweenLevelsEditOpen(advanced, levelInfo, "2027-03-01", new Set<TeamLevel>(["CONFERENCE"]))).toEqual({ open: false });
    expect(betweenLevelsEditOpen(advanced, levelInfo, "2027-03-01", new Set<TeamLevel>(["UNION"]))).toEqual({ open: true, level: "CONFERENCE" });
    expect(betweenLevelsEditOpen(advanced, [], "2030-01-01")).toEqual({ open: true, level: "CONFERENCE" });
    // Once staff enter a Conference result the level has been held.
    const held = team("a", "Aces", { AREA: view("AREA", { qualified: true }), CONFERENCE: view("CONFERENCE", { placementRank: 4 }) });
    expect(betweenLevelsEditOpen(held, levelInfo, "2027-03-01")).toEqual({ open: false });
    const notAdvanced = team("b", "Bees", { AREA: view("AREA", { placementRank: 3 }) });
    expect(betweenLevelsEditOpen(notAdvanced, levelInfo, "2027-03-01")).toEqual({ open: false });
  });
});

type ResultRow = { id: string; clubEventRegistrationId: string; level: TeamLevel; placement: string; placementRank: number | null; advanceOverride: boolean | null; qualified: boolean; notes: string; updatedAt: Date };

function resultsDatabase(initial: ResultRow[], options: { registrationStatus?: string } = {}) {
  const results = [...initial];
  const tx = {
    eventTeamSettings: { findUnique: vi.fn().mockResolvedValue({ eventId: "event-1" }) },
    clubEventRegistration: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
        teamName: "Aces", organization: { name: "Aces Club" }, registration: { status: options.registrationStatus ?? "CONFIRMED" },
        teamResults: results.filter((row) => row.clubEventRegistrationId === where.id),
      })),
    },
    clubTeamResult: {
      findUnique: vi.fn(async ({ where }: { where: { clubEventRegistrationId_level: { clubEventRegistrationId: string; level: TeamLevel } } }) => results.find((row) => row.clubEventRegistrationId === where.clubEventRegistrationId_level.clubEventRegistrationId && row.level === where.clubEventRegistrationId_level.level) ?? null),
      findMany: vi.fn(async ({ where }: { where: { level: TeamLevel } }) => results.filter((row) => row.level === where.level)),
      upsert: vi.fn(async ({ where, create, update }: { where: { clubEventRegistrationId_level: { clubEventRegistrationId: string; level: TeamLevel } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.clubEventRegistrationId_level;
        const index = results.findIndex((row) => row.clubEventRegistrationId === key.clubEventRegistrationId && row.level === key.level);
        const saved = { id: `r-${results.length + 1}`, updatedAt: new Date(), ...(index >= 0 ? { ...results[index], ...update } : create) } as ResultRow;
        if (index >= 0) results[index] = saved; else results.push(saved);
        return saved;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ResultRow> }) => {
        const index = results.findIndex((row) => row.id === where.id);
        results[index] = { ...results[index]!, ...data };
        return results[index];
      }),
      delete: vi.fn(),
    },
  };
  mocks.getPrisma.mockReturnValue({ ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) });
  return { tx, results };
}

const row = (overrides: Partial<ResultRow> & Pick<ResultRow, "id" | "clubEventRegistrationId" | "level">): ResultRow => ({
  placement: "", placementRank: null, advanceOverride: null, qualified: false, notes: "", updatedAt: new Date("2027-01-16T20:00:00Z"), ...overrides,
});

describe("saving placements marks who advances", () => {
  it("marks 1st and 2nd advancing and 3rd not, and two 2nds both advance", async () => {
    const { results } = resultsDatabase([]);
    for (const [id, rank] of [["t1", 1], ["t2", 2], ["t3", 2], ["t4", 3]] as const) {
      await saveTeamResult("event-1", id, { level: "AREA", placementRank: rank }, "staff-1");
    }
    expect(results.map((entry) => [entry.clubEventRegistrationId, entry.qualified])).toEqual([["t1", true], ["t2", true], ["t3", true], ["t4", false]]);
  });

  it("applies the same top-2 rule from Conference to Union, for a team that advanced", async () => {
    const { results } = resultsDatabase([row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placementRank: 1, qualified: true })]);
    await saveTeamResult("event-1", "t1", { level: "CONFERENCE", placementRank: 2 }, "staff-1");
    expect(results.find((entry) => entry.level === "CONFERENCE")).toMatchObject({ placementRank: 2, qualified: true });
  });

  it("refuses a Conference result for a team that did not advance from Area, and writes nothing", async () => {
    const { tx } = resultsDatabase([row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placementRank: 3, qualified: false })]);
    await expect(saveTeamResult("event-1", "t1", { level: "CONFERENCE", placementRank: 1 }, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
    await expect(saveTeamResult("event-1", "t9", { level: "CONFERENCE", placementRank: 1 }, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
    expect(tx.clubTeamResult.upsert).not.toHaveBeenCalled();
  });

  it("refuses an override at the last level", async () => {
    resultsDatabase([
      row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placementRank: 1, qualified: true }),
      row({ id: "r2", clubEventRegistrationId: "t1", level: "CONFERENCE", placementRank: 1, qualified: true }),
    ]);
    await expect(saveTeamResult("event-1", "t1", { level: "UNION", placementRank: 1, advanceOverride: true }, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
  });

  it("audits an override with ids only, and an override either way beats the place", async () => {
    const { results } = resultsDatabase([]);
    await saveTeamResult("event-1", "t1", { level: "AREA", placementRank: 6, advanceOverride: true }, "staff-1");
    await saveTeamResult("event-1", "t2", { level: "AREA", placementRank: 1, advanceOverride: false }, "staff-1");
    expect(results.map((entry) => entry.qualified)).toEqual([true, false]);
    const overrideAudits = mocks.writeAuditLog.mock.calls.map(([entry]) => entry).filter((entry) => entry.action === "CLUB_TEAM_ADVANCEMENT_OVERRIDDEN");
    expect(overrideAudits).toHaveLength(2);
    for (const audit of overrideAudits) {
      expect(audit.actorUserId).toBe("staff-1");
      // No team, club or person name in the summary or metadata.
      expect(JSON.stringify(audit)).not.toMatch(/Aces/);
      expect(Object.keys(audit.metadata).sort()).toEqual(["advancing", "after", "before", "clubEventRegistrationId", "level"]);
    }
  });

  it("audits clearing an override on its own, and it follows the place again", async () => {
    const { results } = resultsDatabase([row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placementRank: 5, advanceOverride: true, qualified: true })]);
    await saveTeamResult("event-1", "t1", { level: "AREA", placementRank: 5 }, "staff-1");
    expect(results[0]).toMatchObject({ advanceOverride: null, qualified: false });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUB_TEAM_ADVANCEMENT_OVERRIDE_CLEARED" }), expect.anything());
  });

  it("refuses to clear an override on an old free-text row until a number is entered, and keeps the row's decision", async () => {
    const { results } = resultsDatabase([row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placement: "2nd place", advanceOverride: false, qualified: false })]);
    await expect(saveTeamResult("event-1", "t1", { level: "AREA", notes: "x" }, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
    expect(results[0]).toMatchObject({ placement: "2nd place", advanceOverride: false, qualified: false });
    // Keeping the override while changing the note is fine, and so is entering a number, which replaces the text.
    await saveTeamResult("event-1", "t1", { level: "AREA", advanceOverride: false, notes: "x" }, "staff-1");
    await saveTeamResult("event-1", "t1", { level: "AREA", placementRank: 1 }, "staff-1");
    expect(results[0]).toMatchObject({ placement: "", placementRank: 1, advanceOverride: null, qualified: true });
  });

  it("never deletes a result on a blank save, but does on Clear result", async () => {
    const { tx, results } = resultsDatabase([row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placement: "2nd place", qualified: true })]);
    await expect(saveTeamResult("event-1", "t1", { level: "AREA" }, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
    expect(tx.clubTeamResult.delete).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    await saveTeamResult("event-1", "t1", { level: "AREA", clear: true }, "staff-1");
    expect(tx.clubTeamResult.delete).toHaveBeenCalledTimes(1);
  });

  it("keeps an old free-text placement and its decision when only the note changes, and replaces it once a number is entered", async () => {
    const { results } = resultsDatabase([row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placement: "2nd place", qualified: true })]);
    await saveTeamResult("event-1", "t1", { level: "AREA", notes: "Re-check" }, "staff-1");
    expect(results[0]).toMatchObject({ placement: "2nd place", placementRank: null, qualified: true, notes: "Re-check" });
    await saveTeamResult("event-1", "t1", { level: "AREA", placementRank: 4, notes: "Re-check" }, "staff-1");
    expect(results[0]).toMatchObject({ placement: "", placementRank: 4, qualified: false });
  });
});

describe("a recompute keeps what staff decided", () => {
  it("rewrites only an answer that no longer matches, and keeps overrides and old text decisions", async () => {
    const { results, tx } = resultsDatabase([
      row({ id: "r1", clubEventRegistrationId: "t1", level: "AREA", placementRank: 1, qualified: false }), // stale: the rule says advance
      row({ id: "r2", clubEventRegistrationId: "t2", level: "AREA", placementRank: 6, advanceOverride: true, qualified: true }), // override survives
      row({ id: "r3", clubEventRegistrationId: "t3", level: "AREA", placementRank: 1, advanceOverride: false, qualified: false }), // override survives
      row({ id: "r4", clubEventRegistrationId: "t4", level: "AREA", placement: "1st place", qualified: true }), // old text keeps its decision
      row({ id: "r5", clubEventRegistrationId: "t5", level: "AREA", placementRank: 4, qualified: true }), // stale the other way
    ]);
    const { changed } = await recomputeAdvancement("event-1", "AREA", "staff-1");
    expect(changed.sort()).toEqual(["t1", "t5"]);
    expect(results.map((entry) => [entry.id, entry.qualified])).toEqual([["r1", true], ["r2", true], ["r3", false], ["r4", true], ["r5", false]]);
    expect(results.map((entry) => entry.advanceOverride)).toEqual([null, true, false, null, null]);
    expect(tx.clubTeamResult.update).toHaveBeenCalledTimes(2);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUB_TEAM_ADVANCEMENT_RECOMPUTED", metadata: { level: "AREA", clubEventRegistrationIds: changed } }), expect.anything());
    // A second recompute has nothing to change and audits nothing.
    mocks.writeAuditLog.mockClear();
    expect((await recomputeAdvancement("event-1", "AREA", "staff-1")).changed).toEqual([]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

function listingDatabase() {
  const registrationRows = [
    { id: "a", teamName: "Aces", organization: { name: "Aces Club", parentOrganization: { name: "Test SDA Church" } }, registration: { confirmationCode: "PBE-a", status: "CONFIRMED", locationId: "loc-iowa", location: { name: "Iowa" } }, teamResults: [row({ id: "r1", clubEventRegistrationId: "a", level: "AREA", placementRank: 1, qualified: true })] },
    { id: "b", teamName: "Bees", organization: { name: "Bees Club", parentOrganization: null }, registration: { confirmationCode: "PBE-b", status: "CONFIRMED", locationId: "loc-mo", location: { name: "Missouri" } }, teamResults: [row({ id: "r2", clubEventRegistrationId: "b", level: "AREA", placementRank: 3, qualified: false })] },
    { id: "c", teamName: "Cubs", organization: { name: "Cubs Club", parentOrganization: null }, registration: { confirmationCode: "PBE-c", status: "CONFIRMED", locationId: "loc-mo", location: { name: "Missouri" } }, teamResults: [row({ id: "r3", clubEventRegistrationId: "c", level: "AREA", placementRank: 2, qualified: true })] },
  ];
  const people = {
    a: [{ profileSnapshot: { firstName: "Pat", lastName: "Test", teamRole: "MEMBER" }, formResponses: {} }, { profileSnapshot: { firstName: "Coach", lastName: "Test", teamRole: "COACH" }, formResponses: {} }],
    c: [{ profileSnapshot: { firstName: "Cam", lastName: "Test", teamRole: "MEMBER" }, formResponses: {} }],
  } as Record<string, unknown[]>;
  const prisma = {
    clubTeamMemberPermission: { groupBy: vi.fn().mockResolvedValue([]) },
    clubEventRegistration: {
      findMany: vi.fn(async (args: { select: Record<string, unknown>; where: { id?: { in: string[] } } }) => (
        "teamResults" in args.select
          ? registrationRows
          : (args.where.id?.in ?? []).map((id) => ({ id, registration: { attendees: people[id] ?? [] } }))
      )),
    },
    clubTeamLevelCheckIn: { findMany: vi.fn().mockResolvedValue([{ clubEventRegistrationId: "c", checkedInAt: new Date("2027-03-20T15:00:00Z") }]) },
    messageOutbox: { findMany: vi.fn().mockResolvedValue([{ idempotencyKey: advancementNoticeKey("a", "CONFERENCE") }]) },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return prisma;
}

describe("the Conference list", () => {
  it("is exactly the advancing teams, with their Area, people, check-in and notice state", async () => {
    listingDatabase();
    const teams = await listLevelTeams("event-1", "CONFERENCE");
    expect(teams.map((entry) => entry.teamName)).toEqual(["Aces", "Cubs"]);
    expect(teams[0]).toMatchObject({ clubName: "Aces Club", church: "Test SDA Church", areaName: "Iowa", members: ["Pat Test"], coaches: ["Coach Test"], checkedInAt: null, noticeQueued: true });
    expect(teams[1]).toMatchObject({ areaName: "Missouri", checkedInAt: "2027-03-20T15:00:00.000Z", noticeQueued: false });
    expect((await listLevelTeams("event-1", "AREA")).map((entry) => entry.teamName)).toEqual(["Aces", "Bees", "Cubs"]);
    expect(await listLevelTeams("event-1", "UNION")).toEqual([]);
  });

  it("serves the filtered results and roster to staff with report access, and refuses others", async () => {
    listingDatabase();
    const results = await getResults(new Request("https://events.imsda.test/api/events/event-1/team-results?level=CONFERENCE"), eventCtx);
    const body = await results.json() as { level: string; teams: TeamResultsRow[] };
    expect(body.level).toBe("CONFERENCE");
    expect(body.teams.map((entry) => entry.teamName)).toEqual(["Aces", "Cubs"]);

    const csv = await getRoster(new Request("https://events.imsda.test/api/events/event-1/team-results/roster?format=csv&level=CONFERENCE"), eventCtx);
    expect(csv.headers.get("content-disposition")).toMatch(/event-1-team-roster-conference-\d{4}-\d{2}-\d{2}\.csv/);
    const text = await csv.text();
    expect(text).toContain('"Aces","Aces Club","Test SDA Church","PBE-a","Iowa","Team member","Pat Test"');
    expect(text).toContain('"Cubs"');
    expect(text).not.toContain("Bees");

    mocks.findActiveMembership.mockResolvedValue(membership("COMMUNICATIONS_MANAGER"));
    expect((await getRoster(new Request("https://events.imsda.test/api/events/event-1/team-results/roster?level=CONFERENCE"), eventCtx)).status).toBe(403);
  });
});

describe("team check-in for a level", () => {
  function checkInDatabase(teamResults: Array<{ level: TeamLevel; qualified: boolean }>, existing: { id: string; checkedInAt: Date; undoneAt: Date | null } | null = null) {
    const tx = {
      clubEventRegistration: { findFirst: vi.fn().mockResolvedValue({ teamName: "Aces", organization: { name: "Aces Club" }, registration: { status: "CONFIRMED" }, teamResults }) },
      clubTeamLevelCheckIn: {
        findUnique: vi.fn().mockResolvedValue(existing),
        upsert: vi.fn(async ({ create }: { create: { checkedInAt: Date } }) => ({ id: "ci-1", checkedInAt: create.checkedInAt })),
        update: vi.fn(async () => ({ id: "ci-1" })),
      },
    };
    mocks.getPrisma.mockReturnValue({ ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) });
    return tx;
  }

  it("checks in an advanced team once, and repeating changes and audits nothing", async () => {
    const tx = checkInDatabase([{ level: "AREA", qualified: true }]);
    const first = await setTeamLevelCheckIn("event-1", "cer-1", "CONFERENCE", true, "staff-1");
    expect(first.changed).toBe(true);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUB_TEAM_LEVEL_CHECKED_IN", metadata: { clubEventRegistrationId: "cer-1", level: "CONFERENCE" } }), expect.anything());
    mocks.writeAuditLog.mockClear();
    tx.clubTeamLevelCheckIn.findUnique.mockResolvedValue({ id: "ci-1", checkedInAt: new Date("2027-03-20T15:00:00Z"), undoneAt: null });
    expect((await setTeamLevelCheckIn("event-1", "cer-1", "CONFERENCE", true, "staff-1")).changed).toBe(false);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    const undone = await setTeamLevelCheckIn("event-1", "cer-1", "CONFERENCE", false, "staff-1");
    expect(undone).toEqual({ checkedInAt: null, changed: true });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUB_TEAM_LEVEL_CHECK_IN_UNDONE" }), expect.anything());
  });

  it("answers 404 for a team of another event on the check-in route, and checks in nothing", async () => {
    const tx = checkInDatabase([]);
    tx.clubEventRegistration.findFirst.mockResolvedValue(null);
    const response = await putCheckIn(put("/api/events/event-1/team-results/cer-other/check-in", { level: "CONFERENCE", checkedIn: true }), { params: Promise.resolve({ eventId: "event-1", registrationId: "cer-other" }) });
    expect(response.status).toBe(404);
    expect(tx.clubEventRegistration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cer-other", eventId: "event-1" } }));
    expect(tx.clubTeamLevelCheckIn.upsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a team that did not advance, and the Area day, which uses the usual check-in", async () => {
    const tx = checkInDatabase([{ level: "AREA", qualified: false }]);
    await expect(setTeamLevelCheckIn("event-1", "cer-1", "CONFERENCE", true, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
    await expect(setTeamLevelCheckIn("event-1", "cer-1", "AREA", true, "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
    expect(tx.clubTeamLevelCheckIn.upsert).not.toHaveBeenCalled();
  });
});

function noticeDatabase(options: { deliveryMode?: string; existingKeys?: string[]; email?: string | null } = {}) {
  const existing = new Set(options.existingKeys ?? []);
  const created: Array<Record<string, unknown>> = [];
  const teamRow = (id: string, name: string, email: string | null) => ({
    id, organizationId: `org-${id}`, teamName: name, teamKey: name.toLowerCase(), organization: { name: `${name} Club` },
    registration: { id: `reg-${id}`, confirmationCode: `PBE-${id}`, contactSnapshot: email ? { email, firstName: "Dana", lastName: "Test" } : {}, accountHolderPerson: { firstName: "Holder", lastName: "Test", normalizedEmail: null } },
  });
  const tx = {
    event: { findUnique: vi.fn().mockResolvedValue({ name: "PBE 2027" }) },
    eventTeamSettings: { findUnique: vi.fn().mockResolvedValue({ levelInfo: [{ level: "CONFERENCE", date: "2027-03-20", place: "Camp Heritage" }] }) },
    eventMessageSettings: { findUnique: vi.fn().mockResolvedValue({ deliveryMode: options.deliveryMode ?? "LOCAL_CAPTURE", senderName: "IMSDA Events", senderEmail: null, replyToEmail: null }) },
    clubEventRegistration: { findMany: vi.fn().mockResolvedValue([teamRow("a", "Aces", options.email === undefined ? "director-a@example.test" : options.email), teamRow("c", "Cubs", "director-c@example.test")]) },
    messageOutbox: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => (existing.has(where.idempotencyKey) ? { id: "existing" } : null)),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> & { idempotencyKey: string; status: string } }) => {
        existing.add(create.idempotencyKey);
        created.push(create);
        return { id: `msg-${created.length}`, status: create.status };
      }),
      findMany: vi.fn(async () => [...existing].map((idempotencyKey) => ({ idempotencyKey }))),
    },
  };
  mocks.getPrisma.mockReturnValue({ ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) });
  return { tx, created };
}

describe("director notices", () => {
  it("queues one notice per advancing team with the Conference date and place, then delivers after commit", async () => {
    const { created } = noticeDatabase();
    const result = await sendAdvancementNotices("event-1", "CONFERENCE", "staff-1");
    expect(result).toMatchObject({ queued: 2, alreadyQueued: 0, noEmail: 0, date: "2027-03-20", place: "Camp Heritage" });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      templateKey: "CLUB_TEAM_ADVANCEMENT_NOTICE", recipientEmail: "director-a@example.test", status: "PENDING", idempotencyKey: "club-team-advancement-notice:a:CONFERENCE",
    });
    expect(String(created[0]!.bodyTextSnapshot)).toContain("Conference date: March 20, 2027");
    expect(String(created[0]!.bodyTextSnapshot)).toContain("Conference place: Camp Heritage");
    expect(mocks.processQueued).toHaveBeenCalledWith(["msg-1", "msg-2"]);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "CLUB_TEAM_ADVANCEMENT_NOTICES_SENT", metadata: expect.objectContaining({ level: "CONFERENCE", queued: 2, clubEventRegistrationIds: ["a", "c"] }),
    }), expect.anything());
    // The audit holds ids and counts, never an address or a name.
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(/director-a@example|Dana/);
  });

  it("is idempotent per team and level: pressing again queues and sends nothing more", async () => {
    noticeDatabase({ existingKeys: [advancementNoticeKey("a", "CONFERENCE")] });
    const result = await sendAdvancementNotices("event-1", "CONFERENCE", "staff-1");
    expect(result).toMatchObject({ queued: 1, alreadyQueued: 1 });
    expect(mocks.processQueued).toHaveBeenCalledWith(["msg-1"]);
    mocks.processQueued.mockClear();
    const again = await sendAdvancementNotices("event-1", "CONFERENCE", "staff-1");
    expect(again).toMatchObject({ queued: 0, alreadyQueued: 2 });
    expect(mocks.processQueued).not.toHaveBeenCalled();
  });

  it("skips a team with no director email, and suppresses (never sends) when delivery is disabled", async () => {
    noticeDatabase({ email: null });
    expect(await sendAdvancementNotices("event-1", "CONFERENCE", "staff-1")).toMatchObject({ queued: 1, noEmail: 1 });
    mocks.processQueued.mockClear();
    const { created } = noticeDatabase({ deliveryMode: "DISABLED" });
    await sendAdvancementNotices("event-1", "CONFERENCE", "staff-1");
    expect(created.every((message) => message.status === "SUPPRESSED")).toBe(true);
    expect(mocks.processQueued).not.toHaveBeenCalled();
  });

  it("has no notice for the Area level, where every team starts", async () => {
    noticeDatabase();
    await expect(sendAdvancementNotices("event-1", "AREA", "staff-1")).rejects.toMatchObject({ code: "RESULT_INVALID" });
  });

  it("queues and sends nothing from the preview, and nothing happens on its own", async () => {
    const { tx } = noticeDatabase({ existingKeys: [advancementNoticeKey("c", "CONFERENCE")] });
    const response = await getNoticePreview(new Request("https://events.imsda.test/api/events/event-1/team-results/notices?level=CONFERENCE"), eventCtx);
    await expect(response.json()).resolves.toMatchObject({ toSend: 1, alreadyQueued: 1, noEmail: 0, date: "2027-03-20", place: "Camp Heritage" });
    expect(tx.messageOutbox.upsert).not.toHaveBeenCalled();
    expect(mocks.processQueued).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("only staff who manage registrations can act", () => {
  const routes = [
    { name: "send notices", call: () => postNotices(post("/api/events/event-1/team-results/notices", { level: "CONFERENCE" }), eventCtx) },
    { name: "preview notices", call: () => getNoticePreview(new Request("https://events.imsda.test/api/events/event-1/team-results/notices?level=CONFERENCE"), eventCtx) },
    { name: "recompute", call: () => postRecompute(post("/api/events/event-1/team-results/recompute", { level: "AREA" }), eventCtx) },
    { name: "check in", call: () => putCheckIn(put("/api/events/event-1/team-results/cer-1/check-in", { level: "CONFERENCE", checkedIn: true }), teamCtx) },
  ];

  it.each(["FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"])("refuses %s on every action, and queues and sends nothing", async (role) => {
    mocks.findActiveMembership.mockResolvedValue(membership(role));
    const { tx } = noticeDatabase();
    for (const route of routes) expect((await route.call()).status, route.name).toBe(403);
    expect(tx.messageOutbox.upsert).not.toHaveBeenCalled();
    expect(mocks.processQueued).not.toHaveBeenCalled();
  });

  it("refuses a signed-out or cross-origin request, and allows a registration manager", async () => {
    noticeDatabase();
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    for (const route of routes) expect((await route.call()).status, route.name).toBe(401);
    mocks.getCurrentSession.mockResolvedValue({ user: staff });
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({}, { status: 403 }));
    expect((await routes[0]!.call()).status).toBe(403);
    expect((await routes[2]!.call()).status).toBe(403);
    expect((await routes[3]!.call()).status).toBe(403);
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    const sent = await routes[0]!.call();
    expect(sent.status).toBe(200);
    const body = await sent.json() as Record<string, unknown>;
    // The response carries counts and the date and place, never outbox ids.
    expect(body).toMatchObject({ queued: 2 });
    expect(body).not.toHaveProperty("messageIds");
  });

  it("refuses a body that names no level, or an unknown field", async () => {
    noticeDatabase();
    expect((await postNotices(post("/api/events/event-1/team-results/notices", {}), eventCtx)).status).toBe(400);
    expect((await postNotices(post("/api/events/event-1/team-results/notices", { level: "CONFERENCE", all: true }), eventCtx)).status).toBe(400);
  });
});
