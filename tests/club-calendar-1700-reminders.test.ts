import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1700: the club calendar reminder sweep against an in-memory stand-in for the database. Dates are pinned and the
 * clubs, people and addresses are synthetic.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  clubs: [] as Row[],
  features: [] as Row[],
  settings: [] as Row[],
  items: [] as Row[],
  logs: [] as Row[],
  grants: [] as Row[],
  optOuts: [] as Row[],
  outbox: [] as Row[],
  audit: [] as Row[],
  delivered: [] as string[][],
  emailConfigured: true,
  failOutboxFor: null as string | null,
  nextId: 1,
}));

const activeAccount = (account: unknown) => { const row = account as { disabledAt?: Date | null; status?: string }; return !row.disabledAt && (row.status ?? "ACTIVE") === "ACTIVE"; };
const hasFeature = (organizationId: unknown) => state.features.some((row) => row.organizationId === organizationId && row.featureKey === "club-calendar");

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }) }));
vi.mock("@/lib/logger", () => ({ logError: () => undefined }));
vi.mock("@/lib/prisma", () => {
  const client = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const before = { logs: [...state.logs], outbox: [...state.outbox], audit: [...state.audit] };
      try {
        return await run(client);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    organization: {
      findFirst: async ({ where }: { where: { id: string; type?: string; isActive?: boolean } }) => state.clubs.find((club) => club.id === where.id && club.isActive === where.isActive && club.type === where.type) ?? null,
    },
    clubOptionalFeature: {
      findUnique: async ({ where }: { where: { organizationId_featureKey: { organizationId: string; featureKey: string } } }) => (hasFeature(where.organizationId_featureKey.organizationId) && where.organizationId_featureKey.featureKey === "club-calendar" ? { id: "feature" } : null),
    },
    clubCalendarReminderSetting: {
      findMany: async ({ where }: { where: { enabled: boolean; organization: { type: string; isActive: boolean; guestEventId: null; clubOptionalFeatures: { some: { featureKey: string } } } } }) => {
        // The query must ask for exactly: reminders on, an active conference club, the calendar feature on.
        expect(where.enabled).toBe(true);
        expect(where.organization).toMatchObject({ type: "CLUB", isActive: true, guestEventId: null, clubOptionalFeatures: { some: { featureKey: "club-calendar" } } });
        return state.settings
          .filter((row) => row.enabled === true)
          .flatMap((row) => {
            const club = state.clubs.find((candidate) => candidate.id === row.organizationId);
            return club && club.isActive === true && hasFeature(row.organizationId) ? [{ organizationId: row.organizationId, daysBefore: row.daysBefore, organization: { name: club.name } }] : [];
          });
      },
      findUnique: async ({ where }: { where: { organizationId: string } }) => state.settings.find((row) => row.organizationId === where.organizationId) ?? null,
    },
    clubCalendarItem: {
      findMany: async ({ where }: { where: { organizationId: { in: string[] }; date: { gte: string; lte: string } } }) =>
        state.items.filter((row) => where.organizationId.in.includes(row.organizationId as string) && (row.date as string) >= where.date.gte && (row.date as string) <= where.date.lte).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))),
      findUnique: async ({ where }: { where: { id: string } }) => state.items.find((row) => row.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => state.items.find((row) => row.id === where.id && row.organizationId === where.organizationId) ?? null,
    },
    clubCalendarReminderLog: {
      findMany: async ({ where }: { where: { itemId: { in: string[] } } }) => state.logs.filter((row) => where.itemId.in.includes(row.itemId as string)),
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const row of data) {
          const duplicate = state.logs.some((log) => log.itemId === row.itemId && log.itemDate === row.itemDate);
          if (duplicate && !skipDuplicates) throw new Error("Unique constraint failed");
          if (!duplicate) { state.logs.push({ id: `log-${state.nextId++}`, ...row }); count += 1; }
        }
        return { count };
      },
    },
    clubDirectorGrant: { findMany: async ({ where }: { where: { organizationId: { in: string[] }; role: { in: string[] }; attendeeAccount?: unknown } }) => {
      // The query must ask for all four roles and active accounts only; the stand-in then applies exactly that filter.
      expect([...where.role.in].sort()).toEqual(["DEPUTY", "DIRECTOR"]);
      const allowed = where.role.in;
      expect(where.attendeeAccount).toEqual({ disabledAt: null, status: "ACTIVE" });
      return state.grants.filter((grant) => where.organizationId.in.includes(grant.organizationId as string) && allowed.includes(grant.role as string) && activeAccount(grant.attendeeAccount));
    } },
    messageOutbox: {
      create: async ({ data }: { data: Row }) => {
        if (state.failOutboxFor && String(data.idempotencyKey).includes(state.failOutboxFor)) throw new Error("synthetic outbox failure");
        if (state.outbox.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error("Unique constraint failed on idempotencyKey");
        const row = { id: `message-${state.nextId++}`, ...data };
        state.outbox.push(row);
        return { id: row.id };
      },
    },
  };
  return { getPrisma: () => client };
});
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Row) => { state.audit.push(entry); } }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: async (options: { messageIds: string[] }) => { state.delivered.push(options.messageIds); return { sentIds: options.messageIds, rescheduledIds: [] }; } }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: () => state.emailConfigured,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));
vi.mock("@/modules/communications/email-preferences-repository", () => ({
  loadAnnouncementOptOuts: async (_client: unknown, emails: string[], eventId: string) => {
    expect(eventId).toBe(""); // event-less mail: only a global opt-out can apply
    return state.optOuts.filter((row) => emails.includes(row.normalizedEmail as string));
  },
}));

import { clubCalendarReminderCheck, sendDueClubCalendarReminders } from "@/modules/club-calendar/reminders";

const past = new Date("2026-01-01T00:00:00.000Z");
const account = (email: string, over: Row = {}) => ({ displayName: email.split("@")[0]!, email, disabledAt: null, status: "ACTIVE", ...over });
const grant = (organizationId: string, role: string, email: string, over: Row = {}, accountOver: Row = {}) => ({ organizationId, role, effectiveFrom: past, effectiveTo: null, revokedAt: null, attendeeAccount: account(email, accountOver), ...over });

// 9:00 a.m. Central on Tuesday 10 November 2026.
const NOW = new Date("2026-11-10T15:00:00.000Z");

beforeEach(() => {
  Object.assign(state, {
    clubs: [{ id: "club-1", name: "Test Pathfinders", type: "CLUB", isActive: true }, { id: "club-2", name: "Other Adventurers", type: "CLUB", isActive: true }],
    features: [{ organizationId: "club-1", featureKey: "club-calendar" }],
    settings: [{ organizationId: "club-1", enabled: true, daysBefore: 2 }],
    items: [{ id: "item-1", organizationId: "club-1", kind: "OUTING", title: "Canoe trip", date: "2026-11-12", startTime: "09:00", endTime: null, location: "Synthetic Lake", notes: "Private note" }],
    logs: [],
    grants: [
      grant("club-1", "DIRECTOR", "director@example.test"),
      grant("club-1", "DEPUTY", "deputy@example.test"),
      grant("club-1", "REGISTRAR", "registrar@example.test"),
      grant("club-1", "REPORTER", "reporter@example.test"),
    ],
    optOuts: [], outbox: [], audit: [], delivered: [], emailConfigured: true, failOutboxFor: null, nextId: 1,
  });
});

const run = (now = NOW) => sendDueClubCalendarReminders({ now });

describe("what is sent", () => {
  it("queues one email each to the director and deputy only, never the registrar or reporter, with the item's details and no notes", async () => {
    const result = await run();
    expect(result).toMatchObject({ status: "RAN", clubs: 1, reminded: 1, noRecipient: 0, failed: 0, delivered: 2 });
    expect(state.outbox.map((row) => row.recipientEmail).sort()).toEqual(["deputy@example.test", "director@example.test"]);
    const message = state.outbox[0]!;
    expect(message).toMatchObject({ eventId: null, templateKey: "CLUB_CALENDAR_REMINDER", recipientKind: "ACCOUNT", status: "PENDING" });
    expect(message.metadata).toMatchObject({ organizationId: "club-1", itemId: "item-1", itemDate: "2026-11-12" });
    const text = `${message.subjectSnapshot}\n${message.bodyTextSnapshot}`;
    expect(text).toContain("Test Pathfinders");
    expect(text).toContain("Canoe trip");
    expect(text).toContain("Synthetic Lake");
    expect(text).toContain("https://events.example.test/account/clubs/club-1/calendar?month=2026-11");
    expect(text).not.toContain("Private note");
    expect(state.logs).toEqual([expect.objectContaining({ itemId: "item-1", itemDate: "2026-11-12", organizationId: "club-1", recipients: 2 })]);
    expect(state.audit).toEqual([expect.objectContaining({ action: "CLUB_CALENDAR_REMINDER_SENT", metadata: { organizationId: "club-1", itemId: "item-1", kind: "OUTING", recipients: 2 } })]);
    expect(JSON.stringify(state.audit)).not.toMatch(/example\.test|Canoe|Private/);
  });
});

describe("off by default", () => {
  it("queues nothing when the club has no reminder setting row", async () => {
    state.settings = [];
    const result = await run();
    expect(result).toMatchObject({ status: "RAN", clubs: 0, reminded: 0 });
    expect(state.outbox).toEqual([]);
    expect(state.logs).toEqual([]);
  });
  it("queues nothing when reminders are off in the row", async () => {
    state.settings = [{ organizationId: "club-1", enabled: false, daysBefore: 2 }];
    await run();
    expect(state.outbox).toEqual([]);
  });
  it("queues nothing when the calendar feature is off, even with reminders on", async () => {
    state.features = [];
    await run();
    expect(state.outbox).toEqual([]);
  });
  it("queues nothing for a club that is no longer active", async () => {
    state.clubs[0]!.isActive = false;
    await run();
    expect(state.outbox).toEqual([]);
  });
  it("does nothing while email is not configured, and before 8 a.m. Central", async () => {
    state.emailConfigured = false;
    expect((await run()).status).toBe("EMAIL_NOT_CONFIGURED");
    state.emailConfigured = true;
    expect((await run(new Date("2026-11-10T13:59:00.000Z"))).status).toBe("NOT_DUE");
    expect(state.outbox).toEqual([]);
  });
});

describe("which items are due", () => {
  it("skips an item beyond the club's days before, and a past item", async () => {
    state.items = [
      { ...state.items[0]!, id: "far", date: "2026-11-13" },
      { ...state.items[0]!, id: "old", date: "2026-11-09" },
    ];
    expect(await run()).toMatchObject({ reminded: 0 });
    expect(state.outbox).toEqual([]);
  });
  it("uses each club's own days before", async () => {
    state.settings = [{ organizationId: "club-1", enabled: true, daysBefore: 5 }];
    state.items = [{ ...state.items[0]!, date: "2026-11-15" }];
    expect(await run()).toMatchObject({ reminded: 1 });
  });
  it("sends for an item on the day itself", async () => {
    state.items = [{ ...state.items[0]!, date: "2026-11-10" }];
    expect(await run()).toMatchObject({ reminded: 1 });
  });
  it("counts the cap after setting aside items with nobody to email, so they cannot starve it", async () => {
    state.clubs.push({ id: "club-3", name: "No Leaders", type: "CLUB", isActive: true });
    state.features.push({ organizationId: "club-3", featureKey: "club-calendar" });
    state.settings.push({ organizationId: "club-3", enabled: true, daysBefore: 2 });
    const stuck = Array.from({ length: 100 }, (_, index) => ({ ...state.items[0]!, id: `a-stuck-${String(index).padStart(3, "0")}`, organizationId: "club-3", date: "2026-11-11" }));
    state.items = [...stuck, { ...state.items[0]!, id: "z-real", date: "2026-11-12" }];
    expect(await run()).toMatchObject({ reminded: 1, noRecipient: 100 });
    expect(state.outbox.every((row) => (row.metadata as Row).itemId === "z-real")).toBe(true);
  });
  it("caps one run at 100 items", async () => {
    state.items = Array.from({ length: 120 }, (_, index) => ({ ...state.items[0]!, id: `item-${String(index).padStart(3, "0")}` }));
    expect(await run()).toMatchObject({ reminded: 100 });
    expect(await run()).toMatchObject({ reminded: 20 });
  });
});

describe("it cannot send twice", () => {
  it("queues nothing on a second run", async () => {
    await run();
    const queued = state.outbox.length;
    expect(await run()).toMatchObject({ reminded: 0 });
    expect(state.outbox).toHaveLength(queued);
    expect(state.logs).toHaveLength(1);
  });
  it("queues nothing when another run claimed the item first (a lost unique write)", async () => {
    state.logs.push({ id: "log-x", itemId: "item-1", itemDate: "2026-11-12", organizationId: "club-1", recipients: 4 });
    expect(await run()).toMatchObject({ reminded: 0 });
    expect(state.outbox).toEqual([]);
  });
  it("re-arms an item moved to a new date, with new outbox keys", async () => {
    await run();
    const firstKeys = state.outbox.map((row) => row.idempotencyKey);
    state.items[0]!.date = "2026-11-11";
    expect(await run()).toMatchObject({ reminded: 1 });
    const keys = state.outbox.map((row) => row.idempotencyKey as string);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => !firstKeys.includes(key))).toHaveLength(2);
  });
  it("rolls the claim back when queueing fails, so the next sweep retries", async () => {
    state.failOutboxFor = "deputy@example.test";
    expect(await run()).toMatchObject({ reminded: 0, failed: 1 });
    expect(state.logs).toEqual([]);
    expect(state.outbox).toEqual([]);
    state.failOutboxFor = null;
    expect(await run()).toMatchObject({ reminded: 1, failed: 0 });
  });
  it("does not claim or queue when the setting was turned off after the first read", async () => {
    // The stand-in's findMany sees it on; the transaction's own re-read sees it off.
    const settingRow = state.settings[0]!;
    let reads = 0;
    Object.defineProperty(settingRow, "enabled", { get: () => reads++ < 1, configurable: true });
    // It was seen as on (one club looked at), then found off inside the transaction.
    expect(await run()).toMatchObject({ clubs: 1, reminded: 0, failed: 0 });
    expect(state.logs).toEqual([]);
    expect(state.outbox).toEqual([]);
  });
});

describe("who is emailed", () => {
  it("skips an address that opted out of ALL IMAdventist announcements, and emails the rest", async () => {
    state.optOuts = [{ normalizedEmail: "deputy@example.test", scope: "ALL", eventId: null }];
    await run();
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["director@example.test"]);
    expect(state.logs[0]).toMatchObject({ recipients: 1 });
  });
  it("does not email an ended, revoked, scheduled, disabled or unverified director or deputy", async () => {
    state.grants = [
      grant("club-1", "DIRECTOR", "ended@example.test", { effectiveTo: new Date("2026-11-01T00:00:00.000Z") }),
      grant("club-1", "DEPUTY", "revoked@example.test", { revokedAt: new Date("2026-11-01T00:00:00.000Z") }),
      grant("club-1", "DEPUTY", "later@example.test", { effectiveFrom: new Date("2026-12-01T00:00:00.000Z") }),
      grant("club-1", "DEPUTY", "disabled@example.test", {}, { disabledAt: new Date("2026-10-01T00:00:00.000Z") }),
      grant("club-1", "DEPUTY", "pending@example.test", {}, { status: "PENDING" }),
      grant("club-1", "DIRECTOR", "current@example.test"),
    ];
    await run();
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["current@example.test"]);
  });
  it("emails a person who holds two roles once", async () => {
    state.grants = [grant("club-1", "DIRECTOR", "same@example.test"), grant("club-1", "DEPUTY", "Same@Example.test")];
    await run();
    expect(state.outbox).toHaveLength(1);
  });
  it("leaves a due item unclaimed when nobody can be emailed, so a later role holder still gets it", async () => {
    state.grants = [];
    expect(await run()).toMatchObject({ reminded: 0, noRecipient: 1 });
    expect(state.logs).toEqual([]);
    state.grants = [grant("club-1", "DIRECTOR", "new@example.test")];
    expect(await run()).toMatchObject({ reminded: 1 });
  });
  it("leaves an item unclaimed when every role holder opted out", async () => {
    state.optOuts = state.grants.map((row) => ({ normalizedEmail: (row.attendeeAccount as { email: string }).email, scope: "ALL", eventId: null }));
    expect(await run()).toMatchObject({ reminded: 0, noRecipient: 1 });
    expect(state.logs).toEqual([]);
  });
});

describe("the re-check at delivery", () => {
  const message = { recipientEmail: "director@example.test", metadata: { organizationId: "club-1", itemId: "item-1", itemDate: "2026-11-12" } };
  // The stand-in client has what the check reads.
  const client = async () => (await import("@/lib/prisma")).getPrisma() as never;

  it("lets a wanted reminder go", async () => {
    expect(await clubCalendarReminderCheck(message, NOW, await client())).toBeNull();
  });
  it.each([
    ["the item was deleted", () => { state.items = []; }],
    ["the item moved to another date", () => { state.items[0]!.date = "2026-11-14"; }],
    ["reminders were turned off", () => { state.settings[0]!.enabled = false; }],
    ["the calendar was turned off", () => { state.features = []; }],
    ["the club is no longer active", () => { state.clubs[0]!.isActive = false; }],
    ["the recipient is only a registrar now", () => { state.grants[0]!.role = "REGISTRAR"; }],
    ["the recipient lost their role", () => { state.grants = state.grants.filter((row) => (row.attendeeAccount as { email: string }).email !== "director@example.test"); }],
    ["the recipient's grant ended", () => { state.grants[0]!.effectiveTo = new Date("2026-11-09T00:00:00.000Z"); }],
    ["the recipient's account was disabled", () => { (state.grants[0]!.attendeeAccount as Row).disabledAt = new Date("2026-11-09T00:00:00.000Z"); }],
  ])("cancels when %s", async (_name, change) => {
    change();
    expect(await clubCalendarReminderCheck(message, NOW, await client())).toMatchObject({ kind: "OBSOLETE" });
  });
  it("cancels once the item's date has passed, and when the message has no item ids", async () => {
    expect(await clubCalendarReminderCheck(message, new Date("2026-11-13T15:00:00.000Z"), await client())).toMatchObject({ kind: "OBSOLETE" });
    expect(await clubCalendarReminderCheck({ recipientEmail: "director@example.test", metadata: {} }, NOW, await client())).toMatchObject({ kind: "OBSOLETE" });
  });
});
