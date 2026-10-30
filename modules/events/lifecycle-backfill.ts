import "server-only";

import { getPrisma } from "@/lib/prisma";
import { legacyLifecycleState, type StoredEventLifecycleState } from "@/modules/events/lifecycle-state";

export type EventLifecycleBackfillRow = {
  id: string;
  slug: string;
  isPublished: boolean;
  archived: boolean;
  from: string | null;
  to: StoredEventLifecycleState;
  /** True when a write is needed (the stored state is still null). */
  needsWrite: boolean;
};

export type EventLifecycleBackfillReport = {
  dryRun: boolean;
  totalEvents: number;
  needsWrite: number;
  updatedCount: number;
  countsByState: Record<string, number>;
  rows: EventLifecycleBackfillRow[];
};

/**
 * Gives every legacy event (stored `lifecycleState` null) the state it already reads as (#156): published
 * becomes PUBLISHED, unpublished becomes DRAFT, archived events by their `isPublished` (archive stays the
 * `archivedAt` overlay). It writes only that column, only where it is null, never touches `updatedAt`
 * (an open settings form must not see a conflict), and writes no history row, so no transition date is
 * invented. Idempotent: a second run finds nothing null. Dry run by default; the report holds ids, slugs
 * and counts only. Running it against production is a human step.
 */
export async function backfillEventLifecycle(apply: boolean): Promise<EventLifecycleBackfillReport> {
  const prisma = getPrisma();
  const events = await prisma.event.findMany({
    orderBy: { id: "asc" },
    select: { id: true, slug: true, isPublished: true, archivedAt: true, lifecycleState: true },
  });
  const rows: EventLifecycleBackfillRow[] = events.map((event) => ({
    id: event.id,
    slug: event.slug,
    isPublished: event.isPublished,
    archived: event.archivedAt !== null,
    from: event.lifecycleState,
    to: event.lifecycleState === null ? legacyLifecycleState(event) : (event.lifecycleState as StoredEventLifecycleState),
    needsWrite: event.lifecycleState === null,
  }));
  const countsByState: Record<string, number> = {};
  for (const row of rows) countsByState[row.to] = (countsByState[row.to] ?? 0) + 1;

  let updatedCount = 0;
  if (apply) {
    for (const row of rows.filter((candidate) => candidate.needsWrite)) {
      // Raw so `updatedAt` is left alone; the null guard keeps a concurrent transition's state.
      updatedCount += await prisma.$executeRaw`
        UPDATE "Event" SET "lifecycleState" = ${row.to}::"EventLifecycleState"
        WHERE "id" = ${row.id} AND "lifecycleState" IS NULL`;
    }
  }
  return { dryRun: !apply, totalEvents: rows.length, needsWrite: rows.filter((row) => row.needsWrite).length, updatedCount, countsByState, rows };
}
