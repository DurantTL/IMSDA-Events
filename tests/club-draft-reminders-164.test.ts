import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #164: the club registration reminder job and its delivery re-check against an in-memory stand-in for the database.
 * The clock is pinned; clubs, people, addresses and events are synthetic.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  policies: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  events: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  drafts: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  logs: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  grants: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  outbox: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  audit: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  delivered: [] as string[][],
  emailMode: { deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "ON" } as { deliveryMode: string; deliveryReason: string },
  failOutbox: false,
  deliverThrows: false,
  /** Runs when a claiming transaction opens: a change made by someone else after the job's first reads. */
  beforeTransaction: null as null | (() => void),
  /** Reads of earlier attempts return nothing, as when another worker's claim lands after this worker's reads. */
  hideLogs: false,
  nextId: 1,
}));

const activeAccount = (account: unknown) => { const row = account as { disabledAt?: Date | null; status?: string }; return !row.disabledAt && (row.status ?? "ACTIVE") === "ACTIVE"; };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }) }));
vi.mock("@/lib/logger", () => ({ logError: () => undefined }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); } }));
vi.mock("@/modules/communications/effective-delivery", () => ({
  loadEventEmailSettings: async () => ({ ...state.emailMode, senderName: "IMAdventist", senderEmail: "events@example.test", replyToEmail: null }),
}));
vi.mock("@/modules/communications/messaging-repository", () => ({
  processQueuedMessageIdsAfterCommit: async (ids: string[]) => {
    if (state.deliverThrows) throw new Error("synthetic provider outage");
    state.delivered.push(ids);
    return { sentIds: ids };
  },
}));
vi.mock("@/lib/prisma", () => {
  const eventOf = (id: string) => state.events.find((event) => event.id === id);
  const client = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      state.beforeTransaction?.();
      const before = { logs: [...state.logs], outbox: [...state.outbox], audit: [...state.audit] };
      try {
        return await run(client);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    clubDraftReminderPolicy: {
      findMany: async ({ where }: { where: { enabled: boolean } }) => state.policies
        .filter((policy) => policy.enabled === where.enabled && eventOf(policy.eventId))
        .map((policy) => ({ ...policy, event: eventOf(policy.eventId) })),
      findUnique: async ({ where }: { where: { eventId: string } }) => state.policies.find((policy) => policy.eventId === where.eventId) ?? null,
    },
    clubRegistrationDraft: {
      findMany: async ({ where }: { where: { eventId: string; updatedAt: { lte: Date; gt: Date } } }) => state.drafts
        .filter((draft) => draft.eventId === where.eventId && draft.updatedAt <= where.updatedAt.lte && draft.updatedAt > where.updatedAt.gt && draft.organization.isActive !== false)
        .map((draft) => ({ ...draft })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const draft = state.drafts.find((row) => row.id === where.id);
        return draft ? { ...draft, event: eventOf(draft.eventId) } : null;
      },
    },
    clubDraftReminderLog: {
      findMany: async ({ where }: { where: { draftId: string | { in: string[] } } }) => (state.hideLogs ? [] : state.logs).filter((log) => (typeof where.draftId === "string" ? where.draftId === log.draftId : where.draftId.in.includes(log.draftId))),
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const row of data) {
          const duplicate = state.logs.some((log) => log.draftId === row.draftId && log.attempt === row.attempt);
          if (duplicate && !skipDuplicates) throw new Error("Unique constraint failed");
          if (!duplicate) { state.logs.push({ id: `log-${state.nextId++}`, ...row }); count += 1; }
        }
        return { count };
      },
    },
    clubDirectorGrant: {
      findMany: async ({ where }: { where: { organizationId: { in: string[] }; attendeeAccount?: unknown } }) => {
        // The query must ask for active accounts only; the stand-in then applies exactly that filter.
        expect(where.attendeeAccount).toEqual({ disabledAt: null, status: "ACTIVE" });
        return state.grants.filter((grant) => where.organizationId.in.includes(grant.organizationId) && activeAccount(grant.attendeeAccount));
      },
    },
    messageOutbox: {
      create: async ({ data }: { data: Row }) => {
        if (state.failOutbox) throw new Error("synthetic outbox failure");
        if (state.outbox.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error("Unique constraint failed on idempotencyKey");
        const row = { id: `message-${state.nextId++}`, ...data };
        state.outbox.push(row);
        return { id: row.id };
      },
    },
  };
  return { getPrisma: () => client };
});

import { clubDraftReminderObsoleteReason, sendDueClubDraftReminders } from "@/modules/club-registrations/draft-reminders";

const at = (iso: string) => new Date(iso);
// 2026-11-13 11:00 in Chicago (CST): inside the send hours.
const NOON = at("2026-11-13T17:00:00Z");

const event = (overrides: Row = {}) => ({
  id: "event-1", name: "Synthetic Camporee", timezone: "America/Chicago", isPublished: true, archivedAt: null, lifecycleState: null,
  registrationOpensOn: null, registrationClosesOn: "2026-12-01", waitlistEnabled: false, endsAt: at("2027-01-10T00:00:00Z"), ...overrides,
});
const policy = (overrides: Row = {}) => ({ eventId: "event-1", enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30, ...overrides });
const draft = (id: string, organizationId: string, updatedAt: Date, overrides: Row = {}) => ({
  id, eventId: "event-1", organizationId, draftKey: "", updatedAt, organization: { name: `Club ${organizationId}`, isActive: true }, ...overrides,
});
const grant = (organizationId: string, email: string, role = "DIRECTOR", account: Row = {}) => ({
  organizationId, role, effectiveFrom: at("2026-01-01T00:00:00Z"), effectiveTo: null, revokedAt: null,
  attendeeAccount: { displayName: "Pat Person", email, status: "ACTIVE", disabledAt: null, ...account },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
  Object.assign(state, {
    policies: [policy()], events: [event()], drafts: [], logs: [], grants: [], outbox: [], audit: [], delivered: [],
    emailMode: { deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "ON" }, failOutbox: false, deliverThrows: false, beforeTransaction: null, hideLogs: false, nextId: 1,
  });
  // Club a edited its draft four days ago, so its first reminder is due.
  state.drafts.push(draft("draft-a", "club-a", new Date(NOON.getTime() - 4 * DAY)));
  state.grants.push(grant("club-a", "a.director@example.test"), grant("club-a", "a.deputy@example.test", "DEPUTY"), grant("club-a", "a.registrar@example.test", "REGISTRAR"));
});
afterEach(() => vi.useRealTimers());

describe("off by default", () => {
  it("queues nothing when the event has no policy row", async () => {
    state.policies = [];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ status: "RAN", events: 0, reminded: 0, failed: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });

  it("queues nothing when the policy row exists but is switched off", async () => {
    state.policies = [policy({ enabled: false })];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ events: 0, reminded: 0 });
    expect(state.outbox).toHaveLength(0);
  });
});

describe("a due reminder", () => {
  it("goes to the director and deputy only, in the event slice, with ids and counts in the metadata and the audit entry", async () => {
    const result = await sendDueClubDraftReminders({ now: NOON });
    expect(result).toEqual({ status: "RAN", events: 1, reminded: 1, noRecipient: 0, skippedEmailOff: 0, skippedQuietHours: 0, failed: 0, delivered: 2 });
    expect(state.outbox.map((row) => row.recipientEmail).sort()).toEqual(["a.deputy@example.test", "a.director@example.test"]);
    for (const row of state.outbox) {
      expect(row).toMatchObject({ eventId: "event-1", templateKey: "CLUB_DRAFT_REMINDER", recipientKind: "CLUB_DIRECTOR", status: "PENDING", senderEmailSnapshot: "events@example.test" });
      expect(row.metadata).toEqual({ trigger: "CLUB_DRAFT_REMINDER", draftId: "draft-a", organizationId: "club-a", attempt: 1, deliveryMode: "EXTERNAL_EMAIL", realDelivery: true });
      expect(row.bodyTextSnapshot).toContain("https://events.example.test/account/clubs/club-a/events/event-1");
      expect(row.idempotencyKey).toBe(`club-draft-reminder:draft-a:1:${row.recipientEmail}`);
    }
    expect(state.logs).toEqual([expect.objectContaining({ eventId: "event-1", organizationId: "club-a", draftId: "draft-a", attempt: 1, recipients: 2 })]);
    expect(state.audit).toEqual([expect.objectContaining({ action: "CLUB_DRAFT_REMINDER_QUEUED", metadata: { eventId: "event-1", organizationId: "club-a", draftId: "draft-a", attempt: 1, recipients: 2 } })]);
    expect(JSON.stringify(state.audit)).not.toContain("example.test");
    expect(state.delivered).toEqual([state.outbox.map((row) => row.id)]);
  });

  it("is not due before the first wait has passed", async () => {
    state.drafts = [draft("draft-a", "club-a", new Date(NOON.getTime() - 1 * DAY))];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0 });
    expect(state.outbox).toHaveLength(0);
  });

  it("stays queued for the sweep when immediate delivery fails, and still counts as reminded", async () => {
    state.deliverThrows = true;
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 1, delivered: 0, failed: 0 });
    expect(state.outbox.every((row) => row.status === "PENDING")).toBe(true);
  });
});

describe("retries and duplicate workers", () => {
  it("running again sends nothing more until the repeat wait has passed", async () => {
    await sendDueClubDraftReminders({ now: NOON });
    expect((await sendDueClubDraftReminders({ now: NOON })).reminded).toBe(0);
    expect((await sendDueClubDraftReminders({ now: new Date(NOON.getTime() + 2 * DAY) })).reminded).toBe(0);
    expect(state.outbox).toHaveLength(2);
    expect(state.logs).toHaveLength(1);
  });

  it("two concurrent runs queue the reminder once", async () => {
    const results = await Promise.all([sendDueClubDraftReminders({ now: NOON }), sendDueClubDraftReminders({ now: NOON })]);
    expect(state.outbox).toHaveLength(2);
    expect(state.logs).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.reminded, 0)).toBe(1);
  });

  it("a worker that loses the claim queues nothing, because only the unique (draft, attempt) key is left to stop it", async () => {
    state.logs.push({ id: "log-x", eventId: "event-1", organizationId: "club-a", draftId: "draft-a", attempt: 1, recipients: 2, sentAt: NOON });
    state.hideLogs = true;
    const result = await sendDueClubDraftReminders({ now: NOON });
    expect(result).toMatchObject({ reminded: 0, failed: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(1);
    expect(state.audit).toHaveLength(0);
  });

  it("a failed queueing rolls the claim back so the next sweep retries it", async () => {
    state.failOutbox = true;
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, failed: 1 });
    expect(state.logs).toHaveLength(0);
    state.failOutbox = false;
    expect((await sendDueClubDraftReminders({ now: NOON })).reminded).toBe(1);
  });

  it("sends the second reminder after the repeat wait and never a third beyond the most", async () => {
    await sendDueClubDraftReminders({ now: NOON });
    const later = new Date(NOON.getTime() + 3 * DAY);
    expect((await sendDueClubDraftReminders({ now: later })).reminded).toBe(1);
    expect(state.logs.map((log) => log.attempt)).toEqual([1, 2]);
    const muchLater = new Date(NOON.getTime() + 10 * DAY);
    expect((await sendDueClubDraftReminders({ now: muchLater })).reminded).toBe(0);
    expect(state.logs).toHaveLength(2);
    expect(state.outbox).toHaveLength(4);
  });

  it("waits again from an edit made after the first reminder", async () => {
    await sendDueClubDraftReminders({ now: NOON });
    const editedAt = new Date(NOON.getTime() + 1 * DAY);
    state.drafts[0]!.updatedAt = editedAt;
    expect((await sendDueClubDraftReminders({ now: new Date(NOON.getTime() + 3 * DAY) })).reminded).toBe(0);
    expect((await sendDueClubDraftReminders({ now: new Date(editedAt.getTime() + 3 * DAY) })).reminded).toBe(1);
  });
});

describe("submission before send", () => {
  it("does not remind a draft that was submitted, because submitting deletes it", async () => {
    state.drafts = [];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0 });
    expect(state.outbox).toHaveLength(0);
  });

  it("queues nothing when the draft is submitted between the first read and the claim", async () => {
    state.beforeTransaction = () => { state.drafts = []; };
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, failed: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });

  it("queues nothing when staff turn the switch off between the first read and the claim", async () => {
    state.beforeTransaction = () => { state.policies = [policy({ enabled: false })]; };
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, failed: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });

  it("queues nothing when the director edits the draft between the first read and the claim", async () => {
    state.beforeTransaction = () => { state.drafts[0]!.updatedAt = NOON; };
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, failed: 0 });
    expect(state.outbox).toHaveLength(0);
  });
});

describe("expired and closed", () => {
  it("never reminds a draft not edited for longer than the expiry", async () => {
    state.drafts = [draft("draft-old", "club-a", new Date(NOON.getTime() - 31 * DAY))];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, failed: 0 });
    expect(state.outbox).toHaveLength(0);
  });

  it("sends nothing once registration has closed", async () => {
    state.events = [event({ registrationClosesOn: "2026-11-12" })];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ events: 1, reminded: 0 });
    expect(state.outbox).toHaveLength(0);
  });
});

describe("email off and quiet hours", () => {
  it.each([
    ["paused", { deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" }],
    ["captured locally", { deliveryMode: "LOCAL_CAPTURE", deliveryReason: "NOT_CONFIGURED" }],
    ["sender missing", { deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "SENDER_MISSING" }],
  ])("skips an event whose email is %s and counts it", async (_label, mode) => {
    state.emailMode = mode;
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ events: 1, skippedEmailOff: 1, reminded: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });

  it("waits for the send hours in the event's own time zone", async () => {
    const night = at("2026-11-13T03:00:00Z"); // 9 pm the evening before, Chicago
    expect(await sendDueClubDraftReminders({ now: night })).toMatchObject({ skippedQuietHours: 1, reminded: 0 });
    const early = at("2026-11-13T14:00:00Z"); // 8 am Chicago
    expect(await sendDueClubDraftReminders({ now: early })).toMatchObject({ skippedQuietHours: 1, reminded: 0 });
    expect(state.outbox).toHaveLength(0);
    expect((await sendDueClubDraftReminders({ now: at("2026-11-13T15:00:00Z") })).reminded).toBe(1);
  });
});

describe("who is eligible", () => {
  it("queues nothing and claims nothing when the club has nobody to email, and counts it", async () => {
    state.grants = [grant("club-a", "a.registrar@example.test", "REGISTRAR")];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, noRecipient: 1, failed: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });

  it("skips a disabled or unverified account, a revoked grant and an ended grant", async () => {
    state.grants = [
      grant("club-a", "disabled@example.test", "DIRECTOR", { disabledAt: at("2026-10-01T00:00:00Z") }),
      grant("club-a", "pending@example.test", "DEPUTY", { status: "PENDING" }),
      { ...grant("club-a", "revoked@example.test"), revokedAt: at("2026-10-01T00:00:00Z") },
      { ...grant("club-a", "ended@example.test"), effectiveTo: at("2026-11-01T00:00:00Z") },
      grant("club-a", "current@example.test"),
    ];
    await sendDueClubDraftReminders({ now: NOON });
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["current@example.test"]);
    expect(state.logs[0]).toMatchObject({ recipients: 1 });
  });

  it("uses the new director on the next attempt after the contact changed", async () => {
    await sendDueClubDraftReminders({ now: NOON });
    state.grants = [grant("club-a", "new.director@example.test")];
    await sendDueClubDraftReminders({ now: new Date(NOON.getTime() + 3 * DAY) });
    expect(state.outbox.filter((row) => row.metadata.attempt === 2).map((row) => row.recipientEmail)).toEqual(["new.director@example.test"]);
  });

  it("ignores a draft of an inactive club", async () => {
    state.drafts = [draft("draft-x", "club-x", new Date(NOON.getTime() - 4 * DAY), { organization: { name: "Closed", isActive: false } })];
    expect(await sendDueClubDraftReminders({ now: NOON })).toMatchObject({ reminded: 0, noRecipient: 0 });
  });
});

describe("the check at delivery", () => {
  const message = (overrides: Row = {}) => ({ eventId: "event-1", recipientEmail: "a.director@example.test", metadata: { draftId: "draft-a", organizationId: "club-a", attempt: 1 }, ...overrides });

  it("lets a reminder through while the draft exists, is fresh, registration is open and the person is still a director", async () => {
    expect(await clubDraftReminderObsoleteReason(message(), NOON)).toBeNull();
    // The address is compared without regard to case or spaces.
    expect(await clubDraftReminderObsoleteReason(message({ recipientEmail: " A.Director@Example.test " }), NOON)).toBeNull();
  });

  it("is obsolete once the draft was submitted or removed", async () => {
    state.drafts = [];
    expect(await clubDraftReminderObsoleteReason(message(), NOON)).toMatch(/submitted, removed or expired/);
  });

  it("is obsolete once the draft has expired, registration has closed, or reminders were turned off or removed", async () => {
    expect(await clubDraftReminderObsoleteReason(message(), new Date(NOON.getTime() + 27 * DAY))).not.toBeNull();
    state.events = [event({ registrationClosesOn: "2026-11-12" })];
    expect(await clubDraftReminderObsoleteReason(message(), NOON)).not.toBeNull();
    state.events = [event()];
    state.policies = [policy({ enabled: false })];
    expect(await clubDraftReminderObsoleteReason(message(), NOON)).not.toBeNull();
    state.policies = [];
    expect(await clubDraftReminderObsoleteReason(message(), NOON)).not.toBeNull();
  });

  it("is obsolete for the old address once the contact changed, while the new director's own message is not", async () => {
    state.grants = [grant("club-a", "new.director@example.test")];
    expect(await clubDraftReminderObsoleteReason(message(), NOON)).not.toBeNull();
    expect(await clubDraftReminderObsoleteReason(message({ recipientEmail: "new.director@example.test" }), NOON)).toBeNull();
  });

  it("is obsolete when the draft belongs to another event or club than the message says, or the message names no draft", async () => {
    expect(await clubDraftReminderObsoleteReason(message({ eventId: "event-2" }), NOON)).not.toBeNull();
    expect(await clubDraftReminderObsoleteReason(message({ metadata: { draftId: "draft-a", organizationId: "club-b" } }), NOON)).not.toBeNull();
    expect(await clubDraftReminderObsoleteReason(message({ metadata: {} }), NOON)).not.toBeNull();
  });
});
