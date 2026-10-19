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
/** One event's directory scan may take this long before the list is marked incomplete. */
const DIRECTORY_REVIEW_BUDGET_MS = 4_000;
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
        take: DIRECTORY_REVIEW_EVENT_LIMIT + 1,
        select: { id: true },
      });
      // More events than the limit: the extra one is not read, and the list says it may be incomplete.
      if (events.length > DIRECTORY_REVIEW_EVENT_LIMIT) unreadable += 1;
      const rows = await Promise.all(events.slice(0, DIRECTORY_REVIEW_EVENT_LIMIT).map(async (event) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const counted = await Promise.race([
            listDirectoryReviewEntries(event.id).then((entries) => entries.length),
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DIRECTORY_REVIEW_BUDGET_MS); }),
          ]);
          if (counted === null) unreadable += 1;
          return { eventId: event.id, count: counted ?? 0 };
        } catch (error) {
          unreadable += 1;
          logError("Admin attention check failed: directory review for one event", error);
          return { eventId: event.id, count: 0 };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }));
      return eventCountFromGroups(rows.filter((row) => row.count > 0));
    }),
    // Two indexed reads that cannot overlap (the second leaves out status FAILED), so nothing is counted twice. Both
    // leave out an original that a later retry already got sent: it is no longer a problem.
    read("failed email", NONE, async () => {
      const notRecovered = { retries: { none: { status: "SENT" as const } } };
      const [failed, providerProblems] = await Promise.all([
        prisma.messageOutbox.groupBy({
          by: ["eventId"],
          where: { status: "FAILED", failedAt: { gte: problemSince }, ...notRecovered },
          _count: { _all: true },
        }),
        prisma.messageOutbox.groupBy({
          by: ["eventId"],
          where: {
            status: { not: "FAILED" },
            provider: { in: ["RESEND", "SES"] },
            providerDeliveryStatus: { in: ["BOUNCED", "COMPLAINED", "FAILED"] },
            providerStatusAt: { gte: problemSince },
            ...notRecovered,
          },
          _count: { _all: true },
        }),
      ]);
      return groupedCount([...failed, ...providerProblems]);
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

/**
 * The summary, shared for `ATTENTION_CACHE_MS`. A failed load is never cached, and neither is a partial one (some check
 * could not be read), so the next call tries again.
 */
export function getAdminAttentionSummary(nowMs = Date.now()): Promise<AttentionSummary> {
  if (cached && nowMs - cached.at < ATTENTION_CACHE_MS) return cached.value;
  const value = loadAttentionSignals(new Date(nowMs)).then(buildAttentionSummary);
  cached = { at: nowMs, value };
  value.then(
    (summary) => { if (summary.partial && cached?.value === value) cached = null; },
    () => { if (cached?.value === value) cached = null; },
  );
  return value;
}

export function resetAdminAttentionCache() {
  cached = null;
}
