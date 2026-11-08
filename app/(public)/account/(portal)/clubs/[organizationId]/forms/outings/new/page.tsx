import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ClubOutingForm } from "@/components/club-outing-form";
import { clubAccessClosed } from "@/components/club-access-closed";
import { clubLeaderViewerFromAccess } from "@/modules/club-forms/access";
import { isClubFormsRole } from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import { getOutingForCopy, getOutingSlipAvailability } from "@/modules/club-forms/outings";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";

export const metadata: Metadata = { title: "New outing permission slip" };
export const dynamic = "force-dynamic";

/**
 * A director's new outing permission slip (#1672), or a copy of a past one (`?copy=<outing>`: the details and questions
 * come across, the dates are left empty). If the conference has not turned the slip on, this says so and offers nothing to fill in.
 */
export default async function NewOutingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  const [{ organizationId }, { copy }] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  if (!isClubFormsRole(access.club.role)) notFound();
  const viewer = clubLeaderViewerFromAccess(access);
  const base = `/account/clubs/${organizationId}/forms`;
  const { enabled } = await getOutingSlipAvailability();
  if (!enabled) {
    return (
      <>
        <BackLink href={base}>Back to club forms</BackLink>
        <section className="public-manage-card" data-testid="outing-slip-off">
          <h2>The permission slip is not turned on yet</h2>
          <p>Outing permission slips use the conference&apos;s Off-Premises Permission Slip, and it has not been turned on. Ask a system administrator at the conference office to turn it on, then come back to set up your outing.</p>
        </section>
      </>
    );
  }
  const initial = copy
    ? await getOutingForCopy(viewer, organizationId, copy).catch((error: unknown) => {
      if (error instanceof ClubFormError && error.code === "OUTING_NOT_FOUND") return null;
      throw error;
    })
    : undefined;
  if (copy && !initial) notFound();
  return (
    <>
      <BackLink href={base}>Back to club forms</BackLink>
      <section className="public-manage-card">
        <p className="public-registration-eyebrow">{access.club.name}</p>
        <h2>{initial ? "Copy an outing permission slip" : "New outing permission slip"}</h2>
        <p>Set the details of one outing and add a few questions. Then send the slip to the families going. Parents review the details and sign: the child, medical and emergency, and signature sections are the conference&apos;s own and stay as they are.</p>
      </section>
      <ClubOutingForm formsHref={base} initial={initial ?? undefined} organizationId={organizationId} />
    </>
  );
}
