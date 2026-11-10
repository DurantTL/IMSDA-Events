import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { PageHeader } from "@/components/page-header";
import { ScheduledEmailsWorkspace } from "@/components/scheduled-emails-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { listScheduledEmails } from "@/modules/communications/scheduled-email-repository";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: staffPageTitles.scheduledEmails };
export const dynamic = "force-dynamic";

/**
 * Scheduled email batches (#177). Needs the same MANAGE_COMMUNICATIONS permission as the rest of Emails; the server routes
 * check it again on every request. Nothing on this page sends email by being opened.
 */
export default async function ScheduledEmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; new?: string }>;
}) {
  const { event: requested, new: openNew } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_COMMUNICATIONS")) {
    // The page draws its own title (#1772), so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title={staffPageTitles.scheduledEmails} />
        <AccessRestricted
          title="Scheduled emails are restricted"
          detail="Scheduling or approving email needs communications access."
          whoToAsk="your event administrator"
        />
      </>
    );
  }
  const schedules = await listScheduledEmails(event.id);
  return (
    <ScheduledEmailsWorkspace
      key={event.id}
      eventId={event.id}
      eventName={event.name}
      eventTimezone={event.timezone}
      initialSchedules={schedules}
      openNew={openNew === "1"}
    />
  );
}
