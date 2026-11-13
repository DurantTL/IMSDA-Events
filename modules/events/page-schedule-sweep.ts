import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { recordPageVersionIfChanged } from "@/modules/events/page-versions";

export type DueEventPageSweepResult = {
  /** Events that had at least one section due. */
  events: number;
  /** Sections this run published. */
  published: number;
  /** Events whose publish failed; each is tried again on the next sweep. */
  failed: number;
};

/**
 * Publishes the event page sections whose scheduled time has come (#1514).
 *
 * Per event, one transaction: a conditional update (still unpublished and due) so a repeated or overlapping run
 * publishes nothing twice. When something published, one audit row (no actor; counts and section titles only) and a
 * new page version are written in the same transaction. One event failing does not stop the others. Counts only.
 */
export async function publishDueEventPageSections({ now = new Date() }: { now?: Date } = {}): Promise<DueEventPageSweepResult> {
  const prisma = getPrisma();
  const due = await prisma.eventContentSection.findMany({
    where: { isPublished: false, scheduledPublishAt: { lte: now } },
    select: { eventId: true },
    distinct: ["eventId"],
  });
  const result: DueEventPageSweepResult = { events: due.length, published: 0, failed: 0 };

  for (const { eventId } of due) {
    try {
      result.published += await prisma.$transaction(async (tx) => {
        const dueSections = await tx.eventContentSection.findMany({
          where: { eventId, isPublished: false, scheduledPublishAt: { lte: now } },
          orderBy: { position: "asc" },
          select: { id: true, title: true },
        });
        if (dueSections.length === 0) return 0;
        const updated = await tx.eventContentSection.updateMany({
          where: { id: { in: dueSections.map((section) => section.id) }, isPublished: false, scheduledPublishAt: { lte: now } },
          // The time stays on the published row until the next save rewrites it: it is how a save from an editor opened
          // before this run is recognised as this section (see replaceEventContent), not as a new past time.
          data: { isPublished: true },
        });
        if (updated.count === 0) return 0;
        await recordPageVersionIfChanged(tx, eventId, { source: "SCHEDULED_PUBLISH", actorUserId: null });
        await tx.auditLog.create({
          data: {
            eventId,
            actorUserId: null,
            action: "EVENT_CONTENT_SCHEDULED_PUBLISHED",
            entityType: "EventContentSection",
            entityId: eventId,
            correlationId: `event-content-scheduled:${eventId}:${now.getTime()}`,
            summary: `Published ${updated.count} scheduled content section${updated.count === 1 ? "" : "s"}.`,
            metadata: { publishedCount: updated.count, titles: dueSections.map((section) => section.title) },
          },
        });
        return updated.count;
      });
    } catch (error) {
      result.failed += 1;
      logError("Publishing the scheduled event page sections failed for one event", error);
    }
  }
  return result;
}
