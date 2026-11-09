import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ComingUpPage } from "@/components/home-pages";
import { StaffPageHeader } from "@/components/staff-page-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { loadComingUp } from "@/modules/system-admin/home-coming-up-repository";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/**
 * Home > Coming up (#1568): the upcoming events this person can open, soonest first. The list is the one the shell builds
 * for the viewer (`listEventsForUser`: every event for a system administrator, otherwise the person's own active
 * memberships), narrowed by the System home's upcoming rule. Links only.
 */
export default async function HomeComingUpPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const { events, nextStep } = await loadComingUp(user, async () => heldAdminRoles(await resolveAdminRoles(user)));
  return (
    <section className="page-stack">
      <StaffPageHeader description="What needs you, and what is coming up." />
      <ComingUpPage events={events} nextStep={nextStep} />
    </section>
  );
}
