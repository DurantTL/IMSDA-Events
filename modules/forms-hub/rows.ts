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
  status: FormsHubStatus;
  /** Words for the status: "On" / "Off" for a club form, "Open" / "Not open yet" / "Closed" for an information form. */
  statusLabel: string;
  responseCount: number;
  /** ISO time of the latest response, or null. */
  lastResponseAt: string | null;
  editHref: string;
  responsesHref: string;
};

export const formsHubKindLabels: Record<FormsHubKind, string> = { CLUB: "Club form", GENERAL: "General form", EVENT: "Event form" };

export type FormsHubFilters = { kind: FormsHubKind | null; status: FormsHubStatus | null; q: string };

export function parseFormsHubFilters(params: { kind?: string; status?: string; q?: string }): FormsHubFilters {
  const kind = params.kind === "CLUB" || params.kind === "GENERAL" || params.kind === "EVENT" ? params.kind : null;
  const status = params.status === "OPEN" || params.status === "NOT_OPEN" || params.status === "CLOSED" ? params.status : null;
  const q = (params.q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  return { kind, status, q };
}

export function filterFormsHubRows(rows: readonly FormsHubRow[], filters: FormsHubFilters): FormsHubRow[] {
  const needle = filters.q.toLowerCase();
  return rows.filter((row) => (
    (!filters.kind || row.kind === filters.kind)
    && (!filters.status || row.status === filters.status)
    && (!needle || row.name.toLowerCase().includes(needle) || (row.eventName ?? "").toLowerCase().includes(needle))
  ));
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
