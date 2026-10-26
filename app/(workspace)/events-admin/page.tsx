import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, CircleAlert, ClipboardList, Hourglass, UsersRound } from "lucide-react";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { getEventsAdminEventSources } from "@/modules/events/events-admin-home-repository";
import {
  WORK_NOT_ADDED_NOTE,
  acrossYourEventsLabel,
  buildEventsAdminHome,
  eventsAdminTabs,
} from "@/modules/events/events-admin-home-model";
import { DashboardTabs } from "@/components/dashboard-tabs";
import styles from "./events-admin.module.css";

export const metadata: Metadata = { title: "Event administration" };

function dateRange(start: Date, end: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).formatRange(start, end);
}

function countdown(happeningNow: boolean, days: number | null) {
  if (happeningNow) return "Happening now";
  if (days === null) return "";
  return days <= 1 ? "Starts within a day" : `Starts in ${days} days`;
}

/**
 * The Events Administrator dashboard (#1227): the events this person is an active EVENT_ADMIN of, what is waiting on
 * them, and links to the pages that can change each record. It only reads and links. Holding system administration
 * alone does not open it; only EVENT_ADMIN memberships do, and only those events are ever read.
 */
export default async function EventsAdminPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  // The scope comes from the person's own memberships on the server, never from the query string.
  const { eventAdminEventIds } = await resolveAdminRoles(user);
  if (eventAdminEventIds.length === 0) redirect("/no-access");

  const now = new Date();
  const sources = await getEventsAdminEventSources(eventAdminEventIds, now);
  const home = buildEventsAdminHome(sources, now);
  const { counts, events, next } = home;
  const tabs = eventsAdminTabs(next?.id ?? null);

  return (
    <section className={`page-stack ${styles.workspace}`}>
      <DashboardTabs label="Event administration sections" tabs={tabs} currentKey="overview" />

      <section className={styles.hero} aria-labelledby="events-admin-heading">
        <p className="eyebrow">Your events</p>
        <h2 id="events-admin-heading">Event administration</h2>
        <p>What is waiting for someone across your events, then the events themselves. You will only see events assigned to you; club records and club events are not part of this role. Nothing on this page changes a record.</p>
        <p className={styles.identity} data-testid="signed-in-identity">Signed in as <strong>{user.displayName}</strong></p>
      </section>

      <section aria-labelledby="events-admin-summary-heading">
        <h2 id="events-admin-summary-heading" className="sr-only">Summary</h2>
        <div className={styles.cards} data-testid="events-admin-cards">
          <article data-card="assigned-events">
            <span className={styles.cardIcon}><CalendarDays aria-hidden="true" size={20} /></span>
            <strong>{counts.assignedEvents}</strong>
            <p>Assigned events</p>
            <small>Upcoming events you administer. Archived events are not counted.</small>
          </article>
          <article data-card="active-registrations">
            <span className={styles.cardIcon}><UsersRound aria-hidden="true" size={20} /></span>
            <strong>{counts.activeRegistrations}</strong>
            <p>Active registrations</p>
            <small>{events.length > 0 ? acrossYourEventsLabel(events.length) : "No upcoming events assigned"}</small>
          </article>
          <article data-card="need-attention">
            <span className={styles.cardIcon}><ClipboardList aria-hidden="true" size={20} /></span>
            <strong>{counts.needAttention}</strong>
            <p>Need attention</p>
            <small>Open balances and incomplete forms, across your events</small>
          </article>
          <article data-card="next-event">
            <span className={styles.cardIcon}><Hourglass aria-hidden="true" size={20} /></span>
            <strong>{next ? (next.happeningNow ? "Happening now" : next.daysUntilStart) : "None"}</strong>
            <p>Days until next event</p>
            <small>{next ? next.name : "No upcoming events"}</small>
            {next && <small><Link href={next.href}>Open event</Link></small>}
          </article>
        </div>

        {events.length > 0 && (
          <p className={styles.summaryLine} data-testid="events-admin-summary">
            <strong>{counts.expectedAttendees}</strong> expected attendees
            {events.map((event) => <span key={event.id}> · {event.name}: <strong>{event.registeredCount}</strong> registered</span>)}
          </p>
        )}
      </section>

      <section className={`panel ${styles.panel}`} id="your-events" aria-labelledby="your-events-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Assigned to you</p>
            <h2 id="your-events-heading">Your events</h2>
          </div>
        </div>
        {events.length === 0 ? (
          <div className={styles.empty} data-testid="events-admin-empty">
            <CalendarDays aria-hidden="true" size={24} />
            <strong>No upcoming events assigned to you</strong>
            <p>Events that have ended or been archived are not shown here. If you expected an event, ask a system administrator to check that you are an Event Admin on it.</p>
          </div>
        ) : (
          <div className={styles.eventList}>
            {events.map((event) => (
              <article className={styles.eventCard} key={event.id} data-event-id={event.id}>
                <div className={styles.eventBadges}>
                  <span className={styles.status}>{event.statusLabel}</span>
                  {countdown(event.timing === "IN_PROGRESS", event.daysUntilStart) && <span className={styles.countdown}>{countdown(event.timing === "IN_PROGRESS", event.daysUntilStart)}</span>}
                </div>
                <h3>{event.name}</h3>
                <p>{dateRange(event.startsAt, event.endsAt, event.timezone)} · {event.location ?? "Location pending"}</p>
                <p className={styles.registered}>{event.registeredText}</p>
                <div className={styles.eventLinks}>
                  <Link className={`primary-button ${styles.linkButton}`} href={event.href}>Open event <ArrowRight aria-hidden="true" size={15} /></Link>
                  <Link className={`secondary-button ${styles.linkButton}`} href={event.kitchenReportHref}>Kitchen report</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={`panel ${styles.panel}`} id="work-waiting" aria-labelledby="work-waiting-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Across your events</p>
            <h2 id="work-waiting-heading">Work waiting for you</h2>
            <p>{WORK_NOT_ADDED_NOTE}</p>
          </div>
        </div>
        {events.length === 0 ? (
          <p className="quiet-copy">Nothing to show until you have an upcoming event.</p>
        ) : (
          <ul className={styles.workList}>
            {home.workRows.map((row) => (
              <li key={row.kind} className={styles.workRow} data-work-key={row.kind}>
                <span className={styles.rowCount}>{row.total}</span>
                <span className={styles.rowLabel}>
                  {row.label}
                  <small>{row.total === 0 ? "Nothing waiting" : row.unit}</small>
                </span>
                <span className={styles.rowLinks}>
                  {row.items.map((item) => (
                    <Link key={item.eventId} className={styles.rowLink} href={item.href}>
                      {events.length > 1 ? `${item.eventName}: ${item.count}` : row.linkLabel}
                      <ArrowRight aria-hidden="true" size={14} />
                    </Link>
                  ))}
                  {row.items.some((item) => item.note) && (
                    <small><CircleAlert aria-hidden="true" size={12} /> {row.items.find((item) => item.note)?.note}</small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
