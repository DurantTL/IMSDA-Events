import {
  activeFilterKeys,
  parseOperationsSearchParams,
  resolveOperationsSearch,
  serializeOperationsSearchQuery,
  type FilterKey,
  type OperationsSearchQuery,
  type SearchCatalog,
  type SearchIssue,
  type SearchViewer,
} from "@/modules/registrations/operations-search-domain";

/**
 * Saved views of the Registrations list, the pure half (#1511).
 *
 * A saved view is a name and the canonical operations search query (the same
 * text the URL carries) with its page removed. It holds filter keys and the
 * stored values they name, never registration data, counts or rows. Opening a
 * view is only a link to the list with that query, so whoever opens it is held
 * to their own permissions by the page's existing checks; this module decides
 * only what may be stored and whether a stored view still works for someone.
 */

export const SAVED_VIEW_NAME_MAX = 60;
/** Most views one person keeps per event. */
export const SAVED_VIEWS_PER_PERSON_MAX = 50;

/** A view's name as people see it: spaces collapsed and trimmed, 1 to 60 characters, no control characters. */
export function normalizeSavedViewName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Give this view a name." };
  if (name.length > SAVED_VIEW_NAME_MAX) return { ok: false, message: `Use ${SAVED_VIEW_NAME_MAX} characters or fewer for the name.` };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, message: "The name has a character that cannot be used." };
  // Direction-control characters can make a name read as something it is not.
  if (/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(name)) return { ok: false, message: "The name has a character that cannot be used." };
  return { ok: true, name };
}

export type NormalizedSavedViewQuery = {
  query: OperationsSearchQuery;
  /** Canonical text with the page removed: what is stored. */
  stored: string;
  /** Problems found only by reading the text (an unknown sort, a value that is not recognised). */
  parseIssues: SearchIssue[];
};

/** Reads stored or submitted query text, drops the page and writes it back in canonical form. */
export function normalizeSavedViewQuery(raw: string): NormalizedSavedViewQuery {
  const parsed = parseOperationsSearchParams(new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw));
  const query = { ...parsed.query, page: 1 };
  return { query, stored: serializeOperationsSearchQuery(query), parseIssues: parsed.issues };
}

/** A view needs at least one filter, or a sort other than the default, to be worth keeping. */
export function hasSavableContent(query: OperationsSearchQuery) {
  return activeFilterKeys(query).length > 0 || new URLSearchParams(serializeOperationsSearchQuery(query)).has("sort");
}

/** The filter keys a stored query uses: all an audit entry or a log line may say about it. */
export function savedViewFilterKeys(raw: string): FilterKey[] {
  return activeFilterKeys(normalizeSavedViewQuery(raw).query);
}

export type SavedViewCheck =
  | { ok: true; stored: string; query: OperationsSearchQuery }
  | { ok: false; stored: string; issues: SearchIssue[] };

/**
 * Whether a view's query runs for this viewer on this event's catalog now (a deactivated tag counts as gone). The same all-or-nothing rule as the
 * search itself, so a filter that was removed from the event and one the viewer may not use read the same.
 */
export function checkSavedViewQuery(raw: string, viewer: SearchViewer, catalog: SearchCatalog): SavedViewCheck {
  const { query, stored, parseIssues } = normalizeSavedViewQuery(raw);
  const resolved = resolveOperationsSearch(query, viewer, catalog, parseIssues);
  if (!resolved.ok) return { ok: false, stored, issues: resolved.issues };
  // The search still accepts a deactivated tag, but a view that uses one counts as no longer existing (Caleb, #1511).
  const inactive = new Set(catalog.tags.filter((tag) => !tag.isActive).map((tag) => tag.id));
  if (query.tag.some((id) => inactive.has(id))) {
    return { ok: false, stored, issues: [{ filter: "tag", code: "stale-reference", message: "This item no longer exists for this event." }] };
  }
  return { ok: true, stored, query };
}

export const STALE_VIEW_NOTE = "Uses a filter that no longer exists or isn't available to you.";

/** What the Saved views panel shows for one view. */
export type SavedViewItem = {
  id: string;
  name: string;
  /** Canonical query text, without the page. */
  query: string;
  shared: boolean;
  /** True for the signed-in person's own views. */
  isOwn: boolean;
  /** The sharer's name for someone else's shared view, otherwise null. */
  ownerName: string | null;
  /** The view uses a filter that no longer exists or that this viewer cannot use. */
  stale: boolean;
};
