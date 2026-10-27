/**
 * The System home's values and work list (#1182): pure model, no database access.
 *
 * Every number the home shows is built here from a read that already exists, and each one documents its unit, scope,
 * predicate and freshness next to where it is made. Nothing is recomputed or redefined: the attention counts come from
 * `attention-repository.ts`, the event count from `dashboard.ts` (`isUpcomingEvent`) and the feature-request count from
 * `listPendingModuleRequests`. A value that could not be read is `null` and renders as "Unavailable", never as 0.
 *
 * No count is clickable as an exact number. The destination pages do not promise the same scope and predicate as the
 * count (that contract is #75/#181), so each link reads "Open [workflow]". The one exception is the upcoming-events
 * value, whose link jumps to the list on the same page, which applies the same predicate.
 */
import type { AttentionItemKey, AttentionSummary } from "@/modules/system-admin/attention-model";

/** The most feature requests the review queue reads (`listPendingModuleRequests` takes 100), so a count at the cap is "at least". */
export const FEATURE_REQUEST_READ_LIMIT = 100;

export type HomeValueKey = "upcoming-events" | "club-applications" | "failed-email" | "waiting-invites";

export type HomeValue = {
  key: HomeValueKey;
  label: string;
  /** The count, or `null` when it could not be read. */
  value: number | null;
  /**
   * The one line under the count (#1228): "Nothing waiting" (or "None found" for events) at zero, "Next starts in N
   * days" for upcoming events, and `null` when the count is unavailable, so a failed read never reads as zero.
   */
  note: string | null;
  /** What one unit is. */
  unit: string;
  /** Which records are counted, and over what period. */
  scope: string;
  /** ISO time the underlying read was made, or `null` when there was none. */
  readAt: string | null;
  /** The action link. It is a link to a workflow, never to a filtered copy of this count. */
  linkLabel: string;
  /** `null` when there is no page that works without more context; the card then shows no link. */
  href: string | null;
};

export type HomeValueInput = {
  /** `summary.upcomingEventCount` and `generatedAt` of the dashboard read, or `null` when that read failed. */
  events: { upcomingEventCount: number; generatedAt: string; nextEventNote?: string | null } | null;
  /** The shared attention summary, or `null` when it could not be loaded at all. */
  attention: AttentionSummary | null;
};

/** The count of one attention item: `null` when the whole summary or that item's check could not be read, 0 when it read none. */
export function attentionValue(attention: AttentionSummary | null, key: AttentionItemKey): number | null {
  if (!attention || attention.unreadable.includes(key)) return null;
  for (const group of attention.groups) {
    const item = group.items.find((candidate) => candidate.key === key);
    if (item) return item.count;
  }
  return 0;
}

/**
 * The four headline values.
 *
 * - Upcoming events: events, not archived and not ended (`endsAt >= now`), in progress included, drafts included.
 *   Link: the list below on this page, which uses the same predicate.
 * - New club applications waiting: applications, every one with status PENDING, in any year. Not scoped to an event
 *   (an application belongs to no event).
 * - Failed email: messages that failed, bounced or were marked as spam in the last 7 days and were not later resent
 *   successfully, across all events and account email. This is the bell's "email failed" item, not the all-time
 *   delivery-issue count on each event card.
 * - Staff registrations waiting for approval: approval is WAITING, across all events. The link exists only while some
 *   are waiting, because the approvals page needs an event and the bell link supplies one.
 */
export function buildHomeValues({ events, attention }: HomeValueInput): HomeValue[] {
  const attentionAt = attention?.generatedAt ?? null;
  const waiting = (value: number | null) => (value === null ? null : value === 0 ? "Nothing waiting" : null);
  const applications = attentionValue(attention, "club-applications");
  const failed = attentionValue(attention, "email-failed");
  const approvals = attentionValue(attention, "staff-invitation-approvals");
  return [
    {
      key: "upcoming-events",
      label: "Upcoming events",
      value: events ? events.upcomingEventCount : null,
      note: !events ? null : events.upcomingEventCount === 0 ? "None found" : events.nextEventNote ?? null,
      unit: "events",
      scope: "Not archived and not ended, so an event in progress counts.",
      readAt: events?.generatedAt ?? null,
      linkLabel: "Go to the upcoming events list",
      href: "#upcoming-events",
    },
    {
      key: "club-applications",
      label: "Club applications",
      value: applications,
      note: waiting(applications),
      unit: "applications",
      scope: "Every pending application, any year.",
      readAt: attentionAt,
      linkLabel: "Open club applications",
      href: "/admin/clubs/applications",
    },
    {
      key: "failed-email",
      label: "Failed messages (last 7 days)",
      value: failed,
      note: waiting(failed),
      unit: "messages",
      scope: "Failed, bounced or marked as spam in the last 7 days and not resent, across all events and account email.",
      readAt: attentionAt,
      linkLabel: "Open email problems",
      href: attentionHref(attention, "email-failed") ?? "/admin/email",
    },
    {
      key: "waiting-invites",
      label: "Staff approvals",
      value: approvals,
      note: waiting(approvals),
      unit: "staff registrations",
      scope: "Staff registrations waiting for approval, across all events.",
      readAt: attentionAt,
      linkLabel: "Open staff approvals",
      // No event-less fallback: that page needs an event, so with none waiting (or unreadable) there is no link.
      href: attentionHref(attention, "staff-invitation-approvals"),
    },
  ];
}

function attentionHref(attention: AttentionSummary | null, key: AttentionItemKey): string | null {
  for (const group of attention?.groups ?? []) {
    const item = group.items.find((candidate) => candidate.key === key);
    if (item) return homeHref(item.key, item.href);
  }
  return null;
}

/** What each work row's link says. It names a workflow, never a filtered count. */
const openLabels: Record<AttentionItemKey, string> = {
  "club-applications": "Open club applications",
  "pending-teams": "Open pending teams",
  "cancellation-requests": "Open cancellation requests",
  "staff-invitation-approvals": "Open staff approvals",
  "directory-review": "Open directory review",
  "email-failed": "Open email problems",
  "email-stuck": "Open email deliveries",
  "outbox-sweep": "See system health",
  "scheduled-emails-overdue": "Open scheduled email",
  "scheduled-emails-failed": "Open scheduled email",
};

/** Short names for the "could not be checked" notice. */
const checkNames: Record<AttentionItemKey, string> = {
  "club-applications": "club applications",
  "pending-teams": "pending teams",
  "cancellation-requests": "cancellation requests",
  "staff-invitation-approvals": "staff approvals",
  "directory-review": "directory review",
  "email-failed": "failed email",
  "email-stuck": "stuck email",
  "outbox-sweep": "the email sweep",
  "scheduled-emails-overdue": "overdue scheduled email",
  "scheduled-emails-failed": "failed scheduled email",
};

/**
 * The bell links failed or stuck mail that has no event, and the sweep item, to `/admin` (this page). On the home that
 * would be a link to itself, so the sweep goes to the health panel and event-less mail to the Email page.
 */
export function homeHref(key: AttentionItemKey, href: string): string {
  if (href !== "/admin") return href;
  return key === "outbox-sweep" ? "#system-health" : "/admin/email";
}

export type WorkRow = {
  key: AttentionItemKey | "feature-requests";
  /** The bell group the row belongs to, or "Waiting on staff" for feature requests. */
  groupTitle: string;
  label: string;
  /** `null` is "Unavailable". */
  count: number | null;
  /** True when the count is a floor ("at least"), because the review queue read stops at its limit. */
  atLeast: boolean;
  href: string;
  linkLabel: string;
  /** A to-review list, not an alert: counted separately and left out of the bell badge. */
  reviewOnly: boolean;
};

export type WorkList = {
  rows: WorkRow[];
  /** Checks that could not be read, named for the notice. Empty when everything was read. */
  unavailable: string[];
  /** True when the whole attention read failed, so no attention row can be trusted either way. */
  attentionFailed: boolean;
  truncated: boolean;
};

/**
 * "Work across the platform": the attention model's items plus pending feature requests, each linked to the page that
 * already reviews or repairs it. These are separate workflows with their own units and gates. They are not added up:
 * one failed message can be a failed-email item, a delivery exception on an event and a bell signal at once, and a
 * request or application is not a registration. `featureRequests` is `null` when that queue could not be read.
 */
export function buildWorkList(attention: AttentionSummary | null, featureRequests: number | null): WorkList {
  const rows: WorkRow[] = [];
  for (const group of attention?.groups ?? []) {
    for (const item of group.items) {
      rows.push({
        key: item.key,
        groupTitle: group.title,
        label: item.label,
        count: attention?.unreadable.includes(item.key) ? null : item.count,
        // The directory list stops at its cap, so its count is a floor, the same as in "How these numbers differ".
        atLeast: item.key === "directory-review" && attention?.truncated === true,
        href: homeHref(item.key, item.href),
        linkLabel: openLabels[item.key],
        reviewOnly: item.reviewOnly === true,
      });
    }
  }
  // Feature requests are decided on their own review page; this link only opens it and approves nothing.
  const requestRow: WorkRow = {
    key: "feature-requests",
    groupTitle: "Waiting on staff",
    label: featureRequests === 1 ? "feature request waiting for a decision" : "feature requests waiting for a decision",
    count: featureRequests,
    atLeast: featureRequests !== null && featureRequests >= FEATURE_REQUEST_READ_LIMIT,
    href: "/admin/feature-requests",
    linkLabel: "Review feature requests",
    reviewOnly: false,
  };
  if (featureRequests === null || featureRequests > 0) rows.push(requestRow);

  return {
    rows,
    unavailable: [
      ...(attention ? attention.unreadable.map((key) => checkNames[key]) : []),
      ...(featureRequests === null ? ["feature requests"] : []),
    ],
    attentionFailed: attention === null,
    truncated: attention?.truncated ?? false,
  };
}

/** Rows grouped for display, in the bell's order, with feature requests inside "Waiting on staff". */
export function groupWorkRows(rows: readonly WorkRow[]): Array<{ title: string; rows: WorkRow[] }> {
  const order = ["Waiting on staff", "Email problems", "System health"];
  return order
    .map((title) => ({ title, rows: rows.filter((row) => row.groupTitle === title) }))
    .filter((group) => group.rows.length > 0);
}

/**
 * "Next starts in N days" for the Upcoming events card (#1228), from the dashboard's events (sorted in progress first,
 * then soonest start). `null` when none has not ended. Same wording as each event card's countdown.
 */
export function nextEventNote(events: ReadonlyArray<{ timing: "UPCOMING" | "IN_PROGRESS" | "PAST"; daysUntilStart: number | null }>): string | null {
  const next = events.find((event) => event.timing !== "PAST");
  if (!next) return null;
  if (next.timing === "IN_PROGRESS") return "Happening now";
  if (next.daysUntilStart === null) return null;
  return next.daysUntilStart <= 1 ? "Next starts within a day" : `Next starts in ${next.daysUntilStart} days`;
}

export type HomeTab = { key: string; label: string; href: string };

/** The top tabs (#1228, Settings added in #1274). Events and System health jump within this page; the rest open the page that owns them. */
export const systemHomeTabs: readonly HomeTab[] = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "events", label: "Events", href: "#upcoming-events" },
  { key: "clubs", label: "Clubs", href: "/admin/clubs/summary" },
  { key: "people", label: "People", href: "/admin/people" },
  { key: "forms", label: "Forms", href: "/admin/forms" },
  { key: "settings", label: "Settings", href: "/admin/settings" },
  { key: "health", label: "System health", href: "#system-health" },
];

/**
 * The Common tasks links, grouped as the mockup groups them (#1228), by destination. Each is looked up in the shared
 * System navigation so a renamed or removed destination fails a test instead of leaving a dead link. `label` names the
 * link when the mockup's name is shorter than the navigation's.
 */
export const commonTaskHrefs: ReadonlyArray<{ href: string; heading: string; label?: string }> = [
  { href: "/event-setup", heading: "Events" },
  { href: "/admin/calendar", heading: "Events" },
  { href: "/event-setup/copy", heading: "Events" },
  { href: "/admin/event-templates", heading: "Events" },
  { href: "/archived-events", heading: "Events" },
  { href: "/admin/organizations", heading: "Clubs" },
  { href: "/admin/clubs/reports", heading: "Clubs" },
  { href: "/admin/clubs/summary", heading: "Clubs" },
  { href: "/admin/clubs/applications", heading: "Clubs" },
  { href: "/admin/clubs/transfers", heading: "Clubs" },
  { href: "/admin/forms", heading: "Forms" },
  { href: "/admin/club-forms", heading: "Forms" },
  { href: "/admin/form-templates", heading: "Forms" },
  { href: "/admin/question-library", heading: "Forms" },
  { href: "/admin/information-forms", heading: "Forms" },
  { href: "/admin/people", heading: "People" },
  { href: "/admin/email", heading: "Settings" },
  { href: "/admin/settings", heading: "Settings" },
];

/** Time shown for a read, in UTC so the server and the reader agree. */
export function readTimeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`;
}
