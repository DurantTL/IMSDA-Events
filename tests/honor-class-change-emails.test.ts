import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  isNotificationEnabled: vi.fn(),
  loadEventEmailSettings: vi.fn(),
  processQueuedMessageIdsAfterCommit: vi.fn(),
  logError: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda-events.test" }) }));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: mocks.isNotificationEnabled }));
vi.mock("@/modules/communications/effective-delivery", () => ({ loadEventEmailSettings: mocks.loadEventEmailSettings }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: mocks.processQueuedMessageIdsAfterCommit }));

import { dispatchImmediateClassChangeEmails, kickClassChangeEmails, pruneClassChanges, sendDueClassChangeEmails, sendFinalClassChangeSummary } from "@/modules/honors/class-change-emails";

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the handful of Prisma calls the sender makes.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : value);
const operators = ["not", "lte", "lt", "gt", "gte", "in", "notIn", "some"];

function test(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date || typeof condition !== "object") return comparable(value) === comparable(condition);
  const keys = Object.keys(condition as object);
  if (keys.every((key) => operators.includes(key))) {
    return Object.entries(condition as Row).every(([op, arg]) => {
      switch (op) {
        case "not": return arg === null ? value !== null && value !== undefined : comparable(value) !== comparable(arg);
        case "lte": return value != null && (comparable(value) as number) <= (comparable(arg) as number);
        case "lt": return value != null && (comparable(value) as number) < (comparable(arg) as number);
        case "gt": return value != null && (comparable(value) as number) > (comparable(arg) as number);
        case "gte": return value != null && (comparable(value) as number) >= (comparable(arg) as number);
        case "in": return (arg as unknown[]).includes(value);
        case "notIn": return !(arg as unknown[]).includes(value);
        case "some": return ((value ?? []) as Row[]).some((item) => matches(item, arg as Row));
        default: return false;
      }
    });
  }
  return matches((value ?? {}) as Row, condition as Row);
}

function matches(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((branch) => matches(row, branch));
    return test(row[key], condition);
  });
}

const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id));
const byAtThenId = (a: Row, b: Row) => (a.at as Date).getTime() - (b.at as Date).getTime() || byId(a, b);

type World = ReturnType<typeof world>;

function world() {
  const instructors: Row[] = [];
  const changes: Row[] = [];
  const outbox = new Map<string, Row>();
  const enrolled = new Map<string, number>();
  const offerings: Row[] = [
    { id: "class-knots", capacity: 12, span: "SINGLE_SESSION", session: { name: "Sabbath afternoon" }, honors: [{ honor: { id: "h1", code: "K1", name: "Knot Tying", isActive: true } }] },
    { id: "class-birds", capacity: 8, span: "ALL_SESSIONS", session: null, honors: [{ honor: { id: "h2", code: "B1", name: "Birds", isActive: true } }] },
  ];
  const db: Row = {
    honorInstructor: {
      count: vi.fn(async ({ where }: { where: Row }) => instructors.filter((row) => matches(row, where)).length),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const found = instructors.find((row) => matches(row, where));
        return found ? { ...found } : null;
      }),
      findMany: vi.fn(async ({ where, take }: { where: Row; take?: number }) => instructors.filter((row) => matches(row, where)).sort(byId).slice(0, take ?? 1000).map((row) => ({ ...row }))),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = instructors.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      }),
    },
    honorClassChange: {
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const doomed = changes.filter((row) => matches(row, where));
        for (const row of doomed) changes.splice(changes.indexOf(row), 1);
        return { count: doomed.length };
      }),
      findMany: vi.fn(async ({ where, take }: { where: Row; take?: number }) => changes.filter((row) => matches(row, where)).sort(byAtThenId).slice(0, take ?? 1000).map((row) => ({ ...row }))),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = changes.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      }),
    },
    honorOffering: { findMany: vi.fn(async ({ where }: { where: Row }) => offerings.filter((row) => matches(row, where))) },
    honorEnrollment: {
      groupBy: vi.fn(async ({ where }: { where: { offeringId: { in: string[] } } }) => where.offeringId.in.map((offeringId) => ({ offeringId, _count: { _all: enrolled.get(offeringId) ?? 0 } }))),
    },
    messageOutbox: {
      upsert: vi.fn(async ({ where, create }: { where: { idempotencyKey: string }; create: Row }) => {
        const existing = outbox.get(where.idempotencyKey);
        if (existing) return { id: existing.id, status: existing.status };
        const row: Row = { ...create, id: `message-${outbox.size + 1}` };
        outbox.set(where.idempotencyKey, row);
        return { id: row.id, status: row.status };
      }),
    },
    $transaction: vi.fn(async (work: (client: unknown) => unknown) => {
      mocks.order.push("transaction");
      return work(db);
    }),
  };
  let sequence = 0;
  return {
    db,
    outbox,
    changes,
    instructors,
    enrolled,
    addInstructor(overrides: Row = {}) {
      const row: Row = {
        id: `instructor-${instructors.length + 1}`,
        eventId: "event-1",
        email: `instructor${instructors.length + 1}@imsda-events.test`,
        name: "Ira Instructor",
        acceptedAt: new Date("2026-10-10T12:00:00Z"),
        revokedAt: null,
        classChangeEmails: "DAILY",
        classChangeSummaryAt: null,
        classes: [{ offeringId: "class-knots" }, { offeringId: "class-birds" }],
        event: { name: "Synthetic Honors Weekend", endsAt: new Date("2026-12-06T20:00:00Z"), archivedAt: null },
        ...overrides,
      };
      instructors.push(row);
      return row;
    },
    addChange(kind: "JOINED" | "LEFT", at: string, overrides: Row = {}) {
      sequence += 1;
      const row: Row = {
        id: `change-${String(sequence).padStart(3, "0")}`,
        eventId: "event-1",
        offeringId: "class-knots",
        enrollmentId: `enrollment-${sequence}`,
        registrationAttendeeId: "attendee-a",
        kind,
        youthName: "Pat Example",
        clubName: "Synthetic Pathfinders",
        ageOnEventDate: 12,
        at: new Date(at),
        immediateHandledAt: null,
        event: { endsAt: new Date("2026-12-06T20:00:00Z") },
        ...overrides,
      };
      changes.push(row);
      return row;
    },
  };
}

let w: World;
const morning = new Date("2026-10-21T11:05:00.000Z"); // 6:05 AM Central
const settings = { deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "ON", senderName: "IMSDA Events", senderEmail: "no-reply@imsda-events.test", replyToEmail: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  w = world();
  mocks.getPrisma.mockReturnValue(w.db);
  mocks.isNotificationEnabled.mockImplementation(async () => {
    mocks.order.push("switch");
    return true;
  });
  mocks.loadEventEmailSettings.mockResolvedValue(settings);
  mocks.processQueuedMessageIdsAfterCommit.mockImplementation(async (ids: string[]) => ({ sentIds: ids, capturedIds: [] }));
});

const bodies = () => [...w.outbox.values()].map((row) => String(row.bodyTextSnapshot));

describe("the daily summary (#1098)", () => {
  it("sends one email covering all the instructor's classes, with who joined and left and the count against the limit", async () => {
    w.addInstructor();
    w.enrolled.set("class-knots", 11);
    w.enrolled.set("class-birds", 8);
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    w.addChange("LEFT", "2026-10-20T16:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample", clubName: "Synthetic Adventurers", ageOnEventDate: 10 });
    w.addChange("JOINED", "2026-10-20T17:00:00Z", { offeringId: "class-birds", registrationAttendeeId: "attendee-c", youthName: "Lee Fiction", clubName: null, ageOnEventDate: null });

    const result = await sendDueClassChangeEmails(morning);

    expect(result.summaries).toMatchObject({ due: true, queued: 1, noChanges: 0 });
    expect(w.outbox.size).toBe(1);
    const message = [...w.outbox.values()][0]!;
    expect(message).toMatchObject({
      eventId: "event-1",
      templateKey: "HONOR_INSTRUCTOR_CLASS_SUMMARY",
      recipientEmail: "instructor1@imsda-events.test",
      status: "PENDING",
      idempotencyKey: "honor-class-change-summary:instructor-1:2026-10-21",
    });
    const text = String(message.bodyTextSnapshot);
    expect(text).toContain("Knot Tying (Sabbath afternoon)");
    expect(text).toContain("Joined: Pat Example (Synthetic Pathfinders, age 12)");
    expect(text).toContain("Left: Sam Sample (Synthetic Adventurers, age 10)");
    expect(text).toContain("Birds (All sessions)");
    expect(text).toContain("Joined: Lee Fiction");
    expect(text).toContain("Now 11 of 12 seats.");
    expect(text).toContain("Now 8 of 8 seats.");
    expect(text).toContain("https://events.imsda-events.test/account/instructor/class-knots");
    expect(text).not.toMatch(/birth|dob|born/i);
    expect(mocks.processQueuedMessageIdsAfterCommit).toHaveBeenCalledWith(["message-1"]);
  });

  it("nets a join followed by a leave: no email, and the day is still used up", async () => {
    const instructor = w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    w.addChange("LEFT", "2026-10-20T18:00:00Z");

    const result = await sendDueClassChangeEmails(morning);

    expect(w.outbox.size).toBe(0);
    expect(result.summaries).toMatchObject({ queued: 0, noChanges: 1 });
    expect(mocks.processQueuedMessageIdsAfterCommit).not.toHaveBeenCalled();
    expect((instructor.classChangeSummaryAt as Date).toISOString()).toBe("2026-10-21T11:00:00.000Z");
  });

  it("sends nothing when nothing changed", async () => {
    w.addInstructor();
    const result = await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
    expect(result.summaries).toMatchObject({ queued: 0, noChanges: 1 });
  });

  it("waits until 6:00 AM Central", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    const result = await sendDueClassChangeEmails(new Date("2026-10-21T10:50:00.000Z"));
    expect(result.summaries.due).toBe(false);
    expect(w.outbox.size).toBe(0);
  });

  it("does not send twice when the sweep runs twice, or runs again later the same day", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");

    await sendDueClassChangeEmails(morning);
    const second = await sendDueClassChangeEmails(morning);
    const later = await sendDueClassChangeEmails(new Date("2026-10-21T17:30:00.000Z"));

    expect(w.outbox.size).toBe(1);
    expect(second.summaries.queued).toBe(0);
    expect(later.summaries.queued).toBe(0);
    expect(mocks.processQueuedMessageIdsAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("does not send twice when two sweeps run at the same moment", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await Promise.all([sendDueClassChangeEmails(morning), sendDueClassChangeEmails(morning)]);
    expect(w.outbox.size).toBe(1);
  });

  it("keeps a message key per day even if the claim were lost: the outbox reuses the day's message", async () => {
    const instructor = w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    // The summary point is rolled back, as if the claim's write had been lost after the message was queued.
    instructor.classChangeSummaryAt = null;
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(1);
  });

  it("covers a change once: the next day's summary has only what happened since", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    // After the 6:00 AM cutoff, so it belongs to tomorrow's summary.
    w.addChange("LEFT", "2026-10-21T14:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample" });

    await sendDueClassChangeEmails(new Date("2026-10-22T11:05:00.000Z"));

    const [first, second] = bodies();
    expect(first).toContain("Joined: Pat Example");
    expect(first).not.toContain("Sam Sample");
    expect(second).toContain("Left: Sam Sample");
    expect(second).not.toContain("Pat Example");
    expect(w.outbox.size).toBe(2);
  });

  it("leaves a change made after the cutoff for the next day, even if the sweep ran late", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-21T11:03:00Z"); // after the 11:00 UTC cutoff, before the sweep ran
    const result = await sendDueClassChangeEmails(morning);
    expect(result.summaries.queued).toBe(0);
    expect(w.outbox.size).toBe(0);
  });

  it("never reports changes from before the instructor accepted", async () => {
    w.addInstructor({ acceptedAt: new Date("2026-10-20T16:30:00Z") });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
  });

  it("sends nothing to an instructor who was revoked, hasn't accepted, or chose no emails", async () => {
    w.addInstructor({ revokedAt: new Date("2026-10-15T12:00:00Z") });
    w.addInstructor({ acceptedAt: null });
    w.addInstructor({ classChangeEmails: "OFF" });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
  });

  it("sends nothing once the roster has closed, or for an archived event", async () => {
    w.addInstructor({ event: { name: "Past Weekend", endsAt: new Date("2026-09-01T20:00:00Z"), archivedAt: null } });
    w.addInstructor({ event: { name: "Archived Weekend", endsAt: new Date("2026-12-06T20:00:00Z"), archivedAt: new Date("2026-10-01T00:00:00Z") } });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
  });

  it("an instructor who only wants right-away emails gets no summary", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    expect([...w.outbox.values()].map((row) => row.templateKey)).not.toContain("HONOR_INSTRUCTOR_CLASS_SUMMARY");
  });

  it("records the message as suppressed, and delivers nothing, while the event's email is paused", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    mocks.loadEventEmailSettings.mockResolvedValue({ ...settings, deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" });

    await sendDueClassChangeEmails(morning);

    expect([...w.outbox.values()].map((row) => row.status)).toEqual(["SUPPRESSED"]);
    expect(mocks.processQueuedMessageIdsAfterCommit).not.toHaveBeenCalled();
  });

  it("a delivery failure leaves the message queued and does not fail the sweep", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    mocks.processQueuedMessageIdsAfterCommit.mockRejectedValue(new Error("provider down"));
    const result = await sendDueClassChangeEmails(morning);
    expect(result.summaries.queued).toBe(1);
    expect(w.outbox.size).toBe(1);
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("right-away emails (#1098)", () => {
  it("queues one email per change, to each right-away instructor of the class", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    w.addInstructor({ classChangeEmails: "IMMEDIATE", classes: [{ offeringId: "class-knots" }] });
    w.addInstructor({ classChangeEmails: "IMMEDIATE", classes: [{ offeringId: "class-birds" }] });
    w.enrolled.set("class-knots", 5);
    w.addChange("JOINED", "2026-10-21T10:00:00Z");
    w.addChange("LEFT", "2026-10-21T10:30:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample", clubName: "Synthetic Adventurers", ageOnEventDate: 10 });

    const result = await dispatchImmediateClassChangeEmails(morning);

    // Two changes to the Knot Tying class, two instructors who teach it: four emails, none for the Birds-only instructor.
    expect(result.immediate).toMatchObject({ changes: 2, queued: 4 });
    expect(w.outbox.size).toBe(4);
    const subjects = [...w.outbox.values()].map((row) => row.subjectSnapshot);
    expect(subjects.filter((subject) => subject === "Pat Example joined Knot Tying")).toHaveLength(2);
    expect(subjects.filter((subject) => subject === "Sam Sample left Knot Tying")).toHaveLength(2);
    expect(bodies().every((text) => text.includes("Now 5 of 12 seats.") && !/birth|dob|born/i.test(text))).toBe(true);
    expect(w.changes.every((row) => row.immediateHandledAt !== null)).toBe(true);
    expect(mocks.processQueuedMessageIdsAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("does not send a change twice, however often the sweep or a kick runs", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    w.addChange("JOINED", "2026-10-21T10:00:00Z");
    await dispatchImmediateClassChangeEmails(morning);
    await dispatchImmediateClassChangeEmails(morning);
    await sendDueClassChangeEmails(morning);
    await Promise.all([kickClassChangeEmails([String(w.changes[0]!.id)], morning), kickClassChangeEmails([String(w.changes[0]!.id)], morning)]);
    expect(w.outbox.size).toBe(1);
  });

  it("sends nothing to an instructor who chose OFF or the daily summary", async () => {
    w.addInstructor({ classChangeEmails: "OFF" });
    w.addInstructor({ classChangeEmails: "DAILY" });
    w.addChange("JOINED", "2026-10-21T10:00:00Z");
    const result = await dispatchImmediateClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
    // Still marked handled, so choosing right-away later doesn't send old news.
    expect(result.immediate.changes).toBe(1);
    expect(w.changes[0]!.immediateHandledAt).not.toBeNull();
  });

  it("sends nothing to a revoked instructor, one who hasn't accepted, or one who accepted after the change", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE", revokedAt: new Date("2026-10-15T12:00:00Z") });
    w.addInstructor({ classChangeEmails: "IMMEDIATE", acceptedAt: null });
    w.addInstructor({ classChangeEmails: "IMMEDIATE", acceptedAt: new Date("2026-10-21T10:30:00Z") });
    w.addChange("JOINED", "2026-10-21T10:00:00Z");
    await dispatchImmediateClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
  });

  it("skips a change more than a day old without sending it", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    w.addChange("JOINED", "2026-10-19T10:00:00Z");
    const result = await dispatchImmediateClassChangeEmails(morning);
    expect(result.immediate.skippedStale).toBe(1);
    expect(w.outbox.size).toBe(0);
    expect(w.changes[0]!.immediateHandledAt).not.toBeNull();
  });

  it("is recorded as suppressed while the event's email is paused", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    w.addChange("JOINED", "2026-10-21T10:00:00Z");
    mocks.loadEventEmailSettings.mockResolvedValue({ ...settings, deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" });
    await dispatchImmediateClassChangeEmails(morning);
    expect([...w.outbox.values()].map((row) => row.status)).toEqual(["SUPPRESSED"]);
    expect(mocks.processQueuedMessageIdsAfterCommit).not.toHaveBeenCalled();
  });

  it("a kick that logged nothing does no work at all", async () => {
    await kickClassChangeEmails([], morning);
    expect(mocks.isNotificationEnabled).not.toHaveBeenCalled();
    expect(w.db.$transaction).not.toHaveBeenCalled();
  });

  it("a kick never throws: the enrollment is already saved", async () => {
    mocks.isNotificationEnabled.mockRejectedValue(new Error("settings unavailable"));
    await expect(kickClassChangeEmails(["c-1", "c-2"], morning)).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("the staff switch (#1016)", () => {
  it("is read before any transaction opens, and when it is off nothing is queued or stamped", async () => {
    w.addInstructor();
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    w.addChange("JOINED", "2026-10-21T10:00:00Z", { registrationAttendeeId: "attendee-b" });
    mocks.isNotificationEnabled.mockImplementation(async (key: string) => {
      mocks.order.push(`switch:${key}`);
      return false;
    });

    const result = await sendDueClassChangeEmails(morning);

    expect(result.status).toBe("SWITCHED_OFF");
    expect(mocks.order).toEqual(["switch:HONOR_INSTRUCTOR_CLASS_EMAILS"]);
    expect(w.outbox.size).toBe(0);
    expect(w.changes.every((row) => row.immediateHandledAt === null)).toBe(true);
    expect(w.instructors.every((row) => row.classChangeSummaryAt === null)).toBe(true);
  });

  it("when it is on, is read first, ahead of every transaction", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    expect(mocks.order[0]).toBe("switch");
    expect(mocks.order.indexOf("transaction")).toBeGreaterThan(mocks.order.lastIndexOf("switch") - 1);
  });

  it("changes made while it was off go out, netted, when it is turned back on", async () => {
    w.addInstructor();
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    w.addChange("JOINED", "2026-10-20T16:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample" });
    w.addChange("LEFT", "2026-10-20T17:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample" });
    mocks.isNotificationEnabled.mockResolvedValueOnce(false);
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);

    await sendDueClassChangeEmails(morning);
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]).toContain("Joined: Pat Example");
    expect(bodies()[0]).not.toContain("Sam Sample");
  });
});

describe("a kick works on its own changes only (#1098)", () => {
  it("leaves the backlog to the sweep", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE" });
    const backlog = w.addChange("JOINED", "2026-10-21T09:00:00Z");
    const mine = w.addChange("JOINED", "2026-10-21T10:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Sam Sample" });
    await kickClassChangeEmails([String(mine.id)], morning);
    expect(w.outbox.size).toBe(1);
    expect(backlog.immediateHandledAt).toBeNull();
    expect(mine.immediateHandledAt).not.toBeNull();
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(2);
  });

  it("opens no per-row transaction when nobody teaching those classes is on right-away: the rows are just stamped", async () => {
    w.addInstructor({ classChangeEmails: "DAILY" });
    const change = w.addChange("JOINED", "2026-10-21T10:00:00Z");
    await kickClassChangeEmails([String(change.id)], morning);
    expect(w.db.$transaction).not.toHaveBeenCalled();
    expect(change.immediateHandledAt).not.toBeNull();
    expect(w.outbox.size).toBe(0);
  });
});

describe("retention of the change log (#1098)", () => {
  it("deletes every row of an event whose roster has closed, and nothing of an open one", async () => {
    // The roster closes 14 days after the event ends: this event ended 20 days before the sweep.
    w.addChange("JOINED", "2026-10-20T10:00:00Z", { event: { endsAt: new Date("2026-10-01T20:00:00Z") } });
    const open = w.addChange("JOINED", "2026-10-20T11:00:00Z");
    expect(await pruneClassChanges(morning)).toBe(1);
    expect(w.changes).toEqual([open]);
  });

  it("deletes rows older than eight days, whatever the event, and keeps the newer ones", async () => {
    w.addChange("JOINED", "2026-10-12T10:00:00Z");
    const recent = w.addChange("JOINED", "2026-10-14T10:00:00Z");
    expect(await pruneClassChanges(morning)).toBe(1);
    expect(w.changes).toEqual([recent]);
  });

  it("runs on every sweep, even with the staff switch off, and reports how many it deleted", async () => {
    w.addChange("JOINED", "2026-10-01T10:00:00Z");
    mocks.isNotificationEnabled.mockResolvedValue(false);
    const result = await sendDueClassChangeEmails(morning);
    expect(result).toMatchObject({ status: "SWITCHED_OFF", pruned: 1 });
    expect(w.changes).toHaveLength(0);
  });
});

describe("a closed roster is not read again (#1098)", () => {
  it("bounds the daily query by the event's end plus the roster window", async () => {
    w.addInstructor({ event: { name: "Old Weekend", endsAt: new Date("2026-10-01T20:00:00Z"), archivedAt: null } });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await sendDueClassChangeEmails(morning);
    expect(w.outbox.size).toBe(0);
    const query = (w.db.honorInstructor as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls.find(([call]) => call.take === 100)![0];
    expect(query.where.event.endsAt.gte.toISOString()).toBe("2026-10-07T11:05:00.000Z");
  });
});

describe("a change is never sent twice, in a final summary and then right away (#1098)", () => {
  it("skips an instructor whose summary point is at or after the change", async () => {
    w.addInstructor({ classChangeEmails: "IMMEDIATE", classChangeSummaryAt: new Date("2026-10-21T10:00:00Z") });
    w.addInstructor({ classChangeEmails: "IMMEDIATE", classChangeSummaryAt: new Date("2026-10-21T09:00:00Z") });
    w.addChange("JOINED", "2026-10-21T10:00:00Z");
    await dispatchImmediateClassChangeEmails(morning);
    expect(w.outbox.size).toBe(1);
    expect([...w.outbox.values()][0]!.recipientEmail).toBe("instructor2@imsda-events.test");
  });
});

describe("leaving the daily summary (#1098)", () => {
  it("two concurrent final summaries send one: the claim is on the exact summary point that was read", async () => {
    const instructor = w.addInstructor({ classChangeEmails: "OFF", classChangeSummaryAt: new Date("2026-10-20T11:00:00Z") });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    await Promise.all([sendFinalClassChangeSummary(String(instructor.id), morning), sendFinalClassChangeSummary(String(instructor.id), morning)]);
    expect(w.outbox.size).toBe(1);
  });

  it("never throws, whatever fails after the choice committed", async () => {
    mocks.isNotificationEnabled.mockRejectedValue(new Error("settings unavailable"));
    await expect(sendFinalClassChangeSummary("instructor-1", morning)).resolves.toEqual({ queued: false });
    mocks.isNotificationEnabled.mockResolvedValue(true);
    (w.db.honorInstructor as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockRejectedValue(new Error("database down"));
    await expect(sendFinalClassChangeSummary("instructor-1", morning)).resolves.toEqual({ queued: false });
    expect(mocks.logError).toHaveBeenCalledTimes(2);
  });

  it("sends one last summary of what changed since the previous one, and moves the point", async () => {
    const instructor = w.addInstructor({ classChangeEmails: "IMMEDIATE", classChangeSummaryAt: new Date("2026-10-20T11:00:00Z") });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    w.addChange("LEFT", "2026-10-20T10:00:00Z", { registrationAttendeeId: "attendee-b", youthName: "Before Summary" });
    expect(await sendFinalClassChangeSummary(String(instructor.id), morning)).toEqual({ queued: true });
    expect(w.outbox.size).toBe(1);
    const text = bodies()[0]!;
    expect(text).toContain("Joined: Pat Example");
    expect(text).not.toContain("Before Summary");
    expect((instructor.classChangeSummaryAt as Date).toISOString()).toBe(morning.toISOString());
    // A second call has nothing left to summarize.
    expect(await sendFinalClassChangeSummary(String(instructor.id), morning)).toEqual({ queued: false });
    expect(w.outbox.size).toBe(1);
  });

  it("only moves the point when nothing changed, and sends nothing while the staff switch is off", async () => {
    const instructor = w.addInstructor({ classChangeEmails: "OFF" });
    expect(await sendFinalClassChangeSummary(String(instructor.id), morning)).toEqual({ queued: false });
    expect(instructor.classChangeSummaryAt).not.toBeNull();
    expect(w.outbox.size).toBe(0);
    const other = w.addInstructor({ classChangeEmails: "OFF" });
    w.addChange("JOINED", "2026-10-20T15:00:00Z");
    mocks.isNotificationEnabled.mockResolvedValue(false);
    expect(await sendFinalClassChangeSummary(String(other.id), morning)).toEqual({ queued: false });
    expect(w.outbox.size).toBe(0);
  });
});
