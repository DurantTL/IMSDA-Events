import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  Award,
  CheckCircle2,
  ChartNoAxesCombined,
  FileText,
  FileUp,
  BedDouble,
  CalendarDays,
  Star,
  UtensilsCrossed,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Package,
  MoreHorizontal,
  PanelsTopLeft,
  ClipboardPen,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Tags,
  Tent,
  TicketPercent,
  ToggleRight,
  Trophy,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { kitchenCountsPath, type EventPermission } from "@/modules/access/permissions";
import { canManageClubAssignments } from "@/modules/club-registrations/assignments-access";
import { canAccessOperationalHealth, operationalHealthEntryPermissions } from "@/modules/operations/access";
import { canManageProgramAssignments } from "@/modules/program-assignments/access";
import { isSystemWorkspacePath, systemSubpageTitle } from "@/components/system-navigation";

/**
 * The single source of the destinations a signed-in staff member may reach:
 * the desktop sidebar (`components/app-shell.tsx`), the phone bottom tabs,
 * and the phone "More" directory (`app/(workspace)/more/page.tsx`) all read
 * this list, so which pages a role can open can't drift between desktop and
 * phone (#475).
 *
 * The sidebar (#964) is short and grouped. System management and the event
 * picker sit above it, then the daily items (Dashboard, Check-in, Registrations,
 * Payments, Emails) always visible, then the collapsible "Set up" and "Reports"
 * groups, then More last (the one item with no section). A group with no
 * visible item is left out. System management is not a nav item: the shell draws
 * it once above the picker. Attendee list, Imports, Team and Promo codes are not
 * sidebar items: More cards (and their parent pages) reach them. Club features
 * (the club directory, This event's clubs) are More launcher cards too (#741
 * slice 1).
 */
export type SidebarSection = "daily" | "setup" | "reports";

/** The sidebar's sections, in the fixed order they render (#964). */
export const sidebarSectionOrder: readonly SidebarSection[] = ["daily", "setup", "reports"];

/** `null` for the daily items: no heading, never collapsible. */
export const sidebarSectionLabels: Record<SidebarSection, string | null> = {
  daily: null,
  setup: "Set up",
  reports: "Reports",
};

/** The sections whose heading is a button that collapses and expands them (#964). */
export const collapsibleSidebarSections: readonly SidebarSection[] = ["setup", "reports"];

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  requiredPermission?: EventPermission;
  requiredAnyPermissions?: readonly EventPermission[];
  /** Hidden from a viewer who holds this permission (the kitchen counts item is for staff who do not have the event view, #1029). */
  hiddenWithPermission?: EventPermission;
  /** Hidden from a viewer who holds `has` but lacks `lacks` (kitchen staff without the event view have no dashboard, #1029). */
  hiddenWhenHoldingWithout?: { has: EventPermission; lacks: EventPermission };
  /** The sidebar section the item is listed in; an item without one is not a sidebar item (#964). */
  sidebar?: SidebarSection;
  /**
   * For a page that is not a sidebar item: the sidebar item to highlight while
   * the page is open (#964), so Attendee list lights Registrations.
   */
  sidebarParent?: string;
};

/**
 * Adds the current event to a staff link so moving between areas (dashboard,
 * System management, Clubs and churches) keeps it (#616). Replaces any
 * `event` already on the href; leaves the href alone with no event.
 */
export function withCurrentEvent(href: string, eventId: string | null | undefined): string {
  if (!eventId) return href;
  const [pathAndQuery, hash] = href.split("#");
  const [path, query = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(query);
  params.set("event", eventId);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

/**
 * One name per staff destination (#685). The nav label, the workspace header
 * title, the page's own title and its `<title>` all read the name defined here,
 * so a section can't be "People" in one place and "Registrations" in another.
 * `staffSubpageTitle` also names the `/more/*` pages that aren't nav items,
 * which the header used to call "More".
 */
export const staffPageTitles = {
  overview: "Dashboard",
  checkIn: "Check-in",
  registrationForm: "Registration forms",
  attendeeSetup: "Attendee setup",
  tags: "Tags",
  eventSettings: "Event settings",
  registrations: "Registrations",
  attendeeList: "Attendee list",
  kitchenReport: "Kitchen report",
  kitchenCounts: "Kitchen counts",
  mealCloseout: "Meal closeout",
  imports: "Imports",
  team: "Team",
  payments: "Payments",
  promoCodes: "Promo codes",
  emails: "Emails",
  more: "More",
  eventModules: "Event modules",
  eventFeatures: "Event features",
  systemManagement: "System management",
  honorsRosters: "Honors Weekend rosters",
  honorsInstructors: "Honors Weekend instructors",
  honors: "Honors Weekend classes",
  honorsSchedule: "Honors Weekend schedule board",
  clubPacket: "Club packet",
  checkInBook: "Check-in book",
  clubReports: "Club event reports",
  groupedPackets: "Grouped event packets",
  operationalReports: "Operational reports",
  clubMonthlyReport: "Club Monthly Record",
  clubMonthlyReports: "Club Monthly Records",
  clubs: "Clubs",
  club: "Club",
  clubForm: "Club form",
  clubForms: "Club forms",
  formResponses: "Form responses",
  eventHealth: "Event health information",
  clubAssignments: "Club assignments",
  teamResults: "Team results",
  teamForm: "Team form",
  eventContent: "Public content",
  eventPatches: "Event patches",
  operationalHealth: "Operational health",
  merchandise: "Merchandise catalog",
  assignmentRoster: "Assignment roster",
  programAssignments: "Seminar assignments",
  lodging: "Lodging",
  meals: "Meals",
  lodgingRequests: "Lodging requests",
  lodgingAssignments: "Lodging assignments",
  issuedAssets: "Issued assets",
  scheduledEmails: "Scheduled emails",
  ledgerCheck: "Ledger check (shadow)",
} as const;

/** Help & learning (#1077): not a nav item (the sidebar draws its own link), so it is not in `staffPageTitles`. */
export const helpPageTitle = "Help & learning";

type SubpageRule = readonly [path: string, match: "exact" | "prefix" | "under", title: string];

/**
 * Checked in order, so a longer or more specific path comes before the path it
 * sits under. `exact` is that path alone, `under` is anything below it, and
 * `prefix` is both.
 */
const subpageRules: readonly SubpageRule[] = [
  // Help & learning (#1077) is not a nav item; the sidebar draws its own link.
  ["/help/glossary", "prefix", "Glossary"],
  ["/help", "prefix", helpPageTitle],
  ["/more/honors/rosters", "prefix", staffPageTitles.honorsRosters],
  ["/more/honors/schedule", "prefix", staffPageTitles.honorsSchedule],
  ["/more/honors/instructors", "prefix", staffPageTitles.honorsInstructors],
  ["/more/honors", "prefix", staffPageTitles.honors],
  ["/more/reports/clubs/team-form", "prefix", staffPageTitles.teamForm],
  ["/more/reports/clubs/packet", "prefix", staffPageTitles.clubPacket],
  ["/more/reports/clubs/check-in-book", "prefix", staffPageTitles.checkInBook],
  ["/more/reports/clubs", "prefix", staffPageTitles.clubReports],
  ["/more/reports/packets", "prefix", staffPageTitles.groupedPackets],
  ["/more/reports", "prefix", staffPageTitles.operationalReports],
  ["/more/features", "prefix", staffPageTitles.eventFeatures],
  ["/more", "exact", staffPageTitles.eventModules],
  ["/more/clubs/reports/", "under", staffPageTitles.clubMonthlyReport],
  ["/more/clubs/reports", "exact", staffPageTitles.clubMonthlyReports],
  ["/more/clubs", "exact", staffPageTitles.clubs],
  ["/more/clubs/", "under", staffPageTitles.club],
  ["/more/club-forms/", "under", staffPageTitles.clubForm],
  ["/more/club-forms", "exact", staffPageTitles.clubForms],
  ["/information-forms/responses", "prefix", staffPageTitles.formResponses],
  ["/more/club-assignments", "prefix", staffPageTitles.clubAssignments],
  ["/more/team-results", "prefix", staffPageTitles.teamResults],
  ["/more/event-health", "prefix", staffPageTitles.eventHealth],
  ["/more/event-content", "prefix", staffPageTitles.eventContent],
  ["/more/event-patches", "prefix", staffPageTitles.eventPatches],
  ["/more/health", "prefix", staffPageTitles.operationalHealth],
  ["/more/ledger-health", "prefix", staffPageTitles.ledgerCheck],
  ["/more/kitchen-report/counts", "prefix", staffPageTitles.kitchenCounts],
  ["/more/kitchen-report/closeout", "prefix", staffPageTitles.mealCloseout],
  ["/events-admin", "exact", "Event administration"],
  ["/more/kitchen-report", "prefix", staffPageTitles.kitchenReport],
  ["/more/merchandise", "prefix", staffPageTitles.merchandise],
  ["/more/meals", "prefix", staffPageTitles.meals],
  ["/more/lodging/assignments", "prefix", staffPageTitles.lodgingAssignments],
  ["/more/lodging/requests", "prefix", staffPageTitles.lodgingRequests],
  ["/more/lodging", "prefix", staffPageTitles.lodging],
  ["/more/issued-assets", "prefix", staffPageTitles.issuedAssets],
  ["/communications/scheduled", "prefix", staffPageTitles.scheduledEmails],
  // An event's information forms (#1149) sit in the event workspace but are not a nav item: the More launcher reaches them.
  ["/information-forms", "prefix", "Information forms"],
  ["/more/program-assignments/", "under", staffPageTitles.assignmentRoster],
  ["/more/program-assignments", "exact", staffPageTitles.programAssignments],
];

/** The title a staff page shows in the workspace header, or `null` to use its nav label. */
export function staffSubpageTitle(pathname: string): string | null {
  // A /admin page names itself, not "System management" (#981).
  if (isSystemWorkspacePath(pathname)) return systemSubpageTitle(pathname);
  for (const [path, match, title] of subpageRules) {
    const isExact = pathname === path;
    const isUnder = pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
    if (match === "exact" ? isExact : match === "under" ? isUnder : isExact || isUnder) return title;
  }
  return null;
}

export const systemNavigation: NavigationItem = {
  href: "/admin",
  label: staffPageTitles.systemManagement,
  icon: ShieldCheck,
};

/** The health record import (#878) exists only while the Health Record feature is on; the shell drops its link otherwise. */
export const clubsAdminHealthImportHref = "/admin/clubs/health-import";

/** The Events Administrator's dashboard link, first in the Events view's sidebar (#1245). Its label is its page title; the page keeps its own gate. */
export const eventsAdminHomeItem: NavigationItem = { href: "/events-admin", label: "Event administration", icon: LayoutDashboard };

/** The collapsible groups of the Clubs Administrator's sidebar (#1245). */
export type ClubsNavGroupKey = "clubs-clubs" | "clubs-records" | "clubs-events" | "clubs-forms" | "clubs-applications" | "clubs-people";

export type ClubsNavGroup = { key: ClubsNavGroupKey; label: string; items: readonly NavigationItem[] };

/** The one ungrouped Clubs link, above the groups. Its label is its page title. */
export const clubsAdminHomeItem: NavigationItem = { href: "/admin/clubs", label: "Club administration", icon: LayoutDashboard };

/**
 * The Clubs Administrator's sidebar (#1225, grouped in #1245): the club areas only, with the club management pages
 * Caleb opened to the role on 2026-10-26 (#1232): invites, member transfers, club and health record imports, the honor
 * and supply catalogs and Sterling Volunteers. Labels are the pages' own titles. An item with a `#` opens a section of
 * a page that is already another item's, so it never lights. Shown when the Clubs Administrator view of the role
 * switcher is active. It is a view, not a permission: each page and route checks the role itself.
 */
export const clubsAdminGroups: readonly ClubsNavGroup[] = [
  {
    key: "clubs-clubs",
    label: "Clubs",
    items: [
      { href: "/admin/clubs/summary", label: "Club summary", icon: Tent },
      { href: "/admin/clubs/transfers", label: "Club member transfers", icon: ArrowRightLeft },
      { href: "/admin/organizations/background-checks", label: "Sterling Volunteers", icon: ShieldCheck },
      { href: "/admin/honors", label: "Honor catalog", icon: Award },
      { href: "/admin/club-supplies", label: "Club supply catalog", icon: Package },
      { href: "/admin/clubs/import", label: "Import clubs", icon: FileUp },
      { href: clubsAdminHealthImportHref, label: "Import health records", icon: HeartPulse },
    ],
  },
  {
    key: "clubs-records",
    label: "Records and points",
    items: [
      { href: "/admin/clubs/reports", label: "Club Monthly Records", icon: FileText },
      { href: "/admin/clubs/reports/year-end", label: "Club Year-End Reports", icon: Trophy },
      { href: "/admin/clubs/summary?view=points#points", label: "Points", icon: Star },
    ],
  },
  {
    key: "clubs-events",
    label: "Club events",
    items: [{ href: "/admin/clubs/summary?view=events#club-events", label: "Club events", icon: CalendarDays }],
  },
  {
    key: "clubs-forms",
    label: "Forms",
    items: [{ href: "/admin/club-forms", label: "Club forms", icon: ListChecks }],
  },
  {
    key: "clubs-applications",
    label: "Applications",
    items: [
      { href: "/admin/clubs/applications", label: "New club applications", icon: ClipboardPen },
      { href: "/admin/clubs/invites", label: "Club invites", icon: UserPlus },
    ],
  },
  {
    key: "clubs-people",
    label: "People",
    items: [
      { href: "/admin/clubs/leaders", label: "Club leaders", icon: Users },
      { href: "/admin/people", label: "People & access", icon: UsersRound },
    ],
  },
];

/**
 * The Clubs sidebar as a flat list of pages (the phone Clubs bar, which scrolls sideways, and the active-page match):
 * Club administration, then every group's pages. The `#` section links are left out, so each page is listed once.
 */
export const clubsAdminNavigation: readonly NavigationItem[] = [
  clubsAdminHomeItem,
  ...clubsAdminGroups.flatMap((group) => group.items.filter((item) => !item.href.includes("#"))),
];

/** The Clubs pages that read `?year=`; their sidebar links carry the year the viewer picked. */
export const clubsAdminYearPaths: readonly string[] = ["/admin/clubs", "/admin/clubs/summary", "/admin/clubs/reports", "/admin/clubs/reports/year-end"];

/** A Clubs sidebar href with `?year=` (before any `#`) when the page reads it and a year is chosen. */
export function clubsAdminHrefForYear(href: string, year: string | null): string {
  if (!year) return href;
  const [pathAndQuery, hash] = href.split("#");
  const [path, query] = pathAndQuery.split("?");
  if (!clubsAdminYearPaths.includes(path)) return href;
  const params = new URLSearchParams(query);
  params.set("year", year);
  return `${path}?${params}${hash ? `#${hash}` : ""}`;
}

/**
 * The Clubs sidebar item a page lights: the longest item path that is the page or a parent of it. The dashboard,
 * "/admin/clubs", is the parent of every club page, so it lights only on exactly that path. On the Club summary,
 * `summaryView` ("points" or "events") lights that view's own item, as the section tabs do.
 */
export function clubsAdminActiveHref(pathname: string, summaryView?: string | null): string | null {
  // The Club summary's Points and Events views have their own sidebar items (#1304); light the one the section tabs light.
  if (pathname === "/admin/clubs/summary") {
    const viewItem = summaryView === "points" || summaryView === "events"
      ? clubsAdminGroups.flatMap((group) => group.items).find((item) => item.href.startsWith(`/admin/clubs/summary?view=${summaryView}#`))
      : null;
    if (viewItem) return viewItem.href;
  }
  return clubsAdminNavigation.reduce<string | null>((best, item) => (
    (pathname === item.href || (item.href !== "/admin/clubs" && pathname.startsWith(`${item.href}/`))) && (!best || item.href.length > best.length) ? item.href : best
  ), null);
}

export const navigation: readonly NavigationItem[] = [
  // The dashboard page needs the event view permission; kitchen staff (#1029) hold only the kitchen counts one and see no dashboard item.
  { href: "/overview", label: staffPageTitles.overview, icon: LayoutDashboard, hiddenWhenHoldingWithout: { has: "MANAGE_KITCHEN_COUNTS", lacks: "VIEW_EVENT" }, sidebar: "daily" },
  // Kitchen staff's one page (#1029). Staff who also have the event view reach it from the kitchen report instead.
  { href: kitchenCountsPath, label: staffPageTitles.kitchenCounts, icon: UtensilsCrossed, requiredPermission: "MANAGE_KITCHEN_COUNTS", hiddenWithPermission: "VIEW_EVENT", sidebar: "daily" },
  { href: "/check-in", label: staffPageTitles.checkIn, icon: CheckCircle2, requiredPermission: "MANAGE_CHECK_IN", sidebar: "daily" },
  { href: "/people", label: staffPageTitles.registrations, icon: UsersRound, requiredPermission: "VIEW_SENSITIVE_DATA", sidebar: "daily" },
  { href: "/finance", label: staffPageTitles.payments, icon: WalletCards, requiredPermission: "MANAGE_FINANCE", sidebar: "daily" },
  { href: "/communications", label: staffPageTitles.emails, icon: Megaphone, requiredPermission: "MANAGE_COMMUNICATIONS", sidebar: "daily" },
  { href: "/more/event-settings", label: staffPageTitles.eventSettings, icon: Settings2, requiredPermission: "CONFIGURE_EVENT", sidebar: "setup" },
  { href: "/registration-builder", label: staffPageTitles.registrationForm, icon: PanelsTopLeft, requiredPermission: "MANAGE_FORMS", sidebar: "setup" },
  { href: "/more/attendee-configuration", label: staffPageTitles.attendeeSetup, icon: Tags, requiredPermission: "CONFIGURE_EVENT", sidebar: "setup" },
  { href: "/more/tags", label: staffPageTitles.tags, icon: Tag, requiredPermission: "CONFIGURE_EVENT", sidebar: "setup" },
  { href: "/more/reports", label: staffPageTitles.operationalReports, icon: ChartNoAxesCombined, requiredPermission: "VIEW_REPORTS", sidebar: "reports" },
  { href: "/more/health", label: staffPageTitles.operationalHealth, icon: HeartPulse, requiredAnyPermissions: operationalHealthEntryPermissions, sidebar: "reports" },
  // Not sidebar items (#964): More cards and parent-page links reach them, and the parent lights up while one is open.
  { href: "/people/attendees", label: staffPageTitles.attendeeList, icon: ListChecks, requiredPermission: "VIEW_SENSITIVE_DATA", sidebarParent: "/people" },
  { href: "/imports", label: staffPageTitles.imports, icon: FileUp, requiredPermission: "MANAGE_IMPORTS", sidebarParent: "/people" },
  { href: "/staff", label: staffPageTitles.team, icon: UserCog, requiredPermission: "MANAGE_STAFF", sidebarParent: "/more" },
  { href: "/more/promo-codes", label: staffPageTitles.promoCodes, icon: TicketPercent, requiredPermission: "MANAGE_FINANCE", sidebarParent: "/finance" },
  {
    href: "/more",
    label: staffPageTitles.more,
    icon: MoreHorizontal,
    requiredAnyPermissions: [
      "VIEW_REPORTS",
      "MANAGE_STAFF",
      "MANAGE_FINANCE",
      ...operationalHealthEntryPermissions,
    ],
  },
];

/**
 * The "Event features" page (#965) is a Set up item, shown for CONFIGURE_EVENT. It is
 * a sidebar-only item (not in `navigation`, so it is no phone tab and no More card).
 */
export const eventFeaturesRoute = "/more/features";

export const eventFeaturesItem: NavigationItem = {
  href: eventFeaturesRoute,
  label: "Event features",
  icon: ToggleRight,
  requiredPermission: "CONFIGURE_EVENT",
  sidebar: "setup",
};

/** Whether the page is the Event features page or below it, which lights that item (and not More). */
export function isEventFeaturesPath(pathname: string): boolean {
  return pathname === eventFeaturesRoute || pathname.startsWith(`${eventFeaturesRoute}/`);
}

/** Sidebar-only items that are not in `navigation` (its hrefs are page lookups), placed after the item with this href. */
const sidebarInserts: readonly { after: string; item: NavigationItem }[] = [
  { after: "/more/event-settings", item: eventFeaturesItem },
];

export type SidebarSectionView = {
  section: SidebarSection;
  label: string | null;
  collapsible: boolean;
  items: NavigationItem[];
};

/**
 * The sidebar as sections, each with the items this viewer may see (#964); a
 * section with none is left out. More is not here: it is always last, drawn
 * after the sections (see `orderedSidebarItems`).
 */
export function sidebarSections(selectedPermissions: ReadonlySet<EventPermission>): SidebarSectionView[] {
  return sidebarSectionOrder
    .map((section) => ({
      section,
      label: sidebarSectionLabels[section],
      collapsible: collapsibleSidebarSections.includes(section),
      items: navigation
        .flatMap((item) => [item, ...sidebarInserts.filter((insert) => insert.after === item.href).map((insert) => insert.item)])
        .filter((item) => item.sidebar === section && matchesVisibility(item, selectedPermissions)),
    }))
    .filter((view) => view.items.length > 0);
}

/**
 * The sidebar's visible items in their fixed order, as a flat list: the sections'
 * items, then More last. (The shell draws from `sidebarSections`; the phone tabs
 * read this list.) `showMore` is the launcher rule (`canShowMoreLauncher`), which
 * can admit More when no single permission does.
 */
export function orderedSidebarItems(
  selectedPermissions: ReadonlySet<EventPermission>,
  showMore: boolean,
): NavigationItem[] {
  const more = navigation.filter((item) => item.href === "/more" && showMore);
  // Without the sidebar-only inserts: Event features is a sidebar item only, never a phone tab (#965).
  const inserted = new Set(sidebarInserts.map((insert) => insert.item));
  return [
    ...sidebarSections(selectedPermissions).flatMap((view) => view.items.filter((item) => !inserted.has(item))),
    ...more,
  ];
}

/**
 * The sidebar item a page lights (#964): the page's own item, or for a page that
 * is no sidebar item its parent, or More when the viewer can't see that parent
 * (Imports without Registrations access).
 */
export function sidebarActiveHref(
  current: Pick<NavigationItem, "href" | "sidebarParent">,
  visibleHrefs: ReadonlySet<string>,
): string {
  if (!current.sidebarParent) return current.href;
  return visibleHrefs.has(current.sidebarParent) ? current.sidebarParent : "/more";
}

/**
 * The phone tabs, in `mobileNavigationOrder`, for the items visible to this
 * viewer. "People" is the Registrations page (`/people`): on a phone it is the
 * attendee list staff look people up in, while Team stays a desktop task reached
 * from More. A tab the viewer may not open is dropped, never shown disabled.
 */
export function orderedMobileTabs(visibleItems: readonly NavigationItem[]): NavigationItem[] {
  return mobileNavigationOrder
    .map((href) => visibleItems.find((item) => item.href === href))
    .filter((item): item is NavigationItem => Boolean(item));
}

export function matchesVisibility(
  item: Pick<NavigationItem, "requiredPermission" | "requiredAnyPermissions"> & Pick<NavigationItem, "hiddenWithPermission" | "hiddenWhenHoldingWithout">,
  selectedPermissions: ReadonlySet<EventPermission>,
) {
  if (item.hiddenWithPermission && selectedPermissions.has(item.hiddenWithPermission)) return false;
  const hold = item.hiddenWhenHoldingWithout;
  if (hold && selectedPermissions.has(hold.has) && !selectedPermissions.has(hold.lacks)) return false;
  if (item.requiredPermission && !selectedPermissions.has(item.requiredPermission)) return false;
  if (
    item.requiredAnyPermissions
    && !item.requiredAnyPermissions.some((permission) => selectedPermissions.has(permission))
  ) return false;
  return true;
}

/**
 * A sidebar destination's required permission, looked up by its `href`
 * (without a query string). Lets the phone "More" directory reuse the exact
 * permission the desktop sidebar already requires for the same page,
 * instead of naming it a second time (#475).
 */
export function requiredPermissionFor(href: string): EventPermission | undefined {
  return navigation.find((item) => item.href === href)?.requiredPermission;
}

/**
 * The phone tab bar (#711): five tabs, so each gets an equal, readable share of
 * a 360px screen. Payments (#890) is a sixth tab, drawn only for staff whose
 * `MANAGE_FINANCE` permission makes the item visible, so everyone else still
 * sees five. At check-in a balance or adjustment is a tap away instead of two.
 * Payments therefore has no More card (it would duplicate the tab); Promo codes
 * stay in More, so finance staff still have a More tab.
 */
export const mobileNavigationOrder = [
  "/overview",
  kitchenCountsPath,
  "/people",
  "/check-in",
  "/finance",
  "/communications",
  "/more",
] as const;

/** Staff pages with no sidebar item, opened from a More card (`/community`). */
const moreOnlyPaths = ["/community"] as const;

/**
 * The phone tab to highlight for the sidebar item a page belongs to (#737).
 * Pages the tab bar has no tab for (Settings and its children, the form
 * builder, Tags, Promo codes, Club export/print/year-end pages, ...) are all
 * reached from More, so More stays highlighted instead of no tab. Only existing
 * tabs are used; none is added, renamed or reordered.
 */
export function mobileActiveTabHref(currentHref: string, pathname?: string): string {
  // Pages reached only from a More card, with no sidebar item of their own.
  if (pathname && moreOnlyPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return "/more";
  if ((mobileNavigationOrder as readonly string[]).includes(currentHref)) return currentHref;
  return "/more";
}

/**
 * Short labels for the phone tab bar only (#711). The sidebar keeps the full
 * `label`; a tab not listed here falls back to its full label.
 */
export const mobileNavigationLabels: Readonly<Record<string, string>> = {
  "/overview": "Home",
  [kitchenCountsPath]: "Kitchen",
  "/people": "People",
  "/check-in": "Check-in",
  // Short so six equal tabs fit at 360px; the tab carries aria-label/title "Payments".
  "/finance": "Pay",
  "/communications": "Emails",
  "/more": "More",
};

/**
 * "Clubs and churches" is a club feature, so it shows only when the selected
 * event has a CLUB audience (#481) — that is, when `clubOversight` (from
 * `resolveClubOversight`, true only for a system admin or an EVENT_ADMIN on a
 * CLUB-audience event) is true, exactly as `more/page.tsx` gates it. A GENERAL
 * event never shows it, even for a system admin, who still reaches the
 * churches-and-clubs directory from System management. The href differs by
 * role: system admins get the full directory, event admins the event's club
 * oversight page. Both the sidebar and the phone "More" directory call this
 * so the two destinations can't drift (#475).
 */
export function resolveClubsAndChurchesEntry({
  clubOversight,
  isSystemAdmin,
}: {
  clubOversight: boolean;
  isSystemAdmin: boolean;
}): { href: string; visible: boolean } {
  return {
    href: isSystemAdmin ? "/admin/organizations" : "/more/clubs",
    visible: clubOversight,
  };
}

/**
 * Whether to show the More launcher (the sidebar link and the phone tab). It
 * follows the destinations the user may actually open (#737): the permissions
 * the launcher has always admitted, or any More directory card that is allowed
 * for this user and event. So staff whose only extra grant is
 * `VIEW_HEALTH_INFORMATION` on a club event still find "Event health
 * information". Only visibility: every destination keeps its own server check.
 */
export function canShowMoreLauncher({
  item,
  ...context
}: Omit<MoreDirectoryContext, "eventQuery"> & { item: Pick<NavigationItem, "requiredPermission" | "requiredAnyPermissions"> }): boolean {
  if (matchesVisibility(item, new Set(context.permissions))) return true;
  return buildMoreDirectoryCards({ ...context, eventQuery: "" }).some((card) => card.allowed);
}

/**
 * The phone "More" directory (#475): every staff destination that isn't one
 * of the phone bottom tabs (Payments is one of them for finance staff), grouped the way the mobile review asked for
 * (Event tools, People & clubs, Sales & content, Reports) — a different grouping
 * from the sidebar's, matched to how staff described the tasks they look
 * for on a phone. `buildMoreDirectoryCards` is a pure function of the
 * signed-in user's access, kept in this shared module (rather than inline
 * in `app/(workspace)/more/page.tsx`) so both the page and
 * `tests/mobile-directory-parity.test.ts` can build the same list without
 * duplicating a card's visibility rule. Two cards reuse the sidebar's own
 * required permission via `requiredPermissionFor` instead of naming it a
 * second time. On a CLUB-audience event (#481), "Clubs and churches" shows
 * the directory for system admins and the event's club oversight page for
 * anyone with club oversight (a system admin on a CLUB event sees both); on a
 * GENERAL event neither shows, for any role. The parity test checks
 * both against `resolveClubsAndChurchesEntry` and `/more/clubs`'s own guard.
 */
export type MoreDirectoryGroup = "setup" | "content-sales" | "people-access" | "reports";

export const moreDirectoryGroupOrder: readonly MoreDirectoryGroup[] = [
  "setup",
  "content-sales",
  "people-access",
  "reports",
];

export const moreDirectoryGroupLabels: Record<MoreDirectoryGroup, string> = {
  setup: "Event tools",
  "content-sales": "Sales & content",
  "people-access": "People & clubs",
  reports: "Reports",
};

export type MoreDirectoryCard = {
  key: string;
  group: MoreDirectoryGroup;
  allowed: boolean;
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  cta: string;
};

export type MoreDirectoryContext = {
  permissions: readonly EventPermission[];
  /** From `resolveClubOversight` (`modules/club-rosters/event-oversight.ts`), the same call `more/page.tsx` already made. */
  clubOversight: boolean;
  /** Whether the selected event has a CLUB audience (#481), from the same `resolveClubOversight` result. */
  clubEvent: boolean;
  isSystemAdmin: boolean;
  /**
   * Club forms (#610) belong to no event: only system administrators and Event
   * Admins of a current event may open them (`resolveStaffViewer`), so the card
   * follows that rule rather than any event permission.
   */
  clubFormsAccess: boolean;
  /** `?event=<id>` (or `""` when nothing is selected), appended to every event-scoped href. */
  eventQuery: string;
  /**
   * Entry points hidden for this event by the module rules (#741): the Honors
   * Weekend builder and Club forms where neither the module nor the event type
   * calls for them. Relevance only; the routes keep their own authorization.
   */
  hiddenCardKeys?: ReadonlySet<string>;
};

export function buildMoreDirectoryCards({
  permissions,
  clubOversight,
  clubEvent,
  isSystemAdmin,
  clubFormsAccess,
  eventQuery,
  hiddenCardKeys,
}: MoreDirectoryContext): readonly MoreDirectoryCard[] {
  const granted = new Set(permissions);
  const has = (permission: EventPermission) => granted.has(permission);
  const attendeeConfigurationPermission = requiredPermissionFor("/more/attendee-configuration");
  const tagsPermission = requiredPermissionFor("/more/tags");

  const cards: MoreDirectoryCard[] = [
    { key: "event-settings", group: "setup", allowed: has("CONFIGURE_EVENT"), href: `/more/event-settings${eventQuery}`, icon: Settings2, title: "Event settings", description: "Edit dates, location, capacity, registration availability, and publishing.", cta: "Open settings" },
    { key: "attendee-configuration", group: "setup", allowed: Boolean(attendeeConfigurationPermission && has(attendeeConfigurationPermission)), href: `/more/attendee-configuration${eventQuery}`, icon: Tags, title: "Attendee setup", description: "Define the attendee types and per-type pricing this event registers.", cta: "Open attendee setup" },
    { key: "tags", group: "setup", allowed: Boolean(tagsPermission && has(tagsPermission)), href: `/more/tags${eventQuery}`, icon: Tag, title: "Tags", description: "Create and color-code the tags staff use to mark and filter registrations.", cta: "Manage tags" },
    { key: "honors", group: "setup", allowed: has("CONFIGURE_EVENT"), href: `/more/honors${eventQuery}`, icon: Award, title: "Honors Weekend classes", description: "Name this site's sessions and set the honor classes, seats, and age limits it offers.", cta: "Set up classes" },
    { key: "meals", group: "content-sales", allowed: has("CONFIGURE_EVENT") || has("MANAGE_FINANCE") || has("VIEW_REPORTS"), href: `/more/meals${eventQuery}`, icon: UtensilsCrossed, title: "Meals", description: "Set up meal services, plans and prices, take walk-up orders, and download meal tickets for the café scanner.", cta: "Open meals" },
    { key: "lodging", group: "setup", allowed: has("CONFIGURE_EVENT"), href: `/more/lodging${eventQuery}`, icon: BedDouble, title: "Lodging", description: "See rooms, beds and sites night by night, set capacity, mark units unavailable, and place holds.", cta: "Open lodging" },
    { key: "issued-assets", group: "setup", allowed: has("CONFIGURE_EVENT"), href: `/more/issued-assets${eventQuery}`, icon: KeyRound, title: "Issued assets", description: "Set up keys, keycards, wristbands and welcome packets, add numbered ranges like K-201 to K-260, and see what is in stock.", cta: "Set up assets" },
    { key: "registration-builder", group: "setup", allowed: has("MANAGE_FORMS"), href: `/registration-builder${eventQuery}`, icon: PanelsTopLeft, title: "Registration forms", description: "Build, test, and publish the form people use to register.", cta: "Open form builder" },
    { key: "information-forms", group: "setup", allowed: has("MANAGE_FORMS"), href: `/information-forms${eventQuery}`, icon: ClipboardPen, title: "Information forms", description: "Build surveys and interest forms that gather answers only, with no registration or payment.", cta: "Open information forms" },
    { key: "program-assignments", group: "setup", allowed: canManageProgramAssignments(permissions), href: `/more/program-assignments${eventQuery}`, icon: ListChecks, title: "Seminar assignments", description: "Turn attendee rankings and room limits into reviewed, printable session rosters.", cta: "Preview assignments" },
    { key: "event-content", group: "content-sales", allowed: has("CONFIGURE_EVENT"), href: `/more/event-content${eventQuery}`, icon: FileText, title: "Public content", description: "Speaker bios, seminar descriptions, lodging, schedules, and downloads shown publicly.", cta: "Edit page" },
    { key: "merchandise", group: "content-sales", allowed: has("CONFIGURE_EVENT"), href: `/more/merchandise${eventQuery}`, icon: ShoppingBag, title: "Merchandise", description: "Add products, set artwork and pricing, and control what's available at registration.", cta: "Open merchandise" },
    { key: "promo-codes", group: "content-sales", allowed: has("MANAGE_FINANCE"), href: `/more/promo-codes${eventQuery}`, icon: TicketPercent, title: "Promo codes", description: "Create bounded registration discounts, schedule dates, and review use limits.", cta: "Manage discounts" },
    { key: "community", group: "content-sales", allowed: has("MANAGE_COMMUNICATIONS"), href: `/community${eventQuery}`, icon: MessagesSquare, title: "Attendee community", description: "Open or pause discussion, review attendee reports, and moderate posts and replies.", cta: "Moderate community" },
    { key: "staff", group: "people-access", allowed: has("MANAGE_STAFF"), href: `/staff${eventQuery}`, icon: UserCog, title: "Staff", description: "Add staff and choose what each person can do for this event.", cta: "Manage team" },
    // On a CLUB-audience event (#481), system admins reach the
    // churches-and-clubs directory (the sidebar's "Clubs and churches" link
    // for them); on a GENERAL event it stays in System management only...
    {
      key: "clubs-and-churches",
      group: "people-access",
      allowed: isSystemAdmin && clubOversight,
      href: "/admin/organizations",
      icon: UsersRound,
      title: "Clubs and churches",
      description: "The full churches-and-clubs directory: every organization, its directors, and its registrations.",
      cta: "Open directory",
    },
    // ...and anyone with club oversight of this CLUB-audience event — system
    // admins included — keeps the event's own club rosters and monthly
    // reports, gated exactly as on main and by `/more/clubs` itself.
    {
      key: "clubs",
      group: "people-access",
      allowed: clubOversight,
      href: `/more/clubs${eventQuery}`,
      icon: UsersRound,
      title: isSystemAdmin ? "This event's clubs" : "Clubs and churches",
      description: "Every registered club's roster (ages only) and all clubs' Monthly Records, view only.",
      cta: "Open clubs",
    },
    { key: "club-assignments", group: "people-access", allowed: clubEvent && canManageClubAssignments(permissions), href: `/more/club-assignments${eventQuery}`, icon: Tent, title: "Club assignments", description: "Set each registered club's campsite, duty, and activity, then email directors after review.", cta: "Assign clubs" },
    { key: "event-patches", group: "setup", allowed: clubEvent && has("CONFIGURE_EVENT"), href: `/more/event-patches${eventQuery}`, icon: Trophy, title: "Event patches", description: "Link the patch or pin a club event gives, so directors are suggested it for every member who attended.", cta: "Link patches" },
    // Club forms (#610) belong to no event: system administrators, Clubs Administrators and Event Admins of a current event only.
    { key: "club-forms", group: "people-access", allowed: clubFormsAccess, href: `/more/club-forms${eventQuery}`, icon: FileText, title: "Club forms", description: "Membership applications, staff service forms, permission slips, and passenger lists clubs have filled in.", cta: "Open club forms" },
    // Health information for club events (#658): system administrators, plus staff a system administrator gave VIEW_HEALTH_INFORMATION. No role carries it.
    { key: "event-health", group: "people-access", allowed: clubEvent && has("VIEW_HEALTH_INFORMATION"), href: `/more/event-health${eventQuery}`, icon: HeartPulse, title: "Event health information", description: "Dietary notes as entered, the medical-need flag, and emergency contacts for this club event, with a printable confidential sheet.", cta: "Open health information" },
    { key: "lodging-assignments", group: "people-access", allowed: has("MANAGE_REGISTRATION"), href: `/more/lodging/assignments${eventQuery}`, icon: BedDouble, title: "Lodging assignments", description: "Place guests in rooms and sites, move them, run the lodging waitlist, and print rooming lists and occupancy by night.", cta: "Assign lodging" },
    { key: "lodging-requests", group: "people-access", allowed: has("MANAGE_REGISTRATION"), href: `/more/lodging/requests${eventQuery}`, icon: BedDouble, title: "Lodging requests", description: "Review what guests asked for, roommate requests, keep-together rules and the review queue. Nobody is assigned here.", cta: "Review requests" },
    { key: "attendee-list", group: "people-access", allowed: has("VIEW_SENSITIVE_DATA"), href: `/people/attendees${eventQuery}`, icon: ListChecks, title: "Attendee list", description: "One row per attendee with meal, dietary, childcare and volunteer answers, filters, and a CSV download.", cta: "Open attendee list" },
    { key: "imports", group: "people-access", allowed: has("MANAGE_IMPORTS"), href: `/imports${eventQuery}`, icon: FileUp, title: "Import registrations", description: "Preview a CSV, review every change, then import approved records.", cta: "Open imports" },
    { key: "reports", group: "reports", allowed: has("VIEW_REPORTS"), href: `/more/reports${eventQuery}`, icon: ChartNoAxesCombined, title: "Operational reports", description: "Print active attendee rosters and review meal, housing, and ranked seminar totals.", cta: "Open reports" },
    { key: "health", group: "reports", allowed: canAccessOperationalHealth(permissions), href: `/more/health${eventQuery}`, icon: HeartPulse, title: "Operational health", description: "Review failed or delayed work, open balances, import exceptions, and capacity warnings.", cta: "Review exceptions" },
  ];
  if (!hiddenCardKeys || hiddenCardKeys.size === 0) return cards;
  return cards.map((card) => (hiddenCardKeys.has(card.key) ? { ...card, allowed: false } : card));
}
