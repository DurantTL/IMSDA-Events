import "server-only";

import { logError } from "@/lib/logger";
import { getBackupStatus } from "@/modules/operations/backup-status-repository";
import type { BackupStatus } from "@/modules/operations/backup-status";

/**
 * The one seam for backup status on the System readiness page (#870, #895).
 *
 * It reads the same `BackupRun` assessment that `/api/health` uses (#875), so the page and the health check agree on
 * fresh, stale and never run. Only the assessed status (dates, pass/fail, yes/no) crosses this seam; the status
 * carries no bucket, path, key or host. When the log cannot be read the evidence says so and the rows show
 * "unknown"; the page still renders.
 */
export type BackupEvidence = { readable: true; status: BackupStatus } | { readable: false };

export async function getAutomaticBackupEvidence(now = new Date()): Promise<BackupEvidence> {
  try {
    return { readable: true, status: await getBackupStatus(now) };
  } catch (error) {
    logError("System readiness could not read the backup log", error);
    return { readable: false };
  }
}
