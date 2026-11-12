import { formatPersonName } from "@/lib/person-name";
import { perPersonPriceFromSnapshot } from "@/modules/club-registrations/per-person-price";
import { clubHeadcounts, type ClubRosterAttendee } from "@/modules/reporting/club-event-reports";
import { activeFinancialStatuses, summarizeFinanceTotals, type FinanceViewRegistration } from "@/modules/registrations/finance-view";
import type { BudgetFigures, FeePerPerson } from "@/modules/event-budgets/domain";

/**
 * The figures on the Budget sheet that fill in by themselves (#1682). Every number is the answer of the function Finance or the
 * reports already use, called on the same data, and never worked out a second time here:
 *   - money: `summarizeFinanceTotals` over all of the event's registrations, as the Finance page does;
 *   - fee per person: `perPersonPriceFromSnapshot` (which calls `perPersonPrice`) on each active, paying registration;
 *   - head counts: `clubHeadcounts` over the attendees the club event report is built from;
 *   - rooms: the lodging view's units; meals ordered: the meals view's totals. Each is hidden when its module is not set up.
 * The only counting done here is of rows those functions return.
 */

export type FigureRegistration = FinanceViewRegistration & {
  attendees: ReadonlyArray<{ firstName: string; lastName: string }>;
  publicSubmission: { pricingSnapshot?: unknown } | null;
};

export type FigureLodging = {
  property: unknown | null;
  buildings: ReadonlyArray<{ units: ReadonlyArray<{ isArea: boolean; assignable: boolean; retired: boolean; unavailable: boolean }> }>;
};

export type FigureMeals = {
  services: ReadonlyArray<unknown>;
  plans: ReadonlyArray<unknown>;
  totals: ReadonlyArray<{ quantity: number }>;
};

export type FigureInputs = {
  /** Every registration of the event, as the Finance page lists them. */
  registrations: ReadonlyArray<FigureRegistration>;
  /** The attendees of the active club registrations, as the club event report lists them. */
  attendees: ClubRosterAttendee[];
  lodging: FigureLodging;
  meals: FigureMeals;
};

/** One amount when every paying registration's per-person price agrees, the range when they differ, nothing when no price is on record. */
export function feePerPersonOf(registrations: ReadonlyArray<FigureRegistration>): FeePerPerson {
  const amounts = new Set<number>();
  for (const registration of registrations) {
    if (!activeFinancialStatuses.has(registration.status) || registration.totalAmountCents <= 0) continue;
    const price = perPersonPriceFromSnapshot(
      registration.publicSubmission?.pricingSnapshot,
      undefined,
      registration.attendees.map((attendee) => formatPersonName(attendee)),
    );
    if (price.uniformAmountCents !== null) amounts.add(price.uniformAmountCents);
    for (const line of price.attendeeLines) amounts.add(line.amountCents);
  }
  if (amounts.size === 0) return { kind: "none" };
  const sorted = [...amounts].sort((a, b) => a - b);
  if (sorted.length === 1) return { kind: "uniform", amountCents: sorted[0]! };
  return { kind: "varies", lowCents: sorted[0]!, highCents: sorted[sorted.length - 1]! };
}

export function buildBudgetFigures(input: FigureInputs): BudgetFigures {
  const totals = summarizeFinanceTotals(input.registrations);
  return {
    money: {
      billedCents: totals.billed,
      churchBilledCents: totals.churchBilled,
      receivedCents: totals.received,
      outstandingCents: totals.outstanding,
      refundedCents: totals.refunded,
    },
    payingRegistrations: input.registrations.filter((registration) => activeFinancialStatuses.has(registration.status) && registration.totalAmountCents > 0).length,
    feePerPerson: feePerPersonOf(input.registrations),
    counts: clubHeadcounts(input.attendees),
    rooms: input.lodging.property === null
      ? null
      : input.lodging.buildings.reduce((count, building) => count + building.units.filter((unit) => !unit.isArea && unit.assignable && !unit.retired && !unit.unavailable).length, 0),
    mealsOrdered: input.meals.services.length === 0 && input.meals.plans.length === 0
      ? null
      : input.meals.totals.reduce((count, row) => count + row.quantity, 0),
  };
}
