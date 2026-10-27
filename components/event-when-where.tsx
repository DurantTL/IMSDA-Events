import { CalendarDays, MapPin } from "lucide-react";

/**
 * The plain When / Where summary under an event's title (#1205), the same in every header variant. `timeLabel` may be
 * empty; the location falls back to a plain "coming soon" so the row never disappears.
 */
export function EventWhenWhere({ dateLabel, timeLabel, location }: { dateLabel: string; timeLabel?: string | null; location?: string | null }) {
  return (
    <ul aria-label="When and where" className="public-event-summary">
      <li>
        <CalendarDays size={18} aria-hidden="true" />
        <span><strong>When:</strong> {[dateLabel, timeLabel].filter(Boolean).join(" · ")}</span>
      </li>
      <li>
        <MapPin size={18} aria-hidden="true" />
        <span><strong>Where:</strong> {location?.trim() || "Location details coming soon"}</span>
      </li>
    </ul>
  );
}
