import type { DashboardTab } from "@/components/dashboard-tabs";
import { clubsAdminActiveHref, clubsAdminGroups, type ClubsNavGroupKey } from "@/components/staff-navigation";
import { systemNavActiveItem, systemNavGroups, type SystemNavGroupKey } from "@/components/system-navigation";
import type { AdminRole } from "@/modules/access/admin-roles-domain";
import { clubsAdminTabs } from "@/modules/club-reports/clubs-admin-home-model";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { eventsAdminTabs } from "@/modules/events/events-admin-home-model";
import { systemHomeTabs } from "@/modules/system-admin/home-model";

/**
 * The section header's model (#1274): which of the three admin sections a page shows, that section's tab row with the
 * current one marked, and the back link of a page deeper than the section's main pages. Pure (no server-only imports),
 * so the tabs, the current marking and the back targets are unit-tested. Nothing here grants access: it only decides
 * which links to draw for a viewer whose page already passed its own gate.
 */
export type AdminSection = "system" | "clubs" | "events";

export type AdminSectionTab = DashboardTab & {
  /** "page" on the tab's own page; "true" on another page that belongs to the tab's area. */
  current?: "page" | "true";
};

export type AdminBackLink = { href: string; label: string };

export type AdminSectionNav = {
  section: AdminSection;
  name: string;
  navLabel: string;
  tabs: AdminSectionTab[];
  back?: AdminBackLink;
};

const sectionNames: Record<AdminSection, string> = {
  system: "System administration",
  clubs: "Club administration",
  events: "Event administration",
};

/** The event pages the Events Administrator tabs open (the dashboard's own links). */
const eventPagePaths: readonly string[] = ["/overview", "/people", "/more/event-content", "/more/kitchen-report", "/communications", "/finance"];

/** Pages a Clubs Administrator can open besides /admin/clubs/**: they show the Clubs header in the Clubs view. */
const clubsCapablePatterns: readonly RegExp[] = [
  /^\/admin\/clubs(\/|$)/,
  /^\/admin\/organizations\/background-checks(\/|$)/,
  /^\/admin\/honors(\/|$)/,
  /^\/admin\/club-supplies(\/|$)/,
  /^\/admin\/club-forms(\/|$)/,
  /^\/admin\/organizations\/[^/]+\/(club|honors|directors|profile)(\/|$)/,
];

/**
 * Which section header a page shows, or null for none.
 * - The three dashboards always show their own header.
 * - A page both Clubs and System administrators can open shows Clubs when the Clubs view is active (or the viewer is
 *   no System administrator), otherwise System.
 * - Event pages show Events only in the Events view, and only for an event the viewer administers.
 */
export function adminSectionFor(
  pathname: string,
  viewer: { active: AdminRole | null; systemAdmin: boolean; administersEvent?: boolean },
): AdminSection | null {
  if (pathname === "/admin") return "system";
  if (pathname === "/admin/clubs") return "clubs";
  if (pathname === "/events-admin") return "events";
  if (eventPagePaths.includes(pathname)) return viewer.active === "EVENTS_ADMIN" && viewer.administersEvent ? "events" : null;
  if (!pathname.startsWith("/admin/")) return null;
  if (clubsCapablePatterns.some((pattern) => pattern.test(pathname))) {
    return viewer.active === "CLUBS_ADMIN" || !viewer.systemAdmin ? "clubs" : "system";
  }
  return viewer.systemAdmin ? "system" : null;
}

function pathOf(href: string): string {
  return href.split("#")[0].split("?")[0];
}

const systemGroupTab: Record<SystemNavGroupKey, string> = {
  "system-events": "events",
  "system-clubs": "clubs",
  "system-people": "people",
  "system-forms": "forms",
  "system-catalogs": "settings",
};

function systemAreaKey(pathname: string): string | null {
  if (pathname === "/admin") return "overview";
  const item = systemNavActiveItem(pathname);
  const group = item ? systemNavGroups.find((candidate) => candidate.items.includes(item)) : null;
  if (group) return systemGroupTab[group.key];
  // Club pages with no System sidebar item (the club dashboard, imports, a club's own pages) belong to Clubs.
  if (pathname === "/admin/clubs" || pathname.startsWith("/admin/clubs/") || pathname.startsWith("/admin/organizations")) return "clubs";
  // Feature requests are not in the sidebar; they sit with the platform settings.
  if (pathname === "/admin/feature-requests") return "settings";
  return null;
}

const clubsGroupTab: Record<ClubsNavGroupKey, string> = {
  "clubs-clubs": "all-clubs",
  "clubs-records": "monthly-records",
  "clubs-events": "club-events",
  "clubs-forms": "forms",
  "clubs-applications": "new-clubs",
};

function clubsAreaKey(pathname: string): string | null {
  if (pathname === "/admin/clubs") return "overview";
  const href = clubsAdminActiveHref(pathname);
  if (href === "/admin/clubs") return "overview";
  const group = href ? clubsAdminGroups.find((candidate) => candidate.items.some((item) => item.href === href)) : null;
  if (group) return clubsGroupTab[group.key];
  // A club's own pages are not in the sidebar; they belong to the club list.
  if (/^\/admin\/organizations\/[^/]+\/(club|honors|directors|profile)(\/|$)/.test(pathname)) return "all-clubs";
  return null;
}

const eventsAreaKeys: Record<string, string> = { "/overview": "my-events" };

function eventsAreaKey(pathname: string): string | null {
  return eventsAreaKeys[pathname] ?? null;
}

function markCurrent(tabs: readonly DashboardTab[], pathname: string, areaKey: string | null): AdminSectionTab[] {
  const ownKey = tabs.find((tab) => !tab.href.includes("#") && pathOf(tab.href) === pathname)?.key ?? null;
  return tabs.map((tab) => {
    if (tab.key === ownKey) return { ...tab, current: "page" as const };
    if (!ownKey && tab.key === areaKey) return { ...tab, current: "true" as const };
    return { ...tab };
  });
}

/** The tab row for a section on `pathname`. A hash-only tab jumps within the dashboard, so off the dashboard it opens it first. */
export function adminSectionTabs(
  section: AdminSection,
  pathname: string,
  options: { clubYear?: string; waitingApplications?: number; eventId?: string | null } = {},
): AdminSectionTab[] {
  if (section === "system") {
    const tabs = systemHomeTabs.map((tab) => (tab.href.startsWith("#") && pathname !== "/admin" ? { ...tab, href: `/admin${tab.href}` } : tab));
    return markCurrent(tabs, pathname, systemAreaKey(pathname));
  }
  if (section === "clubs") {
    const tabs = clubsAdminTabs(options.clubYear ?? clubYearFor(new Date()), options.waitingApplications);
    return markCurrent(tabs, pathname, clubsAreaKey(pathname));
  }
  const tabs = eventsAdminTabs(options.eventId ?? null).map((tab) => (tab.href.startsWith("#") && pathname !== "/events-admin" ? { ...tab, href: `/events-admin${tab.href}` } : tab));
  return markCurrent(tabs, pathname, eventsAreaKey(pathname));
}

/**
 * The back link of a page deeper than its section's main pages, or null on a main page. It stays inside the active
 * section: in the Clubs view a club page goes back to the Club summary, never to the System-only Clubs and churches list.
 * `parentName` names the parent in the label ("Back to Example Pathfinders"); `viaParent` is true when the visitor
 * came from the parent (a club's own page linked here), so the link goes back there instead of to the section's list.
 */
export function adminBackLink(
  section: AdminSection,
  pathname: string,
  options: { parentName?: string; viaParent?: boolean } = {},
): AdminBackLink | null {
  const clubsView = section === "clubs";
  const clubList: AdminBackLink = clubsView
    ? { href: "/admin/clubs/summary", label: "Back to Club summary" }
    : { href: "/admin/organizations", label: "Back to Clubs and churches" };
  const clubPage = (id: string): AdminBackLink => ({ href: `/admin/organizations/${id}/club`, label: `Back to ${options.parentName ?? "the club"}` });

  let match = /^\/admin\/organizations\/([^/]+)\/club\/honors(\/|$)/.exec(pathname);
  if (match) return clubPage(match[1]);
  if (/^\/admin\/organizations\/[^/]+\/club(\/|$)/.test(pathname)) return clubList;
  match = /^\/admin\/organizations\/([^/]+)\/(directors|profile)(\/|$)/.exec(pathname);
  if (match) return clubsView || options.viaParent ? clubPage(match[1]) : clubList;
  if (/^\/admin\/organizations\/[^/]+\/pastor(\/|$)/.test(pathname)) return { href: "/admin/organizations/directory", label: "Back to the directory" };
  if (/^\/admin\/organizations\/[^/]+\/(billing|location)(\/|$)/.test(pathname)) return clubList;
  if (/^\/admin\/organizations\/map-locations(\/|$)/.test(pathname)) return { href: "/admin/organizations/directory", label: "Back to Organization directory" };
  if (/^\/admin\/organizations\/(directory|import)(\/|$)/.test(pathname)) return { href: "/admin/organizations", label: "Back to Clubs and churches" };
  if (/^\/admin\/clubs\/(import|invites|health-import)(\/|$)/.test(pathname)) return clubList;
  if (/^\/admin\/clubs\/reports\/year-end(\/|$)/.test(pathname)) return { href: "/admin/clubs/reports", label: "Back to Monthly Records" };
  match = /^\/admin\/clubs\/reports\/([^/]+)\/[^/]+(\/|$)/.exec(pathname);
  if (match) return options.viaParent ? clubPage(match[1]) : { href: "/admin/clubs/reports", label: "Back to Monthly Records" };
  if (/^\/admin\/club-forms\/[^/]+(\/|$)/.test(pathname)) return { href: "/admin/club-forms", label: "Back to club forms" };
  if (/^\/admin\/form-templates\/[^/]+(\/|$)/.test(pathname)) return { href: "/admin/form-templates", label: "Back to form templates" };
  match = /^\/admin\/information-forms\/([^/]+)\/responses(\/|$)/.exec(pathname);
  if (match) return { href: `/admin/information-forms/${match[1]}`, label: `Back to ${options.parentName ?? "the form"}` };
  if (/^\/admin\/information-forms\/[^/]+(\/|$)/.test(pathname)) return { href: "/admin/information-forms", label: "Back to information forms" };
  if (/^\/admin\/event-templates\/[^/]+(\/|$)/.test(pathname)) return { href: "/admin/event-templates", label: "Back to Event templates" };
  return null;
}

/** The model for one page. `parentName` and `viaParent` shape the back link (see `adminBackLink`); `back: null` draws none. */
export function buildAdminSectionNav(input: {
  section: AdminSection;
  pathname: string;
  clubYear?: string;
  waitingApplications?: number;
  eventId?: string | null;
  parentName?: string;
  viaParent?: boolean;
  back?: AdminBackLink | null;
}): AdminSectionNav {
  const { section, pathname } = input;
  const back = input.back === undefined ? adminBackLink(section, pathname, input) : input.back;
  return {
    section,
    name: sectionNames[section],
    navLabel: `${sectionNames[section]} sections`,
    tabs: adminSectionTabs(section, pathname, input),
    ...(back ? { back } : {}),
  };
}
