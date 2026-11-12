import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { MembershipLookup, Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { getLodgingView } from "@/modules/lodging/service";
import { loadMealView } from "@/modules/meals/view-repository";
import { listRegistrations } from "@/modules/registrations/repository";
import { getClubEventRecords } from "@/modules/reporting/club-event-reports-repository";
import {
  BudgetError,
  assertBudgetAccess,
  canReadSourceBudget,
  type BudgetActor,
} from "@/modules/event-budgets/access";
import {
  BUDGET_MODULE_KEY,
  MAX_COST_LINES,
  budgetCsv,
  computeBudgetTotals,
  type BudgetSheet,
  type CarriedBudget,
  type CostLineInput,
  type CostLineView,
} from "@/modules/event-budgets/domain";
import { buildBudgetFigures } from "@/modules/event-budgets/figures";

/**
 * Reads and writes for the Budget sheet (#1682). The only tables written are `EventBudgetCostLine` and the audit log: never a
 * payment, invoice, ledger entry or registration (a guard test reads this boundary's imports). Every function here is called
 * after `access.ts` has decided who is asking; the cost line functions ask again.
 */

/** The figures that fill in by themselves, from the same loaders the Finance page and the club event report use. */
export async function loadBudgetFigures(eventId: string) {
  const [registrations, clubRecords, lodging, meals] = await Promise.all([
    listRegistrations(eventId),
    getClubEventRecords(eventId),
    getLodgingView(eventId),
    loadMealView(eventId),
  ]);
  return buildBudgetFigures({
    registrations,
    attendees: clubRecords.clubs.flatMap((club) => club.attendees),
    lodging,
    meals,
  });
}

export async function listCostLines(eventId: string): Promise<CostLineView[]> {
  const rows = await getPrisma().eventBudgetCostLine.findMany({
    where: { eventId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, label: true, description: true, quantity: true, amountCents: true },
  });
  return rows;
}

/** The sheet for an event: its figures, its cost lines and the totals. The caller has already passed `assertBudgetAccess` (or the source check). */
export async function loadBudgetSheet(eventId: string, eventName: string): Promise<BudgetSheet> {
  const [figures, costLines] = await Promise.all([loadBudgetFigures(eventId), listCostLines(eventId)]);
  return { eventId, eventName, figures, costLines, totals: computeBudgetTotals(figures.money, costLines) };
}

/**
 * Last year's sheet, for an event that was copied from another (the clone record names the source). Read only. Nothing when the
 * event was not copied, or when this viewer may not read the source event's sheet (checked against that event).
 */
export async function loadCarriedBudget(actor: BudgetActor, eventId: string, context: { session?: Session; lookup?: MembershipLookup } = {}): Promise<CarriedBudget> {
  const prisma = getPrisma();
  const record = await prisma.eventCloneRecord.findUnique({ where: { resultEventId: eventId }, select: { sourceEventId: true } });
  const sourceEventId = record?.sourceEventId;
  if (!sourceEventId) return { kind: "none" };
  if (!(await canReadSourceBudget(actor, sourceEventId, context))) return { kind: "none" };
  const [source, lineCount, moduleRow] = await Promise.all([
    prisma.event.findUnique({ where: { id: sourceEventId }, select: { name: true } }),
    prisma.eventBudgetCostLine.count({ where: { eventId: sourceEventId } }),
    prisma.eventModule.findUnique({ where: { eventId_moduleKey: { eventId: sourceEventId, moduleKey: BUDGET_MODULE_KEY } }, select: { id: true } }),
  ]);
  if (!source) return { kind: "none" };
  if (lineCount === 0 && !moduleRow) return { kind: "no-sheet", sourceEventId, sourceEventName: source.name };
  return { kind: "sheet", sourceEventId, sourceEventName: source.name, sheet: await loadBudgetSheet(sourceEventId, source.name) };
}

function auditWho(actor: BudgetActor) {
  return actor.kind === "staff"
    ? { actorUserId: actor.userId, metadata: {} }
    : { metadata: { actorAttendeeAccountId: actor.accountId, viaAreaCoordinator: true } };
}

/** Audit rows carry the label, the amount and the quantity only: never the free description, and never a person. */
function auditMetadata(actor: BudgetActor, eventId: string, line: { id: string; label: string; quantity: number | null; amountCents: number }) {
  return { ...auditWho(actor).metadata, eventId, lineId: line.id, label: line.label, quantity: line.quantity, amountCents: line.amountCents };
}

async function audit(tx: Prisma.TransactionClient, actor: BudgetActor, eventId: string, action: string, summary: string, line: { id: string; label: string; quantity: number | null; amountCents: number }) {
  const who = auditWho(actor);
  await writeAuditLog({
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType: "EventBudgetCostLine",
    entityId: line.id,
    summary,
    metadata: auditMetadata(actor, eventId, line),
  }, tx);
}

export async function createCostLine(actor: BudgetActor, eventId: string, input: CostLineInput): Promise<CostLineView> {
  await assertBudgetAccess(actor, eventId, "write");
  return getPrisma().$transaction(async (tx) => {
    if ((await tx.eventBudgetCostLine.count({ where: { eventId } })) >= MAX_COST_LINES) {
      throw new BudgetError("TOO_MANY_LINES", `A budget sheet holds up to ${MAX_COST_LINES} cost lines. Combine some lines first.`);
    }
    const line = await tx.eventBudgetCostLine.create({
      data: { eventId, label: input.label, description: input.description, quantity: input.quantity, amountCents: input.amountCents },
      select: { id: true, label: true, description: true, quantity: true, amountCents: true },
    });
    await audit(tx, actor, eventId, "EVENT_BUDGET_COST_ADDED", "Added a cost line to the budget sheet.", line);
    return line;
  });
}

export async function updateCostLine(actor: BudgetActor, eventId: string, lineId: string, input: CostLineInput): Promise<CostLineView> {
  await assertBudgetAccess(actor, eventId, "write");
  return getPrisma().$transaction(async (tx) => {
    // The line must belong to this event: an id from another event is the same as a missing one.
    const existing = await tx.eventBudgetCostLine.findFirst({ where: { id: lineId, eventId }, select: { id: true } });
    if (!existing) throw new BudgetError("LINE_NOT_FOUND", "That cost line could not be found. It may already be deleted.");
    const line = await tx.eventBudgetCostLine.update({
      where: { id: lineId },
      data: { label: input.label, description: input.description, quantity: input.quantity, amountCents: input.amountCents },
      select: { id: true, label: true, description: true, quantity: true, amountCents: true },
    });
    await audit(tx, actor, eventId, "EVENT_BUDGET_COST_CHANGED", "Changed a cost line on the budget sheet.", line);
    return line;
  });
}

export async function deleteCostLine(actor: BudgetActor, eventId: string, lineId: string): Promise<void> {
  await assertBudgetAccess(actor, eventId, "write");
  await getPrisma().$transaction(async (tx) => {
    const existing = await tx.eventBudgetCostLine.findFirst({ where: { id: lineId, eventId }, select: { id: true, label: true, quantity: true, amountCents: true } });
    if (!existing) throw new BudgetError("LINE_NOT_FOUND", "That cost line could not be found. It may already be deleted.");
    await tx.eventBudgetCostLine.delete({ where: { id: lineId } });
    await audit(tx, actor, eventId, "EVENT_BUDGET_COST_DELETED", "Deleted a cost line from the budget sheet.", existing);
  });
}

/** The CSV for the conference, with the export audited (counts and totals only). The caller has already passed `assertBudgetAccess`. */
export async function buildBudgetExport(actor: BudgetActor, eventId: string, eventName: string, context: { session?: Session; lookup?: MembershipLookup } = {}): Promise<{ csv: string; slug: string | null }> {
  const [sheet, carried, event] = await Promise.all([
    loadBudgetSheet(eventId, eventName),
    loadCarriedBudget(actor, eventId, context),
    getPrisma().event.findUnique({ where: { id: eventId }, select: { slug: true } }),
  ]);
  const who = auditWho(actor);
  await writeAuditLog({
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action: "EVENT_BUDGET_CSV_EXPORTED",
    entityType: "Event",
    entityId: eventId,
    summary: "Downloaded the budget sheet CSV.",
    metadata: { ...who.metadata, eventId, costLineCount: sheet.costLines.length, costsCents: sheet.totals.costsCents, comparedWithLastYear: carried.kind === "sheet" },
  });
  return { csv: budgetCsv(sheet, carried), slug: event?.slug ?? null };
}
