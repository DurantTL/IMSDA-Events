import {
  buildSearchDestinations,
  type DestinationScope,
  type DestinationSearchContext,
  type SearchDestination,
} from "@/components/destination-search-model";
import {
  buildMoreDirectoryCards,
  eventFeaturesItem,
  moreDirectoryGroupLabels,
  navigation,
  sidebarSectionLabels,
} from "@/components/staff-navigation";
import { systemNavGroups } from "@/components/system-navigation";
import { eventPermissions } from "@/modules/access/permissions";

/**
 * The old to new route mapping (#1180): every staff route the registries list
 * today, with the destination it has in the new navigation (scope, label and
 * task group). It is built from the same registries the menus use
 * (`navigation`, `buildMoreDirectoryCards`, `systemNavGroups`), so a route added
 * to a registry is mapped without a second list to keep in step. The tests then
 * check that every mapped destination is still reachable through the menus and
 * search for a viewer who may open it, so a route that drops out of the new
 * navigation fails a test. A mapping row grants nothing: every page keeps its
 * own server-side authorization.
 */
export type RouteMappingRow = {
  /** The staff route as the registries list it (no query string). */
  route: string;
  /** Where staff found it before: the event sidebar, the More directory or System management. */
  oldPlace: "Event sidebar" | "More directory" | "System management" | "Account";
  /** The scope the destination has in the new navigation. */
  scope: DestinationScope;
  /** The path of the destination that opens it. Usually the route itself. */
  destinationPath: string;
  label: string;
  /** The new task group: a System group, a sidebar section or a More group. */
  group: string;
  note?: string;
};

const pathOf = (href: string) => href.split("?")[0].split("#")[0];

/** Routes whose new destination is a different page, with the reason. */
const redirectedRoutes: Readonly<Record<string, { destinationPath: string; note: string }>> = {
  "/more": {
    destinationPath: "/more/features",
    note: "More opens the tools launcher; Event modules and activity is linked from the launcher footer and from Event features.",
  },
};

export function buildRouteMapping(): RouteMappingRow[] {
  const rows: RouteMappingRow[] = [];
  const seen = new Set<string>();
  const add = (row: RouteMappingRow) => {
    const identity = `${row.oldPlace}|${row.route}|${row.scope}|${row.label}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    rows.push(row);
  };

  for (const group of systemNavGroups) {
    for (const item of group.items) {
      add({ route: item.href, oldPlace: "System management", scope: "System", destinationPath: item.href, label: item.label, group: group.label });
      // Pages that light this entry (Club invites under Applications) keep working and map to it.
      for (const alias of item.alsoActiveFor ?? []) {
        add({ route: alias, oldPlace: "System management", scope: "System", destinationPath: item.href, label: item.label, group: group.label, note: `Opens from ${item.label}.` });
      }
    }
  }

  const cards = buildMoreDirectoryCards({
    permissions: eventPermissions,
    clubOversight: true,
    clubEvent: true,
    isSystemAdmin: true,
    clubFormsAccess: true,
    eventQuery: "",
  });
  const cardByPath = new Map(cards.map((card) => [pathOf(card.href), card]));

  for (const item of [...navigation, eventFeaturesItem]) {
    const redirect = redirectedRoutes[item.href];
    const card = cardByPath.get(item.href);
    const group = item.sidebar
      ? (sidebarSectionLabels[item.sidebar] ?? "Daily")
      : card ? moreDirectoryGroupLabels[card.group] : "Event tools";
    add({
      route: item.href,
      oldPlace: item.sidebar ? "Event sidebar" : "More directory",
      scope: "Event",
      destinationPath: redirect?.destinationPath ?? item.href,
      label: item.label,
      group,
      note: redirect?.note,
    });
  }

  for (const card of cards) {
    const path = pathOf(card.href);
    // The directory card for Clubs and churches opens the System directory.
    const system = path.startsWith("/admin");
    add({
      route: path,
      oldPlace: "More directory",
      scope: system ? "System" : "Event",
      destinationPath: path,
      label: card.title,
      group: system ? "Clubs" : moreDirectoryGroupLabels[card.group],
    });
  }

  add({ route: "/profile", oldPlace: "Account", scope: "Profile", destinationPath: "/profile", label: "Your account", group: "Account" });
  return rows;
}

/** Viewers whose menus together must reach every mapped route: an administrator with every permission, and kitchen staff, who hold the counts page instead of the dashboard (#1029). */
export const reachabilityContexts: readonly DestinationSearchContext[] = [
  { isSystemAdmin: true, selectedEventId: "event_synthetic", permissions: eventPermissions, clubOversight: true, clubEvent: true, clubFormsAccess: true },
  { isSystemAdmin: false, selectedEventId: "event_synthetic", permissions: ["MANAGE_KITCHEN_COUNTS"], clubOversight: false, clubEvent: false, clubFormsAccess: false },
];

/** The mapped routes whose destination none of the given destination sets opens. Empty means nothing is lost. */
export function unreachableRoutes(rows: readonly RouteMappingRow[], destinationSets: readonly (readonly SearchDestination[])[]): RouteMappingRow[] {
  const opened = new Set(destinationSets.flatMap((set) => set.map((destination) => `${destination.scope}|${pathOf(destination.href)}`)));
  return rows.filter((row) => !opened.has(`${row.scope}|${row.destinationPath}`));
}

/** Convenience for the shell and tests: the destination sets of `reachabilityContexts`. */
export function reachabilityDestinationSets(): SearchDestination[][] {
  return reachabilityContexts.map((context) => buildSearchDestinations(context));
}
