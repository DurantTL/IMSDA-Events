/**
 * Names for the card-to-header view transition (#1208). A view-transition name must be unique on a page (a duplicate
 * aborts the whole transition), so a card and the event page header share one name per event and a page names only the
 * first card of each event.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The view-transition name for an event's card and page header. Anything outside [a-z0-9-] becomes "-". */
export function eventViewTransitionName(slug: string) {
  return `event-card-${slug.replace(/[^a-z0-9-]/g, "-")}`;
}

/** The slug for an exact `/events/<slug>` path; null for anything else (sub-pages, external links, junk). */
export function eventSlugFromHref(href: string | null | undefined) {
  if (!href) return null;
  const match = /^\/events\/([^/?#]+)$/.exec(href);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return SLUG_PATTERN.test(slug) ? slug : null;
}

/**
 * Names for the items of one page, keyed by item key. Only the first item of each event gets a name; an item that
 * links elsewhere gets none. `used` holds names already taken on the page and is added to, so several lists share it.
 */
export function eventTransitionNames(
  items: ReadonlyArray<{ key: string; href?: string | null }>,
  used: Set<string> = new Set(),
) {
  const names = new Map<string, string>();
  for (const item of items) {
    const slug = eventSlugFromHref(item.href);
    if (!slug) continue;
    const name = eventViewTransitionName(slug);
    if (used.has(name)) continue;
    used.add(name);
    names.set(item.key, name);
  }
  return names;
}
