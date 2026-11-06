import "server-only";

import { calendarCategoryChoices, buildCalendarFilterGroups, type CalendarCategoryChoices, type CalendarFilterGroup } from "@/modules/calendar/filter-groups";
import { listHomepageMinistries } from "@/modules/system-admin/homepage-ministries";

/**
 * The public calendar's filter chips (#1611), built from the six homepage ministry tiles. The one server-side read behind
 * the public calendar, the embed widget and Calendar admin's category list, so there is no second list to keep in step.
 * Never throws: an empty or unreadable tile table gives the fallback tile names with no categories.
 */
export async function loadCalendarFilterGroups(): Promise<readonly CalendarFilterGroup[]> {
  return buildCalendarFilterGroups(await listHomepageMinistries());
}

/** What Calendar admin offers staff: the category dropdown and the names that sit on a public chip. */
export async function loadCalendarCategoryChoices(): Promise<CalendarCategoryChoices & { filterSlugs: string[] }> {
  const groups = await loadCalendarFilterGroups();
  return { ...calendarCategoryChoices(groups), filterSlugs: groups.map((group) => group.slug) };
}
