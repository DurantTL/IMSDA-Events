import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  answered: vi.fn(),
  sender: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/communications/account-email", () => {
  class AccountEmailNotConfiguredError extends Error {}
  return { AccountEmailNotConfiguredError, getAccountEmailSender: mocks.sender };
});
vi.mock("@/modules/event-debriefs/recipients", () => ({ resolveDebriefRecipients: mocks.resolve, answeredAccountIds: mocks.answered }));

import { AccountEmailNotConfiguredError } from "@/modules/communications/account-email";
import { runDebriefBatch } from "@/modules/event-debriefs/dispatch";
import { debriefBatchId, debriefMessageKey, debriefSchedule } from "@/modules/event-debriefs/domain";

const endsAt = new Date("2027-03-13T22:00:00.000Z");
const schedule = debriefSchedule({ timezone: "America/Chicago", endsAt });
const people = [
  { accountId: "a1", email: "alpha@example.org", name: "Alpha Sample" },
  { accountId: "a2", email: "beta@example.org", name: "Beta Sample" },
  { accountId: "a3", email: "gamma@example.org", name: "Gamma Sample" },
];

type Row = Record<string, unknown>;

function setup(options: { kind?: "INVITE" | "REMINDER"; moduleOn?: boolean; evaluation?: boolean; endsAt?: Date; keys?: string[]; event?: Record<string, unknown>; slug?: string } = {}) {
  const kind = options.kind ?? "INVITE";
  const projection = kind === "INVITE" ? schedule.invite : schedule.reminder;
  const batch = {
    id: debriefBatchId("event-1", kind), eventId: "event-1", templateKey: kind === "INVITE" ? "EVENT_DEBRIEF_INVITE" : "EVENT_DEBRIEF_REMINDER",
    sendAt: projection.sendAt, status: "ACTIVE", claimToken: "claim-1", trigger: "AFTER_EVENT_END",
  };
  const created: Row[] = [];
  const updates: Row[] = [];
  const existingKeys = new Set(options.keys ?? []);
  const tx = {
    scheduledEmailBatch: { updateMany: vi.fn(async () => ({ count: 1 })) },
    messageOutbox: {
      findMany: vi.fn(async ({ where }: { where: { idempotencyKey: { in: string[] } } }) => where.idempotencyKey.in.filter((key) => existingKeys.has(key)).map((idempotencyKey) => ({ idempotencyKey }))),
      create: vi.fn(async ({ data }: { data: Row }) => { created.push(data); existingKeys.add(data.idempotencyKey as string); return { id: `msg-${created.length}` }; }),
    },
  };
  const prisma = {
    eventModule: { findUnique: vi.fn(async () => (options.moduleOn === false ? null : { id: "row" })) },
    event: { findUnique: vi.fn(async () => ({ name: "Sample Spring Camporee", slug: "sample-spring-camporee", timezone: "America/Chicago", endsAt: options.endsAt ?? endsAt, archivedAt: null, audience: "CLUB", isPublished: true, lifecycleState: "PUBLISHED", debrief: { evaluationEnabled: options.evaluation ?? false }, ...(options.event ?? {}) })) },
    informationForm: { findMany: vi.fn(async () => [{ purpose: "DEBRIEF", slug: options.slug ?? "debrief" }, { purpose: "DIRECTOR_EVALUATION", slug: "director-evaluation" }]) },
    scheduledEmailBatch: { updateMany: vi.fn(async (args: Row) => { updates.push(args); return { count: 1 }; }) },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: async (run: (client: unknown) => unknown) => run(tx),
  };
  return { prisma: prisma as never, batch: batch as never, created, updates, rawPrisma: prisma, rawBatch: batch };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-03-14T13:00:30.000Z"));
  vi.clearAllMocks();
  mocks.sender.mockReturnValue({ name: "IMAdventist", address: "events@example.org", replyTo: null });
  mocks.resolve.mockImplementation(async (_client: unknown, _eventId: string, purpose: string) => (purpose === "DEBRIEF" ? people : [{ accountId: "d1", email: "director@example.org", name: "Dee Director" }]));
  mocks.answered.mockResolvedValue(new Set());
});
afterEach(() => vi.useRealTimers());

const now = () => new Date();

describe("sending the debrief invitation (#1679)", () => {
  it("queues one message to each person on the audience, linking to the debrief form, and completes the batch", async () => {
    const { prisma, batch, created, rawPrisma } = setup();
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "completed", queued: 3 });
    expect(created.map((row) => row.recipientEmail)).toEqual(["alpha@example.org", "beta@example.org", "gamma@example.org"]);
    expect(created[0]).toMatchObject({ eventId: "event-1", templateKey: "EVENT_DEBRIEF_INVITE", status: "PENDING", recipientKind: "INTERNAL" });
    expect(String(created[0]!.bodyTextSnapshot)).toContain("https://events.imsda.test/events/sample-spring-camporee/forms/debrief");
    expect(String(created[0]!.bodyTextSnapshot)).not.toContain("What went well");
    expect(created[0]!.metadata).toMatchObject({ debriefBatchId: debriefBatchId("event-1", "INVITE") });
    expect(created[0]!.metadata).not.toHaveProperty("scheduledEmailBatchId");
    expect(rawPrisma.scheduledEmailBatch.updateMany.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "COMPLETED" } });
  });

  it("asks directors too, with their own link, only while the evaluation is on", async () => {
    const off = setup();
    await runDebriefBatch(off.prisma, off.batch, "claim-1", now());
    expect(off.created.some((row) => String(row.bodyTextSnapshot).includes("director-evaluation"))).toBe(false);

    const on = setup({ evaluation: true });
    const result = await runDebriefBatch(on.prisma, on.batch, "claim-1", now());
    expect(result.queued).toBe(4);
    expect(on.created.filter((row) => String(row.bodyTextSnapshot).includes("/forms/director-evaluation")).map((row) => row.recipientEmail)).toEqual(["director@example.org"]);
  });

  it("is idempotent: running it again after a crash queues nothing twice", async () => {
    const keys = people.map((person) => debriefMessageKey(debriefBatchId("event-1", "INVITE"), person.accountId, "DEBRIEF"));
    const { prisma, batch, created } = setup({ keys });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result.queued).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("uses one key per batch, person and form", async () => {
    const { prisma, batch, created } = setup();
    await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(created.map((row) => row.idempotencyKey)).toEqual(people.map((person) => debriefMessageKey(debriefBatchId("event-1", "INVITE"), person.accountId, "DEBRIEF")));
  });
});

describe("the reminder (#1679)", () => {
  beforeEach(() => vi.setSystemTime(new Date("2027-03-17T13:00:30.000Z")));

  it("goes only to people who have not answered", async () => {
    mocks.answered.mockResolvedValue(new Set(["a1", "a3"]));
    const { prisma, batch, created } = setup({ kind: "REMINDER" });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "completed", queued: 1, excluded: 2 });
    expect(created.map((row) => row.recipientEmail)).toEqual(["beta@example.org"]);
    expect(created[0]).toMatchObject({ templateKey: "EVENT_DEBRIEF_REMINDER" });
    expect(String(created[0]!.subjectSnapshot)).toMatch(/^Reminder:/);
  });

  it("sends nobody when everyone has answered, and still completes", async () => {
    mocks.answered.mockResolvedValue(new Set(["a1", "a2", "a3"]));
    const { prisma, batch, created, rawPrisma } = setup({ kind: "REMINDER" });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result.queued).toBe(0);
    expect(created).toHaveLength(0);
    expect(rawPrisma.scheduledEmailBatch.updateMany.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "COMPLETED" } });
  });
});

describe("when it must not send (#1679)", () => {
  it("cancels instead of sending when the Debrief has been switched off", async () => {
    const { prisma, batch, created, updates } = setup({ moduleOn: false });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "skipped", reason: "MODULE_OFF" });
    expect(created).toHaveLength(0);
    expect(updates[0]).toMatchObject({ data: { status: "CANCELLED" } });
  });

  it.each([
    ["an archived event", { archivedAt: new Date("2027-03-10T00:00:00Z") }, "EVENT_ARCHIVED"],
    ["an event in the archived lifecycle state", { lifecycleState: "ARCHIVED" }, "EVENT_ARCHIVED"],
    ["an event that is not public", { isPublished: false }, "EVENT_NOT_PUBLISHED"],
    ["an event that is not a club event", { audience: "GENERAL" }, "NOT_A_CLUB_EVENT"],
  ])("cancels instead of sending for %s", async (_label, event, reason) => {
    const { prisma, batch, created, updates } = setup({ event });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "skipped", reason });
    expect(created).toHaveLength(0);
    expect(updates[0]).toMatchObject({ data: { status: "CANCELLED" } });
  });

  it("links to the form's own address when its slug is not the usual one", async () => {
    const { prisma, batch, created } = setup({ slug: "debrief-event" });
    await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(String(created[0]!.bodyTextSnapshot)).toContain("/events/sample-spring-camporee/forms/debrief-event");
    expect(String(created[0]!.bodyTextSnapshot)).not.toMatch(/forms\/debrief\n/);
  });

  it("does not send more than six hours late", async () => {
    vi.setSystemTime(new Date("2027-03-14T20:00:00.000Z"));
    const { prisma, batch, created, updates } = setup();
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "failed", reason: "MISSED_WINDOW" });
    expect(created).toHaveLength(0);
    expect(updates[0]).toMatchObject({ data: { status: "FAILED" } });
  });

  it("follows the event when its end date moved: released with the new time, nothing sent", async () => {
    const { prisma, batch, created, updates } = setup({ endsAt: new Date("2027-03-20T22:00:00.000Z") });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "skipped", reason: "EVENT_TIMING_CHANGED" });
    expect(created).toHaveLength(0);
    const data = (updates[0] as { data: { sendAt: Date; claimToken: null } }).data;
    expect(data.sendAt.toISOString()).toBe("2027-03-21T13:00:00.000Z");
    expect(data.claimToken).toBeNull();
  });

  it("fails, saying why, when email is not set up", async () => {
    mocks.sender.mockImplementation(() => { throw new AccountEmailNotConfiguredError("not set"); });
    const { prisma, batch, created, updates } = setup();
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "failed", reason: "EMAIL_NOT_CONFIGURED" });
    expect(created).toHaveLength(0);
    expect(updates[0]).toMatchObject({ data: { status: "FAILED" } });
  });

  it("stops at once, leaving everything as it is, if another worker took the batch over", async () => {
    const { prisma, batch, created, rawPrisma } = setup();
    // Claim lost between the checks and the queueing transaction.
    (rawPrisma as unknown as { $transaction: unknown }).$transaction = async (run: (client: unknown) => unknown) => run({ scheduledEmailBatch: { updateMany: async () => ({ count: 0 }) }, messageOutbox: {} });
    const result = await runDebriefBatch(prisma, batch, "claim-1", now());
    expect(result).toMatchObject({ outcome: "partial", reason: "CLAIM_LOST" });
    expect(created).toHaveLength(0);
  });
});
