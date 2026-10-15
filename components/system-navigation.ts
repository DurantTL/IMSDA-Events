import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Award,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Church,
  ClipboardList,
  CloudCog,
  Copy,
  FileText,
  LayoutTemplate,
  ArrowRightLeft,
  Package,
  ShieldCheck,
  Trophy,
  UserPlus,
  UsersRound,
  BarChart3,
  KeyRound,
} from "lucide-react";

/**
 * The system administrator's tasks, grouped (#966). The /admin dashboard draws
 * them as task cards and the sidebar draws the same groups, compact and
 * collapsible, on every /admin page, so the two cannot drift.
 *
 * Every destination here is a system-administrator page (each page checks
 * `globalRole === "SYSTEM_ADMIN"` itself); the callers draw these groups only for
 * a system administrator. Nothing here grants access.
 */
export type SystemNavGroupKey = "system-events" | "system-clubs" | "system-people" | "system-catalogs";

export type SystemNavItem = {
  href: string;
  label: string;
  /** One line for the dashboard card. */
  description: string;
  icon: LucideIcon;
  /** Other paths that light this item in the sidebar, matched like `href` (the path or anything below it). */
  alsoActiveFor?: readonly string[];
};

export type SystemNavGroup = {
  key: SystemNavGroupKey;
  label: string;
  /** Closed until opened, on the dashboard and in the sidebar. */
  collapsedByDefault: boolean;
  items: readonly SystemNavItem[];
};

export const systemNavGroups: readonly SystemNavGroup[] = [
  {
    key: "system-events",
    label: "Events",
    collapsedByDefault: false,
    items: [
      { href: "/event-setup", label: "Create event", description: "Start a new event, blank or from a template.", icon: CalendarPlus },
      { href: "/admin/calendar", label: "Set up from calendar", description: "Turn a public calendar item into a registration event.", icon: CalendarCheck },
      { href: "/event-setup/copy", label: "Copy a past event", description: "Start from last year's event settings and forms.", icon: Copy },
      { href: "/admin/event-templates", label: "Event templates", description: "The starting points new events are built from.", icon: LayoutTemplate },
      { href: "/archived-events", label: "Archived events", description: "Events that are finished and put away.", icon: Archive },
    ],
  },
  {
    key: "system-clubs",
    label: "Clubs",
    collapsedByDefault: false,
    items: [
      { href: "/admin/organizations", label: "Clubs and churches", description: "The directory of every club and church.", icon: Church },
      { href: "/admin/clubs/reports", label: "Monthly reports", description: "Club Monthly Records, month by month.", icon: FileText },
      { href: "/admin/clubs/summary", label: "Club summary", description: "How every club is doing at a glance.", icon: BarChart3 },
      { href: "/admin/clubs/applications", label: "New club applications and invites", description: "Applications waiting for review and invites sent.", icon: UserPlus, alsoActiveFor: ["/admin/clubs/invites"] },
      { href: "/admin/clubs/transfers", label: "Member transfers", description: "Members moving from one club to another.", icon: ArrowRightLeft },
    ],
  },
  {
    key: "system-people",
    label: "People",
    collapsedByDefault: false,
    items: [
      { href: "/admin/team", label: "Team", description: "Who runs events and what they can do.", icon: UsersRound },
      { href: "/admin/accounts", label: "Accounts", description: "Staff and attendee sign-in accounts.", icon: KeyRound },
    ],
  },
  {
    key: "system-catalogs",
    label: "Catalogs and settings",
    collapsedByDefault: true,
    items: [
      { href: "/admin/honors", label: "Honor catalog", description: "The honors clubs can earn.", icon: Award },
      { href: "/admin/club-supplies", label: "Club supply catalog", description: "Supplies clubs can order.", icon: Package },
      { href: "/admin/club-forms", label: "Club forms", description: "The forms clubs fill in for events.", icon: ClipboardList },
      { href: "/admin/master-award-rules", label: "Master Award rules", description: "What it takes to earn a Master Award.", icon: Trophy },
      { href: "/admin/calendar", label: "Public calendar", description: "The calendar visitors see.", icon: CalendarDays },
      { href: "/admin/organizations/background-checks", label: "Sterling Volunteers", description: "Sterling Volunteers screening status for clubs.", icon: ShieldCheck },
      { href: "/admin/settings", label: "Platform settings", description: "Sign-in, email and payment settings.", icon: CloudCog },
      { href: "/admin/readiness", label: "System readiness", description: "Whether the platform is ready for an event.", icon: CheckCircle2 },
    ],
  },
];

function isAtOrBelow(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The sidebar item a /admin page lights: the longest matching path, so
 * /admin/organizations/background-checks lights Sterling Volunteers and not
 * Clubs and churches. `null` for /admin itself and pages with no item.
 * Set up from calendar and Public calendar are the same page: the first listing
 * (Set up from calendar) is the one that lights.
 */
export function systemNavActiveItem(pathname: string): SystemNavItem | null {
  let best: { item: SystemNavItem; length: number } | null = null;
  for (const group of systemNavGroups) {
    for (const item of group.items) {
      for (const path of [item.href, ...(item.alsoActiveFor ?? [])]) {
        if (!isAtOrBelow(pathname, path)) continue;
        if (!best || path.length > best.length) best = { item, length: path.length };
      }
    }
  }
  return best?.item ?? null;
}

/** A stable per-entry key: the same href can be listed in two groups (the calendar). */
export function systemNavEntryKey(group: SystemNavGroup, item: SystemNavItem): string {
  return `${group.key}:${item.href}`;
}

/** The entry (group and item) a page lights; the group is the first one listing the item. */
export function systemNavActiveEntryKey(pathname: string): string | null {
  const item = systemNavActiveItem(pathname);
  if (!item) return null;
  // /admin/calendar is both "Set up from calendar" and "Public calendar": light the Events entry only.
  const group = systemNavGroups.find((candidate) => candidate.items.includes(item));
  return group ? systemNavEntryKey(group, item) : null;
}
