import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  dispatchAlerts,
  resolveAlertsExceptWithDetails,
  type Alert,
  type AlertDispatchResult,
} from "@/modules/operations/alerting";
import {
  assessOutboxQueue,
  getOutboxQueueSnapshot,
  type OutboxQueueSnapshot,
} from "@/modules/communications/outbox-sweep";
import { PAYMENT_STUCK_AFTER_MINUTES } from "@/modules/operations/operational-health";
import { readBackupAlerts } from "@/modules/operations/backup-alerts";
import { BACKUP_ALERT_KEY_PREFIX, backToNormalSummary } from "@/modules/operations/backup-alerts-domain";
import { postToDiscord } from "@/modules/operations/discord-alert-settings";
import { discordGroupForAlertKey, ONCE_ONLY_REPEAT_MINUTES } from "@/modules/operations/discord-alerts-domain";
import { logWarn } from "@/lib/logger";

/**
 * The scheduled read of every system-wide signal, turned into alerts.
 *
 * It runs at the end of the outbox sweep, which already runs every few minutes
 * in `docker-compose.yml`. One cron, one credential, and the sweep is exactly
 * the moment the queue's state is known.
 *
 * Per-event operational health (`modules/operations/repository.ts`) stays a page
 * someone reads. What is here is the subset nobody will be looking at when it
 * matters: delivery stopped, money stopped, the queue stopped draining.
 */

/** How far back a burst of failures counts as current. */
export const ALERT_WINDOW_MINUTES = 60;
/** Terminally failed messages in the window before it is urgent. */
export const FAILED_MESSAGE_ALERT_THRESHOLD = 1;
export const ALERT_KEY_PREFIX = "system.";

export type SystemAlertSignals = {
  outbox: OutboxQueueSnapshot;
  failedMessages: number;
  failedPayments: number;
  stuckPayments: number;
  oldestStuckPaymentMinutes: number | null;
};

/** Pure: signals in, alerts out. The thresholds live here and are testable. */
export function assessSystemSignals(signals: SystemAlertSignals): Alert[] {
  const alerts: Alert[] = [];
  const queue = assessOutboxQueue(signals.outbox);

  if (queue.status === "degraded") {
    alerts.push({
      key: `${ALERT_KEY_PREFIX}outbox.backed-up`,
      severity: "URGENT",
      group: "site-health",
      summary: "Email delivery is falling behind",
      detail: queue.reasons.join("; "),
      context: {
        due: signals.outbox.due,
        oldestDueAgeMinutes: signals.outbox.oldestDueAgeMs === null
          ? null
          : Math.round(signals.outbox.oldestDueAgeMs / 60000),
        accountMessagesDue: signals.outbox.accountMessagesDue,
      },
    });
  }

  if (signals.failedMessages >= FAILED_MESSAGE_ALERT_THRESHOLD) {
    alerts.push({
      key: `${ALERT_KEY_PREFIX}outbox.messages-failed`,
      severity: "URGENT",
      group: "site-health",
      summary: `${signals.failedMessages} message${signals.failedMessages === 1 ? "" : "s"} gave up after every retry`,
      detail: "Somebody did not receive a confirmation, a reminder, or an account link.",
      context: { failedMessages: signals.failedMessages, windowMinutes: ALERT_WINDOW_MINUTES },
    });
  }

  if (signals.failedPayments > 0) {
    alerts.push({
      key: `${ALERT_KEY_PREFIX}payments.failed`,
      severity: "URGENT",
      group: "site-health",
      summary: `${signals.failedPayments} card payment${signals.failedPayments === 1 ? "" : "s"} failed`,
      detail: "Check the payment attempts in Operational health before the registrant tries again.",
      context: { failedPayments: signals.failedPayments, windowMinutes: ALERT_WINDOW_MINUTES },
    });
  }

  if (signals.stuckPayments > 0) {
    alerts.push({
      key: `${ALERT_KEY_PREFIX}payments.stuck`,
      severity: "URGENT",
      group: "site-health",
      summary: `${signals.stuckPayments} card payment${signals.stuckPayments === 1 ? "" : "s"} never reached a result`,
      detail: `A payment left processing for more than ${PAYMENT_STUCK_AFTER_MINUTES} minutes usually means the provider webhook is not arriving.`,
      context: {
        stuckPayments: signals.stuckPayments,
        oldestStuckMinutes: signals.oldestStuckPaymentMinutes,
      },
    });
  }

  return alerts;
}

export async function readSystemSignals(now = new Date()): Promise<SystemAlertSignals> {
  const prisma = getPrisma();
  const windowStart = new Date(now.getTime() - ALERT_WINDOW_MINUTES * 60 * 1000);
  const stuckBefore = new Date(now.getTime() - PAYMENT_STUCK_AFTER_MINUTES * 60 * 1000);

  const [outbox, failedMessages, failedPayments, stuckPayments, oldestStuck] = await Promise.all([
    getOutboxQueueSnapshot(now),
    prisma.messageOutbox.count({
      where: { status: "FAILED", failedAt: { gte: windowStart } },
    }),
    prisma.paymentAttempt.count({
      where: { status: "FAILED", updatedAt: { gte: windowStart } },
    }),
    prisma.paymentAttempt.count({
      where: { status: { in: ["PROCESSING", "PENDING"] }, createdAt: { lte: stuckBefore } },
    }),
    prisma.paymentAttempt.findFirst({
      where: { status: { in: ["PROCESSING", "PENDING"] }, createdAt: { lte: stuckBefore } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    outbox,
    failedMessages,
    failedPayments,
    stuckPayments,
    oldestStuckPaymentMinutes: oldestStuck
      ? Math.round((now.getTime() - oldestStuck.createdAt.getTime()) / 60000)
      : null,
  };
}

export type AlertScanResult = AlertDispatchResult & {
  signals: SystemAlertSignals;
  cleared: number;
};

export async function runAlertScan(
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<AlertScanResult> {
  const now = options.now ?? new Date();
  const signals = await readSystemSignals(now);
  // Backup problems are read separately: a failed read adds no alert and never stops the rest of the scan.
  const backups = await readBackupAlerts(now).catch((error) => {
    logWarn("The backup alerts could not be read.", { error: error instanceof Error ? error.name : typeof error });
    return { alerts: [] as Alert[], notices: [] as Alert[], keepPrefixes: [BACKUP_ALERT_KEY_PREFIX] };
  });
  const alerts = [...assessSystemSignals(signals), ...backups.alerts];

  // Conditions that are no longer true are cleared first, so a problem that
  // recurs after being fixed pages immediately instead of waiting out a window
  // that started while it was still broken.
  const { count: cleared, cleared: clearedAlerts } = await resolveAlertsExceptWithDetails(
    alerts.map((alert) => alert.key),
    ALERT_KEY_PREFIX,
    now,
    // A backup read that failed says nothing about whether the problem is gone: keep those alerts as they are.
    backups.keepPrefixes,
  );
  const dispatched = await dispatchAlerts(alerts, { now, fetchImpl: options.fetchImpl });
  // One-time notices (a restore check passed) are sent once each, never repeated.
  await dispatchAlerts(backups.notices, { now, fetchImpl: options.fetchImpl, repeatMinutes: ONCE_ONLY_REPEAT_MINUTES });
  // "Back to normal" goes to Discord only, in the group the condition belonged to. It never throws.
  for (const gone of clearedAlerts) {
    await postToDiscord(
      discordGroupForAlertKey(gone.key),
      { severity: "INFO", summary: backToNormalSummary(gone.key), backToNormal: true },
      { fetchImpl: options.fetchImpl, now },
    );
  }

  return { ...dispatched, signals, cleared };
}
