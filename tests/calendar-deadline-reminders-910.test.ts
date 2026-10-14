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
    if (key === "OR") return (condition as Array<Record<string, unknown>>).some((branch) => matches(row, branch));
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
        if (state.batches.some((row) => row.calendarEntryId === data.calendarEntryId && row.daysBefore === data.daysBefore && row.dueOn === data.dueOn)) {
          throw new Error("Unique constraint failed on (calendarEntryId, daysBefore, dueOn)");
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

import { expansionDiagnostics } from "@/modules/calendar/recurrence";
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
  status: "SCHEDULED", entryType: "DEADLINE", isPublished: true, isHiddenLocally: false, sourceRemovedAt: null, repeatRule: null, repeatExceptions: [] as string[], ...patch,
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
    ["a repeating deadline that has ended", { repeatRule: "FREQ=WEEKLY;UNTIL=20261101" }],
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

  it("is withdrawn when the date moves far enough that the point is not reached, and the new date is prepared when it is", async () => {
    state.entries = [entry({ startsOn: "2027-02-01", endsOn: "2027-02-01" })];
    await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    expect(pending()).toHaveLength(0);
    expect(state.batches[0].status).toBe("WITHDRAWN");
    await reconcileDeadlineReminders(at("2027-01-18T18:00:00Z")); // 14 days before Feb 1
    expect(pending()).toHaveLength(1);
    // A batch belongs to one due date: the old date's batch stays withdrawn and the new date gets its own.
    expect(state.batches.map((row) => `${row.dueOn}:${row.status}`).sort()).toEqual(["2026-12-05:WITHDRAWN", "2027-02-01:PENDING"]);
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
    expect(batch).toMatchObject({ recipientCount: 3, clubRecipients: 2, areaRecipients: 1, daysBefore: 14, dueOn: "2026-12-05" });
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
    expect(state.batches[0]).toMatchObject({ status: "SENT", decidedByUserId: "admin-1", recipientCount: 3 });
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

  it("withdraws instead of sending when the due date moved after the preview; the next run prepares one for the new date", async () => {
    const batch = await prepared();
    state.entries = [entry({ startsOn: "2026-12-08", endsOn: "2026-12-08" })];
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now)).rejects.toMatchObject({ code: "BATCH_WITHDRAWN" });
    expect(state.outbox).toHaveLength(0);
    expect(state.batches[0].status).toBe("WITHDRAWN");
    await reconcileDeadlineReminders(now);
    expect(state.batches.map((row) => `${row.dueOn}:${row.status}`).sort()).toEqual(["2026-12-05:WITHDRAWN", "2026-12-08:PENDING"]);
  });

  it("shows staff both the club and the Area Coordinator wording", async () => {
    const batch = await prepared();
    expect(batch.bodyText).toContain("club portal");
    expect(batch.areaBodyText).toContain("clubs in your area");
    expect(batch.areaBodyText).toContain("/account/area-clubs/overview");
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

describe("a deadline whose date moves after a reminder was decided (#910)", () => {
  it("prepares the point again for the new date after a sent 14-day batch, and never twice for that date", async () => {
    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    const first = (await listPendingReminderBatches(now)).batches[0];
    await sendReminderBatch(first.id, { fingerprint: first.fingerprint }, "admin-1", now);
    expect(state.batches[0]).toMatchObject({ status: "SENT", dueOn: "2026-12-05" });
    // The deadline moves a week later: its 14-day point (Nov 29) has not come, so nothing yet.
    state.entries = [entry({ startsOn: "2026-12-12", endsOn: "2026-12-12" })];
    await reconcileDeadlineReminders(now);
    expect(state.batches).toHaveLength(1);
    // At the new 14-day point a fresh batch is prepared for the new date; the sent one is history.
    const later = at("2026-11-29T18:00:00Z");
    await Promise.all([reconcileDeadlineReminders(later), reconcileDeadlineReminders(later)]);
    await reconcileDeadlineReminders(later);
    expect(state.batches.map((row) => `${row.dueOn}:${row.daysBefore}:${row.status}`).sort()).toEqual(["2026-12-05:14:SENT", "2026-12-12:14:PENDING"]);
    expect(state.outbox).toHaveLength(3);
  });

  it("prepares a dismissed point again when the entry moves to next year", async () => {
    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    await dismissReminderBatch(state.batches[0].id as string, "admin-1", now);
    state.entries = [entry({ startsOn: "2027-12-05", endsOn: "2027-12-05" })];
    await reconcileDeadlineReminders(at("2027-11-21T18:00:00Z"));
    expect(state.batches.map((row) => `${row.dueOn}:${row.daysBefore}:${row.status}`).sort()).toEqual(["2026-12-05:14:DISMISSED", "2027-12-05:14:PENDING"]);
  });

  it("tells staff when the same point was already sent or dismissed for another due date", async () => {
    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    const first = (await listPendingReminderBatches(now)).batches[0];
    expect(first.earlierDecision).toBeNull();
    await sendReminderBatch(first.id, { fingerprint: first.fingerprint }, "admin-1", now);
    state.entries = [entry({ startsOn: "2026-12-12", endsOn: "2026-12-12" })];
    const later = at("2026-11-29T18:00:00Z");
    await reconcileDeadlineReminders(later);
    const second = (await listPendingReminderBatches(later)).batches;
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ dueOn: "2026-12-12", earlierDecision: { status: "SENT", dueOn: "2026-12-05" } });
    // A dismissed earlier date is reported too, and a different point is not.
    await dismissReminderBatch(second[0].id, "admin-1", later);
    state.entries = [entry({ startsOn: "2026-12-20", endsOn: "2026-12-20" })];
    await reconcileDeadlineReminders(at("2026-12-07T18:00:00Z"));
    const third = (await listPendingReminderBatches(at("2026-12-07T18:00:00Z"))).batches[0];
    expect(third.earlierDecision).toMatchObject({ dueOn: expect.stringMatching(/^2026-12-(05|12)$/) });
    expect(["SENT", "DISMISSED"]).toContain(third.earlierDecision?.status);
  });

  it("A to B to A after A was sent: A is not prepared or sent again, and B's waiting batch is withdrawn", async () => {
    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    const a = (await listPendingReminderBatches(now)).batches[0];
    await sendReminderBatch(a.id, { fingerprint: a.fingerprint }, "admin-1", now);
    const queued = state.outbox.length;
    state.entries = [entry({ startsOn: "2026-12-12", endsOn: "2026-12-12" })]; // B
    const b = at("2026-11-29T18:00:00Z");
    await reconcileDeadlineReminders(b);
    expect(pending()).toHaveLength(1);
    state.entries = [entry()]; // back to A
    await reconcileDeadlineReminders(b);
    await reconcileDeadlineReminders(b);
    expect(state.batches.map((row) => `${row.dueOn}:${row.status}`).sort()).toEqual(["2026-12-05:SENT", "2026-12-12:WITHDRAWN"]);
    expect(pending()).toHaveLength(0);
    expect(state.outbox).toHaveLength(queued);
  });

  it("moves a waiting batch along with its deadline instead of leaving two", async () => {
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    state.entries = [entry({ startsOn: "2026-12-07", endsOn: "2026-12-07" })];
    await reconcileDeadlineReminders(at("2026-11-26T18:00:00Z"));
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toMatchObject({ dueOn: "2026-12-07", status: "PENDING" });
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
    const { recipients } = await dbRecipients();
    expect(recipients.map((recipient) => recipient.email)).toEqual(["area@example.test", "dana@example.test"]);
    expect(recipients.find((recipient) => recipient.email === "dana@example.test")?.audience).toBe("CLUB");
    expect(recipients.find((recipient) => recipient.email === "area@example.test")?.audience).toBe("AREA");
  });

  it("includes people who opted out of all announcements: deadlines are essential (#915)", async () => {
    state.optOuts = [{ normalizedEmail: "deputy@example.test", scope: "ALL" }, { normalizedEmail: "area@example.test", scope: "EVENT" }];
    const { recipients } = await dbRecipients();
    expect(recipients.map((recipient) => recipient.email)).toEqual(["area@example.test", "deputy@example.test", "director@example.test"]);
    expect(recipients).not.toHaveProperty("optedOut");

    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    const batch = (await listPendingReminderBatches(now)).batches[0];
    expect(batch).toMatchObject({ recipientCount: 3 });
    expect(batch).not.toHaveProperty("optedOutCount");
    // Someone else opts out after the preview: the people are unchanged, so the approval still holds.
    state.optOuts.push({ normalizedEmail: "director@example.test", scope: "ALL" });
    const result = await sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", now);
    expect(result).toEqual({ sent: 3, messageIds: expect.any(Array) });
    expect(state.outbox.map((row) => row.recipientEmail).sort()).toEqual(["area@example.test", "deputy@example.test", "director@example.test"]);
    expect(state.batches[0]).toMatchObject({ status: "SENT", recipientCount: 3 });
  });
});

describe("repeating deadlines: a reminder for each occurrence (#915)", () => {
  const key = (batch: Record<string, unknown>) => `${batch.dueOn}:${batch.daysBefore}:${batch.status}`;
  const keys = () => state.batches.map(key).sort();

  it("gives a weekly deadline only 2-day batches, one per occurrence; a passed one is withdrawn", async () => {
    // Every Friday from Oct 2, 2026. The 14-day point is before the previous Friday, so it is never prepared.
    state.entries = [entry({ startsOn: "2026-10-02", endsOn: "2026-10-02", repeatRule: "FREQ=WEEKLY;BYDAY=FR;WKST=SU" })];
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z")); // Wed: next is Fri Nov 27, 2 days out
    expect(keys()).toEqual(["2026-11-27:2:PENDING"]);
    await reconcileDeadlineReminders(at("2026-11-27T18:00:00Z")); // due today: still that occurrence
    expect(keys()).toEqual(["2026-11-27:2:PENDING"]);
    // Sat Nov 28: Nov 27 has passed; Dec 4's reached point is the 14-day one, which a weekly deadline does not get.
    expect(await reconcileDeadlineReminders(at("2026-11-28T18:00:00Z"))).toMatchObject({ prepared: 0, withdrawn: 1 });
    expect(keys()).toEqual(["2026-11-27:2:WITHDRAWN"]);
    expect(state.batches[0]).toMatchObject({ statusReason: expect.stringMatching(/occurrence/i) });
    await reconcileDeadlineReminders(at("2026-12-02T18:00:00Z")); // Dec 4's 2-day point
    expect(keys()).toEqual(["2026-11-27:2:WITHDRAWN", "2026-12-04:2:PENDING"]);
    expect(state.batches.every((batch) => batch.daysBefore === 2)).toBe(true);
  });

  it("gives an every-other-week deadline only the 2-day batch, and a daily deadline none", async () => {
    state.entries = [entry({ id: "biweekly", startsOn: "2026-10-02", endsOn: "2026-10-02", repeatRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;WKST=SU" })];
    await reconcileDeadlineReminders(at("2026-11-27T18:00:00Z")); // Oct 2 + 8 weeks = Nov 27: the 14-day point equals the previous due date
    expect(keys()).toEqual(["2026-11-27:2:PENDING"]);
    state.batches = [];
    state.entries = [entry({ id: "daily", startsOn: "2026-10-02", endsOn: "2026-10-02", repeatRule: "FREQ=DAILY" })];
    for (const day of ["2026-11-25", "2026-11-26", "2026-11-27"]) await reconcileDeadlineReminders(at(`${day}T18:00:00Z`));
    expect(keys()).toEqual([]);
  });

  it("gives a monthly deadline its own batches each month, keeping a sent one as history", async () => {
    state.entries = [entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY" })];
    const first = at("2026-11-02T18:00:00Z"); // Nov 15's 14-day point (Nov 1) is reached
    await reconcileDeadlineReminders(first);
    expect(keys()).toEqual(["2026-11-15:14:PENDING"]);
    const batch = (await listPendingReminderBatches(first)).batches[0];
    await sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", first);
    await reconcileDeadlineReminders(at("2026-11-13T18:00:00Z")); // the 2-day point
    expect(keys()).toEqual(["2026-11-15:14:SENT", "2026-11-15:2:PENDING"]);
    await reconcileDeadlineReminders(at("2026-11-20T18:00:00Z")); // between occurrences: Dec 15's point is not reached
    expect(keys()).toEqual(["2026-11-15:14:SENT", "2026-11-15:2:WITHDRAWN"]);
    await reconcileDeadlineReminders(at("2026-12-02T18:00:00Z")); // Dec 15 minus 14 days = Dec 1
    expect(keys()).toEqual(["2026-11-15:14:SENT", "2026-11-15:2:WITHDRAWN", "2026-12-15:14:PENDING"]);
    expect(new Set(state.batches.map((row) => row.calendarEntryId))).toEqual(new Set(["entry-1"]));
  });

  it("never prepares a duplicate for the same occurrence, however often or at once it runs", async () => {
    state.entries = [entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY" })];
    const now = at("2026-11-02T18:00:00Z");
    await Promise.all([reconcileDeadlineReminders(now), reconcileDeadlineReminders(now), reconcileDeadlineReminders(now)]);
    await reconcileDeadlineReminders(now);
    await reconcileDeadlineReminders(at("2026-11-03T18:00:00Z"));
    expect(keys()).toEqual(["2026-11-15:14:PENDING"]);
    expect(state.audit.filter((row) => row.action === "DEADLINE_REMINDER_PREPARED")).toHaveLength(1);
  });

  it("expands occurrences by conference calendar date across the November daylight-saving change", async () => {
    // Every Saturday from Oct 24 (2-day batches only). Chicago leaves daylight time on Sun Nov 1 at 2 AM.
    state.entries = [entry({ startsOn: "2026-10-24", endsOn: "2026-10-24", repeatRule: "FREQ=WEEKLY;BYDAY=SA;WKST=SU" })];
    await reconcileDeadlineReminders(at("2026-11-01T04:59:00Z")); // Sat Oct 31, 11:59 PM CDT: that Saturday is still due today
    expect(keys()).toEqual(["2026-10-31:2:PENDING"]);
    await reconcileDeadlineReminders(at("2026-11-01T05:00:00Z")); // Sun Nov 1, midnight CDT: Oct 31 has passed
    expect(keys()).toEqual(["2026-10-31:2:WITHDRAWN"]);
    await reconcileDeadlineReminders(at("2026-11-05T05:59:00Z")); // Wed Nov 4, 11:59 PM CST: Nov 7's 2-day point is Nov 5
    expect(keys()).toEqual(["2026-10-31:2:WITHDRAWN"]);
    await reconcileDeadlineReminders(at("2026-11-05T06:00:00Z")); // Thu Nov 5, midnight CST
    expect(keys()).toEqual(["2026-10-31:2:WITHDRAWN", "2026-11-07:2:PENDING"]);
  });

  it("holds a monthly occurrence's 14-day point at the daylight-saving change (Nov 15's is Nov 1)", async () => {
    state.entries = [entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY" })];
    await reconcileDeadlineReminders(at("2026-11-01T04:59:00Z")); // Oct 31, 11:59 PM CDT
    expect(keys()).toEqual([]);
    await reconcileDeadlineReminders(at("2026-11-01T05:00:00Z")); // Nov 1, midnight CDT
    expect(keys()).toEqual(["2026-11-15:14:PENDING"]);
  });

  it("expands only a window around today: a daily rule started in 2020 costs a bounded number of steps", async () => {
    state.entries = [entry({ startsOn: "2020-01-01", endsOn: "2020-01-01", repeatRule: "FREQ=DAILY" })];
    expansionDiagnostics.steps = 0;
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    expect(expansionDiagnostics.steps).toBeLessThan(100);
    expect(keys()).toEqual([]); // daily: no point falls after the previous day's due date
    // Nothing in range (a yearly deadline far off) is also cheap and prepares nothing.
    state.entries = [entry({ startsOn: "2020-03-01", endsOn: "2020-03-01", repeatRule: "FREQ=YEARLY" })];
    expansionDiagnostics.steps = 0;
    await reconcileDeadlineReminders(at("2026-11-25T18:00:00Z"));
    expect(expansionDiagnostics.steps).toBeLessThan(100);
    expect(keys()).toEqual([]);
  });

  it("withdraws a waiting batch with the 'moved later' reason when nothing is left in range", async () => {
    state.entries = [entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY" })];
    await reconcileDeadlineReminders(at("2026-11-02T18:00:00Z"));
    state.entries = [entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY;UNTIL=20261101" })];
    await reconcileDeadlineReminders(at("2026-11-02T18:00:00Z"));
    expect(state.batches[0]).toMatchObject({ status: "WITHDRAWN", statusReason: "The due date moved later; a reminder is prepared when its time comes." });
  });

  it("follows a one-off deadline that becomes repeating while its batch waits", async () => {
    const now = at("2026-11-25T18:00:00Z");
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-12-05:14:PENDING"]);
    state.entries = [entry({ startsOn: "2026-10-02", endsOn: "2026-10-02", repeatRule: "FREQ=WEEKLY;BYDAY=FR;WKST=SU" })];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-11-27:2:PENDING", "2026-12-05:14:WITHDRAWN"]);
  });

  it("moves the waiting batch along when a repeating deadline becomes one-off", async () => {
    const now = at("2026-11-25T18:00:00Z");
    state.entries = [entry({ startsOn: "2026-10-28", endsOn: "2026-10-28", repeatRule: "FREQ=MONTHLY" })];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-11-28:14:PENDING"]);
    const id = state.batches[0].id;
    state.entries = [entry({ startsOn: "2026-12-05", endsOn: "2026-12-05" })];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-12-05:14:PENDING"]);
    expect(state.batches[0].id).toBe(id);
  });

  it("follows the series when its start moves", async () => {
    const now = at("2026-11-26T18:00:00Z");
    state.entries = [entry({ startsOn: "2026-10-02", endsOn: "2026-10-02", repeatRule: "FREQ=WEEKLY;BYDAY=FR;WKST=SU" })];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-11-27:2:PENDING"]);
    state.entries = [entry({ startsOn: "2026-10-03", endsOn: "2026-10-03", repeatRule: "FREQ=WEEKLY;BYDAY=SA;WKST=SU" })];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-11-27:2:WITHDRAWN", "2026-11-28:2:PENDING"]);
  });

  it("skips occurrences staff skipped, and withdraws a waiting batch whose occurrence is then skipped", async () => {
    const monthly = (repeatExceptions: string[]) => entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY", repeatExceptions });
    const now = at("2026-11-02T18:00:00Z");
    state.entries = [monthly(["2026-11-15"])];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual([]); // Nov 15 is skipped and Dec 15's point is not reached
    state.entries = [monthly([])];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-11-15:14:PENDING"]);
    state.entries = [monthly(["2026-11-15"])];
    await reconcileDeadlineReminders(now);
    expect(keys()).toEqual(["2026-11-15:14:WITHDRAWN"]);
  });

  it("refuses to send a waiting batch once its occurrence has passed", async () => {
    state.entries = [entry({ startsOn: "2026-10-15", endsOn: "2026-10-15", repeatRule: "FREQ=MONTHLY" })];
    const earlier = at("2026-11-02T18:00:00Z");
    await reconcileDeadlineReminders(earlier);
    const batch = (await listPendingReminderBatches(earlier)).batches[0];
    await expect(sendReminderBatch(batch.id, { fingerprint: batch.fingerprint }, "admin-1", at("2026-11-16T18:00:00Z"))).rejects.toMatchObject({ code: "BATCH_WITHDRAWN" });
    expect(state.outbox).toHaveLength(0);
  });
});
