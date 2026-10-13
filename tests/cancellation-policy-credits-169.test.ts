import { describe, expect, it } from "vitest";
import { calculateCancellation, type CalculationFacts, type ChargeEntry, type PolicyVersionRecord } from "@/modules/cancellation-policy/calculator";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";

function charge(partial: Partial<ChargeEntry> & Pick<ChargeEntry, "id" | "amountCents">): ChargeEntry {
  return { source: "PRICING_LINE", label: partial.id, category: "REGISTRATION", fieldKey: partial.id, attendeeId: null, ...partial };
}

function facts(charges: ChargeEntry[], paid: number): CalculationFacts {
  return {
    evaluatedAt: "2026-04-10T15:00:00.000Z", clock: "SERVER", eventTimezone: "America/Chicago",
    registration: { id: "r", confirmationCode: "SYN", status: "CONFIRMED" },
    attendees: [{ id: "att_a", position: 0 }], charges, registrationPaidCents: paid, depositCents: 0, depositSource: "NONE", noShowFirstNight: false,
  };
}

const rulesFor = (extra: Record<string, unknown>): PolicyVersionRecord => ({
  id: "pv", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  rules: parseCancellationRules({
    windows: [{ id: "half", label: "Half", endsOn: "2026-05-25", terms: { refund: { kind: "PERCENT", percent: 50 } } }],
    afterWindows: { label: "After", terms: { refund: { kind: "NONE" } } },
    cardFeeTreatment: "REFUNDABLE",
    ...extra,
  }),
});

const discount = () => charge({ id: "discount", source: "ADJUSTMENT", category: "ADJUSTMENT", fieldKey: null, label: "Discount (adjustment)", amountCents: -2000 });

describe("credits and nonrefundable classes", () => {
  it("a real discount stays refundable at the window percentage while another category is nonrefundable", () => {
    const rules = rulesFor({ nonrefundable: { categories: ["LODGING"], fieldKeys: [] }, classifications: [{ category: "LODGING", fieldKeys: ["cabin"] }] });
    const result = calculateCancellation({
      facts: facts([charge({ id: "reg", amountCents: 10_000 }), charge({ id: "cabin", amountCents: 4000 }), discount()], 12_000),
      selection: { scope: "FULL_REGISTRATION" }, policyVersions: [rules],
    });
    const byId = Object.fromEntries(result.lines.map((line) => [line.chargeId, line]));
    expect(byId.cabin).toMatchObject({ treatment: "NONREFUNDABLE", eligibleCents: 0, withheldCents: 4000 });
    expect(byId.discount).toMatchObject({ treatment: "REFUNDABLE", eligibleCents: -1000, withheldCents: -1000 });
    // 50% of $100 and of the -$20 discount: $40.00 eligible; $40.00 cabin and $40.00 half of the net registration are kept.
    expect(result.money.refundCents).toBe(4000);
  });

  it("the reviewer's scenario cannot be configured: ticking adjustments or tax as nonrefundable is ignored", () => {
    const rules = rulesFor({ nonrefundable: { categories: ["ADJUSTMENT", "TAX", "FEE", "LODGING"], fieldKeys: [] } });
    expect(rules.rules.nonrefundable.categories).toEqual(["LODGING"]);
    const result = calculateCancellation({
      facts: facts([charge({ id: "reg", amountCents: 10_000 }), discount()], 8000),
      selection: { scope: "FULL_REGISTRATION" }, policyVersions: [rules],
    });
    // $100 less $20 at 50% is $40.00 refundable, not more.
    expect(result.money.refundCents).toBe(4000);
    expect(result.lines.find((line) => line.chargeId === "discount")?.treatment).toBe("REFUNDABLE");
  });

  it("new rules reject nothing but drop non-purchase categories, and a nonrefundable field key never applies to generic adjustments or the remainder line", () => {
    expect(() => parseCancellationRules({ windows: [], afterWindows: { label: "A", terms: { refund: { kind: "NONE" } } }, cardFeeTreatment: "REFUNDABLE", nonrefundable: { categories: ["TAX"], fieldKeys: [] } })).not.toThrow();
    const rules = rulesFor({ nonrefundable: { categories: ["OTHER"], fieldKeys: [] } });
    const remainder = charge({ id: "other:unitemized", source: "UNRECONCILED", category: "OTHER", fieldKey: null, label: "Adjustments (not itemized)", amountCents: -1000 });
    const result = calculateCancellation({
      facts: facts([charge({ id: "reg", amountCents: 10_000 }), remainder], 9000), selection: { scope: "FULL_REGISTRATION" }, policyVersions: [rules],
    });
    expect(result.lines.find((line) => line.chargeId === "other:unitemized")).toMatchObject({ treatment: "REFUNDABLE", eligibleCents: -500 });
  });
});
