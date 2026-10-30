import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffPageHeader } from "@/components/staff-page-header";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { EventTemplateFromEvent } from "@/components/event-template-from-event";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventsForUser } from "@/modules/events/repository";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { listEventTemplates } from "@/modules/event-templates/repository";

export const metadata: Metadata = { title: "Save an event as a template", robots: { index: false, follow: false } };

export default async function SaveEventAsTemplatePage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  // Newest first: the event you most likely want to save is the latest reviewed one.
  const events = (await listEventsForUser(user.id, true, { archived: "include" })).slice().reverse();
  const sources = events.map((event) => ({
    id: event.id,
    name: event.archivedAt ? `${event.name} (archived)` : event.name,
    startsOn: calendarDateInEventTimeZone(event.startsAt, event.timezone),
    endsOn: calendarDateInEventTimeZone(event.endsAt, event.timezone),
  }));
  const templates = (await listEventTemplates())
    .filter((template) => template.status !== "ARCHIVED")
    .map((template) => ({
      id: template.id,
      name: template.name,
      audience: template.audience,
      hasDraft: template.versions.some((version) => version.status === "DRAFT"),
    }));

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/event-templates/from-event" section="system" />
      <StaffPageHeader description="Turn a reviewed event's settings and forms into a template." />
      <EventTemplateFromEvent events={sources} templates={templates} />
    </section>
  );
}
