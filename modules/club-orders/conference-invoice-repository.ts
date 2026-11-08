import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isSerializationFailure, pauseBeforeRetry } from "@/lib/prisma-errors";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { LONG_TRANSACTION, lockEvent } from "@/modules/attendance-reconciliation/repository";
import { contactsMatch } from "@/modules/invoices/domain";
import { InvoiceError, figureColumns } from "@/modules/invoices/repository";
import { clubOrdersGroupKey, churchIdOfClubOrdersGroupKey } from "@/modules/club-orders/conference-orders";
import { loadClubOrdersInvoiceInputs } from "@/modules/club-orders/conference-invoice-facts";

/**
 * A church's invoice for the conference club orders (patches and pins) the youth department filled (#1688), built like the
 * church promo code invoice (#399) on the organization invoicing of #165-#168, on that club year's hidden billing event.
 *
 * Owner decision (Caleb, Nov 8, 2026): filled orders become lines on the sponsoring church's invoice, and the treasurer
 * finalizes it as usual. This module only PREPARES a DRAFT (or, when the invoice is already finalized and the filled orders
 * changed, a revision draft). It never finalizes, numbers, sends or marks anything paid: that stays the existing invoice
 * action behind the Finalize invoices permission. Preparing is idempotent: with nothing changed it writes nothing. Money is
 * whole cents. Audit rows hold ids, counts and amounts only.
 */

export type ClubOrdersDraftOutcome = "CREATED" | "REFRESHED" | "REVISION_STARTED" | "UNCHANGED";

export type ClubOrdersDraftResult = {
  outcome: ClubOrdersDraftOutcome;
  invoiceId: string;
  versionId: string;
  revision: number;
  amountDueCents: number;
  lineCount: number;
};

const liveVersionSelect = {
  id: true,
  revision: true,
  status: true,
  amountsFingerprint: true,
  amountDueCents: true,
  contactName: true,
  contactEmail: true,
} satisfies Prisma.InvoiceVersionSelect;

export type PrepareClubOrdersDraftInput = {
  eventId: string;
  churchId: string;
  actorUserId: string;
  /** The invoice screen's Regenerate: refuse unless the latest version is an open draft, instead of starting a revision. */
  requireDraft?: boolean;
  revisionReason?: string;
};

/**
 * Creates, refreshes or revises the church's draft inside the caller's transaction, under the same per-event lock finalizing
 * takes. Returns null only when there is nothing billable and no invoice yet (no empty draft is made).
 */
export async function prepareClubOrdersInvoiceDraftInTx(tx: Prisma.TransactionClient, input: PrepareClubOrdersDraftInput): Promise<ClubOrdersDraftResult | null> {
  await lockEvent(tx, input.eventId);
  const inputs = await loadClubOrdersInvoiceInputs(tx, input.eventId, input.churchId);
  if (!inputs) throw new InvoiceError("That event or organization does not exist.", "PARTY_NOT_FOUND");
  if (!inputs.event.eligible) {
    throw new InvoiceError("Conference club order invoices are made only on a club year's Conference club orders billing event.", "CHURCH_CODE_NOT_ELIGIBLE");
  }
  const { figures, contact } = inputs;
  const groupKey = clubOrdersGroupKey(input.churchId);
  const invoice = await tx.invoice.findUnique({
    where: { eventId_groupKey: { eventId: input.eventId, groupKey } },
    select: { id: true, versions: { where: { status: { not: "DISCARDED" } }, orderBy: { revision: "desc" }, take: 1, select: liveVersionSelect } },
  });
  const latest = invoice?.versions[0] ?? null;
  if (input.requireDraft && latest?.status !== "DRAFT") {
    throw new InvoiceError("This invoice has no open draft to regenerate. Start a revision from Conference club orders to make a new version.", "NOT_A_DRAFT");
  }
  const audit = (outcome: ClubOrdersDraftOutcome, versionId: string, invoiceId: string, revision: number, previousAmountCents: number | null) =>
    writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "CONFERENCE_ORDERS_INVOICE_DRAFT_PREPARED",
      entityType: "InvoiceVersion",
      entityId: versionId,
      summary: "Prepared a draft invoice for a church's conference club orders.",
      metadata: { eventId: input.eventId, churchId: input.churchId, invoiceId, versionId, revision, outcome, lineCount: figures.billableCount, amountDueCents: figures.amountDueCents, previousAmountDueCents: previousAmountCents },
    }, tx);
  const result = (outcome: ClubOrdersDraftOutcome, invoiceId: string, versionId: string, revision: number): ClubOrdersDraftResult => ({
    outcome, invoiceId, versionId, revision, amountDueCents: figures.amountDueCents, lineCount: figures.billableCount,
  });

  if (!invoice || !latest) {
    // Nothing billable yet: an empty draft would only invite someone to finalize a $0 invoice.
    if (figures.amountDueCents <= 0) return null;
    const invoiceId = invoice?.id ?? (await tx.invoice.create({
      data: { eventId: input.eventId, groupKey, invoiceGrouping: "PER_CHURCH", partyKind: "ORGANIZATION", partyId: input.churchId, clubId: null },
      select: { id: true },
    })).id;
    const version = await tx.invoiceVersion.create({
      data: { invoiceId, eventId: input.eventId, revision: 0, basis: "CLUB_ORDERS", reconciliationVersionId: null, createdByUserId: input.actorUserId, ...figureColumns(figures, contact) },
      select: { id: true },
    });
    await audit("CREATED", version.id, invoiceId, 0, null);
    return result("CREATED", invoiceId, version.id, 0);
  }

  if (latest.status === "DRAFT") {
    const same = latest.amountsFingerprint === figures.amountsFingerprint && contactsMatch(latest, contact);
    if (same) return result("UNCHANGED", invoice.id, latest.id, latest.revision);
    await tx.invoiceVersion.update({
      where: { id: latest.id },
      data: { regenerationCount: { increment: 1 }, regeneratedAt: new Date(), ...figureColumns(figures, contact) },
    });
    await audit("REFRESHED", latest.id, invoice.id, latest.revision, latest.amountDueCents);
    return result("REFRESHED", invoice.id, latest.id, latest.revision);
  }

  // The latest version is finalized. Only a change to the lines starts a revision; the finalized version stays as it was.
  if (latest.amountsFingerprint === figures.amountsFingerprint) return result("UNCHANGED", invoice.id, latest.id, latest.revision);
  const revision = await tx.invoiceVersion.create({
    data: {
      invoiceId: invoice.id,
      eventId: input.eventId,
      revision: latest.revision + 1,
      basis: "CLUB_ORDERS",
      supersedesVersionId: latest.id,
      reconciliationVersionId: null,
      createdByUserId: input.actorUserId,
      revisionReason: input.revisionReason?.trim() || "More conference club orders were filled.",
      ...figureColumns(figures, contact),
    },
    select: { id: true, revision: true },
  });
  await audit("REVISION_STARTED", revision.id, invoice.id, revision.revision, latest.amountDueCents);
  return result("REVISION_STARTED", invoice.id, revision.id, revision.revision);
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The invoice screen's Regenerate and Revise for a club orders invoice, in its own serializable transaction. Never finalizes or sends. */
export async function prepareClubOrdersInvoiceDraft(input: PrepareClubOrdersDraftInput): Promise<ClubOrdersDraftResult> {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await prisma.$transaction((tx) => prepareClubOrdersInvoiceDraftInTx(tx, input), { ...LONG_TRANSACTION, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!result) throw new InvoiceError("No club order has been filled for this church yet, so there is nothing to invoice.", "NOTHING_TO_INVOICE");
      return result;
    } catch (error) {
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

/** The church a club orders invoice belongs to, or null when the invoice is not on this event or is not a club orders invoice. */
export async function churchOfClubOrdersInvoice(eventId: string, invoiceId: string) {
  const invoice = await getPrisma().invoice.findFirst({ where: { id: invoiceId, eventId }, select: { groupKey: true } });
  return invoice ? churchIdOfClubOrdersGroupKey(invoice.groupKey) : null;
}
