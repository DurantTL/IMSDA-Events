import { ExactValue } from "@/components/exact-value";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { HealthRecordView, HealthStatusChip } from "@/components/health-record-view";
import { HealthStepUp } from "@/components/health-step-up";
import { attendeeUnlockMethods, requireAreaCoordinatorHealthViewer } from "@/modules/health-records/access";
import { HealthRecordError } from "@/modules/health-records/errors";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { viewHealthRecord } from "@/modules/health-records/repository";

export const metadata: Metadata = { title: "Health record", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * An event attendee's Health Record for an Area Coordinator (#611, director's
 * decision of 2026-10-01). Switched off, it is a 404. Otherwise it needs a
 * coordinator with a verified second step, a member registered for this
 * event, and an open event window; any miss is a 404. View only, audited.
 */
export default async function AreaCoordinatorHealthPage({
  params,
}: {
  params: Promise<{ eventId: string; organizationId: string; memberId: string }>;
}) {
  if (!healthRecordsEnabled()) notFound();
  const { eventId, organizationId, memberId } = await params;
  const viewer = await requireAreaCoordinatorHealthViewer().catch((error: unknown) => {
    if (error instanceof HealthRecordError && error.code === "STEP_UP_REQUIRED") return error;
    if (error instanceof HealthRecordError) notFound();
    throw error;
  });
  // Second step too old: say so (it is the coordinator's own session, nothing about a record).
  if (viewer instanceof HealthRecordError) {
    return <HealthStepUp methods={await attendeeUnlockMethods()} />;
  }
  const health = await viewHealthRecord(viewer, organizationId, memberId, new Date(), { eventId }).catch((error: unknown) => {
    // The one-time privacy notice (#923) comes before any record opens.
    if (error instanceof HealthRecordError && error.code === "ACKNOWLEDGMENT_REQUIRED") return null;
    if (error instanceof HealthRecordError) notFound();
    throw error;
  });
  if (!health) return <HealthPrivacyAcknowledgment as="ATTENDEE" />;
  return (
    <section className="page-stack club-form-page">
      <header>
        <h2>Health record: <ExactValue>{`${health.member.firstName} ${health.member.lastName}`.trim()}</ExactValue></h2>
        <p translate="no">{health.club.name}</p>
        <p><HealthStatusChip status={health.status} /></p>
        <p className="quiet-copy">View only, for this event. Opening this page is recorded.</p>
      </header>
      <HealthRecordView health={health} />
    </section>
  );
}
