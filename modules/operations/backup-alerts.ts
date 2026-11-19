import "server-only";

import { logWarn } from "@/lib/logger";
import type { Alert } from "@/modules/operations/alerting";
import { backupHelperHasReported, type BackupStatus } from "@/modules/operations/backup-status";
import { getBackupStatus } from "@/modules/operations/backup-status-repository";
import { offsiteDatabaseStatus, type OffsiteBackupResult } from "@/modules/operations/offsite-backups";
import { getOffsiteBackups } from "@/modules/operations/offsite-backups-reader";
import { assessBackupAlerts, rehearsalPassedAlert } from "@/modules/operations/backup-alerts-domain";

/**
 * The backup signals as alerts (#2048): the app's own backup runs and the off-host copy. `notices` are one-time
 * messages (a restore check passed). `readFailed` means a source could not be read, so the scan keeps the existing
 * backup alerts open instead of calling them cleared. A read that fails adds no alert
 * and is logged as a fixed word; the scan carries on.
 */
export async function readBackupAlerts(now: Date): Promise<{ alerts: Alert[]; notices: Alert[]; readFailed: boolean }> {
  let status: BackupStatus | null = null;
  let offsite: OffsiteBackupResult | null = null;
  let readFailed = false;
  try {
    status = await getBackupStatus(now);
  } catch (error) {
    readFailed = true;
    logWarn("The backup status could not be read for alerts.", { error: error instanceof Error ? error.name : typeof error });
  }
  try {
    offsite = await getOffsiteBackups();
  } catch (error) {
    readFailed = true;
    logWarn("The off-host backup check could not be read for alerts.", { error: error instanceof Error ? error.name : typeof error });
  }
  // The off-host reader reports a listing that failed as an `error` answer rather than throwing.
  if (offsite?.state === "error") readFailed = true;
  const alerts = assessBackupAlerts({
    status: status && backupHelperHasReported(status) ? status : null,
    offsiteDatabase: offsite ? offsiteDatabaseStatus(offsite, now) : null,
  });
  const passed = rehearsalPassedAlert(status, now);
  return { alerts, notices: passed ? [passed] : [], readFailed };
}
