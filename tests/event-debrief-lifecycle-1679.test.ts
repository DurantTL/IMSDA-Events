import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: audit }));

import {
  afterCreationModules,
  cancelDebriefBatches,
  copyDebriefSetup,
  createDebriefBatches,
  ensureDebriefForm,
  onDebriefDisabled,
  onDebriefEnabled,
  reprojectDebriefBatches,
} from "@/modules/event-debriefs/lifecycle";
import { debriefBatchId } from "@/modules/event-debriefs/domain";

type Row = Record<string, unknown>;

/** A small in-memory stand-in for the parts of a transaction the Debrief uses. Synthetic data only. */
function fakeTx(options: { endsAt?: Date; timezone?: string; evaluationEnabled?: boolean; carriedFrom?: string | null } = {}) {
  const batches = new Map<string, Row>();
  const forms: Row[] = [];
  const debriefs = new Map<string, Row>();
  const modules: Row[] = [];
  const outbox: Row[] = [];
  const event = { id: "event-1", name: "Sample Spring Camporee", timezone: options.timezone ?? "America/Chicago", endsAt: options.endsAt ?? new Date("2027-03-13T22:00:00.000Z") };
  if (options.evaluationEnabled !== undefined || options.carriedFrom) {
    debriefs.set("event-1", { eventId: "event-1", evaluationEnabled: options.evaluationEnabled ?? false, carriedFromEventId: options.carriedFrom ?? null });
  }
  const tx = {
    event: { findUnique: vi.fn(async () => ({ ...event, debrief: debriefs.has("event-1") ? { carriedFromEventId: debriefs.get("event-1")!.carriedFromEventId } : null })) },
    eventMembership: { findFirst: vi.fn(async () => ({ userId: "user-admin" })) },
    user: { findFirst: vi.fn(async () => ({ id: "user-sysadmin" })) },
    eventDebrief: {
      upsert: vi.fn(async ({ where, create }: { where: { eventId: string }; create: Row }) => {
        if (!debriefs.has(where.eventId)) debriefs.set(where.eventId, { evaluationEnabled: false, carriedFromEventId: null, ...create });
        else if (create.carriedFromEventId !== undefined && debriefs.get(where.eventId)!.carriedFromEventId === null) debriefs.get(where.eventId)!.carriedFromEventId = create.carriedFromEventId;
        return debriefs.get(where.eventId);
      }),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) => debriefs.get(where.eventId) ?? null),
    },
    eventModule: { findUnique: vi.fn(async () => (modules.length ? modules[0] : null)) },
    informationForm: {
      findFirst: vi.fn(async ({ where }: { where: { eventId: string; purpose?: unknown } }) => forms.find((form) => form.eventId === where.eventId && (where.purpose === undefined || (typeof where.purpose === "object" ? form.purpose !== null : form.purpose === where.purpose))) ?? null),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `form-${forms.length + 1}`, ...data }; forms.push(row); return row; }),
    },
    informationFormVersion: { findFirst: vi.fn(async () => null) },
    scheduledEmailBatch: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => batches.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; status: { in: string[] }; claimToken: null } }) => [...batches.values()].filter((row) => where.id.in.includes(row.id as string) && where.status.in.includes(row.status as string) && row.claimToken === null)),
      create: vi.fn(async ({ data }: { data: Row }) => { batches.set(data.id as string, { claimToken: null, ...data }); return data; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { Object.assign(batches.get(where.id)!, data); return batches.get(where.id); }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } | string; status?: { in: string[] }; sendAt?: unknown; OR?: unknown }; data: Row }) => {
        const ids = typeof where.id === "string" ? [where.id] : where.id.in;
        let count = 0;
        for (const id of ids) {
          const row = batches.get(id);
          if (!row) continue;
          if (where.status && !where.status.in.includes(row.status as string)) continue;
          if (where.OR) {
            const sendAtDiffers = (row.sendAt as Date).getTime() !== ((where.OR as Array<{ sendAt?: { not: Date } }>)[0]!.sendAt!.not).getTime();
            if (!sendAtDiffers) continue;
          }
          const next: Row = { ...data };
          if (next.revision) delete next.revision;
          Object.assign(row, next);
          count += 1;
        }
        return { count };
      }),
    },
    messageOutbox: { updateMany: vi.fn(async (args: Row) => { outbox.push(args); return { count: 0 }; }) },
  };
  return { tx: tx as never, raw: tx, batches, forms, debriefs, modules, outbox };
}

const now = new Date("2027-03-01T15:00:00.000Z");
const staff = { kind: "staff" as const, userId: "user-1" };
const coordinator = { kind: "area-coordinator" as const, accountId: "acct-ac" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  audit.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("switching the Debrief on (#1679)", () => {
  it("makes the debrief form with the starter questions: signed-in only, open, marked with its purpose", async () => {
    const { tx, forms } = fakeTx();
    await ensureDebriefForm(tx, { eventId: "event-1", purpose: "DEBRIEF", actor: staff });
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({ scope: "EVENT", eventId: "event-1", purpose: "DEBRIEF", fillAccess: "SIGNED_IN", status: "OPEN", slug: "debrief", createdByUserId: "user-1" });
    const definition = (forms[0]!.versions as { create: { definition: { sections: Array<{ fields: Array<{ label: string }> }> }; status: string } }).create;
    expect(definition.status).toBe("PUBLISHED");
    expect(definition.definition.sections[0]!.fields.map((field) => field.label)).toEqual(["What went well?", "What should we do better?", "Ideas for next year?"]);
  });

  it("does not make a second form when one exists", async () => {
    const { tx, forms } = fakeTx();
    await ensureDebriefForm(tx, { eventId: "event-1", purpose: "DEBRIEF", actor: staff });
    await ensureDebriefForm(tx, { eventId: "event-1", purpose: "DEBRIEF", actor: staff });
    expect(forms).toHaveLength(1);
  });

  it("records an Area Coordinator's form as made by the event's first administrator, since the coordinator is not a staff user", async () => {
    const { tx, forms } = fakeTx();
    await ensureDebriefForm(tx, { eventId: "event-1", purpose: "DEBRIEF", actor: coordinator });
    expect(forms[0]!.createdByUserId).toBe("user-admin");
  });

  it("creates the invitation and the reminder as approved scheduled emails at 8:00 local the day after, and three days later", async () => {
    const { tx, batches } = fakeTx();
    const result = await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    expect(result.created).toEqual(["INVITE", "REMINDER"]);
    const invite = batches.get(debriefBatchId("event-1", "INVITE"))!;
    const reminder = batches.get(debriefBatchId("event-1", "REMINDER"))!;
    expect(invite).toMatchObject({ status: "ACTIVE", trigger: "AFTER_EVENT_END", templateKey: "EVENT_DEBRIEF_INVITE", localTime: "08:00", daysBefore: 1, createdByUserId: "user-1", activatedByUserId: "user-1" });
    expect((invite.sendAt as Date).toISOString()).toBe("2027-03-14T13:00:00.000Z");
    expect(reminder).toMatchObject({ templateKey: "EVENT_DEBRIEF_REMINDER", daysBefore: 4 });
    expect((reminder.sendAt as Date).toISOString()).toBe("2027-03-17T13:00:00.000Z");
  });

  it("records an Area Coordinator as the creator by account, with no staff user", async () => {
    const { tx, batches } = fakeTx();
    await createDebriefBatches(tx, { eventId: "event-1", actor: coordinator, now });
    const invite = batches.get(debriefBatchId("event-1", "INVITE"))!;
    expect(invite.createdByAttendeeAccountId).toBe("acct-ac");
    expect(invite.createdByUserId).toBeUndefined();
  });

  it("is safe to switch on twice: the same two batches, nothing doubled", async () => {
    const { tx, batches } = fakeTx();
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    expect(batches.size).toBe(2);
  });

  it("never touches a batch that has been sent or is being sent", async () => {
    const { tx, batches } = fakeTx();
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    const invite = batches.get(debriefBatchId("event-1", "INVITE"))!;
    invite.status = "COMPLETED";
    await onDebriefDisabled(tx, { eventId: "event-1", actor: staff, now });
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    expect(invite.status).toBe("COMPLETED");
  });

  it("does not schedule a send whose time has already passed", async () => {
    const { tx, batches } = fakeTx({ endsAt: new Date("2027-02-20T22:00:00.000Z") });
    const result = await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    expect(result.skipped).toEqual(["INVITE", "REMINDER"]);
    expect(batches.size).toBe(0);
    // Only the reminder is still ahead.
    const { tx: tx2, batches: batches2 } = fakeTx({ endsAt: new Date("2027-02-28T22:00:00.000Z") });
    const second = await createDebriefBatches(tx2, { eventId: "event-1", actor: staff, now: new Date("2027-03-01T16:00:00.000Z") });
    expect(second).toEqual({ created: ["REMINDER"], skipped: ["INVITE"] });
    expect([...batches2.keys()]).toEqual([debriefBatchId("event-1", "REMINDER")]);
  });

  it("makes the evaluation form too when its switch is already on, and writes an audit entry", async () => {
    const { tx, forms } = fakeTx({ evaluationEnabled: true });
    await onDebriefEnabled(tx, { eventId: "event-1", actor: staff, now });
    expect(forms.map((form) => form.purpose)).toEqual(["DEBRIEF", "DIRECTOR_EVALUATION"]);
    expect(audit.mock.calls.map(([entry]) => entry.action)).toContain("EVENT_DEBRIEF_SCHEDULED");
  });

  it("is available for an event created with the Debrief chosen on the features step, and only then", async () => {
    const chosen = fakeTx();
    await afterCreationModules(chosen.tx, { eventId: "event-1", moduleKeys: ["public-content", "debrief"], actorUserId: "user-1" });
    expect(chosen.batches.size).toBe(2);
    const notChosen = fakeTx();
    await afterCreationModules(notChosen.tx, { eventId: "event-1", moduleKeys: ["public-content"], actorUserId: "user-1" });
    expect(notChosen.batches.size).toBe(0);
    expect(notChosen.forms).toHaveLength(0);
  });
});

describe("switching the Debrief off (#1679)", () => {
  it("cancels the unsent batches and keeps the forms", async () => {
    const { tx, batches, forms } = fakeTx();
    await onDebriefEnabled(tx, { eventId: "event-1", actor: staff, now });
    const cancelled = await onDebriefDisabled(tx, { eventId: "event-1", actor: staff, now });
    expect(cancelled).toBe(2);
    expect([...batches.values()].map((row) => row.status)).toEqual(["CANCELLED", "CANCELLED"]);
    expect(forms).toHaveLength(1);
  });

  it("stops the messages still waiting in the queue for those batches", async () => {
    const { tx, raw } = fakeTx();
    await onDebriefEnabled(tx, { eventId: "event-1", actor: staff, now });
    await cancelDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    const call = raw.messageOutbox.updateMany.mock.calls[0]![0] as { where: { status: string }; data: { status: string } };
    expect(call.where.status).toBe("PENDING");
    expect(call.data.status).toBe("CANCELLED");
  });

  it("gives a stopped, unsent batch its time again when switched back on", async () => {
    const { tx, batches } = fakeTx();
    await onDebriefEnabled(tx, { eventId: "event-1", actor: staff, now });
    await onDebriefDisabled(tx, { eventId: "event-1", actor: staff, now });
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    expect([...batches.values()].map((row) => row.status)).toEqual(["ACTIVE", "ACTIVE"]);
  });
});

describe("when the event's dates change (#1679)", () => {
  it("moves the unsent batches to the new end date", async () => {
    const { tx, batches, raw } = fakeTx();
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    raw.event.findUnique.mockResolvedValue({ id: "event-1", name: "Sample", timezone: "America/Chicago", endsAt: new Date("2027-03-20T22:00:00.000Z"), debrief: null } as never);
    const moved = await reprojectDebriefBatches(tx, "event-1");
    expect(moved).toBe(2);
    expect((batches.get(debriefBatchId("event-1", "INVITE"))!.sendAt as Date).toISOString()).toBe("2027-03-21T13:00:00.000Z");
  });

  it("leaves a batch that is being sent alone", async () => {
    const { tx, batches } = fakeTx();
    await createDebriefBatches(tx, { eventId: "event-1", actor: staff, now });
    batches.get(debriefBatchId("event-1", "INVITE"))!.claimToken = "claimed";
    const moved = await reprojectDebriefBatches(tx, "event-1");
    expect(moved).toBe(0);
  });
});

describe("copying the event for next year (#1679)", () => {
  it("remembers the source so the copy shows last year's answers, and keeps the evaluation switch as it was", async () => {
    const { tx, debriefs, raw } = fakeTx();
    raw.eventDebrief.findUnique.mockImplementation((async ({ where }: { where: { eventId: string } }) => (where.eventId === "event-old" ? { evaluationEnabled: true } : debriefs.get(where.eventId) ?? null)) as never);
    const carried = await copyDebriefSetup(tx, { sourceEventId: "event-old", targetEventId: "event-1", actorUserId: "user-1", now });
    expect(carried).toBe(true);
    expect(debriefs.get("event-1")).toMatchObject({ carriedFromEventId: "event-old", evaluationEnabled: true });
  });

  it("carries nothing from an event that never had a debrief", async () => {
    const { tx, debriefs } = fakeTx();
    expect(await copyDebriefSetup(tx, { sourceEventId: "event-old", targetEventId: "event-1", actorUserId: "user-1", now })).toBe(false);
    expect(debriefs.size).toBe(0);
  });

  it("gives the copy its own form and schedule only when its module row is on", async () => {
    const off = fakeTx();
    off.raw.eventDebrief.findUnique.mockImplementation((async ({ where }: { where: { eventId: string } }) => (where.eventId === "event-old" ? { evaluationEnabled: false } : off.debriefs.get(where.eventId) ?? null)) as never);
    await copyDebriefSetup(off.tx, { sourceEventId: "event-old", targetEventId: "event-1", actorUserId: "user-1", now });
    expect(off.batches.size).toBe(0);
    expect(off.forms).toHaveLength(0);

    const on = fakeTx();
    on.modules.push({ moduleKey: "debrief" });
    on.raw.eventDebrief.findUnique.mockImplementation((async ({ where }: { where: { eventId: string } }) => (where.eventId === "event-old" ? { evaluationEnabled: false } : on.debriefs.get(where.eventId) ?? null)) as never);
    await copyDebriefSetup(on.tx, { sourceEventId: "event-old", targetEventId: "event-1", actorUserId: "user-1", now });
    expect(on.batches.size).toBe(2);
    expect(on.forms).toHaveLength(1);
  });

  it("builds the copy's questions from the source's published ones, so staff's edits carry forward", async () => {
    const { tx, forms, raw } = fakeTx({ carriedFrom: "event-old" });
    raw.informationFormVersion.findFirst.mockResolvedValue({
      definition: { title: "Old", description: "", confirmationMessage: "Thanks.", sections: [{ id: "section_q", title: "Questions", description: "", fields: [{ id: "field_line", key: "line", label: "How was the check-in line?", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] }] }] },
    } as never);
    await ensureDebriefForm(tx, { eventId: "event-1", purpose: "DEBRIEF", actor: staff });
    const created = (forms[0]!.versions as { create: { definition: { sections: Array<{ fields: Array<{ label: string }> }> } } }).create.definition;
    expect(created.sections[0]!.fields[0]!.label).toBe("How was the check-in line?");
  });
});
