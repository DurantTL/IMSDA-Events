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
      for (const name of column.preserve) data[name] = row.fields[name];
      const fingerprint = column.fingerprint;
      const oldFingerprint = fingerprint ? row.fields[fingerprint.column] : undefined;
      if (fingerprint && next.fingerprint !== undefined) data[fingerprint.column] = next.fingerprint;
      // Compare-and-set: only if the row still holds the value that was read.
      const where = { id: row.id, [column.column]: row.value };

      if (!fingerprint?.copies?.length || typeof oldFingerprint !== "string" || next.fingerprint === undefined) {
        return (await delegates(getPrisma())[column.model].updateMany({ where, data })).count === 1;
      }
      const newFingerprint = next.fingerprint;
      const copies = fingerprint.copies;
      return getPrisma().$transaction(async (tx) => {
        const client = delegates(tx);
        const changed = await client[column.model].updateMany({ where, data });
        if (changed.count !== 1) return false;
        // Items left behind by a deleted feed remember the feed's fingerprint; move them with it.
        for (const copy of copies) {
          await client[copy.model].updateMany({
            where: { [copy.column]: oldFingerprint },
            data: { [copy.column]: newFingerprint },
          });
        }
        return true;
      });
    },
  };
}
