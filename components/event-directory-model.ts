import { eventLifecycleStateLabel, eventLifecycleStates, effectiveLifecycleState, type EventLifecycleStateName } from "@/modules/events/lifecycle-state";
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

export type EventDirectoryRow = {
  id: string;
  name: string;
  /** "March 5 – 7, 2027", in the event's own time zone. */
  dates: string;
  startsAtMs: number;
  place: string;
  status: EventLifecycleStateName;
  statusLabel: string;
  statusTone: DirectoryStatusTone;
};

const toneFor: Record<EventLifecycleStateName, DirectoryStatusTone> = {
  DRAFT: "neutral",
  TEST: "gold",
  PUBLISHED: "green",
  REGISTRATION_CLOSED: "gold",
  IN_PROGRESS: "purple",
  COMPLETE: "neutral",
  FINANCIAL_RECONCILIATION: "coral",
  CLOSED: "neutral",
  ARCHIVED: "neutral",
};

export function formatDirectoryDates(start: Date, end: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).formatRange(start, end);
}

export function buildDirectoryRows(events: readonly DirectoryEventInput[]): EventDirectoryRow[] {
  return events.map((event) => {
    const status = effectiveLifecycleState({
      lifecycleState: event.lifecycleState ?? null,
      isPublished: event.isPublished ?? false,
      archivedAt: event.archivedAt,
    });
    return {
      id: event.id,
      name: event.name,
      dates: formatDirectoryDates(event.startsAt, event.endsAt, event.timezone),
      startsAtMs: event.startsAt.getTime(),
      place: (event.location ?? "").trim(),
      status,
      statusLabel: eventLifecycleStateLabel(status),
      statusTone: toneFor[status],
    };
  });
}

export const directorySortColumns = ["event", "dates", "place", "status"] as const;
export type DirectorySortColumn = typeof directorySortColumns[number];

export const directorySortAccessors: Record<DirectorySortColumn, (row: EventDirectoryRow) => SortValue> = {
  event: (row) => row.name,
  dates: (row) => row.startsAtMs,
  place: (row) => row.place,
  status: (row) => row.statusLabel,
};

export const directorySortLabels = {
  event: { label: "event name", kind: "text" },
  dates: { label: "start date", kind: "date" },
  place: { label: "place", kind: "text" },
  status: { label: "status", kind: "text" },
} as const;

/** A status in the address that is not one of the known states means "any status". */
export function parseDirectoryStatus(raw: string | string[] | undefined): EventLifecycleStateName | null {
  const value = typeof raw === "string" ? raw : null;
  return eventLifecycleStates.find((state) => state === value) ?? null;
}

/** Every typed word has to appear in the name, dates, place or status (any order, ignoring case and accents). */
export function filterDirectoryRows(rows: readonly EventDirectoryRow[], filters: { q: string; status: EventLifecycleStateName | null }): EventDirectoryRow[] {
  const matches = makeSearchMatcher(filters.q);
  return rows.filter((row) => (filters.status === null || row.status === filters.status) && matches([row.name, row.dates, row.place, row.statusLabel]));
}

/** The statuses present in the list, in lifecycle order, for the status filter. */
export function directoryStatusOptions(rows: readonly EventDirectoryRow[]): Array<{ value: EventLifecycleStateName; label: string }> {
  const present = new Set(rows.map((row) => row.status));
  return eventLifecycleStates.filter((state) => present.has(state)).map((state) => ({ value: state, label: eventLifecycleStateLabel(state) }));
}
