import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventTemplates } from "@/modules/event-templates/repository";
import { ensureStarterEventTemplates } from "@/modules/event-templates/starter-repository";
import { EventTemplateList } from "@/components/event-template-list";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { TemplateLibrariesGuide } from "@/components/template-libraries-guide";

export const metadata: Metadata = { title: "Event templates" };

export default async function EventTemplatesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=event-setup");

  // First visit to a fresh database: add the starters (#704). A failure must not hide the page;
  // "Add starter templates" is still there to retry by hand.
  try {
    await ensureStarterEventTemplates(user.id);
  } catch (error) {
    logError("Starter event templates could not be seeded", error);
  }
  const templates = await listEventTemplates();

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/event-templates" section="system" />
      <StaffPageHeader
        description="Whole-event starting points: a new event gets a copy of a template's published version."
        primary={<Link className="primary-button" href="/admin/event-templates/from-event">Save an event as a template</Link>}
      />
      <TemplateLibrariesGuide current="event" />
      <EventTemplateList initialTemplates={templates} />
    </section>
  );
}
