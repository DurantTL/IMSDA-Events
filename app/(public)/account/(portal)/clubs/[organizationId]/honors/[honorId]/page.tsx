import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { HonorRequirementPanels } from "@/components/honor-requirements";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { getHonorRequirements, getHonorSummary } from "@/modules/requirements/repository";

export const metadata: Metadata = { title: "Honor requirements", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * One honor's requirements for club leaders (#2054), opened from an honor in a
 * member's history on the club's Honors page. It opens on the same gate as that
 * page. Read only, and it shows nothing about any member: only the catalog's
 * honor, its category label, and its requirement text with the credit line.
 */
export default async function ClubHonorRequirementsPage({ params }: { params: Promise<{ organizationId: string; honorId: string }> }) {
  const { organizationId, honorId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const honor = await getHonorSummary(honorId);
  if (!honor) notFound();
  const requirements = await getHonorRequirements(honor.id);
  return (
    <>
      <BackLink href={`/account/clubs/${organizationId}/honors`}>Back to Honors</BackLink>
      <section className="public-manage-card page-stack">
        <h2>{honor.name}</h2>
        {honor.description && <p className="field-help">{honor.description}</p>}
        <HonorRequirementPanels
          emptyHint="The conference adds requirement text to the honor catalog. Ask the conference youth office if you need it sooner."
          honor={honor}
          headingLevel={3}
          requirements={requirements}
        />
      </section>
    </>
  );
}
