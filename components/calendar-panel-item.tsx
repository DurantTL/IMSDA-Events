import { CalendarDays, DoorClosed } from "lucide-react";
import { EventCardTransition } from "@/components/event-card-transition";
import { ItemLink } from "@/components/calendar-agenda-item";
import { calendarItemStatusLine, calendarItemTone, calendarStatusLabels, closureLabel, formatDateRange, type CalendarItem, type CalendarTone } from "@/modules/calendar/domain";

/** One item in the day panel (#1202, #1203): category with its colour, title, dates and status, linking where the agenda links. */
export function CalendarPanelItem({ item, toneMap, transitionName }: { item: CalendarItem; toneMap: Map<string, CalendarTone>; transitionName?: string | null }) {
  const tone = calendarItemTone(item, toneMap);
  const statusLine = calendarItemStatusLine(item);
  const label = item.isClosure ? closureLabel : item.category || (item.kind === "EVENT" ? "IMSDA event" : "Conference date");
  return (
    <EventCardTransition name={transitionName}>
    <li className={`calendar-panel-item calendar-tone-${tone} calendar-status-${item.status.toLowerCase()}`}>
      <p className="calendar-panel-category">
        <span aria-hidden="true" className="calendar-swatch" />
        {item.isClosure && <DoorClosed size={14} aria-hidden="true" />}
        <span>{label}</span>
      </p>
      <h3><ItemLink item={item}>{item.title}</ItemLink></h3>
      <p className="calendar-panel-meta"><CalendarDays size={14} aria-hidden="true" /> {formatDateRange(item.startsOn, item.endsOn)}</p>
      {(item.status !== "SCHEDULED" || statusLine) && (
        <p className="calendar-panel-status">
          {item.status !== "SCHEDULED" && <span className="status-chip coral">{calendarStatusLabels[item.status]}</span>}
          {statusLine && <span className={`status-chip ${item.registrationOpen ? "green" : "neutral"}`}>{statusLine}</span>}
        </p>
      )}
    </li>
    </EventCardTransition>
  );
}
