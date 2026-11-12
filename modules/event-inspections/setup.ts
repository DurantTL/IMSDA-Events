import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { inspectionKeys, inspectionNames, type InspectionKey } from "@/modules/event-inspections/domain";
import { normalizeScoredEventName } from "@/modules/event-scoring/domain";

/**
 * Making the two inspection scored events (#1896), kept apart from the service so every way the Inspections module can be
 * switched on (the coordinator or staff switch, the system administrator's module switch, a module request approval, the new
 * event features step and an event copy) makes them the same way. Database writes only, inside the caller's transaction.
 */

const moduleKey = "inspection-scoring";

type Tx = Prisma.TransactionClient;
export type InspectionAuditWho = { actorUserId?: string; metadata?: Prisma.InputJsonObject };

function audit(who: InspectionAuditWho, eventId: string, action: string, entityId: string, summary: string, inspection: InspectionKey) {
  return {
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType: "ScoredActivity",
    entityId,
    summary,
    // Ids and keys only: no club name is written to the audit log.
    metadata: { ...(who.metadata ?? {}), eventId, moduleKey, inspection },
  };
}

/**
 * Makes the inspection events that are missing. A scored event someone already named the same, set up the same way and not
 * already marked as an inspection is adopted. Returns the inspections that could not be made because a scored event with
 * that name has other settings, so the caller can say so (the interactive switch) or leave it for later (every other path).
 */
export async function ensureInspectionEvents(tx: Tx, eventId: string, who: InspectionAuditWho): Promise<{ conflicts: InspectionKey[] }> {
  const conflicts: InspectionKey[] = [];
  for (const key of inspectionKeys) {
    if (await tx.scoredActivity.findUnique({ where: { eventId_inspectionKind: { eventId, inspectionKind: key } }, select: { id: true } })) continue;
    const name = inspectionNames[key];
    const normalizedName = normalizeScoredEventName(name);
    const sameName = await tx.scoredActivity.findUnique({
      where: { eventId_normalizedName: { eventId, normalizedName } },
      select: { id: true, kind: true, unit: true, higherWins: true, inspectionKind: true },
    });
    if (sameName) {
      if (sameName.inspectionKind !== null || sameName.kind !== "CLUB" || sameName.unit !== "POINTS" || !sameName.higherWins) {
        conflicts.push(key);
        continue;
      }
      await tx.scoredActivity.update({ where: { id: sameName.id }, data: { inspectionKind: key } });
      await writeAuditLog(audit(who, eventId, "EVENT_INSPECTION_ACTIVITY_ADOPTED", sameName.id, "Marked an existing scored event as an inspection.", key), tx);
      continue;
    }
    const last = await tx.scoredActivity.aggregate({ where: { eventId }, _max: { sortOrder: true } });
    const created = await tx.scoredActivity.create({
      data: { eventId, name, normalizedName, kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [], inspectionKind: key, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      select: { id: true },
    });
    await writeAuditLog(audit(who, eventId, "EVENT_INSPECTION_ACTIVITY_ADDED", created.id, "Added an inspection scored event.", key), tx);
  }
  return { conflicts };
}

/** Makes the events when the event's Inspections module is on. Safe to call after any step that may have switched it on. */
export async function ensureInspectionEventsIfOn(tx: Tx, eventId: string, actorUserId?: string): Promise<void> {
  const on = await tx.eventModule.findUnique({ where: { eventId_moduleKey: { eventId, moduleKey } }, select: { id: true } });
  if (on) await ensureInspectionEvents(tx, eventId, actorUserId ? { actorUserId } : {});
}
