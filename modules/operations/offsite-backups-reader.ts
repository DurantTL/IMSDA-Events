import "server-only";

import { getServerEnv } from "@/lib/env";
import { logWarn } from "@/lib/logger";
import { listBackupObjects, R2ListError, resolveR2ReadConfig } from "@/integrations/backups/r2-read";
import type { BackupListing, R2ReadConfig } from "@/integrations/backups/types";
import { assessOffsiteBackups, type OffsiteBackupResult } from "./offsite-backups";

/**
 * Reads the R2 listing and caches the answer in this process: a success for 10 minutes, a failure for 1 minute,
 * with concurrent callers sharing one read. The System report and the detailed health check both come through here,
 * so a polling monitor cannot turn into a stream of R2 requests. Never throws; a failure is a generic reason.
 */

export const OFFSITE_SUCCESS_TTL_MS = 10 * 60 * 1000;
export const OFFSITE_FAILURE_TTL_MS = 60 * 1000;

const REASONS: Record<R2ListError["failure"], string> = {
  refused: "R2 refused the read-only key",
  timeout: "timed out",
  unreachable: "could not reach R2",
  bad_response: "R2 gave an answer the app could not read",
};

type Env = Record<string, string | undefined>;
type Deps = {
  env?: Env;
  list?: (config: R2ReadConfig) => Promise<BackupListing>;
};

let cached: { result: OffsiteBackupResult; expiresAt: number } | null = null;
let inflight: Promise<OffsiteBackupResult> | null = null;

/** Test seam. */
export function resetOffsiteBackupsCache() {
  cached = null;
  inflight = null;
}

function currentEnv(): Env {
  try {
    return getServerEnv() as unknown as Env;
  } catch {
    return process.env;
  }
}

async function read(env: Env, list: NonNullable<Deps["list"]>): Promise<OffsiteBackupResult> {
  const state = resolveR2ReadConfig(env);
  if (state.state === "not_connected") return { state: "not_connected" };
  if (state.state === "misconfigured") return { state: "misconfigured", missing: state.missing, invalid: state.invalid };

  try {
    const listing = await list(state.config);
    return assessOffsiteBackups({
      objects: listing.objects,
      partial: listing.partial,
      databasePatterns: env.BACKUP_R2_READ_DATABASE_PATTERNS,
      filesPatterns: env.BACKUP_R2_READ_FILES_PATTERNS,
      now: new Date(),
    });
  } catch (error) {
    const failure = error instanceof R2ListError ? error.failure : "unreachable";
    logWarn("Offsite backup listing failed", { reason: failure });
    return { state: "error", reason: REASONS[failure], checkedAt: new Date().toISOString() };
  }
}

export async function getOffsiteBackups(deps: Deps = {}): Promise<OffsiteBackupResult> {
  const env = deps.env ?? currentEnv();
  const state = resolveR2ReadConfig(env);
  // Nothing to fetch, so nothing to cache.
  if (state.state !== "connected") return read(env, async () => ({ objects: [], partial: false }));

  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.result;
  if (inflight) return inflight;

  const list = deps.list ?? ((config: R2ReadConfig) => listBackupObjects(config));
  const pending = read(env, list)
    .then((result) => {
      cached = { result, expiresAt: Date.now() + (result.state === "error" ? OFFSITE_FAILURE_TTL_MS : OFFSITE_SUCCESS_TTL_MS) };
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = pending;
  return pending;
}
