import { ADMIN_ROLE_LABELS, type AdminRole, type AdminRoleCounts } from "@/modules/access/admin-roles-domain";
import { isSafeAttentionHref, type AttentionItemKey, type AttentionSummary } from "@/modules/system-admin/attention-model";
import type { EventsAdminHome } from "@/modules/events/events-admin-home-model";
import { isUpcomingEvent } from "@/modules/system-admin/dashboard";

/**
 * Home (#1568): "Needs you" and "Coming up". Pure model, no database access and no authorization of its own. Needs you is
 * one section per admin role the person holds, built from the same reads the shell's role pills use, so the numbers agree
 * everywhere. Every item is a link to the page that does the work; nothing on Home approves, sends or changes anything.
 *
 * Rules the model keeps:
 * - A read that failed is `null` (the section or item says "Unavailable"). It is never turned into 0, "Nothing waiting"
 *   or "All ready", and it keeps "Nothing needs you right now" from showing.
 * - An item that read zero is left out of its section; a section with no item and no failed read says "Nothing waiting".
 * - `counted` items are the ones the role's pill counts (and so the tab badge); the rest are shown beside them with
 *   their own number and are never added in.
 */

/** A read that worked (the value) or failed (`null`). */
export type Read<T> = T | null;

export type NeedsLink = { label: string; href: string };

export type NeedsItem = {
  key: string;
  label: string;
  /** What one unit is, or null. */
  unit: string | null;
  /** `null` when the check could not be read. */
  count: number | null;
  /** Whether the role's own count (the pill, the tab badge) includes this item. */
  counted: boolean;
  links: NeedsLink[];
  note: string | null;
};

export type NeedsSection = {
  role: AdminRole;
  title: string;
  items: NeedsItem[];
  /** The counted items added up, or `null` when one of them could not be read (a partial sum would understate). */
  total: number | null;
  /** True when every read of this section worked and nothing is waiting. */
  clear: boolean;
  /** True when some read of this section failed. */
  unavailable: boolean;
};

export type NeedsInput = {
  held: readonly AdminRole[];
  /** `buildEventsAdminHome` for the viewer's events, or `null` when that read failed. Only used for EVENTS_ADMIN. */
  events?: EventsAdminHome | null;
  /** Waiting new club applications and the late Monthly Records, each `null` when unreadable. Only used for CLUBS_ADMIN. */
  clubs?: { applications: Read<number>; lateRecords: Read<number> };
  /** The shared attention summary, or `null` when it could not be loaded. Only used for SYSTEM_ADMIN. */
  attention?: AttentionSummary | null;
};

export type NeedsView = {
  /** No admin role: work is listed on each event's page. */
  noAdminRole: boolean;
  sections: NeedsSection[];
  /** True only when the person holds a role, every read worked and nothing is waiting. */
  allClear: boolean;
};

const checkNames: Record<AttentionItemKey, string> = {
  "club-applications": "Club applications",
  "pending-teams": "Pending teams",
  "cancellation-requests": "Cancellation requests",
  "staff-invitation-approvals": "Staff approvals",
  "directory-review": "Directory review",
  "email-failed": "Failed email",
  "email-stuck": "Stuck email",
  "outbox-sweep": "The email sweep",
  "scheduled-emails-overdue": "Overdue scheduled email",
  "scheduled-emails-failed": "Failed scheduled email",
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function eventsItems(events: EventsAdminHome | null): NeedsItem[] {
  if (!events) {
    return [{ key: "events-work", label: "Work waiting on your events", unit: null, count: null, counted: true, links: [], note: null }];
  }
  const items: NeedsItem[] = [];
  const several = events.events.length > 1;
  for (const row of events.workRows) {
    if (row.total <= 0) continue;
    items.push({
      key: row.kind,
      label: row.label,
      unit: row.unit,
      count: row.total,
      // The role's count is open balances plus draft registrations; failed messages are listed beside it.
      counted: row.kind !== "messages",
      links: row.items
        .filter((item) => item.count > 0)
        .map((item) => ({ label: several ? `${item.eventName}: ${item.count}` : row.linkLabel, href: item.href })),
      note: row.items.find((item) => item.note && item.count > 0)?.note ?? null,
    });
  }
  return items;
}

function clubsItems(clubs: NonNullable<NeedsInput["clubs"]>): NeedsItem[] {
  const items: NeedsItem[] = [];
  const { applications, lateRecords } = clubs;
  if (applications === null || applications > 0) {
    items.push({
      key: "club-applications",
      label: applications === 1 ? "New club application waiting for a decision" : "New club applications waiting for a decision",
      unit: null,
      count: applications,
      counted: true,
      links: [{ label: "Review applications", href: "/admin/clubs/applications" }],
      note: null,
    });
  }
  if (lateRecords === null || lateRecords > 0) {
    items.push({
      key: "late-records",
      label: lateRecords === 1 ? "Late Monthly Record" : "Late Monthly Records",
      unit: "for this month's report",
      count: lateRecords,
      counted: false,
      links: [{ label: "Open Monthly Records", href: "/admin/clubs/summary?view=records#monthly-records" }],
      note: null,
    });
  }
  return items;
}

/** The attention items shown under System: the bell's alert items, with club applications left to the Clubs section. */
function systemItems(attention: AttentionSummary | null, clubsShown: boolean): NeedsItem[] {
  if (!attention) {
    return [{ key: "system-checks", label: "System checks", unit: null, count: null, counted: true, links: [], note: null }];
  }
  const items: NeedsItem[] = [];
  for (const group of attention.groups) {
    for (const item of group.items) {
      // The Clubs section lists club applications, and a system administrator always holds Clubs.
      if (item.key === "club-applications" && clubsShown) continue;
      const unreadable = attention.unreadable.includes(item.key);
      items.push({
        key: item.key,
        label: unreadable ? checkNames[item.key] : item.label,
        unit: null,
        count: unreadable ? null : item.count,
        counted: item.reviewOnly !== true,
        links: !unreadable && isSafeAttentionHref(item.href) ? [{ label: "Open", href: item.href }] : [],
        note: item.reviewOnly ? "A list to review, not counted in the number on the tab." : null,
      });
    }
  }
  // A check that could not be read has no item in the groups: it is unknown, never "none found".
  for (const key of attention.unreadable) {
    if (key === "club-applications" && clubsShown) continue;
    if (items.some((item) => item.key === key)) continue;
    items.push({ key, label: checkNames[key], unit: null, count: null, counted: true, links: [], note: null });
  }
  return items;
}

function section(role: AdminRole, items: NeedsItem[]): NeedsSection {
  const counted = items.filter((item) => item.counted);
  const unavailable = items.some((item) => item.count === null);
  return {
    role,
    title: ADMIN_ROLE_LABELS[role],
    items,
    total: counted.some((item) => item.count === null) ? null : counted.reduce((sum, item) => sum + (item.count ?? 0), 0),
    clear: !unavailable && items.every((item) => item.count === 0),
    unavailable,
  };
}

export function buildNeedsView(input: NeedsInput): NeedsView {
  const held = new Set(input.held);
  const sections: NeedsSection[] = [];
  if (held.has("EVENTS_ADMIN")) sections.push(section("EVENTS_ADMIN", eventsItems(input.events ?? null)));
  if (held.has("CLUBS_ADMIN")) {
    sections.push(section("CLUBS_ADMIN", clubsItems(input.clubs ?? { applications: null, lateRecords: null })));
  }
  if (held.has("SYSTEM_ADMIN")) sections.push(section("SYSTEM_ADMIN", systemItems(input.attention ?? null, held.has("CLUBS_ADMIN"))));
  return {
    noAdminRole: sections.length === 0,
    sections,
    allClear: sections.length > 0 && sections.every((entry) => entry.clear),
  };
}

/** The words under a section's heading: the waiting number, "Unavailable", or "Nothing waiting". */
export function sectionStatusText(entry: NeedsSection): string {
  if (entry.total === null) return "Unavailable";
  if (entry.unavailable) return `${entry.total} waiting, some checks unavailable`;
  if (entry.total === 0) return "Nothing waiting";
  return `${entry.total} ${plural(entry.total, "item", "items")} waiting`;
}

/** An item's number as words: the count, or "Unavailable". */
export function itemCountText(item: NeedsItem): string {
  return item.count === null ? "Unavailable" : item.count.toLocaleString("en-US");
}

/**
 * The "Needs you" tab's badge: the held roles' counts the shell already read, added up. Left off (`undefined`) when a held
 * role's count was not read (a partial sum would understate) or the sum is zero. A system administrator's System count
 * already holds the waiting club applications, so their Clubs count is not added a second time.
 */
export function needsYouTabCount(held: readonly AdminRole[], counts: AdminRoleCounts): number | undefined {
  if (held.length === 0) return undefined;
  const roles = held.includes("SYSTEM_ADMIN") ? held.filter((role) => role !== "CLUBS_ADMIN") : held;
  let sum = 0;
  for (const role of roles) {
    const count = counts[role];
    if (typeof count !== "number" || !Number.isFinite(count)) return undefined;
    sum += count;
  }
  return sum > 0 ? sum : undefined;
}

export type ComingUpEventSource = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  isPublished: boolean;
  archivedAt: Date | null;
};

export type ComingUpEvent = {
  id: string;
  name: string;
  dates: string;
  place: string;
  status: { text: string; tone: "ok" | "draft" };
  href: string;
};

/** The dates in the event's own time zone, like the Events Administrator dashboard. */
export function comingUpDates(start: Date, end: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).formatRange(start, end);
}

/**
 * The events this person can open that have not ended, soonest first. The upcoming rule is the System home's
 * `isUpcomingEvent`: not archived and `endsAt >= now`. A published event says "Published"; the rest say "Not published",
 * in words.
 */
export function buildComingUp(sources: readonly ComingUpEventSource[], now: Date): ComingUpEvent[] {
  return sources
    .filter((event) => isUpcomingEvent(event, now))
    .slice()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((event) => ({
      id: event.id,
      name: event.name,
      dates: comingUpDates(event.startsAt, event.endsAt, event.timezone),
      place: event.location?.trim() || "Location not set",
      status: event.isPublished ? { text: "Published", tone: "ok" } : { text: "Not published", tone: "draft" },
      href: `/overview?event=${encodeURIComponent(event.id)}`,
    }));
}
