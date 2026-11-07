import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { currentCorrelationId } from "@/lib/request-context";
import { CLUBS_ADMINISTRATOR_ACTOR_ROLE, actsViaClubsAdministrator } from "@/modules/access/club-event-access";

export type AuditEntry = {
  eventId?: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  /**
   * Omit it inside a request: the request's own ID is used, which is what ties
   * an audit entry to the log lines and the response header for the same call.
   * Callers that already mint one keep working unchanged.
   */
  correlationId?: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
};

type AuditClient = Prisma.TransactionClient | PrismaClient;

export async function writeAuditLog(
  entry: AuditEntry,
  client: AuditClient = getPrisma(),
) {
  return client.auditLog.create({
    data: {
      ...entry,
      metadata: await withClubsAdministratorMarker(entry, client),
      correlationId: entry.correlationId ?? currentCorrelationId() ?? randomUUID(),
    },
  });
}

/**
 * An action on a club event by an actor whose event access comes only through the Clubs Administrator role (#1643) records
 * `actorRole: "CLUBS_ADMINISTRATOR"`, the same marker the club areas write. A caller that already set `actorRole` keeps
 * its own. Read from the database at write time, so it names the role the actor held when they acted. A lookup that
 * fails never blocks the audit entry itself, which is written unmarked.
 */
async function withClubsAdministratorMarker(entry: AuditEntry, client: AuditClient): Promise<AuditEntry["metadata"]> {
  const { metadata, eventId, actorUserId } = entry;
  if (!eventId || !actorUserId) return metadata;
  if (metadata !== undefined && (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))) return metadata;
  if (metadata && "actorRole" in metadata) return metadata;
  try {
    if (!(await actsViaClubsAdministrator(actorUserId, eventId, client))) return metadata;
  } catch {
    return metadata;
  }
  return { ...(metadata ?? {}), actorRole: CLUBS_ADMINISTRATOR_ACTOR_ROLE };
}

export async function listRecentAuditActivity(eventId: string, take = 12) {
  const rows = await getPrisma().auditLog.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { displayName: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    summary: row.summary,
    actorName: row.actor?.displayName ?? "System",
    createdAt: row.createdAt.toISOString(),
  }));
}
