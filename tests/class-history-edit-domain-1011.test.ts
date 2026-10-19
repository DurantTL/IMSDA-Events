import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adding, re-dating and removing a person's class history (#1011): the domain
 * rules over an in-memory stand-in for the database. Synthetic data only.
 */
type Completion = { id: string; organizationId: string; personId: string; classLevel: string; completedOn: string; insigniaDismissedAt: Date | null };
type Need = { id: string; organizationId: string; sourceType: string; sourceId: string; personId: string; status: string; sourceDate: string };

const state = vi.hoisted(() => ({
  completions: [] as Completion[],
  needs: [] as Need[],
  roster: [] as Array<{ organizationId: string; personId: string; clubYear: string; status: string }>,
  audits: [] as Array<Record<string, unknown>>,
  /** Which client each roster lookup ran on: the membership check must be on the transaction's. */
  rosterCalls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audits.push(entry); } }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: async () => 1,
    memberClassCompletion: {
      findUnique: async ({ where }: { where: { organizationId_personId_classLevel: { organizationId: string; personId: string; classLevel: string } } }) => {
        const key = where.organizationId_personId_classLevel;
        const found = state.completions.find((row) => row.organizationId === key.organizationId && row.personId === key.personId && row.classLevel === key.classLevel);
        return found ? { ...found } : null;
      },
      create: async ({ data }: { data: Omit<Completion, "id"> }) => {
        const row = { id: `c${state.completions.length + 1}`, ...data };
        state.completions.push(row);
        return { id: row.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Completion> }) => { Object.assign(state.completions.find((row) => row.id === where.id)!, data); },
      delete: async ({ where }: { where: { id: string } }) => { state.completions = state.completions.filter((row) => row.id !== where.id); },
    },
    clubOrderNeed: {
      findMany: async ({ where }: { where: { organizationId: string; personId: string; sourceId: { startsWith: string } } }) =>
        state.needs.filter((row) => row.organizationId === where.organizationId && row.personId === where.personId && row.sourceId.startsWith(where.sourceId.startsWith)),
      updateMany: async ({ where, data }: { where: { organizationId: string; personId: string; sourceId: { startsWith: string }; status: string }; data: Partial<Need> }) => {
        const rows = state.needs.filter((row) => row.organizationId === where.organizationId && row.personId === where.personId && row.sourceId.startsWith(where.sourceId.startsWith) && row.status === where.status);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] }; organizationId: string; status: string; sourceType: string } }) => {
        const gone = state.needs.filter((row) => where.id.in.includes(row.id) && row.organizationId === where.organizationId && row.status === where.status && row.sourceType === where.sourceType);
        state.needs = state.needs.filter((row) => !gone.includes(row));
        return { count: gone.length };
      },
    },
  };
  const matchesRoster = (where: { organizationId?: string; clubYear?: string; personId?: string | { in: string[] }; status?: { not: string } }) =>
    state.roster.filter((row) =>
      (!where.organizationId || row.organizationId === where.organizationId)
      && (!where.clubYear || row.clubYear === where.clubYear)
      && (!where.personId || (typeof where.personId === "string" ? row.personId === where.personId : where.personId.in.includes(row.personId)))
      && (!where.status || row.status !== where.status.not));
  const rosterOn = (client: string) => ({
    count: async ({ where }: { where: Parameters<typeof matchesRoster>[0] }) => { state.rosterCalls.push(client); return matchesRoster(where).length; },
    findMany: async ({ where }: { where: Parameters<typeof matchesRoster>[0] }) => { state.rosterCalls.push(client); return matchesRoster(where); },
  });
  // The club lock is the transaction's raw statement: logging it shows the membership check comes after it.
  const txClient = { ...tx, $executeRaw: async () => { state.rosterCalls.push("lock"); return 1; }, clubRosterMember: rosterOn("tx") };
  return {
    getPrisma: () => ({
      ...tx,
      $transaction: async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient),
      clubRosterMember: rosterOn("outside"),
    }),
  };
});

import { ClubOrderError } from "@/modules/club-orders/repository";
import { insigniaNeededByDefault, classLevelsStillToAdd, buildClassHistory } from "@/modules/earned-awards/domain";
import { addMemberClassCompletion, changeMemberClassCompletionDate, removeMemberClassCompletion } from "@/modules/earned-awards/order-source";

const now = new Date("2026-10-18T15:00:00Z");
const actor = { accountId: "account-1" };
const org = "club-1";
const person = "person-1";

const need = (id: string, level: string, item: string, status: string): Need => ({
  id, organizationId: org, sourceType: "AWARD", sourceId: `class:${person}:${level}:${item}`, personId: person, status, sourceDate: "2025-06-01",
});

beforeEach(() => {
  state.completions = [];
  state.needs = [];
  state.audits = [];
  state.rosterCalls = [];
  state.roster = [{ organizationId: org, personId: person, clubYear: "2026-27", status: "ACTIVE" }];
});

describe("insignia default and offered levels", () => {
  it("is off before the current club year (Sept 1) and on from then", () => {
    expect(insigniaNeededByDefault("2026-08-31", now)).toBe(false);
    expect(insigniaNeededByDefault("2026-09-01", now)).toBe(true);
    expect(insigniaNeededByDefault("2026-10-01", now)).toBe(true);
    // Before September the club year began the previous September.
    expect(insigniaNeededByDefault("2025-09-01", new Date("2026-03-01T12:00:00Z"))).toBe(true);
    expect(insigniaNeededByDefault("2025-08-31", new Date("2026-03-01T12:00:00Z"))).toBe(false);
  });

  it("offers only levels not already completed, in class order", () => {
    const entries = buildClassHistory([{ classLevel: "COMPANION", completedOn: "2025-06-01" }], "EXPLORER");
    expect(classLevelsStillToAdd(entries)).toEqual(["FRIEND", "EXPLORER", "RANGER", "VOYAGER", "GUIDE", "TLT", "MASTER_GUIDE"]);
  });
});

describe("addMemberClassCompletion", () => {
  it("records the class with the insignia dismissed when unticked, and audits level and date", async () => {
    await addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: false }, actor, now);
    expect(state.completions).toHaveLength(1);
    expect(state.completions[0]).toMatchObject({ classLevel: "FRIEND", completedOn: "2025-06-01", insigniaDismissedAt: now });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "CLUB_CLASS_COMPLETION_ADDED",
      entityType: "MemberClassCompletion",
      entityId: state.completions[0]!.id,
      metadata: { organizationId: org, personId: person, classLevel: "FRIEND", completedOn: "2025-06-01", insigniaNeeded: false, actorAttendeeAccountId: "account-1" },
    });
  });

  it("leaves the insignia suggested (not dismissed) when ticked, as Class tracking does", async () => {
    await addMemberClassCompletion(org, person, { classLevel: "COMPANION", completedOn: "2026-10-01", needsInsignia: true }, actor, now);
    expect(state.completions[0]).toMatchObject({ classLevel: "COMPANION", insigniaDismissedAt: null });
    expect(state.audits[0]!.metadata).toMatchObject({ insigniaNeeded: true });
  });

  it("refuses a duplicate level and writes nothing more", async () => {
    await addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: false }, actor, now);
    await expect(addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-07-01", needsInsignia: true }, actor, now))
      .rejects.toMatchObject({ code: "CLASS_ALREADY_COMPLETED" });
    expect(state.completions).toHaveLength(1);
    expect(state.completions[0]!.completedOn).toBe("2025-06-01");
    expect(state.audits).toHaveLength(1);
  });

  it("refuses a future date but accepts today", async () => {
    await expect(addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2026-10-19", needsInsignia: true }, actor, now))
      .rejects.toMatchObject({ code: "DATE_IN_FUTURE" });
    expect(state.completions).toHaveLength(0);
    await addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2026-10-18", needsInsignia: true }, actor, now);
    expect(state.completions).toHaveLength(1);
  });

  it("refuses a person who is not on this club's roster, or who moved to another club", async () => {
    await expect(addMemberClassCompletion(org, "someone-else", { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: true }, actor, now))
      .rejects.toMatchObject({ code: "MEMBER_NOT_ON_ROSTER" });
    state.roster = [
      { organizationId: org, personId: person, clubYear: "2025-26", status: "INACTIVE" },
      { organizationId: "club-2", personId: person, clubYear: "2026-27", status: "ACTIVE" },
    ];
    await expect(addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: true }, actor, now))
      .rejects.toBeInstanceOf(ClubOrderError);
    expect(state.completions).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("attributes staff acting as a director to the staff user and act-as id", async () => {
    await addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: false }, { userId: "staff-1", actAsId: "act-1" }, now);
    expect(state.audits[0]).toMatchObject({ actorUserId: "staff-1", metadata: { actAsId: "act-1" } });
  });
});

describe("changeMemberClassCompletionDate", () => {
  beforeEach(() => {
    state.completions = [{ id: "c1", organizationId: org, personId: person, classLevel: "FRIEND", completedOn: "2025-06-01", insigniaDismissedAt: null }];
  });

  it("changes the date, moves a pending need's date with it, and audits the old and new date", async () => {
    state.needs = [need("n1", "FRIEND", "strip", "NEEDED"), need("n2", "FRIEND", "pin", "ORDERED")];
    await expect(changeMemberClassCompletionDate(org, person, "FRIEND", "2025-05-20", actor, now)).resolves.toMatchObject({ changed: true });
    expect(state.completions[0]!.completedOn).toBe("2025-05-20");
    expect(state.needs.find((row) => row.id === "n1")!.sourceDate).toBe("2025-05-20");
    expect(state.needs.find((row) => row.id === "n2")!.sourceDate).toBe("2025-06-01");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "CLUB_CLASS_COMPLETION_DATE_CHANGED",
      metadata: { classLevel: "FRIEND", oldCompletedOn: "2025-06-01", newCompletedOn: "2025-05-20" },
    });
  });

  it("does nothing, and writes no audit row, when the date is unchanged", async () => {
    await expect(changeMemberClassCompletionDate(org, person, "FRIEND", "2025-06-01", actor, now)).resolves.toMatchObject({ changed: false });
    expect(state.audits).toHaveLength(0);
  });

  it("refuses a future date and a class that is not recorded", async () => {
    await expect(changeMemberClassCompletionDate(org, person, "FRIEND", "2027-01-01", actor, now)).rejects.toMatchObject({ code: "DATE_IN_FUTURE" });
    await expect(changeMemberClassCompletionDate(org, person, "RANGER", "2025-06-01", actor, now)).rejects.toMatchObject({ code: "CLASS_NOT_COMPLETED" });
    expect(state.completions[0]!.completedOn).toBe("2025-06-01");
    expect(state.audits).toHaveLength(0);
  });
});

describe("removeMemberClassCompletion", () => {
  beforeEach(() => {
    state.completions = [
      { id: "c1", organizationId: org, personId: person, classLevel: "FRIEND", completedOn: "2025-06-01", insigniaDismissedAt: null },
      { id: "c2", organizationId: org, personId: person, classLevel: "COMPANION", completedOn: "2026-06-01", insigniaDismissedAt: null },
    ];
  });

  it("removes the class and its pending insignia need, leaving other classes' needs alone", async () => {
    state.needs = [need("n1", "FRIEND", "strip", "NEEDED"), need("n2", "COMPANION", "strip", "NEEDED")];
    await expect(removeMemberClassCompletion(org, person, "FRIEND", actor, now)).resolves.toMatchObject({ removedPendingNeeds: 1, keptOrderedNeeds: 0 });
    expect(state.completions.map((row) => row.classLevel)).toEqual(["COMPANION"]);
    expect(state.needs.map((row) => row.id)).toEqual(["n2"]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "CLUB_CLASS_COMPLETION_REMOVED",
      metadata: { classLevel: "FRIEND", completedOn: "2025-06-01", removedPendingNeeds: 1, keptOrderedNeeds: 0 },
    });
  });

  it("removes the class but leaves an ordered (or received or awarded) need untouched, and says so", async () => {
    state.needs = [need("n1", "FRIEND", "strip", "ORDERED"), need("n3", "FRIEND", "pin", "AWARDED"), need("n4", "FRIEND", "patch", "NEEDED")];
    await expect(removeMemberClassCompletion(org, person, "FRIEND", actor, now)).resolves.toMatchObject({ removedPendingNeeds: 1, keptOrderedNeeds: 2 });
    expect(state.completions.map((row) => row.classLevel)).toEqual(["COMPANION"]);
    expect(state.needs.map((row) => [row.id, row.status])).toEqual([["n1", "ORDERED"], ["n3", "AWARDED"]]);
    expect(state.audits[0]!.metadata).toMatchObject({ removedPendingNeeds: 1, keptOrderedNeeds: 2 });
  });

  it("refuses a class that is not recorded, and another club's person", async () => {
    await expect(removeMemberClassCompletion(org, person, "RANGER", actor, now)).rejects.toMatchObject({ code: "CLASS_NOT_COMPLETED" });
    await expect(removeMemberClassCompletion(org, "someone-else", "FRIEND", actor, now)).rejects.toMatchObject({ code: "MEMBER_NOT_ON_ROSTER" });
    expect(state.completions).toHaveLength(2);
    expect(state.audits).toHaveLength(0);
  });
});

describe("the roster check and club scoping (#1011)", () => {
  it("runs the roster membership check on the transaction client, never outside it", async () => {
    await addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: false }, actor, now);
    await changeMemberClassCompletionDate(org, person, "FRIEND", "2025-06-02", actor, now);
    await removeMemberClassCompletion(org, person, "FRIEND", actor, now);
    expect(state.rosterCalls.filter((call) => call === "tx").length).toBeGreaterThanOrEqual(6);
    expect(state.rosterCalls).not.toContain("outside");
  });

  it("takes the club lock before each membership check, so a roster removal cannot slip between them", async () => {
    for (const run of [
      () => addMemberClassCompletion(org, person, { classLevel: "FRIEND", completedOn: "2025-06-01", needsInsignia: false }, actor, now),
      () => changeMemberClassCompletionDate(org, person, "FRIEND", "2025-06-02", actor, now),
      () => removeMemberClassCompletion(org, person, "FRIEND", actor, now),
    ]) {
      state.rosterCalls = [];
      await run();
      expect(state.rosterCalls[0]).toBe("lock");
      expect(state.rosterCalls.slice(1)).toContain("tx");
    }
  });

  it("leaves another club's completion and needs for the same person untouched", async () => {
    state.roster.push({ organizationId: "club-2", personId: person, clubYear: "2026-27", status: "ACTIVE" });
    state.completions = [
      { id: "c1", organizationId: org, personId: person, classLevel: "FRIEND", completedOn: "2025-06-01", insigniaDismissedAt: null },
      { id: "c2", organizationId: "club-2", personId: person, classLevel: "FRIEND", completedOn: "2024-06-01", insigniaDismissedAt: null },
    ];
    state.needs = [need("n1", "FRIEND", "strip", "NEEDED"), { ...need("n2", "FRIEND", "strip2", "NEEDED"), organizationId: "club-2" }];
    await changeMemberClassCompletionDate(org, person, "FRIEND", "2025-05-01", actor, now);
    expect(state.completions.find((row) => row.id === "c2")!.completedOn).toBe("2024-06-01");
    expect(state.needs.find((row) => row.id === "n2")!.sourceDate).toBe("2025-06-01");
    await removeMemberClassCompletion(org, person, "FRIEND", actor, now);
    expect(state.completions.map((row) => row.id)).toEqual(["c2"]);
    expect(state.needs.map((row) => row.id)).toEqual(["n2"]);
  });
});
