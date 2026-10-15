import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentSession } from "@/modules/access/current-session";
import { AccessRestricted } from "@/components/access-restricted";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { listActiveAreaCoordinators, listEventLocations } from "@/modules/event-locations/repository";
import { EventTeamSettingsPanel } from "@/components/event-team-settings-panel";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { EventGeneralLinkPanel } from "@/components/event-general-link-panel";
import { generalLinkUrl } from "@/modules/general-link-registrations/domain";
import { getGeneralLinkSettings } from "@/modules/general-link-registrations/repository";
import { getServerEnv } from "@/lib/env";
import { CalendarDatesConfirmation, CalendarLinkBanner } from "@/components/calendar-link-banner";
import { getCalendarLinkNotice } from "@/modules/calendar/event-links";
import { decideEventArchiveAccess } from "@/modules/events/archive";
import { getEventSettings } from "@/modules/events/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.eventSettings };

export default async function EventSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; calendarDates?: string }>;
}) {
  const { event: requested, calendarDates } = await searchParams;
  const { event, membership, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <AccessRestricted title="Event settings are restricted" detail="Only event administrators can change public details, capacity, registration dates, waitlist behavior, and publishing." />;
  }
  const { user } = await getCurrentSession();
  const [settings, locations, coordinators, teamSettings, generalLink, linkNotice] = await Promise.all([getEventSettings(event.id), listEventLocations(event.id), listActiveAreaCoordinators(), getTeamSettings(event.id), getGeneralLinkSettings(event.id), getCalendarLinkNotice(event.id)]);
  if (!settings) notFound();
  return (
    <>
      {(calendarDates === "updated" || calendarDates === "kept") && <CalendarDatesConfirmation outcome={calendarDates} />}
      {linkNotice && <CalendarLinkBanner key={`calendar-link-${event.id}`} eventId={event.id} notice={linkNotice} />}
      {/* Keyed on the event's dates too: after Update from the calendar banner the form remounts with the new dates,
          so a later save can't write the old ones back (the server also refuses a save over a newer version). */}
      <EventSettingsWorkspace key={`${event.id}:${settings.startsOn}:${settings.endsOn}`} mode="edit" initialEvent={settings} initialLocations={locations} areaCoordinators={coordinators} canDeleteEvent={user?.globalRole === "SYSTEM_ADMIN"} canArchiveEvent={decideEventArchiveAccess({ globalRole: user?.globalRole, eventRole: membership?.role ?? null }).allowed} />
      {settings.audience === "CLUB" && <EventTeamSettingsPanel key={`teams-${event.id}`} eventId={event.id} initialSettings={teamSettings} />}
      {settings.audience === "CLUB" && generalLink && (
        <EventGeneralLinkPanel
          key={`general-link-${event.id}`}
          eventId={event.id}
          initialSettings={generalLink}
          publicUrl={generalLinkUrl(getServerEnv().APP_BASE_URL, settings.slug)}
        />
      )}
    </>
  );
}
