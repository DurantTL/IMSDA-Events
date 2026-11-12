import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormPage } from "@/components/page-templates/form-page";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { EventStartChoices } from "@/components/event-start-choices";
import { getCurrentSession } from "@/modules/access/current-session";
import { formatDateRange } from "@/modules/calendar/domain";
import { listMapSiteOptions } from "@/modules/events/map-site";
import { getCalendarEntryPrefill } from "@/modules/calendar/event-links";

export const metadata: Metadata = {
  title: "Create an event",
  robots: { index: false, follow: false },
};

export default async function EventSetupPage({ searchParams }: { searchParams: Promise<{ fromCalendarEntry?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=event-setup");

  // Opened from a calendar item's Add registration (#445): the form starts with the item's details, and the item
  // is linked when the event is created. Template choice works as usual.
  const { fromCalendarEntry } = await searchParams;
  const prefill = fromCalendarEntry ? await getCalendarEntryPrefill(fromCalendarEntry) : null;
  const mapSiteOptions = await listMapSiteOptions();
  const carry = fromCalendarEntry && prefill?.ok ? `?fromCalendarEntry=${encodeURIComponent(fromCalendarEntry)}` : "";

  return (
    <FormPage
      header={{ title: "Create an event", description: "Start blank, from a template, or from a past event." }}
      notices={(
        <>
          {prefill?.ok === false && (
            <p className="inline-notice error" role="alert">
              {prefill.reason} <Link href="/admin/calendar">Back to the calendar</Link>
            </p>
          )}
          {prefill?.ok && (
            <p className="inline-notice" role="status" data-testid="event-setup-from-calendar">
              Setting up a registration event from the calendar item <strong>{prefill.entry.title}</strong> ({formatDateRange(prefill.entry.startsOn, prefill.entry.endsOn)}).
              The event is linked to it, so the calendar shows the pair once.
            </p>
          )}
          <EventStartChoices current="blank" carry={carry} />
        </>
      )}
    >
      <div id="blank-event">
        <EventSettingsWorkspace
          mode="create"
          initialEvent={null}
          mapSiteOptions={mapSiteOptions}
          calendarPrefill={prefill?.ok
            ? { entryId: prefill.entry.id, title: prefill.entry.title, startsOn: prefill.entry.startsOn, endsOn: prefill.entry.endsOn, location: prefill.entry.location }
            : undefined}
        />
      </div>
    </FormPage>
  );
}
