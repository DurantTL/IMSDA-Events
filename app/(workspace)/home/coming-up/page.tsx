import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ComingUpPage } from "@/components/home-pages";
import { StaffPageHeader } from "@/components/staff-page-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { logError } from "@/lib/logger";
import { listEventsForUser } from "@/modules/events/repository";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { buildComingUp, comingUpNextStep, type ComingUpEvent } from "@/modules/system-admin/home-needs-model";

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
  let events: ComingUpEvent[] | null;
  try {
    events = buildComingUp(await listEventsForUser(user.id, user.globalRole === "SYSTEM_ADMIN"), new Date());
  } catch (error) {
    logError("Home coming-up events could not load", error);
    events = null;
  }
  const nextStep = events?.length === 0 ? comingUpNextStep(heldAdminRoles(await resolveAdminRoles(user)), user.globalRole === "SYSTEM_ADMIN") : null;
  return (
    <section className="page-stack">
      <StaffPageHeader description="What needs you, and what is coming up." />
      <ComingUpPage events={events} nextStep={nextStep} />
    </section>
  );
}
