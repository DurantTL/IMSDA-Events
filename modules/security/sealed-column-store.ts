import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { SealedColumnStore, SealedRow } from "@/modules/security/key-rotation";
import type { SealedColumn, SealedModel } from "@/modules/security/sealed-columns";

/**
 * The Prisma side of key rotation and the key health check (#1516). Every
 * model in the registry is reached through the same four calls, so the
 * delegate is typed by the shape those calls need rather than per model.
 */
type Delegate = {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { id: "asc" };
    take: number;
    select: Record<string, true>;
  }): Promise<Record<string, unknown>[]>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
};

type Client = Record<SealedModel | "calendarEntry", Delegate>;

function delegates(client: unknown): Client {
  return client as Client;
}

function selectFor(column: SealedColumn) {
  const select: Record<string, true> = { id: true, [column.column]: true };
  for (const name of column.purposeColumns) select[name] = true;
  for (const name of column.preserve) select[name] = true;
  if (column.fingerprint) select[column.fingerprint.column] = true;
  return select;
}

/**
 * `idPrefix` limits every read to rows whose id starts with it. Only the
 * verification script uses it, to touch nothing but its own fictitious rows.
 */
export function createPrismaSealedColumnStore(options: { idPrefix?: string } = {}): SealedColumnStore {
  return {
    async readBatch(column, afterId, take): Promise<SealedRow[]> {
      const where: Record<string, unknown> = {};
      if (afterId !== null || options.idPrefix) {
        where.id = {
          ...(afterId !== null ? { gt: afterId } : {}),
          ...(options.idPrefix ? { startsWith: options.idPrefix } : {}),
        };
      }
      if (column.nullable) where[column.column] = { not: null };
      const rows = await delegates(getPrisma())[column.model].findMany({
        where,
        orderBy: { id: "asc" },
        take,
        select: selectFor(column),
      });
      return rows.map((fields) => ({ id: String(fields.id), value: String(fields[column.column]), fields }));
    },

    async replace(column, row, next) {
      const data: Record<string, unknown> = { [column.column]: next.value };
      // Prisma would stamp `updatedAt` on this write; write the row's own value back instead.
      for (const name of column.preserve) data[name] = row.fields[name];
      const fingerprint = column.fingerprint;
      const oldFingerprint = fingerprint ? row.fields[fingerprint.column] : undefined;
      if (fingerprint && next.fingerprint !== undefined) data[fingerprint.column] = next.fingerprint;
      // Compare-and-set: only if the row still holds the value (and `updatedAt`) that were read, so a
      // concurrent edit makes this write skip rather than roll its `updatedAt` back.
      const where: Record<string, unknown> = { id: row.id, [column.column]: row.value };
      for (const name of column.preserve) where[name] = row.fields[name];

      const copies = fingerprint?.copies;
      const moveCopies = Boolean(copies?.length) && typeof oldFingerprint === "string" && next.fingerprint !== undefined;
      if (!moveCopies && !column.keyRotationGuard) {
        return (await delegates(getPrisma())[column.model].updateMany({ where, data })).count === 1;
      }
      return getPrisma().$transaction(async (tx) => {
        // Transaction-local: lifts only the sealed-copy trigger's one rotation exception.
        if (column.keyRotationGuard) await tx.$queryRaw`SELECT set_config('imsda.key_rotation', 'on', true)`;
        const changed = await delegates(tx)[column.model].updateMany({ where, data });
        if (changed.count !== 1) return false;
        if (moveCopies) {
          // Items left behind by a deleted feed remember the feed's fingerprint; move them with it, keeping
          // their `updatedAt` (a raw update does not stamp it).
          for (const copy of copies ?? []) {
            if (copy.model !== "calendarEntry" || copy.column !== "sourceUrlFingerprint") throw new Error("Unsupported fingerprint copy.");
            await tx.$executeRaw`UPDATE "CalendarEntry" SET "sourceUrlFingerprint" = ${next.fingerprint} WHERE "sourceUrlFingerprint" = ${String(oldFingerprint)}`;
          }
        }
        return true;
      });
    },
  };
}

/**
 * Items a deleted calendar feed left behind that carry a fingerprint no current feed has. Rotation can't recompute
 * these (the address is gone), so after the previous key is removed they will not relink to an identical re-added feed.
 * Informational; a count only.
 */
export async function countDetachedCalendarFingerprints() {
  const rows = await getPrisma().$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "CalendarEntry" e
    WHERE e."sourceFeedId" IS NULL AND e."sourceUrlFingerprint" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CalendarFeed" f WHERE f."urlFingerprint" = e."sourceUrlFingerprint")`;
  return rows[0]?.count ?? 0;
}
