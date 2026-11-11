/**
 * Portal guides that were split or renamed (#1884), by their old id. The old address keeps working: it goes to the
 * guide that now holds the first job. Keep an entry for as long as old links may exist.
 */
export const renamedPortalGuides: Readonly<Record<string, string>> = {
  "director-roster-and-forms": "director-roster",
};

/** The address an old guide id now lives at, keeping the query string, or null when the id was not renamed. */
export function renamedPortalGuidePath(guideId: string, query: Record<string, string | string[] | undefined>): string | null {
  const target = Object.hasOwn(renamedPortalGuides, guideId) ? renamedPortalGuides[guideId] : null;
  if (!target) return null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  }
  const text = search.toString();
  return `/account/help/${target}${text ? `?${text}` : ""}`;
}
