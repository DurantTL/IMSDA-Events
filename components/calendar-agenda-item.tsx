import Link from "next/link";
import { CalendarDays, ChevronRight, Clock3, DoorClosed, ExternalLink, MapPin } from "lucide-react";
import { calendarStatusLabels, closureLabel, formatDateRange, type CalendarItem } from "@/modules/calendar/domain";

const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ItemLink({ item, children, className, tabIndex }: { item: CalendarItem; children: React.ReactNode; className?: string; tabIndex?: number }) {
  if (!item.href) return <span className={className}>{children}</span>;
  if (item.href.startsWith("/")) return <Link className={className} href={item.href} tabIndex={tabIndex}>{children}</Link>;
  return <a className={className} href={item.href} rel="noreferrer" tabIndex={tabIndex} target="_blank">{children}</a>;
}

/** The chip for an event at capacity (#1215): full with the waitlist open, or full. */
export function fullEventChip(item: CalendarItem) {
  if (item.registrationFull === "WAITLIST") return <span className="status-chip green">Event full · waitlist open</span>;
  if (item.registrationFull === "FULL") return <span className="status-chip">Event full</span>;
  return null;
}

function registrationActionLabel(item: CalendarItem) {
  if (!item.registrationOpen) return "Details";
  return item.registrationFull === "WAITLIST" ? "Join the waitlist" : "Register";
}

export function AgendaItem({ item }: { item: CalendarItem }) {
  const [, month, day] = item.startsOn.split("-").map(Number);
  return (
    <li className={`calendar-agenda-item calendar-kind-${item.kind.toLowerCase()} calendar-status-${item.status.toLowerCase()}${item.isClosure ? " calendar-closure" : ""}`}>
      <span className="calendar-date-badge" aria-hidden="true">
        <small>{shortMonths[month - 1]}</small>
        <strong>{day}</strong>
      </span>
      <div className="calendar-agenda-body">
        <div className="calendar-agenda-tags">
          {item.isClosure ? (
            <span className="calendar-kind-label calendar-closure-label"><DoorClosed size={13} aria-hidden="true" /> {closureLabel}</span>
          ) : (
            <span className="calendar-kind-label">{item.kind === "EVENT" ? "IMSDA event" : "Conference date"}</span>
          )}
          {item.category && <span className="calendar-category-tag">{item.category}</span>}
          {item.status !== "SCHEDULED" && <span className="status-chip coral">{calendarStatusLabels[item.status]}</span>}
          {item.registrationOpen && !item.registrationFull && <span className="status-chip green">Registration open</span>}
          {fullEventChip(item)}
        </div>
        <h3><ItemLink item={item}>{item.title}</ItemLink></h3>
        <p className="calendar-agenda-meta">
          <span><CalendarDays size={14} aria-hidden="true" /> {formatDateRange(item.startsOn, item.endsOn)}</span>
          {item.timeLabel && <span><Clock3 size={14} aria-hidden="true" /> {item.timeLabel}</span>}
          {item.location && <span><MapPin size={14} aria-hidden="true" /> {item.location}</span>}
        </p>
        {item.description && <p className="calendar-agenda-description">{item.description}</p>}
      </div>
      {item.href && item.status !== "CANCELLED" && (
        <ItemLink
          className={`${item.registrationOpen ? "primary-button" : "secondary-button"} calendar-agenda-action`}
          item={item}
        >
          {item.kind === "EVENT" ? registrationActionLabel(item) : "More info"}
          {item.href.startsWith("/") ? <ChevronRight size={14} aria-hidden="true" /> : <ExternalLink size={14} aria-hidden="true" />}
        </ItemLink>
      )}
    </li>
  );
}

