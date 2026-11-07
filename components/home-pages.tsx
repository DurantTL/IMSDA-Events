import { ArrowRight } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "@/components/home-pages.module.css";
import { homeDestinations } from "@/components/staff-areas";
import {
  itemCountText,
  sectionStatusText,
  type ComingUpEvent,
  type NeedsItem,
  type NeedsView,
} from "@/modules/system-admin/home-needs-model";

/** The shared chip colours (`.status-chip` in globals.css): the words carry the meaning, colour is a second cue. */
const chipClass = { ok: "green", draft: "neutral" } as const;

function Item({ item }: { item: NeedsItem }) {
  const unavailable = item.count === null;
  return (
    <li className={styles.row} data-item={item.key} data-unavailable={unavailable ? "true" : undefined}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>
          {unavailable ? (
            <>{item.label}: <span className={`status-chip neutral ${styles.chip}`}>Unavailable</span></>
          ) : (
            <><span className={styles.count}>{itemCountText(item)}</span> {item.label}</>
          )}
        </p>
        {unavailable ? <p className={styles.rowText}>This could not be read just now. It is not the same as nothing waiting.</p> : null}
        {item.unit && !unavailable ? <p className={styles.rowText}>{item.unit}</p> : null}
        {item.note ? <p className={styles.rowText}>{item.note}</p> : null}
      </div>
      {item.links.length > 0 ? (
        <div className={styles.rowSide}>
          {item.links.map((link) => (
            <Link key={link.href} className={styles.link} href={link.href}>
              {link.label}
              <ArrowRight aria-hidden="true" size={14} />
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Needs you (#1568): the work waiting for this person, one section per admin role they hold. Everything here is a link to
 * the page that does the work; nothing on Home approves, sends or changes a record. "Nothing needs you right now" shows only
 * when every read worked and found nothing; a read that failed says "Unavailable".
 */
export function NeedsYouPage({ view }: { view: NeedsView }) {
  return (
    <div className={styles.home} data-testid="home-needs-you">
      {view.noAdminRole ? (
        <p className={styles.message} data-testid="home-no-admin-role">
          The work for your events is listed on each event&apos;s page. <Link href={homeDestinations.comingUp.href}>See your events in Coming up</Link>.
        </p>
      ) : null}
      {view.allClear ? <p className={styles.message} data-testid="home-all-clear">Nothing needs you right now.</p> : null}
      {view.sections.map((section) => (
        <section key={section.role} className={styles.section} aria-labelledby={`home-section-${section.role}`} data-role={section.role}>
          <div className={styles.sectionHead}>
            <h2 id={`home-section-${section.role}`} className={styles.sectionTitle}>{section.title}</h2>
            <p className={styles.sectionStatus} data-testid="home-section-status">{sectionStatusText(section)}</p>
          </div>
          {section.items.length > 0 ? (
            <ul className={styles.list}>
              {section.items.map((item) => <Item key={item.key} item={item} />)}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Coming up (#1568): the upcoming events this person can open, soonest first, each linking to the event home. */
export function ComingUpPage({ events }: { events: ComingUpEvent[] | null }) {
  if (events === null) {
    return (
      <div className={styles.home} data-testid="home-coming-up">
        <p className={styles.message} data-tone="unavailable" data-testid="home-coming-up-unavailable">
          <span className={`status-chip neutral ${styles.chip}`}>Unavailable</span> Your events could not be read just now. Try again in a moment.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.home} data-testid="home-coming-up">
      {events.length === 0 ? (
        <p className={styles.message} data-testid="home-coming-up-empty">No upcoming events.</p>
      ) : (
        <ul className={styles.list}>
          {events.map((event) => (
            <li key={event.id}>
              <Link className={styles.eventRow} href={event.href} data-event-id={event.id}>
                <span className={styles.eventTop}>
                  <span className={styles.rowTitle} translate="no">{event.name}</span>
                  <span className={`status-chip ${chipClass[event.status.tone]} ${styles.chip}`}>{event.status.text}</span>
                </span>
                <span className={styles.rowText}>{event.dates}</span>
                <span className={styles.rowText}>{event.place}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
