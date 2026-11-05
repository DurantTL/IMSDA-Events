import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ministries: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/system-admin/homepage-ministries", () => ({ listHomepageMinistries: mocks.ministries }));

import { CalendarCategorySelect } from "@/components/calendar-category-select";
import { buildEntryWhere, defaultEntryFilters, matchesFilters, unmatchedCategoryFilter, type AdminListEntry } from "@/modules/calendar/admin-list";
import type { CalendarItem } from "@/modules/calendar/domain";
import {
  buildCalendarFilterGroups,
  calendarCategoryChoices,
  categoryOnPublicFilter,
  eventOnPublicFilter,
  filterByGroup,
  resolveCalendarFilter,
} from "@/modules/calendar/filter-groups";
import { loadCalendarCategoryChoices, loadCalendarFilterGroups } from "@/modules/calendar/public-filters";
import { fallbackHomepageMinistries, ministryFilterSlug, ministryLinkHref } from "@/modules/system-admin/homepage-ministries-domain";

/** Synthetic tiles, like the homepage's six (#1611). */
const tiles = [
  { position: 1, name: "Pathfinders", categories: ["Pathfinders"] },
  { position: 2, name: "Adventurers", categories: ["Adventurers"] },
  { position: 3, name: "Women's Ministries", categories: ["Women's Ministries"] },
  { position: 4, name: "Men's Ministries", categories: ["Men's Ministries", " Men's Retreat "] },
  { position: 5, name: "Camp Heritage", categories: ["Camps"] },
  { position: 6, name: "Youth", categories: ["Youth", "Camps"] },
];
const groups = buildCalendarFilterGroups(tiles);

const item = (key: string, category: string): CalendarItem =>
  ({ key, kind: "ENTRY", title: key, description: "", startsOn: "2026-11-10", endsOn: "2026-11-10", timeLabel: "", location: "", category, href: null, status: "SCHEDULED", registrationOpen: false }) as CalendarItem;

describe("building the chips from the homepage tiles (#1611)", () => {
  it("puts Main events first, the six tiles in position order, then Schools, Meetings, closures and Everything", () => {
    expect(groups.map((group) => group.slug)).toEqual([
      "main", "ministry-1", "ministry-2", "ministry-3", "ministry-4", "ministry-5", "ministry-6", "schools", "meetings", "closed", "everything",
    ]);
    expect(groups.map((group) => group.label).slice(1, 7)).toEqual(tiles.map((tile) => tile.name));
    const shuffled = buildCalendarFilterGroups([tiles[2], tiles[0], tiles[5], tiles[1], tiles[4], tiles[3]]);
    expect(shuffled.map((group) => group.slug)).toEqual(groups.map((group) => group.slug));
  });

  it("keeps a tile's slug when it is renamed, so a shared link still works", () => {
    const renamed = buildCalendarFilterGroups(tiles.map((tile) => (tile.position === 3 ? { ...tile, name: "Women's Ministries & Friends" } : tile)));
    expect(renamed.find((group) => group.slug === ministryFilterSlug(3))?.label).toBe("Women's Ministries & Friends");
  });

  it("includes every category a tile lists, ignoring case and surrounding spaces", () => {
    const items = [item("a", "men's ministries"), item("b", "MEN'S RETREAT"), item("c", "Youth"), item("d", "Other")];
    expect(filterByGroup(items, "ministry-4", groups).map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(filterByGroup([item("e", "  youth  ")], "ministry-6", groups)).toHaveLength(1);
  });

  it("shows an item under every tile that lists its category, and an empty tile gives an empty chip", () => {
    const items = [item("camp", "Camps")];
    expect(filterByGroup(items, "ministry-5", groups)).toHaveLength(1);
    expect(filterByGroup(items, "ministry-6", groups)).toHaveLength(1);
    expect(filterByGroup(items, "ministry-1", groups)).toHaveLength(0);
    const fallback = buildCalendarFilterGroups(fallbackHomepageMinistries);
    expect(fallback).toHaveLength(11);
    expect(filterByGroup([item("any", "Pathfinders")], "ministry-1", fallback)).toEqual([]);
    expect(filterByGroup([item("any", "Pathfinders")], "main", fallback)).toHaveLength(1);
  });

  it("drops the old fixed Club events, Pathfinders, Adventurers, Camps and Ministries chips", () => {
    for (const slug of ["club", "pathfinders", "adventurers", "camps", "ministries"]) expect(groups.some((group) => group.slug === slug)).toBe(false);
  });
});

describe("old links (#1611)", () => {
  it("sends an old filter slug to the tile that covers it, else to Everything", () => {
    expect(resolveCalendarFilter("pathfinders", undefined, groups)).toEqual({ slug: "ministry-1" });
    expect(resolveCalendarFilter("adventurers", undefined, groups)).toEqual({ slug: "ministry-2" });
    expect(resolveCalendarFilter("camps", undefined, groups)).toEqual({ slug: "ministry-5" });
    // Club needs Pathfinders AND Adventurers on one tile: separate tiles would each show less than the old link did.
    expect(resolveCalendarFilter("club", undefined, groups)).toEqual({ slug: "everything" });
    const together = buildCalendarFilterGroups([{ position: 1, name: "Clubs", categories: ["pathfinders", "Adventurers"] }, ...tiles.slice(1)]);
    expect(resolveCalendarFilter("club", undefined, together)).toEqual({ slug: "ministry-1" });
    expect(resolveCalendarFilter("ministries", undefined, groups)).toEqual({ slug: "everything" });
    expect(resolveCalendarFilter("pathfinders", undefined, buildCalendarFilterGroups(fallbackHomepageMinistries))).toEqual({ slug: "everything" });
  });

  it("sends ?category= to the tile that includes it, else to Everything narrowed to it", () => {
    expect(resolveCalendarFilter(undefined, "men's retreat", groups)).toEqual({ slug: "ministry-4" });
    expect(resolveCalendarFilter(undefined, " Youth ", groups)).toEqual({ slug: "ministry-6" });
    expect(resolveCalendarFilter(undefined, "Camps", groups)).toEqual({ slug: "ministry-5" });
    expect(resolveCalendarFilter(undefined, "Schools", groups)).toEqual({ slug: "schools" });
    expect(resolveCalendarFilter(undefined, "Office closure", groups)).toEqual({ slug: "closed" });
    expect(resolveCalendarFilter(undefined, "Retreats", groups)).toEqual({ slug: "everything", category: "Retreats" });
  });

  it("keeps a real slug ahead of a category and an unknown slug on the default", () => {
    expect(resolveCalendarFilter("ministry-3", "Youth", groups)).toEqual({ slug: "ministry-3" });
    expect(resolveCalendarFilter("ministry-9", undefined, groups)).toEqual({ slug: "main" });
    expect(resolveCalendarFilter("toString", undefined, groups)).toEqual({ slug: "main" });
  });
});

describe("a tile's link (#1611)", () => {
  it("opens the calendar on that tile's button unless staff set a link", () => {
    expect(ministryLinkHref({ linkHref: null, position: 4 })).toBe("/calendar?view=list&filter=ministry-4");
    expect(ministryLinkHref({ linkHref: "/clubs", position: 4 })).toBe("/clubs");
    const slug = new URL(ministryLinkHref({ linkHref: null, position: 6 }), "https://example.test").searchParams.get("filter");
    expect(groups.some((group) => group.slug === slug)).toBe(true);
  });
});

describe("one list for staff and the public (#1611)", () => {
  it("builds both from the tiles the server reads", async () => {
    mocks.ministries.mockResolvedValue(tiles.map((tile) => ({ ...tile, description: null, linkHref: null, icon: "Users" })));
    expect((await loadCalendarFilterGroups()).map((group) => group.slug)).toEqual(groups.map((group) => group.slug));
    const choices = await loadCalendarCategoryChoices();
    expect(choices.options).toEqual(["Pathfinders", "Adventurers", "Women's Ministries", "Men's Ministries", "Men's Retreat", "Camps", "Youth", "Schools", "Meetings", "Office closure"]);
    expect(choices.filterSlugs).toEqual(groups.map((group) => group.slug));
  });

  it("falls back to Schools, Meetings and Office closure when the tiles have no categories", () => {
    expect(calendarCategoryChoices(buildCalendarFilterGroups(fallbackHomepageMinistries)).options).toEqual(["Schools", "Meetings", "Office closure"]);
  });

  it("counts the names a button lists, even closure spellings, as on a public filter", () => {
    const { matched } = calendarCategoryChoices(groups);
    for (const name of ["pathfinders", "Camps", "SCHOOLS", "Holiday", "Office closed & holidays"]) expect(categoryOnPublicFilter(name, matched)).toBe(true);
    expect(categoryOnPublicFilter("", matched)).toBe(true);
    expect(categoryOnPublicFilter("Retreats", matched)).toBe(false);
  });
});

describe("the category dropdown (#1611)", () => {
  const choices = calendarCategoryChoices(groups);
  const html = (props: { defaultValue?: string; value?: string; placeholder?: string }) => renderToStaticMarkup(createElement(CalendarCategorySelect, { choices, name: "category", ...props }));

  it("lists the tiles' categories, then Schools, Meetings and Office closure, then No category", () => {
    const markup = html({ defaultValue: "" });
    const labels = [...markup.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Pathfinders", "Adventurers", "Women&#x27;s Ministries", "Men&#x27;s Ministries", "Men&#x27;s Retreat", "Camps", "Youth", "Schools", "Meetings", "Office closure", "No category"]);
  });

  it("keeps an unlisted saved value, marked Not on a public filter, and selects it", () => {
    const markup = html({ defaultValue: "Retreats" });
    expect(markup).toContain('<option value="Retreats" selected="">Retreats (Not on a public filter)</option>');
  });

  it("keeps a differently spelled match without a mark, and a closure spelling as on a filter", () => {
    expect(html({ defaultValue: "PATHFINDERS " })).toContain('<option value="Pathfinders" selected="">Pathfinders</option>');
    expect(html({ defaultValue: "PATHFINDERS " })).not.toContain("PATHFINDERS");
    expect(html({ defaultValue: "Holiday" })).toContain(">Holiday</option>");
    expect(html({ defaultValue: "Holiday" })).not.toContain("Not on a public filter");
  });

  it("offers a Choose a category row for the bulk bar", () => {
    expect(html({ value: "__choose__", placeholder: "Choose a category" })).toContain('<option value="__choose__" selected="">Choose a category</option>');
  });
});

describe("Not on a public filter in Calendar admin (#1611)", () => {
  const { matched } = calendarCategoryChoices(groups);
  const entry = (category: string): AdminListEntry => ({
    id: category || "none", title: "Synthetic", description: "", location: "", category, startsOn: "2026-11-20", endsOn: "2026-11-20",
    entryType: "STANDARD", isPublished: true, isHiddenLocally: false, sourceFeedId: null, sourceRemovedAt: null,
  });
  const filters = { ...defaultEntryFilters, time: "all" as const, category: unmatchedCategoryFilter };

  it("lists entries whose category matches no button, never those with a button or no category", () => {
    const kept = ["Retreats", "Youth Rally", "pathfinders ", "Camps"].filter((category) => matchesFilters(entry(category), filters, "2026-11-10", matched));
    expect(kept).toEqual(["Retreats", "Youth Rally"]);
    expect(matchesFilters(entry(""), filters, "2026-11-10", matched)).toBe(false);
    expect(matchesFilters(entry("Office closure"), filters, "2026-11-10", matched)).toBe(false);
  });

  it("asks the database for a category that is not empty and equals no public name, in any case", () => {
    const where = buildEntryWhere(filters, "2026-11-10", [], ["Pathfinders", "Schools"]) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toContainEqual({ category: { not: "" } });
    expect(where.AND).toContainEqual({ NOT: { OR: [
      { category: { equals: "Pathfinders", mode: "insensitive" } },
      { category: { equals: "Schools", mode: "insensitive" } },
    ] } });
  });
});

describe("events with no category (#1611)", () => {
  const { matched } = calendarCategoryChoices(groups);

  it("counts a club-audience event with a blank category as not on a public filter, so staff can categorize it", () => {
    expect(eventOnPublicFilter({ calendarCategory: "", clubEvent: true }, matched)).toBe(false);
    expect(eventOnPublicFilter({ calendarCategory: "  ", clubEvent: true }, matched)).toBe(false);
    expect(eventOnPublicFilter({ calendarCategory: "", clubEvent: false }, matched)).toBe(true);
    expect(eventOnPublicFilter({ calendarCategory: "Pathfinders", clubEvent: true }, matched)).toBe(true);
    expect(eventOnPublicFilter({ calendarCategory: "Retreats" }, matched)).toBe(false);
  });
});

describe("Calendar admin wiring (#1611)", () => {
  const source = readFileSync(resolve(__dirname, "../components/calendar-admin-workspace.tsx"), "utf8");

  it("uses the shared dropdown for every category box and has no free-text list left", () => {
    expect(source).not.toContain("calendar-categories");
    expect(source.match(/<CalendarCategorySelect/g)?.length).toBe(3);
    expect(source).toContain("<option value={unmatchedCategoryFilter}>{notOnPublicFilterLabel}</option>");
  });

  it("takes the embed widget's filter list from the server's read of the tiles", () => {
    expect(source).toContain("filterSlugs={publicFilters.filterSlugs}");
  });
});

describe("Platform settings category refusal beside the field (#1611)", () => {
  it("shows the message next to the tile's categories field, linked with aria-describedby and aria-invalid", () => {
    const editor = readFileSync(resolve(__dirname, "../components/homepage-ministries-editor.tsx"), "utf8");
    expect(editor).toContain("aria-invalid={categoryProblems[tile.position] ? true : undefined}");
    expect(editor).toContain("aria-describedby={categoryProblems[tile.position] ?");
    expect(editor).toContain('id={`ministry-${tile.position}-categories-error`}');
    expect(editor).toContain('{error && <p className="form-error" role="alert">{error}</p>}');
  });
});
