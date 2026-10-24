import { describe, expect, it } from "vitest";
import { calculateCancellation, type CalculationFacts, type CancellationSelection, type ChargeEntry, type PolicyVersionRecord } from "@/modules/cancellation-policy/calculator";
import { adjustmentCharge, adjustmentCharges } from "@/modules/cancellation-policy/adjustment-charge";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";
import { campMeetingPreset } from "./support/camp-meeting-seeds";

/** A key or item charge (an ASSET adjustment, #214) is a fixed rule: never refunded, not prorated, no attendee, not a component. */

const policy: PolicyVersionRecord = { id: "pv", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"), rules: parseCancellationRules(campMeetingPreset("2026-05-25")) };

function reg(id: string, amountCents: number, attendeeId: string): ChargeEntry {
  return { id, source: "PRICING_LINE", label: id, amountCents, category: "REGISTRATION", fieldKey: id, attendeeId };
}
const assetRow = (id: string, amountCents: number) => ({ id, kind: "ASSET", amountCents, registrationAttendeeId: null });

function facts(charges: ChargeEntry[], paid: number): CalculationFacts {
  return {
    evaluatedAt: "2026-05-01T15:00:00.000Z", clock: "SERVER", eventTimezone: "America/Chicago",
    registration: { id: "r", confirmationCode: "SYN", status: "CONFIRMED" }, attendees: [{ id: "a", position: 0 }, { id: "b", position: 1 }],
    registrationPaidCents: paid, depositCents: 0, depositSource: "NONE", noShowFirstNight: false, charges,
  };
}
const run = (f: CalculationFacts, selection: CancellationSelection) => calculateCancellation({ facts: f, selection, policyVersions: [policy] });

describe("key and item charges on cancellation", () => {
  it("classifies an ASSET adjustment as a fixed, unattributed line", () => {
    const entry = adjustmentCharge({ ...assetRow("x1", 2500), registrationAttendeeId: "a" }, ["a", "b"]);
    expect(entry).toMatchObject({ label: "Keys and items charge", attendeeId: null, fixedRule: "KEY_OR_ITEM_CHARGE", amountCents: 2500 });
    expect(adjustmentCharges([assetRow("x1", 2500), assetRow("x2", -2500)], ["a"]).every((row) => row.fixedRule === "KEY_OR_ITEM_CHARGE")).toBe(true);
  });

  it("withholds the whole charge when the registration is cancelled, though the window refunds everything else", () => {
    const charges = [reg("a", 10_000, "a"), ...adjustmentCharges([assetRow("k1", 2500)], ["a", "b"])];
    const result = run(facts(charges, 12_500), { scope: "FULL_REGISTRATION" });
    const line = result.lines.find((row) => row.chargeId === "adjustment:k1")!;
    expect(line).toMatchObject({ treatment: "NONREFUNDABLE", eligibleCents: 0, withheldCents: 2500, reason: "Key or item charge, not refundable." });
    // $10 is the preset's flat processing fee; the key charge is withheld on top of it, and the rest of the money comes back.
    expect(result.money.refundCents).toBe(9000);
    expect(result.money.retainedCents).toBe(3500);
  });

  it("is not prorated or attributed when one attendee is removed: it stays charged", () => {
    const charges = [
      reg("a", 10_000, "a"), reg("b", 10_000, "b"), ...adjustmentCharges([assetRow("k1", 2500)], ["a", "b"]),
      { id: "fee", source: "PRICING_FEE" as const, label: "fee", amountCents: 1000, category: "FEE" as const, fieldKey: null, attendeeId: null },
    ];
    const result = run(facts(charges, 23_500), { scope: "ATTENDEE", attendeeIds: ["a"] });
    expect(result.lines.find((row) => row.chargeId === "adjustment:k1")).toMatchObject({ inScopeCents: 0, treatment: "KEPT", withheldCents: 0 });
    // The card fee is prorated over the price lines only: the key charge is not in that base.
    expect(result.lines.find((row) => row.chargeId === "fee")?.inScopeCents).toBe(500);
    expect(result.money.refundCents).toBe(9500);
  });

  it("is never a cancellable component", () => {
    const charges = [reg("a", 10_000, "a"), ...adjustmentCharges([assetRow("k1", 2500)], ["a"])];
    const rules = parseCancellationRules({ ...campMeetingPreset("2026-05-25"), allowedScopes: ["FULL_REGISTRATION", "COMPONENT"], supportedComponents: { categories: ["REGISTRATION", "OTHER"], fieldKeys: [] } });
    const result = calculateCancellation({ facts: facts(charges, 12_500), selection: { scope: "COMPONENT", chargeIds: ["adjustment:k1"] }, policyVersions: [{ ...policy, rules }] });
    expect(result.status).toBe("COMPONENT_NOT_SUPPORTED");
  });

  it("nets out when waived: the charge and its reversing line cancel", () => {
    const charges = [reg("a", 10_000, "a"), ...adjustmentCharges([assetRow("k1", 2500), assetRow("k2", -2500)], ["a"])];
    const full = run(facts(charges, 10_000), { scope: "FULL_REGISTRATION" });
    // Only the preset's $10 flat fee is withheld: the charge and its reversal contribute nothing.
    expect(full.lines.filter((row) => row.chargeId.startsWith("adjustment:")).reduce((sum, row) => sum + row.withheldCents, 0)).toBe(0);
    expect(full.money).toMatchObject({ paidCents: 10_000, refundCents: 9000, retainedCents: 1000, unpaidWithholdingCents: 0 });
    const attendee = run(facts(charges, 10_000), { scope: "ATTENDEE", attendeeIds: ["a"] });
    expect(attendee.totals.keptChargesCents).toBe(0);
  });
});
