// The "All forms" hub (#1151): pure row shape, filter and search, so the rules are testable without a database.
export type FormsHubKind = "CLUB" | "GENERAL" | "EVENT";
export type FormsHubStatus = "OPEN" | "NOT_OPEN" | "CLOSED";

export type FormsHubRow = {
  /** Unique across kinds. */
  id: string;
  kind: FormsHubKind;
  name: string;
  /** The event's name for an event information form. */
  eventName: string | null;
  /** The owning event's id for an event information form; null for club and general forms. */
  eventId: string | null;
  status: FormsHubStatus;
  /** One set of words on this hub: "Open", "Not open yet" or "Closed". A club form that is on is Open and one that is off is Closed. */
  statusLabel: string;
  responseCount: number;
  /** ISO time of the latest response, or null. */
  lastResponseAt: string | null;
  editHref: string;
  responsesHref: string;
};

export const formsHubKindLabels: Record<FormsHubKind, string> = { CLUB: "Club form", GENERAL: "General information form", EVENT: "Event information form" };

/** The owner filter: every owner, clubs, the conference (general forms), or one event (`event:<eventId>`). */
export type FormsHubOwner = "CLUB" | "GENERAL" | `event:${string}`;
export type FormsHubFilters = { kind: FormsHubKind | null; status: FormsHubStatus | null; owner: FormsHubOwner | null; q: string };

export const formsHubStatusLabels: Record<FormsHubStatus, string> = { OPEN: "Open", NOT_OPEN: "Not open yet", CLOSED: "Closed" };

const EVENT_OWNER = /^event:[A-Za-z0-9_-]{1,64}$/;

/** An owner value in its allowed shape, or null. A well-formed event id that matches nothing is kept: it shows "No forms match". */
export function parseFormsHubOwner(value: string | undefined | null): FormsHubOwner | null {
  if (value === "CLUB" || value === "GENERAL") return value;
  return typeof value === "string" && EVENT_OWNER.test(value) ? (value as FormsHubOwner) : null;
}

export function parseFormsHubFilters(params: { kind?: string; status?: string; owner?: string; q?: string }): FormsHubFilters {
  const kind = params.kind === "CLUB" || params.kind === "GENERAL" || params.kind === "EVENT" ? params.kind : null;
  const status = params.status === "OPEN" || params.status === "NOT_OPEN" || params.status === "CLOSED" ? params.status : null;
  const owner = parseFormsHubOwner(params.owner);
  const q = (params.q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  return { kind, status, owner, q };
}

function matchesOwner(row: FormsHubRow, owner: FormsHubOwner | null): boolean {
  if (!owner) return true;
  if (owner === "CLUB") return row.kind === "CLUB";
  if (owner === "GENERAL") return row.kind === "GENERAL";
  return row.kind === "EVENT" && row.eventId !== null && `event:${row.eventId}` === owner;
}

export function filterFormsHubRows(rows: readonly FormsHubRow[], filters: FormsHubFilters): FormsHubRow[] {
  const needle = filters.q.toLowerCase();
  return rows.filter((row) => (
    (!filters.kind || row.kind === filters.kind)
    && (!filters.status || row.status === filters.status)
    && matchesOwner(row, filters.owner)
    && (!needle || row.name.toLowerCase().includes(needle) || (row.eventName ?? "").toLowerCase().includes(needle))
  ));
}

/** One option per event that owns at least one listed event information form, by event name. */
export function formsHubEventOwners(rows: readonly FormsHubRow[]): { value: FormsHubOwner; label: string }[] {
  const events = new Map<string, string>();
  for (const row of rows) if (row.kind === "EVENT" && row.eventId && !events.has(row.eventId)) events.set(row.eventId, row.eventName ?? "Unnamed event");
  return [...events].map(([id, name]) => ({ value: `event:${id}` as const, label: name })).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

const kindOrder: Record<FormsHubKind, number> = { CLUB: 0, GENERAL: 1, EVENT: 2 };

/** Club forms first, then general, then event forms; by name inside each group (event forms by event, then name). */
export function sortFormsHubRows(rows: readonly FormsHubRow[]): FormsHubRow[] {
  return [...rows].sort((a, b) => (
    kindOrder[a.kind] - kindOrder[b.kind]
    || (a.eventName ?? "").localeCompare(b.eventName ?? "")
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id)
  ));
}
