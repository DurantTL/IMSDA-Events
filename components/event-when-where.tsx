import { CalendarDays, MapPin } from "lucide-react";
import { EventDirectionsLinks } from "@/components/event-directions-links";
import { EventShareButton } from "@/components/event-share-button";
import type { DirectionsTarget } from "@/modules/events/directions";

/**
 * The plain When / Where summary under an event's title (#1205), the same in every header variant. `timeLabel` may be
 * empty; the location falls back to a plain "coming soon" so the row never disappears.
 */
export function EventWhenWhere({ dateLabel, timeLabel, location, directions, shareUrl, shareTitle }: {
  dateLabel: string;
  timeLabel?: string | null;
  location?: string | null;
  /** "Get directions" links (#1213), already built on the server; none renders nothing. */
  directions?: readonly DirectionsTarget[];
  /** The canonical public address to share (#1214); absent for an unpublished or archived event. */
  shareUrl?: string | null;
  shareTitle?: string;
}) {
  return (
    <>
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
    {(directions?.length || shareUrl) ? (
      <div className="public-event-actions">
        {directions && <EventDirectionsLinks targets={directions} />}
        {shareUrl && <EventShareButton title={shareTitle ?? ""} url={shareUrl} />}
      </div>
    ) : null}
    </>
  );
}
