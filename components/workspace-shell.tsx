import { Suspense } from "react";
import { ActAsBanner } from "@/components/act-as-banner";
import { AppShell } from "@/components/app-shell";
import { removableModuleKeys } from "@/components/event-modules-page-model";
import { listActiveEventPermissionsForUser, listActiveEventRolesForUser } from "@/modules/access/membership-repository";
import { resolveAdminRoleView } from "@/modules/access/admin-roles";
import type { AdminRoleCounts } from "@/modules/access/admin-roles-domain";
import { eventPermissions } from "@/modules/access/permissions";
import { findSwitchableAttendeeAccountForStaff } from "@/modules/attendee-accounts/current-attendee";
import { disabledModuleCardKeys } from "@/modules/event-modules/catalog";
import { moduleStatesByEvent } from "@/modules/event-modules/service";
import { staffClubFormsAccess } from "@/modules/club-forms/access";
import { countWaitingNewClubApplications } from "@/modules/club-applications/repository";
import { eventsNeedingModuleState } from "@/modules/event-modules/shell-scope";
import { countEventsAdminWaiting } from "@/modules/events/events-admin-home-repository";
import { loadWorkspaceEventContext } from "@/modules/events/selection";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import { healthRecordsEnabled } from "@/modules/health-records/flag";

/**
 * The staff workspace chrome (sidebar, header, act-as banner), shared by the
 * `(workspace)` layout, which also hosts `/profile` (#646). The layout
 * passes `anyStaffWithoutEvents` for `/profile` so staff with no events still reach their profile
 * instead of being sent to /no-access.
 */
export async function WorkspaceShell({ anyStaffWithoutEvents = false, children }: { anyStaffWithoutEvents?: boolean; children: React.ReactNode }) {
  // Never redirects for event selection (#465): pages resolve their own
  // `?event=`; the layout only needs the default so the shell agrees with them.
  const { autoSelected, defaultEventId, events, user } = await loadWorkspaceEventContext({ anyStaffWithoutEvents });
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  const permissionsByEvent = isSystemAdmin
    ? new Map(events.map((event) => [event.id, [...eventPermissions]]))
    : await listActiveEventPermissionsForUser(user.id, events.map((event) => event.id));
  // Club oversight (#387, #428, #481): the same rule as resolveClubOversight —
  // an explicit CLUB-audience event, for its system admins or EVENT_ADMINs.
  // Audience, not billing mode, so an attendee-paid CLUB event still shows
  // club features, and a GENERAL event never does — even for a system admin.
  const rolesByEvent = isSystemAdmin ? new Map() : await listActiveEventRolesForUser(user.id, events.map((event) => event.id));
  // Which More cards are off per event (#741): rows plus the data a module works
  // on, in a fixed number of queries, for events that have not ended, ended within
  // 60 days, or are the default event (see `eventsNeedingModuleState`). For any
  // other event `hiddenCardKeys` is left out and the launcher lists the universal
  // tools only, with the link to the Event modules page for the rest.
  const modulesByEvent = await moduleStatesByEvent(eventsNeedingModuleState(events, defaultEventId));
  // Club forms (#610): one answer per user, from the same helper `resolveStaffViewer`
  // uses (system admin, or EVENT_ADMIN of any event that has not ended).
  // The admin role switcher (#1225): the roles held (read from the database now, so a revoke applies at once) and what is
  // waiting in each. The counts are for the pills only; a count that cannot be read is left off, never shown as zero.
  const adminRoleView = await resolveAdminRoleView(user);
  const clubFormsAccess = staffClubFormsAccess(
    user,
    events
      .filter((event) => rolesByEvent.get(event.id) === "EVENT_ADMIN")
      .map((event) => ({ role: "EVENT_ADMIN", event: { timezone: event.timezone, endsAt: event.endsAt } })),
    new Date(),
    adminRoleView.roles.clubsAdministrator,
  ).isStaff;
  const adminRoleCounts: AdminRoleCounts = {};
  const eventAdminEventIds = adminRoleView.roles.eventAdminEventIds;
  await Promise.all([
    eventAdminEventIds.length > 0
      ? countEventsAdminWaiting(eventAdminEventIds, new Date()).then((count) => { adminRoleCounts.EVENTS_ADMIN = count; }).catch(() => undefined)
      : undefined,
    adminRoleView.roles.clubsAdministrator || isSystemAdmin
      ? countWaitingNewClubApplications(isSystemAdmin ? "SYSTEM_ADMIN" : "CLUBS_ADMIN").then((count) => { adminRoleCounts.CLUBS_ADMIN = count; }).catch(() => undefined)
      : undefined,
    isSystemAdmin
      ? getAdminAttentionSummary().then((summary) => { adminRoleCounts.SYSTEM_ADMIN = summary.total; }).catch(() => undefined)
      : undefined,
  ]);
  const shellEvents = events.map((event) => ({
    id: event.id,
    slug: event.slug,
    name: event.name,
    archived: event.archivedAt !== null,
    permissions: permissionsByEvent.get(event.id) ?? [],
    clubEvent: event.audience === "CLUB",
    hiddenCardKeys: modulesByEvent.has(event.id) ? [...disabledModuleCardKeys(modulesByEvent.get(event.id)!.effective)] : undefined,
    dataPresentModules: modulesByEvent.has(event.id) ? [...(modulesByEvent.get(event.id)!.dataPresent ?? [])] : undefined,
    removableModules: isSystemAdmin && modulesByEvent.has(event.id) ? removableModuleKeys(modulesByEvent.get(event.id)!) : undefined,
    clubFormsAccess,
    clubOversight: event.audience === "CLUB"
      && (isSystemAdmin || rolesByEvent.get(event.id) === "EVENT_ADMIN"),
  }));
  const attendeeAccountAvailable = Boolean(
    await findSwitchableAttendeeAccountForStaff(user.email, user.id),
  );
  const acting = await currentStaffActingContext();

  return (
    <Suspense fallback={<div className="shell-loading">Loading IMSDA Events…</div>}>
      <ActAsBanner acting={acting} inShell />
      <AppShell
        attendeeAccountAvailable={attendeeAccountAvailable}
        autoSelected={autoSelected}
        defaultEventId={defaultEventId}
        events={shellEvents}
        user={user}
        adminRoleView={adminRoleView.held.length > 0 ? { held: adminRoleView.held, active: adminRoleView.active, counts: adminRoleCounts, healthImport: healthRecordsEnabled() } : null}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}
