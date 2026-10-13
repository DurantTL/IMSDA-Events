import type { ChargeEntry } from "@/modules/cancellation-policy/calculator";

/**
 * How a staff or ledger adjustment becomes a charge entry (#169). The free-text reason is never copied: it can hold
 * personal detail and does not belong in a calculation.
 *
 * A MEAL adjustment (#210) is a meal charge or credit posted by the meal ledger for a staff meal order, so it is a MEAL
 * charge, attributed to the attendee when it has one. That is what lets a policy treat meals as nonrefundable or as a
 * component. A meal ordered on the registration form is priced by the form and posts no adjustment (settlement
 * IN_REGISTRATION_PRICING), so it already appears once, as a form price line; nothing is counted twice.
 */
const kindWords: Record<string, string> = {
  SCHOLARSHIP: "Scholarship",
  DISCOUNT: "Discount",
  PROMO_CODE: "Promo code",
  CORRECTION: "Correction",
  MEAL: "Meal",
};

export function adjustmentCharge(
  adjustment: { id: string; kind: string; amountCents: number; registrationAttendeeId: string | null },
  attendeeIds: readonly string[],
): ChargeEntry {
  const isMeal = adjustment.kind === "MEAL";
  return {
    id: `adjustment:${adjustment.id}`,
    source: "ADJUSTMENT",
    label: isMeal ? "Meal (staff meal order)" : `${kindWords[adjustment.kind] ?? "Adjustment"} (adjustment)`,
    amountCents: adjustment.amountCents,
    category: isMeal ? "MEAL" : "ADJUSTMENT",
    fieldKey: null,
    attendeeId: adjustment.registrationAttendeeId && attendeeIds.includes(adjustment.registrationAttendeeId) ? adjustment.registrationAttendeeId : null,
  };
}
