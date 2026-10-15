import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isSerializationFailure, pauseBeforeRetry } from "@/lib/prisma-errors";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { LONG_TRANSACTION, lockEvent } from "@/modules/attendance-reconciliation/repository";
import { contactsMatch } from "@/modules/invoices/domain";
import { loadEventLedger } from "@/modules/invoices/ledger-repository";
import { InvoiceError, figureColumns } from "@/modules/invoices/repository";
import {
  CHURCH_PROMO_GROUP_KEY_PREFIX,
  buildChurchCodeReportRow,
  churchIdOfPromoGroupKey,
  churchPromoGroupKey,
  summarizeChurchCodeReport,
  type ChurchCodeReportRow,
  type ChurchInvoiceFacts,
} from "@/modules/promo-codes/church-invoice";
import { loadChurchBillingContact, loadChurchInvoiceInputs } from "@/modules/promo-codes/church-invoice-facts";
import { publicAttendeeName } from "@/modules/public-access/domain";
import { listChurchSponsoredPromoLines } from "@/modules/promo-codes/church-sponsored-repository";

/**
 * A church's invoice for what its promo codes covered (#399), built on the organization invoicing of #165-#168.
 *
 * Owner decision (Caleb, Oct 14, 2026): the office finalizes and sends the invoice, and finalizing stays a named human
 * action. This module only PREPARES a DRAFT from the code's redemptions, on a staff request (MANAGE_FINANCE, checked
 * by the route): it never finalizes, numbers, sends or marks anything paid. Finalizing, sending and recording
 * payments are the existing invoice actions, with their own permissions.
 *
 * Preparing is idempotent and safe to repeat: with nothing changed it writes nothing. It runs SERIALIZABLE and retries a
 * conflict (`isSerializationFailure`), under the same per-event lock finalizing takes, so a draft and a finalization
 * never see each other half done. Money is whole cents. Audit rows hold ids, counts and amounts only.
 */

export type ChurchDraftOutcome =
  /** A first draft was made. */
  | "CREATED"
  /** The open draft was rebuilt because the redemptions (or the contact) changed. */
  | "REFRESHED"
  /** A finalized invoice no longer matched the redemptions: a new revision draft was started (the finalized version stays as it was). */
  | "REVISION_STARTED"
  /** The draft, or the finalized invoice, already matches: nothing was written. */
  | "UNCHANGED";

export type ChurchDraftResult = {
  outcome: ChurchDraftOutcome;
  invoiceId: string;
  versionId: string;
  revision: number;
  amountDueCents: number;
  lineCount: number;
  /** True when the finalized invoice carries a billing contact that is no longer the church's contact (a contact-only revision is a separate follow-up). */
  contactChanged: boolean;
};

const liveVersionSelect = {
  id: true,
  revision: true,
  status: true,
  basis: true,
  amountsFingerprint: true,
  amountDueCents: true,
  contactName: true,
  contactEmail: true,
  billableCount: true,
} satisfies Prisma.InvoiceVersionSelect;

export type PrepareChurchDraftInput = {
  eventId: string;
  churchId: string;
  actorUserId: string;
  /** The invoice screen's Regenerate: refuse unless the latest version is an open draft, instead of starting a revision. */
  requireDraft?: boolean;
  /** The reason staff gave when asking for a revision; kept on the revision draft. */
  revisionReason?: string;
};

async function prepareOnce(tx: Prisma.TransactionClient, input: PrepareChurchDraftInput): Promise<ChurchDraftResult> {
  // The same per-event lock finalizing takes: this draft is built from, and compared with, one settled state.
  await lockEvent(tx, input.eventId);
  const inputs = await loadChurchInvoiceInputs(tx, input.eventId, input.churchId);
  if (!inputs) throw new InvoiceError("That event or organization does not exist.", "PARTY_NOT_FOUND");
  if (!inputs.event.eligible) {
    throw new InvoiceError("Church promo code invoices are made for general events that guests pay for themselves. This event is not one.", "CHURCH_CODE_NOT_ELIGIBLE");
  }
  if (!inputs.sponsorsACode) throw new InvoiceError("This organization does not sponsor a promo code on this event.", "NOT_A_SPONSOR");
  const { figures, contact } = inputs;
  const groupKey = churchPromoGroupKey(input.churchId);
  const invoice = await tx.invoice.findUnique({
    where: { eventId_groupKey: { eventId: input.eventId, groupKey } },
    select: { id: true, versions: { where: { status: { not: "DISCARDED" } }, orderBy: { revision: "desc" }, take: 1, select: liveVersionSelect } },
  });
  const latest = invoice?.versions[0] ?? null;
  if (input.requireDraft && latest?.status !== "DRAFT") {
    throw new InvoiceError("This invoice has no open draft to regenerate. Start a revision from the church report to make a new version.", "NOT_A_DRAFT");
  }
  const audit = (outcome: ChurchDraftOutcome, versionId: string, invoiceId: string, revision: number, previousAmountCents: number | null) =>
    writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "CHURCH_CODE_INVOICE_DRAFT_PREPARED",
      entityType: "InvoiceVersion",
      entityId: versionId,
      summary: "Prepared a draft invoice for a church's promo codes.",
      metadata: {
        eventId: input.eventId,
        churchId: input.churchId,
        invoiceId,
        versionId,
        revision,
        outcome,
        lineCount: figures.billableCount,
        amountDueCents: figures.amountDueCents,
        previousAmountDueCents: previousAmountCents,
      },
    }, tx);
  const result = (outcome: ChurchDraftOutcome, invoiceId: string, versionId: string, revision: number, contactChanged = false): ChurchDraftResult => ({
    outcome, invoiceId, versionId, revision, amountDueCents: figures.amountDueCents, lineCount: figures.billableCount, contactChanged,
  });

  if (!invoice || !latest) {
    // Nothing billable yet: an empty draft would only invite someone to finalize a $0 invoice.
    if (figures.amountDueCents <= 0) throw new InvoiceError("No registration has used this church's codes yet, so there is nothing to invoice.", "NOTHING_TO_INVOICE");
    const invoiceId = invoice?.id ?? (await tx.invoice.create({
      data: { eventId: input.eventId, groupKey, invoiceGrouping: "PER_CHURCH", partyKind: "ORGANIZATION", partyId: input.churchId, clubId: null },
      select: { id: true },
    })).id;
    const version = await tx.invoiceVersion.create({
      data: { invoiceId, eventId: input.eventId, revision: 0, basis: "CHURCH_PROMO_CODES", reconciliationVersionId: null, createdByUserId: input.actorUserId, ...figureColumns(figures, contact) },
      select: { id: true },
    });
    await audit("CREATED", version.id, invoiceId, 0, null);
    return result("CREATED", invoiceId, version.id, 0);
  }

  if (latest.status === "DRAFT") {
    const same = latest.amountsFingerprint === figures.amountsFingerprint && contactsMatch(latest, contact);
    if (same) return result("UNCHANGED", invoice.id, latest.id, latest.revision);
    // Every use was cancelled or reversed: an original draft is not refreshed to a $0 invoice someone could finalize.
    if (latest.revision === 0 && figures.amountDueCents <= 0) {
      throw new InvoiceError("Nothing is covered by this church's codes any more, so this draft would be $0. Discard this draft instead.", "NOTHING_TO_INVOICE");
    }
    await tx.invoiceVersion.update({
      where: { id: latest.id },
      data: { regenerationCount: { increment: 1 }, regeneratedAt: new Date(), ...figureColumns(figures, contact) },
    });
    await audit("REFRESHED", latest.id, invoice.id, latest.revision, latest.amountDueCents);
    return result("REFRESHED", invoice.id, latest.id, latest.revision);
  }

  // The latest version is finalized (a superseded one is never the latest). Only a change to the lines starts a revision.
  const contactChanged = !contactsMatch(latest, contact);
  if (latest.amountsFingerprint === figures.amountsFingerprint) return result("UNCHANGED", invoice.id, latest.id, latest.revision, contactChanged);
  const revision = await tx.invoiceVersion.create({
    data: {
      invoiceId: invoice.id,
      eventId: input.eventId,
      revision: latest.revision + 1,
      basis: "CHURCH_PROMO_CODES",
      supersedesVersionId: latest.id,
      reconciliationVersionId: null,
      createdByUserId: input.actorUserId,
      revisionReason: input.revisionReason?.trim() || "Refreshed from the church's promo code redemptions.",
      ...figureColumns(figures, contact),
    },
    select: { id: true, revision: true },
  });
  await audit("REVISION_STARTED", revision.id, invoice.id, revision.revision, latest.amountDueCents);
  return result("REVISION_STARTED", invoice.id, revision.id, revision.revision, contactChanged);
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Creates or refreshes the DRAFT invoice for what one church's promo codes covered on an event. Needs MANAGE_FINANCE,
 * which the caller (the route) has checked; the event and the organization come from the request, and the lines from
 * the database. Never finalizes or sends. Repeating it with nothing changed writes nothing.
 */
export async function prepareChurchCodeInvoiceDraft(input: PrepareChurchDraftInput): Promise<ChurchDraftResult> {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => prepareOnce(tx, input), { ...LONG_TRANSACTION, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // A conflict or a lost race on the invoice's unique key: nothing was written, so look again and see the winner's work.
      if ((isSerializationFailure(error) || isUniqueViolation(error)) && attempt < 4) {
        await pauseBeforeRetry(attempt);
        continue;
      }
      if (isSerializationFailure(error) || isUniqueViolation(error)) throw new InvoiceError("Someone else just changed this. Reload and try again.", "CONCURRENT_CHANGE");
      throw error;
    }
  }
  throw new InvoiceError("Someone else just changed this. Reload and try again.", "CONCURRENT_CHANGE");
}

/** The church a promo code invoice belongs to, or null when the invoice is not on this event or is not a church promo code invoice. */
export async function churchOfPromoInvoice(eventId: string, invoiceId: string, client: PrismaClient | Prisma.TransactionClient = getPrisma()) {
  const invoice = await client.invoice.findFirst({ where: { id: invoiceId, eventId }, select: { groupKey: true } });
  return invoice ? churchIdOfPromoGroupKey(invoice.groupKey) : null;
}

// ---------------------------------------------------------------------------------------------
// The church report
// ---------------------------------------------------------------------------------------------

export type ChurchCodeReport = {
  eventId: string;
  /** False when the event is not a general, attendee-paid event: church codes bill nothing there. */
  eligible: boolean;
  rows: ChurchCodeReportRow[];
  totals: ReturnType<typeof summarizeChurchCodeReport>;
};

/**
 * The name each report line shows, by line id, for the staff report only (Caleb, Oct 15, 2026, #960). A whole-registration
 * line shows the registrant (the account holder); a per-person line (#397) shows the covered attendee, "used for that
 * person". Both read the registration's or attendee's contact/profile snapshot first and fall back to the Person, the
 * same precedence as the rest of the app (`publicAttendeeName`).
 */
async function loadReportLineNames(client: PrismaClient, eventId: string, lines: ReadonlyArray<{ lineId: string; confirmationCode: string }>) {
  const names = new Map<string, string>();
  if (lines.length === 0) return names;
  const registrations = await client.registration.findMany({
    where: { eventId, confirmationCode: { in: [...new Set(lines.map((line) => line.confirmationCode))] } },
    select: { confirmationCode: true, contactSnapshot: true, accountHolderPerson: { select: { firstName: true, lastName: true } } },
  });
  const registrantByCode = new Map(registrations.map((registration) => [registration.confirmationCode, publicAttendeeName(registration.contactSnapshot, registration.accountHolderPerson)]));
  const adjustmentIds = lines.filter((line) => line.lineId.startsWith("adjustment:")).map((line) => line.lineId.slice("adjustment:".length));
  const adjustments = adjustmentIds.length === 0 ? [] : await client.registrationAdjustment.findMany({
    where: { id: { in: adjustmentIds }, eventId, registrationAttendeeId: { not: null } },
    select: { id: true, attendee: { select: { profileSnapshot: true, person: { select: { firstName: true, lastName: true } } } } },
  });
  const attendeeByLine = new Map<string, string>();
  for (const adjustment of adjustments) {
    if (adjustment.attendee) attendeeByLine.set(`adjustment:${adjustment.id}`, publicAttendeeName(adjustment.attendee.profileSnapshot, adjustment.attendee.person));
  }
  for (const line of lines) {
    names.set(line.lineId, attendeeByLine.get(line.lineId) ?? registrantByCode.get(line.confirmationCode) ?? "");
  }
  return names;
}

/**
 * For each church that sponsors a code on the event: who used the code (billed redemptions, by confirmation code), what
 * it covered, what its invoice bills, what has been paid and what is still owed. Staff finance only (the page checks
 * MANAGE_FINANCE on the server). Each line carries the registrant's name as stored (Caleb, Oct 15, 2026, #960); no
 * answer, email or phone. The church invoice, its PDF, the send preview and any email to the church never carry a name.
 */
export async function getChurchCodeReport(eventId: string, client: PrismaClient = getPrisma()): Promise<ChurchCodeReport> {
  const event = await client.event.findUnique({ where: { id: eventId }, select: { id: true, name: true } });
  if (!event) throw new InvoiceError("That event does not exist.", "EVENT_NOT_FOUND");
  const [codes, lines, invoices, ledger] = await Promise.all([
    client.promoCode.findMany({
      where: { eventId, sponsoringOrganizationId: { not: null } },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, isActive: true, redeemedCount: true, maximumUses: true, sponsoringOrganization: { select: { id: true, name: true } } },
    }),
    listChurchSponsoredPromoLines(eventId, client),
    client.invoice.findMany({
      where: { eventId, groupKey: { startsWith: CHURCH_PROMO_GROUP_KEY_PREFIX } },
      select: {
        id: true,
        baseNumber: true,
        groupKey: true,
        versions: { where: { status: { in: ["DRAFT", "FINALIZED"] } }, select: { id: true, revision: true, status: true, number: true, amountDueCents: true, amountsFingerprint: true, contactName: true, contactEmail: true } },
      },
    }),
    loadEventLedger(eventId, {}, client),
  ]);
  const lineNames = await loadReportLineNames(client, eventId, lines);
  const paidByInvoice = new Map(ledger.map((entry) => [entry.invoiceId, entry.figures.paidCents]));
  const invoiceByChurch = new Map<string, ChurchInvoiceFacts>();
  for (const invoice of invoices) {
    const churchId = churchIdOfPromoGroupKey(invoice.groupKey);
    if (!churchId) continue;
    const finalized = invoice.versions.find((version) => version.status === "FINALIZED" && version.number);
    const draft = invoice.versions.find((version) => version.status === "DRAFT");
    invoiceByChurch.set(churchId, {
      invoiceId: invoice.id,
      baseNumber: invoice.baseNumber,
      finalized: finalized ? { versionId: finalized.id, number: finalized.number!, amountDueCents: finalized.amountDueCents, amountsFingerprint: finalized.amountsFingerprint } : null,
      draft: draft ? { versionId: draft.id, revision: draft.revision, amountDueCents: draft.amountDueCents, amountsFingerprint: draft.amountsFingerprint, contactName: draft.contactName, contactEmail: draft.contactEmail } : null,
      paidCents: paidByInvoice.get(invoice.id) ?? 0,
    });
  }
  const churches = new Map<string, { id: string; name: string; codes: ChurchCodeReportRow["codes"] }>();
  for (const code of codes) {
    const church = code.sponsoringOrganization;
    if (!church) continue;
    const entry = churches.get(church.id) ?? { id: church.id, name: church.name, codes: [] };
    entry.codes.push({ id: code.id, code: code.code, isActive: code.isActive, redeemedCount: code.redeemedCount, maximumUses: code.maximumUses });
    churches.set(church.id, entry);
  }
  const eventRow = await client.event.findUniqueOrThrow({ where: { id: eventId }, select: { audience: true, billingMode: true } });
  const rows: ChurchCodeReportRow[] = [];
  for (const church of [...churches.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))) {
    const contact = await loadChurchBillingContact(client, church.id);
    rows.push(buildChurchCodeReportRow({
      event,
      church,
      codes: church.codes,
      lines,
      lineNames,
      invoice: invoiceByChurch.get(church.id) ?? null,
      contact: contact ? { name: contact.name, email: contact.email, verified: contact.verified } : null,
    }));
  }
  return {
    eventId,
    eligible: eventRow.audience === "GENERAL" && eventRow.billingMode === "ATTENDEE_PAY",
    rows,
    totals: summarizeChurchCodeReport(rows),
  };
}
