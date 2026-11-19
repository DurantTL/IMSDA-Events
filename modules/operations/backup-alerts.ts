import "server-only";

import { logWarn } from "@/lib/logger";
import type { Alert } from "@/modules/operations/alerting";
import { backupHelperHasReported, type BackupStatus } from "@/modules/operations/backup-status";
import { getBackupStatus } from "@/modules/operations/backup-status-repository";
import { offsiteDatabaseStatus, type OffsiteBackupResult } from "@/modules/operations/offsite-backups";
import { getOffsiteBackups } from "@/modules/operations/offsite-backups-reader";
import { assessBackupAlerts, BACKUP_ALERT_KEY_PREFIX, rehearsalPassedAlert } from "@/modules/operations/backup-alerts-domain";

const OFFSITE_KEY_PREFIX = `${BACKUP_ALERT_KEY_PREFIX}offsite-`;
const BACKUP_STATUS_KEY_PREFIXES = [`${BACKUP_ALERT_KEY_PREFIX}nightly-`, `${BACKUP_ALERT_KEY_PREFIX}rehearsal-`];

/**
 * The backup signals as alerts (#2048): the app's own backup runs and the off-host copy. `notices` are one-time
 * messages (a restore check passed). `keepPrefixes` names the alert keys owned by a source that could not be read (the status table owns the
 * nightly and restore keys, the off-host check owns the off-host key), so the scan keeps just those open instead of
 * calling them cleared. A read that fails adds no alert
 * and is logged as a fixed word; the scan carries on.
 */
export async function readBackupAlerts(now: Date): Promise<{ alerts: Alert[]; notices: Alert[]; keepPrefixes: string[] }> {
  let status: BackupStatus | null = null;
  let offsite: OffsiteBackupResult | null = null;
  const keepPrefixes: string[] = [];
  try {
    status = await getBackupStatus(now);
  } catch (error) {
    keepPrefixes.push(...BACKUP_STATUS_KEY_PREFIXES);
    logWarn("The backup status could not be read for alerts.", { error: error instanceof Error ? error.name : typeof error });
  }
  try {
    offsite = await getOffsiteBackups();
  } catch (error) {
    keepPrefixes.push(OFFSITE_KEY_PREFIX);
    logWarn("The off-host backup check could not be read for alerts.", { error: error instanceof Error ? error.name : typeof error });
  }
  // The off-host reader reports a listing that failed as an `error` answer rather than throwing.
  if (offsite?.state === "error") keepPrefixes.push(OFFSITE_KEY_PREFIX);
  const alerts = assessBackupAlerts({
    status: status && backupHelperHasReported(status) ? status : null,
    offsiteDatabase: offsite ? offsiteDatabaseStatus(offsite, now) : null,
  });
  const passed = rehearsalPassedAlert(status, now);
  return { alerts, notices: passed ? [passed] : [], keepPrefixes };
}
