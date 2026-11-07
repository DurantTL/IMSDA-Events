import type { Prisma } from "@prisma/client";
import { wasClubsAdministratorAccess } from "@/lib/clubs-administrator-access-record";

/** The `actorRole` an audit row carries when the actor had event access only through the Clubs Administrator role. */
export const CLUBS_ADMINISTRATOR_ACTOR_ROLE = "CLUBS_ADMINISTRATOR";

/**
 * The audit marker for Clubs Administrators on club events (#1643). A row whose `eventId` and `actorUserId` match an
 * access the permission lookup recorded in this request (`lib/clubs-administrator-access-record.ts`) carries
 * `actorRole: "CLUBS_ADMINISTRATOR"` in its metadata, the same marker the club areas write. A row that already has an
 * `actorRole` keeps it. It is applied by the query extension on `auditLog.create` and `auditLog.createMany` in
 * `lib/prisma.ts`, so every audit write path gets it. It makes no database query: it only reads the request's record.
 */
type AuditRowFields = { eventId?: unknown; actorUserId?: unknown; metadata?: unknown };

export function withClubsAdministratorMarker<Row extends AuditRowFields>(row: Row): Row {
  const { eventId, actorUserId, metadata } = row;
  if (typeof eventId !== "string" || typeof actorUserId !== "string") return row;
  if (metadata !== undefined && (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))) return row;
  if (metadata && "actorRole" in metadata) return row;
  if (!wasClubsAdministratorAccess(actorUserId, eventId)) return row;
  return { ...row, metadata: { ...((metadata as Prisma.JsonObject | undefined) ?? {}), actorRole: CLUBS_ADMINISTRATOR_ACTOR_ROLE } };
}
