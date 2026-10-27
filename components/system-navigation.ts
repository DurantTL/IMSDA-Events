import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Award,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  Church,
  ClipboardList,
  ClipboardPen,
  CloudCog,
  Copy,
  FileStack,
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
  ListChecks,
  Bell,
  BookmarkPlus,
} from "lucide-react";

/**
 * The system administrator's tasks, grouped (#966). The /admin dashboard draws
 * them as task cards and the sidebar draws the same groups, compact and
 * collapsible, on every /admin page, so the two cannot drift.
 *
 * Almost every destination is a system-administrator page that checks
 * `globalRole === "SYSTEM_ADMIN"` itself; Archived events (`/archived-events`)
 * is staff-scoped and enforces its own access. The callers draw these groups
 * only for a system administrator. Nothing here grants access.
 */
export type SystemNavGroupKey = "system-events" | "system-clubs" | "system-people" | "system-forms" | "system-catalogs";

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
  /**
   * Closed until opened on the /admin dashboard's catalog directory. Only the dashboard reads it: every sidebar group
   * starts closed (#1245), except the one holding the current page.
   */
  collapsedByDefault: boolean;
  items: readonly SystemNavItem[];
};

export const systemNavGroups: readonly SystemNavGroup[] = [
  {
    key: "system-events",
    label: "Events",
    collapsedByDefault: false,
    items: [
      { href: "/event-setup", label: "Create an event", description: "Start a new event, blank or from a template.", icon: CalendarPlus },
      { href: "/admin/calendar", label: "Conference calendar", description: "Turn a calendar item into a registration event, and add, edit and publish the public calendar visitors see.", icon: CalendarCheck },
      { href: "/event-setup/copy", label: "Copy from a past event", description: "Start from last year's event settings and forms.", icon: Copy },
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
      { href: "/admin/clubs/reports", label: "Club Monthly Records", description: "Club Monthly Records, month by month.", icon: FileText },
      { href: "/admin/clubs/summary", label: "Club summary", description: "How every club is doing at a glance.", icon: BarChart3 },
      { href: "/admin/clubs/applications", label: "New club applications", description: "Applications waiting for review and invites sent.", icon: UserPlus, alsoActiveFor: ["/admin/clubs/invites"] },
      { href: "/admin/clubs/transfers", label: "Club member transfers", description: "Members moving from one club to another.", icon: ArrowRightLeft },
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
    key: "system-forms",
    label: "Forms",
    collapsedByDefault: false,
    items: [
      { href: "/admin/forms", label: "All forms", description: "Every club, general and event form in one list.", icon: ListChecks },
      { href: "/admin/club-forms", label: "Club forms", description: "The forms clubs fill in for events.", icon: ClipboardList },
      { href: "/admin/form-templates", label: "Form templates", description: "The registration forms event staff start from.", icon: FileStack },
      { href: "/admin/question-library", label: "Question library", description: "Saved questions anyone building a form can add.", icon: BookmarkPlus },
      { href: "/admin/information-forms", label: "Information forms", description: "Surveys and interest forms that belong to no event.", icon: ClipboardPen },
    ],
  },
  {
    key: "system-catalogs",
    label: "Catalogs and settings",
    collapsedByDefault: true,
    items: [
      { href: "/admin/honors", label: "Honor catalog", description: "The honors clubs can earn.", icon: Award },
      { href: "/admin/club-supplies", label: "Club supply catalog", description: "Supplies clubs can order.", icon: Package },
      { href: "/admin/master-award-rules", label: "Master Award rules", description: "What it takes to earn a Master Award.", icon: Trophy },
      { href: "/admin/organizations/background-checks", label: "Sterling Volunteers", description: "Sterling Volunteers screening status for clubs.", icon: ShieldCheck },
      { href: "/admin/email", label: "Email", description: "The central sender, paused events, staff alerts, and email health.", icon: Bell, alsoActiveFor: ["/admin/notifications"] },
      { href: "/admin/settings", label: "Platform settings", description: "Organization identity, passkeys, invoice header and new-event defaults.", icon: CloudCog },
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

/** A stable per-entry key, shared by the sidebar, the phone menu and their active checks. */
export function systemNavEntryKey(group: SystemNavGroup, item: SystemNavItem): string {
  return `${group.key}:${item.href}`;
}

/** The entry (group and item) a page lights. */
export function systemNavActiveEntryKey(pathname: string): string | null {
  const item = systemNavActiveItem(pathname);
  if (!item) return null;
  const group = systemNavGroups.find((candidate) => candidate.items.includes(item));
  return group ? systemNavEntryKey(group, item) : null;
}

/** The account menu's Create event link (#966): only a system administrator gets one. */
export function createEventHrefFor(isSystemAdmin: boolean): string | undefined {
  return isSystemAdmin ? "/event-setup" : undefined;
}

type SystemTitleRule = readonly [path: RegExp, title: string];

/**
 * The topbar title of each /admin page (#981), so the header names the page
 * ("Team") and not "System management" on every one. Each title is the page's
 * own `<title>`; `tests/system-admin-navigation-966.test.ts` checks that. The
 * more specific path comes first. /admin itself is not here: it is System
 * management.
 */
const systemTitleRules: readonly SystemTitleRule[] = [
  [/^\/event-setup\/from-template(\/|$)/, "Start from template"],
  [/^\/event-setup\/copy(\/|$)/, "Copy from a past event"],
  [/^\/event-setup(\/|$)/, "Create an event"],
  [/^\/admin\/organizations\/background-checks(\/|$)/, "Sterling Volunteers"],
  [/^\/admin\/background-checks(\/|$)/, "Sterling Volunteers"],
  [/^\/admin\/organizations\/directory(\/|$)/, "Organization directory"],
  [/^\/admin\/organizations\/import(\/|$)/, "Import organizations"],
  [/^\/admin\/organizations\/map-locations(\/|$)/, "Find map locations"],
  [/^\/admin\/organizations\/[^/]+\/billing(\/|$)/, "Billing contact"],
  [/^\/admin\/organizations\/[^/]+\/pastor(\/|$)/, "Pastor contact"],
  [/^\/admin\/organizations\/[^/]+\/club\/honors(\/|$)/, "Club honors"],
  [/^\/admin\/organizations\/[^/]+\/club(\/|$)/, "Open club"],
  [/^\/admin\/organizations\/[^/]+\/directors(\/|$)/, "Club directors"],
  [/^\/admin\/organizations\/[^/]+\/location(\/|$)/, "Church location"],
  [/^\/admin\/organizations\/[^/]+\/profile(\/|$)/, "Club profile"],
  [/^\/admin\/organizations(\/|$)/, "Clubs and churches"],
  [/^\/admin\/clubs\/?$/, "Club administration"],
  [/^\/admin\/clubs\/applications(\/|$)/, "New club applications"],
  [/^\/admin\/clubs\/health-import(\/|$)/, "Import health records"],
  [/^\/admin\/clubs\/import(\/|$)/, "Import clubs"],
  [/^\/admin\/clubs\/invites(\/|$)/, "Club invites"],
  [/^\/admin\/clubs\/reports\/year-end(\/|$)/, "Club Year-End Reports"],
  [/^\/admin\/clubs\/reports\/[^/]+\/[^/]+(\/|$)/, "Club Monthly Record"],
  [/^\/admin\/clubs\/reports(\/|$)/, "Club Monthly Records"],
  [/^\/admin\/clubs\/summary(\/|$)/, "Club summary"],
  [/^\/admin\/clubs\/transfers(\/|$)/, "Club member transfers"],
  [/^\/admin\/forms(\/|$)/, "All forms"],
  [/^\/admin\/form-templates\/[^/]+(\/|$)/, "Form template"],
  [/^\/admin\/form-templates(\/|$)/, "Form templates"],
  [/^\/admin\/question-library(\/|$)/, "Question library"],
  [/^\/admin\/information-forms\/[^/]+\/responses(\/|$)/, "Form responses"],
  [/^\/admin\/information-forms\/[^/]+(\/|$)/, "Information form"],
  [/^\/admin\/information-forms(\/|$)/, "Information forms"],
  [/^\/admin\/club-forms\/[^/]+(\/|$)/, "Club form builder"],
  [/^\/admin\/club-forms(\/|$)/, "Club forms"],
  [/^\/admin\/club-supplies(\/|$)/, "Club supply catalog"],
  [/^\/admin\/honors(\/|$)/, "Honor catalog"],
  [/^\/admin\/master-award-rules(\/|$)/, "Master Award rules"],
  [/^\/admin\/accounts(\/|$)/, "Accounts"],
  [/^\/admin\/calendar(\/|$)/, "Conference calendar"],
  [/^\/admin\/event-templates\/[^/]+(\/|$)/, "Edit event template"],
  [/^\/admin\/event-templates(\/|$)/, "Event templates"],
  [/^\/admin\/(email|notifications)(\/|$)/, "Email"],
  [/^\/admin\/readiness(\/|$)/, "System readiness"],
  [/^\/admin\/settings(\/|$)/, "Platform settings"],
  [/^\/admin\/team(\/|$)/, "Team"],
  [/^\/admin\/feature-requests(\/|$)/, "Feature requests"],
];

/**
 * Pages that sit in the System management workspace: every /admin page, and the
 * event-creation pages under /event-setup (#981), which the system sidebar lists
 * under Events > Create an event / Copy from a past event.
 */
export function isSystemWorkspacePath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/event-setup" || pathname.startsWith("/event-setup/");
}

/** The topbar title of a /admin page, or `null` for /admin itself and any page without a rule (System management). */
export function systemSubpageTitle(pathname: string): string | null {
  for (const [path, title] of systemTitleRules) {
    if (path.test(pathname)) return title;
  }
  return null;
}
