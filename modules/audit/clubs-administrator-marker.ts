import type { Prisma, PrismaClient } from "@prisma/client";
import { CLUBS_ADMINISTRATOR_ACTOR_ROLE, actsViaClubsAdministrator } from "@/modules/access/club-event-access";

/**
 * The audit marker for Clubs Administrators on club events (#1643). An audit row for an event whose actor has event
 * access only through the Clubs Administrator role carries `actorRole: "CLUBS_ADMINISTRATOR"` in its metadata, the same
 * marker the club areas write. A row that already has an `actorRole` keeps it. It is applied by the query extension on
 * `auditLog.create` and `auditLog.createMany` in `lib/prisma.ts`, so every audit write path (`writeAuditLog` and the
 * direct `tx.auditLog.create` calls in the repositories) gets it and no call site can miss it.
 *
 * The lookup runs on `lookup`, the client outside any caller's transaction (read only), so a failed lookup can never abort
 * the caller's transaction; a lookup that fails writes the row unmarked.
 */
type AuditRowFields = { eventId?: unknown; actorUserId?: unknown; metadata?: unknown };

export async function withClubsAdministratorMarker<Row extends AuditRowFields>(row: Row, lookup: PrismaClient): Promise<Row> {
  const { eventId, actorUserId, metadata } = row;
  if (typeof eventId !== "string" || typeof actorUserId !== "string") return row;
  if (metadata !== undefined && (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))) return row;
  if (metadata && "actorRole" in metadata) return row;
  try {
    if (!(await actsViaClubsAdministrator(actorUserId, eventId, lookup))) return row;
  } catch {
    return row;
  }
  return { ...row, metadata: { ...((metadata as Prisma.JsonObject | undefined) ?? {}), actorRole: CLUBS_ADMINISTRATOR_ACTOR_ROLE } };
}
