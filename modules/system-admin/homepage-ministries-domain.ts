/**
 * The six "Find your place" tiles on the public homepage (#1251): their shape, validation and links. Pure, so the
 * Platform settings form, the API and the homepage all read the same rules. Storage is in `homepage-ministries.ts`.
 */

import { z } from "zod";

/** The fixed set of icons a tile can show; the homepage maps each name to a lucide icon. */
export const homepageMinistryIcons = [
  "Compass", "Backpack", "Flower2", "Wrench", "Tent", "Sparkles", "Heart", "BookOpen", "Music", "Mountain", "Star", "Users", "Sun", "Flame", "Trees", "Church",
] as const;
export type HomepageMinistryIcon = (typeof homepageMinistryIcons)[number];

export const homepageMinistryCount = 6;
export const homepageMinistryDescriptionMax = 200;
export const defaultMinistryLink = "/calendar?view=list";

export type HomepageMinistry = {
  position: number;
  name: string;
  description: string | null;
  linkHref: string | null;
  categories: string[];
  icon: HomepageMinistryIcon;
};

/** The names the homepage falls back to when the table is empty or unreadable: no categories, so no upcoming line. */
export const fallbackHomepageMinistries: HomepageMinistry[] = [
  ["Pathfinders", "Compass"], ["Adventurers", "Backpack"], ["Women's Ministries", "Flower2"], ["Men's Ministries", "Wrench"], ["Camp Meeting", "Tent"], ["Youth", "Sparkles"],
].map(([name, icon], index) => ({ position: index + 1, name, description: null, linkHref: null, categories: [], icon: icon as HomepageMinistryIcon }));

/** A link a tile may use: a site path starting with one "/" (never "//", which is another site), or an https URL. */
export function isValidMinistryLink(value: string): boolean {
  if (/[\s\\]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The calendar filtered to one category, in the one format the calendar reads. */
export function calendarCategoryHref(category: string) {
  return `/calendar?view=list&category=${encodeURIComponent(category)}`;
}

/** A tile's link: its own link if staff set one, else the calendar filtered to its first category, else the whole calendar. */
export function ministryLinkHref(ministry: Pick<HomepageMinistry, "linkHref" | "categories">): string {
  const own = ministry.linkHref?.trim();
  if (own && isValidMinistryLink(own)) return own;
  const first = ministry.categories.map((category) => category.trim()).find(Boolean);
  return first ? calendarCategoryHref(first) : defaultMinistryLink;
}

const blankToNull = (value: unknown) => (typeof value === "string" ? value.trim() : value);

export const homepageMinistryInputSchema = z.object({
  position: z.number().int().min(1).max(homepageMinistryCount),
  name: z.preprocess(blankToNull, z.string().min(1, "Every tile needs a name.").max(60, "A tile name can be at most 60 characters.")),
  description: z.preprocess(
    blankToNull,
    z.union([
      z.literal(""),
      z.string().max(homepageMinistryDescriptionMax, `A description can be at most ${homepageMinistryDescriptionMax} characters.`)
        .refine((value) => !/[\r\n<>]/.test(value), "Use plain text on one line, with no tags."),
    ]),
  ).nullable().optional().transform((value) => (value ? value : null)),
  linkHref: z.preprocess(
    blankToNull,
    z.union([z.literal(""), z.string().max(500).refine(isValidMinistryLink, "A link must start with / (a page on this site) or https://.")]),
  ).nullable().optional().transform((value) => (value ? value : null)),
  categories: z.array(z.string().trim().min(1).max(60)).max(10, "Use at most 10 categories.").default([])
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((category) => {
        const key = category.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
  icon: z.enum(homepageMinistryIcons),
}).strict();

export const homepageMinistriesInputSchema = z.object({
  ministries: z.array(homepageMinistryInputSchema).length(homepageMinistryCount, `Send all ${homepageMinistryCount} tiles.`),
}).strict().refine(
  (value) => new Set(value.ministries.map((tile) => tile.position)).size === homepageMinistryCount,
  "Each tile needs its own position.",
);

export type HomepageMinistriesInput = z.infer<typeof homepageMinistriesInputSchema>;

/** The icon of a stored value, or the default when the stored name is not one the page knows. */
export function ministryIconOrDefault(value: string): HomepageMinistryIcon {
  return (homepageMinistryIcons as readonly string[]).includes(value) ? (value as HomepageMinistryIcon) : "Users";
}
