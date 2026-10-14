/**
 * Name and intro copy for the attendee event hub (#104).
 *
 * Both come from the event's own settings (`Event.hubTitle`, `Event.hubIntro`).
 * A blank or missing value falls back to the text the hub always showed, so an
 * event that never edits them reads exactly as before. Plain text only.
 */
export const DEFAULT_EVENT_HUB_TITLE = "Event hub";
export const DEFAULT_EVENT_HUB_EYEBROW = "Your attendee hub";
export const DEFAULT_EVENT_HUB_INTRO =
  "Schedule, updates, resources, passes and assigned sessions in one signed-in place.";

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveEventHubCopy(event: {
  hubTitle?: string | null;
  hubIntro?: string | null;
}) {
  const title = clean(event.hubTitle);
  return {
    /** The document title. */
    documentTitle: title ?? DEFAULT_EVENT_HUB_TITLE,
    /** The small label above the event name in the hub header. */
    eyebrow: title ?? DEFAULT_EVENT_HUB_EYEBROW,
    intro: clean(event.hubIntro) ?? DEFAULT_EVENT_HUB_INTRO,
  };
}
