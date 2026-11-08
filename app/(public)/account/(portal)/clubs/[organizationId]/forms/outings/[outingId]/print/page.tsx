import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { PrintFormButton } from "@/components/club-forms-actions";
import { cardCell } from "@/components/table-card-labels";
import { clubLeaderViewerFromAccess } from "@/modules/club-forms/access";
import { isClubFormsRole } from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import { outingDetailRows, outingLinkStateLabel } from "@/modules/club-forms/outing-domain";
import { getOutingTracking } from "@/modules/club-forms/outings";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: "Outing permission slip, print view", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/** The director's binder page for one outing (#1672): the details and who has signed. No answers and no email addresses. */
export default async function OutingPrintPage({ params }: { params: Promise<{ organizationId: string; outingId: string }> }) {
  const { organizationId, outingId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  if (!isClubFormsRole(access.club.role)) notFound();
  const viewer = clubLeaderViewerFromAccess(access);
  const tracking = await getOutingTracking(viewer, organizationId, outingId).catch((error: unknown) => {
    if (error instanceof ClubFormError && error.code === "OUTING_NOT_FOUND") return null;
    throw error;
  });
  if (!tracking) notFound();
  const base = `/account/clubs/${organizationId}/forms`;
  const when = (iso: string | null) => (iso ? formatInConferenceTime(iso, { month: "short", day: "numeric", year: "numeric" }) : "");

  return (
    <div className="club-form-page">
      <div className="club-form-page-actions intro-actions">
        <BackLink href={`${base}/outings/${outingId}`}>Back to this outing</BackLink>
        <PrintFormButton />
      </div>
      <article className="club-form-sheet">
        <header className="club-form-sheet-header">
          <p className="public-registration-eyebrow">{`${access.club.name} · Club year ${tracking.clubYear}`}</p>
          <h2 translate="no">{tracking.details.activity}: permission slips</h2>
          <p className="club-form-sheet-meta">
            <span>{tracking.counts.SIGNED} signed</span>
            <span>{tracking.counts.NOT_YET} not yet</span>
            <span>{tracking.counts.EXPIRED} link expired</span>
          </p>
        </header>
        <section className="club-form-sheet-section">
          <h3>Outing details</h3>
          <dl className="club-form-answers">
            {outingDetailRows(tracking.details).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd translate="no">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="club-form-sheet-section">
          <h3>Who has signed</h3>
          <table className="report-table table-cards" role="table">
            <caption className="sr-only">Permission slips for {tracking.details.activity}</caption>
            <thead role="rowgroup">
              <tr role="row"><th role="columnheader" scope="col">Member</th><th role="columnheader" scope="col">Slip</th><th role="columnheader" scope="col">Date</th></tr>
            </thead>
            <tbody role="rowgroup">
              {tracking.members.length === 0 && <tr role="row"><td colSpan={3} role="cell">No slips sent yet.</td></tr>}
              {tracking.members.map((member) => (
                <tr key={member.memberId} role="row">
                  <th role="rowheader" scope="row" translate="no">{member.name}</th>
                  <td {...cardCell("Slip")}>{outingLinkStateLabel[member.state]}</td>
                  <td {...cardCell("Date")}>{member.state === "SIGNED" ? `Signed ${when(member.signedAt)}` : member.state === "EXPIRED" ? `Expired ${when(member.expiresAt)}` : `Sent ${when(member.sentAt)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </article>
    </div>
  );
}
