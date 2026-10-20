import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  checkInBlocksForAttendees: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/background-checks/repository", () => ({
  checkInBlocksForAttendees: dependencies.checkInBlocksForAttendees,
}));

import { checkInRequestSchema } from "@/modules/checkin/domain";
import { CheckInOperationError, checkInAttendee } from "@/modules/checkin/repository";

const idempotencyKey = "d67776d0-f79d-4e8f-bec2-ee61abb7337c";

function fixture(options: { alreadyCheckedIn?: boolean; replay?: boolean } = {}) {
  const created = {
    id: "checkin_1",
    eventId: "event_1",
    registrationAttendeeId: "attendee_1",
    idempotencyKey,
    checkedInAt: new Date("2026-10-23T14:00:00.000Z"),
    undoneAt: null,
  };
  const tx = {
    checkIn: {
      findUnique: vi.fn().mockResolvedValue(options.replay ? created : null),
      create: vi.fn().mockResolvedValue(created),
    },
    registrationAttendee: {
      findFirst: vi.fn().mockResolvedValue({
        id: "attendee_1",
        registration: { status: "CONFIRMED" },
        checkIns: options.alreadyCheckedIn ? [created] : [],
      }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit_1" }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  dependencies.getPrisma.mockReturnValue({
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  });
  return { tx };
}

function blocked(state: "MISSING" | "EXPIRED" | "NOT_COMPLIANT" = "MISSING") {
  dependencies.checkInBlocksForAttendees.mockResolvedValue(new Map([["attendee_1", state]]));
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.checkInBlocksForAttendees.mockResolvedValue(new Map());
});

describe("Sterling Volunteers check-in gate (#874)", () => {
  it("checks in someone who is current (or not held) exactly as before, with one audit entry", async () => {
    const { tx } = fixture();
    const result = await checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey);
    expect(result.disposition).toBe("CREATED");
    expect(tx.checkIn.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(dependencies.checkInBlocksForAttendees).toHaveBeenCalledWith("event_1", ["attendee_1"]);
  });

  it.each(["MISSING", "EXPIRED", "NOT_COMPLIANT"] as const)("refuses a %s adult or staff member without an override, and records nothing", async (state) => {
    const { tx } = fixture();
    blocked(state);
    await expect(checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey)).rejects.toMatchObject({
      name: "CheckInOperationError",
      code: "STERLING_CHECK_NEEDED",
      message: "Sterling Volunteers check needed before check-in.",
    });
    expect(tx.checkIn.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("treats a blank reason as no reason", async () => {
    const { tx } = fixture();
    blocked();
    await expect(checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey, { sterlingOverrideReason: "   " }))
      .rejects.toBeInstanceOf(CheckInOperationError);
    expect(tx.checkIn.create).not.toHaveBeenCalled();
  });

  it("checks in with a typed reason and audits the override with ids, the state and that reason only", async () => {
    const { tx } = fixture();
    blocked("EXPIRED");
    const result = await checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey, {
      sterlingOverrideReason: "  verified current in Sterling portal ",
    });
    expect(result).toMatchObject({ disposition: "CREATED", checkedIn: true });
    expect(tx.checkIn.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    const actions = tx.auditLog.create.mock.calls.map(([call]) => call.data.action);
    expect(actions).toEqual(["ATTENDEE_CHECKED_IN", "STERLING_CHECK_IN_OVERRIDDEN"]);
    const override = tx.auditLog.create.mock.calls[1]![0].data;
    expect(override).toMatchObject({
      eventId: "event_1",
      actorUserId: "staff_1",
      entityType: "RegistrationAttendee",
      entityId: "attendee_1",
      metadata: { checkInId: "checkin_1", sterlingState: "EXPIRED", reason: "verified current in Sterling portal" },
    });
    expect(Object.keys(override.metadata).sort()).toEqual(["checkInId", "reason", "sterlingState"]);
  });

  it("writes no override entry when a reason is sent for someone who isn't held", async () => {
    const { tx } = fixture();
    await checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey, { sterlingOverrideReason: "just in case" });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("never re-gates an already-checked-in attendee or a saved retry that already succeeded", async () => {
    fixture({ alreadyCheckedIn: true });
    blocked();
    await expect(checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey)).resolves.toMatchObject({ disposition: "ALREADY_CHECKED_IN" });
    fixture({ replay: true });
    await expect(checkInAttendee("event_1", "attendee_1", "staff_1", idempotencyKey)).resolves.toMatchObject({ disposition: "IDEMPOTENT_REPLAY" });
    expect(dependencies.checkInBlocksForAttendees).not.toHaveBeenCalled();
  });

  it("bulk check-in runs through the same single check-in, so each held person is refused by the server and the rest go through", async () => {
    // checkInSequentially (bulk-check-in.ts) calls the single check-in once per attendee.
    const { tx } = fixture();
    dependencies.checkInBlocksForAttendees.mockImplementation(async (_event: string, ids: string[]) => (
      new Map(ids.filter((id) => id === "attendee_1").map((id) => [id, "MISSING" as const]))
    ));
    tx.registrationAttendee.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      registration: { status: "CONFIRMED" },
      checkIns: [],
    }));
    const outcomes = [];
    for (const id of ["attendee_1", "attendee_2"]) {
      outcomes.push(await checkInAttendee("event_1", id, "staff_1", `${idempotencyKey.slice(0, -1)}${id.slice(-1)}`).then(() => "ok", (error: CheckInOperationError) => error.code));
    }
    expect(outcomes).toEqual(["STERLING_CHECK_NEEDED", "ok"]);
  });

  it("validates the typed reason in the request body", () => {
    expect(checkInRequestSchema.safeParse({ idempotencyKey }).success).toBe(true);
    expect(checkInRequestSchema.safeParse({ idempotencyKey, sterlingOverrideReason: "verified current in Sterling portal" }).success).toBe(true);
    expect(checkInRequestSchema.safeParse({ idempotencyKey, sterlingOverrideReason: "ab" }).success).toBe(false);
    expect(checkInRequestSchema.safeParse({ idempotencyKey, sterlingOverrideReason: "x".repeat(301) }).success).toBe(false);
  });
});
