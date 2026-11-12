import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { MasterGuideCandidates } from "@/components/master-guide";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { canManageMasterGuide } from "@/modules/master-guide/domain";
import { loadMasterGuide } from "@/modules/master-guide/repository";

export const metadata: Metadata = { title: "Master Guide tracking" };
export const dynamic = "force-dynamic";

/**
 * The optional Master Guide candidate list (#1698): who started, when, with which mentor, and where each is in the approval
 * chain. Only the club's director and deputy (and staff acting as the director), and only while the club has switched it on
 * in Club settings; a registrar, a reporter, another club and a club that has not switched it on get "not found".
 * No birth date is shown.
 */
export default async function ClubMasterGuidePage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state === "NO_ROSTER") notFound();
  if (access.state !== "OPEN") return clubAccessClosed(access);
  if (!canManageMasterGuide(access.capabilities)) notFound();
  const list = await loadMasterGuide(organizationId);
  if (!list) notFound();
  const base = `/account/clubs/${organizationId}`;
  return (
    <>
      <BackLink href={`${base}/club-info#club-optional-features`}>Back to Club settings</BackLink>
      <section aria-labelledby="master-guide-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{`Club year ${yearLabel(list.clubYear)}`}</p>
          <h2 id="master-guide-heading">Master Guide tracking</h2>
        </div>
        <p className="quiet-copy">
          Add a candidate from this year&apos;s active roster. A candidate must be 16 or older on the start date, and 18 or older on the
          day the club approves. The program runs one to three years from the start date; the dates are shown to help you plan, and a
          candidate past three years is flagged but not stopped. After the club approves, an Area Coordinator approves. You can turn
          this off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>.
        </p>
        <MasterGuideCandidates list={list} organizationId={organizationId} />
      </section>
    </>
  );
}
