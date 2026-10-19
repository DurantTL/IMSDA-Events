import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A member's class history (#791): the data shown and the existing class-tracking gate. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getRosterAccessStateForPage: vi.fn(),
  rosterFindMany: vi.fn(),
  completionFindMany: vi.fn(),
  needFindMany: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubRosterMember: { findMany: mocks.rosterFindMany },
    memberClassCompletion: { findMany: mocks.completionFindMany },
    clubOrderNeed: { findMany: mocks.needFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.getRosterAccessStateForPage }));

import { MemberClassHistory } from "@/components/member-class-history";
import MemberClassHistoryPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/[personId]/page";
import ClassTrackingPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/page";
import { buildClassHistory } from "@/modules/earned-awards/domain";
import { loadMemberClassHistory, personIdsMovedToOtherClubs } from "@/modules/earned-awards/order-source";

const now = new Date("2026-10-05T12:00:00Z");

describe("buildClassHistory", () => {
  it("lists completions in class order, then adds the current class when it is not completed", () => {
    const entries = buildClassHistory(
      [{ classLevel: "COMPANION", completedOn: "2025-06-01" }, { classLevel: "FRIEND", completedOn: "2024-05-20" }],
      "EXPLORER",
    );
    expect(entries.map((e) => [e.classLabel, e.status, e.completedOn])).toEqual([
      ["Friend", "COMPLETED", "2024-05-20"],
      ["Companion", "COMPLETED", "2025-06-01"],
      ["Explorer", "IN_PROGRESS", null],
    ]);
  });

  it("does not repeat a current class that is already completed, and handles no data", () => {
    expect(buildClassHistory([{ classLevel: "FRIEND", completedOn: "2024-05-20" }], "FRIEND")).toHaveLength(1);
    expect(buildClassHistory([], null)).toEqual([]);
  });
});

beforeEach(() => {
  mocks.needFindMany.mockResolvedValue([]);
});

describe("loadMemberClassHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needFindMany.mockResolvedValue([]);
    mocks.rosterFindMany.mockResolvedValue([
      { clubYear: "2026-27", classLevel: "COMPANION", status: "ACTIVE", person: { firstName: "Test", lastName: "Pathfinder" } },
    ]);
    mocks.completionFindMany.mockResolvedValue([{ classLevel: "FRIEND", completedOn: "2025-05-20" }]);
  });

  it("returns completions and the in-progress class, scoped to this club and person", async () => {
    const history = await loadMemberClassHistory("club-1", "person-1", now);
    expect(history?.entries.map((e) => `${e.classLabel}:${e.status}`)).toEqual(["Friend:COMPLETED", "Companion:IN_PROGRESS"]);
    expect(history).toMatchObject({ firstName: "Test", lastName: "Pathfinder" });
    expect(mocks.rosterFindMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", personId: "person-1" });
    expect(mocks.completionFindMany.mock.calls[0]![0].where).toEqual({ organizationId: "club-1", personId: "person-1" });
  });

  it("ignores removed roster rows, so a removed-only person gives null", async () => {
    mocks.rosterFindMany.mockResolvedValue([]);
    await expect(loadMemberClassHistory("club-1", "person-1", now)).resolves.toBeNull();
    expect(mocks.rosterFindMany.mock.calls[0]![0].where).toMatchObject({ status: { not: "REMOVED" } });
  });

  it("returns null for someone never on this club's roster", async () => {
    mocks.rosterFindMany.mockResolvedValue([]);
    await expect(loadMemberClassHistory("club-1", "someone-else", now)).resolves.toBeNull();
  });
});

describe("class history page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needFindMany.mockResolvedValue([]);
    mocks.rosterFindMany.mockResolvedValue([
      { clubYear: "2026-27", classLevel: "FRIEND", status: "ACTIVE", person: { firstName: "Test", lastName: "Pathfinder" } },
    ]);
    mocks.completionFindMany.mockResolvedValue([]);
  });
  const props = { params: Promise.resolve({ organizationId: "club-1", personId: "person-1" }) };

  it("uses the same roster gate as the class-tracking page and loads nothing when it is closed", async () => {
    for (const state of ["SIGN_IN", "NOT_FOUND", "NO_ROSTER", "MFA_UNLOCK", "OWN_SESSION_REQUIRED"]) {
      mocks.getRosterAccessStateForPage.mockResolvedValue({ state });
      await expect(MemberClassHistoryPage(props)).resolves.toBeNull();
    }
    expect(mocks.rosterFindMany).not.toHaveBeenCalled();
    expect(mocks.getRosterAccessStateForPage).toHaveBeenCalledWith("club-1");
    // The class-tracking page itself checks the same helper.
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "SIGN_IN" });
    await expect(ClassTrackingPage({ params: Promise.resolve({ organizationId: "club-1" }) })).resolves.toBeNull();
  });

  it("shows the history for an open gate, and not found for a person off the roster", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "OPEN", capabilities: { roster: false, manageTeam: false } });
    const out = renderToStaticMarkup(await MemberClassHistoryPage(props) as ReactElement);
    expect(out).toContain("Class history");
    expect(out).toContain("Test Pathfinder");
    expect(out).toContain("Friend");
    expect(out).toContain("In progress");
    mocks.rosterFindMany.mockResolvedValue([]);
    await expect(MemberClassHistoryPage(props)).rejects.toThrow("NOT_FOUND");
  });
});

describe("class history page edit and read-only modes (#1011)", () => {
  const props = { params: Promise.resolve({ organizationId: "club-1", personId: "person-1" }) };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needFindMany.mockResolvedValue([]);
    mocks.rosterFindMany.mockResolvedValue([
      { clubYear: "2026-27", classLevel: "COMPANION", status: "ACTIVE", person: { firstName: "Test", lastName: "Pathfinder" } },
    ]);
    mocks.completionFindMany.mockResolvedValue([{ classLevel: "FRIEND", completedOn: "2025-05-20" }]);
  });

  it("shows the add form, change date and remove for someone with the roster role", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "OPEN", capabilities: { roster: true, manageTeam: false } });
    const out = renderToStaticMarkup(await MemberClassHistoryPage(props) as ReactElement);
    expect(out).toContain("Add a class");
    expect(out).toContain("This person still needs the insignia");
    expect(out).toContain("Change date");
    expect(out).toContain("Remove");
    // Friend is completed, so it is not offered; the in-progress Companion row has no actions of its own.
    const options = [...out.matchAll(/<option value="([A-Z_]*)"/g)].map((match) => match[1]);
    expect(options).toEqual(["", "COMPANION", "EXPLORER", "RANGER", "VOYAGER", "GUIDE", "TLT", "MASTER_GUIDE"]);
    expect(out.match(/Change date/g)).toHaveLength(1);
    expect(out).not.toContain("View only");
  });

  it("the component alone, given canEdit false, shows only the list (the real page gate never produces this today)", () => {
    const out = renderToStaticMarkup(createElement(MemberClassHistory, { history: { firstName: "Test", lastName: "Pathfinder", entries: buildClassHistory([{ classLevel: "FRIEND", completedOn: "2025-05-20" }], null) }, nowIso: now.toISOString() }));
    expect(out).toContain("View only");
    expect(out).not.toContain("Add a class");
    expect(out).not.toContain("Change date");
    expect(out).not.toContain("Remove");
    expect(out).not.toContain("<input");
  });

  it("starts the insignia box unticked, with a note, for a person not active this club year", () => {
    const entries = buildClassHistory([], null);
    const active = renderToStaticMarkup(createElement(MemberClassHistory, { canEdit: true, history: { firstName: "A", lastName: "B", entries, activeThisClubYear: true }, nowIso: now.toISOString(), organizationId: "club-1", personId: "person-1" }));
    const former = renderToStaticMarkup(createElement(MemberClassHistory, { canEdit: true, history: { firstName: "A", lastName: "B", entries, activeThisClubYear: false }, nowIso: now.toISOString(), organizationId: "club-1", personId: "person-1" }));
    expect(active).toMatch(/type="checkbox" checked=""/);
    expect(active).not.toContain("only made for people active this club year");
    expect(former).not.toMatch(/type="checkbox" checked=""/);
    expect(former).toContain("Insignia suggestions are only made for people active this club year.");
  });

  it("flags a class whose insignia is already on an order", async () => {
    mocks.needFindMany.mockResolvedValue([
      { sourceId: "class:person-1:FRIEND:item-1", status: "ORDERED" },
      { sourceId: "class:person-1:FRIEND:item-2", status: "NEEDED" },
      { sourceId: "class:person-1:COMPANION:item-3", status: "NEEDED" },
    ]);
    const history = await loadMemberClassHistory("club-1", "person-1", now);
    expect(history?.insigniaOnOrder).toEqual(["FRIEND"]);
    expect(history?.insigniaPending).toEqual(["FRIEND", "COMPANION"]);
    expect(history?.activeThisClubYear).toBe(true);
    expect(mocks.needFindMany.mock.calls[0]![0].where).toMatchObject({ organizationId: "club-1", sourceType: "AWARD", personId: "person-1" });
  });
});

describe("a member who has moved to another club (#791 decision)", () => {
  const thisClubRows = (rows: Array<{ clubYear: string; status: string }>) => rows.map((row) => ({
    ...row, classLevel: "FRIEND", person: { firstName: "Test", lastName: "Pathfinder" },
  }));
  /** Answers the two roster queries: this club's rows for the person, and every current non-removed row anywhere. */
  function arrange(here: Array<{ clubYear: string; status: string }>, current: Array<{ organizationId: string; personId: string }>) {
    mocks.completionFindMany.mockResolvedValue([{ classLevel: "FRIEND", completedOn: "2025-05-20" }]);
    mocks.rosterFindMany.mockImplementation(async (args: { where: { organizationId?: string } }) => (
      args.where.organizationId ? thisClubRows(here) : current
    ));
  }
  const formerHere = [{ clubYear: "2025-26", status: "INACTIVE" }];

  it("shows a former member who has not joined another club", async () => {
    arrange(formerHere, []);
    await expect(loadMemberClassHistory("club-1", "person-1", now)).resolves.toMatchObject({ lastName: "Pathfinder" });
  });

  it("gives null (404) for a former member now on another club's current roster", async () => {
    arrange(formerHere, [{ organizationId: "club-2", personId: "person-1" }]);
    await expect(loadMemberClassHistory("club-1", "person-1", now)).resolves.toBeNull();
    // The check is current-year and ignores removed rows.
    const moveQuery = mocks.rosterFindMany.mock.calls.map((call) => call[0].where).find((where) => !where.organizationId);
    expect(moveQuery).toMatchObject({ clubYear: "2026-27", status: { not: "REMOVED" }, personId: { in: ["person-1"] } });
  });

  it("gives 404 on the page for that person", async () => {
    arrange(formerHere, [{ organizationId: "club-2", personId: "person-1" }]);
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "OPEN", capabilities: { manageTeam: true } });
    await expect(MemberClassHistoryPage({ params: Promise.resolve({ organizationId: "club-1", personId: "person-1" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("shows a person who is currently on both rosters", async () => {
    arrange([{ clubYear: "2026-27", status: "ACTIVE" }], [
      { organizationId: "club-1", personId: "person-1" },
      { organizationId: "club-2", personId: "person-1" },
    ]);
    await expect(loadMemberClassHistory("club-1", "person-1", now)).resolves.not.toBeNull();
  });

  it("finds the moved people of a whole roster in one query, which hides their link", async () => {
    mocks.rosterFindMany.mockReset();
    mocks.rosterFindMany.mockResolvedValue([
      { organizationId: "club-2", personId: "moved" },
      { organizationId: "club-1", personId: "both" },
      { organizationId: "club-2", personId: "both" },
    ]);
    const moved = await personIdsMovedToOtherClubs("club-1", ["moved", "both", "stayed"], now);
    expect([...moved]).toEqual(["moved"]);
    expect(mocks.rosterFindMany).toHaveBeenCalledTimes(1);
  });
});
