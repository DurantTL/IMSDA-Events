"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  Eye,
  Search,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { EventAutoSelectNotice } from "@/components/event-auto-select-notice";
import { rememberLastUsedEvent } from "@/components/remember-last-event";
import { guardedNavigate } from "@/components/unsaved-changes-registry";
import { DestinationSearch } from "@/components/destination-search";
import { GuardedLink } from "@/components/guarded-link";
import { SystemPhoneMenu } from "@/components/system-phone-menu";
import { moduleDestinationStates } from "@/components/module-destination-states";
import { activeWorkContext, returnToSystemHref, showsSystemChrome, systemMenuGroups, workContextSwitches } from "@/components/work-context-model";
import { buildSearchDestinations } from "@/components/destination-search-model";
import { eventToRemember, resolveShellEvent, switchEvent } from "@/components/shell-event-selection";
import {
  applySidebarAttribute,
  getSidebarCollapsedServerSnapshot,
  getSidebarCollapsedSnapshot,
  setSidebarCollapsed,
  subscribeSidebarCollapsed,
} from "@/components/sidebar-collapse";
import {
  dismissalAfterNavigation,
  getSidebarGroupsServerSnapshot,
  getSidebarGroupsSnapshot,
  resolveSidebarGroupOpen,
  type SidebarGroupKey,
  setSidebarGroupOpen,
  subscribeSidebarGroups,
} from "@/components/sidebar-groups";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { createEventHrefFor, isSystemWorkspacePath, systemNavActiveEntryKey, systemNavEntryKey, systemNavGroups } from "@/components/system-navigation";
import { alwaysOnModuleKeys, disabledModuleCardKeys, isEventModuleKey } from "@/modules/event-modules/catalog";
import { MoreLauncher } from "@/components/more-launcher";
import { AdminAttentionBell } from "@/components/admin-attention-bell";
import { AdminRoleSwitcher } from "@/components/admin-role-switcher";
import { adminRoleSidebarKind, type AdminRole, type AdminRoleCounts } from "@/modules/access/admin-roles-domain";
import { StaffAccountMenu } from "@/components/staff-account-menu";
import type { EventPermission } from "@/modules/access/permissions";
import { otherWorkspaceContextsForStaff } from "@/modules/access/workspace-contexts";
import {
  buildMoreDirectoryCards,
  canShowMoreLauncher,
  mobileActiveTabHref,
  eventFeaturesItem,
  isEventFeaturesPath,
  mobileNavigationLabels,
  navigation,
  orderedMobileTabs,
  orderedSidebarItems,
  sidebarActiveHref,
  sidebarSections,
  clubsAdminActiveHref,
  clubsAdminHealthImportHref,
  clubsAdminNavigation,
  staffSubpageTitle,
  systemNavigation,
  withCurrentEvent,
  type NavigationItem,
} from "@/components/staff-navigation";

type ShellEvent = {
  id: string;
  slug: string;
  name: string;
  /** Archived (#635): left out of the pickers unless it is the event being viewed, and never remembered as the last-used event. */
  archived?: boolean;
  permissions: readonly EventPermission[];
  /** Whether this event's club oversight (#387) is open to the signed-in user, computed server-side. */
  clubOversight?: boolean;
  /** Whether the event has a CLUB audience (#737), so the More launcher can admit club-only cards. */
  clubEvent?: boolean;
  /**
   * More cards hidden for this event because their module is off (#741),
   * computed server-side. Relevance only: pages keep their own authorization.
   */
  hiddenCardKeys?: readonly string[];
  /** Module keys a system administrator may turn off for this event (#810), computed server-side with the Event modules page's rule. */
  removableModules?: readonly string[];
  /** Modules whose data keeps them usable for this event, so the module states match the Event features page (#1180). */
  dataPresentModules?: readonly string[];
  /** Club forms (#610) are open to system admins, Clubs Administrators and Event Admins of a current event; computed server-side. */
  clubFormsAccess?: boolean;
};
type ShellUser = { id?: string; displayName: string; email: string; globalRole?: "SYSTEM_ADMIN" | null };

const destinationSearchInputId = "destination-search-input";

export function AppShell({
  attendeeAccountAvailable = false,
  autoSelected = false,
  children,
  defaultEventId = null,
  events,
  user,
  adminRoleView = null,
}: {
  attendeeAccountAvailable?: boolean;
  /** The default event was chosen automatically (#465): show the notice on pages without `?event=`. */
  autoSelected?: boolean;
  children: React.ReactNode;
  /**
   * The event a page with no `?event=` shows, from the same
   * `selectEventContext` decision the page makes (#465); `null` when nothing
   * can be chosen automatically. Never `events[0]` by position.
   */
  defaultEventId?: string | null;
  events: ShellEvent[];
  user: ShellUser;
  /**
   * The admin roles this account holds and the one showing (#1225), computed server-side. The switcher changes the
   * sidebar and home only; no server gate reads it.
   */
  adminRoleView?: { held: AdminRole[]; active: AdminRole | null; counts: AdminRoleCounts; healthImport?: boolean } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Icons-only sidebar (#446). Starts expanded so the server and first client
  // render match; the saved choice is applied after mount.
  const collapsed = useSyncExternalStore(subscribeSidebarCollapsed, getSidebarCollapsedSnapshot, getSidebarCollapsedServerSnapshot);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  // Keep <html> in step with the choice, for the stylesheet (and when the inline script did not run).
  useEffect(() => { applySidebarAttribute(collapsed); }, [collapsed]);
  function openSearch() {
    setTooltip(null);
    setSidebarCollapsed(false);
    // The field is shown again on the next frame; focus it then.
    window.requestAnimationFrame(() => document.getElementById(destinationSearchInputId)?.focus());
  }
  function toggleCollapsed() {
    setTooltip(null);
    setSidebarCollapsed(!collapsed);
  }
  // A tooltip for the icon-only sidebar, on hover and keyboard focus. It is
  // drawn outside the sidebar, whose overflow would clip it.
  function showTip(element: HTMLElement, label: string) {
    const rect = element.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  }
  const tipProps = (label: string) => collapsed ? {
    onMouseEnter: (event: { currentTarget: HTMLElement }) => showTip(event.currentTarget, label),
    onFocus: (event: { currentTarget: HTMLElement }) => showTip(event.currentTarget, label),
    onMouseLeave: () => setTooltip(null),
    onBlur: () => setTooltip(null),
  } : {};
  // Set up and Reports open and close (#964). Saved per browser; the server
  // always renders with nothing saved, and the pages inside a group open it.
  const savedGroups = useSyncExternalStore(subscribeSidebarGroups, getSidebarGroupsSnapshot, getSidebarGroupsServerSnapshot);
  const [dismissedGroup, setDismissedGroup] = useState<{ section: SidebarGroupKey; pathname: string } | null>(null);
  // Closing a group lasts for that page only: any navigation forgets it. Reset
  // while rendering, not in an effect, so the very render after navigating is right.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setDismissedGroup(dismissalAfterNavigation(dismissedGroup, lastPathname, pathname));
  }
  const searchParams = useSearchParams();
  // The staff-only profile page (#623) lives inside the shell but is no nav item.
  const isProfileRoute = pathname === "/profile" || pathname.startsWith("/profile/");
  const isSystemRoute = isSystemWorkspacePath(pathname);
  const current = isSystemRoute
    ? systemNavigation
    // The most specific match wins, so /people/attendees is "Attendee list", not "Registrations".
    : navigation.reduce<NavigationItem | null>((best, item) => (
      pathname.startsWith(item.href) && (!best || item.href.length > best.href.length) ? item : best
    ), null) ?? navigation[0];
  // The header names the page the staff member is on (#685): a `/more/*`
  // page that isn't a nav item names itself instead of reading "More".
  // The Event features page (#965) is a Set up item, not More, whatever `current` says.
  const onEventFeatures = isEventFeaturesPath(pathname);
  const pageTitle = isProfileRoute ? "Your account" : staffSubpageTitle(pathname) ?? current.label;
  const requestedEventId = searchParams.get("event");
  const defaultEvent = defaultEventId
    ? events.find((event) => event.id === defaultEventId)
    : undefined;
  // The layout (and so `defaultEventId`) doesn't re-render on client
  // navigation, so keep the last valid event seen and fall back to the
  // default only when none has been seen (#616).
  const [seenEventId, setSeenEventId] = useState<string | null>(null);
  // Adjusting state during render (not in an effect) so the very render that
  // sees a new `?event=` also records it.
  if (requestedEventId && requestedEventId !== seenEventId && events.some((event) => event.id === requestedEventId)) {
    setSeenEventId(requestedEventId);
  }
  const selectedEvent = resolveShellEvent({ requestedEventId, events, seenEventId, defaultEventId });
  const selectedEventId = selectedEvent?.id ?? "";
  // Same rule as the page (#465): no `?event=` and an automatic choice. Not on
  // pages that aren't event-scoped (/admin, the global duplicate review).
  const showAutoSelectNotice = !requestedEventId && !seenEventId && autoSelected && Boolean(defaultEvent)
    && !isSystemRoute && !pathname.startsWith("/people/matches")
    && !isProfileRoute;
  const selectedPermissions = new Set(
    events.find((event) => event.id === selectedEventId)?.permissions ?? [],
  );
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  // The role switcher's view (#1225): Clubs swaps the sidebar for the club areas; System (or no switcher) is as before.
  const sidebarKind = adminRoleView ? adminRoleSidebarKind(adminRoleView.active) : "default";
  const clubsView = sidebarKind === "clubs";
  // A Clubs Administrator with any event membership keeps the event picker and sidebar (#1225 review); only one with
  // no events at all gets the club-only chrome.
  const clubsOnly = clubsView && events.length === 0;
  const activeClubsHref = clubsView ? clubsAdminActiveHref(pathname) : null;
  // The health record import page only exists while the Health Record feature is on (#1232).
  const clubsNavItems = clubsAdminNavigation.filter((item) => item.href !== clubsAdminHealthImportHref || adminRoleView?.healthImport !== false);
  // The phone Clubs bar scrolls sideways (#1232): bring the page's own item into view when the page changes.
  const clubsMobileNavRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!activeClubsHref) return;
    clubsMobileNavRef.current?.querySelector<HTMLElement>('a[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeClubsHref]);
  // Event Admins can ask for a module (#741 slice 3); system administrators turn modules on directly.
  const canRequestFeature = !isSystemAdmin && selectedPermissions.has("CONFIGURE_EVENT");
  // The other workspaces this staff identity may switch into (#108): the
  // account popover's System management link and both attendee switch
  // buttons read this, so they always agree with each other.
  const workspaceContexts = otherWorkspaceContextsForStaff({ isSystemAdmin, attendeeAccountAvailable });
  const systemAdminContext = workspaceContexts.find((context) => context.kind === "system_admin");
  const canSwitchToAttendee = workspaceContexts.some((context) => context.kind === "attendee");
  // Staff with no events can still open their profile (#623); every event
  // control and event-scoped nav item would dead-end for them, so hide them.
  const eventlessProfile = isProfileRoute && events.length === 0 && !isSystemAdmin;
  const eventQuery = selectedEventId ? `?event=${encodeURIComponent(selectedEventId)}` : "";
  const moreNavItem = navigation.find((item) => item.href === "/more");
  // More shows when any of its destinations is permitted (#737), not only for
  // the broad permissions it used to require; each page still checks access.
  // Module cards the launcher leaves out. An event the server did not load module
  // state for (an ended event) lists the universal tools only; the Event modules
  // page has the rest.
  const selectedHiddenCardKeys: ReadonlySet<string> = selectedEvent?.hiddenCardKeys
    ? new Set(selectedEvent.hiddenCardKeys)
    : disabledModuleCardKeys(new Set(alwaysOnModuleKeys));
  const showMore = Boolean(moreNavItem) && canShowMoreLauncher({
    item: moreNavItem!,
    permissions: [...selectedPermissions],
    clubOversight: Boolean(selectedEvent?.clubOversight),
    clubEvent: Boolean(selectedEvent?.clubEvent),
    isSystemAdmin: user.globalRole === "SYSTEM_ADMIN",
    clubFormsAccess: Boolean(selectedEvent?.clubFormsAccess),
    hiddenCardKeys: selectedHiddenCardKeys,
  });
  // The More launcher (#741): everything this staff member may open for the
  // selected event, the universal tools plus the enabled modules. Built here from
  // the same function the Event modules page and the parity test use.
  const launcherCards = selectedEvent ? buildMoreDirectoryCards({
    permissions: [...selectedPermissions],
    clubOversight: Boolean(selectedEvent.clubOversight),
    clubEvent: Boolean(selectedEvent.clubEvent),
    isSystemAdmin,
    clubFormsAccess: Boolean(selectedEvent.clubFormsAccess),
    eventQuery,
    hiddenCardKeys: selectedHiddenCardKeys,
  }) : [];
  // The fixed order lives in `sidebarSections` (#964) and `orderedSidebarItems`.
  // System management is not here: it is drawn once, above the event picker.
  const visibleNavigation: NavigationItem[] = eventlessProfile || clubsOnly
    ? []
    : orderedSidebarItems(selectedPermissions, showMore);
  const visibleSections = eventlessProfile || clubsOnly ? [] : sidebarSections(selectedPermissions);
  const moreItemVisible = visibleNavigation.find((item) => item.href === "/more");
  // A page that is no sidebar item lights its parent, or More when the viewer can't see it (#964).
  const visibleHrefs = new Set([...visibleSections.flatMap((view) => view.items.map((item) => item.href)), ...visibleNavigation.map((item) => item.href)]);
  // The hrefs of the sidebar links actually drawn for this viewer (not the More trigger, which opens the launcher).
  // The launcher drops cards and footer links that repeat one of these, so this must stay exactly what is drawn (#967).
  const drawnSidebarHrefs = new Set(visibleSections.flatMap((view) => view.items.map((item) => item.href)));
  const activeHref = onEventFeatures ? null : sidebarActiveHref(current, visibleHrefs);
  const isItemActive = (item: NavigationItem) => {
    if (isProfileRoute) return false;
    // Event features lights on its own page, which is under /more but must not light More (#965).
    if (item.href === eventFeaturesItem.href) return onEventFeatures;
    return item.href.startsWith("/admin") ? pathname.startsWith(item.href) : activeHref === item.href;
  };
  function toggleGroup(section: SidebarGroupKey, open: boolean) {
    setSidebarGroupOpen(section, !open);
    setDismissedGroup(open ? { section, pathname } : null);
  }
  // On /admin pages a system administrator's sidebar lists the system groups (#966), not the event workspace's.
  const showSystemNav = sidebarKind === "default" && showsSystemChrome({ isSystemAdmin, pathname });
  const activeSystemEntry = showSystemNav ? systemNavActiveEntryKey(pathname) : null;
  // Which work context the page is in (#1180): System, the selected event or the account page. A label only; it grants nothing.
  const workContext = clubsView
    ? { kind: "system" as const, kindLabel: "Clubs", label: "Clubs administration", detail: "All clubs" }
    : activeWorkContext({ pathname, isSystemAdmin, eventName: selectedEvent?.name });
  const contextSwitches = workContextSwitches({ isSystemAdmin, attendeeAccountAvailable, selectedEventId, active: workContext.kind });
  // The phone System menu lists the same destinations as the desktop System sidebar, and nothing without the role.
  const systemMenu = showSystemNav ? systemMenuGroups({ isSystemAdmin, pathname, selectedEventId }) : [];
  // Module states (#741 rules) for the selected event, only where the server loaded them.
  const moduleStates = selectedEvent?.hiddenCardKeys
    ? moduleDestinationStates({
      hiddenCardKeys: selectedHiddenCardKeys,
      dataPresent: new Set((selectedEvent.dataPresentModules ?? []).filter(isEventModuleKey)),
      audience: selectedEvent.clubEvent ? "CLUB" : "GENERAL",
      isSystemAdmin,
      canConfigure: selectedPermissions.has("CONFIGURE_EVENT"),
      eventQuery,
    })
    : [];
  // The mobile tab bar keeps its own, shorter order (see `mobileNavigationOrder`).
  const mobileNavigation = orderedMobileTabs(visibleNavigation);
  // Find a page (#1177): the destinations this viewer may open, from the same registry and rules as the menus. No event data is searched.
  const searchDestinations = buildSearchDestinations({
    isSystemAdmin,
    selectedEventId: eventlessProfile ? "" : selectedEventId,
    permissions: [...selectedPermissions],
    clubOversight: Boolean(selectedEvent?.clubOversight),
    clubEvent: Boolean(selectedEvent?.clubEvent),
    clubFormsAccess: Boolean(selectedEvent?.clubFormsAccess),
    hiddenCardKeys: selectedHiddenCardKeys,
  });
  const attendeePreviewHref = selectedEvent
    ? `/account/events/${encodeURIComponent(selectedEvent.slug)}?preview=staff`
    : "/account";

  // An event named in the URL becomes the remembered selection (#616), so the
  // next page without `?event=` keeps it instead of falling back to the default.
  const lastRememberedId = useRef<string | null>(defaultEventId);
  const knownEventIds = events.filter((event) => !event.archived).map((event) => event.id).join("|");
  // The pickers list live events only (#635); an archived event being viewed by link stays listed, marked, so the picker is not blank.
  const pickerEvents = events.filter((event) => !event.archived || event.id === selectedEventId);
  useEffect(() => {
    const toRemember = eventToRemember({
      requestedEventId,
      knownEventIds: knownEventIds ? knownEventIds.split("|") : [],
      lastRememberedId: lastRememberedId.current,
    });
    if (toRemember) {
      lastRememberedId.current = toRemember;
      // Refresh once the cookie is set so the server default catches up.
      void rememberLastUsedEvent(toRemember).then(() => router.refresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedEventId, knownEventIds]);

  function selectEvent(eventId: string) {
    // Guarded (#647): a dirty form prompts first; Cancel changes nothing.
    switchEvent({
      eventId,
      pathname,
      currentSearch: searchParams.toString(),
      guard: guardedNavigate,
      commit: (id) => {
        // Remembered for the next sign-in (#108 queue 1); never blocks the switch.
        lastRememberedId.current = id;
        setSeenEventId(id);
        void rememberLastUsedEvent(id).then(() => router.refresh());
      },
      push: (href) => router.push(href),
    });
  }

  return (
    <div className="app-shell" 
      onKeyDown={(event) => { if (event.key === "Escape" && tooltip) setTooltip(null); }}>
      <a className="skip-link" href="#workspace-content">Skip to main content</a>
      <aside className="sidebar" aria-label="Application navigation" onScrollCapture={() => setTooltip(null)}>
        <GuardedLink className="brand" href="/" aria-label="IMSDA Events home" {...tipProps("IMSDA Events home")}>
          <BrandMark />
          <span><strong>IMSDA</strong><small>Events</small></span>
        </GuardedLink>

        <SidebarToggle collapsed={collapsed} onToggle={toggleCollapsed} tipProps={tipProps("Expand sidebar")} />

        {user.globalRole === "SYSTEM_ADMIN" && sidebarKind === "default" && (
          <div className="system-navigation">
            <span className="system-navigation-label">Global administration</span>
            <GuardedLink
              className={isSystemRoute ? "system-navigation-link active" : "system-navigation-link"}
              href={returnToSystemHref(selectedEventId)}
              aria-current={isSystemRoute ? "page" : undefined}
              {...tipProps("System management")}
            >
              <span className="system-navigation-icon">
                <ShieldCheck aria-hidden="true" size={19} strokeWidth={1.9} />
              </span>
              <span>
                <strong>System management</strong>
                <small>All events and integrations</small>
              </span>
            </GuardedLink>
          </div>
        )}

        {!eventlessProfile && !clubsOnly && <span className="event-workspace-label">Event workspace</span>}
        {!eventlessProfile && !clubsOnly && <div className="event-picker-wrap">
          <label className="sr-only" htmlFor="event-picker">Event workspace</label>
          <div className="select-shell">
            <select
              id="event-picker"
              value={selectedEventId}
              onChange={(event) => selectEvent(event.target.value)}
            >
              {!selectedEventId && <option value="" disabled>Choose an event</option>}
              {pickerEvents.map((event) => <option value={event.id} key={event.id}>{event.archived ? `${event.name} (archived)` : event.name}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={16} />
          </div>
          {!showSystemNav && <GuardedLink className="event-picker-archived-link" href="/archived-events">Archived events</GuardedLink>}
        </div>}

        <div className="sidebar-destination-search">
          <DestinationSearch destinations={searchDestinations} inputId={destinationSearchInputId} />
          {/* The collapsed sidebar has no room for the field: this button opens it and moves focus into the field. */}
          <button
            type="button"
            className="sidebar-search-button"
            aria-label="Find a page or task"
            onClick={openSearch}
            {...tipProps("Find a page or task")}
          >
            <Search aria-hidden="true" size={19} strokeWidth={1.9} />
          </button>
        </div>

        <nav className="primary-nav" id="primary-navigation" aria-label="Primary navigation">
          {clubsView && clubsNavItems.map(({ href, icon: Icon, label }) => (
            <GuardedLink key={href} className={activeClubsHref === href ? "nav-item active" : "nav-item"} href={href} aria-current={activeClubsHref === href ? "page" : undefined} {...tipProps(label)}>
              <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
              <span>{label}</span>
            </GuardedLink>
          ))}
          {showSystemNav && (
            <>
              <GuardedLink className="nav-item" href={withCurrentEvent("/overview", selectedEventId)} {...tipProps("Event workspace")}>
                <LayoutDashboard aria-hidden="true" size={19} strokeWidth={1.9} />
                <span>Event workspace</span>
              </GuardedLink>
              {systemNavGroups.map((group) => {
                const links = group.items.map((item) => {
                  const { href, icon: Icon, label } = item;
                  const isActive = activeSystemEntry === systemNavEntryKey(group, item);
                  return (
                    <GuardedLink key={href} className={isActive ? "nav-item active" : "nav-item"} href={withCurrentEvent(href, selectedEventId)} aria-current={isActive ? "page" : undefined} {...tipProps(label)}>
                      <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
                      <span>{label}</span>
                    </GuardedLink>
                  );
                });
                const open = resolveSidebarGroupOpen({
                  saved: savedGroups[group.key],
                  containsCurrentPage: group.items.some((item) => activeSystemEntry === systemNavEntryKey(group, item)),
                  dismissedOnThisPage: dismissedGroup?.section === group.key && dismissedGroup.pathname === pathname,
                  defaultOpen: !group.collapsedByDefault,
                });
                return (
                  <div className="nav-group" key={group.key} data-open={open ? "true" : "false"}>
                    <button
                      type="button"
                      className="nav-group-toggle"
                      id={`nav-group-${group.key}-toggle`}
                      aria-expanded={open}
                      aria-controls={`nav-group-${group.key}`}
                      onClick={() => toggleGroup(group.key, open)}
                    >
                      <span>{group.label}</span>
                      <ChevronDown aria-hidden="true" size={14} />
                    </button>
                    <div className="nav-group-items" id={`nav-group-${group.key}`} role="group" aria-labelledby={`nav-group-${group.key}-toggle`} hidden={!open}>
                      {links}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {!showSystemNav && visibleSections.map(({ section, label: sectionLabel, collapsible, items }) => {
            const links = items.map((item) => {
              const { href, icon: Icon, label } = item;
              const isActive = isItemActive(item);
              return (
                <GuardedLink key={label} className={isActive ? "nav-item active" : "nav-item"} href={withCurrentEvent(href, selectedEventId)} aria-current={isActive ? "page" : undefined} {...tipProps(label)}>
                  <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
                  <span>{label}</span>
                </GuardedLink>
              );
            });
            // The daily items: no heading, always visible.
            if (!collapsible || !sectionLabel) return <Fragment key={section}>{links}</Fragment>;
            const open = resolveSidebarGroupOpen({
              saved: savedGroups[section],
              containsCurrentPage: items.some(isItemActive),
              dismissedOnThisPage: dismissedGroup?.section === section && dismissedGroup.pathname === pathname,
            });
            return (
              <div className="nav-group" key={section} data-open={open ? "true" : "false"}>
                <button
                  type="button"
                  className="nav-group-toggle"
                  id={`nav-group-${section}-toggle`}
                  aria-expanded={open}
                  aria-controls={`nav-group-${section}`}
                  onClick={() => toggleGroup(section, open)}
                >
                  <span>{sectionLabel}</span>
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
                <div className="nav-group-items" id={`nav-group-${section}`} role="group" aria-labelledby={`nav-group-${section}-toggle`} hidden={!open}>
                  {links}
                </div>
              </div>
            );
          })}
          {!showSystemNav && moreItemVisible && (() => {
            const { href, icon: Icon, label } = moreItemVisible;
            const isActive = isItemActive(moreItemVisible);
            return (
              <MoreLauncher
                key={href}
                variant="sidebar"
                className={isActive ? "nav-item active" : "nav-item"}
                href={withCurrentEvent(href, selectedEventId)}
                isActive={isActive}
                cards={launcherCards}
                moduleStates={moduleStates}
                sidebarHrefs={drawnSidebarHrefs}
                isSystemAdmin={isSystemAdmin}
                canRequestFeature={canRequestFeature}
                eventQuery={eventQuery}
                eventId={selectedEventId || undefined}
                removableModules={isSystemAdmin ? selectedEvent?.removableModules : undefined}
                userId={user.id ?? ""}
                tipProps={tipProps(label)}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
                <span>{label}</span>
              </MoreLauncher>
            );
          })()}
        </nav>

        <div className="sidebar-foot">
          <span className="sync-dot" aria-hidden="true" />
          <span><strong>Event database</strong><small>Access controlled</small></span>
        </div>
      </aside>
      {collapsed && tooltip && <div className="sidebar-tooltip" aria-hidden="true" style={{ top: tooltip.top, left: tooltip.left }}>{tooltip.label}</div>}

      <main className="workspace">
        {adminRoleView && <AdminRoleSwitcher active={adminRoleView.active} counts={adminRoleView.counts} held={adminRoleView.held} />}
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Staff workspace</p>
            <h1>{pageTitle}</h1>
            <p className="work-context" data-context={workContext.kind}>
              <span className="work-context-kind">{workContext.kindLabel}</span>
              <span className="work-context-name" title={workContext.label}>{workContext.label}</span>
              {workContext.kind === "system" && <span className="work-context-detail">{workContext.detail}</span>}
              {isSystemAdmin && workContext.kind === "event" && (
                <GuardedLink className="work-context-return" href={returnToSystemHref(selectedEventId)}>Back to System</GuardedLink>
              )}
            </p>
          </div>
          <div className="header-actions">
            {canSwitchToAttendee
              ? (
                <form action="/api/auth/switch-to-attendee" method="post">
                  <button
                    aria-label="My attendee account"
                    className="attendee-preview-switch"
                    title="Switch to your matching attendee account"
                    type="submit"
                  >
                    <ArrowRightLeft aria-hidden="true" size={16} />
                    <span>My attendee account</span>
                  </button>
                </form>
              )
              : !eventlessProfile && (
                <GuardedLink
                  aria-label="Attendee experience"
                  className="attendee-preview-switch"
                  href={attendeePreviewHref}
                  title={`Preview ${selectedEvent?.name ?? "this event"} as an attendee`}
                >
                  <Eye aria-hidden="true" size={16} />
                  <span>Attendee experience</span>
                </GuardedLink>
              )}
            <span className="staff-pill">Staff mode</span>
            {isSystemAdmin && <AdminAttentionBell />}
            <StaffAccountMenu
              attendeePreviewHref={attendeePreviewHref}
              canSwitchToAttendee={canSwitchToAttendee}
              createEventHref={createEventHrefFor(isSystemAdmin)}
              displayName={user.displayName}
              email={user.email}
              systemAdminContext={systemAdminContext ? { ...systemAdminContext, href: withCurrentEvent(systemAdminContext.href, selectedEventId) } : systemAdminContext}
            />
          </div>
          {!isSystemRoute && !eventlessProfile && !clubsOnly && (
            <label className="mobile-event-picker">
              <span className="sr-only">Current event</span>
              <select value={selectedEventId} onChange={(event) => selectEvent(event.target.value)}>
                {!selectedEventId && <option value="" disabled>Choose an event</option>}
                {pickerEvents.map((event) => <option value={event.id} key={event.id}>{event.archived ? `${event.name} (archived)` : event.name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" size={15} />
            </label>
          )}
        </header>
        <div className="workspace-content" id="workspace-content">
          {showAutoSelectNotice && defaultEvent && (
            <EventAutoSelectNotice
              eventName={defaultEvent.name}
              switchHref={isSystemAdmin ? "/admin" : "/select-event"}
            />
          )}
          {children}
        </div>
      </main>

      {showSystemNav && <SystemPhoneMenu isSystemAdmin={isSystemAdmin} groups={systemMenu} switches={contextSwitches} destinations={searchDestinations} />}
      {clubsView && <nav className="mobile-nav mobile-nav-scroll" aria-label="Mobile navigation" ref={clubsMobileNavRef}>
        {clubsNavItems.map(({ href, icon: Icon, label }) => (
          <GuardedLink className={activeClubsHref === href ? "active" : undefined} href={href} key={href} aria-current={activeClubsHref === href ? "page" : undefined}>
            <Icon aria-hidden="true" size={22} /><span>{label}</span>
          </GuardedLink>
        ))}
      </nav>}
      {!showSystemNav && !clubsView && mobileNavigation.length > 0 && <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileNavigation.map(({ href, icon: Icon, label }) => {
          const isActive = !isProfileRoute && !isSystemRoute && mobileActiveTabHref(current.href, pathname) === href;
          if (href === "/more") {
            return (
              <MoreLauncher
                key={href}
                variant="tab"
                className={isActive ? "active" : undefined}
                href={`${href}${eventQuery}`}
                isActive={isActive}
                cards={launcherCards}
                moduleStates={moduleStates}
                destinations={searchDestinations}
                isSystemAdmin={isSystemAdmin}
                canRequestFeature={canRequestFeature}
                eventQuery={eventQuery}
                eventId={selectedEventId || undefined}
                removableModules={isSystemAdmin ? selectedEvent?.removableModules : undefined}
                userId={user.id ?? ""}
              >
                <Icon aria-hidden="true" size={22} /><span>{mobileNavigationLabels[href] ?? label}</span>
              </MoreLauncher>
            );
          }
          return (
            <GuardedLink className={isActive ? "active" : undefined} href={`${href}${eventQuery}`} key={href} aria-current={isActive ? "page" : undefined} {...(mobileNavigationLabels[href] && mobileNavigationLabels[href] !== label ? { "aria-label": label, title: label } : {})}>
              <Icon aria-hidden="true" size={22} /><span>{mobileNavigationLabels[href] ?? label}</span>
            </GuardedLink>
          );
        })}
      </nav>}
    </div>
  );
}
