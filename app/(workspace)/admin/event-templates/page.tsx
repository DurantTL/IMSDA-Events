import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventTemplates } from "@/modules/event-templates/repository";
import { ensureStarterEventTemplates } from "@/modules/event-templates/starter-repository";
import { EventTemplateList } from "@/components/event-template-list";

export const metadata: Metadata = { title: "Event templates" };

export default async function EventTemplatesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

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
      <StaffPageHeader description="The starting points new events are built from." />
      <EventTemplateList initialTemplates={templates} />
    </section>
  );
}
