import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AdminHub } from "@/components/admin-hub";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { buildReviewQueuesView, hasVisibleReviewQueue } from "@/modules/review-queues/review-queues-model";
import { loadReviewQueueMetrics } from "@/modules/review-queues/review-queues-repository";

export const metadata: Metadata = { title: staffPageTitles.reviewQueues };
export const dynamic = "force-dynamic";

/**
 * The event's registration review pages as grouped cards (#1574). Each card is shown only when the viewer passes the same
 * check its own page makes on the server, and the numbers are read only for the cards that viewer sees. Everything on the
 * page is a link: nothing here approves, sends, merges or confirms.
 */
export default async function ReviewQueuesPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  const viewer = { permissions, audience: event.audience };
  if (!hasVisibleReviewQueue(viewer)) {
    return <AccessRestricted title="Review queues are restricted" detail="Your event role does not include any of the registration review pages, which hold attendee names and registration records." whoToAsk="your event administrator" />;
  }
  const values = await loadReviewQueueMetrics(viewer, event.id);
  return <AdminHub view={buildReviewQueuesView(viewer, event.id, values)} />;
}
