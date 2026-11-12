import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "@/components/tlt-staffing.module.css";
import { logError } from "@/lib/logger";
import { currentTltDirector } from "@/modules/tlt-directory/access";
import { listTltStaffingEvents } from "@/modules/event-staffing/tlt-director";

export const metadata: Metadata = { title: "TLT staffing", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The club events with Event staffing on, for the TLT director only (#1678): how many TLTs each needs and has. Anyone else,
 * including staff acting as a coordinator, gets "not found". Layouts do not re-run on navigation, so the page checks for itself.
 */
export default async function TltStaffingOverviewPage() {
  if (!(await currentTltDirector())) notFound();
  const events = await listTltStaffingEvents().catch((error: unknown) => {
    logError("TLT staffing overview read failed", error);
    return null;
  });
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow="TLT directory" title="TLT staffing">
        <p>Camporees and other club events using the Event staffing sheet. Open one to see where TLTs are needed and to assign registered TLTs.</p>
      </CoordinatorSectionHeading>
      <p><Link className="secondary-button" href="/account/area-clubs/tlt">Back to the directory</Link></p>
      {events === null ? (
        <p className="inline-notice error" role="alert">The events could not be loaded. Try again.</p>
      ) : events.length === 0 ? (
        <p className={styles.empty}>No event has Event staffing turned on yet. An Area Coordinator or event administrator turns it on for an event.</p>
      ) : (
        <ul className={styles.events}>
          {events.map((event) => (
            <li className={styles.eventCard} key={event.id}>
              <h3 className={styles.eventName}>{event.name}</h3>
              <p className={styles.details}>{event.startsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: event.timezone })} · {event.activityCount} {event.activityCount === 1 ? "activity" : "activities"}</p>
              <p className={event.tltsAssigned < event.tltsNeeded ? styles.gap : styles.counts}>TLTs: {event.tltsAssigned} of {event.tltsNeeded} assigned</p>
              <Link className="secondary-button" href={`/account/area-clubs/tlt/staffing/${encodeURIComponent(event.id)}`}>Assign TLTs<span className="sr-only">: {event.name}</span></Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
