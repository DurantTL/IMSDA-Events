import { describe, expect, it } from "vitest";
import { adjustmentCharge, adjustmentCharges, mealFieldKeySet, type AdjustmentRow } from "@/modules/cancellation-policy/adjustment-charge";
import { calculateCancellation, type CalculationFacts, type CancellationSelection, type ChargeEntry, type PolicyVersionRecord } from "@/modules/cancellation-policy/calculator";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";
import { campMeetingPreset } from "./support/camp-meeting-seeds";

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

describe("staff meal orders are netted per selection", () => {
  const link = (selectionId: string) => ({ selectionId, mealType: "LUNCH", selection: { registrationAttendeeId: "att_a" } });
  const row = (id: string, amountCents: number, selectionId: string): AdjustmentRow => ({ id, kind: "MEAL", amountCents, registrationAttendeeId: "att_a", mealLedgerEntry: link(selectionId) });
  const attendees = ["att_a", "att_b"];

  it("nets a charge and its full cancellation credit to nothing, and a partial reduction to the remainder", () => {
    expect(adjustmentCharges([row("a", 2000, "s1"), row("b", -2000, "s1")], attendees)).toEqual([]);
    const partial = adjustmentCharges([row("a", 2000, "s1"), row("b", -500, "s1"), row("c", 700, "s2")], attendees);
    expect(partial.map((entry) => [entry.id, entry.amountCents, entry.label, entry.attendeeId])).toEqual([
      ["meal:s1", 1500, "Meal: lunch (staff order)", "att_a"],
      ["meal:s2", 700, "Meal: lunch (staff order)", "att_a"],
    ]);
    // An unlinked MEAL adjustment keeps the old per-adjustment behaviour.
    expect(adjustmentCharges([{ id: "x", kind: "MEAL", amountCents: 300, registrationAttendeeId: null }], attendees)[0]?.id).toBe("adjustment:x");
  });

  const policyWith = (extra: Record<string, unknown>): PolicyVersionRecord => ({
    id: "pv", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    rules: parseCancellationRules({ ...campMeetingPreset("2026-05-25"), allowedScopes: ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"], supportedComponents: { categories: ["MEAL"], fieldKeys: [] }, ...extra }),
  });
  const refund = (charges: ChargeEntry[], rules: PolicyVersionRecord, selection: CancellationSelection = { scope: "FULL_REGISTRATION" }) =>
    calculateCancellation({ facts: facts(charges, 10_000), selection, policyVersions: [rules] });
  const reg = charge({ id: "reg", amountCents: 10_000, attendeeId: "att_a" });

  it.each([
    ["meals nonrefundable", { nonrefundable: { categories: ["MEAL"], fieldKeys: [] } }],
    ["a 50% window", { windows: [{ id: "half", label: "Half", endsOn: "2026-05-25", terms: { refund: { kind: "PERCENT", percent: 50 } } }] }],
  ])("a meal charged then fully credited leaves the refund the same as no meal at all under %s", (_name, extra) => {
    const rules = policyWith(extra);
    const none = refund([reg], rules);
    const netted = adjustmentCharges([row("a", 2000, "s1"), row("b", -2000, "s1")], attendees);
    expect(refund([reg, ...netted], rules).money.refundCents).toBe(none.money.refundCents);
  });

  it("a partial reduction withholds only what is still ordered, and the component is the net amount", () => {
    const rules = policyWith({ nonrefundable: { categories: ["MEAL"], fieldKeys: [] } });
    const netted = adjustmentCharges([row("a", 2000, "s1"), row("b", -500, "s1")], attendees);
    const result = calculateCalc(netted, rules);
    expect(result.lines.find((line) => line.chargeId === "meal:s1")).toMatchObject({ amountCents: 1500, withheldCents: 1500 });
    const component = refund([reg, ...netted], rules, { scope: "COMPONENT", chargeIds: ["meal:s1"] });
    expect(component.status).toBe("CALCULATED");
    expect(component.totals.inScopeCents).toBe(1500);
    // A meal that nets to nothing is not a charge at all, so it cannot be chosen.
    expect(refund([reg], rules, { scope: "COMPONENT", chargeIds: ["meal:s2"] }).status).toBe("INVALID_SELECTION");
  });

  function calculateCalc(netted: ChargeEntry[], rules: PolicyVersionRecord) {
    return refund([reg, ...netted], rules);
  }

  it("unpaired credits still cancel a nonrefundable charge (safety net in the calculator)", () => {
    const rules = policyWith({ nonrefundable: { categories: ["MEAL"], fieldKeys: [] } });
    const plain = refund([reg], rules);
    const unpaired = refund([reg, adjustmentCharge({ id: "a", kind: "MEAL", amountCents: 2000, registrationAttendeeId: "att_a" }, attendees), adjustmentCharge({ id: "b", kind: "MEAL", amountCents: -2000, registrationAttendeeId: "att_a" }, attendees)], rules);
    expect(unpaired.money.refundCents).toBe(plain.money.refundCents);
  });

  it("recognises form-ticket meal fields by the known keys and by the keys selections came from", () => {
    const keys = mealFieldKeySet(["custom_lunch_qty", null]);
    for (const key of ["breakfast_adult_qty", "lunch_child_qty", "supper_adult_qty", "custom_lunch_qty"]) expect(keys.has(key)).toBe(true);
    expect(keys.has("registration_fee")).toBe(false);
  });
});
