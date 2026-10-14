import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { HealthRecordActions } from "@/components/health-record-actions";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { HealthRecordForm } from "@/components/health-record-form";
import { HealthRecordView, HealthStatusChip } from "@/components/health-record-view";
import { getRosterAccessStateForPage, RosterAccessError } from "@/modules/club-rosters/access";
import { requireHealthViewerForClub } from "@/modules/health-records/access";
import { HealthRecordError } from "@/modules/health-records/errors";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { listHealthRecordLinks, viewHealthEntryStatus, viewHealthRecord } from "@/modules/health-records/repository";

export const metadata: Metadata = { title: "Health record", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The Health tab for one roster member (#611). With the feature switched off
 * this page does not exist. Otherwise only the club's own director or deputy
 * gets in, after the roster's second step; opening it is audited. A club
 * Registrar gets the entry page instead (#923): the form only while no record
 * exists, and otherwise only the status (a record on file is changed by the
 * director or a deputy, owner decision of 2026-10-14). A first visit asks
 * for the one-time privacy acknowledgment.
 */
export default async function ClubMemberHealthPage({ params }: { params: Promise<{ organizationId: string; memberId: string }> }) {
  if (!healthRecordsEnabled()) notFound();
  const { organizationId, memberId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return null;
  const viewer = await requireHealthViewerForClub(organizationId).catch((error: unknown) => {
    if (error instanceof HealthRecordError && error.code === "FORBIDDEN") return null;
    if (error instanceof HealthRecordError || error instanceof RosterAccessError) notFound();
    throw error;
  });
  if (!viewer) {
    return <p className="public-manage-empty">Health records are kept by the club&apos;s director and deputy.</p>;
  }
  const needsAck = (error: unknown) => error instanceof HealthRecordError && error.code === "ACKNOWLEDGMENT_REQUIRED";
  const rosterHref = `/account/clubs/${organizationId}/roster`;

  if (viewer.kind === "CLUB_REGISTRAR") {
    const entry = await viewHealthEntryStatus(viewer, organizationId, memberId).catch((error: unknown) => {
      if (needsAck(error)) return null;
      if (error instanceof HealthRecordError) notFound();
      throw error;
    });
    if (!entry) return <HealthPrivacyAcknowledgment as="ATTENDEE" />;
    const entryName = `${entry.member.firstName} ${entry.member.lastName}`.trim();
    return (
      <section className="page-stack club-form-page">
        <BackLink href={rosterHref}>Back to roster</BackLink>
        <header>
          <h2 translate="no">Health record entry: {entryName}</h2>
          <p><HealthStatusChip status={entry.status} /></p>
          {entry.exists ? (
            <p className="quiet-copy">A health record is on file; the director or a deputy can update it.</p>
          ) : (
            <>
              <p className="quiet-copy">No health record is on file yet.</p>
              <p className="quiet-copy">
                Registrars can enter a health record when none exists yet, but cannot read it back. Saving is recorded.
                Once a record is on file, only the director or a deputy can change it.
              </p>
            </>
          )}
        </header>
        {!entry.exists && (
          <HealthRecordForm
            clubName={entry.club.name}
            consentText={entry.consentText}
            doneHref={`${rosterHref}/${encodeURIComponent(memberId)}/health`}
            initialValues={{}}
            memberName={entryName}
            mode={{ kind: "director", organizationId, memberId }}
            sponsoringChurch={entry.club.sponsoringChurch}
          />
        )}
      </section>
    );
  }

  const health = await viewHealthRecord(viewer, organizationId, memberId).catch((error: unknown) => {
    if (needsAck(error)) return null;
    if (error instanceof HealthRecordError) notFound();
    throw error;
  });
  if (!health) return <HealthPrivacyAcknowledgment as={viewer.kind === "SYSTEM_ADMIN" ? "STAFF" : "ATTENDEE"} />;
  const links = viewer.kind === "CLUB_LEADER" ? await listHealthRecordLinks(viewer, organizationId, memberId) : [];
  const memberName = `${health.member.firstName} ${health.member.lastName}`.trim();

  return (
    <section className="page-stack club-form-page">
      <BackLink href={rosterHref}>Back to roster</BackLink>
      <header>
        <h2 translate="no">Health record: {memberName}</h2>
        <p><HealthStatusChip status={health.status} /></p>
        <p className="quiet-copy">Opening this page is recorded. Health details are never emailed, exported, or printed in the check-in book.</p>
      </header>
      <HealthRecordView health={health} />
      {health.canEdit && (
        <>
          <HealthRecordActions canConfirm={health.status === "NEEDS_UPDATE"} links={links} memberId={memberId} organizationId={organizationId} />
          <details open={health.status === "NONE"}>
            <summary>{health.status === "NONE" ? "Enter the health record from the paper form" : "Edit this record"}</summary>
            <HealthRecordForm
              clubName={health.club.name}
              consentText={health.consentText}
              doneHref={`${rosterHref}/${encodeURIComponent(memberId)}/health`}
              initialValues={health.values}
              needsCorrection={health.needsCorrection}
              memberName={memberName}
              mode={{ kind: "director", organizationId, memberId }}
              sponsoringChurch={health.club.sponsoringChurch}
            />
          </details>
        </>
      )}
    </section>
  );
}
