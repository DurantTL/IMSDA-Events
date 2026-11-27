import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { formatPerPersonAmount, NO_COST_NOTICE, type PerPersonPrice } from "@/modules/club-registrations/per-person-price";

/**
 * Who a bill-later registration tells the registrant is billed (Music Fest
 * 2027 wording fix). Most bill-later events bill a church, and their wording
 * stays as it is. A school-billed form (Music Festival, Outdoor School) says
 * the school is billed instead.
 *
 * The event's audience and billing mode are shared with church-billed events,
 * so neither decides this. The form does: the invoice goes to the answer in its
 * `responsible_organization` question (the same reading the staff invoice uses,
 * `resolveResponsibleOrganization`), and a school-billed form labels that
 * question as a school. Display only: prices, the billing mode and the invoice
 * recipient are unchanged.
 */

export type BilledOrganization =
  | { kind: "CHURCH" }
  | { kind: "SCHOOL"; eventNoun: "festival" | "event" };

export const CHURCH_BILLED_ORGANIZATION: BilledOrganization = { kind: "CHURCH" };

/** "The school will be billed after the festival. No payment is due online." */
export function schoolBilledSentence(billed: Extract<BilledOrganization, { kind: "SCHOOL" }>) {
  return `The school will be billed after the ${billed.eventNoun}. No payment is due online.`;
}

/** The invoice timing on the review step for a school-billed form. */
export function schoolInvoiceTiming(billed: Extract<BilledOrganization, { kind: "SCHOOL" }>) {
  return `The school will be billed after the ${billed.eventNoun}.`;
}

/**
 * SCHOOL only when the form asks for the responsible organization with a
 * registration-level question whose label names a school ("School name").
 * Everything else, including a GENERAL bill-later event, stays CHURCH.
 */
export function billedOrganization(
  definition: Pick<RegistrationFormDefinition, "title" | "sections">,
  options: { eventName?: string | null } = {},
): BilledOrganization {
  const recipientField = definition.sections
    .flatMap((section) => section.fields)
    .find((field) => field.key === "responsible_organization" && field.scope === "REGISTRATION");
  if (!recipientField || !/\bschool\b/i.test(recipientField.label)) return CHURCH_BILLED_ORGANIZATION;
  const named = `${options.eventName ?? ""} ${definition.title}`;
  return { kind: "SCHOOL", eventNoun: /\bfest(ival)?\b/i.test(named) ? "festival" : "event" };
}

/**
 * The per-person price with its notice in the billed organization's words. A
 * church keeps the notice it has. For a school the per-person amount stays
 * when every person costs the same nonzero amount, "Prices are per person"
 * stays when amounts differ (their lines stay listed), and a $0 or empty
 * roster says only who is billed, never "No cost to you": a person whose
 * attendee type is not chosen yet is priced at $0 before they are.
 */
export function priceForBilledOrganization(price: PerPersonPrice, billed: BilledOrganization): PerPersonPrice {
  if (billed.kind === "CHURCH" || price.notice === NO_COST_NOTICE) return price;
  const sentence = schoolBilledSentence(billed);
  if (!price.roster) return { ...price, notice: sentence };
  if (price.attendeeLines.length > 0) return { ...price, notice: `Prices are per person. ${sentence}` };
  if (price.uniformAmountCents !== null && price.uniformAmountCents > 0) {
    return { ...price, notice: `${formatPerPersonAmount(price.uniformAmountCents)} per person. ${sentence}` };
  }
  return { ...price, notice: sentence };
}
