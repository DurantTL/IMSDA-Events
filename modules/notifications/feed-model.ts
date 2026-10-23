import { getNotificationDefinition, isNotificationKey, type NotificationKey } from "@/modules/notifications/catalog";

/**
 * The system administrator alert feed (#1033, slice 2 of the notification bell): pure rules.
 *
 * No database and no `server-only`, so the bell, the route and the tests share one definition of how long an item is
 * kept, what a summary may hold and which links are allowed. `feed.ts` reads and writes the tables.
 */

/** An item older than this drops out of the feed (and is deleted by the sweep). One server clock, compared to `occurredAt`. */
export const ALERT_FEED_RETENTION_DAYS = 90;
/** How many items the panel lists. The unread count is exact whatever this is. */
export const ALERT_FEED_LIST_LIMIT = 30;
export const ALERT_FEED_SUMMARY_MAX = 160;
const DAY_MS = 24 * 60 * 60_000;

/** Items occurring before this are out of the feed. An item exactly this old is still in. */
export function alertFeedCutoff(now: Date) {
  return new Date(now.getTime() - ALERT_FEED_RETENTION_DAYS * DAY_MS);
}

export type AlertFeedItemView = {
  id: string;
  notificationKey: NotificationKey;
  /** The catalog's name for the alert. */
  alertName: string;
  summary: string;
  /** A same-site path, or null when there is nothing to open. */
  href: string | null;
  occurredAt: string;
  read: boolean;
};

export type AlertFeed = {
  /** All unread items in the retention window, not only the listed ones. */
  unreadCount: number;
  items: AlertFeedItemView[];
};

/**
 * A summary is a label and counts the caller built from fixed words, never text a person typed. This is the last guard:
 * it removes template braces and control characters, collapses spaces and caps the length. It cannot make a sensitive
 * value safe, so a send site must not pass one in (the tests read every summary a site produces).
 */
export function cleanFeedSummary(value: string): string {
  const flat = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll("{{", "").replaceAll("}}", "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > ALERT_FEED_SUMMARY_MAX ? `${flat.slice(0, ALERT_FEED_SUMMARY_MAX - 1).trimEnd()}…` : flat;
}

/**
 * A stored link is an internal path to a page that checks its own permission, never an absolute URL and never one that
 * carries a private token. Anything else is stored as no link.
 */
export function safeFeedHref(href: string | null | undefined): string | null {
  if (typeof href !== "string") return null;
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  if (/[?&#](token|key|secret|code|password)=/i.test(href)) return null;
  return href;
}

export function feedAlertName(key: string): string {
  return isNotificationKey(key) ? getNotificationDefinition(key).name : "Alert";
}
