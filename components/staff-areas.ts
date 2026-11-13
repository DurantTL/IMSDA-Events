import type { LucideIcon } from "lucide-react";
import { BarChart3, CalendarDays, Home, ShieldCheck, Tent, UsersRound } from "lucide-react";
import {
  clubsAdminGroups,
  clubsAdminHealthImportHref,
  clubsAdminHomeItem,
  clubsAdminHrefForYear,
  eventsAdminHomeItem,
} from "@/components/staff-navigation";
import { adminHubs, clubsAdminRecordsHref, systemNavGroups } from "@/components/system-navigation";
import { type AdminRole, type AdminRoleCounts } from "@/modules/access/admin-roles-domain";
import { maxTabsPerRow, maxViewsPerTab } from "@/components/staff-event-tabs";
import { RECORDS_VIEW_PATH } from "@/modules/club-reports/record-return-domain";
import { needsYouTabCount } from "@/modules/system-admin/home-needs-model";

/**
 * The six staff areas of the icon rail and each area's one row of tabs (#1565), built from the existing registries
 * (`systemNavGroups`, `clubsAdminGroups`, `eventsAdminHomeItem`): labels and routes are looked up there, never written a
 * second time, so a renamed or removed page fails a test instead of leaving a dead tab. Nothing here grants access:
 * it decides which links to draw for a viewer, and every page keeps its own server check.
 *
 * "Where you are" is exactly one rail item and one tab (`staffPlaceFor`). A page two tabs list is the same page; the
 * area that owns it for the current marking is named in `owns`, so there is never a second current item.
 */
export type StaffArea = "home" | "events" | "clubs" | "people" | "reports" | "admin";

export const staffAreaOrder: readonly StaffArea[] = ["home", "events", "clubs", "people", "reports", "admin"];

export const staffAreaMeta: Record<StaffArea, { label: string; icon: LucideIcon; menuLabel: string }> = {
  home: { label: "Home", icon: Home, menuLabel: "Home menu" },
  events: { label: "Events", icon: CalendarDays, menuLabel: "Events menu" },
  clubs: { label: "Clubs", icon: Tent, menuLabel: "Clubs menu" },
  people: { label: "People", icon: UsersRound, menuLabel: "People menu" },
  reports: { label: "Reports", icon: BarChart3, menuLabel: "Reports menu" },
  admin: { label: "Admin", icon: ShieldCheck, menuLabel: "Admin menu" },
};

/** What a viewer holds, from the server: the admin roles, whether they have events, and the flags the pages already use. */
export type StaffAreaViewer = {
  isSystemAdmin: boolean;
  /** `heldAdminRoles`: Events (an EVENT_ADMIN membership), Clubs (a grant, or a system administrator), System. */
  held: readonly AdminRole[];
  /** The role whose landing page "Needs you" opens (the broadest held when none was chosen). */
  activeRole: AdminRole | null;
  hasEvents: boolean;
  siteContentEditor: boolean;
  /** An active Youth Admin who is not a system administrator (#1685): adds the Youth directory to the Clubs area. Showing it grants nothing; the page checks the role. */
  youthDirectory?: boolean;
  /** The health record import exists only while the Health Record feature is on (#1232). */
  healthImport: boolean;
  /** `?year=` the viewer picked, carried by the club pages that read it. */
  clubYear: string | null;
  counts: AdminRoleCounts;
};

export type AreaView = { key: string; label: string; href: string; current?: boolean };

export type AreaTab = {
  key: string;
  label: string;
  href: string;
  /** Needs-you style count (the waiting new club applications, the work waiting in the role). Nothing when zero or unknown. */
  count?: number;
  /** Views of the tab: a button strip, at most five. */
  views?: AreaView[];
  current?: boolean;
};

type Registered = { href: string; label: string };

/** Home's two pages (#1568): the one place their names are written; the tabs, the pages and the tests look them up here. */
export const homeDestinations = {
  needsYou: { href: "/home", label: "Needs you" },
  comingUp: { href: "/home/coming-up", label: "Coming up" },
} as const;

const reviewMonthlyRecordsHref = "/admin/clubs/reports";
const clubPointsHref = "/admin/clubs/summary?view=points#points";
const clubYearEndHref = "/admin/clubs/reports/year-end";

const registered: readonly Registered[] = [
  ...systemNavGroups.flatMap((group) => group.items.map(({ href, label }) => ({ href, label }))),
  ...clubsAdminGroups.flatMap((group) => group.items.map(({ href, label }) => ({ href, label }))),
  { href: clubsAdminHomeItem.href, label: clubsAdminHomeItem.label },
  { href: eventsAdminHomeItem.href, label: eventsAdminHomeItem.label },
  { href: "/admin", label: "System administration" },
  // The review queue of the Monthly records tab (#1588): a view of that tab, named as the queue it is.
  { href: reviewMonthlyRecordsHref, label: "Review monthly records" },
  ...Object.values(homeDestinations),
  ...Object.values(adminHubs).map(({ href, label }) => ({ href, label })),
];

/** A destination from the registries; throws when one was renamed or removed so a tab can never point nowhere. */
export function registeredDestination(href: string): Registered {
  const found = registered.find((item) => item.href === href);
  if (!found) throw new Error(`No registered staff destination ${href}.`);
  return found;
}

type Gate = (viewer: StaffAreaViewer) => boolean;
const sys: Gate = (v) => v.isSystemAdmin;
const clubs: Gate = (v) => v.held.includes("CLUBS_ADMIN");
const events: Gate = (v) => v.held.includes("EVENTS_ADMIN");
const eitherClubsOrSys: Gate = (v) => v.isSystemAdmin || v.held.includes("CLUBS_ADMIN");

type ViewSpec = { href: string; label?: string; visible: Gate };
type TabSpec = {
  key: string;
  /** The registered destination the tab opens, unless `href` says otherwise. */
  destination?: string;
  label?: string;
  href?: (viewer: StaffAreaViewer) => string;
  visible: Gate;
  views?: readonly ViewSpec[];
  count?: (viewer: StaffAreaViewer) => number | undefined;
};

const waitingClubApplications = (v: StaffAreaViewer) => v.counts.CLUBS_ADMIN;

/**
 * The tab rows. Registry destinations are named by href; a tab whose page does not exist yet is not here (#1559: menus never
 * list planned work).
 */
export const areaTabSpecs: Record<StaffArea, readonly TabSpec[]> = {
  // Home (#1568): the work waiting for this person, then the events coming up. Every staff viewer has both; each page reads
  // only what the viewer may already see. The badge is the held roles' counts the shell read, only when every one was read.
  home: [
    { key: "needs-you", destination: homeDestinations.needsYou.href, visible: () => true, count: (v) => needsYouTabCount(v.held, v.counts) },
    { key: "coming-up", destination: homeDestinations.comingUp.href, visible: () => true },
  ],
  events: [
    // All events (#1570): every current event, for System Administrators. An Event Administrator's own events are Event administration.
    { key: "all-events", destination: "/admin/events", visible: sys },
    { key: "event-administration", destination: eventsAdminHomeItem.href, visible: events },
    { key: "calendar", destination: "/admin/calendar", visible: sys },
    { key: "create", destination: "/event-setup", visible: sys },
    { key: "copy", destination: "/event-setup/copy", visible: sys },
    { key: "templates", destination: "/admin/event-templates", visible: sys },
    // Staff with only event tabs reach Archived events from the event bar; the tab is for the roles that manage events.
    { key: "archived", destination: "/archived-events", visible: (v) => v.isSystemAdmin || v.held.includes("EVENTS_ADMIN") },
  ],
  clubs: [
    {
      key: "club-administration",
      destination: clubsAdminHomeItem.href,
      visible: clubs,
      // Pages the Clubs Administrator's sidebar listed that no tab owns: Sterling Volunteers. The club imports belong to the Club directory (#1589).
      views: [
        { href: clubsAdminHomeItem.href, label: "Overview", visible: clubs },
        { href: "/admin/organizations/background-checks", visible: clubs },
      ],
    },
    {
      key: "club-summary",
      destination: "/admin/clubs/summary",
      visible: clubs,
      views: [
        { href: "/admin/clubs/summary", label: "All clubs", visible: clubs },
        { href: "/admin/clubs/summary?view=events#club-events", visible: clubs },
        // The club imports are tasks of the directory: preview, review, then results (#1589).
        { href: "/admin/clubs/import", visible: clubs },
        { href: clubsAdminHealthImportHref, visible: (v) => clubs(v) && v.healthImport },
      ],
    },
    { key: "clubs-and-churches", destination: "/admin/organizations", visible: sys },
    {
      key: "applications",
      destination: "/admin/clubs/applications",
      visible: clubs,
      count: waitingClubApplications,
      views: [
        { href: "/admin/clubs/applications", label: "Applications", visible: clubs },
      ],
    },
    { key: "leaders", destination: "/admin/clubs/leaders", visible: clubs },
    // A system administrator reaches the Youth directory from the Clubs hub and Find a page; a Youth Admin has no other Clubs tab.
    { key: "youth-directory", destination: "/admin/youth", visible: (v) => Boolean(v.youthDirectory) && !v.isSystemAdmin },
    { key: "transfers", destination: "/admin/clubs/transfers", visible: clubs },
    {
      key: "monthly-records",
      destination: clubsAdminRecordsHref,
      visible: clubs,
      // Each view is a page that checks Clubs administration itself, so each is gated the same way (#1588).
      views: [
        { href: clubsAdminRecordsHref, label: "Monthly Records", visible: clubs },
        // Year-end second (#1841): at 390px the four views then sit in two rows before and after the web font swaps in, so
        // the page does not jump on load.
        { href: clubYearEndHref, visible: clubs },
        { href: reviewMonthlyRecordsHref, label: "Review monthly records", visible: clubs },
        { href: clubPointsHref, label: "Points", visible: clubs },
      ],
    },
  ],
  people: [
    { key: "people-access", destination: "/admin/people", visible: eitherClubsOrSys },
    { key: "break-glass", destination: "/admin/health-access", visible: sys },
  ],
  // Whole-system reports only (#1841), for System Administrators. Club reports (records, year-end, points) are views of
  // Clubs -> Monthly records.
  reports: [
    { key: "system-report", destination: "/admin/system-report", visible: sys },
    { key: "analytics", destination: "/admin/analytics", visible: sys },
  ],
  admin: [
    { key: "system-administration", destination: "/admin", visible: sys },
    // Each hub tab opens its hub page (#1569): the hub lists every destination of its group as a card, so no view strip is needed.
    { key: "hub-events", destination: adminHubs.events.href, visible: sys },
    { key: "hub-clubs", destination: adminHubs.clubs.href, visible: sys },
    { key: "hub-people", destination: adminHubs.people.href, visible: sys },
    { key: "hub-forms", destination: adminHubs.forms.href, visible: eitherClubsOrSys },
    // A site content editor who is not a Clubs or System administrator opens the site content page itself (#1735): it is the
    // one admin page they may open with no event, and the only card the Catalogs hub shows them.
    { key: "hub-catalogs", destination: adminHubs.catalogs.href, href: (v) => (eitherClubsOrSys(v) ? adminHubs.catalogs.href : "/admin/site-content"), visible: (v) => eitherClubsOrSys(v) || v.siteContentEditor },
  ],
};

/**
 * The Clubs area's links keep the club year the viewer picked, on every page of the area: the pages that do not read `?year=`
 * ignore it, and carrying it means a tab that passes through one (Applications, Leaders) cannot quietly turn the year back
 * into the current one (#1566). With no year chosen the link is unchanged.
 */
export function withClubYear(href: string, year: string | null): string {
  if (!year) return href;
  const [pathAndQuery, hash] = href.split("#");
  const [path, query] = pathAndQuery.split("?");
  const params = new URLSearchParams(query);
  params.set("year", year);
  return `${path}?${params}${hash ? `#${hash}` : ""}`;
}

function withYear(href: string, viewer: StaffAreaViewer) {
  return clubsAdminHrefForYear(href, viewer.clubYear);
}

function resolveViews(views: readonly ViewSpec[] | undefined, viewer: StaffAreaViewer, area: StaffArea): AreaView[] {
  const list = (views ?? [])
    .filter((view) => view.visible(viewer))
    .map((view) => {
      const found = registeredDestination(view.href);
      return { key: view.href, label: view.label ?? found.label, href: area === "clubs" ? withYear(view.href, viewer) : view.href };
    });
  // A strip of one is no strip: the tab opens that page itself.
  return list.length > 1 ? list.slice(0, maxViewsPerTab) : [];
}

/** The tab row of one area for this viewer, in order, with nothing the viewer cannot reach. */
export function areaTabs(area: StaffArea, viewer: StaffAreaViewer): AreaTab[] {
  return areaTabSpecs[area]
    .filter((spec) => spec.visible(viewer))
    .map((spec) => {
      const baseHref = spec.href ? spec.href(viewer) : registeredDestination(spec.destination!).href;
      const label = spec.label ?? (spec.destination ? registeredDestination(spec.destination).label : spec.key);
      const count = spec.count?.(viewer);
      return {
        key: spec.key,
        label,
        href: area === "clubs" ? withYear(baseHref, viewer) : baseHref,
        ...(count && count > 0 ? { count } : {}),
        views: resolveViews(spec.views, viewer, area),
      };
    })
    .slice(0, maxTabsPerRow);
}

/** Whether a tab is a page its own area owns for the "where you are" marking (a tab that opens another area's page is not). */
export function tabIsOwned(area: StaffArea, tab: Pick<AreaTab, "key" | "href">): boolean {
  const url = new URL(tab.href, "https://events.example.test");
  const place = staffPlaceFor(url.pathname, url.searchParams);
  return place.area === area && !place.inEvent && place.tab === tab.key;
}

/** The tabs of an area that the area owns, so the rail item that opens it is the one that lights there. */
function ownedTabs(area: StaffArea, viewer: StaffAreaViewer): AreaTab[] {
  return areaTabs(area, viewer).filter((tab) => tabIsOwned(area, tab));
}

/**
 * The rail: an area shows when at least one of its tabs is a page it owns. Home shows for every staff viewer (its two
 * pages are open to all staff, #1568). Events also shows for staff with events (their event tabs).
 */
export function visibleAreas(viewer: StaffAreaViewer): StaffArea[] {
  return staffAreaOrder.filter((area) => (ownedTabs(area, viewer).length > 0 || (area === "events" && viewer.hasEvents)));
}

/** The pages inside an event: the event tabs, not the Events area's own row. */
const eventPagePrefixes = ["/overview", "/people", "/check-in", "/communications", "/community", "/finance", "/imports", "/staff", "/registration-builder", "/information-forms", "/more"];

export function isEventScopedPath(pathname: string): boolean {
  return eventPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The club year picker belongs to the Clubs pages that read `?year=`; the Youth directory always shows the current club year (#1685), so it has none. */
export function showsClubYearSelector(place: Pick<StaffPlace, "area" | "tab" | "inEvent">): boolean {
  return place.area === "clubs" && !place.inEvent && place.tab !== "youth-directory";
}

export type StaffPlace = { area: StaffArea; tab: string | null; view: string | null; inEvent: boolean };

function under(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The one place a page lives: its rail area, its tab in that area's row and the view inside it. A page two areas both
 * list belongs to one of them for the marking: Monthly Records, Year-end and Points to Clubs, Event administration to Events. Home's pages,
 * Help and Profile belong to Home (Help and Profile with no tab), so the rail never lights an area the page is not in.
 */
export function staffPlaceFor(pathname: string, params: { get(name: string): string | null } = { get: () => null }): StaffPlace {
  const view = params.get("view");
  const place = (area: StaffArea, tab: string | null, viewKey: string | null = null): StaffPlace => ({ area, tab, view: viewKey, inEvent: false });

  if (pathname === homeDestinations.comingUp.href) return place("home", "coming-up");
  if (pathname === homeDestinations.needsYou.href) return place("home", "needs-you");
  if (under(pathname, "/help") || under(pathname, "/profile")) return place("home", null);
  // Submitted club forms belong to the clubs, not to an event (#1573): with no `event` parameter they sit in Admin -> Forms beside
  // the definitions. With one (the person came from that event's More card) they stay in the event shell.
  if (under(pathname, "/more/club-forms") && !params.get("event")) return place("admin", "hub-forms", "/admin/club-forms");
  // Possible duplicate people compares people across every event: system identity review, so it sits under System (#1886).
  if (under(pathname, "/people/matches") || under(pathname, "/people/profile-updates")) return place("admin", "system-administration");
  if (isEventScopedPath(pathname)) return { area: "events", tab: null, view: null, inEvent: true };

  if (pathname === "/admin") return place("admin", "system-administration");
  if (under(pathname, adminHubs.events.href)) return place("admin", "hub-events");
  if (under(pathname, adminHubs.clubs.href)) return place("admin", "hub-clubs");
  if (under(pathname, adminHubs.people.href)) return place("admin", "hub-people");
  if (under(pathname, adminHubs.forms.href)) return place("admin", "hub-forms");
  if (under(pathname, adminHubs.catalogs.href)) return place("admin", "hub-catalogs");
  // A card on the Events hub, so it lights the Events tab and not the /admin fallback below.
  if (under(pathname, "/admin/feature-requests")) return place("admin", "hub-events");
  if (pathname === "/events-admin") return place("events", "event-administration");
  if (under(pathname, "/admin/events")) return place("events", "all-events");
  if (under(pathname, "/event-setup")) return place("events", pathname === "/event-setup/copy" ? "copy" : "create");
  if (under(pathname, "/admin/calendar")) return place("events", "calendar");
  if (under(pathname, "/admin/event-templates")) return place("events", "templates");
  if (under(pathname, "/archived-events")) return place("events", "archived");

  if (pathname === "/admin/clubs") return place("clubs", "club-administration", "/admin/clubs");
  // Year-end is a view of the Monthly records tab (#1841); it stays before the generic reports branch below.
  if (under(pathname, "/admin/clubs/reports/year-end")) return place("clubs", "monthly-records", clubYearEndHref);
  // The review queue and a single club's record are the Review view of the Monthly records tab (#1588); a record opened from
  // the Monthly Records view (a `from` naming that page) keeps that view lit instead.
  if (under(pathname, "/admin/clubs/reports")) {
    const fromRecords = pathname !== reviewMonthlyRecordsHref && (params.get("from") ?? "").startsWith(`${RECORDS_VIEW_PATH}?`);
    return place("clubs", "monthly-records", fromRecords ? clubsAdminRecordsHref : reviewMonthlyRecordsHref);
  }
  if (under(pathname, "/admin/clubs/summary")) {
    // Points and Monthly Records are two views of one tab, so one area lights for both (Reports holds only whole-system reports).
    if (view === "points") return place("clubs", "monthly-records", clubPointsHref);
    if (view === "records") return place("clubs", "monthly-records", clubsAdminRecordsHref);
    return place("clubs", "club-summary", view === "events" ? "/admin/clubs/summary?view=events#club-events" : "/admin/clubs/summary");
  }
  if (under(pathname, "/admin/clubs/applications")) return place("clubs", "applications", "/admin/clubs/applications");
  // Club invites is the Invited view of Club leaders (#1589).
  if (under(pathname, "/admin/clubs/leaders") || under(pathname, "/admin/clubs/invites")) return place("clubs", "leaders");
  if (under(pathname, "/admin/clubs/transfers")) return place("clubs", "transfers");
  if (under(pathname, "/admin/youth")) return place("clubs", "youth-directory");
  if (under(pathname, "/admin/clubs/import")) return place("clubs", "club-summary", "/admin/clubs/import");
  if (under(pathname, "/admin/clubs/health-import")) return place("clubs", "club-summary", clubsAdminHealthImportHref);
  if (under(pathname, "/admin/organizations/background-checks") || under(pathname, "/admin/background-checks")) return place("clubs", "club-administration", "/admin/organizations/background-checks");
  if (under(pathname, "/admin/organizations")) return place("clubs", "clubs-and-churches");

  if (under(pathname, "/admin/people") || under(pathname, "/admin/team") || under(pathname, "/admin/accounts")) return place("people", "people-access");
  if (under(pathname, "/admin/health-access")) return place("people", "break-glass");

  if (under(pathname, "/admin/analytics")) return place("reports", "analytics");
  if (under(pathname, "/admin/system-report")) return place("reports", "system-report");

  if (under(pathname, "/admin/forms")) return place("admin", "hub-forms", "/admin/forms");
  if (under(pathname, "/admin/club-forms/public-page")) return place("admin", "hub-forms", "/admin/club-forms/public-page");
  if (under(pathname, "/admin/club-forms")) return place("admin", "hub-forms", "/admin/club-forms");
  if (under(pathname, "/admin/form-templates")) return place("admin", "hub-forms", "/admin/form-templates");
  if (under(pathname, "/admin/question-library")) return place("admin", "hub-forms", "/admin/question-library");
  if (under(pathname, "/admin/information-forms")) return place("admin", "hub-forms");

  if (under(pathname, "/admin/honors")) return place("admin", "hub-catalogs", "/admin/honors");
  if (under(pathname, "/admin/club-supplies")) return place("admin", "hub-catalogs", "/admin/club-supplies");
  if (under(pathname, "/admin/email") || under(pathname, "/admin/notifications")) return place("admin", "hub-catalogs", "/admin/email");
  if (under(pathname, "/admin/site-content")) return place("admin", "hub-catalogs", "/admin/site-content");
  if (under(pathname, "/admin/settings")) return place("admin", "hub-catalogs", "/admin/settings");
  if (under(pathname, "/admin")) return place("admin", "hub-catalogs");

  // Anything else the staff shell wraps (an unknown page) keeps Home lit and no tab.
  return place("home", null);
}

/** Marks the current tab and view; a tab list the page is not in has none marked. */
export function markCurrentTab(tabs: readonly AreaTab[], place: Pick<StaffPlace, "tab" | "view">): AreaTab[] {
  return tabs.map((tab) => {
    const current = tab.key === place.tab;
    const views = (tab.views ?? []).map((view) => ({ ...view, current: current && pathOfHrefEquals(view.key, place.view) }));
    return { ...tab, current, views };
  });
}

function pathOfHrefEquals(viewKey: string, placeView: string | null) {
  return placeView !== null && viewKey === placeView;
}

/** Where an area opens: its first reachable tab that the area owns. */
export function areaLandingHref(area: StaffArea, viewer: StaffAreaViewer): string | null {
  return ownedTabs(area, viewer)[0]?.href ?? null;
}

export type RailItem = { area: StaffArea; label: string; href: string; icon: LucideIcon };

/**
 * The rail, at most six items, filtered by what the viewer can reach. Events opens its first tab, or the selected event's
 * first tab for staff whose Events area has no row of its own (`eventLanding`, from `buildEventTabs`).
 */
export function railItems(viewer: StaffAreaViewer, eventLanding: string | null): RailItem[] {
  return visibleAreas(viewer).flatMap((area) => {
    const href = area === "events" ? areaLandingHref("events", viewer) ?? eventLanding : areaLandingHref(area, viewer);
    return href ? [{ area, label: staffAreaMeta[area].label, href, icon: staffAreaMeta[area].icon }] : [];
  });
}

