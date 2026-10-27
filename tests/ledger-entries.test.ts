import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appendAmendmentDelta,
  appendLedgerEntriesIdempotent,
  appendLedgerEntry,
  appendPromoDiscount,
  appendSubmissionCharge,
  staffLedgerActor,
} from "@/modules/ledger/entries";
import { ledgerActor } from "@/modules/ledger/domain";

function fakeTx() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    registrationLedgerEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); return data; }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { rows.push(...data); return { count: data.length }; }),
    },
    user: { findUnique: vi.fn(async () => ({ displayName: "Staff Sample" })) },
  };
}

describe("ledger entry writers", () => {
  it("writes a submission charge with its snapshot, source and live origin", async () => {
    const tx = fakeTx();
    await appendSubmissionCharge(tx as never, { eventId: "e1", registrationId: "r1", totalCents: 17_500, appliedDiscountCents: 2_500, pricingSnapshot: { subtotalCents: 17_500 } });
    expect(tx.rows).toEqual([expect.objectContaining({
      eventId: "e1", registrationId: "r1", kind: "CHARGE", amountCents: 20_000, currency: "USD", sourceType: "REGISTRATION_SUBMISSION", sourceId: "r1",
      origin: "LIVE", actorType: "SYSTEM", actorId: null, actorNameSnapshot: "Registration form",
      pricingSnapshot: expect.objectContaining({ totalCents: 17_500, discountAmountCents: 2_500, subtotalCents: 17_500 }),
    })]);
  });

  it("still writes a 0-cent charge for a zero total", async () => {
    const tx = fakeTx();
    await appendSubmissionCharge(tx as never, { eventId: "e1", registrationId: "r1", totalCents: 0 });
    expect(tx.rows).toEqual([expect.objectContaining({ kind: "CHARGE", amountCents: 0 })]);
  });

  it("writes a promo discount as minus the applied amount, keyed to the redemption, and nothing for a zero discount", async () => {
    const tx = fakeTx();
    await appendPromoDiscount(tx as never, { eventId: "e1", registrationId: "r1", redemptionId: "red1", appliedDiscountCents: 2_500, pricingSnapshot: { code: "SAVE25" } });
    await appendPromoDiscount(tx as never, { eventId: "e1", registrationId: "r1", redemptionId: "red2", appliedDiscountCents: 0, pricingSnapshot: {} });
    expect(tx.rows).toHaveLength(1);
    expect(tx.rows[0]).toMatchObject({ kind: "DISCOUNT", amountCents: -2_500, sourceType: "PROMO_REDEMPTION", sourceId: "red1" });
  });

  it("writes an amendment's delta as a charge or a credit keyed to the operation, and nothing for no change", async () => {
    const tx = fakeTx();
    const actor = { type: "STAFF" as const, id: "u1", name: "Staff Sample" };
    await appendAmendmentDelta(tx as never, { eventId: "e1", registrationId: "r1", operationId: "op1", previousTotalCents: 10_000, finalTotalCents: 16_000, actor, pricingSnapshot: { pricing: {} } });
    await appendAmendmentDelta(tx as never, { eventId: "e1", registrationId: "r1", operationId: "op2", previousTotalCents: 16_000, finalTotalCents: 11_000, actor, pricingSnapshot: {}, reason: "Two fewer" });
    const none = await appendAmendmentDelta(tx as never, { eventId: "e1", registrationId: "r1", operationId: "op3", previousTotalCents: 11_000, finalTotalCents: 11_000, actor, pricingSnapshot: {} });
    expect(none).toBeNull();
    expect(tx.rows.map((row) => [row.kind, row.amountCents, row.sourceId, row.actorType, row.actorId, row.actorNameSnapshot, row.reason])).toEqual([
      ["CHARGE", 6_000, "op1", "STAFF", "u1", "Staff Sample", null],
      ["CREDIT", -5_000, "op2", "STAFF", "u1", "Staff Sample", "Two fewer"],
    ]);
    expect(tx.rows[0]!.pricingSnapshot).toMatchObject({ previousTotalCents: 10_000, totalCents: 16_000, deltaCents: 6_000 });
  });

  it("never lets a name reach an entry snapshot, and keeps no free text or non-staff name on an actor", async () => {
    const tx = fakeTx();
    await appendSubmissionCharge(tx as never, { eventId: "e1", registrationId: "r1", totalCents: 100, pricingSnapshot: { attendeeNames: ["Pat Example"], lineItems: [{ key: "fee", label: "Fee", amountCents: 100, attendeeLabel: "Pat Example" }] } });
    await appendAmendmentDelta(tx as never, { eventId: "e1", registrationId: "r1", operationId: "op1", previousTotalCents: 100, finalTotalCents: 200, actor: { type: "STAFF", id: "u1", name: "Staff Sample" }, pricingSnapshot: { pricing: { attendeeNames: ["Pat Example"] }, contactSnapshot: { email: "pat@example.test" } } });
    await appendPromoDiscount(tx as never, { eventId: "e1", registrationId: "r1", redemptionId: "red1", appliedDiscountCents: 5, pricingSnapshot: { firstName: "Pat", code: "SAVE" } });
    expect(JSON.stringify(tx.rows.map((row) => row.pricingSnapshot))).not.toMatch(/Pat|attendeeNames|attendeeLabel|pat@example/);
    expect(ledgerActor("PERSON", "p1", "Pat Example")).toEqual({ type: "PERSON", id: "p1", name: null });
    expect(ledgerActor("ATTENDEE_ACCOUNT", "a1", "Pat Example").name).toBeNull();
    expect(ledgerActor("STAFF", "u1", "Staff Sample").name).toBe("Staff Sample");
  });

  it("passes the real currency through to promo discount and amendment entries", async () => {
    const tx = fakeTx();
    await appendPromoDiscount(tx as never, { eventId: "e1", registrationId: "r1", redemptionId: "red1", appliedDiscountCents: 5, pricingSnapshot: {}, currency: "CAD" });
    await appendAmendmentDelta(tx as never, { eventId: "e1", registrationId: "r1", operationId: "op1", previousTotalCents: 1, finalTotalCents: 2, actor: { type: "SYSTEM", id: null, name: "x" }, pricingSnapshot: {}, currency: "CAD" });
    expect(tx.rows.map((row) => row.currency)).toEqual(["CAD", "CAD"]);
  });

  it("refuses a wrong-signed amount before it reaches the database", async () => {
    const tx = fakeTx();
    const draft = { eventId: "e1", registrationId: "r1", currency: "USD", pricingSnapshot: {}, sourceType: "AMENDMENT" as const, sourceId: "x", origin: "LIVE" as const, actor: { type: "SYSTEM" as const, id: null, name: null }, reason: null };
    await expect(appendLedgerEntry(tx as never, { ...draft, kind: "CHARGE", amountCents: -1 })).rejects.toThrow();
    await expect(appendLedgerEntriesIdempotent(tx as never, [{ ...draft, kind: "CREDIT", amountCents: 1 }])).rejects.toThrow();
    expect(tx.registrationLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.registrationLedgerEntry.createMany).not.toHaveBeenCalled();
  });

  it("appends in bulk with duplicates skipped, and writes nothing for an empty list", async () => {
    const tx = fakeTx();
    expect(await appendLedgerEntriesIdempotent(tx as never, [])).toBe(0);
    expect(tx.registrationLedgerEntry.createMany).not.toHaveBeenCalled();
    const draft = { eventId: "e1", registrationId: "r1", currency: "USD", pricingSnapshot: {}, sourceType: "REGISTRATION_SUBMISSION" as const, sourceId: "r1", origin: "BACKFILL" as const, actor: { type: "SYSTEM" as const, id: null, name: "Ledger backfill" }, reason: null, kind: "CHARGE" as const, amountCents: 5 };
    await appendLedgerEntriesIdempotent(tx as never, [draft]);
    expect(tx.registrationLedgerEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("snapshots a staff member's name now, without a foreign key", async () => {
    const tx = fakeTx();
    expect(await staffLedgerActor(tx as never, "u1")).toEqual({ type: "STAFF", id: "u1", name: "Staff Sample" });
  });
});
