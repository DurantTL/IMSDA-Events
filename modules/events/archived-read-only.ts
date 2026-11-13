/**
 * Archived events are read-only for staff writes (#159): the pure half. Free of server-only imports so
 * `withRequestContext` can classify a request without loading the database client.
 * The server half is `archived-read-only-guard.ts`.
 * Covers event staff routes (`/api/events/<id>/...`). The Area Coordinator and TLT director event routes already refuse
 * archived events through `loadScopedToolEvent`.
 */

export const EVENT_ARCHIVED_CODE = "EVENT_ARCHIVED";
export const EVENT_ARCHIVED_READ_ONLY_MESSAGE =
  "This event is archived, so it is read-only. Unarchive it in Event settings to make changes. Reports and exports still work.";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Archive actions: archiving is idempotent, and unarchiving must always work or an archived event could never be changed again. */
const ARCHIVE_ACTIONS = new Set(["archive", "unarchive"]);

/**
 * Event-relative paths of POSTs that carry a body but only read: reporting, previews and lookups stay available on an
 * archived event.
 */
const READ_ONLY_POSTS: readonly RegExp[] = [
  /^cancellation-policy\/preview$/, // computes a proposed cancellation outcome, writes nothing
  /^content\/html-preview$/, // runs the sanitizer over typed text, writes nothing
  /^club-reports\/columns$/, // builds a club report (preview, print, CSV); saving a layout is refused in the handler
  /^attendee-passes\/resolve$/, // looks a pass or confirmation code up, writes nothing
  /^forms\/[^/]+\/field-answer-counts$/, // counts submitted answers, writes nothing
  /^general-link\/teams\/[^/]+\/similar-clubs$/, // lists directory clubs a typed name could be, writes nothing
];

export type ArchivedWriteTarget = { eventId: string };

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The event when this request is a write to an event's staff routes, else null. Reads, the exemptions
 * above, and every other path return null.
 */
export function archivedWriteTarget(method: string, pathname: string): ArchivedWriteTarget | null {
  const verb = method.toUpperCase();
  if (READ_METHODS.has(verb)) return null;
  // Empty segments (leading and trailing slashes) are dropped, so "/api/events/e1/" matches "/api/events/e1".
  const parts = pathname.split("/").filter((segment) => segment !== "");
  if (parts[0] !== "api") return null;

  if (parts[1] === "events" && parts[2]) {
    const rest = parts.slice(3).join("/");
    if (rest === "" && verb === "DELETE") return null; // deleting an empty event is its own confirmed, system-administrator action
    if (ARCHIVE_ACTIONS.has(rest)) return null;
    if (verb === "POST" && READ_ONLY_POSTS.some((pattern) => pattern.test(rest))) return null;
    return { eventId: decodeSegment(parts[2]) };
  }

  return null;
}
