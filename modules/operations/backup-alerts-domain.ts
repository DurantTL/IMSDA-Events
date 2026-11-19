import type { Alert } from "@/modules/operations/alerting";
import type { BackupStatus } from "@/modules/operations/backup-status";
import type { OffsiteDatabaseStatus } from "@/modules/operations/offsite-backups";

/** Keys start with `system.backup.` so the alert scan clears them, and says "back to normal", when the condition ends. */
export const BACKUP_ALERT_KEY_PREFIX = "system.backup.";

/**
 * Pure: the backup status and the off-host check in, alerts out. Fixed words and no counts of people; the Discord group
 * is "backups". A `null` status means the app's own backup helper has not reported (production backups run outside it),
 * so only the off-host check can speak.
 */
export function assessBackupAlerts(input: { status: BackupStatus | null; offsiteDatabase: OffsiteDatabaseStatus | null }): Alert[] {
  const alerts: Alert[] = [];
  const { status, offsiteDatabase } = input;

  if (status?.stale) {
    alerts.push({
      key: `${BACKUP_ALERT_KEY_PREFIX}nightly-overdue`,
      severity: "URGENT",
      group: "backups",
      summary: "The nightly backup is overdue",
      detail: "There has been no successful backup in over 36 hours.",
    });
  } else if (status?.status === "failing") {
    alerts.push({
      key: `${BACKUP_ALERT_KEY_PREFIX}nightly-failed`,
      severity: "URGENT",
      group: "backups",
      summary: "The latest nightly backup failed",
      detail: "The previous good backup is still there.",
    });
  }

  if (offsiteDatabase === "stale" || offsiteDatabase === "missing" || status?.offsiteStopped || status?.offsiteOk === false) {
    alerts.push({
      key: `${BACKUP_ALERT_KEY_PREFIX}offsite-overdue`,
      severity: "URGENT",
      group: "backups",
      summary: "The off-host copy of the backup is overdue",
      detail: "The newest database backup stored away from the server is older than it should be.",
    });
  }

  if (status?.lastRehearsalOk === false) {
    alerts.push({
      key: `${BACKUP_ALERT_KEY_PREFIX}rehearsal-failed`,
      severity: "URGENT",
      group: "backups",
      summary: "The automatic restore check failed",
      detail: "A backup could not be restored in the test.",
    });
  } else if (status?.rehearsalOverdue) {
    alerts.push({
      key: `${BACKUP_ALERT_KEY_PREFIX}rehearsal-overdue`,
      severity: "WATCH",
      group: "backups",
      summary: "The automatic restore check is overdue",
      detail: "No restore check has passed in over 8 days.",
    });
  }

  return alerts;
}

/** A passed restore check is sent once, only while it is recent, so turning alerts on does not announce an old result. */
export const REHEARSAL_PASSED_RECENT_MS = 24 * 60 * 60 * 1000;

export function rehearsalPassedAlert(status: BackupStatus | null, now: Date): Alert | null {
  if (!status || status.lastRehearsalOk !== true || !status.lastRehearsalAt) return null;
  const at = Date.parse(status.lastRehearsalAt);
  if (!Number.isFinite(at) || now.getTime() - at > REHEARSAL_PASSED_RECENT_MS) return null;
  return {
    key: `notice.backup.rehearsal-passed.${at}`,
    severity: "INFO",
    group: "backups",
    summary: "The automatic restore check passed",
    detail: "A backup was restored in the test.",
  };
}

const BACK_TO_NORMAL: Record<string, string> = {
  "system.outbox.backed-up": "Email delivery is keeping up again.",
  "system.outbox.messages-failed": "No messages have given up in the last hour.",
  "system.payments.failed": "No card payments have failed in the last hour.",
  "system.payments.stuck": "No card payments are stuck waiting for a result.",
  "system.backup.nightly-overdue": "The nightly backup is current again.",
  "system.backup.nightly-failed": "The nightly backup is working again.",
  "system.backup.offsite-overdue": "The off-host copy of the backup is current again.",
  "system.backup.rehearsal-failed": "The automatic restore check is passing again.",
  "system.backup.rehearsal-overdue": "The automatic restore check has run again.",
};

/** The "back to normal" words for a cleared alert key. A fixed sentence, never the stored text. */
export function backToNormalSummary(key: string): string {
  return BACK_TO_NORMAL[key] ?? "A problem that was reported earlier is back to normal.";
}
