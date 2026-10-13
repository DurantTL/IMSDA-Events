import { CalendarClock, CircleAlert, ExternalLink } from "lucide-react";
import { formatDateRange } from "@/modules/calendar/domain";
import type { DeadlineListItem } from "@/modules/calendar/deadlines";

/**
 * "Upcoming deadlines" (#910) for the club home and the Area Coordinator
 * overview: what is due, when, and how soon, in date order, with the next 90
 * days and anything that passed in the last 7 days marked overdue. Read-only;
 * the caller loads the list (`listUpcomingDeadlines`), the same for everyone.
 */
export function UpcomingDeadlines({ deadlines, headingId = "upcoming-deadlines-heading" }: { deadlines: DeadlineListItem[]; headingId?: string }) {
  return (
    <section className="public-manage-card upcoming-deadlines" aria-labelledby={headingId}>
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Conference dates</p>
        <h2 id={headingId}>Upcoming deadlines</h2>
      </div>
      {deadlines.length === 0 ? (
        <p className="public-manage-empty">
          <CalendarClock size={17} aria-hidden="true" /> No deadlines in the next 90 days.
        </p>
      ) : (
        <ul className="public-manage-club-list">
          {deadlines.map((deadline) => (
            <li className={deadline.overdue ? "club-step-danger" : undefined} key={deadline.key}>
              {deadline.overdue ? <CircleAlert size={17} aria-hidden="true" /> : <CalendarClock size={17} aria-hidden="true" />}
              <span>
                <strong>{deadline.title}</strong>
                <small>
                  <time dateTime={deadline.dueOn}>{formatDateRange(deadline.dueOn, deadline.dueOn)}</time>
                  {" · "}
                  {deadline.label}
                  {deadline.postponed ? " · Postponed, date to be confirmed" : ""}
                </small>
              </span>
              {deadline.href && /^https:\/\//i.test(deadline.href) && (
                <a className="secondary-button club-event-action" href={deadline.href} rel="noreferrer noopener" target="_blank">
                  Details <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
