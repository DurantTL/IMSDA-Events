import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  calculateCancellation,
  selectPolicyVersion,
  type CalculationFacts,
  type CancellationResult,
  type ChargeEntry,
} from "@/modules/cancellation-policy/calculator";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";
import { campMeetingPreset } from "./support/camp-meeting-seeds";

/**
 * #170: the request workflow against an in-memory database. The real calculator produces every outcome; the database,
 * the outbox and the audit log are fakes that record what was written. Covers withdrawn requests, a registration that
 * changed after the request, duplicate and overlapping submissions, staff denial, an attendee who is not on the
 * registration, a request after the deadline, and that approving moves no money and cancels nothing. Synthetic data only.
 */

vi.mock("server-only", () => ({}));

const world = vi.hoisted(() => ({
  now: new Date("2026-05-01T15:00:00.000Z"),
  status: "CONFIRMED",
  billingMode: "ATTENDEE_PAY" as string,
  group: false,
  paid: 20_000,
  charges: [] as unknown[],
  attendees: [] as Array<{ id: string; position: number }>,
  policies: [] as unknown[],
  requests: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  calculations: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  emails: [] as Array<Record<string, unknown>>,
  processed: [] as string[][],
  writes: [] as string[],
  transactions: [] as unknown[],
  clients: [] as Array<{ call: string; client: unknown }>,
  users: new Map<string, { id: string; displayName: string }>(),
  nextId: 1,
}));

// Real Prisma model names: touching any of them fails the test that did it.
const GUARDED = new Set(["payment", "refund", "registrationAttendee", "registrationOperation", "registrationCapacityReservation", "registrationWaitlistEntry", "registrationAdjustment", "merchandiseOrder"]);

function id(prefix: string) {
  world.nextId += 1;
  return `${prefix}-${world.nextId}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "NOT") return !matches(row, expected as Record<string, unknown>);
    if (expected && typeof expected === "object" && "in" in (expected as object)) return ((expected as { in: unknown[] }).in).includes(row[key]);
    return row[key] === expected;
  });
}

function hydrateRequest(row: Record<string, unknown>) {
  return {
    ...row,
    timeline: world.events.filter((event) => event.requestId === row.id).sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()),
    calculation: world.calculations.find((calculation) => calculation.id === row.calculationId) ?? null,
  };
}

const requestModel = {
  findFirst: async ({ where }: { where?: Record<string, unknown> }) => {
    const row = world.requests.find((candidate) => matches(candidate, where));
    return row ? hydrateRequest(row) : null;
  },
  findMany: async ({ where }: { where?: Record<string, unknown> }) => world.requests.filter((row) => matches(row, where)).map(hydrateRequest),
  findUnique: async ({ where }: { where: { id: string } }) => {
    const row = world.requests.find((candidate) => candidate.id === where.id);
    return row ? hydrateRequest(row) : null;
  },
  findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
    const row = world.requests.find((candidate) => candidate.id === where.id);
    if (!row) throw new Error("not found");
    return hydrateRequest(row);
  },
  create: async ({ data }: { data: Record<string, unknown> }) => {
    world.writes.push("cancellationRequest.create");
    const dupKey = world.requests.some((row) => row.registrationId === data.registrationId && row.idempotencyKey === data.idempotencyKey);
    const open = ["REQUESTED", "UNDER_REVIEW", "INFORMATION_NEEDED"];
    const dupScope = world.requests.some((row) => row.registrationId === data.registrationId && row.scopeKey === data.scopeKey && open.includes(row.status as string));
    if (dupKey || dupScope) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    const row = { ...data, id: id("req"), status: "REQUESTED", registrantNote: null, decidedByUserId: null, decidedByNameSnapshot: null, decisionReason: null, decidedAt: null, decidedWithChanges: false, supersededById: null, createdAt: world.now, updatedAt: world.now };
    world.requests.push(row);
    return row;
  },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    world.writes.push("cancellationRequest.updateMany");
    const rows = world.requests.filter((row) => matches(row, where));
    for (const row of rows) {
      // The database's own rule: a decided row needs a named person, a time and a reason.
      const next = { ...row, ...data };
      if (["APPROVED", "DECLINED"].includes(next.status as string) && !(next.decidedByUserId && next.decidedAt && String(next.decisionReason ?? "").trim() && String(next.decidedByNameSnapshot ?? "").trim())) {
        throw new Error("CancellationRequest_decision_has_actor_and_reason");
      }
      Object.assign(row, data, { updatedAt: world.now });
    }
    return { count: rows.length };
  },
};

const fakeDb = {
  cancellationRequest: requestModel,
  cancellationRequestEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      world.writes.push("cancellationRequestEvent.create");
      const row = { ...data, id: id("evt"), createdAt: new Date(world.now.getTime() + world.events.length) };
      world.events.push(row);
      return { id: row.id };
    },
  },
  registration: {
    findFirst: async ({ where }: { where: { id?: string; eventId?: string } }) => {
      if (where.id !== "reg-1" || where.eventId !== "event-1") return null;
      return { id: "reg-1", status: world.status, confirmationCode: "SYN001", contactSnapshot: { firstName: "Avery", lastName: "Synthetic" }, groupRegistration: world.group ? { id: "g" } : null, clubRegistration: null, event: { billingMode: world.billingMode } };
    },
    findUnique: async ({ where }: { where: { id: string } }) => (where.id === "reg-1" ? { id: "reg-1", eventId: "event-1" } : null),
    findMany: async () => [{ id: "reg-1", confirmationCode: "SYN001", contactSnapshot: { firstName: "Avery", lastName: "Synthetic" } }],
    count: async () => 3,
  },
  user: { findUnique: async ({ where }: { where: { id: string } }) => world.users.get(where.id) ?? null },
  $executeRaw: async () => 1,
  // A distinct client for the transaction, so a test can tell a read on it from a read through the pool.
  $transaction: async (run: (tx: unknown) => unknown) => {
    const tx = new Proxy(db, {});
    world.transactions.push(tx);
    return run(tx);
  },
};

// Any touch of a guarded model, or a write to the registration, fails the test that did it.
const db: Record<string, unknown> = new Proxy(fakeDb as Record<string, unknown>, {
  get(target, property: string) {
    if (GUARDED.has(property)) {
      world.writes.push(`${property}.accessed`);
      throw new Error(`The workflow must not touch ${property}.`);
    }
    if (property === "registration") {
      return new Proxy(target.registration as Record<string, unknown>, {
        get(registration, method: string) {
          if (/^(create|update|upsert|delete)/.test(method)) {
            world.writes.push(`registration.${method}`);
            throw new Error(`The workflow must not call registration.${method}.`);
          }
          return registration[method];
        },
      });
    }
    return target[property];
  },
});

vi.mock("@/lib/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarning: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(async (entry: Record<string, unknown>) => { world.audits.push(entry); }),
}));
vi.mock("@/modules/communications/messaging-repository", () => ({
  processQueuedMessageIdsAfterCommit: vi.fn(async (ids: string[]) => { world.processed.push(ids); }),
}));
vi.mock("@/modules/communications/transactional-messages", () => ({
  enqueueCancellationRequestMessage: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    world.writes.push("messageOutbox.enqueue");
    world.emails.push(input);
    return { messageIds: [`msg-${world.emails.length}`], pendingMessageIds: [`msg-${world.emails.length}`] };
  }),
}));

function currentFacts(at: Date): CalculationFacts {
  return {
    evaluatedAt: at.toISOString(),
    clock: "SERVER",
    eventTimezone: "America/Chicago",
    registration: { id: "reg-1", confirmationCode: "SYN001", status: world.status },
    attendees: world.attendees,
    charges: world.charges as ChargeEntry[],
    registrationPaidCents: world.paid,
    depositCents: 5_000,
    depositSource: "RECORDED_DEPOSIT",
    noShowFirstNight: false,
  };
}

vi.mock("@/modules/cancellation-policy/repository", () => ({
  previewCancellation: vi.fn(async (_eventId: string, request: { selection: never }, at: Date, client?: unknown) => (world.clients.push({ call: "preview", client }), {
    result: calculateCancellation({ facts: currentFacts(at ?? world.now), selection: request.selection, policyVersions: world.policies as never }),
    registration: null,
    recorded: false,
  })),
  appendCalculationRecord: vi.fn(async (_tx: unknown, eventId: string, actorUserId: string | null, request: unknown, result: CancellationResult, requestedBy: string) => {
    world.writes.push("cancellationCalculation.create");
    const row = { id: id("calc"), eventId, createdByUserId: actorUserId, result, requestedBy };
    world.calculations.push(row);
    return { id: row.id, createdAt: world.now };
  }),
  loadRegistrationFacts: vi.fn(async (_eventId: string, registrationId: string, at: Date, client?: unknown) => {
    world.clients.push({ call: "facts", client });
    if (registrationId !== "reg-1") throw new Error("REGISTRATION_NOT_FOUND");
    return {
      facts: currentFacts(at ?? world.now),
      summary: {
        id: "reg-1", confirmationCode: "SYN001", status: world.status,
        attendees: world.attendees.map((attendee, index) => ({ id: attendee.id, name: `Synthetic Person ${index + 1}` })),
        charges: (world.charges as ChargeEntry[]).map((charge) => ({ id: charge.id, label: charge.label, category: charge.category, amountCents: charge.amountCents })),
      },
    };
  }),
  policyInEffect: vi.fn(async (_eventId: string, at: Date) => selectPolicyVersion(world.policies as never, at ?? world.now)),
}));

import {
  CancellationRequestError,
  getCancellationRequestDetail,
  getRegistrantRequestView,
  listCancellationRequests,
  reviewCancellationRequest,
  submitCancellationRequest,
  withdrawCancellationRequest,
} from "@/modules/cancellation-requests/repository";
import type { SubmitInput } from "@/modules/cancellation-requests/domain";

const target = { registrationId: "reg-1", eventId: "event-1" };
const SECRET_REASON = "secret-reason-words-for-privacy-check";

function charge(idValue: string, attendeeId: string, amountCents: number): ChargeEntry {
  return { id: idValue, source: "PRICING_LINE", label: `Registration ${idValue}`, amountCents, category: "REGISTRATION", fieldKey: idValue, attendeeId };
}

beforeEach(() => {
  world.now = new Date("2026-05-01T15:00:00.000Z");
  world.status = "CONFIRMED";
  world.billingMode = "ATTENDEE_PAY";
  world.group = false;
  world.paid = 20_000;
  world.attendees = [{ id: "att-1", position: 0 }, { id: "att-2", position: 1 }];
  world.charges = [charge("line:a", "att-1", 10_000), charge("line:b", "att-2", 10_000)];
  world.policies = [{ id: "pv-1", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"), rules: parseCancellationRules(campMeetingPreset("2026-05-25")) }];
  world.requests = [];
  world.events = [];
  world.calculations = [];
  world.audits = [];
  world.emails = [];
  world.processed = [];
  world.writes = [];
  world.transactions = [];
  world.clients = [];
  world.nextId = 1;
  world.users = new Map([["staff-1", { id: "staff-1", displayName: "Fran Finance" }], ["staff-2", { id: "staff-2", displayName: "Rae Registrar" }]]);
});

let keyCounter = 0;
function submitInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  keyCounter += 1;
  return {
    action: "submit",
    selection: { scope: "FULL_REGISTRATION" },
    reason: SECRET_REASON,
    contactMethod: "EMAIL",
    idempotencyKey: `key-${String(keyCounter).padStart(8, "0")}`,
    expectedRefundCents: 0,
    ...overrides,
  } as SubmitInput;
}

/** Calculates what the registrant would be shown, so a submit carries the refund they saw. */
async function expectedFor(selection: SubmitInput["selection"]) {
  const result = calculateCancellation({ facts: currentFacts(world.now), selection: selection as never, policyVersions: world.policies as never });
  return result.money.refundCents;
}

async function submit(overrides: Partial<SubmitInput> = {}, actor = { via: "MANAGE_LINK" as const }) {
  const selection = overrides.selection ?? { scope: "FULL_REGISTRATION" as const };
  return submitCancellationRequest(target, actor, submitInput({ expectedRefundCents: await expectedFor(selection), ...overrides, selection }), world.now);
}

describe("submitting a request (#170)", () => {
  it("saves the policy version, the calculation and the registration state with the request", async () => {
    const outcome = await submit();
    expect(outcome.duplicate).toBe(false);
    expect(outcome.request.status).toBe("REQUESTED");
    const [row] = world.requests;
    expect(row).toMatchObject({ registrationId: "reg-1", eventId: "event-1", policyVersionId: "pv-1", policyVersion: 1, scope: "FULL_REGISTRATION", requestedVia: "MANAGE_LINK", contactMethod: "EMAIL" });
    const calculation = world.calculations.find((candidate) => candidate.id === row.calculationId);
    expect(calculation).toBeTruthy();
    expect((calculation!.result as CancellationResult).policy?.version).toBe(1);
    expect(calculation!.createdByUserId).toBeNull();
    expect(calculation!.requestedBy).toBe("REGISTRANT");
    expect(row.registrationState).toMatchObject({ registrationStatus: "CONFIRMED", attendeeIds: ["att-1", "att-2"], paidCents: 20_000 });
    expect(String(row.stateFingerprint)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.proposedRefundCents).toBe((calculation!.result as CancellationResult).money.refundCents);
  });

  it("writes a timeline step, an audit entry and a received email, and delivers after the commit", async () => {
    await submit();
    expect(world.events.map((event) => [event.fromStatus, event.toStatus, event.actorKind])).toEqual([[null, "REQUESTED", "REGISTRANT"]]);
    expect(world.audits.map((entry) => entry.action)).toEqual(["CANCELLATION_REQUEST_SUBMITTED"]);
    expect(world.emails).toHaveLength(1);
    expect(world.emails[0]).toMatchObject({ kind: "RECEIVED", status: "REQUESTED", registrationId: "reg-1" });
    expect(world.processed).toEqual([["msg-1"]]);
  });

  it("scopes one attendee and refuses an attendee who is not on the registration", async () => {
    const one = await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] } });
    expect(one.request.scope).toBe("ATTENDEE");
    expect(world.requests[0].attendeeIds).toEqual(["att-1"]);

    const before = world.requests.length;
    await expect(submitCancellationRequest(target, { via: "MANAGE_LINK" }, submitInput({ selection: { scope: "ATTENDEE", attendeeIds: ["att-from-another-registration"] } }), world.now))
      .rejects.toMatchObject({ code: "CALCULATION_UNAVAILABLE" });
    expect(world.requests).toHaveLength(before);
  });

  it("treats choosing every attendee as the whole registration", async () => {
    await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1", "att-2"] } });
    expect(world.requests[0]).toMatchObject({ scope: "FULL_REGISTRATION", scopeKey: "FULL_REGISTRATION", attendeeIds: [] });
  });

  it("refuses a component the policy does not support", async () => {
    await expect(submitCancellationRequest(target, { via: "MANAGE_LINK" }, submitInput({ selection: { scope: "COMPONENT", chargeIds: ["line:a"] } }), world.now))
      .rejects.toMatchObject({ code: "CALCULATION_UNAVAILABLE" });
  });

  it("accepts a request after the deadline, with the after-deadline terms recorded", async () => {
    world.now = new Date("2026-06-10T15:00:00.000Z");
    const outcome = await submit();
    expect(outcome.duplicate).toBe(false);
    const result = world.calculations[0].result as CancellationResult;
    expect(result.timing?.kind).toBe("AFTER_WINDOWS");
    expect(result.deposit.outcome).toBe("FORFEITED");
    expect(world.audits.find((entry) => entry.action === "CANCELLATION_REQUEST_SUBMITTED")?.metadata).toMatchObject({ afterDeadline: true });
  });

  it("does not save anything when the outcome changed since the registrant looked", async () => {
    await expect(submitCancellationRequest(target, { via: "MANAGE_LINK" }, submitInput({ expectedRefundCents: 123 }), world.now))
      .rejects.toMatchObject({ code: "OUTCOME_CHANGED", detail: { proposal: expect.objectContaining({ status: "CALCULATED" }) } });
    expect(world.requests).toHaveLength(0);
    expect(world.calculations).toHaveLength(0);
    expect(world.emails).toHaveLength(0);
  });

  it("is not offered for a church- or group-billed registration, or one that is not active", async () => {
    world.billingMode = "DEFERRED_ORGANIZATION_INVOICE";
    await expect(submit()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    world.billingMode = "ATTENDEE_PAY";
    world.group = true;
    await expect(submit()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    world.group = false;
    world.status = "CANCELLED";
    await expect(submit()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(world.requests).toHaveLength(0);
  });

  it("is not available when the event has no policy in effect", async () => {
    world.policies = [];
    const view = await getRegistrantRequestView(target, world.now);
    expect(view.available).toBe(false);
    expect(view.unavailableReason).toMatch(/not available/);
    // The My registrations note keys off this flag (#1408); an ineligible registration never carries it.
    expect(view.noPolicy).toBe(true);
    world.status = "CANCELLED";
    expect((await getRegistrantRequestView(target, world.now)).noPolicy).toBe(false);
  });
});

describe("duplicate and overlapping requests (#170)", () => {
  it("returns the same request for a repeated submit with the same key", async () => {
    const input = submitInput({ expectedRefundCents: await expectedFor({ scope: "FULL_REGISTRATION" }) });
    const first = await submitCancellationRequest(target, { via: "MANAGE_LINK" }, input, world.now);
    const second = await submitCancellationRequest(target, { via: "MANAGE_LINK" }, input, world.now);
    expect(second.duplicate).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    expect(world.requests).toHaveLength(1);
    expect(world.calculations).toHaveLength(1);
    expect(world.emails).toHaveLength(1);
  });

  it("returns the open request when the same scope is sent again with a new key", async () => {
    const first = await submit();
    const second = await submit();
    expect(second.duplicate).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    expect(world.requests).toHaveLength(1);
  });

  it("settles a race at the database's unique index by returning the winner", async () => {
    const first = await submit();
    // Make every read in front of the insert miss (the key check, the transaction's two checks and the open-request
    // scan), as two concurrent submits would, so the unique index is what decides.
    const originalFirst = requestModel.findFirst;
    const originalMany = requestModel.findMany;
    let hiddenFirst = 3;
    let hiddenMany = 1;
    requestModel.findFirst = async (args) => (hiddenFirst > 0 ? (hiddenFirst -= 1, null) : originalFirst(args));
    requestModel.findMany = async (args) => (hiddenMany > 0 ? (hiddenMany -= 1, []) : originalMany(args));
    try {
      const raced = await submit();
      expect(raced.duplicate).toBe(true);
      expect(raced.request.id).toBe(first.request.id);
      expect(hiddenFirst).toBe(0);
    } finally {
      requestModel.findFirst = originalFirst;
      requestModel.findMany = originalMany;
    }
    expect(world.requests).toHaveLength(1);
  });

  it("refuses an overlapping request unless the registrant chose to replace the open one", async () => {
    const whole = await submit();
    await expect(submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] } }))
      .rejects.toMatchObject({ code: "OVERLAPPING_OPEN_REQUEST", detail: { open: [expect.objectContaining({ id: whole.request.id })] } });
    expect(world.requests).toHaveLength(1);
    expect(world.requests[0].status).toBe("REQUESTED");
  });

  it("supersedes the older request, visibly, when the registrant chose to", async () => {
    const whole = await submit();
    const replacement = await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] }, supersedeRequestIds: [whole.request.id] });
    expect(replacement.superseded).toEqual([whole.request.id]);
    const older = world.requests.find((row) => row.id === whole.request.id)!;
    expect(older.status).toBe("SUPERSEDED");
    expect(older.supersededById).toBe(replacement.request.id);
    expect(world.events.filter((event) => event.requestId === older.id).map((event) => event.toStatus)).toEqual(["REQUESTED", "SUPERSEDED"]);
    expect(world.events.find((event) => event.toStatus === "SUPERSEDED")?.actorKind).toBe("SYSTEM");
    expect(world.emails.map((email) => `${email.kind}:${email.status}`)).toEqual(["RECEIVED:REQUESTED", "RECEIVED:REQUESTED", "UPDATED:SUPERSEDED"]);
  });

  it("allows two requests for different attendees", async () => {
    await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] } });
    await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-2"] } });
    expect(world.requests.map((row) => row.status)).toEqual(["REQUESTED", "REQUESTED"]);
  });
});

describe("withdrawing (#170)", () => {
  it("withdraws an open request, with a timeline step, an audit entry and an email", async () => {
    const { request } = await submit();
    const withdrawn = await withdrawCancellationRequest(target, request.id, world.now);
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(withdrawn.canWithdraw).toBe(false);
    expect(world.audits.map((entry) => entry.action)).toContain("CANCELLATION_REQUEST_WITHDRAWN");
    expect(world.emails.at(-1)).toMatchObject({ kind: "UPDATED", status: "WITHDRAWN" });
    expect(world.writes.some((write) => write.startsWith("registration."))).toBe(false);
  });

  it("is idempotent: withdrawing twice changes nothing the second time", async () => {
    const { request } = await submit();
    await withdrawCancellationRequest(target, request.id, world.now);
    const emails = world.emails.length;
    const events = world.events.length;
    const again = await withdrawCancellationRequest(target, request.id, world.now);
    expect(again.status).toBe("WITHDRAWN");
    expect(world.emails).toHaveLength(emails);
    expect(world.events).toHaveLength(events);
  });

  it("lets the registrant ask again after withdrawing", async () => {
    const { request } = await submit();
    await withdrawCancellationRequest(target, request.id, world.now);
    const again = await submit();
    expect(again.duplicate).toBe(false);
    expect(again.request.id).not.toBe(request.id);
    expect(world.requests.map((row) => row.status)).toEqual(["WITHDRAWN", "REQUESTED"]);
  });

  it("cannot withdraw a decided request", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "DECLINE", reason: "Outside the policy." }, world.now);
    await expect(withdrawCancellationRequest(target, request.id, world.now)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(world.requests[0].status).toBe("DECLINED");
  });

  it("cannot withdraw a request that belongs to another registration", async () => {
    const { request } = await submit();
    await expect(withdrawCancellationRequest({ registrationId: "reg-other", eventId: "event-1" }, request.id, world.now)).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
    await expect(withdrawCancellationRequest({ registrationId: "reg-1", eventId: "event-other" }, request.id, world.now)).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
    expect(world.requests[0].status).toBe("REQUESTED");
  });
});

describe("staff review (#170)", () => {
  it("moves through review and a request for information, naming the person on each step", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "START_REVIEW" }, world.now);
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "REQUEST_INFORMATION", registrantNote: "Please send the travel dates." }, world.now);
    expect(world.requests[0]).toMatchObject({ status: "INFORMATION_NEEDED", registrantNote: "Please send the travel dates." });
    const staffSteps = world.events.filter((event) => event.actorKind === "STAFF");
    expect(staffSteps.map((event) => [event.toStatus, event.actorUserId, event.actorNameSnapshot])).toEqual([
      ["UNDER_REVIEW", "staff-1", "Fran Finance"],
      ["INFORMATION_NEEDED", "staff-1", "Fran Finance"],
    ]);
    const view = await getRegistrantRequestView(target, world.now);
    expect(view.requests[0].registrantNote).toBe("Please send the travel dates.");
    expect(JSON.stringify(view)).not.toContain("Fran Finance");
  });

  it("records an approval with the named person, the reason and the time", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Within the policy." }, world.now);
    expect(world.requests[0]).toMatchObject({ status: "APPROVED", decidedByUserId: "staff-1", decidedByNameSnapshot: "Fran Finance", decisionReason: "Within the policy." });
    expect(world.requests[0].decidedAt).toEqual(world.now);
    expect(world.audits.find((entry) => entry.action === "CANCELLATION_REQUEST_APPROVED")).toMatchObject({ actorUserId: "staff-1", entityId: request.id });
    expect(world.emails.at(-1)).toMatchObject({ kind: "UPDATED", status: "APPROVED" });
  });

  it("denies a request with a reason, tells the registrant the status, and changes nothing else", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-2" }, { action: "DECLINE", reason: "Outside the policy." }, world.now);
    expect(world.requests[0]).toMatchObject({ status: "DECLINED", decidedByUserId: "staff-2", decisionReason: "Outside the policy." });
    expect(world.emails.at(-1)).toMatchObject({ kind: "UPDATED", status: "DECLINED" });
    const view = await getRegistrantRequestView(target, world.now);
    expect(view.requests[0].status).toBe("DECLINED");
    // The registrant sees the status, never the staff reason or the staff name.
    expect(JSON.stringify(view)).not.toContain("Outside the policy.");
    expect(JSON.stringify(view)).not.toContain("Rae Registrar");
  });

  it("refuses an approval or denial with no reason, and no named person", async () => {
    const { request } = await submit();
    await expect(reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "" } as never, world.now)).rejects.toThrow();
    await expect(reviewCancellationRequest("event-1", request.id, { userId: "" }, { action: "DECLINE", reason: "No." }, world.now)).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    await expect(reviewCancellationRequest("event-1", request.id, { userId: "nobody" }, { action: "DECLINE", reason: "No." }, world.now)).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    expect(world.requests[0].status).toBe("REQUESTED");
  });

  it("refuses to decide twice, and two reviewers cannot both decide", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "DECLINE", reason: "No." }, world.now);
    await expect(reviewCancellationRequest("event-1", request.id, { userId: "staff-2" }, { action: "APPROVE", reason: "Yes." }, world.now)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(world.requests[0]).toMatchObject({ status: "DECLINED", decidedByUserId: "staff-1" });
  });

  it("cannot reach a request of another event", async () => {
    const { request } = await submit();
    await expect(reviewCancellationRequest("event-other", request.id, { userId: "staff-1" }, { action: "START_REVIEW" }, world.now)).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
    expect(await getCancellationRequestDetail("event-other", request.id, world.now)).toBeNull();
    expect(await listCancellationRequests("event-other")).toEqual(expect.any(Array));
  });

  it("approving moves no money and cancels nothing: no Payment, Refund, Registration or capacity is touched", async () => {
    const { request } = await submit();
    const writesBeforeApprove = world.writes.length;
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Within the policy." }, world.now);
    // Only what approving itself wrote: the status change, the timeline step and the status email.
    expect(world.writes.slice(writesBeforeApprove)).toEqual(["cancellationRequest.updateMany", "cancellationRequestEvent.create", "messageOutbox.enqueue"]);
    // The fake database throws on any access to a payment, refund, attendee, operation, capacity or waitlist model and on
    // any registration write, so reaching this line already proves it; the write log makes it explicit.
    expect(world.writes.filter((write) => /^(payment|refund|registration|registrationAttendee|registrationOperation|capacityReservation|waitlistEntry)/.test(write))).toEqual([]);
    expect(new Set(world.writes)).toEqual(new Set([
      "cancellationRequest.create",
      "cancellationRequest.updateMany",
      "cancellationRequestEvent.create",
      "cancellationCalculation.create",
      "messageOutbox.enqueue",
    ]));
    expect(world.status).toBe("CONFIRMED");
    expect(world.paid).toBe(20_000);
    const calculation = world.calculations[0].result as CancellationResult;
    expect(calculation.sideEffects).toEqual({ cancelled: false, refunded: false, creditCreated: false, ledgerWritten: false });
  });
});

describe("the decision reads on its own transaction (#170)", () => {
  it("runs every read of the change check on the transaction client, never through the pool", async () => {
    const { request } = await submit();
    world.clients = [];
    world.transactions = [];
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Within the policy." }, world.now);
    const [tx] = world.transactions;
    expect(tx).toBeTruthy();
    expect(world.clients.map((entry) => entry.call).sort()).toEqual(["facts", "preview"]);
    for (const entry of world.clients) expect(entry.client, entry.call).toBe(tx);
  });
});

describe("a status that repeats (#170)", () => {
  it("is emailed for each timeline step, each with its own step id", async () => {
    const { request } = await submit();
    const act = (action: Record<string, unknown>) => reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, action as never, world.now);
    await act({ action: "REQUEST_INFORMATION", registrantNote: "First question." });
    await act({ action: "START_REVIEW" });
    await act({ action: "REQUEST_INFORMATION", registrantNote: "Second question." });
    const updates = world.emails.filter((email) => email.kind === "UPDATED");
    expect(updates.map((email) => email.status)).toEqual(["INFORMATION_NEEDED", "UNDER_REVIEW", "INFORMATION_NEEDED"]);
    expect(new Set(updates.map((email) => email.stepId)).size).toBe(3);
    expect(updates.map((email) => email.stepId)).toEqual(world.events.filter((event) => event.toStatus !== "REQUESTED").map((event) => event.id));
  });
});

describe("a registration that changed after the request (#170)", () => {
  it("treats only elapsed time as a note, which needs no acknowledgement", async () => {
    const { request } = await submit();
    world.now = new Date("2026-06-10T15:00:00.000Z");
    const detail = await getCancellationRequestDetail("event-1", request.id, world.now);
    const outcome = detail!.conflicts.find((conflict) => conflict.code === "OUTCOME_CHANGED");
    expect(outcome).toMatchObject({ severity: "NOTE" });
    expect(outcome!.message).toMatch(/Time has passed/);
    expect(detail!.conflicts.filter((conflict) => conflict.severity === "CHANGE")).toEqual([]);
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Asked in time." }, world.now);
    expect(world.requests[0]).toMatchObject({ status: "APPROVED", decidedWithChanges: false });
  });

  it("words a newer policy separately from elapsed time", async () => {
    const { request } = await submit();
    const rules = parseCancellationRules({ ...campMeetingPreset("2026-05-25"), windows: [{ ...campMeetingPreset("2026-05-25").windows![0], terms: { refund: { kind: "FULL" }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: false } }] });
    world.policies = [...(world.policies as unknown[]), { id: "pv-2", version: 2, effectiveFrom: new Date("2026-05-02T00:00:00Z"), rules }];
    world.now = new Date("2026-05-03T15:00:00.000Z");
    const detail = await getCancellationRequestDetail("event-1", request.id, world.now);
    const messages = detail!.conflicts.map((conflict) => `${conflict.code}:${conflict.severity}:${conflict.message}`).join("\n");
    expect(messages).toMatch(/POLICY_VERSION_CHANGED:NOTE:A newer refund policy is in effect/);
    expect(messages).toMatch(/OUTCOME_CHANGED:NOTE:A newer refund policy is in effect/);
    expect(messages).not.toMatch(/Time has passed/);
  });

  it("decides from the registration as it is at the moment of the decision", async () => {
    const { request } = await submit();
    // The registration changes after the request and before the decision: the check inside the decision sees it.
    world.paid = 5_000;
    await expect(reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Yes." }, world.now)).rejects.toMatchObject({ code: "CHANGES_NOT_ACKNOWLEDGED" });
    expect(world.requests[0].status).toBe("REQUESTED");
    world.paid = 20_000;
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Yes." }, world.now);
    expect(world.requests[0]).toMatchObject({ status: "APPROVED", decidedWithChanges: false });
  });

  it("shows what changed to staff, and asks for an acknowledgement before approving", async () => {
    const { request } = await submit();
    world.paid = 15_000;
    world.attendees = [{ id: "att-1", position: 0 }];
    world.charges = [charge("line:a", "att-1", 10_000)];
    const detail = await getCancellationRequestDetail("event-1", request.id, world.now);
    const codes = detail!.conflicts.map((conflict) => conflict.code);
    expect(codes).toEqual(expect.arrayContaining(["ATTENDEES_CHANGED", "CHARGES_CHANGED", "PAYMENTS_CHANGED"]));

    await expect(reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Still within the policy." }, world.now))
      .rejects.toMatchObject({ code: "CHANGES_NOT_ACKNOWLEDGED", detail: { conflicts: expect.any(Array) } });
    expect(world.requests[0].status).toBe("REQUESTED");

    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "Still within the policy.", acknowledgeChanges: true }, world.now);
    expect(world.requests[0]).toMatchObject({ status: "APPROVED", decidedWithChanges: true });
  });

  it("lets staff decline without acknowledging, since declining changes nothing", async () => {
    const { request } = await submit();
    world.status = "CANCELLED";
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "DECLINE", reason: "Already cancelled by staff." }, world.now);
    expect(world.requests[0].status).toBe("DECLINED");
  });

  it("flags a registration that was cancelled, and a deadline that has since passed", async () => {
    const { request } = await submit();
    world.now = new Date("2026-06-10T15:00:00.000Z");
    world.status = "CANCELLED";
    const detail = await getCancellationRequestDetail("event-1", request.id, world.now);
    const codes = detail!.conflicts.map((conflict) => conflict.code);
    expect(codes).toContain("REGISTRATION_STATUS_CHANGED");
    expect(codes).toContain("REGISTRATION_NOT_CANCELLABLE");
    // The proposal the registrant was shown is the recorded one, not today's.
    expect(detail!.proposal.afterDeadline).toBe(false);
  });

  it("notes a newer policy version and today's different outcome after the deadline", async () => {
    const { request } = await submit();
    world.now = new Date("2026-06-10T15:00:00.000Z");
    const detail = await getCancellationRequestDetail("event-1", request.id, world.now);
    expect(detail!.conflicts.map((conflict) => conflict.code)).toContain("OUTCOME_CHANGED");
    expect(detail!.proposal.refundCents).toBe(request.proposedRefundCents);
  });
});

describe("what staff see (#170)", () => {
  it("lists open requests with the oldest first and filters by status", async () => {
    const first = await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] } });
    await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-2"] } });
    await reviewCancellationRequest("event-1", first.request.id, { userId: "staff-1" }, { action: "DECLINE", reason: "No." }, world.now);
    expect((await listCancellationRequests("event-1", "OPEN")).map((row) => row.status)).toEqual(["REQUESTED"]);
    expect((await listCancellationRequests("event-1", "DECLINED")).map((row) => row.registrantName)).toEqual(["Avery Synthetic"]);
  });

  it("shows capacity and waitlist effects, the reason, and other open requests", async () => {
    const first = await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] } });
    await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-2"] } });
    const detail = await getCancellationRequestDetail("event-1", first.request.id, world.now);
    expect(detail!.reason).toBe(SECRET_REASON);
    expect(detail!.capacity).toMatchObject({ registrationWouldBeCancelled: false, seatsReleased: 1, waitlistedInEvent: 3 });
    expect(detail!.capacity.note).toMatch(/releases no seat and promotes no one/);
    expect(detail!.otherOpenRequests).toHaveLength(1);
    expect(detail!.actions).toEqual(["START_REVIEW", "REQUEST_INFORMATION", "APPROVE", "DECLINE"]);
  });
});

describe("audit entries and emails carry ids only (#170)", () => {
  it("never puts the reason, a name or an amount in an audit entry or an email", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "REQUEST_INFORMATION", registrantNote: "private-staff-note-text" }, world.now);
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "APPROVE", reason: "private-decision-reason-text" }, world.now);
    await withdrawCancellationRequest(target, (await submit({ selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] } })).request.id, world.now).catch(() => undefined);
    const audit = JSON.stringify(world.audits.filter((entry) => String(entry.action).startsWith("CANCELLATION_REQUEST")));
    const mail = JSON.stringify(world.emails);
    for (const secret of [SECRET_REASON, "private-staff-note-text", "private-decision-reason-text", "Fran Finance", "Avery", "Synthetic"]) {
      expect(audit, secret).not.toContain(secret);
      expect(mail, secret).not.toContain(secret);
    }
    for (const entry of world.audits.filter((candidate) => String(candidate.action).startsWith("CANCELLATION_REQUEST"))) {
      expect(entry.metadata).toMatchObject({ requestId: expect.any(String), registrationId: "reg-1", sideEffects: "NONE" });
      expect(JSON.stringify(entry.metadata)).not.toMatch(/\d+\.\d{2}|refundCents|amount/);
    }
  });

  it("emails only a status and a fixed sentence", async () => {
    const { request } = await submit();
    await reviewCancellationRequest("event-1", request.id, { userId: "staff-1" }, { action: "DECLINE", reason: "private-decision-reason-text" }, world.now);
    for (const email of world.emails) {
      expect(Object.keys(email).sort()).toEqual(["eventId", "kind", "registrationId", "requestId", "status", "statusDetail", "statusLabel", "stepId"]);
    }
  });
});

describe("the error type", () => {
  it("is a CancellationRequestError with a code", () => {
    const error = new CancellationRequestError("NOT_AVAILABLE", "No.");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NOT_AVAILABLE");
  });
});
