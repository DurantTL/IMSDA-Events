/**
 * The numbers behind "how long will the background mailer take" (#847), in one server-side place so the broadcast
 * review reports what the worker actually does instead of a copy that can drift.
 */

/** Messages the delivery worker sends in one pass. */
export const EMAIL_DELIVERY_BATCH_SIZE = 50;

/** The sweep interval when `OUTBOX_SWEEP_INTERVAL_SECONDS` is not set; the same default as the sweeper container. */
export const DEFAULT_OUTBOX_SWEEP_INTERVAL_SECONDS = 300;

/** How often the sweeper runs, from the same variable the sweeper container reads. */
export function outboxSweepIntervalSeconds(env: Record<string, string | undefined> = process.env) {
  const parsed = Number.parseInt(env.OUTBOX_SWEEP_INTERVAL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OUTBOX_SWEEP_INTERVAL_SECONDS;
}
