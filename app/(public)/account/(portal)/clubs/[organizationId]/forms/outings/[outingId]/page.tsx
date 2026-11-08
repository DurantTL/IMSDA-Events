import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copy, Printer } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { CloseOutingButton, SendOutingPanel } from "@/components/club-outing-actions";
import { OutingTrackingTable } from "@/components/club-outing-tables";
import { clubLeaderViewerFromAccess } from "@/modules/club-forms/access";
import { CLUB_FORM_LINK_DEFAULT_DAYS, isClubFormsRole } from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import { getOutingTracking, listOutingRosterChoices } from "@/modules/club-forms/outings";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";

export const metadata: Metadata = { title: "Outing permission slip", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/** One outing's page (#1672): its details, who has signed, sending and resending, print, copy and close. */
export default async function OutingPage({ params }: { params: Promise<{ organizationId: string; outingId: string }> }) {
  const { organizationId, outingId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  if (!isClubFormsRole(access.club.role)) notFound();
  const viewer = clubLeaderViewerFromAccess(access);
  const base = `/account/clubs/${organizationId}/forms`;
  const tracking = await getOutingTracking(viewer, organizationId, outingId).catch((error: unknown) => {
    if (error instanceof ClubFormError && error.code === "OUTING_NOT_FOUND") return null;
    throw error;
  });
  if (!tracking) notFound();
  const open = tracking.status === "OPEN";
  const choices = open ? await listOutingRosterChoices(viewer, organizationId, outingId) : [];
  const rows = tracking.detailRows;

  return (
    <>
      <BackLink href={base}>Back to club forms</BackLink>
      <section className="public-manage-card" aria-labelledby="outing-heading">
        <p className="public-registration-eyebrow">{`${access.club.name} · Club year ${tracking.clubYear}`}</p>
        <h2 id="outing-heading" translate="no">{tracking.details.activity}</h2>
        <p className="field-help">{open ? "Open: you can send and resend slips." : "Closed: no more slips can be sent. Signed slips stay on file."}</p>
        <dl className="club-form-answers">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd translate="no">{row.value}</dd>
            </div>
          ))}
        </dl>
        {tracking.questions.length > 0 && (
          <>
            <h3>Your questions</h3>
            <ol>
              {tracking.questions.map((question, index) => <li key={index} translate="no">{question.label}{question.required ? " (required)" : ""}</li>)}
            </ol>
          </>
        )}
        <div className="intro-actions">
          <Link className="secondary-button" href={`${base}/outings/${outingId}/print`}><Printer aria-hidden="true" size={14} /> Print view</Link>
          <Link className="secondary-button" href={`${base}/outings/new?copy=${encodeURIComponent(outingId)}`}><Copy aria-hidden="true" size={14} /> Copy for a new outing</Link>
          {open && <CloseOutingButton openCount={tracking.counts.NOT_YET} organizationId={organizationId} outingId={outingId} />}
        </div>
      </section>

      {open && (
        <section className="public-manage-card" aria-labelledby="outing-send-heading">
          <h2 id="outing-send-heading">Send the slip to families</h2>
          <SendOutingPanel
            choices={choices}
            defaultDays={CLUB_FORM_LINK_DEFAULT_DAYS}
            organizationId={organizationId}
            outingId={outingId}
            rosterHref={`/account/clubs/${organizationId}/roster`}
          />
        </section>
      )}

      <section className="public-manage-card" aria-labelledby="outing-signed-heading">
        <h2 id="outing-signed-heading">Who has signed</h2>
        <p className="field-help" data-testid="outing-counts">
          {tracking.counts.SIGNED} signed, {tracking.counts.NOT_YET} not yet, {tracking.counts.EXPIRED} link expired.
        </p>
        {tracking.members.length === 0
          ? <p className="field-help">No slips sent yet. Choose families above to send the first ones.</p>
          : <OutingTrackingTable base={base} members={tracking.members} open={open} organizationId={organizationId} outingId={outingId} />}
      </section>
    </>
  );
}
