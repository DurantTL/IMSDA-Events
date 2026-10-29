import { CalendarDays, Clock3, DoorClosed, ExternalLink, MapPin } from "lucide-react";
import {
  calendarItemActionLabel,
  calendarItemStatusLine,
  calendarStatusLabels,
  closureLabel,
  formatDateRange,
  type CalendarItem,
} from "@/modules/calendar/domain";
import styles from "./calendar-upcoming-widget.module.css";

/** Links leave the frame: an event page or entry link replaces the host page's frame target, never nests inside it. */
function WidgetLink({ item, children, className }: { item: CalendarItem; children: React.ReactNode; className?: string }) {
  if (!item.href) return <span className={className}>{children}</span>;
  const external = !item.href.startsWith("/");
  return (
    <a className={className} href={item.href} rel={external ? "noopener noreferrer" : undefined} target="_top">
      {children}
    </a>
  );
}

export function CalendarUpcomingWidget({ items, calendarHref, emptyLabel }: { items: CalendarItem[]; calendarHref: string; emptyLabel: string }) {
  return (
    <section aria-labelledby="calendar-widget-heading" className={styles.widget}>
      <h1 className={styles.heading} id="calendar-widget-heading">Upcoming events</h1>
      {items.length === 0 ? (
        <p className={styles.empty}>{emptyLabel}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const title = item.eventTitle ?? item.title;
            const dates = item.eventStartsOn && item.eventEndsOn ? formatDateRange(item.eventStartsOn, item.eventEndsOn) : formatDateRange(item.startsOn, item.endsOn);
            const statusLine = calendarItemStatusLine(item);
            const managed = item.kind === "EVENT";
            // A card that shows the event's own name and dates (#1086) stands for the whole event, so one linked item's
            // time, place and status (say, one postponed session) must not speak for it. A cancelled item stays cancelled.
            const wholeEvent = item.eventTitle !== undefined;
            const status = wholeEvent && item.status !== "CANCELLED" ? "SCHEDULED" : item.status;
            return (
              <li className={`${styles.item} ${managed ? styles.managed : styles.informational}${status === "CANCELLED" ? ` ${styles.off}` : ""}`} data-status={status.toLowerCase()} key={item.key}>
                <div className={styles.tags}>
                  {item.isClosure ? (
                    <span className={styles.tag}><DoorClosed aria-hidden="true" size={13} /> {closureLabel}</span>
                  ) : (
                    <span className={styles.tag}>{managed ? "IMSDA event" : "Conference date"}</span>
                  )}
                  {status !== "SCHEDULED" && <span className={`${styles.tag} ${styles.status}`}>{calendarStatusLabels[status]}</span>}
                </div>
                <h2 className={styles.title}><WidgetLink className={styles.titleLink} item={item}>{title}</WidgetLink></h2>
                <p className={styles.meta}>
                  <span><CalendarDays aria-hidden="true" size={14} /> {dates}</span>
                  {!wholeEvent && item.timeLabel && <span><Clock3 aria-hidden="true" size={14} /> {item.timeLabel}</span>}
                  {!wholeEvent && item.location && <span><MapPin aria-hidden="true" size={14} /> {item.location}</span>}
                </p>
                {managed && statusLine && <p className={`${styles.registration}${item.registrationOpen ? ` ${styles.open}` : ""}`}>{statusLine}</p>}
                {managed && item.registrationOpen && item.href && status !== "CANCELLED" && (
                  <WidgetLink className={styles.action} item={item}>
                    {calendarItemActionLabel(item)}<span className="sr-only"> for {title}</span>
                  </WidgetLink>
                )}
                {!managed && item.href && status !== "CANCELLED" && (
                  <WidgetLink className={styles.action} item={item}>
                    More info<span className="sr-only"> about {title}</span>
                    {!item.href.startsWith("/") && <ExternalLink aria-hidden="true" size={14} />}
                  </WidgetLink>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <a className={styles.viewAll} href={calendarHref} target="_top">View full calendar</a>
    </section>
  );
}
