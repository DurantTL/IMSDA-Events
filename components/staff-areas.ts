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

const registered: readonly Registered[] = [
  ...systemNavGroups.flatMap((group) => group.items.map(({ href, label }) => ({ href, label }))),
  ...clubsAdminGroups.flatMap((group) => group.items.map(({ href, label }) => ({ href, label }))),
  { href: clubsAdminHomeItem.href, label: clubsAdminHomeItem.label },
  { href: eventsAdminHomeItem.href, label: eventsAdminHomeItem.label },
  { href: "/admin", label: "System administration" },
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
 * list planned work). Left out for that reason: Events > "All events" (no in-shell all-events list yet).
 */
export const areaTabSpecs: Record<StaffArea, readonly TabSpec[]> = {
  // Home waits for its own pages (#1568: Needs you, Coming up). Menus never list planned work, so it has no tabs and no rail item;
  // the phone bar's Home slot opens the person's main dashboard instead.
  home: [],
  events: [
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
      // Pages the Clubs Administrator's sidebar listed that no tab owns: the club imports and Sterling Volunteers.
      views: [
        { href: clubsAdminHomeItem.href, label: "Overview", visible: clubs },
        { href: "/admin/clubs/import", visible: clubs },
        { href: clubsAdminHealthImportHref, visible: (v) => clubs(v) && v.healthImport },
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
        { href: "/admin/clubs/invites", visible: clubs },
      ],
    },
    { key: "leaders", destination: "/admin/clubs/leaders", visible: clubs },
    { key: "transfers", destination: "/admin/clubs/transfers", visible: clubs },
    { key: "monthly-records", destination: clubsAdminRecordsHref, visible: clubs },
  ],
  people: [
    { key: "people-access", destination: "/admin/people", visible: eitherClubsOrSys },
    { key: "break-glass", destination: "/admin/health-access", visible: sys },
  ],
  reports: [
    { key: "monthly-records", destination: clubsAdminRecordsHref, visible: clubs },
    { key: "year-end", destination: "/admin/clubs/reports/year-end", visible: clubs },
    { key: "points", destination: "/admin/clubs/summary?view=points#points", visible: clubs },
    { key: "analytics", destination: "/admin/analytics", visible: sys },
    { key: "system-report", destination: "/admin/system-report", visible: sys },
  ],
  admin: [
    { key: "system-administration", destination: "/admin", visible: sys },
    // Each hub tab opens its hub page (#1569): the hub lists every destination of its group as a card, so no view strip is needed.
    { key: "hub-events", destination: adminHubs.events.href, visible: sys },
    { key: "hub-clubs", destination: adminHubs.clubs.href, visible: sys },
    { key: "hub-people", destination: adminHubs.people.href, visible: sys },
    { key: "hub-forms", destination: adminHubs.forms.href, visible: eitherClubsOrSys },
    { key: "hub-catalogs", destination: adminHubs.catalogs.href, visible: (v) => eitherClubsOrSys(v) || v.siteContentEditor },
  ],
};

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
        href: area === "clubs" || area === "reports" ? withYear(baseHref, viewer) : baseHref,
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
 * The rail: an area shows when at least one of its tabs is a page it owns. Home is not on the rail until its pages exist
 * (#1568). Events also shows for staff with events (their event tabs).
 */
export function visibleAreas(viewer: StaffAreaViewer): StaffArea[] {
  return staffAreaOrder.filter((area) => area !== "home" && (ownedTabs(area, viewer).length > 0 || (area === "events" && viewer.hasEvents)));
}

/** The pages inside an event: the event tabs, not the Events area's own row. */
const eventPagePrefixes = ["/overview", "/people", "/check-in", "/communications", "/community", "/finance", "/imports", "/staff", "/registration-builder", "/information-forms", "/more"];

export function isEventScopedPath(pathname: string): boolean {
  return eventPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type StaffPlace = { area: StaffArea; tab: string | null; view: string | null; inEvent: boolean };

function under(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The one place a page lives: its rail area, its tab in that area's row and the view inside it. A page two areas both
 * list belongs to one of them for the marking: Monthly Records to Clubs, Event administration to Events. Help and
 * Profile belong to Home, so the rail never lights an area the page is not in.
 */
export function staffPlaceFor(pathname: string, params: { get(name: string): string | null } = { get: () => null }): StaffPlace {
  const view = params.get("view");
  const place = (area: StaffArea, tab: string | null, viewKey: string | null = null): StaffPlace => ({ area, tab, view: viewKey, inEvent: false });

  if (under(pathname, "/help") || under(pathname, "/profile")) return place("home", null);
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
  if (under(pathname, "/event-setup")) return place("events", pathname === "/event-setup/copy" ? "copy" : "create");
  if (under(pathname, "/admin/calendar")) return place("events", "calendar");
  if (under(pathname, "/admin/event-templates")) return place("events", "templates");
  if (under(pathname, "/archived-events")) return place("events", "archived");

  if (pathname === "/admin/clubs") return place("clubs", "club-administration", "/admin/clubs");
  if (under(pathname, "/admin/clubs/reports/year-end")) return place("reports", "year-end");
  if (under(pathname, "/admin/clubs/reports")) return place("clubs", "monthly-records");
  if (under(pathname, "/admin/clubs/summary")) {
    if (view === "points") return place("reports", "points");
    if (view === "records") return place("clubs", "monthly-records");
    return place("clubs", "club-summary", view === "events" ? "/admin/clubs/summary?view=events#club-events" : "/admin/clubs/summary");
  }
  if (under(pathname, "/admin/clubs/applications")) return place("clubs", "applications", "/admin/clubs/applications");
  if (under(pathname, "/admin/clubs/invites")) return place("clubs", "applications", "/admin/clubs/invites");
  if (under(pathname, "/admin/clubs/leaders")) return place("clubs", "leaders");
  if (under(pathname, "/admin/clubs/transfers")) return place("clubs", "transfers");
  if (under(pathname, "/admin/clubs/import")) return place("clubs", "club-administration", "/admin/clubs/import");
  if (under(pathname, "/admin/clubs/health-import")) return place("clubs", "club-administration", clubsAdminHealthImportHref);
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

