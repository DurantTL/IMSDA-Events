import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ComingUpPage, NeedsYouPage } from "@/components/home-pages";
import { StaffHomeBoard } from "@/components/staff-home-board";
import { StaffInstallCard } from "@/components/staff-install-card";
import { StaffPageHeader } from "@/components/staff-page-header";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { buildNeedsView } from "@/modules/system-admin/home-needs-model";
import { loadComingUp } from "@/modules/system-admin/home-coming-up-repository";
import type { HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import { loadHomeLayout } from "@/modules/system-admin/home-layout-repository";
import { loadNeedsInput } from "@/modules/system-admin/home-needs-repository";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/**
 * Home > Needs you (#1568). Any signed-in staff-workspace user may open it; it reads only what each role the person holds
 * already lets them see, and every item links to the page that does the work. Nothing here changes a record.
 * An admin also gets Arrange and Customize (#1705): their own saved set of modules, read only for the modules shown.
 */
export default async function HomeNeedsYouPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const roles = await resolveAdminRoles(user);
  const held = heldAdminRoles(roles);
  const view = buildNeedsView(await loadNeedsInput(roles, held));
  const header = (
    <>
      <StaffPageHeader description="What needs you, and what is coming up." />
      <StaffInstallCard />
    </>
  );

  if (held.length === 0) {
    // No admin role: today's view, with no Arrange or Customize.
    const comingUp = view.allClear || view.noAdminRole ? await loadComingUp(user, async () => held) : null;
    return (
      <section className="page-stack">
        {header}
        <NeedsYouPage view={view} comingUp={comingUp} />
      </section>
    );
  }

  const layout = await loadHomeLayout(user.id, roles);
  const shown = new Set<HomeModuleKey>(layout.modules.filter((module) => module.shown).map((module) => module.key));
  const comingUpShown = shown.has("coming-up");
  // Coming up sits under the all-clear message (#1747) only when it is not its own card.
  const comingUp = comingUpShown || view.allClear ? await loadComingUp(user, async () => held) : null;
  const bodies: Partial<Record<HomeModuleKey, ReactNode>> = {};
  if (shown.has("needs-you")) bodies["needs-you"] = <NeedsYouPage view={view} headingLevel={3} comingUp={comingUpShown ? null : comingUp} />;
  if (comingUpShown && comingUp) bodies["coming-up"] = <ComingUpPage events={comingUp.events} nextStep={comingUp.nextStep} />;
  return (
    <section className="page-stack">
      {header}
      <StaffHomeBoard modules={layout.modules} bodies={bodies} />
    </section>
  );
}
