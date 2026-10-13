import { describe, expect, it } from "vitest";
import { adjustmentCharge } from "@/modules/cancellation-policy/adjustment-charge";
import { calculateCancellation, type CalculationFacts, type CancellationSelection, type ChargeEntry, type PolicyVersionRecord } from "@/modules/cancellation-policy/calculator";
import { campMeetingPreset, parseCancellationRules } from "@/modules/cancellation-policy/rules";

function charge(partial: Partial<ChargeEntry> & Pick<ChargeEntry, "id" | "amountCents">): ChargeEntry {
  return { source: "PRICING_LINE", label: partial.id, category: "REGISTRATION", fieldKey: partial.id, attendeeId: null, ...partial };
}

function facts(charges: ChargeEntry[], paid: number): CalculationFacts {
  return {
    evaluatedAt: "2026-05-01T15:00:00.000Z", clock: "SERVER", eventTimezone: "America/Chicago",
    registration: { id: "r", confirmationCode: "SYN", status: "CONFIRMED" },
    attendees: [{ id: "att_a", position: 0 }, { id: "att_b", position: 1 }],
    charges, registrationPaidCents: paid, depositCents: 0, depositSource: "NONE", noShowFirstNight: false,
  };
}

const policy = (): PolicyVersionRecord => ({
  id: "pv", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  rules: parseCancellationRules({
    ...campMeetingPreset("2026-05-25"),
    nonrefundable: { categories: ["MEAL"], fieldKeys: [] },
    allowedScopes: ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"],
    supportedComponents: { categories: ["MEAL"], fieldKeys: [] },
  }),
});

const run = (f: CalculationFacts, selection: CancellationSelection = { scope: "FULL_REGISTRATION" }) =>
  calculateCancellation({ facts: f, selection, policyVersions: [policy()] });

describe("meal adjustments (#210)", () => {
  it("classifies a MEAL adjustment as a meal charge for its attendee and other kinds as shared adjustments", () => {
    const meal = adjustmentCharge({ id: "a1", kind: "MEAL", amountCents: 2000, registrationAttendeeId: "att_a" }, ["att_a", "att_b"]);
    expect(meal).toMatchObject({ id: "adjustment:a1", category: "MEAL", label: "Meal (staff meal order)", attendeeId: "att_a", amountCents: 2000 });
    expect(adjustmentCharge({ id: "a2", kind: "MEAL", amountCents: 500, registrationAttendeeId: "gone" }, ["att_a"]).attendeeId).toBeNull();
    expect(adjustmentCharge({ id: "a3", kind: "DISCOUNT", amountCents: -500, registrationAttendeeId: null }, [])).toMatchObject({ category: "ADJUSTMENT", label: "Discount (adjustment)" });
  });

  it("lets a policy make meals nonrefundable or a component, and follows the attendee", () => {
    const meal = adjustmentCharge({ id: "m", kind: "MEAL", amountCents: 2000, registrationAttendeeId: "att_a" }, ["att_a", "att_b"]);
    const f = facts([charge({ id: "reg-a", amountCents: 10_000, attendeeId: "att_a" }), charge({ id: "reg-b", amountCents: 10_000, attendeeId: "att_b" }), meal], 22_000);
    const full = run(f);
    expect(full.lines.find((line) => line.chargeId === "adjustment:m")).toMatchObject({ treatment: "NONREFUNDABLE", withheldCents: 2000 });
    expect(run(f, { scope: "ATTENDEE", attendeeIds: ["att_b"] }).lines.find((line) => line.chargeId === "adjustment:m")?.treatment).toBe("KEPT");
    expect(run(f, { scope: "ATTENDEE", attendeeIds: ["att_a"] }).lines.find((line) => line.chargeId === "adjustment:m")?.treatment).toBe("NONREFUNDABLE");
    const component = run(f, { scope: "COMPONENT", chargeIds: ["adjustment:m"] });
    expect(component.status).toBe("CALCULATED");
    expect(component.totals.withheldCents).toBe(2000);
  });

  it("does not count a form-ticket meal twice: it is only a form price line, and the meal field classifies it", () => {
    const rules = parseCancellationRules({ ...campMeetingPreset("2026-05-25"), classifications: [{ category: "MEAL", fieldKeys: ["sabbath_lunch"] }], nonrefundable: { categories: ["MEAL"], fieldKeys: [] } });
    const f = facts([charge({ id: "reg", amountCents: 10_000 }), charge({ id: "ticket", fieldKey: "sabbath_lunch", amountCents: 1500 })], 11_500);
    const result = calculateCancellation({ facts: f, selection: { scope: "FULL_REGISTRATION" }, policyVersions: [{ id: "pv", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"), rules }] });
    expect(result.totals.chargedCents).toBe(11_500);
    expect(result.lines.filter((line) => line.category === "MEAL")).toHaveLength(1);
  });
});
