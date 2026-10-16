import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffPageHeader } from "@/components/staff-page-header";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { formatDateRange } from "@/modules/calendar/domain";
import { getCalendarEntryPrefill } from "@/modules/calendar/event-links";

export const metadata: Metadata = {
  title: "Create an event",
  robots: { index: false, follow: false },
};

export default async function EventSetupPage({ searchParams }: { searchParams: Promise<{ fromCalendarEntry?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  // Opened from a calendar item's Add registration (#445): the form starts with the item's details, and the item
  // is linked when the event is created. Template choice works as usual.
  const { fromCalendarEntry } = await searchParams;
  const prefill = fromCalendarEntry ? await getCalendarEntryPrefill(fromCalendarEntry) : null;
  const carry = fromCalendarEntry && prefill?.ok ? `?fromCalendarEntry=${encodeURIComponent(fromCalendarEntry)}` : "";

  return (
    <section className="page-stack event-setup-flow">
      <StaffPageHeader description="Start blank, from a template, or from a past event." />
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
      <div className="event-setup-entry-actions">
        <Link className="secondary-button" href={`/event-setup/from-template${carry}`}>Start from a template</Link>
        <Link className="secondary-button" href={`/event-setup${carry}#blank-event`}>Start blank</Link>
        <Link className="secondary-button" href="/event-setup/copy">Copy from a past event</Link>
      </div>
      <div id="blank-event">
        <EventSettingsWorkspace
          mode="create"
          initialEvent={null}
          calendarPrefill={prefill?.ok
            ? { entryId: prefill.entry.id, title: prefill.entry.title, startsOn: prefill.entry.startsOn, endsOn: prefill.entry.endsOn, location: prefill.entry.location }
            : undefined}
        />
      </div>
    </section>
  );
}
