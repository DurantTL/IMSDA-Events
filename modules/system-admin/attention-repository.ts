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
  type AttentionItemKey,
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
/** At most this many directory scans run at once, so they cannot hold many database connections together. */
const DIRECTORY_REVIEW_CONCURRENCY = 3;
/** One shared answer for this long, so a busy page cannot turn into a query storm. */
export const ATTENTION_CACHE_MS = 30_000;
/** A partial answer (some check could not be read) is shared only briefly, so it is retried soon without a storm. */
export const ATTENTION_PARTIAL_CACHE_MS = 10_000;

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
  const unreadableKeys: AttentionItemKey[] = [];
  const markUnreadable = (key: AttentionItemKey) => {
    unreadable += 1;
    unreadableKeys.push(key);
  };
  let directoryReviewTruncated = false;
  const read = async <T,>(key: AttentionItemKey, name: string, fallback: T, query: () => Promise<T>): Promise<T> => {
    try {
      return await query();
    } catch (error) {
      markUnreadable(key);
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
    read("club-applications", "club applications", 0, () => prisma.newClubApplication.count({ where: { status: "PENDING" } })),
    read("pending-teams", "pending teams", NONE, async () => {
      const rows = await prisma.generalLinkSubmission.groupBy({
        by: ["eventId"], where: { status: "PENDING" }, _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("cancellation-requests", "cancellation requests", NONE, countCancellationRequestsWaiting),
    read("staff-invitation-approvals", "staff invitation approvals", NONE, async () => {
      const rows = await prisma.staffInvitation.groupBy({
        by: ["eventId"], where: { approval: "WAITING" }, _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("directory-review", "directory review", NONE, async () => {
      const events = await prisma.event.findMany({
        where: { archivedAt: null, endsAt: { gte: minutesAgo(DIRECTORY_REVIEW_RECENT_DAYS * 24 * 60) } },
        orderBy: { startsAt: "desc" },
        take: DIRECTORY_REVIEW_EVENT_LIMIT + 1,
        select: { id: true },
      });
      // More events than the limit: the extra one is not read. That is flagged as truncated, not as a failed check.
      directoryReviewTruncated = events.length > DIRECTORY_REVIEW_EVENT_LIMIT;
      const scan = async (event: { id: string }) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const counted = await Promise.race([
            listDirectoryReviewEntries(event.id).then((entries) => entries.length),
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DIRECTORY_REVIEW_BUDGET_MS); }),
          ]);
          if (counted === null) markUnreadable("directory-review");
          return { eventId: event.id, count: counted ?? 0 };
        } catch (error) {
          markUnreadable("directory-review");
          logError("Admin attention check failed: directory review for one event", error);
          return { eventId: event.id, count: 0 };
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const queue = events.slice(0, DIRECTORY_REVIEW_EVENT_LIMIT);
      const rows: Array<{ eventId: string; count: number }> = [];
      await Promise.all(Array.from({ length: DIRECTORY_REVIEW_CONCURRENCY }, async () => {
        for (let event = queue.shift(); event; event = queue.shift()) rows.push(await scan(event));
      }));
      return eventCountFromGroups(rows.filter((row) => row.count > 0));
    }),
    // Two indexed reads that cannot overlap (the second leaves out status FAILED), so nothing is counted twice. Both
    // leave out an original that a later retry already got sent: it is no longer a problem.
    read("email-failed", "failed email", NONE, async () => {
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
    read("email-stuck", "stuck email", NONE, async () => {
      const rows = await prisma.messageOutbox.groupBy({
        by: ["eventId"],
        where: { status: { in: ["PENDING", "PROCESSING"] }, availableAt: { lt: stuckBefore }, updatedAt: { lt: stuckBefore } },
        _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("outbox-sweep", "email sweep", "never", async () => (await getSweepHeartbeat(now)).status),
    read("scheduled-emails-overdue", "overdue scheduled email", NONE, async () => {
      const rows = await prisma.scheduledEmailBatch.groupBy({
        by: ["eventId"],
        where: { status: "ACTIVE", claimToken: null, sendAt: { lt: overdueBefore } },
        _count: { _all: true },
      });
      return groupedCount(rows);
    }),
    read("scheduled-emails-failed", "failed scheduled email", NONE, async () => {
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
    unreadableKeys,
    directoryReviewTruncated,
  };
}

let cached: { at: number; ttl: number; value: Promise<AttentionSummary> } | null = null;

/**
 * The summary, shared for `ATTENTION_CACHE_MS`, or only `ATTENTION_PARTIAL_CACHE_MS` when some check could not be read, so a
 * check that keeps failing is retried soon but cannot make every page load run every query. A failed load is never cached.
 */
export function getAdminAttentionSummary(nowMs = Date.now()): Promise<AttentionSummary> {
  if (cached && nowMs - cached.at < cached.ttl) return cached.value;
  const value = loadAttentionSignals(new Date(nowMs)).then(buildAttentionSummary);
  const entry = { at: nowMs, ttl: ATTENTION_CACHE_MS, value };
  cached = entry;
  value.then(
    (summary) => { if (summary.partial) entry.ttl = ATTENTION_PARTIAL_CACHE_MS; },
    () => { if (cached === entry) cached = null; },
  );
  return value;
}

export function resetAdminAttentionCache() {
  cached = null;
}
