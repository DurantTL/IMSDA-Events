import { ExactValue } from "@/components/exact-value";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { HealthBreakGlassForm } from "@/components/health-break-glass-form";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { HealthRecordPageHeader } from "@/components/health-record-page-header";
import { HealthRecordView, HealthStatusChip } from "@/components/health-record-view";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { BREAK_GLASS_REQUIRED_MESSAGE } from "@/modules/health-records/break-glass";
import { canStartBreakGlassInline, rosterMemberPersonId } from "@/modules/health-records/break-glass-form";
import { HealthRecordError } from "@/modules/health-records/errors";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { viewHealthRecord } from "@/modules/health-records/repository";

export const metadata: Metadata = { title: "Health record", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * A member's Health Record for a system administrator, or for staff holding
 * VIEW_HEALTH_INFORMATION on an event (`?event=` names it; the member must be
 * an attendee of that event, inside its window) (#611): view only, and every
 * view is audited. With the feature off the page does not exist; without the
 * permission it says so and loads nothing.
 */
export default async function StaffHealthRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; memberId: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  if (!healthRecordsEnabled()) notFound();
  const [{ organizationId, memberId }, { event }] = await Promise.all([params, searchParams]);
  const viewer = await requireStaffHealthViewer().catch((error: unknown) => {
    if (error instanceof HealthRecordError && error.code === "NOT_FOUND") notFound();
    if (error instanceof HealthRecordError && error.code === "FORBIDDEN") return null;
    if (error instanceof Error && error.name === "AccessDeniedError") return null;
    throw error;
  });
  if (!viewer) {
    return (
      <>
        <HealthRecordPageHeader eventId={event} />
        <AccessRestricted detail="Health records need the health information permission." title="Health records are restricted" whoToAsk="a system administrator" />
      </>
    );
  }
  const health = await viewHealthRecord(viewer, organizationId, memberId, new Date(), { eventId: event }).catch((error: unknown) => {
    // The one-time privacy notice (#923) comes before any record opens.
    if (error instanceof HealthRecordError && error.code === "ACKNOWLEDGMENT_REQUIRED") return null;
    // A system administrator reads a live record only through break-glass (#929); the refusal is already audited.
    if (error instanceof HealthRecordError && error.code === "BREAK_GLASS_REQUIRED") return "BREAK_GLASS" as const;
    if (error instanceof HealthRecordError) notFound();
    throw error;
  });
  if (health === "BREAK_GLASS") {
    // A system administrator or Clubs Administrator (any viewer the break-glass route accepts) can start break-glass right here (#1617).
    const personId = canStartBreakGlassInline(viewer) ? await rosterMemberPersonId(organizationId, memberId) : null;
    if (personId) {
      return (
        <section className="page-stack club-form-page">
          <HealthRecordPageHeader eventId={event} />
          <header><h2>Break-glass access is required</h2></header>
          <HealthBreakGlassForm message={BREAK_GLASS_REQUIRED_MESSAGE} personId={personId} />
        </section>
      );
    }
    return (
      <>
        <HealthRecordPageHeader eventId={event} />
        <AccessRestricted detail={BREAK_GLASS_REQUIRED_MESSAGE} title="Break-glass access is required" whoToAsk="a system administrator" />
      </>
    );
  }
  if (!health) {
    return (
      <>
        <HealthRecordPageHeader eventId={event} />
        <HealthPrivacyAcknowledgment as="STAFF" />
      </>
    );
  }
  return (
    <section className="page-stack club-form-page">
      <HealthRecordPageHeader
        eventId={event}
        subject={(
          <>
            <h2><ExactValue>{`${health.member.firstName} ${health.member.lastName}`.trim()}</ExactValue></h2>
            <p translate="no">{health.club.name}</p>
            <p><HealthStatusChip status={health.status} /></p>
          </>
        )}
      />
      <HealthRecordView health={health} />
    </section>
  );
}
