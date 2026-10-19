import "server-only";

import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { MealError } from "@/modules/meals/errors";
import {
  buildKitchenCountsReport, kitchenCountKindLabels, parseServiceKey, type KitchenCountEntry, type KitchenCountInput, type KitchenCountKind,
} from "@/modules/meals/kitchen-counts";
import { loadServedReport } from "@/modules/meals/scanner-import-repository";

/** Every kitchen entry of the event, oldest first. `enteredAt` is an ISO instant; `enteredBy` is the staff member's display name. */
async function loadEntries(eventId: string): Promise<{ entries: KitchenCountEntry[]; timeZone: string }> {
  const prisma = getPrisma();
  const [event, rows] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { timezone: true } }),
    prisma.eventMealKitchenCount.findMany({
      where: { eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, serviceDate: true, mealType: true, kind: true, quantity: true, note: true, enteredByUserId: true, supersedesId: true, createdAt: true },
    }),
  ]);
  const userIds = [...new Set(rows.map((row) => row.enteredByUserId))];
  const users = userIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return {
    timeZone: event?.timezone ?? "America/Chicago",
    entries: rows.map((row) => ({
      id: row.id, serviceDate: row.serviceDate, mealType: row.mealType, kind: row.kind, quantity: row.quantity, note: row.note,
      enteredBy: names.get(row.enteredByUserId) ?? "Former staff member", enteredAt: row.createdAt.toISOString(), supersedesId: row.supersedesId,
    })),
  };
}

/**
 * The per-service table: tickets sold and meals served (from the scanner redemptions, as slice 1 reports them) beside the
 * kitchen's own counts. Served is read, never written, here.
 */
export async function loadKitchenCountsReport(eventId: string) {
  const [served, { entries, timeZone }] = await Promise.all([loadServedReport(eventId), loadEntries(eventId)]);
  return { ...buildKitchenCountsReport(served, entries), timeZone };
}

export type RecordKitchenCountResult = { changed: boolean; entryId: string };

/**
 * Records one count. The first entry of a (service, kind) has no `supersedesId`; a correction names the entry the person
 * saw, and is refused when someone has entered another since, so two phones never silently overwrite each other. The
 * database also refuses a second chain start or a fork (unique indexes), which closes the race between two requests.
 * Saving the same figure and note again writes nothing. Nothing is ever updated or deleted.
 */
export async function recordKitchenCount(input: { eventId: string; userId: string; entry: KitchenCountInput }): Promise<RecordKitchenCountResult> {
  const service = parseServiceKey(input.entry.serviceKey);
  if (!service) throw new MealError("INVALID", "Choose a meal service.");
  const { entry } = input;
  const stale = () => new MealError("CONFLICT", "Someone else changed this count. Nothing was saved. Refresh the page to see the latest figure.");
  try {
    return await getPrisma().$transaction(async (tx) => {
      const chain = await tx.eventMealKitchenCount.findMany({
        where: { eventId: input.eventId, serviceDate: service.serviceDate, mealType: service.mealType, kind: entry.kind },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, quantity: true, note: true, supersedesId: true },
      });
      const superseded = new Set(chain.map((row) => row.supersedesId).filter((id): id is string => Boolean(id)));
      const current = chain.find((row) => !superseded.has(row.id)) ?? null;
      if ((current?.id ?? null) !== entry.supersedesId) throw stale();
      if (current && current.quantity === entry.quantity && (current.note ?? null) === (entry.note ?? null)) return { changed: false, entryId: current.id };
      const created = await tx.eventMealKitchenCount.create({
        data: {
          eventId: input.eventId, serviceDate: service.serviceDate, mealType: service.mealType, kind: entry.kind as KitchenCountKind,
          quantity: entry.quantity, note: entry.note ?? null, enteredByUserId: input.userId, supersedesId: current?.id ?? null,
        },
        select: { id: true },
      });
      // Ids, the service and the figures only: the free-text note is not copied into the audit log.
      await writeAuditLog({
        eventId: input.eventId, actorUserId: input.userId, action: "meals.kitchen_count", entityType: "EventMealKitchenCount", entityId: created.id,
        summary: `Kitchen ${kitchenCountKindLabels[entry.kind].toLowerCase()} count for ${entry.serviceKey}: ${entry.quantity}${current ? ` (was ${current.quantity})` : ""}.`,
        metadata: { serviceKey: entry.serviceKey, kind: entry.kind, quantity: entry.quantity, previous: current?.quantity ?? null, supersedes: current?.id ?? null },
      }, tx);
      return { changed: true, entryId: created.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 });
  } catch (error) {
    // A unique violation is the database refusing a second start or a fork: another request got in first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) throw stale();
    throw error;
  }
}

