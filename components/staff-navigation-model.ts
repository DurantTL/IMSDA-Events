import { requestedClubYear } from "@/components/clubs-year-selector-model";
import type { LauncherSection } from "@/components/more-launcher";
import {
  areaLandingHref,
  areaTabs,
  markCurrentTab,
  railItems,
  staffPlaceFor,
  type AreaTab,
  type RailItem,
  type StaffAreaViewer,
  type StaffPlace,
} from "@/components/staff-areas";
import { buildEventTabs, currentEventPlace, markCurrentEventTab, type EventTab, type EventTabKey } from "@/components/staff-event-tabs";
import { adminRoleLanding } from "@/modules/access/admin-roles-domain";
import { phoneBarItems, type PhoneBarItem } from "@/components/staff-phone-bar-model";
import {
  buildMoreDirectoryCards,
  canShowMoreLauncher,
  navigation,
  withCurrentEvent,
  type MoreDirectoryCard,
  type MoreDirectoryContext,
} from "@/components/staff-navigation";
import { alwaysOnModuleKeys, disabledModuleCardKeys } from "@/modules/event-modules/catalog";
import type { EventPermission } from "@/modules/access/permissions";
import { heldAdminRoles, type AdminRole, type AdminRoleCounts } from "@/modules/access/admin-roles-domain";

/**
 * Everything the staff shell draws for navigation, decided in one pure function (#1565): the rail, the one row of tabs and
 * its views, the phone bar and the More sheet's sections. `AppShell` draws exactly this, and
 * `tests/mobile-directory-parity.test.ts` reads the same result to prove a phone and a desktop reach exactly the same
 * pages. Nothing here grants access: every page keeps its own server check.
 */
export type StaffNavigationInput = {
  pathname: string;
  search: { get(name: string): string | null };
  isSystemAdmin: boolean;
  /** The admin roles held and the one chosen, from the server; `null` when the person holds none. */
  adminRoleView: { held: readonly AdminRole[]; active: AdminRole | null; counts: AdminRoleCounts; healthImport?: boolean } | null;
  siteContentEditor: boolean;
  hasEvents: boolean;
  /** The event the page is in, with what the viewer may do in it. */
  selectedEvent?: {
    id: string;
    permissions: readonly EventPermission[];
    clubOversight?: boolean;
    clubEvent?: boolean;
    clubFormsAccess?: boolean;
    hiddenCardKeys?: readonly string[];
  };
  /** Staff with no events opening their profile or Help: every event control would dead-end. */
  eventlessProfile?: boolean;
};

export type StaffNavigation = {
  place: StaffPlace;
  viewer: StaffAreaViewer;
  moreContext: Omit<MoreDirectoryContext, "eventQuery" | "hiddenCardKeys"> & { hiddenCardKeys: ReadonlySet<string> };
  showMore: boolean;
  eventQuery: string;
  carry: (href: string) => string;
  rail: RailItem[];
  eventTabs: EventTab[];
  eventPlace: ReturnType<typeof currentEventPlace>;
  /** The tabs of the one row the page shows: the event's inside an event, else the area's. */
  rowTabs: Array<EventTab | AreaTab>;
  currentTab: EventTab | AreaTab | undefined;
  launcherCards: readonly MoreDirectoryCard[];
  launcherSections: LauncherSection[];
  phoneItems: PhoneBarItem[];
  eventsLanding: string | null;
};

export function buildStaffNavigation(input: StaffNavigationInput): StaffNavigation {
  const { pathname, search, isSystemAdmin, adminRoleView, siteContentEditor, selectedEvent } = input;
  const eventlessProfile = Boolean(input.eventlessProfile);
  const place = staffPlaceFor(pathname, search);
  const held = adminRoleView?.held ?? (isSystemAdmin ? heldAdminRoles({ systemAdmin: true, clubsAdministrator: true, eventAdminEventIds: [] }) : []);
  const activeRole = adminRoleView?.active ?? (held.includes("SYSTEM_ADMIN") ? "SYSTEM_ADMIN" : null);
  const viewer: StaffAreaViewer = {
    isSystemAdmin,
    held,
    activeRole,
    hasEvents: input.hasEvents,
    siteContentEditor,
    healthImport: adminRoleView?.healthImport !== false,
    clubYear: requestedClubYear(search.get("year")),
    counts: adminRoleView?.counts ?? {},
  };
  const selectedEventId = selectedEvent?.id ?? "";
  const permissions = selectedEvent?.permissions ?? [];
  const eventQuery = selectedEventId ? `?event=${encodeURIComponent(selectedEventId)}` : "";
  // Links keep the selected event (#616), so moving between areas never replaces the remembered event. The Clubs pages never carried one.
  const carry = (href: string) => (place.area === "clubs" ? href : withCurrentEvent(href, selectedEventId));

  // Module cards the launcher leaves out. An event the server did not load module state for lists the universal tools only.
  const hiddenCardKeys: ReadonlySet<string> = selectedEvent?.hiddenCardKeys
    ? new Set(selectedEvent.hiddenCardKeys)
    : disabledModuleCardKeys(new Set(alwaysOnModuleKeys));
  const moreContext = {
    permissions: [...permissions],
    clubOversight: Boolean(selectedEvent?.clubOversight),
    clubEvent: Boolean(selectedEvent?.clubEvent),
    isSystemAdmin,
    clubFormsAccess: Boolean(selectedEvent?.clubFormsAccess),
    hiddenCardKeys,
  };
  const moreNavItem = navigation.find((item) => item.href === "/more");
  const showMore = Boolean(selectedEvent) && Boolean(moreNavItem) && canShowMoreLauncher({ item: moreNavItem!, ...moreContext });
  const launcherCards = selectedEvent ? buildMoreDirectoryCards({ ...moreContext, eventQuery }) : [];

  // Event pages: the event's tabs (a viewer sees only the tabs they can open; kitchen staff see only the kitchen counts).
  const builtEventTabs = selectedEvent && !eventlessProfile
    ? buildEventTabs({ permissions: [...permissions], eventId: selectedEvent.id, isSystemAdmin, more: moreContext })
    : [];
  const eventPlace = currentEventPlace(pathname, search);
  const eventTabs = markCurrentEventTab(builtEventTabs, eventPlace);

  const rail = railItems(viewer, eventTabs[0]?.href ?? null).map((item) => ({
    ...item,
    // Events opens the selected event for staff with no Events row; Home and the rest keep the event they were in.
    href: item.area === "clubs" ? item.href : carry(item.href),
  }));
  const areaRow: AreaTab[] = place.inEvent
    ? []
    : markCurrentTab(areaTabs(place.area, viewer), place).map((tab) => ({
      ...tab,
      href: carry(tab.href),
      views: tab.views?.map((view) => ({ ...view, href: carry(view.href) })),
    }));
  const rowTabs: Array<EventTab | AreaTab> = place.inEvent ? eventTabs : areaRow;

  // The phone: Home, Events, Check-in, Clubs and More. More lists "This event" first inside an event, then the other areas.
  const homeHref = viewer.held.length > 0 ? carry(adminRoleLanding(activeRole)) : undefined;
  const onBar = new Set(phoneBarItems({ rail, eventTabs, moreHref: "/help", homeHref }).map((item) => item.href));
  const areaItems = rail.filter((item) => !onBar.has(item.href));
  const launcherSections: LauncherSection[] = [
    ...(place.inEvent && eventTabs.length > 0
      ? [{ key: "this-event", label: "This event", items: eventTabs.map((tab) => ({ key: tab.key, label: tab.label, href: tab.href, current: tab.current })) }]
      : []),
    ...(areaItems.length > 0
      ? [{ key: "areas", label: "Areas", items: areaItems.map((item) => ({ key: item.area, label: item.label, href: item.href, current: item.area === place.area })) }]
      : []),
  ];
  // More only appears when it adds something the bar does not already open: tools, other areas, or event tabs the bar lacks.
  const moreHasContent = launcherCards.some((card) => card.allowed)
    || areaItems.length > 0
    || (place.inEvent && eventTabs.some((tab) => !onBar.has(tab.href)));
  const phoneItems = phoneBarItems({
    rail,
    eventTabs,
    homeHref,
    moreHref: moreHasContent ? (showMore && selectedEventId ? `/more${eventQuery}` : withCurrentEvent("/help", selectedEventId)) : null,
  });

  return {
    place,
    viewer,
    moreContext,
    showMore,
    eventQuery,
    carry,
    rail,
    eventTabs,
    eventPlace,
    rowTabs,
    currentTab: rowTabs.find((tab) => tab.current),
    launcherCards,
    launcherSections,
    phoneItems,
    eventsLanding: areaLandingHref("events", viewer),
  };
}

export type { EventTabKey };
