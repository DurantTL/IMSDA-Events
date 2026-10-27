import { ItemLink } from "@/components/calendar-agenda-item";
import { EventCardTransition } from "@/components/event-card-transition";
import { publicEventAssetUrl } from "@/components/event-content-blocks";
import { calendarItemStatusLine, calendarStatusLabels, closureLabel, formatDateRange, type CalendarItem } from "@/modules/calendar/domain";
import { eventSlugFromHref } from "@/modules/events/view-transition";

const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const photoWidths = [640, 960] as const;

/** The resized photo-header image of an event card (#1207 variants), or null when the card has no usable photo. */
export function eventCardImage(item: CalendarItem, images: ReadonlyMap<string, { assetId: string }>) {
  const slug = eventSlugFromHref(item.href);
  const image = slug ? images.get(slug) : undefined;
  if (!slug || !image) return null;
  const base = publicEventAssetUrl(slug, image.assetId);
  return {
    src: `${base}?w=${photoWidths[0]}`,
    srcSet: photoWidths.map((width) => `${base}?w=${width} ${width}w`).join(", "),
  };
}

/**
 * One photo card (#1210, #1218): image (or a navy block with the date), date, title, status. The title is the card's
 * only link; its box is stretched over the whole card, so there is one tab stop and the whole card taps. The image is
 * decorative (empty alt) because the title beside it names the event.
 */
export function EventPhotoCard({
  item, image, variant = "strip", transitionName, headingLevel = 3,
}: {
  item: CalendarItem;
  image?: { src: string; srcSet: string } | null;
  variant?: "strip" | "featured";
  transitionName?: string | null;
  /** 3 under an h2 (the homepage), 4 under the calendar list's Featured h3. */
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const [, month, day] = item.startsOn.split("-").map(Number);
  const statusLine = calendarItemStatusLine(item);
  const flag = item.isClosure ? closureLabel : item.status !== "SCHEDULED" ? calendarStatusLabels[item.status] : null;
  const sizes = variant === "featured" ? "(max-width: 760px) 100vw, 400px" : "(max-width: 760px) 78vw, 320px";
  return (
    <EventCardTransition name={transitionName}>
      <li className={`event-photo-card event-photo-card-${variant}${image ? "" : " is-plain"}${item.status === "CANCELLED" ? " is-cancelled" : ""}`}>
        <div className="event-photo-card-media">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="event-photo-card-image" decoding="async" height={360} loading="lazy" sizes={sizes} src={image.src} srcSet={image.srcSet} width={640} />
          ) : (
            <span aria-hidden="true" className="event-photo-card-date-block">
              <small>{shortMonths[month - 1]}</small>
              <strong>{day}</strong>
            </span>
          )}
        </div>
        <div className="event-photo-card-body">
          <p className="event-photo-card-date">{formatDateRange(item.startsOn, item.endsOn)}</p>
          <Heading><ItemLink className="event-photo-card-link" item={item}>{item.title}</ItemLink></Heading>
          {flag && <p className="event-photo-card-flag">{flag}</p>}
          {statusLine && <p className={`event-photo-card-status${item.registrationOpen ? " is-open" : ""}`}>{statusLine}</p>}
        </div>
      </li>
    </EventCardTransition>
  );
}
