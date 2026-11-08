import "server-only";

import { logError } from "@/lib/logger";
import { listDirectoryReviewEntries } from "@/modules/forms/directory-review";
import { countPendingTeams } from "@/modules/general-link-registrations/repository";
import { getGuardianReview } from "@/modules/guardian-authority/repository";
import { listApprovals } from "@/modules/staff-invitations/repository";
import {
  neededReviewQueueMetrics,
  type ReviewQueueMetricKey,
  type ReviewQueueMetricValues,
  type ReviewQueuesViewer,
} from "@/modules/registrations/review-queues-model";

/**
 * The numbers behind the Review queues cards (#1574), for one event. Only the metrics of a card this viewer sees are read
 * (`neededReviewQueueMetrics`), each read stands alone, and a read that fails is logged and becomes `null`, which the card
 * shows as "Unavailable". The caller has already checked each card's permission; each metric reuses the count the card's own
 * page shows. Nothing here writes.
 */
const readers: Record<ReviewQueueMetricKey, (eventId: string) => Promise<number>> = {
  // The Responsible adults page's own "Needs review" count.
  responsibleAdults: async (eventId) => (await getGuardianReview(eventId)).items.length,
  // The Directory review page's own list of answers.
  directoryEntries: async (eventId) => (await listDirectoryReviewEntries(eventId)).length,
  // The pending teams notice on the Registrations page reads the same count.
  pendingTeams: (eventId) => countPendingTeams(eventId),
  // The Staff approvals page's own "Waiting for approval" count.
  approvalsWaiting: async (eventId) => (await listApprovals(eventId)).counts.WAITING,
};

/** The values for one event and viewer. A metric that failed is `null`; a metric no shown card needs is not read. */
export async function loadReviewQueueMetrics(viewer: ReviewQueuesViewer, eventId: string): Promise<ReviewQueueMetricValues> {
  const entries = await Promise.all(
    neededReviewQueueMetrics(viewer).map(async (key): Promise<[ReviewQueueMetricKey, number | null]> => {
      try {
        const value = await readers[key](eventId);
        return [key, Number.isFinite(value) ? value : null];
      } catch (error) {
        logError(`Review queues number could not load: ${key}`, error);
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}
