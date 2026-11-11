import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NeedsYouPage } from "@/components/home-pages";
import { StaffInstallCard } from "@/components/staff-install-card";
import { StaffPageHeader } from "@/components/staff-page-header";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { buildNeedsView } from "@/modules/system-admin/home-needs-model";
import { loadComingUp } from "@/modules/system-admin/home-coming-up-repository";
import { loadNeedsInput } from "@/modules/system-admin/home-needs-repository";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/**
 * Home > Needs you (#1568). Any signed-in staff-workspace user may open it; it reads only what each role the person holds
 * already lets them see, and every item links to the page that does the work. Nothing here changes a record.
 */
export default async function HomeNeedsYouPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const roles = await resolveAdminRoles(user);
  const held = heldAdminRoles(roles);
  const view = buildNeedsView(await loadNeedsInput(roles, held));
  // Coming up sits below the empty states (#1747): only read when nothing needs this person.
  const comingUp = view.allClear || view.noAdminRole ? await loadComingUp(user, async () => held) : null;
  return (
    <section className="page-stack">
      <StaffPageHeader description="What needs you, and what is coming up." />
      <StaffInstallCard />
      <NeedsYouPage view={view} comingUp={comingUp} />
    </section>
  );
}
