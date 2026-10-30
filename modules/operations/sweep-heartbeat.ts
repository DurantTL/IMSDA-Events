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
export const EMAIL_REACHABILITY_JOB = "email-reachability";
export const SQUARE_REACHABILITY_JOB = "square-reachability";

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
