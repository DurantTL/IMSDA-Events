/**
 * Whether the scheduled outbox sweep is still running.
 *
 * The sweep is also what runs the alert scan, so when it stops nothing else
 * notices: failed email is never retried and no alert is ever raised. Each
 * sweep records when it finished here, and `/api/health` and the command
 * center read it back.
 *
 * This file is pure so the page and the health route share one definition of
 * "stale". The database read and write live in `sweep-heartbeat-repository.ts`.
 */

export const OUTBOX_SWEEP_JOB = "outbox-sweep";

/** Other unattended steps and on-demand tests that record a run on the same row (#1357). */
export const CALENDAR_FEED_REFRESH_JOB = "calendar-feed-refresh";
export const MESSAGE_FILE_CLEANUP_JOB = "message-file-cleanup";
export const GENERAL_LINK_EXPIRY_JOB = "general-link-expiry";
export const EMAIL_REACHABILITY_JOB = "email-reachability";
export const SQUARE_REACHABILITY_JOB = "square-reachability";
export const PAY_ON_SQUARE_LINK_SWEEP_JOB = "pay-on-square-link-sweep";
/** The rest of the sweep's steps (#1377). The alert webhook job is recorded when a delivery is attempted, not on every sweep. */
export const ALERT_SCAN_JOB = "alert-scan";
export const ALERT_WEBHOOK_DELIVERY_JOB = "alert-webhook-delivery";
export const DEADLINE_REMINDER_PREPARATION_JOB = "deadline-reminder-preparation";
export const LOCATION_WAITLIST_DIGEST_JOB = "location-waitlist-digest";
export const CLASS_WAITLIST_SWEEP_JOB = "class-waitlist-sweep";
export const INSTRUCTOR_CLASS_EMAILS_JOB = "instructor-class-emails";
export const HONOR_WATCH_SUMMARIES_JOB = "honor-watch-summaries";
export const HEALTH_SNAPSHOT_SWEEP_JOB = "health-snapshot-sweep";
export const RETENTION_CLEANUP_JOB = "retention-cleanup";
export const GOOGLE_KEYS_REACHABILITY_JOB = "google-keys-reachability";
export const BREACH_SERVICE_REACHABILITY_JOB = "breach-service-reachability";
export const APPLE_PAY_FILE_REACHABILITY_JOB = "apple-pay-file-reachability";
export const CALENDAR_FEED_REACHABILITY_JOB = "calendar-feed-reachability";

/**
 * Calendar refresh and message file cleanup run on every five-minute sweep, so twelve missed runs (an hour without a
 * success) is long enough not to flag one slow sweep and short enough to notice a step that has stopped.
 */
export const SWEEP_STEP_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Three missed runs at the default five-minute interval. Long enough that one
 * slow or skipped run is not reported, short enough to catch a stopped sweeper
 * well before the thirty-minute "oldest email" alert would have fired.
 */
export const SWEEP_STALE_AFTER_MS = 15 * 60 * 1000;

export type SweepHeartbeatRecord = {
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
};

export type SweepHeartbeat = {
  /**
   * `never`: no sweep has reported since this was added — the sweeper may not
   * be running at all, or may be calling something other than the sweep route.
   * `failing`: the latest run failed.
   */
  status: "ok" | "stale" | "failing" | "never";
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  /** Milliseconds since the last successful sweep. */
  ageMs: number | null;
};

export function assessSweepHeartbeat(
  record: SweepHeartbeatRecord | null,
  now: Date,
  staleAfterMs = SWEEP_STALE_AFTER_MS,
): SweepHeartbeat {
  const lastSucceededAt = record?.lastSucceededAt ?? null;
  const lastFailedAt = record?.lastFailedAt ?? null;
  const ageMs = lastSucceededAt
    ? Math.max(0, now.getTime() - lastSucceededAt.getTime())
    : null;
  const failedMostRecently = lastFailedAt !== null
    && (lastSucceededAt === null || lastFailedAt > lastSucceededAt);

  const status = failedMostRecently
    ? "failing"
    : ageMs === null
      ? "never"
      : ageMs > staleAfterMs
        ? "stale"
        : "ok";

  return {
    status,
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
    ageMs,
  };
}

/** Host jobs (#1382) that report one heartbeat per run through `/api/internal/system-jobs/heartbeat`. */
export const SERVER_AUTODEPLOY_JOB = "server-autodeploy";
export const SERVER_DOCKER_CLEANUP_JOB = "server-docker-cleanup";
export const SERVER_RUNTIME_GUARD_JOB = "server-runtime-guard";

/** Stale thresholds: the auto-deploy timer runs every 2 minutes, cleanup daily, the runtime guard every 30 seconds. */
export const SERVER_AUTODEPLOY_STALE_AFTER_MS = 30 * 60 * 1000;
export const SERVER_DOCKER_CLEANUP_STALE_AFTER_MS = 30 * 60 * 60 * 1000;
export const SERVER_RUNTIME_GUARD_STALE_AFTER_MS = 15 * 60 * 1000;
