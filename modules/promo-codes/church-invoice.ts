/**
 * Invoices for church-sponsored promo codes (#399). Pure rules, free of database access, so the draft builder, the
 * finalization check, the church report and the tests agree.
 *
 * Owner decision (Caleb, Oct 14, 2026): a church is invoiced for what its code covered, through the organization
 * invoicing built for Camporee (#165-#168). Staff prepare a DRAFT from the code's redemptions (the lines
 * `listChurchSponsoredPromoLines` already counts: #545); the office finalizes and sends it, which stays a named human
 * action (the Finalize invoices permission). Nothing here finalizes or sends anything.
 *
 * One invoice per church per event. Its lines are the billed redemptions (a whole-registration code, or one person's
 * per-person or staff-applied code), each at the amount the church owes for it, in whole cents. The invoice has no
 * attendance behind it, so it carries no reconciliation: the lines are the facts, and a draft is stale when the lines
 * are no longer the lines now (compared by the same amounts fingerprint the other invoices use).
 */

import type { InvoiceFigures, InvoiceLine, InvoiceSnapshot } from "@/modules/invoices/domain";
import { amountsFingerprintOf, contactsMatch } from "@/modules/invoices/domain";
import { billedSponsoredLines, type ChurchSponsoredPromoLine } from "@/modules/promo-codes/church-sponsored";

/** The invoice group key of a church's promo code invoice on an event: disjoint from the Camporee group keys. */
export const CHURCH_PROMO_GROUP_KEY_PREFIX = "church-promo:";

export function churchPromoGroupKey(churchId: string) {
  return `${CHURCH_PROMO_GROUP_KEY_PREFIX}${churchId}`;
}

/** The church a group key names, or null when it is not a church promo code group key. */
export function churchIdOfPromoGroupKey(groupKey: string) {
  return groupKey.startsWith(CHURCH_PROMO_GROUP_KEY_PREFIX) && groupKey.length > CHURCH_PROMO_GROUP_KEY_PREFIX.length
    ? groupKey.slice(CHURCH_PROMO_GROUP_KEY_PREFIX.length)
    : null;
}

export const CHURCH_PROMO_LINE_LABEL = "Sponsored registration";
export const CHURCH_PROMO_LINE_DESCRIPTION = "Promo discount covered by the church";

/**
 * One billed redemption as an invoice line. The printed row is the line's label, the description of its single charge,
 * a quantity of one, and the amount; the promo code and the confirmation code are kept in the snapshot for staff and are
 * never printed (a code may be private, and an invoice names no attendee).
 */
export function churchPromoInvoiceLine(line: ChurchSponsoredPromoLine): InvoiceLine {
  return {
    registrationId: line.lineId,
    confirmationCode: line.confirmationCode,
    label: CHURCH_PROMO_LINE_LABEL,
    clubId: null,
    counts: { registered: 1, checkedIn: 0, noShow: 0, addedByStaff: 0, removedByStaff: 0, billable: 1 },
    basis: "PER_PERSON_LINES",
    people: [],
    chargesNotTiedToPerson: [{ label: CHURCH_PROMO_LINE_DESCRIPTION, amountCents: line.amountCents, kind: "CHARGE" }],
    credits: [],
    promo: null,
    adjustmentCents: 0,
    components: { personChargesCents: 0, registrationChargeCents: line.amountCents, creditCents: 0, promoCents: 0, adjustmentCents: 0 },
    amountCents: line.amountCents,
  };
}

/** The lines of one church that the invoice bills: billed statuses only, positive amounts, in the reporting order. */
export function churchInvoiceLines(lines: readonly ChurchSponsoredPromoLine[], churchId: string) {
  return billedSponsoredLines(lines.filter((line) => line.churchId === churchId));
}

export function buildChurchPromoInvoiceFigures(input: {
  event: { id: string; name: string };
  church: { id: string; name: string };
  lines: readonly ChurchSponsoredPromoLine[];
}): InvoiceFigures {
  const invoiceLines = churchInvoiceLines(input.lines, input.church.id).map(churchPromoInvoiceLine);
  const amountDueCents = invoiceLines.reduce((total, line) => total + line.amountCents, 0);
  const title = `${input.church.name} promo codes`;
  const snapshot: InvoiceSnapshot = {
    schema: 1,
    kind: "CHURCH_PROMO_CODES",
    event: input.event,
    groupKey: churchPromoGroupKey(input.church.id),
    groupTitle: title,
    invoiceGrouping: "PER_CHURCH",
    party: { kind: "ORGANIZATION", id: input.church.id, name: input.church.name },
    clubId: null,
    reconciliation: null,
    lines: invoiceLines,
    totals: { registered: invoiceLines.length, checkedIn: 0, noShow: 0, billable: invoiceLines.length, amountDueCents },
  };
  return {
    snapshot,
    groupTitle: title,
    organizationName: input.church.name,
    registeredCount: invoiceLines.length,
    billableCount: invoiceLines.length,
    amountDueCents,
    amountsFingerprint: amountsFingerprintOf(invoiceLines, amountDueCents),
  };
}

// ---------------------------------------------------------------------------------------------
// The church report
// ---------------------------------------------------------------------------------------------

export type ChurchInvoiceState =
  /** Nothing billable and no invoice. */
  | "NOTHING_TO_INVOICE"
  /** Billable lines and no invoice yet. */
  | "NO_INVOICE"
  | "DRAFT_CURRENT"
  /** The open draft no longer matches the lines: refresh it. */
  | "DRAFT_STALE"
  | "FINALIZED_CURRENT"
  /** The finalized invoice no longer matches the lines: refreshing starts a revision draft. */
  | "FINALIZED_STALE";

/** What the church's invoice looks like to the report: the live finalized version, the open draft, and the money recorded against the invoice. */
export type ChurchInvoiceFacts = {
  invoiceId: string;
  baseNumber: string | null;
  finalized: { versionId: string; number: string; amountDueCents: number; amountsFingerprint: string } | null;
  draft: { versionId: string; revision: number; amountDueCents: number; amountsFingerprint: string; contactName: string | null; contactEmail: string | null } | null;
  /** Payments less reversals recorded against the invoice, in cents (never below zero in `paidCents`). */
  paidCents: number;
};

export type ChurchCodeReportRow = {
  churchId: string;
  churchName: string;
  /** The codes this church sponsors on the event, with how many times each has been used. */
  codes: Array<{ id: string; code: string; isActive: boolean; redeemedCount: number; maximumUses: number | null }>;
  /** Who used the code: one line per billed redemption, by confirmation code (never a name). */
  lines: ChurchSponsoredPromoLine[];
  /** What the codes covered: the billed lines added up. */
  coveredCents: number;
  /** What the live finalized invoice bills; 0 until one is finalized. */
  invoicedCents: number;
  paidCents: number;
  /** Invoiced and not yet paid: what the church owes on its finalized invoice (never below zero). */
  owedOnInvoiceCents: number;
  /** Covered but not on the finalized invoice yet (positive), or on it but no longer covered (negative). */
  notInvoicedCents: number;
  overpaidCents: number;
  state: ChurchInvoiceState;
  invoiceId: string | null;
  invoiceNumber: string | null;
  draftAmountCents: number | null;
  contact: { name: string; email: string; verified: boolean } | null;
};

export function churchInvoiceState(input: {
  figures: Pick<InvoiceFigures, "amountsFingerprint" | "amountDueCents">;
  invoice: ChurchInvoiceFacts | null;
  /** The church's billing contact now: a draft carrying another contact is out of date too (refreshing picks the current one up). */
  contact?: { name: string; email: string } | null;
}): ChurchInvoiceState {
  const { figures, invoice } = input;
  if (!invoice || (!invoice.draft && !invoice.finalized)) return figures.amountDueCents > 0 ? "NO_INVOICE" : "NOTHING_TO_INVOICE";
  if (invoice.draft) {
    const sameLines = invoice.draft.amountsFingerprint === figures.amountsFingerprint;
    const sameContact = contactsMatch(invoice.draft, input.contact ?? null);
    return sameLines && sameContact ? "DRAFT_CURRENT" : "DRAFT_STALE";
  }
  return invoice.finalized!.amountsFingerprint === figures.amountsFingerprint ? "FINALIZED_CURRENT" : "FINALIZED_STALE";
}

/**
 * Whether a church draft would be refused at finalization as stale: its lines differ from the redemptions now (DRAFT_STALE),
 * or the church's billing contact is not the one the draft carries (CONTACT_STALE). The invoice screen uses the same
 * `contactsMatch` as the report, so it never offers Finalize for a draft the server would refuse. `now` is null when the
 * church or event can no longer be read.
 */
export function churchDraftIsStale(input: {
  draft: Pick<InvoiceFigures, "amountsFingerprint"> & { contactName: string | null; contactEmail: string | null };
  now: { eligible: boolean; amountsFingerprint: string; contact: { name: string; email: string } | null } | null;
}) {
  const { draft, now } = input;
  if (!now || !now.eligible) return true;
  return draft.amountsFingerprint !== now.amountsFingerprint || !contactsMatch(draft, now.contact);
}

export function buildChurchCodeReportRow(input: {
  event: { id: string; name: string };
  church: { id: string; name: string };
  codes: ChurchCodeReportRow["codes"];
  lines: readonly ChurchSponsoredPromoLine[];
  invoice: ChurchInvoiceFacts | null;
  contact: ChurchCodeReportRow["contact"];
}): ChurchCodeReportRow {
  const figures = buildChurchPromoInvoiceFigures({ event: input.event, church: input.church, lines: input.lines });
  const invoicedCents = input.invoice?.finalized?.amountDueCents ?? 0;
  const paidCents = input.invoice?.finalized ? Math.max(input.invoice.paidCents, 0) : 0;
  return {
    churchId: input.church.id,
    churchName: input.church.name,
    codes: input.codes,
    lines: churchInvoiceLines(input.lines, input.church.id),
    coveredCents: figures.amountDueCents,
    invoicedCents,
    paidCents,
    owedOnInvoiceCents: Math.max(invoicedCents - paidCents, 0),
    notInvoicedCents: figures.amountDueCents - invoicedCents,
    overpaidCents: Math.max(paidCents - invoicedCents, 0),
    state: churchInvoiceState({ figures, invoice: input.invoice, contact: input.contact }),
    invoiceId: input.invoice?.invoiceId ?? null,
    invoiceNumber: input.invoice?.finalized?.number ?? null,
    draftAmountCents: input.invoice?.draft?.amountDueCents ?? null,
    contact: input.contact,
  };
}

export function churchInvoiceStateLabel(state: ChurchInvoiceState) {
  switch (state) {
    case "NOTHING_TO_INVOICE": return "Nothing to invoice";
    case "NO_INVOICE": return "Not invoiced";
    case "DRAFT_CURRENT": return "Draft ready for the office";
    case "DRAFT_STALE": return "Draft out of date";
    case "FINALIZED_CURRENT": return "Invoiced";
    case "FINALIZED_STALE": return "Invoiced, usage changed";
  }
}

/** Whether staff can prepare or refresh a draft for this church now, and what the button should say. */
export function churchDraftAction(state: ChurchInvoiceState): { enabled: boolean; label: string } {
  switch (state) {
    case "NOTHING_TO_INVOICE": return { enabled: false, label: "Create draft invoice" };
    case "NO_INVOICE": return { enabled: true, label: "Create draft invoice" };
    case "DRAFT_CURRENT": return { enabled: false, label: "Refresh draft invoice" };
    case "DRAFT_STALE": return { enabled: true, label: "Refresh draft invoice" };
    case "FINALIZED_CURRENT": return { enabled: false, label: "Start a revision" };
    case "FINALIZED_STALE": return { enabled: true, label: "Start a revision draft" };
  }
}

export function summarizeChurchCodeReport(rows: readonly ChurchCodeReportRow[]) {
  return rows.reduce(
    (total, row) => ({
      churchCount: total.churchCount + 1,
      coveredCents: total.coveredCents + row.coveredCents,
      invoicedCents: total.invoicedCents + row.invoicedCents,
      paidCents: total.paidCents + row.paidCents,
      owedOnInvoiceCents: total.owedOnInvoiceCents + row.owedOnInvoiceCents,
    }),
    { churchCount: 0, coveredCents: 0, invoicedCents: 0, paidCents: 0, owedOnInvoiceCents: 0 },
  );
}
