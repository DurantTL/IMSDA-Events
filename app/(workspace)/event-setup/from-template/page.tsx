import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffPageHeader } from "@/components/staff-page-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { formatDateRange } from "@/modules/calendar/domain";
import { getCalendarEntryPrefill } from "@/modules/calendar/event-links";
import { listEventTemplates } from "@/modules/event-templates/repository";
import { StartFromTemplate } from "@/components/start-from-template";
import { templateFeatureDefaults } from "@/modules/event-templates/feature-defaults";

export const metadata: Metadata = { title: "Start from template" };

export default async function StartFromTemplatePage({ searchParams }: { searchParams: Promise<{ fromCalendarEntry?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  // Every template that is not archived (#617). Starters are added as drafts, so filtering to
  // published ones alone left the list blank; the picker disables the ones `applyEventTemplate`
  // would refuse (no valid published version) and says how to publish them.
  const templates = (await listEventTemplates()).filter((template) => template.status !== "ARCHIVED");

  // What each template starts the event with, for the features step (#965).
  const featureDefaults = Object.fromEntries(templates.map((template) => [template.id, templateFeatureDefaults(template)]));

  // Opened from a calendar item's Add registration (#445): the form starts with the item's title and dates.
  const { fromCalendarEntry } = await searchParams;
  const prefill = fromCalendarEntry ? await getCalendarEntryPrefill(fromCalendarEntry) : null;
  const carry = fromCalendarEntry && prefill?.ok ? `?fromCalendarEntry=${encodeURIComponent(fromCalendarEntry)}` : "";

  return (
    <section className="page-stack event-setup-flow">
      <StaffPageHeader description="Pick a template and the new event starts with its forms and settings." />
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
      <p><Link href={`/event-setup${carry}#blank-event`}>Start blank</Link> instead: fill in the event details by hand.</p>
      <StartFromTemplate
        templates={templates}
        featureDefaults={featureDefaults}
        calendarPrefill={prefill?.ok ? { entryId: prefill.entry.id, title: prefill.entry.title, startsOn: prefill.entry.startsOn, endsOn: prefill.entry.endsOn } : undefined}
      />
    </section>
  );
}
