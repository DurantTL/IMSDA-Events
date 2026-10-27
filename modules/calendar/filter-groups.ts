/**
 * The public calendar's filter chips (#1249). One constant holds every group's slug, label and category names, so the
 * Month view, the Upcoming list and the Year view (#1250) all filter the same way. Everything here is pure.
 *
 * Category names match case-insensitively. A category that appears in no group has no chip of its own: it shows under
 * Main events (which is "everything except" its excluded groups) and under Everything.
 */

import { closureCategory, type CalendarItem } from "@/modules/calendar/domain";

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

/** Every category name a feed uses for office closures and holidays. */
const closureAndHolidayCategories = [closureCategory, "Office closed", "Office closed & holidays", "Holiday", "Holidays"] as const;

export const calendarFilterGroups: readonly CalendarFilterGroup[] = [
  { slug: "main", label: "Main events", mode: "exclude", categories: ["Schools", "Meetings", ...closureAndHolidayCategories], includeClosures: true },
  { slug: "club", label: "Club events", mode: "include", categories: ["Pathfinders", "Adventurers"], includeClubEvents: true },
  { slug: "pathfinders", label: "Pathfinders", mode: "include", categories: ["Pathfinders"] },
  { slug: "adventurers", label: "Adventurers", mode: "include", categories: ["Adventurers"] },
  { slug: "camps", label: "Camps", mode: "include", categories: ["Camps"] },
  { slug: "ministries", label: "Ministries", mode: "include", categories: ["Ministries"] },
  { slug: "schools", label: "Schools", mode: "include", categories: ["Schools"] },
  { slug: "meetings", label: "Meetings", mode: "include", categories: ["Meetings"] },
  { slug: "closed", label: "Office closed & holidays", mode: "include", categories: closureAndHolidayCategories, includeClosures: true },
  { slug: "everything", label: "Everything", mode: "all", categories: [] },
];

export const defaultCalendarFilter = "main";

const lower = (value: string) => value.trim().toLowerCase();

/** The group for a slug, or undefined for anything that is not one of the slugs. */
export function calendarFilterGroup(slug: string | undefined) {
  return slug ? calendarFilterGroups.find((group) => group.slug === slug) : undefined;
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
export function filterByGroup(items: CalendarItem[], slug: string | undefined) {
  const group = calendarFilterGroup(slug) ?? calendarFilterGroup(defaultCalendarFilter)!;
  return group.mode === "all" ? items : items.filter((item) => itemInFilterGroup(item, group));
}

/**
 * The chosen filter from the URL. `?filter=` wins when it names a group. An old `?category=` link (before #1249) maps to the
 * group whose label or only category is that name (`?category=Camps` is Camps), else to Everything narrowed to that one
 * category, so a shared link never shows more or less than it used to. No param is the default group.
 */
export function resolveCalendarFilter(filter: string | undefined, category: string | undefined): { slug: string; category?: string } {
  if (calendarFilterGroup(filter)) return { slug: filter! };
  const wanted = category ? lower(category) : "";
  if (!wanted) return { slug: defaultCalendarFilter };
  const match = calendarFilterGroups.find((group) =>
    group.mode === "include" && !group.includeClubEvents && (lower(group.label) === wanted || (group.categories.length === 1 && lower(group.categories[0]) === wanted)),
  ) ?? calendarFilterGroups.find((group) => group.slug === "closed" && group.categories.some((name) => lower(name) === wanted));
  return match ? { slug: match.slug } : { slug: "everything", category: category!.trim() };
}
