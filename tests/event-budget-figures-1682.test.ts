import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRegistrations: vi.fn(),
  getClubEventRecords: vi.fn(),
  getLodgingView: vi.fn(),
  loadMealView: vi.fn(),
  lineFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: mocks.listRegistrations }));
vi.mock("@/modules/reporting/club-event-reports-repository", () => ({ getClubEventRecords: mocks.getClubEventRecords }));
vi.mock("@/modules/lodging/service", () => ({ getLodgingView: mocks.getLodgingView }));
vi.mock("@/modules/meals/view-repository", () => ({ loadMealView: mocks.loadMealView }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ eventBudgetCostLine: { findMany: mocks.lineFindMany } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/event-budgets/access", () => ({ assertBudgetAccess: vi.fn(), canReadSourceBudget: vi.fn(), BudgetError: class extends Error {} }));

import { perPersonPrice } from "@/modules/club-registrations/per-person-price";
import { activeFinancialStatuses, summarizeFinanceTotals } from "@/modules/registrations/finance-view";
import { clubHeadcounts, type ClubRosterAttendee } from "@/modules/reporting/club-event-reports";
import { computeBudgetTotals } from "@/modules/event-budgets/domain";
import { buildBudgetFigures, feePerPersonOf, type FigureRegistration } from "@/modules/event-budgets/figures";
import { loadBudgetFigures, loadBudgetSheet } from "@/modules/event-budgets/repository";

/**
 * The figures that fill in by themselves must equal Finance's and the reports' own answers for the same data (#1682).
 * Each expectation below calls the source function directly on the same synthetic data.
 */

const snapshot = (amounts: number[]) => ({
  rosterEnabled: true,
  attendeeCount: amounts.length,
  lineItems: amounts.map((amountCents, attendeeIndex) => ({ label: "Registration fee", amountCents, attendeeIndex, attendeeLabel: `Person ${attendeeIndex + 1}` })),
});

function registration(overrides: Partial<FigureRegistration> & { status: string; totalAmountCents: number }): FigureRegistration {
  return {
    paidCents: 0,
    balanceCents: overrides.totalAmountCents - (overrides.paidCents ?? 0),
    payments: [],
    attendees: [{ firstName: "Sample", lastName: "One" }, { firstName: "Sample", lastName: "Two" }],
    publicSubmission: { pricingSnapshot: snapshot([4500, 4500]) },
    ...overrides,
  };
}

const registrations: FigureRegistration[] = [
  registration({ status: "CONFIRMED", totalAmountCents: 9000, paidCents: 9000, balanceCents: 0, payments: [{ refundedCents: 0 }] }),
  registration({ status: "SUBMITTED", totalAmountCents: 9000, paidCents: 4000, payments: [{ refundedCents: 500 }] }),
  registration({ status: "CONFIRMED", totalAmountCents: 13_500, isDeferredOrganizationBilling: true, publicSubmission: { pricingSnapshot: snapshot([4500, 4500, 4500]) }, attendees: [{ firstName: "A", lastName: "B" }, { firstName: "C", lastName: "D" }, { firstName: "E", lastName: "F" }] }),
  registration({ status: "CONFIRMED", totalAmountCents: 0, publicSubmission: { pricingSnapshot: snapshot([0, 0]) } }),
  registration({ status: "CANCELLED", totalAmountCents: 9000, paidCents: 9000, balanceCents: 0, payments: [{ refundedCents: 9000 }] }),
  registration({ status: "WAITLISTED", totalAmountCents: 9000 }),
];

const attendee = (id: string, role: ClubRosterAttendee["role"], youthGuest = false): ClubRosterAttendee => ({
  id, firstName: "Sample", lastName: id, role, youthGuest, ageOnEventDate: 12, gender: null, medicalPersonnel: false, masterGuideInvestiture: false, firstTimeCamper: false, hasDietaryNeed: false,
});
const attendees = [attendee("a", "Pathfinder"), attendee("b", "Pathfinder"), attendee("c", "TLT"), attendee("d", "Staff"), attendee("e", "Staff"), attendee("f", "Child"), attendee("g", "Pathfinder", true), attendee("h", null)];

const lodging = { property: { key: "camp" }, buildings: [{ units: [
  { isArea: false, assignable: true, retired: false, unavailable: false },
  { isArea: false, assignable: true, retired: false, unavailable: false },
  { isArea: false, assignable: true, retired: false, unavailable: true },
  { isArea: false, assignable: false, retired: false, unavailable: false },
  { isArea: true, assignable: true, retired: false, unavailable: false },
] }] };
const meals = { services: [{}], plans: [{}], totals: [{ quantity: 120 }, { quantity: 45 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRegistrations.mockResolvedValue(registrations);
  mocks.getClubEventRecords.mockResolvedValue({ clubs: [{ attendees: attendees.slice(0, 5) }, { attendees: attendees.slice(5) }] });
  mocks.getLodgingView.mockResolvedValue(lodging);
  mocks.loadMealView.mockResolvedValue(meals);
  mocks.lineFindMany.mockResolvedValue([{ id: "l1", label: "Trophies", description: "", quantity: null, amountCents: 20_000 }]);
});

describe("the auto-filled figures equal the source functions' output (#1682)", () => {
  it("money equals the Finance page's own totals over the same registrations", () => {
    const finance = summarizeFinanceTotals(registrations);
    const { money } = buildBudgetFigures({ registrations, attendees, lodging, meals });
    expect(money).toEqual({ billedCents: finance.billed, churchBilledCents: finance.churchBilled, receivedCents: finance.received, outstandingCents: finance.outstanding, refundedCents: finance.refunded });
    // The synthetic data really exercises each branch: a church-billed row, a partial payment, a refund, and rows that are not active.
    expect(finance).toMatchObject({ billed: 18_000, churchBilled: 13_500, received: 22_000 + 0, refunded: 9500 });
  });

  it("paying registrations are the active ones with a total above zero", () => {
    const expected = registrations.filter((row) => activeFinancialStatuses.has(row.status) && row.totalAmountCents > 0).length;
    expect(expected).toBe(3);
    expect(buildBudgetFigures({ registrations, attendees, lodging, meals }).payingRegistrations).toBe(expected);
  });

  it("the fee per person is perPersonPrice's answer, and shows a range only when prices differ", () => {
    const direct = perPersonPrice({ lineItems: snapshot([4500, 4500]).lineItems, roster: true, attendeeNames: ["Sample One", "Sample Two"] });
    expect(direct.uniformAmountCents).toBe(4500);
    expect(feePerPersonOf(registrations)).toEqual({ kind: "uniform", amountCents: direct.uniformAmountCents });
    const mixed = [...registrations, registration({ status: "CONFIRMED", totalAmountCents: 5000, publicSubmission: { pricingSnapshot: snapshot([2500, 2500]) } })];
    expect(feePerPersonOf(mixed)).toEqual({ kind: "varies", lowCents: 2500, highCents: 4500 });
    expect(feePerPersonOf([registration({ status: "CONFIRMED", totalAmountCents: 100, publicSubmission: null })])).toEqual({ kind: "none" });
    expect(feePerPersonOf([])).toEqual({ kind: "none" });
  });

  it("head counts equal clubHeadcounts over the same attendees", () => {
    const { counts } = buildBudgetFigures({ registrations, attendees, lodging, meals });
    expect(counts).toEqual(clubHeadcounts(attendees));
    expect(counts).toEqual({ pathfinder: 2, tlt: 1, staff: 2, child: 2, total: 8 });
  });

  it("rooms are the lodging view's assignable rooms, and meals the meals view's totals; each is hidden when its module is not set up", () => {
    const figures = buildBudgetFigures({ registrations, attendees, lodging, meals });
    expect(figures.rooms).toBe(2);
    expect(figures.mealsOrdered).toBe(165);
    const off = buildBudgetFigures({ registrations, attendees, lodging: { property: null, buildings: [] }, meals: { services: [], plans: [], totals: [] } });
    expect(off.rooms).toBeNull();
    expect(off.mealsOrdered).toBeNull();
  });
});

describe("the loader asks the same functions Finance and the reports ask (#1682)", () => {
  it("lists every registration as the Finance page does, takes attendees from the club event records, and asks lodging and meals for the event", async () => {
    const figures = await loadBudgetFigures("event-1");
    expect(mocks.listRegistrations).toHaveBeenCalledWith("event-1");
    expect(mocks.getClubEventRecords).toHaveBeenCalledWith("event-1");
    expect(mocks.getLodgingView).toHaveBeenCalledWith("event-1");
    expect(mocks.loadMealView).toHaveBeenCalledWith("event-1");
    expect(figures).toEqual(buildBudgetFigures({ registrations, attendees: attendees.slice(0, 5).concat(attendees.slice(5)), lodging, meals }));
  });

  it("the sheet's totals are the cost lines against those same figures", async () => {
    const sheet = await loadBudgetSheet("event-1", "Sample Spring Camporee");
    const finance = summarizeFinanceTotals(registrations);
    expect(sheet.totals).toEqual(computeBudgetTotals(sheet.figures.money, sheet.costLines));
    expect(sheet.totals.incomeBilledCents).toBe(finance.billed + finance.churchBilled);
    expect(sheet.totals.incomeReceivedCents).toBe(finance.received);
    expect(sheet.totals.costsCents).toBe(20_000);
  });
});
