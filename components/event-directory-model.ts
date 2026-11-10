import { effectiveLifecycleState, type EventLifecycleStateName } from "@/modules/events/lifecycle-state";
import { makeSearchMatcher } from "@/lib/search-match";
import type { SortValue } from "@/lib/list-sort";

/**
 * The event directory's rows and how they are searched, filtered and ordered (#1570). Pure, so it is unit tested; the
 * list (`components/event-directory.tsx`) only draws them. Status words are the ones the app already uses for an event
 * (`eventLifecycleStateLabel`); nothing here invents a status.
 */
export type DirectoryEventInput = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location?: string | null;
  archivedAt: Date | null;
  isPublished?: boolean;
  lifecycleState?: EventLifecycleStateName | null;
};

export type DirectoryStatusTone = "green" | "gold" | "purple" | "coral" | "neutral";

/**
 * The status words a directory may show: only words on the approved list (site rule B12; `APPROVED_STATUS_WORDS` and the
 * availability words in `scripts/support/site-rules-checks`). A lifecycle state with no word of its own takes the nearest
 * approved one, and an archived event shows none (the Archived events page says so in its title).
 */
export const directoryStatusWords = ["Draft", "Published", "Registration closed", "Closed"] as const;
export type DirectoryStatusWord = typeof directoryStatusWords[number];

export const statusWordFor: Record<EventLifecycleStateName, DirectoryStatusWord | null> = {
  DRAFT: "Draft",
  // A test event behaves exactly like a draft for public visibility and registration (`isPublicState`).
  TEST: "Draft",
  PUBLISHED: "Published",
  REGISTRATION_CLOSED: "Registration closed",
  // Public, with registration left to the dates, as Published is.
  IN_PROGRESS: "Published",
  // Registration is closed by the state itself in all three.
  COMPLETE: "Closed",
  FINANCIAL_RECONCILIATION: "Closed",
  CLOSED: "Closed",
  ARCHIVED: null,
};

const toneFor: Record<DirectoryStatusWord, DirectoryStatusTone> = {
  Draft: "neutral",
  Published: "green",
  "Registration closed": "gold",
  Closed: "neutral",
};

export type EventDirectoryRow = {
  id: string;
  name: string;
  /** "March 5 – 7, 2027", in the event's own time zone. */
  dates: string;
  startsAtMs: number;
  place: string;
  /** The approved word, or null (an archived event). */
  status: DirectoryStatusWord | null;
  statusTone: DirectoryStatusTone;
};

export function formatDirectoryDates(start: Date, end: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).formatRange(start, end);
}

export function buildDirectoryRows(events: readonly DirectoryEventInput[]): EventDirectoryRow[] {
  return events.map((event) => {
    const state = effectiveLifecycleState({
      lifecycleState: event.lifecycleState ?? null,
      isPublished: event.isPublished ?? false,
      archivedAt: event.archivedAt,
    });
    const status = statusWordFor[state];
    return {
      id: event.id,
      name: event.name,
      dates: formatDirectoryDates(event.startsAt, event.endsAt, event.timezone),
      startsAtMs: event.startsAt.getTime(),
      place: (event.location ?? "").trim(),
      status,
      statusTone: status ? toneFor[status] : "neutral",
    };
  });
}

export const directorySortColumns = ["event", "dates", "place", "status"] as const;
export type DirectorySortColumn = typeof directorySortColumns[number];

export const directorySortAccessors: Record<DirectorySortColumn, (row: EventDirectoryRow) => SortValue> = {
  event: (row) => row.name,
  dates: (row) => row.startsAtMs,
  place: (row) => row.place,
  status: (row) => row.status,
};

export const directorySortLabels = {
  event: { label: "event name", kind: "text" },
  dates: { label: "start date", kind: "date" },
  place: { label: "place", kind: "text" },
  status: { label: "status", kind: "text" },
} as const;

/** A status in the address that is not one of the directory's words means "any status". */
export function parseDirectoryStatus(raw: string | string[] | undefined): DirectoryStatusWord | null {
  const value = typeof raw === "string" ? raw : null;
  return directoryStatusWords.find((word) => word === value) ?? null;
}

/** Every typed word has to appear in the name, dates, place or status (any order, ignoring case and accents). */
export function filterDirectoryRows(rows: readonly EventDirectoryRow[], filters: { q: string; status: DirectoryStatusWord | null }): EventDirectoryRow[] {
  const matches = makeSearchMatcher(filters.q);
  return rows.filter((row) => (filters.status === null || row.status === filters.status) && matches([row.name, row.dates, row.place, row.status]));
}

/** The words present in the list, for the status filter. */
export function directoryStatusOptions(rows: readonly EventDirectoryRow[]): DirectoryStatusWord[] {
  const present = new Set(rows.map((row) => row.status));
  return directoryStatusWords.filter((word) => present.has(word));
}
