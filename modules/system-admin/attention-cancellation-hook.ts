import "server-only";

import { getPrisma } from "@/lib/prisma";
import { eventCountFromGroups } from "@/modules/system-admin/attention-event-count";
import type { EventCount } from "@/modules/system-admin/attention-model";

/**
 * Cancellation requests (#170) waiting for staff to start a review, for the notification bell (#1032). Only
 * REQUESTED counts: UNDER_REVIEW is already with someone and INFORMATION_NEEDED is waiting on the registrant. This is
 * the one place that decides what "waiting" means for cancellation requests.
 */
export async function countCancellationRequestsWaiting(): Promise<EventCount> {
  const rows = await getPrisma().cancellationRequest.groupBy({
    by: ["eventId"],
    where: { status: "REQUESTED" },
    _count: { _all: true },
  });
  return eventCountFromGroups(rows.map((row) => ({ eventId: row.eventId, count: row._count._all })));
}
