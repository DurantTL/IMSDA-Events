import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Award,
  CalendarCheck,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  HeartPulse,
  Church,
  GraduationCap,
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
  ShieldAlert,
  Trophy,
  UserPlus,
  Users,
  UsersRound,
  BarChart3,
  ListChecks,
  Bell,
  BookmarkPlus,
  Megaphone,
  LineChart,
  PauseCircle,
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

/**
 * The Club summary's Monthly Records tab (#1552): the one destination the Clubs menu, the System menu and the section
 * tab share. The review list, `/admin/clubs/reports`, is reached from that tab's "Review monthly records" button.
 */
export const clubsAdminRecordsHref = "/admin/clubs/summary?view=records#monthly-records";

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
      { href: "/admin/events", label: "All events", description: "Every current event, with dates and status.", icon: CalendarRange },
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
      { href: clubsAdminRecordsHref, label: "Monthly Records", description: "Monthly Records, club by club and month by month.", icon: FileText, alsoActiveFor: ["/admin/clubs/reports"] },
      { href: "/admin/clubs/summary", label: "Club summary", description: "How every club is doing at a glance.", icon: BarChart3 },
      { href: "/admin/clubs/applications", label: "New club applications", description: "Applications waiting for review.", icon: UserPlus },
      { href: "/admin/clubs/leaders", label: "Club leaders", description: "Every current Director, Deputy, Registrar and Reporter across clubs, and the invites still waiting.", icon: Users, alsoActiveFor: ["/admin/clubs/invites"] },
      { href: "/admin/clubs/transfers", label: "Club member transfers", description: "Members moving from one club to another.", icon: ArrowRightLeft },
      { href: "/admin/youth", label: "Youth directory", description: "Every active youth on a club roster by grade, school type and club, with counts and a CSV export.", icon: GraduationCap },
    ],
  },
  {
    key: "system-people",
    label: "People",
    collapsedByDefault: false,
    items: [
      { href: "/admin/people", label: "People & access", description: "Staff logins and website accounts: who they are and what they can reach.", icon: UsersRound },
      { href: "/admin/health-access", label: "Break-glass and legal holds", description: "Review break-glass grants and place or lift legal holds on sealed health copies.", icon: ShieldAlert },
    ],
  },
  {
    key: "system-forms",
    label: "Forms",
    collapsedByDefault: false,
    items: [
      { href: "/admin/forms", label: "All forms", description: "Club, general information and event information forms in one list. Registration forms are built inside each event.", icon: ListChecks },
      { href: "/admin/club-forms", label: "Club forms", description: "The forms clubs fill in for events.", icon: ClipboardList },
      { href: "/admin/club-forms/public-page", label: "Public club forms page", description: "Which forms visitors see on the public Club forms page, with preview and publish.", icon: Megaphone },
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
      { href: "/admin/site-content", label: "Homepage & site content", description: "Notices, announcements, featured events, header links and the footer on the public pages, with preview and publish.", icon: Megaphone },
      { href: "/admin/analytics", label: "Public analytics", description: "Anonymous 30-day counts: event views, registration funnel, sign-in rates, broken links and page speed.", icon: LineChart },
      { href: "/admin/settings", label: "Platform settings", description: "Organization identity, passkeys, invoice header and new-event defaults.", icon: CloudCog },
      { href: "/admin/readiness", label: "System readiness", description: "Whether the platform is ready for an event.", icon: CheckCircle2 },
      { href: "/admin/system-report", label: "System report", description: "Every health reading in one place: what was checked, when and what it found.", icon: HeartPulse },
      { href: "/admin/pauses", label: "Pause an area", description: "Stop event registration, payments or the club portal for a few minutes while something is fixed. Pages stay readable.", icon: PauseCircle },
    ],
  },
];

/**
 * The five Admin hub pages (#1569), one per Admin tab. Not part of `systemNavGroups` (the /admin dashboard, the sidebar and
 * Find a page draw those, so the hubs are not in the search); they are registered here so the Admin tabs can look them up
 * (`registeredDestination`) and the route map lists them.
 */
export type AdminHubKey = "events" | "clubs" | "people" | "forms" | "catalogs";

export const adminHubs: Record<AdminHubKey, { href: string; label: string; title: string; description: string }> = {
  events: { href: "/admin/hubs/events", label: "Events", title: "Events", description: "Creating events, the public calendar, templates and requests from event staff." },
  clubs: { href: "/admin/hubs/clubs", label: "Clubs", title: "Clubs", description: "The club directory, club records, and new clubs. Day-to-day club work lives in the Clubs area." },
  people: { href: "/admin/hubs/people", label: "People", title: "People", description: "Who can sign in, what they can reach, and sealed health records." },
  forms: { href: "/admin/hubs/forms", label: "Forms", title: "Forms", description: "Every form, and the templates and saved questions forms are built from." },
  catalogs: { href: "/admin/hubs/catalogs", label: "Catalogs and settings", title: "Catalogs and settings", description: "System health, the website and email, catalogs clubs choose from, and platform settings." },
};

/** The groups the /admin dashboard draws as its task directory; every other group is a Common tasks group there (#1228). */
export const adminDirectoryGroups: readonly SystemNavGroup[] = systemNavGroups.filter((group) => group.key === "system-catalogs");

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
      // An href with a query or hash opens a tab of a page another item owns, so it only lights through `alsoActiveFor`.
      for (const path of [...(/[?#]/.test(item.href) ? [] : [item.href]), ...(item.alsoActiveFor ?? [])]) {
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
  [/^\/admin\/hubs\/events(\/|$)/, adminHubs.events.title],
  [/^\/admin\/hubs\/clubs(\/|$)/, adminHubs.clubs.title],
  [/^\/admin\/hubs\/people(\/|$)/, adminHubs.people.title],
  [/^\/admin\/hubs\/forms(\/|$)/, adminHubs.forms.title],
  [/^\/admin\/hubs\/catalogs(\/|$)/, adminHubs.catalogs.title],
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
  [/^\/admin\/organizations\/[^/]+\/church-clubs(\/|$)/, "Church club summary"],
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
  [/^\/admin\/clubs\/invites(\/|$)/, "Club leaders"],
  [/^\/admin\/clubs\/leaders(\/|$)/, "Club leaders"],
  [/^\/admin\/clubs\/reports\/year-end(\/|$)/, "Club Year-End Reports"],
  [/^\/admin\/clubs\/reports\/[^/]+\/[^/]+(\/|$)/, "Club Monthly Record"],
  [/^\/admin\/clubs\/reports(\/|$)/, "Review monthly records"],
  [/^\/admin\/clubs\/summary(\/|$)/, "Club summary"],
  [/^\/admin\/clubs\/transfers(\/|$)/, "Club member transfers"],
  [/^\/admin\/youth(\/|$)/, "Youth directory"],
  [/^\/admin\/forms(\/|$)/, "All forms"],
  [/^\/admin\/form-templates\/[^/]+(\/|$)/, "Form template"],
  [/^\/admin\/form-templates(\/|$)/, "Form templates"],
  [/^\/admin\/question-library(\/|$)/, "Question library"],
  [/^\/admin\/information-forms\/[^/]+\/responses(\/|$)/, "Form responses"],
  [/^\/admin\/information-forms\/[^/]+(\/|$)/, "Information form"],
  [/^\/admin\/information-forms(\/|$)/, "Information forms"],
  [/^\/admin\/club-forms\/public-page(\/|$)/, "Public club forms page"],
  [/^\/admin\/club-forms\/[^/]+(\/|$)/, "Club form builder"],
  [/^\/admin\/club-forms(\/|$)/, "Club forms"],
  [/^\/admin\/club-supplies\/conference-orders(\/|$)/, "Conference club orders"],
  [/^\/admin\/club-supplies(\/|$)/, "Club supply catalog"],
  [/^\/admin\/honors(\/|$)/, "Honor catalog"],
  [/^\/admin\/master-award-rules(\/|$)/, "Master Award rules"],
  [/^\/admin\/people\/invite-lookup(\/|$)/, "Give a club role"],
  [/^\/admin\/(people|team|accounts)(\/|$)/, "People & access"],
  [/^\/admin\/health-access(\/|$)/, "Break-glass and legal holds"],
  [/^\/admin\/events(\/|$)/, "All events"],
  [/^\/admin\/calendar(\/|$)/, "Conference calendar"],
  [/^\/admin\/event-templates\/from-event(\/|$)/, "Save an event as a template"],
  [/^\/admin\/event-templates\/[^/]+(\/|$)/, "Edit event template"],
  [/^\/admin\/event-templates(\/|$)/, "Event templates"],
  [/^\/admin\/(email|notifications)(\/|$)/, "Email"],
  [/^\/admin\/readiness(\/|$)/, "System readiness"],
  [/^\/admin\/system-report(\/|$)/, "System report"],
  [/^\/admin\/site-content(\/|$)/, "Homepage & site content"],
  [/^\/admin\/analytics(\/|$)/, "Public analytics"],
  [/^\/admin\/settings(\/|$)/, "Platform settings"],
  [/^\/admin\/pauses(\/|$)/, "Pause an area"],
  [/^\/admin\/feature-requests(\/|$)/, "Event module requests"],
  [/^\/admin\/problem-reports(\/|$)/, "Problem reports"],
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
