/**
 * The system administrator notification bell (#1032, slice 1): pure model.
 *
 * The bell lists what needs a person's attention, built from counts of data the
 * system already holds. This file turns those counts into the rows the panel
 * shows and names the button. It has no database access, so the thresholds, the
 * links and the wording are testable on their own. `attention-repository.ts`
 * reads the counts.
 */

/** Email that failed or bounced this recently still counts as a problem. */
export const EMAIL_PROBLEM_WINDOW_DAYS = 7;
/** A message still queued or sending this long after it was due is stuck. */
export const EMAIL_STUCK_AFTER_MINUTES = 30;
/** An approved scheduled email this long past its send time has not run when expected. */
export const SCHEDULED_EMAIL_OVERDUE_AFTER_MINUTES = 15;

export type AttentionGroupKey = "waiting" | "email" | "health";

export type AttentionItemKey =
  | "club-applications"
  | "pending-teams"
  | "cancellation-requests"
  | "staff-invitation-approvals"
  | "directory-review"
  | "email-failed"
  | "email-stuck"
  | "outbox-sweep"
  | "scheduled-emails-overdue"
  | "scheduled-emails-failed";

export type AttentionItem = {
  key: AttentionItemKey;
  group: AttentionGroupKey;
  /** What the count is of, in plain words, e.g. "club applications waiting for a decision". */
  label: string;
  count: number;
  /** A same-site path (never an absolute URL) to the page that handles it. */
  href: string;
  /**
   * A to-review list rather than an alert: shown in the panel with its count but left out of the badge total, because
   * nothing lets staff dismiss it, so its count would never go down.
   */
  reviewOnly?: boolean;
};

export type AttentionGroup = { key: AttentionGroupKey; title: string; items: AttentionItem[] };

export type AttentionSummary = {
  generatedAt: string;
  /** True when some checks could not be read, so the list may be missing items. */
  partial: boolean;
  /** Sum of the alert items' counts (review-only lists are left out). */
  total: number;
  groups: AttentionGroup[];
};

/** A count that is spread over events, with the event holding the most, so a link can open it. */
export type EventCount = { total: number; topEventId: string | null };

/**
 * What the repository measured. `null` means "not measured": the item is left
 * out rather than shown as zero.
 */
export type AttentionSignals = {
  now: Date;
  clubApplicationsWaiting: number;
  pendingTeams: EventCount;
  /** Cancellation requests waiting for review (#170); `attention-cancellation-hook.ts` decides what waits. */
  cancellationRequestsWaiting: EventCount;
  staffInvitationApprovals: EventCount;
  directoryReview: EventCount;
  emailFailed: EventCount;
  emailStuck: EventCount;
  /** `stale` or `failing`. `ok` and `never` (nothing reported yet, not proof of a fault) are not shown. */
  outboxSweep: "ok" | "stale" | "failing" | "never";
  scheduledEmailsOverdue: EventCount;
  scheduledEmailsFailed: EventCount;
  /** How many of the checks above could not be read and were left empty. */
  unreadableChecks: number;
};

function withEvent(path: string, eventId: string | null, query = "") {
  const params = [query, eventId ? `event=${encodeURIComponent(eventId)}` : ""].filter(Boolean).join("&");
  return params ? `${path}?${params}` : path;
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export function buildAttentionSummary(signals: AttentionSignals): AttentionSummary {
  const waiting: AttentionItem[] = [];
  const email: AttentionItem[] = [];
  const health: AttentionItem[] = [];

  if (signals.clubApplicationsWaiting > 0) {
    waiting.push({
      key: "club-applications",
      group: "waiting",
      count: signals.clubApplicationsWaiting,
      label: plural(signals.clubApplicationsWaiting, "club application waiting for a decision", "club applications waiting for a decision"),
      href: "/admin/clubs/applications",
    });
  }
  if (signals.pendingTeams.total > 0) {
    waiting.push({
      key: "pending-teams",
      group: "waiting",
      count: signals.pendingTeams.total,
      label: plural(signals.pendingTeams.total, "team waiting for a club", "teams waiting for a club"),
      href: withEvent("/people/pending-teams", signals.pendingTeams.topEventId),
    });
  }
  if (signals.cancellationRequestsWaiting.total > 0) {
    waiting.push({
      key: "cancellation-requests",
      group: "waiting",
      count: signals.cancellationRequestsWaiting.total,
      label: plural(signals.cancellationRequestsWaiting.total, "cancellation request waiting for review", "cancellation requests waiting for review"),
      href: withEvent("/finance/cancellation-requests", signals.cancellationRequestsWaiting.topEventId, "status=REQUESTED"),
    });
  }
  if (signals.staffInvitationApprovals.total > 0) {
    waiting.push({
      key: "staff-invitation-approvals",
      group: "waiting",
      count: signals.staffInvitationApprovals.total,
      label: plural(signals.staffInvitationApprovals.total, "staff registration waiting for approval", "staff registrations waiting for approval"),
      href: withEvent("/people/staff-invitations/approvals", signals.staffInvitationApprovals.topEventId),
    });
  }
  if (signals.directoryReview.total > 0) {
    waiting.push({
      key: "directory-review",
      group: "waiting",
      count: signals.directoryReview.total,
      label: plural(signals.directoryReview.total, "directory entry to review (a list, not an alert)", "directory entries to review (a list, not an alert)"),
      reviewOnly: true,
      href: withEvent("/people/directory-review", signals.directoryReview.topEventId),
    });
  }

  if (signals.emailFailed.total > 0) {
    email.push({
      key: "email-failed",
      group: "email",
      count: signals.emailFailed.total,
      label: plural(
        signals.emailFailed.total,
        `email failed, bounced or marked as spam in the last ${EMAIL_PROBLEM_WINDOW_DAYS} days`,
        `emails failed, bounced or marked as spam in the last ${EMAIL_PROBLEM_WINDOW_DAYS} days`,
      ),
      href: emailHref(signals.emailFailed.topEventId),
    });
  }
  if (signals.emailStuck.total > 0) {
    email.push({
      key: "email-stuck",
      group: "email",
      count: signals.emailStuck.total,
      label: plural(
        signals.emailStuck.total,
        `email stuck for over ${EMAIL_STUCK_AFTER_MINUTES} minutes`,
        `emails stuck for over ${EMAIL_STUCK_AFTER_MINUTES} minutes`,
      ),
      href: emailHref(signals.emailStuck.topEventId),
    });
  }

  if (signals.outboxSweep === "stale" || signals.outboxSweep === "failing") {
    health.push({
      key: "outbox-sweep",
      group: "health",
      count: 1,
      label: signals.outboxSweep === "failing"
        ? "scheduled email sweep failed on its last run"
        : "scheduled email sweep has stopped running",
      href: "/admin",
    });
  }
  if (signals.scheduledEmailsOverdue.total > 0) {
    health.push({
      key: "scheduled-emails-overdue",
      group: "health",
      count: signals.scheduledEmailsOverdue.total,
      label: plural(signals.scheduledEmailsOverdue.total, "scheduled email has not gone out on time", "scheduled emails have not gone out on time"),
      href: withEvent("/communications/scheduled", signals.scheduledEmailsOverdue.topEventId),
    });
  }
  if (signals.scheduledEmailsFailed.total > 0) {
    health.push({
      key: "scheduled-emails-failed",
      group: "health",
      count: signals.scheduledEmailsFailed.total,
      label: plural(signals.scheduledEmailsFailed.total, "scheduled email failed to run", "scheduled emails failed to run"),
      href: withEvent("/communications/scheduled", signals.scheduledEmailsFailed.topEventId),
    });
  }

  const groups: AttentionGroup[] = [
    { key: "waiting" as const, title: "Waiting on staff", items: waiting },
    { key: "email" as const, title: "Email problems", items: email },
    { key: "health" as const, title: "System health", items: health },
  ].filter((group) => group.items.length > 0);

  return {
    generatedAt: signals.now.toISOString(),
    partial: signals.unreadableChecks > 0,
    total: groups.reduce((sum, group) => sum + group.items.filter((item) => !item.reviewOnly).reduce((inner, item) => inner + item.count, 0), 0),
    groups,
  };
}

/** Failed and stuck mail with an event opens that event's delivery list; mail with no event (account email) opens the command center. */
function emailHref(eventId: string | null) {
  return eventId ? withEvent("/communications", eventId, "view=deliveries") : "/admin";
}

/** The badge text: the count, capped so it stays inside its circle. */
export function attentionBadgeText(total: number) {
  return total > 99 ? "99+" : String(total);
}

/** The button's accessible name always carries the count. */
export function attentionButtonName(total: number | null) {
  if (total === null) return "Notifications";
  if (total === 0) return "Notifications, nothing needs attention";
  return `Notifications, ${total} ${total === 1 ? "item needs" : "items need"} attention`;
}

/** Only a same-site path is accepted from the API; anything else is not rendered as a link. */
export function isSafeAttentionHref(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}
