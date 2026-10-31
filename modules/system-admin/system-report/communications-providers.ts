import "server-only";

import { getPrisma } from "@/lib/prisma";
import { EMAIL_DELIVERY_LOCK_TIMEOUT_MS } from "@/modules/communications/delivery-timing";
import { SCHEDULED_EMAIL_STALE_CLAIM_MS } from "@/modules/communications/scheduled-email-domain";
import { SCHEDULED_EMAIL_OVERDUE_AFTER_MINUTES } from "@/modules/system-admin/attention-model";
import { scheduledEmailOverdueWhere } from "@/modules/system-admin/attention-repository";
import type { defineProvider, Read, SignalProvider } from "./providers";

/**
 * The "Communications" checks (#1378). Read-only: counts and times only, never a name, address or title. Built from
 * `providers.ts`'s helpers, passed in so this file never imports that one at run time (it appends this list).
 */

/** A removal that has failed this many times is "retrying", not just waiting for the next sweep. */
export const FILE_CLEANUP_REPEATED_ATTEMPTS = 3;

export type CommunicationsKit = {
  defineProvider: typeof defineProvider;
  tried: (read: Read<unknown>, reason?: string) => { checkedAt: string; whenLabel: string; state: "unavailable"; resultText: string };
  iso: (date: Date) => string;
  m: (key: string, name: string, description: string, fixHref?: string | null, fixLabel?: string | null) => Parameters<typeof defineProvider>[1][number];
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function buildCommunicationsProviders(kit: CommunicationsKit): SignalProvider[] {
  const { defineProvider: define, tried, iso, m } = kit;
  return [
    define("communications", [
      m("scheduled-emails-stuck", "Scheduled emails overdue or stuck", "Scheduled emails past their send time that have not started, or that started and never finished.", "/communications/scheduled", "Open scheduled email"),
      m("delivery-locks-stale", "Delivery locks left behind", "Emails marked as being sent for far longer than a send takes.", null, "Cleared by the next email sweep"),
      m("deadline-reminders-waiting", "Deadline reminders waiting for a person", "Prepared deadline reminders that no one has approved or skipped yet.", "/admin/calendar", "Open calendar"),
      m("calendar-feeds-failing", "Calendar feeds failing", "Calendar feeds whose last refresh failed.", "/admin/calendar", "Open calendar"),
      m("file-removals-retrying", "Attachment removals retrying", "Removed attachments whose files could not be deleted from storage after repeated tries.", null, "Retried by the file cleanup job"),
    ], async (ctx) => {
      const prisma = getPrisma();
      const now = ctx.now;
      const overdueBefore = new Date(now.getTime() - SCHEDULED_EMAIL_OVERDUE_AFTER_MINUTES * 60_000);
      const staleClaimBefore = new Date(now.getTime() - SCHEDULED_EMAIL_STALE_CLAIM_MS);
      const lockedBefore = new Date(now.getTime() - EMAIL_DELIVERY_LOCK_TIMEOUT_MS);

      const [scheduled, locks, reminders, feeds, removals] = await Promise.all([
        ctx.once("comms-scheduled-stuck", async () => {
          const [overdue, stuck] = await Promise.all([
            prisma.scheduledEmailBatch.count({ where: scheduledEmailOverdueWhere(overdueBefore) }),
            prisma.scheduledEmailBatch.count({
              where: { status: "ACTIVE", claimToken: { not: null }, completedAt: null, claimedAt: { lt: staleClaimBefore } },
            }),
          ]);
          return { overdue, stuck };
        }),
        ctx.once("comms-stale-locks", () =>
          prisma.messageOutbox.count({ where: { status: "PROCESSING", lockedAt: { lte: lockedBefore } } }),
        ),
        ctx.once("comms-reminders-pending", () => prisma.deadlineReminderBatch.count({ where: { status: "PENDING" } })),
        ctx.once("comms-feeds-failed", () => prisma.calendarFeed.count({ where: { lastStatus: "FAILED" } })),
        ctx.once("comms-removals-retrying", () =>
          prisma.messageFileStorageCleanup.count({ where: { attempts: { gte: FILE_CLEANUP_REPEATED_ATTEMPTS } } }),
        ),
      ]);

      const checked = (read: Read<unknown>) => ({ checkedAt: iso(read.readAt), whenLabel: "Checked" });

      const scheduledRow = !scheduled.ok
        ? { key: "scheduled-emails-stuck", ...tried(scheduled) }
        : (() => {
            const { overdue, stuck } = scheduled.value;
            if (overdue + stuck === 0) {
              return { key: "scheduled-emails-stuck", ...checked(scheduled), state: "ok" as const, resultText: "No scheduled emails are late or stuck." };
            }
            const parts = [
              overdue > 0 ? `${plural(overdue, "scheduled email is", "scheduled emails are")} past ${overdue === 1 ? "its" : "their"} send time and ${overdue === 1 ? "has" : "have"} not started` : null,
              stuck > 0 ? `${plural(stuck, "scheduled email started", "scheduled emails started")} and ${stuck === 1 ? "has" : "have"} not finished` : null,
            ].filter(Boolean);
            return {
              key: "scheduled-emails-stuck",
              ...checked(scheduled),
              state: "attention" as const,
              resultText: `${parts.join("; ")}.`,
              fixHref: "/communications/scheduled",
            };
          })();

      const locksRow = !locks.ok
        ? { key: "delivery-locks-stale", ...tried(locks) }
        : locks.value === 0
          ? { key: "delivery-locks-stale", ...checked(locks), state: "ok" as const, resultText: "No emails are held in a stale sending state." }
          : {
              key: "delivery-locks-stale",
              ...checked(locks),
              state: "attention" as const,
              resultText: `${plural(locks.value, "email has", "emails have")} been marked as sending for over ${EMAIL_DELIVERY_LOCK_TIMEOUT_MS / 60_000} minutes. The next email sweep clears ${locks.value === 1 ? "it" : "them"}.`,
            };

      const remindersRow = !reminders.ok
        ? { key: "deadline-reminders-waiting", ...tried(reminders) }
        : {
            key: "deadline-reminders-waiting",
            ...checked(reminders),
            state: "info" as const,
            resultText: reminders.value === 0 ? "No deadline reminders are waiting." : `${plural(reminders.value, "deadline reminder is", "deadline reminders are")} waiting for a person to approve or skip.`,
          };

      const feedsRow = !feeds.ok
        ? { key: "calendar-feeds-failing", ...tried(feeds) }
        : feeds.value === 0
          ? { key: "calendar-feeds-failing", ...checked(feeds), state: "ok" as const, resultText: "No calendar feed failed its last refresh." }
          : { key: "calendar-feeds-failing", ...checked(feeds), state: "watch" as const, resultText: `${plural(feeds.value, "calendar feed", "calendar feeds")} failed ${feeds.value === 1 ? "its" : "their"} last refresh.`, fixHref: "/admin/calendar" };

      const removalsRow = !removals.ok
        ? { key: "file-removals-retrying", ...tried(removals) }
        : removals.value === 0
          ? { key: "file-removals-retrying", ...checked(removals), state: "ok" as const, resultText: "No attachment removals are stuck retrying." }
          : { key: "file-removals-retrying", ...checked(removals), state: "watch" as const, resultText: `${plural(removals.value, "attachment removal has", "attachment removals have")} failed ${FILE_CLEANUP_REPEATED_ATTEMPTS} or more times and ${removals.value === 1 ? "is" : "are"} still retrying.` };

      return [scheduledRow, locksRow, remindersRow, feedsRow, removalsRow];
    }),
  ];
}
