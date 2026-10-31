import { calculateCancellation, type CalculationFacts, type CancellationResult, type PolicyVersionRecord } from "@/modules/cancellation-policy/calculator";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";
import { allocateRefund, type PaymentForRefund } from "@/modules/cancellation-execution/domain";

/**
 * The refund calculator self-test (#1374). Pure: it runs the real `calculateCancellation` and `allocateRefund` on a
 * FIXED in-memory policy and fixture (synthetic, no database, no clock) and compares each answer with the figure written
 * down below. If someone changes the money rules by accident, a case stops matching and the System report says so.
 * An intended change to the rules updates the expected figures here in the same change.
 */

/** The only date the fixture needs, pinned so the answers never depend on today. */
const EVALUATED_BEFORE_WINDOW = "2026-05-20T15:00:00.000Z";
const EVALUATED_AFTER_WINDOWS = "2026-06-10T15:00:00.000Z";

const POLICY: PolicyVersionRecord = {
  id: "self-test-policy",
  version: 1,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  rules: parseCancellationRules({
    windows: [
      { id: "early", label: "Early", endsOn: "2026-06-01", terms: { refund: { kind: "PERCENT", percent: 50 }, flatWithholdCents: 1000, flatWithholdLabel: "Processing fee" } },
    ],
    afterWindows: { label: "Late", terms: { refund: { kind: "NONE" } } },
    cardFeeTreatment: "REFUNDABLE",
  }),
};

function facts(evaluatedAt: string, paidCents: number): CalculationFacts {
  return {
    evaluatedAt,
    clock: "SERVER",
    eventTimezone: "America/Chicago",
    registration: { id: "self-test-registration", confirmationCode: "SELFTEST", status: "CONFIRMED" },
    attendees: [{ id: "self-test-attendee", position: 0 }],
    charges: [{ id: "self-test-charge", source: "PRICING_LINE", label: "Registration", amountCents: 20_000, category: "REGISTRATION", fieldKey: "registration", attendeeId: null }],
    registrationPaidCents: paidCents,
    depositCents: 0,
    depositSource: "NONE",
    noShowFirstNight: false,
  };
}

/** The parts of a calculation that decide money, and nothing else. */
function summarize(result: CancellationResult) {
  return {
    status: result.status,
    timing: result.timing?.kind ?? null,
    refundCents: result.money.refundCents,
    retainedCents: result.money.retainedCents,
    withheldCents: result.totals.withheldCents,
  };
}

const calculate = (evaluatedAt: string, paidCents: number) => summarize(calculateCancellation({
  facts: facts(evaluatedAt, paidCents),
  selection: { scope: "FULL_REGISTRATION" },
  policyVersions: [POLICY],
}));

const PAYMENTS: PaymentForRefund[] = [
  { id: "pay-older", receivedAtMs: Date.UTC(2026, 3, 1), refundableCents: 4000 },
  { id: "pay-newer", receivedAtMs: Date.UTC(2026, 4, 1), refundableCents: 3000 },
  { id: "pay-spent", receivedAtMs: Date.UTC(2026, 4, 15), refundableCents: 0 },
];

export type SelfTestCase = { id: string; run: () => unknown; expected: unknown };

export const REFUND_SELF_TEST_CASES: readonly SelfTestCase[] = [
  { id: "calc-inside-window", run: () => calculate(EVALUATED_BEFORE_WINDOW, 20_000), expected: { status: "CALCULATED", timing: "WINDOW", refundCents: 9000, retainedCents: 11_000, withheldCents: 11_000 } },
  { id: "calc-after-windows", run: () => calculate(EVALUATED_AFTER_WINDOWS, 20_000), expected: { status: "CALCULATED", timing: "AFTER_WINDOWS", refundCents: 0, retainedCents: 20_000, withheldCents: 20_000 } },
  { id: "calc-nothing-paid", run: () => calculate(EVALUATED_BEFORE_WINDOW, 0), expected: { status: "CALCULATED", timing: "WINDOW", refundCents: 0, retainedCents: 0, withheldCents: 11_000 } },
  { id: "allocate-newest-first", run: () => allocateRefund(5000, PAYMENTS), expected: { ok: true, legs: [{ paymentId: "pay-newer", amountCents: 3000 }, { paymentId: "pay-older", amountCents: 2000 }] } },
  { id: "allocate-zero", run: () => allocateRefund(0, PAYMENTS), expected: { ok: true, legs: [] } },
  { id: "allocate-more-than-refundable", run: () => allocateRefund(9000, PAYMENTS), expected: { ok: false, coveredCents: 7000 } },
];

export type SelfTestOutcome = { total: number; differing: string[] };

/** Runs every case. A case that throws is not a mismatch: the throw reaches the caller, who reports "unavailable". */
export function runRefundSelfTest(cases: readonly SelfTestCase[] = REFUND_SELF_TEST_CASES): SelfTestOutcome {
  const differing = cases.filter((entry) => JSON.stringify(entry.run()) !== JSON.stringify(entry.expected)).map((entry) => entry.id);
  return { total: cases.length, differing };
}
