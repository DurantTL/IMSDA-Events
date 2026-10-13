import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deadline reminder batches (#910) against an in-memory stand-in for the database that enforces the unique keys
 * and serializes transactions the way the advisory lock does. The real-database script
 * (`npm run test:deadline-reminders`) proves the same rules, and concurrency, on PostgreSQL.
 */
const state = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  batches: [] as Array<Record<string, unknown>>,
  outbox: [] as Array<Record<string, unknown>>,
  clubGrants: [] as Array<{ attendeeAccount: { email: string; displayName: string } }>,
  areaGrants: [] as Array<{ attendeeAccount: { email: string; displayName: string } }>,
  optOuts: [] as Array<{ normalizedEmail: string; scope: string }>,
  audit: [] as Array<{ action: string }>,
  grantQueries: [] as Array<{ kind: string; where: unknown }>,
  emailConfigured: true,
  nextId: 1,
}));

function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("gte" in c) return (value as string) >= (c.gte as string);
      if ("not" in c) return value !== c.not;
    }
    return value === condition;
  });
}

// One lock at a time, like the advisory lock the real code takes first in every transaction.
let tail: Promise<unknown> = Promise.resolve();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => {
  const client = {
    $executeRaw: async () => 1,
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const result = tail.then(() => run(client));
      tail = result.catch(() => undefined);
      return result;
    },
    calendarEntry: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => state.entries.filter((row) => matches(row, where)),
      findUnique: async ({ where }: { where: { id: string } }) => state.entries.find((row) => row.id === where.id) ?? null,
    },
    deadlineReminderBatch: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => state.batches.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = state.batches.find((row) => row.id === where.id);
        return found ? { ...found } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.batches.some((row) => row.calendarEntryId === data.calendarEntryId && row.daysBefore === data.daysBefore)) {
          throw new Error("Unique constraint failed on (calendarEntryId, daysBefore)");
        }
        const row = { id: `batch-${state.nextId++}`, status: "PENDING", statusReason: null, decidedAt: null, decidedByUserId: null, recipientCount: null, optedOutCount: null, preparedAt: new Date("2026-01-01T00:00:00Z"), ...data };
        state.batches.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.batches.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = state.batches.filter((row) => matches(row, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    clubDirectorGrant: { findMany: async (args: { where: unknown }) => { state.grantQueries.push({ kind: "club", where: args.where }); return state.clubGrants; } },
    areaCoordinatorGrant: { findMany: async (args: { where: unknown }) => { state.grantQueries.push({ kind: "area", where: args.where }); return state.areaGrants; } },
    emailAnnouncementOptOut: {
      findMany: async ({ where }: { where: { normalizedEmail: { in: string[] }; scope: string } }) =>
        state.optOuts.filter((row) => where.normalizedEmail.in.includes(row.normalizedEmail) && row.scope === where.scope),
    },
    messageOutbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.outbox.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error("Unique constraint failed on idempotencyKey");
        const row = { id: `message-${state.nextId++}`, ...data };
        state.outbox.push(row);
        return { id: row.id };
      },
    },
  };
  return { getPrisma: () => client };
});
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: { action: string }) => { state.audit.push(entry); } }));
vi.mock("@/modules/calendar/subscribe", () => ({ siteBaseUrl: () => "https://events.example.test" }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: () => state.emailConfigured,
  getAccountEmailSender: () => ({ name: "IMSDA Events", address: "events@example.test", replyTo: null }),
}));

import {
  DeadlineReminderError,
  dismissReminderBatch,
  listPendingReminderBatches,
  loadReminderRecipients,
  reconcileDeadlineReminders,
  reminderClubRoles,
  sendReminderBatch,
} from "@/modules/calendar/deadline-reminders";

const entry = (patch: Record<string, unknown> = {}) => ({
  id: "entry-1", title: "Spring Camporee Registration Due", startsOn: "2026-12-05", endsOn: "2026-12-05", linkUrl: "https://example.test/register",
  status: "SCHEDULED", entryType: "DEADLINE", isPublished: true, isHiddenLocally: false, sourceRemovedAt: null, repeatRule: null, ...patch,
});
const account = (email: string, displayName = "Person") => ({ attendeeAccount: { email, displayName } });
const at = (iso: string) => new Date(iso);
const pending = () => state.batches.filter((batch) => batch.status === "PENDING");
const dbRecipients = () => loadReminderRecipients({
  clubDirectorGrant: { findMany: async () => state.clubGrants },
  areaCoordinatorGrant: { findMany: async () => state.areaGrants },
  emailAnnouncementOptOut: { findMany: async ({ where }: { where: { normalizedEmail: { in: string[] } } }) => state.optOuts.filter((row) => where.normalizedEmail.in.includes(row.normalizedEmail) && row.scope === "ALL") },
} as never, at("2026-12-03T18:00:00Z"));

beforeEach(() => {
  state.entries = [entry()];
  state.batches = [];
  state.outbox = [];
  state.clubGrants = [account("director@example.test", "Dana Director"), account("deputy@example.test", "Dee Deputy")];
  state.areaGrants = [account("area@example.test", "Ari Area")];
  state.optOuts = [];
  state.audit = [];
  state.grantQueries = [];
  state.emailConfigured = true;
  state.nextId = 1;
  tail = Promise.resolve();
});

describe("when a reminder is prepared (conference time zone)", () => {
  it("prepares nothing before the 14-day point and one batch when it arrives", async () => {
    expect(await reconcileDeadlineReminders(at("2026-11-21T05:59:00Z"))).toEqual({ prepared: 0, updated: 0, withdrawn: 0 });
    expect(state.batches).toHaveLength(0);
    expect(await reconcileDeadlineReminders(at("2026-11-21T06:00:00Z"))).toEqual({ prepared: 1, updated: 0, withdrawn: 0 });
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toMatchObject({ calendarEntryId: "entry-1", daysBefore: 14, status: "PENDING", dueOn: "2026-12-05", title: "Spring Camporee Registration Due" });
  });

  it("prepares the 2-day batch at its point and withdraws the 14-day one it replaces", async () => {
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    expect(await reconcileDeadlineReminders(at("2026-12-03T05:59:00Z"))).toMatchObject({ prepared: 0, withdrawn: 0 }); // Dec 2 in Chicago
    const result = await reconcileDeadlineReminders(at("2026-12-03T06:00:00Z"));
    expect(result).toMatchObject({ prepared: 1, withdrawn: 1 });
    expect(state.batches.map((batch) => `${batch.daysBefore}:${batch.status}`).sort()).toEqual(["14:WITHDRAWN", "2:PENDING"]);
  });

  it("holds at the daylight-saving change (the 14-day point of a Nov 15 deadline is Nov 1)", async () => {
    state.entries = [entry({ startsOn: "2026-11-15", endsOn: "2026-11-15" })];
    await reconcileDeadlineReminders(at("2026-11-01T04:59:00Z")); // Oct 31, 11:59 PM CDT
    expect(state.batches).toHaveLength(0);
    await reconcileDeadlineReminders(at("2026-11-01T05:00:00Z")); // Nov 1, midnight CDT
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].daysBefore).toBe(14);
    await reconcileDeadlineReminders(at("2026-11-13T05:59:00Z")); // Nov 12, 11:59 PM CST
    expect(state.batches).toHaveLength(1);
    await reconcileDeadlineReminders(at("2026-11-13T06:00:00Z")); // Nov 13, midnight CST
    expect(state.batches.map((batch) => `${batch.daysBefore}:${batch.status}`).sort()).toEqual(["14:WITHDRAWN", "2:PENDING"]);
  });

  it("gives a deadline added 10 days out one reminder, and none after it is due", async () => {
    state.entries = [entry({ id: "late", startsOn: "2026-12-05", endsOn: "2026-12-05" })];
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].daysBefore).toBe(14);
    await reconcileDeadlineReminders(at("2026-12-06T18:00:00Z"));
    expect(pending()).toHaveLength(0);
    expect(state.batches[0]).toMatchObject({ status: "WITHDRAWN", statusReason: "The due date has passed." });
  });

  it("never prepares the same deadline and point twice, however often or at once it runs", async () => {
    const now = at("2026-11-25T18:00:00Z");
    await Promise.all([reconcileDeadlineReminders(now), reconcileDeadlineReminders(now), reconcileDeadlineReminders(now)]);
    await reconcileDeadlineReminders(now);
    expect(state.batches).toHaveLength(1);
    expect(state.audit.filter((row) => row.action === "DEADLINE_REMINDER_PREPARED")).toHaveLength(1);
  });

  it.each([
    ["an ordinary entry", { entryType: "STANDARD" }],
    ["a draft", { isPublished: false }],
    ["a hidden import", { isHiddenLocally: true }],
    ["an import that left its feed", { sourceRemovedAt: new Date("2026-11-01") }],
    ["a cancelled deadline", { status: "CANCELLED" }],
    ["a postponed deadline", { status: "POSTPONED" }],
    ["a repeating deadline", { repeatRule: "FREQ=MONTHLY" }],
  ])("prepares nothing for %s", async (_label, patch) => {
    state.entries = [entry(patch)];
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    expect(state.batches).toHaveLength(0);
  });
});

describe("a pending batch follows its deadline before staff send it", () => {
  beforeEach(async () => {
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    expect(pending()).toHaveLength(1);
  });

  it("updates to a new date, title or link", async () => {
    state.entries = [entry({ startsOn: "2026-12-08", endsOn: "2026-12-08", title: "Spring Camporee Registration Due (extended)", linkUrl: null })];
    const result = await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    expect(result.updated).toBe(1);
    expect(pending()[0]).toMatchObject({ dueOn: "2026-12-08", title: "Spring Camporee Registration Due (extended)", linkUrl: null });
    expect(state.batches).toHaveLength(1);
  });

  it("is withdrawn when the date moves far enough that the point is not reached, and comes back when it is", async () => {
    state.entries = [entry({ startsOn: "2027-02-01", endsOn: "2027-02-01" })];
    await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    expect(pending()).toHaveLength(0);
    expect(state.batches[0].status).toBe("WITHDRAWN");
    await reconcileDeadlineReminders(at("2027-01-18T18:00:00Z")); // 14 days before Feb 1
    expect(pending()).toHaveLength(1);
    expect(state.batches).toHaveLength(1); // the same row, prepared again
    expect(state.batches[0]).toMatchObject({ status: "PENDING", dueOn: "2027-02-01", statusReason: null });
  });

  it.each([
    ["cancelled", { status: "CANCELLED" }, "The deadline was cancelled."],
    ["hidden", { isHiddenLocally: true }, "The deadline is hidden or unpublished."],
    ["unpublished", { isPublished: false }, "The deadline is hidden or unpublished."],
    ["no longer a deadline", { entryType: "STANDARD" }, "The entry is no longer marked as a deadline."],
  ])("is withdrawn when the deadline is %s", async (_label, patch, reason) => {
    state.entries = [entry(patch)];
    const result = await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    expect(result.withdrawn).toBe(1);
    expect(state.batches[0]).toMatchObject({ status: "WITHDRAWN", statusReason: reason });
    expect(state.outbox).toHaveLength(0);
  });

  it("is withdrawn when the entry is deleted, and prepared again if a deadline returns", async () => {
    state.entries = [];
    await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    expect(state.batches[0]).toMatchObject({ status: "WITHDRAWN", statusReason: "The calendar entry was removed." });
  });

  it("is prepared again, not duplicated, when a cancelled deadline is restored", async () => {
    state.entries = [entry({ status: "CANCELLED" })];
    await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    state.entries = [entry()];
    await reconcileDeadlineReminders(at("2026-11-27T18:00:00Z"));
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].status).toBe("PENDING");
  });
});

describe("the approval gate", () => {
  const now = at("2026-11-25T18:00:00Z");
  async function prepared() {
    await reconcileDeadlineReminders(now);
    const { batches } = await listPendingReminderBatches(now);
    return batches[0];
  }

  it("sends nothing when a batch is prepared, previewed or listed", async () => {
    const batch = await prepared();
    expect(state.outbox).toHaveLength(0);
    expect(batch).toMatchObject({ recipientCount: 3, clubRecipients: 2, areaRecipients: 1, optedOutCount: 0, daysBefore: 14, dueOn: "2026-12-05" });
    expect(batch.subject).toBe("Deadline reminder: Spring Camporee Registration Due (December 5, 2026)");
    expect(batch.bodyText).toContain("is due on Saturday, December 5, 2026 (in 10 days).");
    expect(batch.bodyText).toContain("https://events.example.test/account/clubs");
    expect(batch.bodyText).toContain("More details: https://example.test/register");
  });

  it("queues one email per recipient only after approval, audited, and marks the batch sent", async () => {
    const batch = await prepared();
    const result = await sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now);
    expect(result.sent).toBe(3);
    expect(state.outbox).toHaveLength(3);
    expect(state.outbox.map((row) => row.recipientEmail).sort()).toEqual(["area@example.test", "deputy@example.test", "director@example.test"]);
    expect(state.outbox.every((row) => row.eventId === null && row.templateKey === "DEADLINE_REMINDER" && row.status === "PENDING")).toBe(true);
    // The area coordinator's link goes to the area overview; club role holders' to the club portal.
    const area = state.outbox.find((row) => row.recipientEmail === "area@example.test")!;
    expect(area.bodyTextSnapshot).toContain("/account/area-clubs/overview");
    expect(state.batches[0]).toMatchObject({ status: "SENT", decidedByUserId: "admin-1", recipientCount: 3, optedOutCount: 0 });
    expect(state.audit.map((row) => row.action)).toContain("DEADLINE_REMINDER_SENT");
    expect(JSON.stringify(state.audit)).not.toContain("example.test"); // ids and counts only, never addresses
  });

  it("cannot be sent twice, and a later run never prepares it again", async () => {
    const batch = await prepared();
    await sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now);
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_NOT_PENDING" });
    await Promise.all([reconcileDeadlineReminders(now), reconcileDeadlineReminders(now)]);
    expect(state.outbox).toHaveLength(3);
    expect(state.batches).toHaveLength(1);
  });

  it("two clicks at once send exactly once", async () => {
    const batch = await prepared();
    const results = await Promise.allSettled([
      sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now),
      sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-2", now),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(state.outbox).toHaveLength(3);
  });

  it("refuses a send whose preview is out of date, and queues nothing", async () => {
    const batch = await prepared();
    state.clubGrants = [...state.clubGrants, account("newdirector@example.test")];
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_CHANGED" });
    expect(state.outbox).toHaveLength(0);
    expect(pending()).toHaveLength(1);
    // Looking again gives a fresh fingerprint that works.
    const fresh = (await listPendingReminderBatches(now)).batches[0];
    expect(fresh.recipientCount).toBe(4);
    await expect(sendReminderBatch(fresh.id, { fingerprint: fresh.fingerprint }, "admin-1", now)).resolves.toMatchObject({ sent: 4 });
  });

  it("withdraws instead of sending when the deadline was cancelled or hidden after the preview", async () => {
    const batch = await prepared();
    state.entries = [entry({ isHiddenLocally: true })];
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_WITHDRAWN" });
    expect(state.outbox).toHaveLength(0);
    expect(state.batches[0].status).toBe("WITHDRAWN");
  });

  it("refuses with a new date in the preview when the due date changed since", async () => {
    const batch = await prepared();
    state.entries = [entry({ startsOn: "2026-12-08", endsOn: "2026-12-08" })];
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_CHANGED" });
    expect(state.outbox).toHaveLength(0);
    expect(state.batches[0].dueOn).toBe("2026-12-08");
  });

  it("refuses when account email is not set up, and when nobody would receive it", async () => {
    const batch = await prepared();
    state.emailConfigured = false;
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    state.emailConfigured = true;
    state.clubGrants = [];
    state.areaGrants = [];
    const empty = (await listPendingReminderBatches(now)).batches[0];
    await expect(sendReminderBatch(empty.id, { fingerprint: empty.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "NO_RECIPIENTS" });
    expect(state.outbox).toHaveLength(0);
    expect(pending()).toHaveLength(1);
  });

  it("lets staff choose not to send; it is never prepared again and nothing is emailed", async () => {
    const batch = await prepared();
    await dismissReminderBatch(batch.id, "admin-1", now);
    expect(state.batches[0]).toMatchObject({ status: "DISMISSED", decidedByUserId: "admin-1" });
    await reconcileDeadlineReminders(now);
    expect(state.batches).toHaveLength(1);
    expect(pending()).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    await expect(dismissReminderBatch(batch.id, "admin-1", now)).rejects.toBeInstanceOf(DeadlineReminderError);
    await expect(sendReminderBatch("missing", { fingerprint: "0".repeat(64) }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_NOT_FOUND" });
  });
});

describe("who a reminder goes to", () => {
  it("asks for active roles on active clubs and lasting Area Coordinators, on enabled verified accounts", async () => {
    await listPendingReminderBatches(at("2026-12-03T18:00:00Z"));
    const clubWhere = state.grantQueries.find((query) => query.kind === "club")!.where as Record<string, unknown>;
    const areaWhere = state.grantQueries.find((query) => query.kind === "area")!.where as Record<string, unknown>;
    expect(clubWhere).toMatchObject({
      role: { in: [...reminderClubRoles] },
      revokedAt: null,
      effectiveFrom: { lte: at("2026-12-03T18:00:00Z") },
      organization: { type: "CLUB", isActive: true },
      attendeeAccount: { disabledAt: null, status: "ACTIVE" },
    });
    expect(clubWhere.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gt: at("2026-12-03T18:00:00Z") } }]);
    expect(areaWhere).toMatchObject({ revokedAt: null, expiresAt: null, attendeeAccount: { disabledAt: null, status: "ACTIVE" } });
    expect(reminderClubRoles).toEqual(["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"]);
  });

  it("sends one email per person however many roles they hold, and drops invalid addresses", async () => {
    state.clubGrants = [account("Dana@Example.test", "Dana"), account("dana@example.test", "Dana"), account("not-an-address", "Broken")];
    state.areaGrants = [account("dana@example.test", "Dana"), account("area@example.test", "Ari")];
    const { recipients, optedOut } = await dbRecipients();
    expect(recipients.map((recipient) => recipient.email)).toEqual(["area@example.test", "dana@example.test"]);
    expect(recipients.find((recipient) => recipient.email === "dana@example.test")?.audience).toBe("CLUB");
    expect(recipients.find((recipient) => recipient.email === "area@example.test")?.audience).toBe("AREA");
    expect(optedOut).toBe(0);
  });

  it("leaves out people who opted out of all announcements, counts them, and honours the opt-out at send time", async () => {
    state.optOuts = [{ normalizedEmail: "deputy@example.test", scope: "ALL" }, { normalizedEmail: "area@example.test", scope: "EVENT" }];
    const { recipients, optedOut } = await dbRecipients();
    expect(recipients.map((recipient) => recipient.email)).toEqual(["area@example.test", "director@example.test"]); // an EVENT opt-out is for that event's announcements only
    expect(optedOut).toBe(1);

    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    const batch = (await listPendingReminderBatches(now)).batches[0];
    expect(batch).toMatchObject({ recipientCount: 2, optedOutCount: 1 });
    // Someone opts out after the preview: the fingerprint no longer matches, so the send is refused until staff look again.
    state.optOuts.push({ normalizedEmail: "director@example.test", scope: "ALL" });
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_CHANGED" });
    const fresh = (await listPendingReminderBatches(now)).batches[0];
    await sendReminderBatch(fresh.id, { fingerprint: fresh.fingerprint }, "admin-1", now);
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["area@example.test"]);
    expect(state.batches[0]).toMatchObject({ recipientCount: 1, optedOutCount: 2 });
  });
});
