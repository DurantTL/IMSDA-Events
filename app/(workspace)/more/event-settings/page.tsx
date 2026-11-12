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
import { getPrisma } from "@/lib/prisma";
import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { getPlatformSettings } from "@/modules/system-admin/platform-settings";
import { CalendarDatesConfirmation, CalendarLinkBanner } from "@/components/calendar-link-banner";
import { getCalendarLinkNotice } from "@/modules/calendar/event-links";
import { decideEventArchiveAccess } from "@/modules/events/archive";
import { findEventArchiveFacts } from "@/modules/events/archive-download-facts";
import { listMapSiteOptions } from "@/modules/events/map-site";
import { getEventSettings } from "@/modules/events/repository";
import { eventAllowsArchiveDownload } from "@/modules/reporting/event-archive";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";
import { PageHeader } from "@/components/page-header";
import { EventClubOptionsGroup } from "@/components/event-club-options-group";

export const metadata: Metadata = { title: staffPageTitles.eventSettings };

export default async function EventSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; calendarDates?: string }>;
}) {
  const { event: requested, calendarDates } = await searchParams;
  const { event, membership, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <PageHeader title={staffPageTitles.eventSettings} />
        <AccessRestricted title="Event settings are restricted" detail="Only event administrators can change public details, capacity, registration dates, waitlist behavior, and publishing." whoToAsk="your event administrator" />
      </>
    );
  }
  const { user } = await getCurrentSession();
  const [settings, archiveFacts, locations, coordinators, teamSettings, generalLink, linkNotice, platform, emailSettings, mapSiteOptions] = await Promise.all([getEventSettings(event.id), findEventArchiveFacts(event.id), listEventLocations(event.id), listActiveAreaCoordinators(), getTeamSettings(event.id), getGeneralLinkSettings(event.id), getCalendarLinkNotice(event.id), getPlatformSettings(), loadEventEmailSettings(getPrisma(), event.id), listMapSiteOptions()]);
  if (!settings) notFound();
  return (
    <>
      {(calendarDates === "updated" || calendarDates === "kept") && <CalendarDatesConfirmation outcome={calendarDates} />}
      {linkNotice && <CalendarLinkBanner key={`calendar-link-${event.id}`} eventId={event.id} notice={linkNotice} />}
      {/* Keyed on the event's dates too: after Update from the calendar banner the form remounts with the new dates,
          so a later save can't write the old ones back (the server also refuses a save over a newer version). */}
      <EventSettingsWorkspace key={`${event.id}:${settings.startsOn}:${settings.endsOn}`} mode="edit" initialEvent={settings} initialLocations={locations} mapSiteOptions={mapSiteOptions} areaCoordinators={coordinators} canDeleteEvent={user?.globalRole === "SYSTEM_ADMIN"} canOpenPlatformSettings={user?.globalRole === "SYSTEM_ADMIN"} canArchiveEvent={decideEventArchiveAccess({ globalRole: user?.globalRole, eventRole: membership?.role ?? null }).allowed}
        canDownloadEventArchive={Boolean(archiveFacts && eventAllowsArchiveDownload(archiveFacts) && (permissions.includes("VIEW_REPORTS") || permissions.includes("MANAGE_FINANCE")))}
        // Where each value comes from (#1258): the defaults a new event is seeded from, and the event's sender against the central one. Names and addresses only.
        platformDefaults={{ defaultTimezone: platform.defaultTimezone, defaultAttendeeEditPolicy: platform.defaultAttendeeEditPolicy }}
        emailSender={emailSettings ? { senderName: emailSettings.senderName, replyToOverride: emailSettings.replyToOverride, central: { name: emailSettings.central.name, replyTo: emailSettings.central.replyTo } } : undefined} />
      {settings.audience === "CLUB" && (
        <EventClubOptionsGroup>
          <EventTeamSettingsPanel key={`teams-${event.id}`} eventId={event.id} initialSettings={teamSettings} />
          {generalLink && (
            <EventGeneralLinkPanel
              key={`general-link-${event.id}`}
              eventId={event.id}
              initialSettings={generalLink}
              publicUrl={generalLinkUrl(getServerEnv().APP_BASE_URL, settings.slug)}
            />
          )}
        </EventClubOptionsGroup>
      )}
    </>
  );
}
