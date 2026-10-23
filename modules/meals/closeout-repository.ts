import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  applyReviews, buildCloseout, openExceptionCount,
  type CloseoutAdjustment, type CloseoutInput, type CloseoutLedgerEntry, type CloseoutReview, type CloseoutReviewInput, type CloseoutSelection, type CloseoutTicket,
} from "@/modules/meals/closeout";
import { MealError } from "@/modules/meals/errors";
import { loadKitchenCountsReport } from "@/modules/meals/kitchen-counts-repository";

/**
 * Reads the meal sources (ledger, MEAL adjustment lines, selections, tickets, redemption events, kitchen counts) as they
 * are. Nothing here writes, and nothing is rewritten: the projection is built from these rows and discarded.
 */
async function loadCloseoutInput(eventId: string): Promise<{ input: CloseoutInput; timeZone: string }> {
  const prisma = getPrisma();
  const [selectionRows, ledgerRows, adjustmentRows, ticketRows, redemptionRows, kitchen] = await Promise.all([
    prisma.eventMealSelection.findMany({
      where: { eventId }, orderBy: { id: "asc" },
      select: {
        id: true, mealType: true, source: true, payer: true, status: true, quantity: true, unitPriceCents: true, conferenceRateCents: true,
        service: { select: { serviceDate: true } },
      },
    }),
    prisma.eventMealLedgerEntry.findMany({
      where: { eventId }, orderBy: { id: "asc" },
      select: {
        id: true, selectionId: true, mealType: true, kind: true, amountCents: true, payer: true, settlement: true, registrationAdjustmentId: true,
        selection: { select: { service: { select: { serviceDate: true } } } },
      },
    }),
    prisma.registrationAdjustment.findMany({ where: { eventId, kind: "MEAL" }, orderBy: { id: "asc" }, select: { id: true, amountCents: true } }),
    prisma.eventMealTicket.findMany({ where: { eventId }, orderBy: { number: "asc" }, select: { id: true, number: true, selectionId: true, cancelledAt: true } }),
    prisma.eventMealRedemption.findMany({ where: { eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { ticketId: true, kind: true } }),
    loadKitchenCountsReport(eventId),
  ]);
  const served = new Set<string>();
  const unredeemed = new Set<string>();
  for (const event of redemptionRows) {
    if (event.kind === "REDEEMED") served.add(event.ticketId);
    else { served.delete(event.ticketId); unredeemed.add(event.ticketId); }
  }
  const selections: CloseoutSelection[] = selectionRows.map((row) => ({
    id: row.id, mealType: row.mealType, serviceDate: row.service?.serviceDate ?? "", source: row.source, payer: row.payer, status: row.status,
    quantity: row.quantity, unitPriceCents: row.unitPriceCents, conferenceRateCents: row.conferenceRateCents,
  }));
  const ledger: CloseoutLedgerEntry[] = ledgerRows.map((row) => ({
    id: row.id, selectionId: row.selectionId, mealType: row.mealType, serviceDate: row.selection.service?.serviceDate ?? "", kind: row.kind,
    amountCents: row.amountCents, payer: row.payer, settlement: row.settlement, registrationAdjustmentId: row.registrationAdjustmentId,
  }));
  const adjustments: CloseoutAdjustment[] = adjustmentRows;
  const tickets: CloseoutTicket[] = ticketRows.map((row) => ({ id: row.id, number: row.number, selectionId: row.selectionId, cancelled: row.cancelledAt !== null }));
  return {
    timeZone: kitchen.timeZone,
    input: { selections, ledger, adjustments, tickets, served, unredeemed, anyImport: redemptionRows.length > 0, kitchen },
  };
}

async function loadReviews(eventId: string): Promise<CloseoutReview[]> {
  const prisma = getPrisma();
  const rows = await prisma.eventMealCloseoutReview.findMany({ where: { eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const userIds = [...new Set(rows.map((row) => row.reviewedByUserId))];
  const users = userIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return rows.map((row) => ({
    id: row.id, exceptionKey: row.exceptionKey, status: row.status, detailDigest: row.detailDigest, note: row.note,
    reviewedBy: names.get(row.reviewedByUserId) ?? "Former staff member", reviewedAt: row.createdAt.toISOString(),
  }));
}

/** The closeout projection with each exception's review history, as of now. Needs MANAGE_FINANCE: the caller checks it. */
export async function loadMealCloseout(eventId: string) {
  const asOf = new Date();
  const [{ input, timeZone }, reviews] = await Promise.all([loadCloseoutInput(eventId), loadReviews(eventId)]);
  const projection = buildCloseout(input);
  const exceptions = applyReviews(projection.exceptions, reviews);
  return { ...projection, exceptions, openExceptions: openExceptionCount(exceptions), asOf: asOf.toISOString(), timeZone };
}

/**
 * Records that staff acknowledged (or reopened) one exception. The exception must exist right now, and the figures the
 * person saw must be the figures it has now, or nothing is saved. A review is a note and a decision: no ledger entry,
 * charge, credit, count, price or refund is created, changed or removed. Reviews are append-only.
 */
export async function recordCloseoutReview(input: { eventId: string; userId: string; review: CloseoutReviewInput }): Promise<{ reviewId: string }> {
  const projection = buildCloseout((await loadCloseoutInput(input.eventId)).input);
  const exception = projection.exceptions.find((candidate) => candidate.key === input.review.exceptionKey);
  if (!exception) throw new MealError("INVALID", "That exception is no longer in the closeout. Refresh the page.");
  if (exception.detailDigest !== input.review.detailDigest) {
    throw new MealError("CONFLICT", "The figures behind this exception changed. Nothing was saved. Refresh the page and review it again.");
  }
  const created = await getPrisma().eventMealCloseoutReview.create({
    data: {
      eventId: input.eventId, exceptionKey: exception.key, status: input.review.status, detailDigest: exception.detailDigest,
      note: input.review.note, reviewedByUserId: input.userId,
    },
    select: { id: true },
  });
  // Ids and the exception's code only: the note is not copied into the audit log.
  await writeAuditLog({
    eventId: input.eventId, actorUserId: input.userId, action: "meals.closeout_review", entityType: "EventMealCloseoutReview", entityId: created.id,
    summary: `${input.review.status === "ACKNOWLEDGED" ? "Acknowledged" : "Reopened"} meal closeout exception ${exception.code}.`,
    metadata: { exceptionKey: exception.key, status: input.review.status, category: exception.category },
  });
  return { reviewId: created.id };
}
