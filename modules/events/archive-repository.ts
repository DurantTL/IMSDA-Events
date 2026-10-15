import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  EVENT_ARCHIVED_AUDIT_ACTION,
  EVENT_UNARCHIVED_AUDIT_ACTION,
  decideEventArchiveAccess,
  type EventArchiveActor,
  type EventArchiveAuditMetadata,
} from "@/modules/events/archive";
import { EventOperationError } from "@/modules/events/repository";

export class EventArchiveForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventArchiveForbiddenError";
  }
}

type ArchiveActor = EventArchiveActor & { userId: string };

/**
 * Archives or unarchives one event (#635). The actor's permission is decided
 * here from the role the caller read for this event (the route scopes it to the
 * event in the URL, and reads it before the transaction starts), so every caller
 * gets the same rule. Only `archivedAt` and
 * `archivedByUserId` change, and the change is audited (ids only) in the same
 * transaction. Idempotent: repeating a request that already holds changes
 * nothing and writes no second audit row.
 */
async function setEventArchived(input: { eventId: string; actor: ArchiveActor; archive: boolean }) {
  return getPrisma().$transaction(async (tx) => {
    const current = await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
    if (!current) throw new EventOperationError("EVENT_NOT_FOUND", "That event no longer exists.");
    const decision = decideEventArchiveAccess(input.actor);
    if (!decision.allowed) throw new EventArchiveForbiddenError(decision.reason);

    const { count } = await tx.event.updateMany({
      where: { id: input.eventId, archivedAt: input.archive ? null : { not: null } },
      data: input.archive
        ? { archivedAt: new Date(), archivedByUserId: input.actor.userId }
        : { archivedAt: null, archivedByUserId: null },
    });
    if (count !== 1) return { archived: input.archive, changed: false };

    const metadata: EventArchiveAuditMetadata = { eventId: input.eventId };
    await writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.actor.userId,
      action: input.archive ? EVENT_ARCHIVED_AUDIT_ACTION : EVENT_UNARCHIVED_AUDIT_ACTION,
      entityType: "Event",
      entityId: input.eventId,
      summary: input.archive ? "Archived event." : "Unarchived event.",
      metadata,
    }, tx);
    return { archived: input.archive, changed: true };
  });
}

export function archiveEvent(input: { eventId: string; actor: ArchiveActor }) {
  return setEventArchived({ ...input, archive: true });
}

export function unarchiveEvent(input: { eventId: string; actor: ArchiveActor }) {
  return setEventArchived({ ...input, archive: false });
}

/** Archived events the account may open, most recent first, for the Archived events list. */
export async function listArchivedEventsForUser(userId: string, isSystemAdmin: boolean) {
  return getPrisma().event.findMany({
    where: {
      archivedAt: { not: null },
      ...(isSystemAdmin ? {} : { memberships: { some: { userId, status: "ACTIVE" } } }),
    },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
    select: { id: true, slug: true, name: true, startsAt: true, endsAt: true, timezone: true, archivedAt: true },
  });
}
