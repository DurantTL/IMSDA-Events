"use client";

import { BrandLink } from "@/components/brand-link";
import { PRODUCT_NAME } from "@/lib/brand";
import { StaffViewerProvider } from "@/components/staff-viewer-context";
import type { HelpViewer } from "@/modules/help/visibility";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LifeBuoy } from "lucide-react";
import { EventAutoSelectNotice } from "@/components/event-auto-select-notice";
import { rememberLastUsedEvent } from "@/components/remember-last-event";
import { guardedNavigate } from "@/components/unsaved-changes-registry";
import { ClubsYearSelector } from "@/components/clubs-year-selector";
import { StaffHeaderSearch } from "@/components/staff-header-search";
import { GuardedLink } from "@/components/guarded-link";
import { WorkspaceContent, workspacePageKey } from "@/components/workspace-content";
import { moduleDestinationStates } from "@/components/module-destination-states";
import { buildSearchDestinations } from "@/components/destination-search-model";
import { eventToRemember, refreshAfterRemember, resolveShellEvent, switchEvent } from "@/components/shell-event-selection";
import { createEventHrefFor, isSystemWorkspacePath } from "@/components/system-navigation";
import { isEventModuleKey } from "@/modules/event-modules/catalog";
import { AdminAttentionBell } from "@/components/admin-attention-bell";
import { StaffCreateMenu } from "@/components/staff-create-menu";
import { StaffAccountMenu } from "@/components/staff-account-menu";
import { StaffRail } from "@/components/staff-rail";
import { StaffTabRow } from "@/components/staff-tab-row";
import { StaffViewStrip } from "@/components/staff-view-strip";
import { StaffPhoneBar } from "@/components/staff-phone-bar";
import { StaffKeyboardWatch } from "@/components/staff-keyboard-watch";
import { buildStaffNavigation } from "@/components/staff-navigation-model";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { showsWorkContextChip } from "@/components/work-context-model";
import { showsClubYearSelector, staffAreaMeta } from "@/components/staff-areas";
import { eventPermissions, type EventPermission } from "@/modules/access/permissions";
import { staffWorkspaceOptions } from "@/modules/access/workspace-contexts";
import { adminRoleLanding, type AdminRole, type AdminRoleCounts } from "@/modules/access/admin-roles-domain";
import {
  eventsAdminHomeItem,
  helpPageTitle,
  staffShellPageTitle,
  withCurrentEvent,
} from "@/components/staff-navigation";
import styles from "@/components/staff-shell.module.css";

const archivedChoice = "__archived-events__";

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

/**
 * The staff shell (#1565): a branded header (logo, "Find a page or task", Help, Create, notifications, the account menu
 * with the workspace switcher), an icon rail of the areas this person can reach, and below it the page column with that
 * area's one row of tabs, or inside an event the event's tabs. There is no sidebar. Only when a row would
 * not fit, at any width, it becomes a menu line (#1734). On a phone the bottom bar is Home, Events, Check-in, Clubs and More. Everything here
 * only decides which links to draw; every page and route keeps its own server-side authorization.
 */
export function AppShell({
  attendeeAccountAvailable = false,
  autoSelected = false,
  children,
  defaultEventId = null,
  events,
  user,
  adminRoleView = null,
  siteContentEditor = false,
  youthDirectory = false,
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
   * The admin roles this account holds and the one showing (#1225), computed server-side. Only the roles held decide which
   * rail areas and tabs show, and which dashboard Home opens; no server gate reads it.
   */
  adminRoleView?: { held: AdminRole[]; active: AdminRole | null; counts: AdminRoleCounts; healthImport?: boolean } | null;
  /** An active Site content editor who is not a system administrator (#111): adds Homepage & site content to the Admin area. */
  siteContentEditor?: boolean;
  /** An active Youth Admin who is not a system administrator (#1685): adds the Youth directory to the Clubs area and to Find a page. */
  youthDirectory?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The staff-only profile page (#623) lives inside the shell but is no nav item.
  const isProfileRoute = pathname === "/profile" || pathname.startsWith("/profile/");
  // Help & learning (#1077) is open to every staff member and is no nav item: it lights its own link only.
  const isHelpRoute = pathname === "/help" || pathname.startsWith("/help/");
  const isSystemRoute = isSystemWorkspacePath(pathname);
  // The header names the page the staff member is on (#685): a `/more/*` page that isn't a nav item names itself instead of reading "More".
  const pageTitle = staffShellPageTitle(pathname);
  // A page that draws its own PageHeader title owns its h1 (#1772); the shell then draws none, so there is never a second one.
  const pageDrawsOwnHeader = pageOwnsHeader(pathname);
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
  const selectedPermissions = new Set(
    events.find((event) => event.id === selectedEventId)?.permissions ?? [],
  );
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  // What the pages below need to decide which Help links and Set up links this viewer may follow (#1435).
  const staffViewer: HelpViewer = { isSystemAdmin, isClubsAdministrator: isSystemAdmin || Boolean(adminRoleView?.held.includes("CLUBS_ADMIN")), selectedEventId, permissions: isSystemAdmin ? [...eventPermissions] : [...selectedPermissions] };

  // Staff with no events can still open their profile (#623); every event control and event-scoped tab would dead-end for them.
  const eventlessProfile = (isProfileRoute || isHelpRoute) && events.length === 0 && !isSystemAdmin;
  // Everything navigation draws, decided once (`buildStaffNavigation`): the rail, the one row of tabs, the phone bar and More.
  const nav = buildStaffNavigation({
    pathname,
    search: searchParams,
    isSystemAdmin,
    adminRoleView,
    siteContentEditor,
    youthDirectory,
    hasEvents: events.length > 0,
    selectedEvent: selectedEvent ? { ...selectedEvent, clubFormsAccess: selectedEvent.clubFormsAccess } : undefined,
    eventlessProfile,
  });
  const { place, viewer, eventTabs, eventPlace, rail, rowTabs, currentTab, eventQuery, carry, launcherCards, launcherSections, phoneItems, eventsLanding, moreContext } = nav;
  // Possible duplicate people (/people/matches) is a System page outside /admin (#1886): it lights System administration.
  const onSystemPage = isSystemRoute || place.tab === "system-administration";
  const held = viewer.held;
  const activeRole = viewer.activeRole;
  const selectedHiddenCardKeys = moreContext.hiddenCardKeys;
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
  const pickerEvents = events.filter((event) => !event.archived || event.id === selectedEventId);

  // Find a page (#1177): the destinations this viewer may open, from the same registry and rules as the menus. No event data is searched.
  const searchDestinations = buildSearchDestinations({
    isSystemAdmin,
    selectedEventId: eventlessProfile ? "" : selectedEventId,
    permissions: [...selectedPermissions],
    clubOversight: Boolean(selectedEvent?.clubOversight),
    clubEvent: Boolean(selectedEvent?.clubEvent),
    clubFormsAccess: Boolean(selectedEvent?.clubFormsAccess),
    hiddenCardKeys: selectedHiddenCardKeys,
    clubsAdmin: held.includes("CLUBS_ADMIN") ? { healthImport: viewer.healthImport } : undefined,
    siteContentEditor,
    youthDirectory,
  });
  const attendeePreviewHref = selectedEvent
    ? `/account/events/${encodeURIComponent(selectedEvent.slug)}?preview=staff`
    : "/account";
  const canRequestFeature = !isSystemAdmin && selectedPermissions.has("CONFIGURE_EVENT");
  // The account menu's workspace switcher (#108): only the workspaces this person holds, with no second sign-in.
  const workspaces = staffWorkspaceOptions({
    isSystemAdmin,
    attendeeAccountAvailable,
    staffHref: eventTabs[0]?.href ?? withCurrentEvent(adminRoleLanding(activeRole), selectedEventId),
    onSystemPage: isSystemAdmin && onSystemPage,
  });

  // Which work context the page is in (#1180). A label only; it grants nothing. The Event administration badge stays.
  const workContext = place.tab === "event-administration" && place.area === "events"
    ? { kind: "event" as const, kindLabel: "Events", label: eventsAdminHomeItem.label, detail: "All assigned events" }
    : place.area === "clubs"
    ? { kind: "system" as const, kindLabel: "Clubs", label: "Clubs administration", detail: "All clubs" }
    : isProfileRoute
    ? { kind: "profile" as const, kindLabel: "Account", label: "Your account", detail: "Not tied to an event" }
    // Home (#1568) spans every event and role the person holds, so it names no single event.
    : place.area === "home" && (pathname === "/home" || pathname.startsWith("/home/"))
    ? { kind: "profile" as const, kindLabel: "Home", label: "Your work", detail: "Across your events and roles" }
    : place.inEvent
    ? { kind: "event" as const, kindLabel: "Event", label: selectedEvent?.name?.trim() || "No event selected", detail: "Event workspace" }
    : onSystemPage && isSystemAdmin
    ? { kind: "system" as const, kindLabel: "System", label: "System administration", detail: "All events" }
    : { kind: "event" as const, kindLabel: selectedEvent ? "Event" : "Staff", label: selectedEvent?.name?.trim() || "Staff workspace", detail: "" };

  // The event bar and the tab row name the place already (#1733); the line under the heading stays only where nothing else does.
  const eventBarShown = place.inEvent && Boolean(selectedEvent) && !eventlessProfile;
  const showContextChip = showsWorkContextChip({
    context: workContext,
    eventName: selectedEvent?.name,
    pageTitle,
    shownPlaceNames: [eventBarShown ? selectedEvent?.name : null, place.inEvent ? selectedEvent?.name : staffAreaMeta[place.area].label],
  });

  // Saves the event as the remembered one, then refreshes only a page that relies on it (#1745): a page whose address
  // names its event is already right, and refreshing it can cancel a sort or filter the user just chose.
  function rememberEvent(eventId: string) {
    return rememberLastUsedEvent(eventId).then(() => {
      if (refreshAfterRemember(window.location.search)) router.refresh();
    });
  }

  // An event named in the URL becomes the remembered selection (#616), so the
  // next page without `?event=` keeps it instead of falling back to the default.
  const lastRememberedId = useRef<string | null>(defaultEventId);
  const knownEventIds = events.filter((event) => !event.archived).map((event) => event.id).join("|");
  useEffect(() => {
    const toRemember = eventToRemember({
      requestedEventId,
      knownEventIds: knownEventIds ? knownEventIds.split("|") : [],
      lastRememberedId: lastRememberedId.current,
    });
    if (toRemember) {
      lastRememberedId.current = toRemember;
      void rememberEvent(toRemember);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedEventId, knownEventIds]);

  function selectEvent(eventId: string) {
    // "Archived events" is the switcher's last choice (#1747): same page as before, guarded like any other move.
    if (eventId === archivedChoice) {
      void guardedNavigate(() => router.push("/archived-events"));
      return;
    }
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
        // The switch goes to an address that names the event, so no refresh is needed (#1745).
        void rememberLastUsedEvent(id);
      },
      push: (href) => router.push(href),
    });
  }

  // Opening an event from an area page (the Events row): the event's own first page, guarded like every move.
  function openEvent(eventId: string) {
    void guardedNavigate(() => {
      lastRememberedId.current = eventId;
      setSeenEventId(eventId);
      void rememberLastUsedEvent(eventId);
      router.push(`/overview?event=${encodeURIComponent(eventId)}`);
    });
  }

  const picker = (
    <span className={styles.pickerShell}>
      <select
        id="event-picker"
        aria-label="Switch event"
        title={selectedEvent ? selectedEvent.name : undefined}
        value={selectedEventId}
        onChange={(event) => selectEvent(event.target.value)}
      >
        {!selectedEventId && <option value="" disabled>Choose an event</option>}
        {pickerEvents.map((event) => <option value={event.id} key={event.id}>{event.archived ? `${event.name} (archived)` : event.name}</option>)}
        <option value={archivedChoice}>Archived events…</option>
      </select>
      {/* A native select clips a long name mid-word; this label shows it with an ellipsis instead, and the select's title gives the full name (#1753). */}
      <span className={styles.pickerNameLabel} aria-hidden="true">{selectedEvent ? (selectedEvent.archived ? `${selectedEvent.name} (archived)` : selectedEvent.name) : "Choose an event"}</span>
      {/* On a phone the select shows this short label (the select's own name stays "Switch event"), not the event's name again; the select still takes the tap. */}
      <span className={styles.pickerPhoneLabel} aria-hidden="true">Switch</span>
      <ChevronDown aria-hidden="true" size={16} />
    </span>
  );
  const openPicker = pickerEvents.length > 0 && place.area === "events" && !place.inEvent ? (
    <span className={styles.pickerShell}>
      <select id="event-opener" aria-label="Open an event" value="" onChange={(event) => { if (event.target.value) openEvent(event.target.value); }}>
        <option value="" disabled>Open an event</option>
        {pickerEvents.map((event) => <option value={event.id} key={event.id}>{event.archived ? `${event.name} (archived)` : event.name}</option>)}
      </select>
      <ChevronDown aria-hidden="true" size={16} />
    </span>
  ) : null;

  return (
    <div className={`app-shell ${styles.shell}`}>
      <a className="skip-link" href="#workspace-content">Skip to main content</a>
      <StaffKeyboardWatch />
      <header className={styles.topbar} data-shell-region>
        <BrandLink guarded className={styles.brand} wordmark={<span className={styles.brandText}><strong>{PRODUCT_NAME}</strong><small>Events</small></span>} />
        <StaffHeaderSearch destinations={searchDestinations} inputId={destinationSearchInputId} />
        <div className={styles.topActions}>
          <GuardedLink className={styles.topLink} href={withCurrentEvent("/help", selectedEventId)} aria-label={helpPageTitle} aria-current={isHelpRoute ? "page" : undefined}>
            <LifeBuoy aria-hidden="true" size={18} /><span>{helpPageTitle}</span>
          </GuardedLink>
          <StaffCreateMenu isSystemAdmin={isSystemAdmin} clubFormsAccess={isSystemAdmin || held.includes("CLUBS_ADMIN")} canManageForms={selectedPermissions.has("MANAGE_FORMS")} eventId={place.inEvent ? selectedEventId : ""} />
          {isSystemAdmin && <AdminAttentionBell />}
          <StaffAccountMenu
            attendeePreviewHref={attendeePreviewHref}
            createEventHref={createEventHrefFor(isSystemAdmin)}
            displayName={user.displayName}
            email={user.email}
            workspaces={workspaces}
          />
        </div>
      </header>
      <div className={styles.body} data-shell-region>
        {rail.length > 0 && <StaffRail items={rail} current={place.area} />}
        <main className={`workspace ${styles.page}`}>
          {place.inEvent && selectedEvent && !eventlessProfile && (
            <div className={styles.eventBar}>
              {eventsLanding && <GuardedLink className={styles.crumb} href={carry(eventsLanding)}>‹ Events</GuardedLink>}
              <span className={styles.eventName}>{selectedEvent.name}</span>
              <div className={styles.eventTools}>
                <span className={styles.picker}>{picker}</span>
              </div>
            </div>
          )}
          <StaffTabRow
            label={place.inEvent ? (selectedEvent?.name ?? "Event") : staffAreaMeta[place.area].label}
            menuLabel={place.inEvent ? "Event menu" : staffAreaMeta[place.area].menuLabel}
            title={place.inEvent ? "Event menu" : staffAreaMeta[place.area].menuLabel}
            tabs={rowTabs}
            trailing={showsClubYearSelector(place) ? <ClubsYearSelector /> : place.area === "clubs" && !place.inEvent ? null : openPicker}
          />
          {currentTab?.views && currentTab.views.length > 1 && <StaffViewStrip label={`${currentTab.label} views`} views={currentTab.views} />}
          {!pageDrawsOwnHeader && (
            <header className={styles.pageHeader}>
              <div>
                <h1 className={styles.pageTitle}>{pageTitle}</h1>
                {showContextChip && (
                  <p className="work-context" data-context={workContext.kind}>
                    <span className="work-context-kind">{workContext.kindLabel}</span>
                    <span className="work-context-name" title={workContext.label}>{workContext.label}</span>
                  </p>
                )}
              </div>
            </header>
          )}
          <WorkspaceContent pageKey={workspacePageKey(pathname, searchParams)}>
            {!requestedEventId && !seenEventId && autoSelected && Boolean(defaultEvent) && place.inEvent && !isProfileRoute && defaultEvent && (
              <EventAutoSelectNotice
                eventName={defaultEvent.name}
                switchHref={isSystemAdmin ? "/admin" : "/select-event"}
              />
            )}
            <StaffViewerProvider value={staffViewer}>{children}</StaffViewerProvider>
          </WorkspaceContent>
        </main>
      </div>
      <StaffPhoneBar
        items={phoneItems}
        place={place}
        eventTab={place.inEvent ? eventPlace.tab : null}
        firstEventTab={eventTabs[0]?.key ?? null}
        pageMarkedAbove={Boolean(currentTab)}
        launcher={{
          cards: launcherCards,
          sections: launcherSections,
          moduleStates,
          destinations: searchDestinations,
          isSystemAdmin,
          canRequestFeature,
          eventQuery,
          eventId: selectedEventId || undefined,
          removableModules: isSystemAdmin ? selectedEvent?.removableModules : undefined,
          userId: user.id ?? "",
        }}
      />
    </div>
  );
}
