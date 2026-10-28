import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { deleteAsset } from "@/modules/events/asset-storage";
import { logError } from "@/lib/logger";

/**
 * What decides whether a stored message file may go, and how its bytes are removed afterwards (#845). Shared by the
 * sweep and by staff removing one file, so both apply the same rule and the same record of unfinished disk work.
 */

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * The ids, out of `ids`, that something still refers to. Never delete a file this names. Every event is searched,
 * not just the file's own: a cloned template can carry a body that names another event's picture.
 *
 * A file is referenced when:
 * - a template version, an announcement or a queued/sent message holds a link row to it (foreign keys, any status,
 *   including archived and sent historical versions); or
 * - `msgfile:<id>` appears in any text a body can be written into: a template version's body or preheader, an
 *   announcement's body or preheader, a scheduled batch's announcement body, or a message's HTML or text snapshot.
 *   A body names a picture by id with no foreign key, so the text itself is the only record.
 *
 * The text match is a plain substring check on `msgfile:<id>`, deliberately wider than the picture syntax: a false
 * "referenced" only keeps a file a little longer, a false "unreferenced" loses one. Run it in the delete transaction
 * after the rows are locked, as separate statements, so each sees what has committed since the last.
 */
export async function findReferencedMessageFileIds(client: Client, ids: readonly string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  if (ids.length === 0) return referenced;
  const list = Prisma.join([...ids]);

  const linked = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "fileId" AS id FROM "MessageTemplateVersionFile" WHERE "fileId" IN (${list})
    UNION
    SELECT "fileId" AS id FROM "AnnouncementFile" WHERE "fileId" IN (${list})
    UNION
    SELECT "fileId" AS id FROM "MessageOutboxFile" WHERE "fileId" IN (${list})
  `);
  for (const row of linked) referenced.add(row.id);

  const remaining = ids.filter((id) => !referenced.has(id));
  if (remaining.length === 0) return referenced;
  const rest = Prisma.join(remaining);
  const named = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH docs AS MATERIALIZED (
      SELECT "bodyTemplate" AS doc FROM "MessageTemplateVersion" WHERE "bodyTemplate" LIKE '%msgfile:%'
      UNION ALL
      SELECT "preheaderTemplate" FROM "MessageTemplateVersion" WHERE "preheaderTemplate" LIKE '%msgfile:%'
      UNION ALL
      SELECT "body" FROM "Announcement" WHERE "body" LIKE '%msgfile:%'
      UNION ALL
      SELECT "preheader" FROM "Announcement" WHERE "preheader" LIKE '%msgfile:%'
      UNION ALL
      SELECT "announcementBody" FROM "ScheduledEmailBatch" WHERE "announcementBody" LIKE '%msgfile:%'
      UNION ALL
      SELECT "bodyHtmlSnapshot" FROM "MessageOutbox" WHERE "bodyHtmlSnapshot" LIKE '%msgfile:%'
      UNION ALL
      SELECT "bodyTextSnapshot" FROM "MessageOutbox" WHERE "bodyTextSnapshot" LIKE '%msgfile:%'
    )
    SELECT DISTINCT c.id
    FROM unnest(ARRAY[${rest}]::text[]) AS c(id)
    JOIN docs ON strpos(docs.doc, 'msgfile:' || c.id) > 0
  `);
  for (const row of named) referenced.add(row.id);
  return referenced;
}

export type PendingCleanup = { id: string; eventId: string; storageKey: string; sizeBytes: number };

/** The operating-system error code of a failed disk operation, never its message (which carries a path). */
export function errnoCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "UNKNOWN";
}

/**
 * Removes the bytes behind cleanup records, after the transaction that wrote them has committed. A record whose bytes
 * are gone is deleted (and a file already missing counts as gone). One that cannot be removed stays, with its attempt
 * count and the error code, and keeps counting against the event's quota: a failed delete frees nothing. Never throws.
 */
export async function removeStoredBytes(client: Client, pending: readonly PendingCleanup[], now: Date) {
  let removed = 0;
  let removedBytes = 0;
  let failed = 0;
  for (const entry of pending) {
    try {
      await deleteAsset(entry.storageKey);
    } catch (error) {
      failed += 1;
      const code = errnoCode(error);
      logError("A removed message file's bytes could not be deleted; it will be retried", error, {
        cleanupId: entry.id,
        eventId: entry.eventId,
        errorCode: code,
      });
      await client.messageFileStorageCleanup
        .updateMany({ where: { id: entry.id }, data: { attempts: { increment: 1 }, lastErrorCode: code, lastAttemptAt: now } })
        .catch((updateError: unknown) => logError("Recording a failed message file cleanup attempt failed", updateError, { cleanupId: entry.id }));
      continue;
    }
    try {
      await client.messageFileStorageCleanup.deleteMany({ where: { id: entry.id } });
      removed += 1;
      removedBytes += entry.sizeBytes;
    } catch (error) {
      // The bytes are gone; the next retry finds nothing to delete (a missing file is success) and clears the record.
      logError("Clearing a finished message file cleanup record failed", error, { cleanupId: entry.id });
    }
  }
  return { removed, removedBytes, failed };
}
