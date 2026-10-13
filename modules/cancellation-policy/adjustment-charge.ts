import type { ChargeEntry } from "@/modules/cancellation-policy/calculator";
import { mealTicketFieldKeys } from "@/modules/meals/domain";

/**
 * How staff and ledger adjustments become charge entries (#169). The free-text reason is never copied: it can hold
 * personal detail and does not belong in a calculation.
 *
 * Meals (#210): a staff meal order posts a MEAL adjustment per ledger entry, and cancelling or reducing it posts an
 * opposite one. So MEAL adjustments are netted per meal selection into ONE charge (component id `meal:<selectionId>`),
 * attributed to the selection's attendee; a selection that nets to $0 is dropped, because charge and credit cancel and
 * the registrant owes and is owed nothing for it. A meal ordered on the registration form is priced by the form and
 * posts no adjustment, so it already appears once, as a form price line (classified as a meal by `mealFieldKeys`).
 */
const kindWords: Record<string, string> = {
  SCHOLARSHIP: "Scholarship",
  DISCOUNT: "Discount",
  PROMO_CODE: "Promo code",
  CORRECTION: "Correction",
  MEAL: "Meal",
};

export type AdjustmentRow = {
  id: string;
  kind: string;
  amountCents: number;
  registrationAttendeeId: string | null;
  /** The meal ledger entry that posted this adjustment, when there is one. */
  mealLedgerEntry?: { selectionId: string; mealType: string; selection: { registrationAttendeeId: string | null } } | null;
};

function attendeeOf(id: string | null, attendeeIds: readonly string[]) {
  return id && attendeeIds.includes(id) ? id : null;
}

export function adjustmentCharge(adjustment: AdjustmentRow, attendeeIds: readonly string[]): ChargeEntry {
  const isMeal = adjustment.kind === "MEAL";
  return {
    id: `adjustment:${adjustment.id}`,
    source: "ADJUSTMENT",
    label: isMeal ? "Meal (staff meal order)" : `${kindWords[adjustment.kind] ?? "Adjustment"} (adjustment)`,
    amountCents: adjustment.amountCents,
    category: isMeal ? "MEAL" : "ADJUSTMENT",
    fieldKey: null,
    attendeeId: attendeeOf(adjustment.registrationAttendeeId, attendeeIds),
  };
}

/** Every adjustment as a charge entry, with linked MEAL adjustments netted per meal selection. */
export function adjustmentCharges(adjustments: readonly AdjustmentRow[], attendeeIds: readonly string[]): ChargeEntry[] {
  const entries: ChargeEntry[] = [];
  const meals = new Map<string, { entry: ChargeEntry; index: number }>();
  for (const adjustment of adjustments) {
    const link = adjustment.kind === "MEAL" ? adjustment.mealLedgerEntry : null;
    if (!link) {
      entries.push(adjustmentCharge(adjustment, attendeeIds));
      continue;
    }
    const existing = meals.get(link.selectionId);
    if (existing) {
      existing.entry.amountCents += adjustment.amountCents;
      continue;
    }
    const entry: ChargeEntry = {
      id: `meal:${link.selectionId}`,
      source: "ADJUSTMENT",
      label: `Meal: ${link.mealType.toLowerCase()} (staff order)`,
      amountCents: adjustment.amountCents,
      category: "MEAL",
      fieldKey: null,
      attendeeId: attendeeOf(link.selection.registrationAttendeeId ?? adjustment.registrationAttendeeId, attendeeIds),
    };
    meals.set(link.selectionId, { entry, index: entries.length });
    entries.push(entry);
  }
  // A selection whose charge and credits cancel owes nothing either way.
  const dropped = new Set([...meals.values()].filter(({ entry }) => entry.amountCents === 0).map(({ entry }) => entry));
  return entries.filter((entry) => !dropped.has(entry));
}

/** The form fields that are meal tickets: the keys the meals module binds, plus any key a form-ticket selection came from. */
export function mealFieldKeySet(selectionFieldKeys: readonly (string | null)[]) {
  const keys = new Set<string>(mealTicketFieldKeys.map(([key]) => key));
  for (const key of selectionFieldKeys) if (key) keys.add(key);
  return keys;
}
