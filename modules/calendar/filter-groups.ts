/**
 * The public calendar's filter chips (#1249, #1611). The six chips after "Main events" come from the six homepage ministry
 * tiles (`HomepageMinistry`), so the calendar and the "Find your place" tiles always match. `buildCalendarFilterGroups` turns
 * the tiles into the groups; the Month view, the Upcoming list and the Year view (#1250) all filter with the same groups.
 * Everything here is pure: the page loads the tiles (`public-filters.ts`) and passes them in.
 *
 * Category names match case-insensitively and ignoring surrounding spaces. A category that appears in no group has no chip of
 * its own: it shows under Main events (which is "everything except" its excluded groups) and under Everything.
 */

import { closureCategory, type CalendarItem } from "@/modules/calendar/domain";
import { ministryFilterSlug, type HomepageMinistry } from "@/modules/system-admin/homepage-ministries-domain";

export type CalendarFilterGroup = {
  /** The `?filter=` value. */
  slug: string;
  label: string;
  /**
   * `include`: items in one of `categories` (plus the extras below). `exclude`: every item except those in `categories`.
   * `all`: every item.
   */
  mode: "include" | "exclude" | "all";
  categories: readonly string[];
  /** Also include registration events whose audience is clubs (`CalendarItem.clubEvent`). */
  includeClubEvents?: boolean;
  /** Also include office closures (`CalendarItem.isClosure`), whatever their category. */
  includeClosures?: boolean;
};

/** The part of a homepage tile the calendar filters need. */
export type CalendarFilterTile = Pick<HomepageMinistry, "position" | "name" | "categories">;

/** Every category name a feed uses for office closures and holidays. */
const closureAndHolidayCategories = [closureCategory, "Office closed", "Office closed & holidays", "Holiday", "Holidays"] as const;

const mainGroup: CalendarFilterGroup = { slug: "main", label: "Main events", mode: "exclude", categories: ["Schools", "Meetings", ...closureAndHolidayCategories], includeClosures: true };
const fixedAfterTiles: readonly CalendarFilterGroup[] = [
  { slug: "schools", label: "Schools", mode: "include", categories: ["Schools"] },
  { slug: "meetings", label: "Meetings", mode: "include", categories: ["Meetings"] },
  { slug: "closed", label: "Office closed & holidays", mode: "include", categories: closureAndHolidayCategories, includeClosures: true },
  { slug: "everything", label: "Everything", mode: "all", categories: [] },
];

export const defaultCalendarFilter = "main";

const lower = (value: string) => value.trim().toLowerCase();

/**
 * Every chip, in order: Main events, the six homepage tiles (by position, labelled with the tile name, `ministry-N` slugs),
 * Schools, Meetings, Office closed & holidays, Everything. A tile with no categories gives an empty chip, so the calendar
 * still renders when the tiles are the fallback names. Two tiles may list the same category: the item shows under both.
 */
export function buildCalendarFilterGroups(tiles: readonly CalendarFilterTile[]): readonly CalendarFilterGroup[] {
  const seen = new Set<number>();
  const tileGroups = [...tiles]
    .sort((a, b) => a.position - b.position)
    .filter((tile) => !seen.has(tile.position) && seen.add(tile.position))
    .map((tile): CalendarFilterGroup => ({
      slug: ministryFilterSlug(tile.position),
      label: tile.name.trim() || `Tile ${tile.position}`,
      mode: "include",
      categories: tile.categories.map((category) => category.trim()).filter(Boolean),
    }));
  return [mainGroup, ...tileGroups, ...fixedAfterTiles];
}

/** The group for a slug, or undefined for anything that is not one of the slugs. */
export function calendarFilterGroup(slug: string | undefined, groups: readonly CalendarFilterGroup[]) {
  return slug ? groups.find((group) => group.slug === slug) : undefined;
}

/** Whether one item belongs to a group. */
export function itemInFilterGroup(item: CalendarItem, group: CalendarFilterGroup) {
  if (group.mode === "all") return true;
  const names = group.categories.map(lower);
  const listed = names.includes(lower(item.category)) || (group.includeClosures === true && item.isClosure === true);
  if (group.mode === "exclude") return !listed;
  return listed || (group.includeClubEvents === true && item.kind === "EVENT" && item.clubEvent === true);
}

/** Items in the group with this slug; an unknown slug falls back to the default group. */
export function filterByGroup(items: CalendarItem[], slug: string | undefined, groups: readonly CalendarFilterGroup[]) {
  const group = calendarFilterGroup(slug, groups) ?? calendarFilterGroup(defaultCalendarFilter, groups)!;
  return group.mode === "all" ? items : items.filter((item) => itemInFilterGroup(item, group));
}

/** The chips that stood before the tiles (#1249). An old shared link keeps working: it goes to the tile that lists these categories, else to Everything. */
const legacyFilterCategories: Readonly<Record<string, readonly string[]>> = {
  club: ["Pathfinders", "Adventurers"],
  pathfinders: ["Pathfinders"],
  adventurers: ["Adventurers"],
  camps: ["Camps"],
  ministries: ["Ministries"],
};

const tileSlugPattern = /^ministry-\d+$/;

/** The first tile chip that lists one of these category names. */
function tileCovering(names: readonly string[], groups: readonly CalendarFilterGroup[]) {
  const wanted = names.map(lower);
  return groups.find((group) => tileSlugPattern.test(group.slug) && group.categories.some((category) => wanted.includes(lower(category))));
}

/**
 * The chosen filter from the URL. `?filter=` wins when it names a chip. An old `?filter=` slug (`pathfinders`, `adventurers`,
 * `camps`, `ministries`, `club`) goes to the tile that covers it, else to Everything. An old `?category=` link maps to the
 * chip that lists that category (a tile first), else to Everything narrowed to that one category, so a shared link never
 * shows more or less than it used to. No param is the default group.
 */
export function resolveCalendarFilter(filter: string | undefined, category: string | undefined, groups: readonly CalendarFilterGroup[]): { slug: string; category?: string } {
  if (calendarFilterGroup(filter, groups)) return { slug: filter! };
  if (filter && Object.hasOwn(legacyFilterCategories, filter)) {
    return { slug: tileCovering(legacyFilterCategories[filter], groups)?.slug ?? "everything" };
  }
  const wanted = category ? lower(category) : "";
  if (!wanted) return { slug: defaultCalendarFilter };
  const match = groups.find((group) => group.mode === "include" && group.categories.some((name) => lower(name) === wanted));
  return match ? { slug: match.slug } : { slug: "everything", category: category!.trim() };
}

/** The categories staff can pick, and the ones that sit on a public chip. */
export type CalendarCategoryChoices = {
  /** The dropdown, in order: the tiles' categories (no repeats), then Schools, Meetings and Office closure. */
  options: string[];
  /** Every category name some chip lists (including the other names a feed uses for closures), for "Not on a public filter". */
  matched: string[];
};

function uniqueNames(names: readonly string[]) {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = lower(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function calendarCategoryChoices(groups: readonly CalendarFilterGroup[]): CalendarCategoryChoices {
  const fromChips = (slugs: (slug: string) => boolean) => groups.filter((group) => group.mode === "include" && slugs(group.slug)).flatMap((group) => group.categories);
  return {
    options: uniqueNames([...fromChips((slug) => tileSlugPattern.test(slug)), "Schools", "Meetings", closureCategory]),
    matched: uniqueNames(fromChips(() => true)),
  };
}

/** Whether a category sits on a public chip. No category is fine: it shows under Main events and Everything. */
export function categoryOnPublicFilter(category: string, matched: readonly string[]) {
  const key = lower(category);
  return !key || matched.some((name) => lower(name) === key);
}
