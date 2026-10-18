import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { EventHealthSheet } from "@/components/event-health-sheet";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { PrintReportButton } from "@/components/print-report-button";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveStaffHealthViewer } from "@/modules/coordinator-health/access";
import { HealthViewError, healthAcknowledgmentOwed, loadEventHealth } from "@/modules/coordinator-health/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { formatCalendarDate } from "@/modules/club-registrations/domain";

export const metadata: Metadata = {
  title: staffPageTitles.eventHealth,
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/**
 * Health information for a club event (#658), for system administrators and
 * staff a system administrator gave VIEW_HEALTH_INFORMATION. Access is checked
 * here on the server, not by a layout. Opening the page is audited as a view;
 * `?sheet=1` opens the printable sheet and is audited as an export.
 */
export default async function EventHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; club?: string; sheet?: string }>;
}) {
  const query = await searchParams;
  const { event } = await resolveEventContext(query.event);
  const viewer = await resolveStaffHealthViewer();
  if (!viewer) {
    return <AccessRestricted title="Health information is restricted" detail="Ask a system administrator if you need health information access for this event." />;
  }
  // The one-time privacy notice (#923) comes before anything is opened.
  if (await healthAcknowledgmentOwed(viewer)) return <HealthPrivacyAcknowledgment as="STAFF" />;
  const sheet = query.sheet === "1";
  let data;
  try {
    data = await loadEventHealth(viewer, event.id, { organizationId: query.club || undefined, purpose: sheet ? "EXPORT" : "VIEW" });
  } catch (error) {
    if (error instanceof HealthViewError && error.code === "ACKNOWLEDGMENT_REQUIRED") return <HealthPrivacyAcknowledgment as="STAFF" />;
    // The window closes when the event ends: the page no longer applies, which is not a permission failure (#981).
    if (error instanceof HealthViewError && error.code === "WINDOW_CLOSED") return <NotAvailableForEvent reason={error.message} />;
    if (error instanceof HealthViewError) return <AccessRestricted title="Health information is unavailable" detail={error.message} />;
    throw error;
  }
  const base = `/more/event-health?event=${encodeURIComponent(event.id)}`;
  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Confidential · read only</p>
          <h2>{data.event.name}: health information</h2>
          <p>Available through {formatCalendarDate(data.event.availableThrough)}, the last day of the event. Every time this is opened or printed it is recorded.</p>
        </div>
        <div className="intro-actions">
          {sheet
            ? <PrintReportButton label="Print confidential sheet" />
            : <a className="secondary-button" href={`${base}${query.club ? `&club=${encodeURIComponent(query.club)}` : ""}&sheet=1`}>Open printable sheet</a>}
        </div>
      </div>
      <EventHealthSheet
        clubs={data.clubs}
        clubLinks={query.club ? undefined : (organizationId) => ({ view: `${base}&club=${encodeURIComponent(organizationId)}`, sheet: `${base}&club=${encodeURIComponent(organizationId)}&sheet=1` })}
      />
    </section>
  );
}
