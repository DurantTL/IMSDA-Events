import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { EventHealthSheet } from "@/components/event-health-sheet";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { PrintReportButton } from "@/components/print-report-button";
import { requireAttendeeSecondStep } from "@/modules/attendee-accounts/portal-second-step";
import { resolveAreaHealthViewer } from "@/modules/coordinator-health/access";
import { HealthViewError, healthAcknowledgmentOwed, listHealthEvents, loadEventHealth } from "@/modules/coordinator-health/repository";
import { formatCalendarDate } from "@/modules/club-registrations/domain";

export const metadata: Metadata = { title: "Event health information", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Health information for club events (#658), read only, for active Area
 * Coordinators who passed the second step (checked in `resolveAreaHealthViewer`,
 * not by the portal layout). Opening an event is audited as a view; `?sheet=1`
 * is the printable sheet and is audited as an export.
 */
export default async function AreaHealthPage({ searchParams }: { searchParams: Promise<{ event?: string; club?: string; sheet?: string }> }) {
  const viewer = await resolveAreaHealthViewer();
  if (!viewer) {
    // Sent to the club gate when the second step is what is missing (#1410), otherwise there is nothing here.
    await requireAttendeeSecondStep();
    notFound();
  }
  const query = await searchParams;
  // The one-time privacy notice (#923) comes before anything is listed or opened.
  if (await healthAcknowledgmentOwed(viewer)) return <HealthPrivacyAcknowledgment as="ATTENDEE" />;

  if (!query.event) {
    const events = await listHealthEvents(viewer);
    return (
      <>
        <section className="public-registration-hero public-manage-hero account-page-hero">
          <div>
            <p className="public-registration-eyebrow">Area Coordinator · confidential · view only</p>
            <h1>Event health information</h1>
          </div>
        </section>
        <div className="account-page-body club-roster-stack">
          <BackLink href="/account/clubs">Back to clubs</BackLink>
          <p className="inline-notice" role="status">Dietary notes as entered, the medical-need flag, and emergency contacts for club events. Each event is available through its last day. Every time you open or print one it is recorded.</p>
          {events.length === 0 ? <p className="quiet-copy">No club event is open for health information right now.</p> : (
            <ul className="account-overview-list">
              {events.map((event) => (
                <li key={event.id}>
                  <a href={`/account/area/health?event=${encodeURIComponent(event.id)}`}><strong>{event.name}</strong></a>
                  <small> available through {formatCalendarDate(event.availableThrough)}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  const sheet = query.sheet === "1";
  let data;
  try {
    data = await loadEventHealth(viewer, query.event, { organizationId: query.club || undefined, purpose: sheet ? "EXPORT" : "VIEW" });
  } catch (error) {
    if (error instanceof HealthViewError && error.code === "ACKNOWLEDGMENT_REQUIRED") return <HealthPrivacyAcknowledgment as="ATTENDEE" />;
    if (error instanceof HealthViewError) notFound();
    throw error;
  }
  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">Area Coordinator · confidential · view only</p>
          <h1>{data.event.name}</h1>
        </div>
      </section>
      <div className="account-page-body club-roster-stack">
        <BackLink href="/account/area/health">Back to events</BackLink>
        <p className="inline-notice" role="status">Available through {formatCalendarDate(data.event.availableThrough)}, the last day of the event. This view is recorded.</p>
        {sheet
          ? <PrintReportButton label="Print confidential sheet" />
          : <a className="secondary-button" href={`/account/area/health?event=${encodeURIComponent(data.event.id)}${query.club ? `&club=${encodeURIComponent(query.club)}` : ""}&sheet=1`}>Open printable sheet</a>}
        <EventHealthSheet
          clubs={data.clubs}
          clubLinks={query.club ? undefined : (organizationId) => {
            const base = `/account/area/health?event=${encodeURIComponent(data.event.id)}&club=${encodeURIComponent(organizationId)}`;
            return { view: base, sheet: `${base}&sheet=1` };
          }}
        />
      </div>
    </>
  );
}
