import { describe, expect, it } from "vitest";
import {
  COST_LABEL_SUGGESTIONS,
  MAX_COST_CENTS,
  budgetCsv,
  computeBudgetTotals,
  costLineInputSchema,
  parseDollarsToCents,
  type BudgetFigures,
  type BudgetSheet,
} from "@/modules/event-budgets/domain";

const figures: BudgetFigures = {
  money: { billedCents: 500_000, churchBilledCents: 120_000, receivedCents: 430_000, outstandingCents: 70_000, refundedCents: 5_000 },
  payingRegistrations: 9,
  feePerPerson: { kind: "uniform", amountCents: 4_500 },
  counts: { pathfinder: 80, tlt: 12, staff: 20, child: 3, total: 115 },
  rooms: null,
  mealsOrdered: null,
};

const sheet = (overrides: Partial<BudgetSheet> = {}): BudgetSheet => {
  const costLines = [{ id: "a", label: "Trophies", description: "=SUM(1)", quantity: 6, amountCents: 30_000 }, { id: "b", label: "Wristbands", description: "", quantity: null, amountCents: 12_550 }];
  return { eventId: "event-1", eventName: "Sample Spring Camporee", figures, costLines, totals: computeBudgetTotals(figures.money, costLines), ...overrides };
};

describe("a cost line (#1682)", () => {
  const good = { label: "Trophies", description: "  First place ", quantity: 6, amountCents: 30_000 };

  it("takes a suggested label, a free description, an optional quantity and an amount in cents", () => {
    expect(costLineInputSchema.parse(good)).toEqual({ label: "Trophies", description: "First place", quantity: 6, amountCents: 30_000 });
    expect(costLineInputSchema.parse({ label: "Other", amountCents: 0 })).toEqual({ label: "Other", description: "", quantity: null, amountCents: 0 });
    expect(COST_LABEL_SUGGESTIONS).toEqual(["Pins", "Trophies", "Ribbons", "Wristbands", "Camporee bars", "Porta-potties", "Staff meals", "Rooms", "Supplies", "Other"]);
  });

  it("refuses a negative, fractional or oversized amount", () => {
    for (const amountCents of [-1, 12.5, MAX_COST_CENTS + 1, Number.NaN]) expect(costLineInputSchema.safeParse({ ...good, amountCents }).success).toBe(false);
    expect(costLineInputSchema.safeParse({ ...good, amountCents: MAX_COST_CENTS }).success).toBe(true);
  });

  it("refuses a label that is not a suggestion, a bad quantity, and any field the sheet does not have (no receipt)", () => {
    expect(costLineInputSchema.safeParse({ ...good, label: "Hot air balloon" }).success).toBe(false);
    for (const quantity of [0, -2, 1.5, 100_001]) expect(costLineInputSchema.safeParse({ ...good, quantity }).success).toBe(false);
    expect(costLineInputSchema.safeParse({ ...good, receipt: "file.pdf" }).success).toBe(false);
    expect(costLineInputSchema.safeParse({ ...good, description: "x".repeat(201) }).success).toBe(false);
  });

  it("turns typed dollars into cents", () => {
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("$1,200.05")).toBe(120_005);
    for (const text of ["", "abc", "-3", "1.234", "1e3", "12.5.0"]) expect(parseDollarsToCents(text)).toBeNull();
  });
});

describe("the totals (#1682)", () => {
  it("shows billed and received income apart, each minus the same costs", () => {
    const totals = computeBudgetTotals(figures.money, [{ amountCents: 30_000 }, { amountCents: 12_550 }]);
    expect(totals).toEqual({
      incomeBilledCents: 620_000,
      incomeReceivedCents: 430_000,
      costsCents: 42_550,
      netBilledCents: 577_450,
      netReceivedCents: 387_450,
    });
  });

  it("goes negative when costs are higher than income, and is all zero for an empty sheet", () => {
    expect(computeBudgetTotals({ ...figures.money, billedCents: 0, churchBilledCents: 0, receivedCents: 0 }, [{ amountCents: 100 }]).netBilledCents).toBe(-100);
    expect(computeBudgetTotals({ billedCents: 0, churchBilledCents: 0, receivedCents: 0, outstandingCents: 0, refundedCents: 0 }, [])).toEqual({ incomeBilledCents: 0, incomeReceivedCents: 0, costsCents: 0, netBilledCents: 0, netReceivedCents: 0 });
  });
});

describe("the CSV for the conference (#1682)", () => {
  it("holds totals, counts and cost lines in dollars, and hides a figure whose module is off", () => {
    const csv = budgetCsv(sheet(), { kind: "none" });
    expect(csv).toContain('"Total costs","","","425.5"');
    expect(csv).toContain('"Income minus costs (billed)","","","5774.5"');
    expect(csv).toContain('"Pathfinders","","80",""');
    expect(csv).not.toContain("Rooms");
    expect(csv).not.toContain("Meals ordered");
    expect(budgetCsv(sheet({ figures: { ...figures, rooms: 14, mealsOrdered: 380 } }), { kind: "none" })).toContain('"Rooms","","14",""');
  });

  it("guards a description that looks like a formula, and carries no personal data columns", () => {
    const csv = budgetCsv(sheet(), { kind: "none" });
    expect(csv).toContain("'=SUM(1)");
    expect(csv.split("\r\n")[0]).toBe('"Budget sheet","Sample Spring Camporee","",""');
    expect(csv).not.toMatch(/email|phone|confirmation|@/i);
  });

  it("follows with last year's sheet, or says there was none", () => {
    const last = sheet({ eventId: "event-0", eventName: "Last Year Camporee" });
    expect(budgetCsv(sheet(), { kind: "sheet", sourceEventId: "event-0", sourceEventName: "Last Year Camporee", sheet: last })).toContain('"Last year","Last Year Camporee"');
    expect(budgetCsv(sheet(), { kind: "no-sheet", sourceEventId: "event-0", sourceEventName: "Last Year Camporee" })).toContain("No budget sheet was kept");
  });
});
