import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SesFeedback } from "@/integrations/email/ses-sns";
import { suppressAddress } from "@/modules/communications/email-suppression";
import {
  mapProviderDeliveryEvent,
  mapSesDeliveryEvent,
  mayAdvanceProviderStatus,
  providerAdvanceCondition,
  strongestTransition,
} from "@/modules/communications/provider-events";
import { recordSesFeedbackEvent } from "@/modules/communications/ses-event-repository";

type Outbox = { id: string; provider: string | null; providerMessageId: string | null; providerDeliveryStatus: string | null; status: string; lastError: string | null; [key: string]: unknown };
type Suppression = { id: string; normalizedEmail: string; reason: string; reenabledAt: Date | null; reenabledByUserId: string | null; suppressedAt: Date; [key: string]: unknown };

/** An in-memory stand-in for the few tables the repository touches, with the unique index on (provider, providerEventId). */
function createFake(initial: { outbox?: Outbox[]; suppressions?: Suppression[] } = {}) {
  const outbox = initial.outbox ?? [];
  const events: Array<Record<string, unknown>> = [];
  const suppressions = initial.suppressions ?? [];
  const audits: Array<Record<string, unknown>> = [];
  const clubLinkRetirements: string[] = [];
  let sequence = 0;
  const tx = {
    messageProviderEvent: {
      findUnique: async ({ where }: { where: { provider_providerEventId: { provider: string; providerEventId: string } } }) =>
        events.find((event) => event.provider === where.provider_providerEventId.provider && event.providerEventId === where.provider_providerEventId.providerEventId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push({ ...data });
        return data;
      },
    },
    messageOutbox: {
      findFirst: async ({ where }: { where: { provider: string; providerMessageId: string } }) =>
        outbox.find((row) => row.provider === where.provider && row.providerMessageId === where.providerMessageId) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; OR: Array<{ providerDeliveryStatus: null | { in: string[] } }> }; data: Record<string, unknown> }) => {
        const row = outbox.find((candidate) => candidate.id === where.id);
        if (!row) return { count: 0 };
        const allowed = where.OR.some((clause) => clause.providerDeliveryStatus === null
          ? row.providerDeliveryStatus === null
          : row.providerDeliveryStatus !== null && clause.providerDeliveryStatus.in.includes(row.providerDeliveryStatus));
        if (!allowed) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    clubFormLink: {
      updateMany: async ({ where }: { where: { messageId: string } }) => {
        clubLinkRetirements.push(where.messageId);
        return { count: 1 };
      },
    },
    emailAddressSuppression: {
      findUnique: async ({ where }: { where: { normalizedEmail: string } }) => suppressions.find((row) => row.normalizedEmail === where.normalizedEmail) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sup_${++sequence}`, reenabledAt: null, reenabledByUserId: null, ...data } as Suppression;
        suppressions.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = suppressions.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; } },
  };
  const client = {
    $transaction: async <T,>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
    messageProviderEvent: tx.messageProviderEvent,
  };
  return { client: client as never, tx, outbox, events, suppressions, audits, clubLinkRetirements };
}

const SES_ID = "0100synthetic-ses-message-id-000001";
const message = (overrides: Partial<Outbox> = {}): Outbox => ({
  id: "msg_1", provider: "SES", providerMessageId: SES_ID, providerDeliveryStatus: "ACCEPTED", status: "SENT", lastError: null, ...overrides,
});

function feedback(kind: SesFeedback["kind"], overrides: Partial<SesFeedback> = {}): SesFeedback {
  const eventType = {
    DELIVERY: "ses.delivery", HARD_BOUNCE: "ses.bounce.permanent", SOFT_BOUNCE: "ses.bounce.transient", COMPLAINT: "ses.complaint",
  }[kind] as SesFeedback["eventType"];
  return {
    kind,
    eventType,
    providerMessageId: SES_ID,
    occurredAt: new Date("2026-10-23T12:00:00Z"),
    suppressRecipients: kind === "HARD_BOUNCE" || kind === "COMPLAINT" ? ["bounced.person@example.test"] : [],
    details: { recipientCount: 1 },
    ...overrides,
  };
}

describe("recording SES events (#863)", () => {
  it("moves ACCEPTED to DELIVERED on a delivery event", async () => {
    const fake = createFake({ outbox: [message()] });
    const result = await recordSesFeedbackEvent("sns-1", feedback("DELIVERY"), fake.client);
    expect(result).toMatchObject({ duplicate: false, matchedMessageId: "msg_1", mappedStatus: "DELIVERED", suppressedCount: 0 });
    expect(fake.outbox[0]).toMatchObject({ providerDeliveryStatus: "DELIVERED", status: "SENT" });
    expect(fake.suppressions).toHaveLength(0);
  });

  it("is replay-safe: the same SNS MessageId changes nothing the second time", async () => {
    const fake = createFake({ outbox: [message()] });
    await recordSesFeedbackEvent("sns-1", feedback("HARD_BOUNCE"), fake.client);
    const audited = fake.audits.length;
    const again = await recordSesFeedbackEvent("sns-1", feedback("HARD_BOUNCE"), fake.client);
    expect(again.duplicate).toBe(true);
    expect(fake.events).toHaveLength(1);
    expect(fake.suppressions).toHaveLength(1);
    expect(fake.audits).toHaveLength(audited);
  });

  it("never rolls a terminal state backward: a late or duplicate delivery after a bounce changes nothing", async () => {
    const fake = createFake({ outbox: [message()] });
    await recordSesFeedbackEvent("sns-bounce", feedback("HARD_BOUNCE", { occurredAt: new Date("2026-10-23T12:00:00Z") }), fake.client);
    expect(fake.outbox[0]).toMatchObject({ providerDeliveryStatus: "BOUNCED", status: "FAILED" });
    // A later timestamp, a different SNS id: still no change.
    await recordSesFeedbackEvent("sns-late-delivery", feedback("DELIVERY", { occurredAt: new Date("2026-10-23T12:30:00Z") }), fake.client);
    await recordSesFeedbackEvent("sns-complaint", feedback("COMPLAINT", { occurredAt: new Date("2026-10-23T12:40:00Z") }), fake.client);
    expect(fake.outbox[0]).toMatchObject({ providerDeliveryStatus: "BOUNCED", status: "FAILED" });
    expect(fake.events).toHaveLength(3);
  });

  it("handles a bounce that arrives before the delivery it contradicts, and a complaint after delivery", async () => {
    const early = createFake({ outbox: [message()] });
    await recordSesFeedbackEvent("a", feedback("DELIVERY"), early.client);
    await recordSesFeedbackEvent("b", feedback("COMPLAINT", { occurredAt: new Date("2026-10-23T13:00:00Z") }), early.client);
    expect(early.outbox[0]).toMatchObject({ providerDeliveryStatus: "COMPLAINED", status: "SENT" });
    // Out of order: the delivery arrives after the complaint and is ignored.
    await recordSesFeedbackEvent("c", feedback("DELIVERY", { occurredAt: new Date("2026-10-23T13:30:00Z") }), early.client);
    expect(early.outbox[0]).toMatchObject({ providerDeliveryStatus: "COMPLAINED" });
  });

  it("records a soft bounce and changes neither the message nor any address", async () => {
    const fake = createFake({ outbox: [message()] });
    const result = await recordSesFeedbackEvent("soft", feedback("SOFT_BOUNCE"), fake.client);
    expect(result).toMatchObject({ mappedStatus: null, suppressedCount: 0 });
    expect(fake.events[0]).toMatchObject({ eventType: "ses.bounce.transient", mappedDeliveryStatus: null });
    expect(fake.outbox[0]).toMatchObject({ providerDeliveryStatus: "ACCEPTED", status: "SENT" });
    expect(fake.suppressions).toHaveLength(0);
  });

  it("matches only an SES message with exactly that id: an unknown id attaches to nothing", async () => {
    const resendRow = message({ id: "resend_row", provider: "RESEND" });
    const otherRow = message({ id: "other_row", providerMessageId: "some-other-id" });
    const fake = createFake({ outbox: [resendRow, otherRow] });
    const result = await recordSesFeedbackEvent("unknown", feedback("DELIVERY"), fake.client);
    expect(result).toMatchObject({ matchedMessageId: null, mappedStatus: "DELIVERED" });
    expect(fake.events[0]).toMatchObject({ messageOutboxId: null, provider: "SES", providerMessageId: SES_ID });
    expect(fake.outbox.every((row) => row.providerDeliveryStatus === "ACCEPTED")).toBe(true);
  });

  it("suppresses a hard-bounced address even when the message id matches nothing", async () => {
    const fake = createFake();
    const result = await recordSesFeedbackEvent("hb", feedback("HARD_BOUNCE"), fake.client);
    expect(result).toMatchObject({ matchedMessageId: null, suppressedCount: 1 });
    expect(fake.suppressions[0]).toMatchObject({ normalizedEmail: "bounced.person@example.test", reason: "BOUNCE", reenabledAt: null, sourceMessageOutboxId: null });
  });

  it("withdraws a club form link only when a hard bounce really applied", async () => {
    const fake = createFake({ outbox: [message()] });
    await recordSesFeedbackEvent("hb", feedback("HARD_BOUNCE"), fake.client);
    await recordSesFeedbackEvent("hb2", feedback("HARD_BOUNCE"), fake.client);
    expect(fake.clubLinkRetirements).toEqual(["msg_1"]);
    const complained = createFake({ outbox: [message()] });
    await recordSesFeedbackEvent("c", feedback("COMPLAINT"), complained.client);
    expect(complained.clubLinkRetirements).toEqual([]);
  });

  it("stores ids and counts only: no address in the event payload or any audit entry", async () => {
    const fake = createFake({ outbox: [message()] });
    await recordSesFeedbackEvent("hb", feedback("HARD_BOUNCE", { details: { bounceType: "Permanent", bounceSubType: "General", recipientCount: 1 } }), fake.client);
    const stored = JSON.stringify([fake.events, fake.audits]);
    expect(stored).not.toContain("example.test");
    expect(stored).not.toContain("@");
    expect(fake.audits[0]).toMatchObject({ action: "EMAIL_ADDRESS_SUPPRESSED", entityType: "EmailAddressSuppression" });
  });

  it("answers a unique-index race on the SNS id as a duplicate, and rethrows a storage failure", async () => {
    const { Prisma } = await import("@prisma/client");
    const fake = createFake();
    const client = {
      messageProviderEvent: { findUnique: vi.fn().mockResolvedValueOnce({ messageOutboxId: "msg_1", mappedDeliveryStatus: "DELIVERED" }) },
      $transaction: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" })),
    };
    await expect(recordSesFeedbackEvent("race", feedback("DELIVERY"), client as never)).resolves.toMatchObject({ duplicate: true, mappedStatus: "DELIVERED" });
    const failing = { messageProviderEvent: fake.tx.messageProviderEvent, $transaction: vi.fn().mockRejectedValue(new Error("connection lost")) };
    await expect(recordSesFeedbackEvent("down", feedback("DELIVERY"), failing as never)).rejects.toThrow("connection lost");
  });
});

describe("suppressing an address (#863)", () => {
  const input = (overrides: Partial<Parameters<typeof suppressAddress>[1]> = {}) => ({
    normalizedEmail: "Person@Example.test ",
    reason: "BOUNCE" as const,
    provider: "SES",
    occurredAt: new Date("2026-10-23T12:00:00Z"),
    sourceProviderEventId: "sns-1",
    sourceMessageOutboxId: null,
    ...overrides,
  });

  it("keeps one row per normalized address, and a complaint outranks a bounce", async () => {
    const fake = createFake();
    const tx = { ...(fake.client as unknown as { $transaction: (work: (tx: never) => Promise<unknown>) => Promise<unknown> }) };
    let captured!: never;
    await tx.$transaction(async (transaction) => { captured = transaction; return null; });
    expect((await suppressAddress(captured, input())).changed).toBe(true);
    expect((await suppressAddress(captured, input({ sourceProviderEventId: "sns-2" }))).changed).toBe(false);
    expect((await suppressAddress(captured, input({ reason: "COMPLAINT", sourceProviderEventId: "sns-3" }))).changed).toBe(true);
    expect(fake.suppressions).toHaveLength(1);
    expect(fake.suppressions[0]).toMatchObject({ normalizedEmail: "person@example.test", reason: "COMPLAINT" });
  });

  it("lets an event after a re-enable suppress again, and never one from before it", async () => {
    const reenabledAt = new Date("2026-10-24T09:00:00Z");
    const fake = createFake({
      suppressions: [{ id: "sup_1", normalizedEmail: "person@example.test", reason: "BOUNCE", suppressedAt: new Date("2026-10-23T12:00:00Z"), reenabledAt, reenabledByUserId: "admin_1" }],
    });
    let captured!: never;
    await (fake.client as unknown as { $transaction: (work: (tx: never) => Promise<unknown>) => Promise<unknown> }).$transaction(async (transaction) => { captured = transaction; return null; });
    // A replayed or late notification from before the re-enable cannot undo it.
    expect((await suppressAddress(captured, input({ occurredAt: new Date("2026-10-23T12:30:00Z") }))).changed).toBe(false);
    expect(fake.suppressions[0]!.reenabledAt).toEqual(reenabledAt);
    // A new bounce after it switches suppression back on and clears who re-enabled it.
    expect((await suppressAddress(captured, input({ occurredAt: new Date("2026-10-25T09:00:00Z"), sourceProviderEventId: "sns-9" }))).changed).toBe(true);
    expect(fake.suppressions[0]).toMatchObject({ reenabledAt: null, reenabledByUserId: null });
  });
});

describe("provider event mapping (#863)", () => {
  const at = new Date("2026-10-23T12:00:00Z");

  it("maps SES events onto the shared model and reads each stored event in its own provider's vocabulary", () => {
    expect(mapSesDeliveryEvent("ses.delivery", at)).toMatchObject({ status: "DELIVERED", outboxStatus: "SENT", lastError: null });
    expect(mapSesDeliveryEvent("ses.bounce.permanent", at)).toMatchObject({ status: "BOUNCED", outboxStatus: "FAILED" });
    expect(mapSesDeliveryEvent("ses.complaint", at)).toMatchObject({ status: "COMPLAINED", outboxStatus: "SENT" });
    expect(mapSesDeliveryEvent("ses.bounce.transient", at)).toBeNull();
    expect(mapSesDeliveryEvent("ses.bounce.undetermined", at)).toBeNull();
    expect(mapProviderDeliveryEvent("SES", "ses.delivery", at)?.status).toBe("DELIVERED");
    expect(mapProviderDeliveryEvent("RESEND", "email.delivered", at)?.status).toBe("DELIVERED");
    expect(mapProviderDeliveryEvent("RESEND", "ses.delivery", at)).toBeNull();
  });

  it("only moves forward: a terminal status is final", () => {
    expect(mayAdvanceProviderStatus("ACCEPTED", "DELIVERED")).toBe(true);
    expect(mayAdvanceProviderStatus(null, "DELIVERED")).toBe(true);
    expect(mayAdvanceProviderStatus("DELIVERED", "BOUNCED")).toBe(true);
    expect(mayAdvanceProviderStatus("DELIVERED", "COMPLAINED")).toBe(true);
    expect(mayAdvanceProviderStatus("DELIVERED", "DELIVERED")).toBe(false);
    for (const terminal of ["BOUNCED", "FAILED", "COMPLAINED", "SUPPRESSED"] as const) {
      for (const next of ["DELIVERED", "BOUNCED", "COMPLAINED", "SENT", "ACCEPTED"] as const) {
        expect(mayAdvanceProviderStatus(terminal, next), `${terminal} -> ${next}`).toBe(false);
      }
    }
    expect(providerAdvanceCondition("DELIVERED")).toEqual({ OR: [{ providerDeliveryStatus: null }, { providerDeliveryStatus: { in: ["ACCEPTED", "SENT"] } }] });
  });

  it("picks the furthest stage when several held events are linked at once", () => {
    const delivered = mapSesDeliveryEvent("ses.delivery", new Date("2026-10-23T13:00:00Z"))!;
    const bounced = mapSesDeliveryEvent("ses.bounce.permanent", new Date("2026-10-23T12:00:00Z"))!;
    expect(strongestTransition([delivered, bounced])?.status).toBe("BOUNCED");
    expect(strongestTransition([])).toBeNull();
  });
});
