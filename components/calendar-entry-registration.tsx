"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateRange } from "@/modules/calendar/domain";
import type { CalendarAdminEntry, CalendarAdminEvent } from "@/modules/calendar/repository";

type Props = {
  entry: CalendarAdminEntry;
  events: CalendarAdminEvent[];
  saving: boolean;
  /** Sends a request to the calendar admin API; true when it worked. */
  send: (url: string, body: unknown, success: string) => Promise<boolean>;
};

/**
 * One calendar item's registration actions (#445): Add registration (opens the
 * Create event flow filled in from the item), Link to existing event, Unlink,
 * and the one-click answers to a possible match. Nothing links by itself.
 */
export function CalendarEntryRegistration({ entry, events, saving, send }: Props) {
  const [picking, setPicking] = useState(false);
  const [eventId, setEventId] = useState("");
  const linkUrl = `/api/admin/calendar/entries/${encodeURIComponent(entry.id)}/event-link`;
  const addHref = `/event-setup?fromCalendarEntry=${encodeURIComponent(entry.id)}`;

  if (entry.linkedEvent) {
    const event = entry.linkedEvent;
    return (
      <div className="calendar-entry-link" data-testid="calendar-entry-linked">
        <p>
          Registration event: <strong>{event.name}</strong>
          {" "}({event.isPublished ? "published" : "draft"}, {formatDateRange(event.startsOn, event.endsOn)}).
          {" "}The calendar shows this pair once{event.isPublished ? ", as the event with Register" : " (this item stands in until the event is published)"}.
          {entry.datesDifferFromEvent ? " This item's dates differ from the event's; the event's page asks staff to update or keep them." : ""}
          {entry.sourceRemovedAt ? " Google no longer lists this item. The event was not changed." : ""}
        </p>
        {entry.linkedIneligible && (
          <p data-testid="calendar-linked-ineligible">
            <strong>Check this link.</strong> This item is now a deadline, a closure or a repeating item, which can&apos;t stand in for a registration event. It stays linked until you unlink it.
          </p>
        )}
        <Link className="secondary-button" href={`/more/event-settings?event=${encodeURIComponent(event.id)}`}>Open event</Link>
        <button
          className="secondary-button"
          disabled={saving}
          onClick={() => send(linkUrl, { action: "unlink" }, "Unlinked. The item shows on its own again.")}
          type="button"
        >
          Unlink event
        </button>
      </div>
    );
  }

  if (!entry.canLinkToEvent) return null;

  const match = entry.possibleMatch;
  const choices = events.filter((event) => event.linkedEntryId === null);

  return (
    <div className="calendar-entry-link" data-testid="calendar-entry-registration">
      {match && (
        <p data-testid="calendar-possible-match">
          <strong>Possible match:</strong> {match.name} ({match.isPublished ? "published" : "draft"}, {formatDateRange(match.startsOn, match.endsOn)}).
          {" "}The calendar shows both until you choose. Nothing is linked automatically.
        </p>
      )}
      {match && (
        <>
          <button
            aria-label={`Link ${entry.title} to ${match.name}`}
            className="secondary-button"
            disabled={saving}
            onClick={() => send(linkUrl, { action: "link", eventId: match.id }, "Linked. The calendar now shows the pair once.")}
            type="button"
          >
            Link
          </button>
          <button
            aria-label={`${entry.title} is not the same as ${match.name}`}
            className="secondary-button"
            disabled={saving}
            onClick={() => send(linkUrl, { action: "notSame", eventId: match.id }, "Noted. This pair won't be suggested again.")}
            type="button"
          >
            Not the same
          </button>
        </>
      )}
      <Link aria-label={`Add registration for ${entry.title}`} className="secondary-button" href={addHref}>Add registration</Link>
      {!picking && (
        <button className="secondary-button" disabled={saving || choices.length === 0} onClick={() => setPicking(true)} type="button">
          Link to existing event
        </button>
      )}
      {picking && (
        <div className="calendar-link-picker">
          <label>
            <span className="sr-only">Registration event to link {entry.title} to</span>
            <select onChange={(event) => setEventId(event.target.value)} value={eventId}>
              <option value="">Choose an event</option>
              {choices.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} ({formatDateRange(event.startsOn, event.endsOn)}{event.isPublished ? "" : ", draft"})
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={saving || eventId === ""}
            onClick={async () => {
              if (await send(linkUrl, { action: "link", eventId }, "Linked. The calendar now shows the pair once.")) {
                setPicking(false);
                setEventId("");
              }
            }}
            type="button"
          >
            Link
          </button>
          <button className="secondary-button" onClick={() => { setPicking(false); setEventId(""); }} type="button">Cancel</button>
        </div>
      )}
    </div>
  );
}
