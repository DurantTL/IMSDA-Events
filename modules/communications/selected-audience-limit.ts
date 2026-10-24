/**
 * The report-to-email handoff (#1103). Client-safe and pure: it only decides
 * which registrations enter the "Email selected" review and how to describe
 * the reduction. It never changes who may receive mail; the server still
 * enforces the same limit and the reviewed, fingerprinted send path.
 */

/** One reviewed batch holds at most this many registrations (the route's own cap). */
export const SELECTED_AUDIENCE_MAX_REGISTRATIONS = 250;

export type BoundedRegistrationSelection = {
  /** Distinct registration ids in the report, before the limit. */
  matchedCount: number;
  /** The ids that enter review: the first `limit` distinct ids, in report order. */
  registrationIds: string[];
  selectedCount: number;
  omittedCount: number;
};

/**
 * Deduplicates by registration id only (never by email address, so
 * registrations that share an address stay separate) and keeps the first
 * `limit` in report order.
 */
export function boundRegistrationSelection(
  registrationIds: readonly string[],
  limit: number = SELECTED_AUDIENCE_MAX_REGISTRATIONS,
): BoundedRegistrationSelection {
  const distinct = [...new Set(registrationIds)];
  const selected = distinct.slice(0, limit);
  return {
    matchedCount: distinct.length,
    registrationIds: selected,
    selectedCount: selected.length,
    omittedCount: distinct.length - selected.length,
  };
}

function plural(count: number) {
  return `${count} registration${count === 1 ? "" : "s"}`;
}

/** Plain-language scope line; empty when nothing is left out. */
export function selectionLimitSummary(
  selection: Pick<BoundedRegistrationSelection, "matchedCount" | "selectedCount" | "omittedCount">,
): string {
  if (selection.omittedCount <= 0) return "";
  return `This list has ${plural(selection.matchedCount)}. One email batch holds at most ${SELECTED_AUDIENCE_MAX_REGISTRATIONS}, so only the first ${selection.selectedCount} will be reviewed. ${plural(selection.omittedCount)} will not be contacted from this list.`;
}
