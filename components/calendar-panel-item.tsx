import { CalendarDays, DoorClosed } from "lucide-react";
import { ItemLink } from "@/components/calendar-agenda-item";
import { calendarItemTone, calendarStatusLabels, closureLabel, formatDateRange, type CalendarItem, type CalendarTone } from "@/modules/calendar/domain";

/** One item in the day panel (#1202, #1203): category with its colour, title, dates and status, linking where the agenda links. */
export function CalendarPanelItem({ item, toneMap }: { item: CalendarItem; toneMap: Map<string, CalendarTone> }) {
  const tone = calendarItemTone(item, toneMap);
  const label = item.isClosure ? closureLabel : item.category || (item.kind === "EVENT" ? "IMSDA event" : "Conference date");
  return (
    <li className={`calendar-panel-item calendar-tone-${tone} calendar-status-${item.status.toLowerCase()}`}>
      <p className="calendar-panel-category">
        <span aria-hidden="true" className="calendar-swatch" />
        {item.isClosure && <DoorClosed size={14} aria-hidden="true" />}
        <span>{label}</span>
      </p>
      <h3><ItemLink item={item}>{item.title}</ItemLink></h3>
      <p className="calendar-panel-meta"><CalendarDays size={14} aria-hidden="true" /> {formatDateRange(item.startsOn, item.endsOn)}</p>
      {(item.status !== "SCHEDULED" || item.registrationOpen) && (
        <p className="calendar-panel-status">
          {item.status !== "SCHEDULED" && <span className="status-chip coral">{calendarStatusLabels[item.status]}</span>}
          {item.registrationOpen && <span className="status-chip green">Registration open</span>}
        </p>
      )}
    </li>
  );
}
