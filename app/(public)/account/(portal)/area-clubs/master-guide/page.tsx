import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { MasterGuideAreaApprovals } from "@/components/master-guide";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listAreaApprovalQueue } from "@/modules/master-guide/repository";

export const metadata: Metadata = { title: "Master Guide approvals", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Master Guide candidates the club has approved and are waiting for an Area Coordinator (#1698), in clubs that switched the
 * optional feature on. An Area Coordinator on their own account (grant active, second step passed) sees them and can approve;
 * they cannot add, change or remove a candidate. Anyone else, including staff acting as a coordinator, gets "not found".
 * Layouts do not re-run on navigation, so the page checks for itself.
 */
export default async function MasterGuideApprovalsPage() {
  if (!(await currentAreaCoordinator())) notFound();
  const rows = await listAreaApprovalQueue();
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow="Club coordination" title="Master Guide approvals">
        <p>Candidates a club has approved, in clubs that use Master Guide tracking. Approving is your step in the chain; the club keeps the candidate&apos;s details.</p>
      </CoordinatorSectionHeading>
      <MasterGuideAreaApprovals rows={rows} />
    </section>
  );
}
