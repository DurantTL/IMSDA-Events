import { kitchenCountsPath, type EventPermission } from "@/modules/access/permissions";
import { moneyToolPaths } from "@/modules/payments/money-tools-model";
import { canAccessOperationalHealth } from "@/modules/operations/access";
import {
  canShowMoreLauncher,
  matchesVisibility,
  navigation,
  staffPageTitles,
  withCurrentEvent,
  type MoreDirectoryContext,
  type NavigationItem,
} from "@/components/staff-navigation";

/**
 * The tabs inside an event (#1565): Event home, Registrations, Check-in, Communications, Money, Reports and Event
 * setup, each with at most five views (a button strip, never a second tab row). Built from the same registry as the
 * rest of the staff shell (`navigation` for labels and permissions), so which pages a role can open cannot drift
 * between the desktop tabs and the phone menu. Nothing here grants access: every page keeps its own server check.
 *
 * Two tabs are reserved and render for no event yet: Operations (volunteers, transportation, groups, sessions) and
 * Safety (incident or camp-medical access). Each is supported by the model (a feature predicate and a permission)
 * but has no route, and a menu never lists a page that does not exist, so `buildEventTabs` leaves it out.
 */
export type EventTabKey = "home" | "registrations" | "check-in" | "communications" | "money" | "reports" | "setup" | "operations" | "safety";

export const maxViewsPerTab = 5;
export const maxTabsPerRow = 8;

export type EventView = { key: string; label: string; href: string; current?: boolean };
export type EventTab = { key: EventTabKey; label: string; href: string; views: EventView[]; current?: boolean };

export type EventTabsContext = {
  permissions: readonly EventPermission[];
  eventId: string;
  isSystemAdmin: boolean;
  /** Same inputs as the More directory, so the Event setup tab shows exactly when that page has something to list. */
  more: Omit<MoreDirectoryContext, "eventQuery">;
  /** Features an event may turn on that would show the reserved Operations tab. None exists yet, so none is ever passed. */
  features?: { volunteers?: boolean; transportation?: boolean; groups?: boolean; sessions?: boolean; safety?: boolean };
  /** Incident or camp-medical access, for the reserved Safety tab (ADR 0012, ADR 0002). */
  safetyAccess?: boolean;
};

type ViewSpec = {
  key: string;
  label: string;
  /** Path with an optional query, before `?event=` is added. */
  href: string;
  visible: (context: EventTabsContext, permissions: ReadonlySet<EventPermission>) => boolean;
  /** A page below the path that still belongs to this view, such as /people/duplicates under the Registrations list. */
  alsoOwns?: readonly string[];
  /** `?filter=` value the view is the current one for; the plain view is current for every other filter. */
  filter?: string;
};

type TabSpec = {
  key: EventTabKey;
  label: string;
  views: readonly ViewSpec[];
  /** Pages the tab owns without a view of their own (the rest of the tab's pages light its first view or none). */
  owns: readonly string[];
  /** The route the tab opens when it has no visible view of its own. Reserved tabs have none. */
  reserved?: { features: readonly (keyof NonNullable<EventTabsContext["features"]>)[]; permission?: "safetyAccess" };
};

const nav = (href: string): NavigationItem => {
  const item = navigation.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`The staff navigation has no destination ${href}.`);
  return item;
};
const byNav = (href: string) => (_: EventTabsContext, permissions: ReadonlySet<EventPermission>) => matchesVisibility(nav(href), permissions);
const holds = (permission: EventPermission) => (_: EventTabsContext, permissions: ReadonlySet<EventPermission>) => permissions.has(permission);
const anyOf = (...list: EventPermission[]) => (_: EventTabsContext, permissions: ReadonlySet<EventPermission>) => list.some((permission) => permissions.has(permission));

const overviewVisible = (_: EventTabsContext, permissions: ReadonlySet<EventPermission>) =>
  permissions.has("VIEW_EVENT") && matchesVisibility(nav("/overview"), permissions);

export const eventTabSpecs: readonly TabSpec[] = [
  {
    key: "home",
    label: "Event home",
    owns: ["/overview"],
    views: [{ key: "overview", label: staffPageTitles.overview, href: "/overview", visible: overviewVisible }],
  },
  {
    key: "registrations",
    label: staffPageTitles.registrations,
    owns: ["/people", "/imports"],
    views: [
      { key: "registrations", label: "All registrations", href: "/people", visible: byNav("/people"), alsoOwns: ["/people/duplicates", "/people/matches", "/people/directory-review", "/people/pending-teams", "/people/responsible-adults", "/people/staff-invitations"] },
      { key: "attendees", label: staffPageTitles.attendeeList, href: "/people/attendees", visible: byNav("/people/attendees") },
      { key: "imports", label: staffPageTitles.imports, href: "/imports", visible: byNav("/imports") },
    ],
  },
  {
    key: "check-in",
    label: staffPageTitles.checkIn,
    owns: ["/check-in"],
    views: [
      { key: "arrivals", label: "Arrivals", href: "/check-in", visible: byNav("/check-in") },
      { key: "badges", label: "Name badges", href: "/check-in/badges", visible: byNav("/check-in") },
      { key: "passes", label: "Attendee passes", href: "/check-in/passes", visible: byNav("/check-in") },
      { key: "assets", label: "Keys and items", href: "/check-in/assets", visible: byNav("/check-in") },
    ],
  },
  {
    key: "communications",
    label: "Communications",
    owns: ["/communications", "/community"],
    views: [
      { key: "messages", label: "Announcements and reminders", href: "/communications", visible: byNav("/communications"), alsoOwns: [] },
      { key: "scheduled", label: staffPageTitles.scheduledEmails, href: "/communications/scheduled", visible: holds("MANAGE_COMMUNICATIONS") },
      { key: "community", label: "Attendee community", href: "/community", visible: holds("MANAGE_COMMUNICATIONS") },
    ],
  },
  {
    key: "money",
    label: "Money",
    owns: ["/finance", "/more/promo-codes", "/more/ledger-health"],
    // Five views at most, in this order: Payments, Balances due, Refunds, Promo codes, More money tools (#1575). Refunds opens the
    // cancellation-request queue (a decision there records it only; carrying one out is its own named action). Every other finance
    // page is reached from the More money tools cards, which light that view as their parent.
    views: [
      { key: "payments", label: staffPageTitles.payments, href: "/finance", visible: byNav("/finance") },
      { key: "balances", label: "Balances due", href: "/finance?filter=BALANCE", visible: byNav("/finance"), filter: "BALANCE" },
      { key: "refunds", label: "Refunds", href: "/finance/cancellation-requests", visible: byNav("/finance") },
      { key: "promo", label: staffPageTitles.promoCodes, href: "/more/promo-codes", visible: byNav("/more/promo-codes") },
      { key: "more-tools", label: staffPageTitles.moreMoneyTools, href: "/finance/tools", visible: byNav("/finance/tools"), alsoOwns: moneyToolPaths },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    owns: ["/more/reports", "/more/health", "/more/kitchen-report"],
    views: [
      { key: "operational", label: staffPageTitles.operationalReports, href: "/more/reports", visible: byNav("/more/reports"), alsoOwns: ["/more/reports/clubs"] },
      { key: "health", label: staffPageTitles.operationalHealth, href: "/more/health", visible: (context) => canAccessOperationalHealth(context.permissions) },
      { key: "kitchen", label: staffPageTitles.kitchenReport, href: "/more/kitchen-report", visible: holds("VIEW_REPORTS"), alsoOwns: ["/more/kitchen-report/closeout", "/more/kitchen-report/scanner-import"] },
      { key: "kitchen-counts", label: staffPageTitles.kitchenCounts, href: kitchenCountsPath, visible: anyOf("MANAGE_KITCHEN_COUNTS", "VIEW_REPORTS") },
      { key: "printouts", label: "Printouts", href: "/more/reports/packets", visible: holds("VIEW_REPORTS") },
    ],
  },
  {
    key: "setup",
    label: "Event setup",
    // Every other event page (Honors, Lodging, Meals, Team, Club forms ...) is an Event setup page: the tab owns what no other tab does.
    owns: ["/more", "/registration-builder", "/information-forms", "/staff"],
    // One grouped page and no view strip (#1586): Event settings, Registration forms, Attendee setup, Event features and every other
    // setup page are cards on it. A single view is the tab's own page, so the tab shows no views.
    views: [
      { key: "setup", label: "Event setup", href: "/more", visible: (context) => canShowMoreLauncher({ item: nav("/more"), ...context.more }) },
    ],
  },
  // Reserved: no route exists until the first of these features is built (#1559 decisions 7 and 8).
  { key: "operations", label: "Operations", owns: [], views: [], reserved: { features: ["volunteers", "transportation", "groups", "sessions"] } },
  { key: "safety", label: "Safety", owns: [], views: [], reserved: { features: ["safety"], permission: "safetyAccess" } },
];

/** Whether a reserved tab's own rule says it should show: its feature is on and the viewer has the access it needs. */
export function reservedTabWouldShow(spec: TabSpec, context: Pick<EventTabsContext, "features" | "safetyAccess">): boolean {
  if (!spec.reserved) return false;
  const featureOn = spec.reserved.features.some((feature) => context.features?.[feature]);
  if (!featureOn) return false;
  return spec.reserved.permission ? Boolean(context[spec.reserved.permission]) : true;
}

function viewHref(href: string, eventId: string) {
  return withCurrentEvent(href, eventId);
}

/** The visible tabs for this viewer and event, each opening its first visible view. A tab with no visible view is left out, never shown empty. */
export function buildEventTabs(context: EventTabsContext): EventTab[] {
  const permissions = new Set(context.permissions);
  const tabs: EventTab[] = [];
  for (const spec of eventTabSpecs) {
    // Reserved tabs have no route yet: whatever their rule says, there is nothing to open, so none is listed.
    if (spec.reserved) continue;
    const views = spec.views
      .filter((view) => view.visible(context, permissions))
      .map<EventView>((view) => ({ key: view.key, label: view.label, href: viewHref(view.href, context.eventId) }));
    if (views.length === 0) continue;
    tabs.push({ key: spec.key, label: spec.label, href: views[0].href, views: views.length > 1 ? views : [] });
  }
  return tabs;
}

function pathOf(href: string) {
  return href.split("#")[0].split("?")[0];
}

function isAtOrBelow(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Which tab, and which of its views, a page belongs to. A page no tab names is an Event setup page and lights no view
 * (it lights the Event setup tab, which has no view strip).
 */
export function currentEventPlace(pathname: string, search: { get(name: string): string | null } = { get: () => null }): { tab: EventTabKey; view: string | null } {
  let best: { tab: EventTabKey; view: string | null; length: number } | null = null;
  const consider = (tab: EventTabKey, view: string | null, path: string) => {
    if (!isAtOrBelow(pathname, path)) return;
    if (!best || path.length >= best.length) best = { tab, view, length: path.length };
  };
  for (const spec of eventTabSpecs) {
    for (const path of spec.owns) consider(spec.key, null, path);
    for (const view of spec.views) {
      for (const path of [pathOf(view.href), ...(view.alsoOwns ?? [])]) consider(spec.key, view.key, path);
    }
  }
  if (!best) return { tab: "setup", view: null };
  const found: { tab: EventTabKey; view: string | null; length: number } = best;
  // The balance view and the plain payments view share one page; the filter says which is current.
  if (found.tab === "money" && pathname === "/finance") return { tab: "money", view: search.get("filter") === "BALANCE" ? "balances" : "payments" };
  // Every Event setup page (Event settings, Honors, Lodging, Team ...) lights the tab; it has no views to mark.
  if (found.tab === "setup") return { tab: "setup", view: "setup" };
  return { tab: found.tab, view: found.view };
}

/** Marks the current tab and view on a built list. A viewer who cannot see the page's own tab sees none marked. */
export function markCurrentEventTab(tabs: readonly EventTab[], place: { tab: EventTabKey; view: string | null }): EventTab[] {
  return tabs.map((tab) => ({
    ...tab,
    current: tab.key === place.tab,
    views: tab.views.map((view) => ({ ...view, current: tab.key === place.tab && view.key === place.view })),
  }));
}
