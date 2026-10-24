import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import {
  eventContentSchemas,
  parseSeededEventContent,
  type CancellationPresetOption,
  type EventContentKind,
  type MealPresetOption,
  type SeededEventContent,
} from "@/modules/event-content/domain";
import { bundledEventContent } from "@/modules/event-content/seeded-data";

type Client = Prisma.TransactionClient | PrismaClient;

export type EventContentSyncResult = {
  created: Array<{ kind: string; key: string; version: number }>;
  updated: Array<{ kind: string; key: string; from: number; to: number }>;
  unchanged: Array<{ kind: string; key: string; version: number }>;
  /** Stored version is higher than the code's: left alone, reported (a rollback of the code, not of the data). */
  ahead: Array<{ kind: string; key: string; stored: number; code: number }>;
};

const syncLockKey = "seeded-event-content-sync";

/**
 * Brings every seeded event content file up to date (#919), the way `lodging:sync` and `form-templates:sync` do for
 * theirs: a row is written only when it is missing or the code's `version` is higher, so it is safe on every deploy and
 * any number of times. An advisory lock serializes two syncs. Nothing edits this content in the app, so a stored row is
 * always the code's. This only creates or updates `SeededEventContent` rows: it never reads or changes an event, its
 * meal services and plans, its cancellation rules, its lodging or its messages.
 */
export async function syncSeededEventContent(
  client: PrismaClient = getPrisma(),
  seeds: readonly SeededEventContent[] = bundledEventContent,
): Promise<EventContentSyncResult> {
  const result: EventContentSyncResult = { created: [], updated: [], unchanged: [], ahead: [] };
  // Refuse a seed the app would refuse, before anything is written.
  const valid = seeds.map((seed) => parseSeededEventContent(structuredClone(seed)));
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${syncLockKey}))`;
    for (const seed of valid) {
      const stored = await tx.seededEventContent.findUnique({ where: { kind_key: { kind: seed.kind, key: seed.key } }, select: { id: true, version: true } });
      if (stored && stored.version > seed.version) {
        result.ahead.push({ kind: seed.kind, key: seed.key, stored: stored.version, code: seed.version });
        continue;
      }
      if (stored && stored.version === seed.version) {
        result.unchanged.push({ kind: seed.kind, key: seed.key, version: stored.version });
        continue;
      }
      const data = { version: seed.version, name: seed.name, content: seed.content as unknown as Prisma.InputJsonValue };
      if (stored) {
        await tx.seededEventContent.update({ where: { id: stored.id }, data });
        result.updated.push({ kind: seed.kind, key: seed.key, from: stored.version, to: seed.version });
      } else {
        await tx.seededEventContent.create({ data: { kind: seed.kind, key: seed.key, ...data } });
        result.created.push({ kind: seed.kind, key: seed.key, version: seed.version });
      }
    }
  }, { timeout: 30_000 });
  return result;
}

/**
 * One piece of seeded content: the stored row when there is one and it reads, otherwise the bundled seed (a deploy that
 * has not run `event-content:sync` yet still works). Null for a key that does not exist. One unreadable stored row must
 * not take down the screen, so this logs the kind and key only, never the stored content.
 */
export async function loadEventContent<K extends EventContentKind>(client: Client, kind: K, key: string): Promise<SeededEventContent<K> | null> {
  const bundled = bundledEventContent.find((seed) => seed.kind === kind && seed.key === key) as SeededEventContent<K> | undefined;
  const row = await client.seededEventContent.findUnique({ where: { kind_key: { kind, key } } });
  if (!row) return bundled ?? null;
  const content = eventContentSchemas[kind].safeParse(row.content);
  if (!content.success) {
    logWarn(`Seeded event content row failed validation; ${bundled ? "using the code's copy" : "it is not available"}`, { kind, key, storedVersion: row.version });
    return bundled ?? null;
  }
  return { key: row.key, kind, version: row.version, name: row.name, content: content.data } as SeededEventContent<K>;
}

/** Every piece of content of a kind that the code lists, each as its stored row when that reads, in the code's order. */
export async function listEventContent<K extends EventContentKind>(client: Client, kind: K): Promise<SeededEventContent<K>[]> {
  const loaded: Array<SeededEventContent<K> | null> = await Promise.all(bundledEventContent.filter((seed) => seed.kind === kind).map((seed) => loadEventContent(client, kind, seed.key)));
  return loaded.filter((entry) => entry !== null) as SeededEventContent<K>[];
}

/** The meal presets the Meals screen offers an event that has no meals yet. */
export async function listMealPresetOptions(client: Client = getPrisma()): Promise<MealPresetOption[]> {
  return (await listEventContent(client, "MEAL_PRESET")).map(({ key, content }) => ({ key, label: content.label, description: content.description }));
}

/** The cancellation rule presets the rules screen offers. */
export async function listCancellationPresetOptions(client: Client = getPrisma()): Promise<CancellationPresetOption[]> {
  return (await listEventContent(client, "CANCELLATION_PRESET")).map(({ key, content }) => ({ key, label: content.label, description: content.description, content }));
}
