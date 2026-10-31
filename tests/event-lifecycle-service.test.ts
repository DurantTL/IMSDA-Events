import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import { EventLifecycleError, getEventLifecycle, transitionEventLifecycle } from "@/modules/events/lifecycle-repository";
import { EventOperationError } from "@/modules/events/operation-error";

type Row = {
  name: string;
  slug: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  publicInfoUrl: string | null;
  supportContact: string | null;
  isPublished: boolean;
  audience: "GENERAL" | "CLUB";
  billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE";
  archivedAt: Date | null;
  lifecycleState: string | null;
  lifecycleVersion: number;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  name: "Synthetic Retreat",
  slug: "synthetic-retreat",
  startsAt: new Date("2027-10-08T12:00:00.000Z"),
  endsAt: new Date("2027-10-10T12:00:00.000Z"),
  timezone: "America/Chicago",
  location: "Camp Heritage",
  publicInfoUrl: null,
  supportContact: "registration@example.test",
  isPublished: false,
  audience: "GENERAL",
  billingMode: "ATTENDEE_PAY",
  archivedAt: null,
  lifecycleState: null,
  lifecycleVersion: 0,
  ...overrides,
});

function mockPrisma(current: Row | null, options: { forms?: number; changedRows?: number; sender?: string | null; types?: Array<{ label: string; minimumAge: number | null }> } = {}) {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => { order.push("lock"); return [{ id: "event-1" }]; }),
    event: {
      findUnique: vi.fn(async () => { order.push("read"); return current; }),
      updateMany: vi.fn(async () => { order.push("update"); return { count: options.changedRows ?? 1 }; }),
    },
    registrationFormVersion: { count: vi.fn().mockResolvedValue(options.forms ?? 1) },
    // The required publish items (#1408): a saved central sender and an adult attendee type, by default present.
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ defaultSenderName: "IMSDA Events", defaultSenderEmail: options.sender === undefined ? "events@example.test" : options.sender, defaultReplyToEmail: null }) },
    eventAttendeeType: { findMany: vi.fn().mockResolvedValue(options.types ?? [{ label: "Adult", minimumAge: 18 }]) },
    eventLifecycleTransition: { create: vi.fn(async () => { order.push("history"); return {}; }) },
    auditLog: { create: vi.fn(async (_args: { data: { action: string; metadata: unknown } }) => { void _args; order.push("audit"); return {}; }) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    event: { findUnique: vi.fn().mockResolvedValue(current) },
    eventLifecycleTransition: { findMany: vi.fn().mockResolvedValue([]) },
  };
  dependencies.getPrisma.mockReturnValue(prisma);
  return { tx, order };
}

const configure = { userId: "usr_1", permissions: ["CONFIGURE_EVENT"] as const };
const now = new Date("2027-07-01T12:00:00.000Z");

beforeEach(() => vi.clearAllMocks());

describe("transitionEventLifecycle (#156)", () => {
  it("locks the row, then moves state and isPublished together, then writes history and audit", async () => {
    const { tx, order } = mockPrisma(row({ lifecycleState: "TEST" }));
    const result = await transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: "TEST", actor: configure, reason: " go live ", now });
    expect(result).toMatchObject({ changed: true, fromState: "TEST", toState: "PUBLISHED", lifecycleVersion: 1 });
    expect(order).toEqual(["lock", "read", "update", "history", "audit"]);
    expect(tx.event.updateMany).toHaveBeenCalledWith({
      where: { id: "event-1", lifecycleVersion: 0 },
      data: { lifecycleState: "PUBLISHED", isPublished: true, lifecycleVersion: { increment: 1 } },
    });
    expect(tx.eventLifecycleTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: "event-1", fromState: "TEST", toState: "PUBLISHED", actorUserId: "usr_1", reason: "go live",
        evidence: { publishReadiness: expect.arrayContaining([{ id: "registration-form", complete: true }]) },
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "EVENT_PUBLISHED", summary: "Published event: Synthetic Retreat." }) });
  });

  it("takes a public event out of public view in the same update", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true, lifecycleVersion: 4 }));
    await transitionEventLifecycle({ eventId: "event-1", toState: "DRAFT", expectedFromState: "PUBLISHED", actor: configure, now });
    expect(tx.event.updateMany).toHaveBeenCalledWith({
      where: { id: "event-1", lifecycleVersion: 4 },
      data: { lifecycleState: "DRAFT", isPublished: false, lifecycleVersion: { increment: 1 } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "EVENT_UNPUBLISHED" }) });
  });

  it("audits other moves as a lifecycle change with the states, not the free-text reason", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    await transitionEventLifecycle({ eventId: "event-1", toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: configure, reason: "private note", now });
    const audit = tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit.action).toBe("EVENT_LIFECYCLE_CHANGED");
    expect(audit.metadata).toEqual({ name: "Synthetic Retreat", fromState: "PUBLISHED", toState: "REGISTRATION_CLOSED" });
  });

  it("is an idempotent no-op when the event is already there, even when the caller's expectation is out of date", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "REGISTRATION_CLOSED", isPublished: true, lifecycleVersion: 2 }));
    const result = await transitionEventLifecycle({ eventId: "event-1", toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: configure, now });
    expect(result).toMatchObject({ changed: false, fromState: "REGISTRATION_CLOSED", toState: "REGISTRATION_CLOSED", lifecycleVersion: 2 });
    expect(tx.event.updateMany).not.toHaveBeenCalled();
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses even a no-op without the permission that moving into the state needs, and still allows it with it", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: "PUBLISHED", actor: { userId: "usr_1", permissions: ["VIEW_EVENT"] }, now })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: "PUBLISHED", actor: configure, now })).resolves.toMatchObject({ changed: false });
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
  });

  it("asks a finance-only state's no-op for MANAGE_FINANCE, not CONFIGURE_EVENT", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "CLOSED", isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "CLOSED", expectedFromState: "CLOSED", actor: configure, now })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "CLOSED", expectedFromState: "CLOSED", actor: { userId: "usr_1", permissions: ["MANAGE_FINANCE"] }, now })).resolves.toMatchObject({ changed: false });
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
  });

  it("asks an Archived no-op, which no rule enters, for CONFIGURE_EVENT", async () => {
    mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true, archivedAt: new Date("2026-10-01T00:00:00Z") }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "ARCHIVED", expectedFromState: "ARCHIVED", actor: { userId: "usr_1", permissions: ["VIEW_EVENT"] }, now })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "ARCHIVED", expectedFromState: "ARCHIVED", actor: configure, now })).resolves.toMatchObject({ changed: false });
  });

  it("refuses a stale expected state with a conflict and changes nothing", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "TEST" }));
    const error = await transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: "DRAFT", actor: configure, now }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EventLifecycleError);
    expect(error).toMatchObject({ code: "CONFLICT", currentState: "TEST" });
    expect(tx.event.updateMany).not.toHaveBeenCalled();
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
  });

  it("is a conflict, with no history, when the version moved under it", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "TEST" }), { changedRows: 0 });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "DRAFT", expectedFromState: "TEST", actor: configure, now })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("reads a legacy published event as PUBLISHED and an old-code publish of a TEST event as PUBLISHED", async () => {
    mockPrisma(row({ isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: configure, now })).resolves.toMatchObject({ fromState: "PUBLISHED" });
    mockPrisma(row({ lifecycleState: "TEST", isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: configure, now })).resolves.toMatchObject({ fromState: "PUBLISHED" });
  });

  it("refuses without the declared permission, an undeclared move, and an unmet condition", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "REGISTRATION_CLOSED", actor: { userId: "usr_1", permissions: ["VIEW_EVENT"] }, now })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "CLOSED", actor: configure, now })).rejects.toMatchObject({ code: "UNKNOWN_TRANSITION" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "ARCHIVED", actor: configure, now })).rejects.toMatchObject({ code: "UNKNOWN_TRANSITION" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "IN_PROGRESS", actor: configure, now })).rejects.toMatchObject({ code: "CONDITION_UNMET" });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "COMPLETE", actor: configure, now })).rejects.toMatchObject({ code: "CONDITION_UNMET" });
    expect(tx.event.updateMany).not.toHaveBeenCalled();
  });

  it("judges start and end by the event's own time zone", async () => {
    // 2027-10-08 03:00 UTC is still 2027-10-07 in Chicago, so the first day has not been reached there.
    mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "IN_PROGRESS", actor: configure, now: new Date("2027-10-08T03:00:00.000Z") })).rejects.toMatchObject({ code: "CONDITION_UNMET" });
    mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "IN_PROGRESS", actor: configure, now: new Date("2027-10-08T06:00:00.000Z") })).resolves.toMatchObject({ changed: true });
  });

  it("refuses an incomplete publish checklist with EVENT_NOT_READY and records nothing", async () => {
    const { tx } = mockPrisma(row(), { forms: 0 });
    const error = await transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: "DRAFT", actor: configure, now }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EventOperationError);
    expect(error).toMatchObject({ code: "EVENT_NOT_READY", message: expect.stringContaining("published registration form") });
    expect(tx.event.updateMany).not.toHaveBeenCalled();
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
  });

  it("takes no transition on an archived event, and reports a missing one", async () => {
    mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true, archivedAt: new Date("2027-06-01T00:00:00.000Z") }));
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "REGISTRATION_CLOSED", actor: configure, now })).rejects.toMatchObject({ code: "ARCHIVED" });
    mockPrisma(null);
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "TEST", actor: configure, now })).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  });

  it("refuses a reason over 500 characters before touching the database", async () => {
    mockPrisma(row());
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "TEST", actor: configure, reason: "x".repeat(501), now })).rejects.toMatchObject({ code: "REASON_TOO_LONG" });
    expect(dependencies.getPrisma).not.toHaveBeenCalled();
  });
});

describe("the long-standing publish and unpublish actions (legacy mode)", () => {
  const legacy = (alreadyDone: (state: string) => boolean) => ({ alreadyDone: alreadyDone as never });
  const isPublic = (state: string) => !["DRAFT", "TEST", "ARCHIVED"].includes(state);

  it("still publishes an archived draft, as before: archive never blocked it", async () => {
    const { tx } = mockPrisma(row({ archivedAt: new Date("2027-06-01T00:00:00.000Z") }));
    const result = await transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", actor: configure, legacy: legacy(isPublic), now });
    expect(result).toMatchObject({ changed: true, fromState: "DRAFT", toState: "PUBLISHED" });
    expect(tx.event.updateMany).toHaveBeenCalled();
  });

  it("treats any public state as already published, writing nothing", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "REGISTRATION_CLOSED", isPublished: true }));
    const result = await transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", actor: configure, legacy: legacy(isPublic), now });
    expect(result.changed).toBe(false);
    expect(tx.eventLifecycleTransition.create).not.toHaveBeenCalled();
  });

  it("treats someone else getting there first as done, not as an error", async () => {
    const { tx } = mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }), { changedRows: 0 });
    const result = await transitionEventLifecycle({ eventId: "event-1", toState: "DRAFT", actor: configure, legacy: legacy((state) => !isPublic(state)), now });
    expect(result.changed).toBe(false);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses to unpublish an event that is complete, in reconciliation or closed", async () => {
    for (const state of ["COMPLETE", "FINANCIAL_RECONCILIATION", "CLOSED"]) {
      mockPrisma(row({ lifecycleState: state, isPublished: true }));
      await expect(transitionEventLifecycle({ eventId: "event-1", toState: "DRAFT", actor: configure, legacy: legacy((current) => !isPublic(current)), now })).rejects.toMatchObject({ code: "UNKNOWN_TRANSITION" });
    }
  });
});

describe("getEventLifecycle", () => {
  it("returns the effective state, the moves this actor may make, and the history", async () => {
    mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    const result = await getEventLifecycle({ eventId: "event-1", permissions: ["CONFIGURE_EVENT"], now });
    expect(result).toMatchObject({ state: "PUBLISHED", stateLabel: "Published", isPublic: true });
    expect(result?.allowedNext.map((next) => next.state)).toEqual(["DRAFT", "REGISTRATION_CLOSED"]);
    expect(result?.history).toEqual([]);
  });

  it("returns no history to a member who cannot change the state", async () => {
    const mocked = mockPrisma(row({ lifecycleState: "PUBLISHED", isPublished: true }));
    void mocked;
    const prisma = dependencies.getPrisma();
    prisma.eventLifecycleTransition.findMany.mockResolvedValue([{ id: "h1", fromState: "DRAFT", toState: "PUBLISHED", actorUserId: "usr_9", reason: "private", createdAt: new Date("2027-01-01T00:00:00.000Z") }]);
    expect((await getEventLifecycle({ eventId: "event-1", permissions: ["VIEW_EVENT"], now }))?.history).toEqual([]);
    expect((await getEventLifecycle({ eventId: "event-1", permissions: ["CONFIGURE_EVENT"], now }))?.history).toHaveLength(1);
    expect((await getEventLifecycle({ eventId: "event-1", permissions: ["MANAGE_FINANCE"], now }))?.history).toHaveLength(1);
  });

  it("offers nothing on an archived event", async () => {
    mockPrisma(row({ archivedAt: new Date("2027-06-01T00:00:00.000Z"), isPublished: true }));
    const result = await getEventLifecycle({ eventId: "event-1", permissions: ["CONFIGURE_EVENT"], now });
    expect(result).toMatchObject({ state: "ARCHIVED", allowedNext: [] });
  });
});
