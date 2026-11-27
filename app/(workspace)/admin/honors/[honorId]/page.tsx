import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { HonorRequirementPanels } from "@/components/honor-requirements";
import { DetailPage } from "@/components/page-templates/detail-page";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { getHonorRequirements, getHonorSummary } from "@/modules/requirements/repository";

export const metadata: Metadata = { title: "Honor requirements" };
export const dynamic = "force-dynamic";

/**
 * One honor from the catalog with its requirements (#2054): the category as a
 * label, the requirement text, and the credit line its license asks for.
 * Read only; text comes in through Import requirements on the catalog.
 */
export default async function HonorRequirementsPage({ params }: { params: Promise<{ honorId: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { honorId } = await params;
  const honor = await getHonorSummary(honorId);
  if (!honor) notFound();
  const requirements = await getHonorRequirements(honor.id);

  return (
    <>
      <AdminPageHeader path={`/admin/honors/${honor.id}`} />
      <DetailPage
        header={{
          title: honor.name,
          back: { href: "/admin/honors", label: "Back to Honor catalog" },
          description: honor.description || undefined,
        }}
      >
        <HonorRequirementPanels
          emptyHint="Use Import requirements on the Honor catalog to load the text from the Pathfinder Wiki."
          honor={honor}
          requirements={requirements}
        />
      </DetailPage>
    </>
  );
}
