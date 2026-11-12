import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { ClubStaffTraining } from "@/components/club-staff-training";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { loadStaffTraining } from "@/modules/staff-training/repository";

export const metadata: Metadata = { title: "Staff training" };
export const dynamic = "force-dynamic";

/**
 * The optional staff training records page (#1697): the adults on this year's roster with the NAD certifications and
 * workshops recorded for each. Only the club's director and deputy (and staff acting as the director), and only while the
 * club has switched it on in Club settings; anyone else, and a club that has not, gets "not found".
 */
export default async function ClubStaffTrainingPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const list = await loadStaffTraining(organizationId, access.capabilities);
  if (!list) notFound();
  const base = `/account/clubs/${organizationId}`;
  return (
    <>
      <BackLink href={`${base}/roster`}>Back to the roster</BackLink>
      <section aria-labelledby="staff-training-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{`Club year ${yearLabel(list.clubYear)}`}</p>
          <h2 id="staff-training-heading">Staff training</h2>
        </div>
        <p className="quiet-copy">
          The NAD certifications and workshops your adults and staff have completed, newest first. Nothing here is required.
          Add a record when someone finishes a certification or a workshop, and remove one that was entered by mistake. Only your
          club&apos;s director and deputy can see this page. You can turn it off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>;
          the records are kept.
        </p>
        <ClubStaffTraining organizationId={organizationId} people={list.people} />
      </section>
    </>
  );
}
