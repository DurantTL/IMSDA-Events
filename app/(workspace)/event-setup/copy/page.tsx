import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StepPage } from "@/components/page-templates/step-page";
import { CopyFromPastEvent } from "@/components/copy-from-past-event";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventsForUser } from "@/modules/events/repository";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";

export const metadata: Metadata = { title: "Copy from a past event", robots: { index: false, follow: false } };

export default async function CopyFromPastEventPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=event-setup");

  // Newest first: the year you are most likely to copy is the last one.
  const events = (await listEventsForUser(user.id, true, { archived: "include" })).filter((event) => !event.isBillingContainer).reverse();
  const sources = events.map((event) => ({
    id: event.id,
    name: event.archivedAt ? `${event.name} (archived)` : event.name,
    startsOn: calendarDateInEventTimeZone(event.startsAt, event.timezone),
    endsOn: calendarDateInEventTimeZone(event.endsAt, event.timezone),
    isPublished: event.isPublished,
  }));

  return (
    // The copy flow keeps its own steps (choose, preview, created) in the client component, so no step number is shown here.
    <StepPage header={{ title: "Copy from a past event", description: "Start from a past event's settings and forms." }}>
      <CopyFromPastEvent sources={sources} />
    </StepPage>
  );
}
