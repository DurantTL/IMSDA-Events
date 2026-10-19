import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { listDirectoryReviewEntries } from "@/modules/forms/directory-review";
import { getSweepHeartbeat } from "@/modules/operations/sweep-heartbeat-repository";
import { eventCountFromGroups } from "@/modules/system-admin/attention-event-count";
import { countCancellationRequestsWaiting } from "@/modules/system-admin/attention-cancellation-hook";
import {
  EMAIL_PROBLEM_WINDOW_DAYS,
  EMAIL_STUCK_AFTER_MINUTES,
  SCHEDULED_EMAIL_OVERDUE_AFTER_MINUTES,
  buildAttentionSummary,
  type AttentionSignals,
  type AttentionSummary,
  type EventCount,
} from "@/modules/system-admin/attention-model";

/**
 * Counts for the system administrator bell (#1032). Every query is a count or a
 * group-by over an indexed status column, except directory review, which has to
 * read form answers and is bounded to a few current events. The caller has
 * already checked that the viewer is a system administrator.
 */

const DIRECTORY_REVIEW_EVENT_LIMIT = 10;
const DIRECTORY_REVIEW_RECENT_DAYS = 30;
/** One shared answer for this long, so a busy page cannot turn into a query storm. */
export const ATTENTION_CACHE_MS = 30_000;

const NONE: EventCount = { total: 0, topEventId: null };

const groupedCount = (rows: Array<{ eventId: string | null; _count: { _all: number } }>) =>
  eventCountFromGroups(rows.map((row) => ({ eventId: row.eventId, count: row._count._all })));

export async function loadAttentionSignals(now = new Date()): Promise<AttentionSignals> {
  const prisma = getPrisma();
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const problemSince = new Date(now.getTime() - EMAIL_PROBLEM_WINDOW_DAYS * 24 * 60 * 60_000);
  const stuckBefore = minutesAgo(EMAIL_STUCK_AFTER_MINUTES);
  const overdueBefore = minutesAgo(SCHEDULED_EMAIL_OVERDUE_AFTER_MINUTES);
  let unreadable = 0;
  const read = async <T,>(name: string, fallback: T, query: () => Promise<T>): Promise<T> => {
    try {
      return await query();
    } catch (error) {
      unreadable += 1;
      logError(`Admin attention check failed: ${name}`, error);
      return fallback;
    }
  };

  const [
    clubApplicationsWaiting,
    pendingTeams,
    cancellationRequestsWaiting,
    staffInvitationApprovals,
    directoryReview,
    emailFailed,
    emailStuck,
    sweep,
    scheduledEmailsOverdue,
    scheduledEmailsFailed,
  ] = await Promise.all([
    read("club applications", 0, () => prisma.newClubApplication.count({ where: { status: "PENDING" } })),
    read("pending teams", NONE, async () => {
      const rows = await prisma.generalLinkSubmission.groupBy({
        by: ["eventId"], where: { status: "PENDING" }, _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("cancellation requests", NONE, countCancellationRequestsWaiting),
    read("staff invitation approvals", NONE, async () => {
      const rows = await prisma.staffInvitation.groupBy({
        by: ["eventId"], where: { approval: "WAITING" }, _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("directory review", NONE, async () => {
      const events = await prisma.event.findMany({
        where: { archivedAt: null, endsAt: { gte: minutesAgo(DIRECTORY_REVIEW_RECENT_DAYS * 24 * 60) } },
        orderBy: { startsAt: "asc" },
        take: DIRECTORY_REVIEW_EVENT_LIMIT,
        select: { id: true },
      });
      const rows: Array<{ eventId: string | null; count: number }> = [];
      for (const event of events) rows.push({ eventId: event.id, count: (await listDirectoryReviewEntries(event.id)).length });
      return eventCountFromGroups(rows.filter((row) => row.count > 0));
    }),
    read("failed email", NONE, async () => {
      const rows = await prisma.messageOutbox.groupBy({
        by: ["eventId"],
        where: {
          updatedAt: { gte: problemSince },
          OR: [{ status: "FAILED" }, { providerDeliveryStatus: { in: ["BOUNCED", "COMPLAINED", "FAILED"] } }],
        },
        _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("stuck email", NONE, async () => {
      const rows = await prisma.messageOutbox.groupBy({
        by: ["eventId"],
        where: { status: { in: ["PENDING", "PROCESSING"] }, availableAt: { lt: stuckBefore }, updatedAt: { lt: stuckBefore } },
        _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("email sweep", "never", async () => (await getSweepHeartbeat(now)).status),
    read("overdue scheduled email", NONE, async () => {
      const rows = await prisma.scheduledEmailBatch.groupBy({
        by: ["eventId"],
        where: { status: "ACTIVE", claimToken: null, sendAt: { lt: overdueBefore } },
        _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("failed scheduled email", NONE, async () => {
      const rows = await prisma.scheduledEmailBatch.groupBy({
        by: ["eventId"],
        where: { status: "FAILED", failedAt: { gte: problemSince } },
        _count: { _all: true },
      });
      return groupedCount(rows);
    }),
  ]);

  return {
    now,
    clubApplicationsWaiting,
    pendingTeams,
    cancellationRequestsWaiting,
    staffInvitationApprovals,
    directoryReview,
    emailFailed,
    emailStuck,
    outboxSweep: sweep,
    scheduledEmailsOverdue,
    scheduledEmailsFailed,
    unreadableChecks: unreadable,
  };
}

let cached: { at: number; value: Promise<AttentionSummary> } | null = null;

/** The summary, shared for `ATTENTION_CACHE_MS`. A failed load is never cached. */
export function getAdminAttentionSummary(nowMs = Date.now()): Promise<AttentionSummary> {
  if (cached && nowMs - cached.at < ATTENTION_CACHE_MS) return cached.value;
  const value = loadAttentionSignals(new Date(nowMs)).then(buildAttentionSummary);
  cached = { at: nowMs, value };
  value.catch(() => { if (cached?.value === value) cached = null; });
  return value;
}

export function resetAdminAttentionCache() {
  cached = null;
}
