import type { EventCount } from "@/modules/system-admin/attention-model";

/**
 * Cancellation requests waiting for review (#170) for the notification bell (#1032).
 *
 * Cancellation requests are not on main yet, so there is nothing to count and
 * this returns `null`, which leaves the item out of the bell. When #170 merges,
 * replace the body with its pending-request count (all events, and the event
 * holding the most) and adjust the link in `attention-model.ts`. Nothing else
 * in the bell needs to change.
 */
export async function countCancellationRequestsWaiting(): Promise<EventCount | null> {
  return null;
}
