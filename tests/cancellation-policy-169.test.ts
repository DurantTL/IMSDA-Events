import { describe, expect, it } from "vitest";
import {
  calculateCancellation,
  mulDivRound,
  selectPolicyVersion,
  type CalculationFacts,
  type CancellationSelection,
  type ChargeEntry,
  type PolicyVersionRecord,
} from "@/modules/cancellation-policy/calculator";
import { forfeitableDeposit } from "@/modules/cancellation-policy/deposit-facts";
import { windowClosesAt, localMidnightInstant } from "@/modules/cancellation-policy/event-time";
import {
  campMeetingPreset,
  parseCancellationRules,
  type CancellationRulesInput,
} from "@/modules/cancellation-policy/rules";

const TZ = "America/Chicago";

function version(rules: CancellationRulesInput, overrides: Partial<PolicyVersionRecord> = {}): PolicyVersionRecord {
  return {
    id: "pv_1",
    version: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    rules: parseCancellationRules(rules),
    ...overrides,
  };
}

function charge(partial: Partial<ChargeEntry> & Pick<ChargeEntry, "id" | "amountCents">): ChargeEntry {
  return {
    source: "PRICING_LINE",
    label: partial.id,
    category: "REGISTRATION",
    fieldKey: partial.id,
    attendeeId: null,
    ...partial,
  };
}

function facts(overrides: Partial<CalculationFacts> & { charges: ChargeEntry[] }): CalculationFacts {
  return {
    evaluatedAt: "2026-05-01T15:00:00.000Z",
    clock: "SERVER",
    eventTimezone: TZ,
    registration: { id: "reg_1", confirmationCode: "SYN001", status: "CONFIRMED" },
    attendees: [{ id: "att_a", position: 0 }, { id: "att_b", position: 1 }],
    registrationPaidCents: 0,
    depositCents: 0,
    depositSource: "NONE",
    noShowFirstNight: false,
    ...overrides,
  };
}

const full: CancellationSelection = { scope: "FULL_REGISTRATION" };

function run(f: CalculationFacts, versions: PolicyVersionRecord[], selection: CancellationSelection = full) {
  return calculateCancellation({ facts: f, selection, policyVersions: versions });
}

const campMeeting = () => version(campMeetingPreset("2026-05-25"));

describe("event-timezone boundaries", () => {
  it("closes a window at the next local midnight, to the millisecond", () => {
    const closes = windowClosesAt("2026-05-25", TZ);
    expect(closes.toISOString()).toBe("2026-05-26T05:00:00.000Z");
    const rules = [campMeeting()];
    const charges = [charge({ id: "fee", amountCents: 10_000 })];
    const before = run(facts({ charges, evaluatedAt: "2026-05-26T04:59:59.999Z" }), rules);
    const at = run(facts({ charges, evaluatedAt: "2026-05-26T05:00:00.000Z" }), rules);
    expect(before.timing?.kind).toBe("WINDOW");
    expect(at.timing?.kind).toBe("AFTER_WINDOWS");
  });

  it("treats the whole deadline day in the event zone as inside the window, not the UTC day", () => {
    const rules = [campMeeting()];
    const charges = [charge({ id: "fee", amountCents: 10_000 })];
    // 9:30 PM Central on May 25 is already May 26 in UTC.
    expect(run(facts({ charges, evaluatedAt: "2026-05-26T02:30:00.000Z" }), rules).timing?.kind).toBe("WINDOW");
    // 12:00 AM Central on May 26 is after.
    expect(run(facts({ charges, evaluatedAt: "2026-05-26T05:00:01.000Z" }), rules).timing?.kind).toBe("AFTER_WINDOWS");
  });

  it("is exact on the 23-hour day the clocks go forward", () => {
    expect(localMidnightInstant("2026-03-08", TZ).toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(windowClosesAt("2026-03-08", TZ).toISOString()).toBe("2026-03-09T05:00:00.000Z");
    const rules = [version(campMeetingPreset("2026-03-08"))];
    const charges = [charge({ id: "fee", amountCents: 10_000 })];
    expect(run(facts({ charges, evaluatedAt: "2026-03-09T04:59:59.999Z" }), rules).timing?.kind).toBe("WINDOW");
    expect(run(facts({ charges, evaluatedAt: "2026-03-09T05:00:00.000Z" }), rules).timing?.kind).toBe("AFTER_WINDOWS");
  });

  it("is exact on the 25-hour day the clocks go back", () => {
    expect(localMidnightInstant("2026-11-01", TZ).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(windowClosesAt("2026-11-01", TZ).toISOString()).toBe("2026-11-02T06:00:00.000Z");
    const rules = [version(campMeetingPreset("2026-11-01"))];
    const charges = [charge({ id: "fee", amountCents: 10_000 })];
    // 11:30 PM CST on Nov 1 is 05:30Z on Nov 2: still inside the 25-hour day.
    expect(run(facts({ charges, evaluatedAt: "2026-11-02T05:59:59.999Z" }), rules).timing?.kind).toBe("WINDOW");
    expect(run(facts({ charges, evaluatedAt: "2026-11-02T06:00:00.000Z" }), rules).timing?.kind).toBe("AFTER_WINDOWS");
  });

  it("uses the event's own zone, not a fixed one", () => {
    expect(windowClosesAt("2026-05-25", "Pacific/Honolulu").toISOString()).toBe("2026-05-26T10:00:00.000Z");
    expect(windowClosesAt("2026-05-25", "America/Los_Angeles").toISOString()).toBe("2026-05-26T07:00:00.000Z");
  });
});

describe("Camp Meeting rule", () => {
  const charges = [charge({ id: "reg", amountCents: 30_000 })];

  it("before the deadline: full refund minus the $10 processing fee, deposit refunded", () => {
    const result = run(facts({ charges, registrationPaidCents: 30_000, depositCents: 5000, depositSource: "RECORDED_DEPOSIT" }), [campMeeting()]);
    expect(result.status).toBe("CALCULATED");
    expect(result.flatFee).toEqual({ label: "Processing fee", cents: 1000 });
    expect(result.totals.eligibleCents).toBe(29_000);
    expect(result.totals.withheldCents).toBe(1000);
    expect(result.money.refundCents).toBe(29_000);
    expect(result.deposit.outcome).toBe("REFUNDED");
    expect(result.capacity.registrationCancelled).toBe(true);
  });

  it("before the deadline with only the deposit paid: the deposit less the fee comes back", () => {
    const result = run(facts({ charges, registrationPaidCents: 5000, depositCents: 5000, depositSource: "RECORDED_DEPOSIT" }), [campMeeting()]);
    expect(result.money.refundCents).toBe(4000);
    expect(result.money.retainedCents).toBe(1000);
  });

  it("after the deadline: the deposit is forfeited and the reservation cancelled", () => {
    const result = run(facts({
      charges, registrationPaidCents: 5000, depositCents: 5000, depositSource: "RECORDED_DEPOSIT", evaluatedAt: "2026-06-10T15:00:00.000Z",
    }), [campMeeting()]);
    expect(result.timing?.kind).toBe("AFTER_WINDOWS");
    expect(result.deposit).toMatchObject({ outcome: "FORFEITED", forfeitedCents: 5000 });
    expect(result.money.refundCents).toBe(0);
    expect(result.capacity.registrationCancelled).toBe(true);
    expect(result.flatFee).toBeNull();
  });

  it("after the deadline, money paid beyond the deposit stays refundable (flagged reading)", () => {
    const result = run(facts({
      charges, registrationPaidCents: 30_000, depositCents: 5000, depositSource: "RECORDED_DEPOSIT", evaluatedAt: "2026-06-10T15:00:00.000Z",
    }), [campMeeting()]);
    expect(result.deposit.forfeitedCents).toBe(5000);
    expect(result.money.refundCents).toBe(25_000);
  });

  it("a first-night no-show forfeits the deposit even though the clock says before the deadline", () => {
    const result = run(facts({
      charges, registrationPaidCents: 5000, depositCents: 5000, depositSource: "RECORDED_DEPOSIT", noShowFirstNight: true,
    }), [campMeeting()]);
    expect(result.timing?.kind).toBe("NO_SHOW");
    expect(result.deposit.outcome).toBe("FORFEITED");
    expect(result.money.refundCents).toBe(0);
  });

  it("a no-show flag is ignored when the policy defines no no-show rule", () => {
    const rules = parseCancellationRules({ ...campMeetingPreset("2026-05-25"), noShow: null });
    const result = run(facts({ charges, registrationPaidCents: 5000, noShowFirstNight: true }), [version(rules)]);
    expect(result.timing?.kind).toBe("WINDOW");
  });

  it("forfeits only paid money: a deposit larger than what is left is capped", () => {
    const result = run(facts({
      charges, registrationPaidCents: 3000, depositCents: 5000, depositSource: "PAID_AT_LEAST_DEPOSIT", evaluatedAt: "2026-06-10T15:00:00.000Z",
    }), [campMeeting()]);
    expect(result.deposit.forfeitedCents).toBe(3000);
    expect(result.money.refundCents).toBe(0);
  });

  it("never charges the processing fee when nothing was paid", () => {
    const result = run(facts({ charges }), [campMeeting()]);
    expect(result.money.refundCents).toBe(0);
    expect(result.money.retainedCents).toBe(0);
    expect(result.money.unpaidWithholdingCents).toBe(1000);
  });
});

describe("percentage windows", () => {
  const rules = () => version({
    windows: [
      { id: "early", label: "Early", endsOn: "2026-04-01", terms: { refund: { kind: "FULL" } } },
      { id: "mid", label: "Mid", endsOn: "2026-05-01", terms: { refund: { kind: "PERCENT", percent: 50 }, creditAllowed: true } },
      { id: "late", label: "Late", endsOn: "2026-06-01", terms: { refund: { kind: "PERCENT", percent: 25 } } },
    ],
    afterWindows: { label: "After", terms: { refund: { kind: "NONE" } } },
    cardFeeTreatment: "REFUNDABLE",
  });
  const charges = [charge({ id: "reg", amountCents: 10_001 }), charge({ id: "disc", amountCents: -1001, category: "ADJUSTMENT", source: "ADJUSTMENT", fieldKey: null })];

  it.each([
    ["2026-03-31T12:00:00Z", "early", 9000],
    ["2026-04-15T12:00:00Z", "mid", 4500],
    ["2026-05-15T12:00:00Z", "late", 2250],
    ["2026-07-01T12:00:00Z", null, 0],
  ])("at %s uses %s", (evaluatedAt, windowId, refund) => {
    const result = run(facts({ charges, evaluatedAt, registrationPaidCents: 9000 }), [rules()]);
    expect(result.timing?.windowId).toBe(windowId);
    expect(result.money.refundCents).toBe(refund);
  });

  it("explains every amount per line and the lines add back to the charge", () => {
    const result = run(facts({ charges, evaluatedAt: "2026-04-15T12:00:00Z", registrationPaidCents: 9000 }), [rules()]);
    for (const line of result.lines) {
      expect(line.eligibleCents + line.withheldCents).toBe(line.inScopeCents);
      expect(line.reason.length).toBeGreaterThan(5);
    }
    expect(result.totals.chargedCents).toBe(9000);
    expect(result.totals.inScopeCents + result.totals.keptChargesCents).toBe(result.totals.chargedCents);
    // 50% of $100.01 is rounded half away from zero; the discount follows the same share.
    expect(result.lines[0]).toMatchObject({ eligibleCents: 5001, withheldCents: 5000 });
    expect(result.lines[1]).toMatchObject({ eligibleCents: -501, withheldCents: -500 });
  });

  it("offers credit only in windows that allow it, and only up to the refundable amount", () => {
    const mid = run(facts({ charges, evaluatedAt: "2026-04-15T12:00:00Z", registrationPaidCents: 9000 }), [rules()]);
    expect(mid.creditOption).toMatchObject({ available: true, maximumCents: 4500 });
    const early = run(facts({ charges, evaluatedAt: "2026-03-15T12:00:00Z", registrationPaidCents: 9000 }), [rules()]);
    expect(early.creditOption.available).toBe(false);
    const unpaid = run(facts({ charges, evaluatedAt: "2026-04-15T12:00:00Z" }), [rules()]);
    expect(unpaid.creditOption).toMatchObject({ available: false, maximumCents: 0 });
  });

  it("never lets a payment be refunded beyond what was paid after the charges that stay", () => {
    const result = run(facts({ charges, evaluatedAt: "2026-03-15T12:00:00Z", registrationPaidCents: 2000 }), [rules()]);
    expect(result.money.refundCents).toBe(2000);
    const partial = run(facts({ charges, evaluatedAt: "2026-04-15T12:00:00Z", registrationPaidCents: 4000 }), [rules()]);
    // $45.00 withheld; $40.00 paid, so nothing is refundable and $5.00 of the withholding is unpaid.
    expect(partial.money).toMatchObject({ refundCents: 0, retainedCents: 4000, unpaidWithholdingCents: 500 });
  });
});

describe("nonrefundable components and fees", () => {
  const rules = (cardFeeTreatment: "REFUNDABLE" | "NONREFUNDABLE") => version({
    windows: [{ id: "w", label: "Before", endsOn: "2026-05-25", terms: { refund: { kind: "FULL" } } }],
    afterWindows: { label: "After", terms: { refund: { kind: "NONE" } } },
    nonrefundable: { categories: ["MERCHANDISE"], fieldKeys: ["banquet"] },
    classifications: [{ category: "MEAL", fieldKeys: ["meal_plan"] }],
    cardFeeTreatment,
  });
  const charges = [
    charge({ id: "reg", amountCents: 20_000 }),
    charge({ id: "meal", fieldKey: "meal_plan", amountCents: 6000 }),
    charge({ id: "banquet", fieldKey: "banquet", amountCents: 4000 }),
    charge({ id: "shirt", source: "MERCHANDISE_ORDER", category: "MERCHANDISE", fieldKey: null, amountCents: 2500, settledSeparately: true }),
    charge({ id: "cardfee", source: "PRICING_FEE", category: "FEE", fieldKey: null, amountCents: 900 }),
  ];

  it("withholds nonrefundable merchandise and fields in full and refunds the rest", () => {
    const result = run(facts({ charges, registrationPaidCents: 30_900 }), [rules("REFUNDABLE")]);
    const byId = Object.fromEntries(result.lines.map((line) => [line.chargeId, line]));
    expect(byId.shirt).toMatchObject({ treatment: "NONREFUNDABLE", eligibleCents: 0, withheldCents: 2500 });
    expect(byId.banquet).toMatchObject({ treatment: "NONREFUNDABLE", eligibleCents: 0, withheldCents: 4000 });
    expect(byId.meal).toMatchObject({ category: "MEAL", treatment: "REFUNDABLE", eligibleCents: 6000 });
    expect(byId.cardfee).toMatchObject({ eligibleCents: 900 });
    // Paid: $309.00 registration payments plus the $25.00 order settled when it was placed.
    expect(result.money).toMatchObject({ paidCents: 33_400, refundCents: 26_900, retainedCents: 6500 });
  });

  it("treats the card fee as a configurable component", () => {
    const refundable = run(facts({ charges, registrationPaidCents: 30_900 }), [rules("REFUNDABLE")]);
    const withheld = run(facts({ charges, registrationPaidCents: 30_900 }), [rules("NONREFUNDABLE")]);
    expect(refundable.feeTreatment).toMatchObject({ cardFeeCents: 900, treatment: "REFUNDABLE" });
    expect(withheld.feeTreatment).toMatchObject({ cardFeeCents: 900, treatment: "NONREFUNDABLE" });
    expect(withheld.lines.find((line) => line.chargeId === "cardfee")).toMatchObject({ treatment: "NONREFUNDABLE", withheldCents: 900 });
    expect(refundable.money.refundCents - withheld.money.refundCents).toBe(900);
  });

  it("withholds a nonrefundable component even after the last window", () => {
    const result = run(facts({ charges, registrationPaidCents: 30_900, evaluatedAt: "2026-09-01T12:00:00Z" }), [rules("REFUNDABLE")]);
    expect(result.money.refundCents).toBe(0);
    expect(result.lines.every((line) => line.withheldCents === line.inScopeCents)).toBe(true);
  });

  it("treats a credit in a nonrefundable class as nonrefundable too, so it cancels its charge", () => {
    const withCredit = [...charges, charge({ id: "credit", fieldKey: "banquet", amountCents: -500 })];
    const result = run(facts({ charges: withCredit, registrationPaidCents: 30_400 }), [rules("REFUNDABLE")]);
    expect(result.lines.find((line) => line.chargeId === "credit")).toMatchObject({ treatment: "NONREFUNDABLE", eligibleCents: 0, withheldCents: -500 });
  });
});

describe("scopes", () => {
  const rules = () => version({
    ...campMeetingPreset("2026-05-25"),
    allowedScopes: ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"],
    supportedComponents: { categories: ["MEAL"], fieldKeys: [] },
    classifications: [{ category: "MEAL", fieldKeys: ["meals"] }],
  });
  const charges = [
    charge({ id: "a-reg", amountCents: 10_000, attendeeId: "att_a" }),
    charge({ id: "b-reg", amountCents: 20_000, attendeeId: "att_b" }),
    charge({ id: "b-meals", fieldKey: "meals", amountCents: 5000, attendeeId: "att_b" }),
    charge({ id: "fee", source: "PRICING_FEE", category: "FEE", fieldKey: null, amountCents: 1050 }),
  ];
  const base = () => facts({ charges, registrationPaidCents: 36_050, depositCents: 5000, depositSource: "RECORDED_DEPOSIT" });

  it("removes one attendee: their charges, a share of the card fee, the deposit stays with the registration", () => {
    const result = run(base(), [rules()], { scope: "ATTENDEE", attendeeIds: ["att_a"] });
    expect(result.scope).toMatchObject({ requested: "ATTENDEE", effective: "ATTENDEE" });
    const byId = Object.fromEntries(result.lines.map((line) => [line.chargeId, line]));
    expect(byId["a-reg"]).toMatchObject({ inScopeCents: 10_000, treatment: "REFUNDABLE" });
    expect(byId["b-reg"]).toMatchObject({ treatment: "KEPT", inScopeCents: 0 });
    // 10,000 of 35,000 direct charges: 1050 * 10000 / 35000 = 300.
    expect(byId.fee).toMatchObject({ inScopeCents: 300, eligibleCents: 300 });
    expect(result.totals.keptChargesCents).toBe(25_750);
    // Paid 36,050; 25,750 stays charged; 10,300 is left, less the $10.00 fee.
    expect(result.money.refundCents).toBe(9300);
    expect(result.deposit.outcome).toBe("STAYS_WITH_REGISTRATION");
    expect(result.capacity).toMatchObject({ registrationCancelled: false, attendeesReleased: ["att_a"] });
  });

  it("never forfeits the deposit for a partial cancellation, even after the deadline", () => {
    const result = run({ ...base(), evaluatedAt: "2026-07-01T12:00:00Z" }, [rules()], { scope: "ATTENDEE", attendeeIds: ["att_a"] });
    expect(result.deposit).toMatchObject({ outcome: "STAYS_WITH_REGISTRATION", forfeitedCents: 0 });
  });

  it("evaluates removing every attendee as cancelling the whole registration", () => {
    const result = run(base(), [rules()], { scope: "ATTENDEE", attendeeIds: ["att_b", "att_a"] });
    expect(result.scope).toMatchObject({ requested: "ATTENDEE", effective: "FULL_REGISTRATION" });
    expect(result.capacity.registrationCancelled).toBe(true);
    expect(result.explanation.join(" ")).toContain("whole registration");
  });

  it("refuses removing every attendee when the policy does not allow cancelling the whole registration", () => {
    const only = version({ ...campMeetingPreset("2026-05-25"), allowedScopes: ["ATTENDEE"] });
    const result = run(base(), [only], { scope: "ATTENDEE", attendeeIds: ["att_a", "att_b"] });
    expect(result.status).toBe("SCOPE_NOT_ALLOWED");
    expect(result.money.refundCents).toBe(0);
  });

  it("cancels a supported component on its own and keeps everything else", () => {
    const result = run(base(), [rules()], { scope: "COMPONENT", chargeIds: ["b-meals"] });
    expect(result.status).toBe("CALCULATED");
    expect(result.capacity).toMatchObject({ registrationCancelled: false, componentsReleased: ["b-meals"], attendeesReleased: [] });
    expect(result.lines.find((line) => line.chargeId === "b-meals")).toMatchObject({ category: "MEAL", inScopeCents: 5000 });
    expect(result.lines.find((line) => line.chargeId === "a-reg")?.treatment).toBe("KEPT");
  });

  it("rejects a component the policy does not support", () => {
    const result = run(base(), [rules()], { scope: "COMPONENT", chargeIds: ["a-reg"] });
    expect(result.status).toBe("COMPONENT_NOT_SUPPORTED");
    expect(result.lines).toEqual([]);
  });

  it("rejects selections that are not on the registration", () => {
    expect(run(base(), [rules()], { scope: "ATTENDEE", attendeeIds: ["someone_else"] }).status).toBe("INVALID_SELECTION");
    expect(run(base(), [rules()], { scope: "ATTENDEE", attendeeIds: [] }).status).toBe("INVALID_SELECTION");
    expect(run(base(), [rules()], { scope: "COMPONENT", chargeIds: ["nope"] }).status).toBe("INVALID_SELECTION");
  });

  it("refuses a scope the policy does not allow", () => {
    const only = version({ ...campMeetingPreset("2026-05-25"), allowedScopes: ["FULL_REGISTRATION"] });
    expect(run(base(), [only], { scope: "ATTENDEE", attendeeIds: ["att_a"] }).status).toBe("SCOPE_NOT_ALLOWED");
  });
});

describe("zero-dollar and unusual registrations", () => {
  it("proposes $0 for a free registration without error", () => {
    const result = run(facts({ charges: [charge({ id: "reg", amountCents: 0 })] }), [campMeeting()]);
    expect(result.status).toBe("CALCULATED");
    expect(result.money).toMatchObject({ paidCents: 0, refundCents: 0, retainedCents: 0, unpaidWithholdingCents: 0 });
    expect(result.flatFee?.cents).toBe(0);
    expect(result.totals.chargedCents).toBe(0);
  });

  it("handles a registration with no charge entries at all", () => {
    const result = run(facts({ charges: [] }), [campMeeting()]);
    expect(result.status).toBe("CALCULATED");
    expect(result.lines).toEqual([]);
    expect(result.money.refundCents).toBe(0);
  });

  it("a fully discounted registration with a deposit-equivalent payment forfeits nothing it was not paid", () => {
    const result = run(facts({ charges: [charge({ id: "reg", amountCents: 0 })], depositCents: 0 }), [campMeeting()], full);
    expect(result.deposit.outcome).toBe("NO_DEPOSIT");
  });

  it("does not cancel an already cancelled or draft registration", () => {
    const cancelled = run(facts({ charges: [], registration: { id: "r", confirmationCode: "X", status: "CANCELLED" } }), [campMeeting()]);
    expect(cancelled.status).toBe("NOT_CANCELLABLE");
    expect(run(facts({ charges: [], registration: { id: "r", confirmationCode: "X", status: "DRAFT" } }), [campMeeting()]).status).toBe("NOT_CANCELLABLE");
  });

  it("proposes nothing when the event has no policy version in effect", () => {
    expect(run(facts({ charges: [] }), []).status).toBe("NO_POLICY");
    const future = version(campMeetingPreset("2026-05-25"), { effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    expect(run(facts({ charges: [] }), [future]).status).toBe("NO_POLICY");
  });
});

describe("policy revisions", () => {
  const v1 = version(campMeetingPreset("2026-05-25"), { id: "pv_1", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z") });
  const v2 = version({ ...campMeetingPreset("2026-05-25"), windows: [{ id: "w", label: "Before", endsOn: "2026-05-25", terms: { refund: { kind: "PERCENT", percent: 50 } } }] }, {
    id: "pv_2", version: 2, effectiveFrom: new Date("2026-04-15T00:00:00Z"),
  });
  const charges = [charge({ id: "reg", amountCents: 20_000 })];

  it("uses the version in effect at the evaluation time", () => {
    expect(selectPolicyVersion([v1, v2], new Date("2026-04-14T23:59:59.999Z"))?.version).toBe(1);
    expect(selectPolicyVersion([v1, v2], new Date("2026-04-15T00:00:00.000Z"))?.version).toBe(2);
    expect(selectPolicyVersion([v2, v1], new Date("2026-04-20T00:00:00.000Z"))?.version).toBe(2);
    const early = run(facts({ charges, registrationPaidCents: 20_000, evaluatedAt: "2026-04-10T12:00:00Z" }), [v1, v2]);
    const later = run(facts({ charges, registrationPaidCents: 20_000, evaluatedAt: "2026-04-20T12:00:00Z" }), [v1, v2]);
    expect(early.policy?.version).toBe(1);
    expect(early.money.refundCents).toBe(19_000);
    expect(later.policy?.version).toBe(2);
    expect(later.money.refundCents).toBe(10_000);
  });

  it("lets a higher version supersede every lower one, even if its date is earlier", () => {
    const low = version(campMeetingPreset("2026-05-25"), { id: "low", version: 2, effectiveFrom: new Date("2026-06-01T00:00:00Z") });
    const high = version(campMeetingPreset("2026-05-25"), { id: "high", version: 3, effectiveFrom: new Date("2026-03-01T00:00:00Z") });
    expect(selectPolicyVersion([low, high], new Date("2026-02-01T00:00:00Z"))).toBeNull();
    expect(selectPolicyVersion([low, high], new Date("2026-03-15T00:00:00Z"))?.id).toBe("high");
    // Version 2 arriving later never retakes over from version 3.
    expect(selectPolicyVersion([high, low], new Date("2026-07-01T00:00:00Z"))?.id).toBe("high");
  });

  it("records the policy and the facts used, and a later revision cannot alter a recorded result", () => {
    const f = facts({ charges, registrationPaidCents: 20_000, evaluatedAt: "2026-04-10T12:00:00Z" });
    const recorded = JSON.parse(JSON.stringify(run(f, [v1])));
    expect(recorded.policy).toMatchObject({ versionId: "pv_1", version: 1 });
    expect(recorded.policy.rules.windows[0].terms.flatWithholdCents).toBe(1000);
    expect(recorded.facts).toEqual(JSON.parse(JSON.stringify(f)));
    // A revision lands afterwards; the recorded result is data and does not change, and re-running the old
    // facts at the old time with both versions available still resolves to the version in effect then.
    const rerun = JSON.parse(JSON.stringify(run(f, [v1, v2])));
    expect(rerun).toEqual(recorded);
  });
});

describe("determinism and purity", () => {
  it("returns identical results for identical input and does not modify its input", () => {
    const f = facts({ charges: [charge({ id: "reg", amountCents: 12_345 }), charge({ id: "fee", source: "PRICING_FEE", category: "FEE", fieldKey: null, amountCents: 397 })], registrationPaidCents: 12_742 });
    const versions = [campMeeting()];
    const before = JSON.stringify({ f, versions });
    const one = run(f, versions);
    const two = run(f, versions);
    expect(one).toEqual(two);
    expect(JSON.stringify({ f, versions })).toBe(before);
  });

  it("states that nothing was cancelled, refunded, credited or written", () => {
    const result = run(facts({ charges: [charge({ id: "reg", amountCents: 100 })], registrationPaidCents: 100 }), [campMeeting()]);
    expect(result.sideEffects).toEqual({ cancelled: false, refunded: false, creditCreated: false, ledgerWritten: false });
    expect(result.explanation.at(-1)).toContain("Nothing has been cancelled");
  });

  it("rounds proportional shares half away from zero without losing precision", () => {
    expect(mulDivRound(1050, 10_000, 35_000)).toBe(300);
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
    expect(mulDivRound(5, 1, 3)).toBe(2);
    expect(mulDivRound(10, 5, 0)).toBe(0);
    expect(mulDivRound(9_000_000_000, 9_000_000_000, 9_000_000_000)).toBe(9_000_000_000);
  });
});

describe("rules schema", () => {
  it("requires windows to end on later dates, earliest first, with unique ids", () => {
    const bad = {
      windows: [
        { id: "a", label: "A", endsOn: "2026-06-01", terms: { refund: { kind: "FULL" } } },
        { id: "a", label: "B", endsOn: "2026-05-01", terms: { refund: { kind: "FULL" } } },
      ],
      afterWindows: { label: "After", terms: { refund: { kind: "NONE" } } },
      cardFeeTreatment: "REFUNDABLE",
    };
    const result = (() => { try { parseCancellationRules(bad); return null; } catch (error) { return String(error); } })();
    expect(result).toContain("unique");
    expect(result).toContain("later dates");
  });

  it("rejects impossible dates, percent values outside 1-99 and unknown keys", () => {
    const rules = (terms: unknown, endsOn = "2026-05-25") => ({
      windows: [{ id: "a", label: "A", endsOn, terms }],
      afterWindows: { label: "After", terms: { refund: { kind: "NONE" } } },
      cardFeeTreatment: "REFUNDABLE",
    });
    expect(() => parseCancellationRules(rules({ refund: { kind: "FULL" } }, "2026-02-30"))).toThrow();
    expect(() => parseCancellationRules(rules({ refund: { kind: "PERCENT", percent: 100 } }))).toThrow();
    expect(() => parseCancellationRules(rules({ refund: { kind: "PERCENT", percent: 0 } }))).toThrow();
    expect(() => parseCancellationRules(rules({ refund: { kind: "FULL" }, surprise: true }))).toThrow();
    expect(() => parseCancellationRules({ ...rules({ refund: { kind: "FULL" } }), cardFeeTreatment: undefined })).toThrow();
  });

  it("fills defaults so a minimal policy is complete", () => {
    const parsed = parseCancellationRules({
      windows: [],
      afterWindows: { label: "Always", terms: { refund: { kind: "NONE" } } },
      cardFeeTreatment: "NONREFUNDABLE",
    });
    expect(parsed.allowedScopes).toEqual(["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"]);
    expect(parsed.noShow).toBeNull();
    expect(parsed.afterWindows.terms).toMatchObject({ flatWithholdCents: 0, depositTreatment: "REFUND", creditAllowed: false });
  });

  it("the Camp Meeting preset parses and expresses the rule", () => {
    const parsed = parseCancellationRules(campMeetingPreset("2026-05-25"));
    expect(parsed.windows[0]).toMatchObject({ endsOn: "2026-05-25", terms: { refund: { kind: "FULL" }, flatWithholdCents: 1000, depositTreatment: "REFUND" } });
    expect(parsed.afterWindows.terms.depositTreatment).toBe("FORFEIT");
    expect(parsed.noShow?.terms.depositTreatment).toBe("FORFEIT");
  });
});

describe("forfeitable deposit never includes the card fee", () => {
  const card = { isDeposit: true, amountCents: 10_300, refundedCents: 0, surchargeCents: 300 };

  it("a card deposit of $100 plus a $3 fee forfeits $100, not $103", () => {
    expect(forfeitableDeposit({ payments: [card], configuredCents: 10_000, totalCents: 40_000 })).toEqual({ cents: 10_000, source: "RECORDED_DEPOSIT", cardFeeOnDepositCents: 300 });
  });

  it("a staff check larger than the deposit forfeits only the configured deposit; a fee-free smaller one forfeits what it is", () => {
    expect(forfeitableDeposit({ payments: [{ ...card, amountCents: 12_000, surchargeCents: 0 }], configuredCents: 10_000, totalCents: 40_000 }).cents).toBe(10_000);
    expect(forfeitableDeposit({ payments: [{ ...card, amountCents: 5000, surchargeCents: 0 }], configuredCents: 10_000, totalCents: 40_000 }).cents).toBe(5000);
    expect(forfeitableDeposit({ payments: [{ ...card, amountCents: 5000, surchargeCents: 0 }], configuredCents: null, totalCents: 40_000 }).cents).toBe(5000);
  });

  it("a partially refunded card deposit keeps its fee out; a fully refunded one has nothing to forfeit", () => {
    expect(forfeitableDeposit({ payments: [{ ...card, refundedCents: 2000 }], configuredCents: 10_000, totalCents: 40_000 }).cents).toBe(8000);
    expect(forfeitableDeposit({ payments: [{ ...card, refundedCents: 10_300 }], configuredCents: 10_000, totalCents: 40_000 })).toMatchObject({ cents: 0, source: "NONE" });
  });

  it("when paid in full with no deposit recorded, the configured deposit is capped at net payments without card fees", () => {
    const full = { isDeposit: false, amountCents: 40_900, refundedCents: 0, surchargeCents: 900 };
    expect(forfeitableDeposit({ payments: [full], configuredCents: 10_000, totalCents: 40_900 })).toEqual({ cents: 10_000, source: "PAID_AT_LEAST_DEPOSIT", cardFeeOnDepositCents: 0 });
    expect(forfeitableDeposit({ payments: [{ ...full, amountCents: 2000, surchargeCents: 0 }], configuredCents: 10_000, totalCents: 40_900 }).source).toBe("NONE");
    expect(forfeitableDeposit({ payments: [], configuredCents: 10_000, totalCents: 40_900 }).source).toBe("NONE");
  });

  it("forfeits the $100 deposit and refunds the deposit's card fee under a refundable card fee rule", () => {
    const charges = [charge({ id: "reg", amountCents: 40_000 }), charge({ id: "fee", source: "APPLIED_SURCHARGE", category: "FEE", fieldKey: null, amountCents: 300 })];
    const result = run(
      facts({ charges, registrationPaidCents: 10_300, depositCents: 10_000, depositSource: "RECORDED_DEPOSIT", evaluatedAt: "2026-06-10T15:00:00.000Z" }),
      [campMeeting()],
    );
    expect(result.deposit).toMatchObject({ outcome: "FORFEITED", forfeitedCents: 10_000 });
    expect(result.money.refundCents).toBe(300);
    expect(result.explanation.join(" ")).toContain("$100.00 reservation deposit is forfeited");
  });
});

describe("component selection and capacity", () => {
  const rules = () => version({ ...campMeetingPreset("2026-05-25"), allowedScopes: ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"], supportedComponents: { categories: ["REGISTRATION", "MEAL"], fieldKeys: [] } });
  const charges = [
    charge({ id: "reg", amountCents: 10_000, attendeeId: "att_a" }),
    charge({ id: "disc", amountCents: -500, attendeeId: "att_a" }),
    charge({ id: "zero", amountCents: 0, attendeeId: "att_a" }),
  ];

  it("rejects a discount or zero-dollar charge as a component", () => {
    for (const id of ["disc", "zero"]) {
      expect(run(facts({ charges }), [rules()], { scope: "COMPONENT", chargeIds: [id] }).status).toBe("INVALID_SELECTION");
    }
    expect(run(facts({ charges }), [rules()], { scope: "COMPONENT", chargeIds: ["reg"] }).status).toBe("CALCULATED");
  });

  it("does not let a policy list fees, tax or adjustments as components", () => {
    for (const category of ["FEE", "TAX", "ADJUSTMENT"]) {
      expect(() => parseCancellationRules({ ...campMeetingPreset("2026-05-25"), supportedComponents: { categories: [category], fieldKeys: [] } })).toThrow();
    }
  });

  it("a waitlisted registration releases a waitlist place, not capacity; submitted and confirmed release seats", () => {
    const waitlisted = run(facts({ charges, registration: { id: "r", confirmationCode: "W", status: "WAITLISTED" } }), [rules()]);
    expect(waitlisted.capacity).toEqual({ registrationCancelled: true, attendeesReleased: [], componentsReleased: [], waitlistPlaceReleased: true });
    expect(waitlisted.explanation.join(" ")).toContain("waitlist place");
    const partial = run(facts({ charges, registration: { id: "r", confirmationCode: "W", status: "WAITLISTED" } }), [rules()], { scope: "ATTENDEE", attendeeIds: ["att_a"] });
    expect(partial.capacity).toMatchObject({ attendeesReleased: [], waitlistPlaceReleased: false });
    for (const status of ["SUBMITTED", "CONFIRMED"]) {
      const held = run(facts({ charges, registration: { id: "r", confirmationCode: "S", status } }), [rules()]);
      expect(held.capacity).toMatchObject({ attendeesReleased: ["att_a", "att_b"], waitlistPlaceReleased: false });
    }
  });
});

describe("merchandise money stays with merchandise", () => {
  const merch = (id: string, amountCents: number) => charge({
    id, source: "MERCHANDISE_ORDER", category: "MERCHANDISE", fieldKey: null, amountCents, settledSeparately: true, moneySourceId: `merchandise-order:${id}`,
  });

  it("an unpaid registration with $30 of paid merchandise: the registration's $10 fee is not taken from merchandise money", () => {
    const result = run(facts({ charges: [charge({ id: "reg", amountCents: 20_000 }), merch("m1", 3000)] }), [campMeeting()]);
    expect(result.money.refundCents).toBe(3000);
    expect(result.money.retainedCents).toBe(0);
    expect(result.money.unpaidWithholdingCents).toBe(1000);
    expect(result.money.bySource).toEqual([
      { sourceId: "registration", label: "Registration payments", paidCents: 0, refundCents: 0, retainedCents: 0 },
      { sourceId: "merchandise-order:m1", label: "Merchandise order 1", paidCents: 3000, refundCents: 3000, retainedCents: 0 },
    ]);
  });

  it("splits refunds per merchandise order and the flat fee and deposit come only from registration payments", () => {
    const result = run(
      facts({ charges: [charge({ id: "reg", amountCents: 20_000 }), merch("m1", 3000), merch("m2", 1500)], registrationPaidCents: 6500, depositCents: 6500, depositSource: "RECORDED_DEPOSIT", evaluatedAt: "2026-06-10T15:00:00.000Z" }),
      [campMeeting()],
    );
    expect(result.money.bySource.map((source) => [source.sourceId, source.refundCents, source.retainedCents])).toEqual([
      ["registration", 0, 6500], ["merchandise-order:m1", 3000, 0], ["merchandise-order:m2", 1500, 0],
    ]);
    expect(result.money.refundCents).toBe(4500);
  });

  it("nonrefundable merchandise is kept from its own order's money only", () => {
    const rules = version({ ...campMeetingPreset("2026-05-25"), nonrefundable: { categories: ["MERCHANDISE"], fieldKeys: [] } });
    const result = run(facts({ charges: [charge({ id: "reg", amountCents: 20_000 }), merch("m1", 3000)], registrationPaidCents: 20_000 }), [rules]);
    expect(result.money.bySource.map((source) => [source.refundCents, source.retainedCents])).toEqual([[19_000, 1000], [0, 3000]]);
  });
});

describe("merchandise stays out of registration-only calculations", () => {
  const merch = (amountCents: number) => charge({
    id: "m1", source: "MERCHANDISE_ORDER", category: "MERCHANDISE", fieldKey: null, amountCents, settledSeparately: true, moneySourceId: "merchandise-order:m1",
  });

  it("a free registration with $30 of paid merchandise shows no flat fee withheld, and the totals match the money", () => {
    const result = run(facts({ charges: [charge({ id: "reg", amountCents: 0 }), merch(3000)] }), [campMeeting()]);
    expect(result.flatFee?.cents).toBe(0);
    expect(result.totals).toMatchObject({ chargedCents: 3000, eligibleCents: 3000, withheldCents: 0 });
    expect(result.money).toMatchObject({ paidCents: 3000, refundCents: 3000, retainedCents: 0, unpaidWithholdingCents: 0 });
    expect(result.explanation.join(" ")).not.toContain("including the");
  });

  it("prorates the card fee for one attendee by registration charges only", () => {
    const charges = [
      charge({ id: "a", amountCents: 10_000, attendeeId: "att_a" }),
      charge({ id: "b", amountCents: 10_000, attendeeId: "att_b" }),
      charge({ id: "fee", source: "PRICING_FEE", category: "FEE", fieldKey: null, amountCents: 1000 }),
      merch(20_000),
    ];
    const result = run(facts({ charges, registrationPaidCents: 21_000 }), [campMeeting()], { scope: "ATTENDEE", attendeeIds: ["att_a"] });
    // Half of the registration's price lines, not a quarter of everything: 500 of the 1000 fee.
    expect(result.lines.find((line) => line.chargeId === "fee")?.inScopeCents).toBe(500);
    expect(result.lines.find((line) => line.chargeId === "m1")?.treatment).toBe("KEPT");
  });
});
