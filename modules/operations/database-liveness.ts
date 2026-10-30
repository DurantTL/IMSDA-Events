import "server-only";

import { getPrisma } from "@/lib/prisma";

/**
 * Whether the database answers a trivial query. The one definition behind `/api/health` and the System report, so
 * the two cannot disagree about "the database is up". The error is returned, not thrown, so each caller decides what
 * to log and whether to alert; it carries no value the System report shows.
 */
export type DatabaseLiveness = { ok: true } | { ok: false; error: unknown };

export async function checkDatabaseLiveness(): Promise<DatabaseLiveness> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
