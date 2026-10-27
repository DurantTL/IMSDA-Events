import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reconcileRegistrationLedger } from "@/modules/ledger/reconciliation";

function client(registrations: Array<{ id: string; confirmationCode: string; status: string; totalAmount: string }>, entries: Array<{ registrationId: string; amountCents: number }>) {
  return {
    registration: { findMany: vi.fn(async () => registrations) },
    registrationLedgerEntry: { findMany: vi.fn(async () => entries) },
  };
}

describe("shadow reconciliation", () => {
  it("passes every registration whose entries sum to the stored total, cancelled and zero-total included", async () => {
    const db = client(
      [
        { id: "a", confirmationCode: "A", status: "CONFIRMED", totalAmount: "175.00" },
        { id: "b", confirmationCode: "B", status: "CANCELLED", totalAmount: "75.50" },
        { id: "c", confirmationCode: "C", status: "CONFIRMED", totalAmount: "0.00" },
      ],
      [
        { registrationId: "a", amountCents: 20_000 }, { registrationId: "a", amountCents: -2_500 },
        { registrationId: "b", amountCents: 7_550 },
        { registrationId: "c", amountCents: 0 },
      ],
    );
    const result = await reconcileRegistrationLedger(db as never, { eventId: "e1" });
    expect(result).toEqual({ checked: 3, failing: [] });
  });

  it("reports a difference with the expected, ledger and difference amounts and the entry count", async () => {
    const db = client(
      [{ id: "a", confirmationCode: "A", status: "SUBMITTED", totalAmount: "130.00" }],
      [{ registrationId: "a", amountCents: 12_345 }],
    );
    const { failing } = await reconcileRegistrationLedger(db as never, { eventId: "e1" });
    expect(failing).toEqual([{
      registrationId: "a", confirmationCode: "A", status: "SUBMITTED", expectedCents: 13_000, ledgerCents: 12_345, differenceCents: 655, entryCount: 1, hasNoEntries: false,
    }]);
  });

  it("reports a registration with no entries at all, even a zero-total one, and says so", async () => {
    const db = client([{ id: "z", confirmationCode: "Z", status: "CONFIRMED", totalAmount: "0.00" }], []);
    const { failing } = await reconcileRegistrationLedger(db as never, { eventId: "e1" });
    expect(failing).toEqual([expect.objectContaining({ registrationId: "z", expectedCents: 0, ledgerCents: 0, differenceCents: 0, entryCount: 0, hasNoEntries: true })]);
  });

  it("is scoped to one event, and to the given registrations when asked", async () => {
    const db = client([], []);
    await reconcileRegistrationLedger(db as never, { eventId: "e1", registrationIds: ["a"] });
    expect(db.registration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "e1", id: { in: ["a"] } } }));
    expect(db.registrationLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "e1", registrationId: { in: ["a"] } } }));
  });

  it("only reads", async () => {
    const db = client([], []);
    await reconcileRegistrationLedger(db as never, { eventId: "e1" });
    expect(Object.keys(db.registration)).toEqual(["findMany"]);
    expect(Object.keys(db.registrationLedgerEntry)).toEqual(["findMany"]);
  });
});
