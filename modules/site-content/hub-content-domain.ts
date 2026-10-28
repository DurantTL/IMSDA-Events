/**
 * The public hub's curated content (#111): one versioned JSON document that staff edit as a draft and publish. Pure, so
 * the admin form, the API, the repository and the public pages all read the same rules. Everything is plain text (React
 * escapes it); links are a path on this site or an https address, never anything a browser would run.
 */

import { z } from "zod";
import { isCalendarDate } from "@/modules/calendar/domain";
import { homeFeaturedLimit } from "@/modules/events/featured-domain";
import { isValidMinistryLink } from "@/modules/system-admin/homepage-ministries-domain";

export const hubContentVersion = 1;

export const noticeLevels = ["INFO", "URGENT", "EMERGENCY"] as const;
export type NoticeLevel = (typeof noticeLevels)[number];
export const noticeLevelLabels: Record<NoticeLevel, string> = { INFO: "Notice", URGENT: "Urgent", EMERGENCY: "Emergency" };

export const sectionKeys = ["closing-soon", "featured", "announcements", "season-ribbon", "find-your-place"] as const;
export type SectionKey = (typeof sectionKeys)[number];

/** The headings the homepage shows when staff set none. */
export const defaultSectionHeadings: Record<SectionKey, string> = {
  "closing-soon": "Closing soon",
  featured: "Featured",
  announcements: "Announcements",
  "season-ribbon": "Next six months",
  "find-your-place": "Find your place",
};

/** What each section is, in plain words, for the editor. */
export const sectionDescriptions: Record<SectionKey, string> = {
  "closing-soon": "The registration closing soon box. It always sits in the top banner, so its position does not change.",
  featured: "Large cards for featured events.",
  announcements: "Short announcements from the list below. Hidden when none are showing.",
  "season-ribbon": "The six-month ribbon (and the three-month list on phones).",
  "find-your-place": "The tiles for each ministry.",
};

export const limits = {
  notices: 3,
  announcements: 6,
  navLinks: 6,
  footerLinks: 6,
  footerContactLines: 4,
  categories: 40,
  noticeMessage: 280,
  announcementTitle: 80,
  announcementBody: 500,
  linkLabel: 40,
  navLabel: 30,
  heading: 60,
  verse: 200,
  contactLine: 120,
  categoryName: 40,
  revisionNote: 200,
  href: 500,
} as const;

/** The verse the footer has always shown; a fresh install, or none published, keeps it. */
export const defaultFooterVerse = "Not forsaking the assembling of ourselves together. Hebrews 10:25";

const controlCharacters = /[\u0000-\u001f\u007f-\u009f]|[\u2028\u2029]/;

/** A link staff may publish: a site path with one leading "/" or an https address; nothing with spaces or control characters. */
export function isSafeHubHref(value: string): boolean {
  if (value.length === 0 || value.length > limits.href) return false;
  if (controlCharacters.test(value)) return false;
  return isValidMinistryLink(value);
}

/** Blank text counts as not set, so a cleared form field is not an error. */
const blankToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const optionalText = (max: number, what: string) =>
  z.preprocess(blankToUndefined, z.string().max(max, `${what} can be at most ${max} characters.`).optional());

const requiredText = (max: number, what: string) =>
  z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1, `${what} is required.`).max(max, `${what} can be at most ${max} characters.`));

const hrefSchema = z.string().trim().refine(isSafeHubHref, "A link must start with / (a page on this site) or https://, with no spaces.");
const optionalHref = z.preprocess(blankToUndefined, hrefSchema.optional());

const dateSchema = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isCalendarDate(value), "Use a real date.");
const optionalDate = z.preprocess(blankToUndefined, dateSchema.optional());

const itemId = z.string().trim().min(1).max(60);

type Windowed = { startsOn?: string; endsOn?: string };

function windowIsOrdered(value: Windowed) {
  return !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn;
}
const windowMessage = { message: "The last day cannot be before the first day.", path: ["endsOn"] };

function linkIsComplete(value: { linkHref?: string; linkLabel?: string }) {
  return !value.linkLabel || Boolean(value.linkHref);
}
const linkMessage = { message: "Add a link address for the link text.", path: ["linkHref"] };

export const noticeSchema = z.object({
  id: itemId,
  level: z.enum(noticeLevels),
  message: requiredText(limits.noticeMessage, "A notice message"),
  linkHref: optionalHref,
  linkLabel: optionalText(limits.linkLabel, "Link text"),
  startsOn: optionalDate,
  endsOn: optionalDate,
}).refine(windowIsOrdered, windowMessage).refine(linkIsComplete, linkMessage);
export type HubNotice = z.infer<typeof noticeSchema>;

export const announcementSchema = z.object({
  id: itemId,
  title: requiredText(limits.announcementTitle, "An announcement title"),
  body: requiredText(limits.announcementBody, "An announcement"),
  linkHref: optionalHref,
  linkLabel: optionalText(limits.linkLabel, "Link text"),
  startsOn: optionalDate,
  endsOn: optionalDate,
}).refine(windowIsOrdered, windowMessage).refine(linkIsComplete, linkMessage);
export type HubAnnouncement = z.infer<typeof announcementSchema>;

export const sectionSchema = z.object({
  key: z.enum(sectionKeys),
  visible: z.boolean(),
  heading: optionalText(limits.heading, "A heading"),
});
export type HubSection = z.infer<typeof sectionSchema>;

export const linkSchema = z.object({
  label: requiredText(limits.navLabel, "Link text"),
  href: hrefSchema,
});
export type HubLink = z.infer<typeof linkSchema>;

const categoryName = z.string().trim().min(1, "A category name cannot be blank.").max(limits.categoryName, `A category can be at most ${limits.categoryName} characters.`);

/** One entry per line in the editor: blank lines (a trailing newline, a gap) are dropped before anything is checked or counted. */
const withoutBlankLines = (value: unknown) => (Array.isArray(value) ? value.filter((line) => !(typeof line === "string" && line.trim() === "")) : value);

const hubContentShape = z.object({
  version: z.literal(hubContentVersion).default(hubContentVersion),
  notices: z.array(noticeSchema).max(limits.notices, `Use at most ${limits.notices} notices.`).default([]),
  announcements: z.array(announcementSchema).max(limits.announcements, `Use at most ${limits.announcements} announcements.`).default([]),
  sections: z.array(sectionSchema).default(() => defaultSections()),
  featuredEventIds: z.array(z.string().trim().min(1).max(100)).max(homeFeaturedLimit, `Feature at most ${homeFeaturedLimit} events.`).default([]),
  navLinks: z.array(linkSchema).max(limits.navLinks, `Use at most ${limits.navLinks} navigation links.`).default([]),
  footer: z.object({
    verse: optionalText(limits.verse, "The verse"),
    contactLines: z.preprocess(withoutBlankLines, z.array(z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().max(limits.contactLine, `A contact line can be at most ${limits.contactLine} characters.`)))
      .max(limits.footerContactLines, `Use at most ${limits.footerContactLines} contact lines.`)).default([]),
    links: z.array(linkSchema).max(limits.footerLinks, `Use at most ${limits.footerLinks} footer links.`).default([]),
  }).default({ contactLines: [], links: [] }),
  calendarCategories: z.object({
    order: z.preprocess(withoutBlankLines, z.array(categoryName).max(limits.categories, `Use at most ${limits.categories} categories.`)).default([]),
    hidden: z.preprocess(withoutBlankLines, z.array(categoryName).max(limits.categories, `Use at most ${limits.categories} categories.`)).default([]),
  }).default({ order: [], hidden: [] }),
});

function hasUnique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export const hubContentSchema = hubContentShape
  .refine((content) => hasUnique(content.notices.map((notice) => notice.id)), { message: "Each notice needs its own id.", path: ["notices"] })
  .refine((content) => hasUnique(content.announcements.map((item) => item.id)), { message: "Each announcement needs its own id.", path: ["announcements"] })
  .refine((content) => hasUnique(content.featuredEventIds), { message: "An event can be featured once.", path: ["featuredEventIds"] })
  .refine(
    (content) => content.sections.length === sectionKeys.length && sectionKeys.every((key) => content.sections.filter((section) => section.key === key).length === 1),
    { message: "Every homepage section must be listed exactly once.", path: ["sections"] },
  );

export type HubContent = z.infer<typeof hubContentSchema>;
export type HubContentInput = z.input<typeof hubContentSchema>;
export type HubTopLevelKey = Exclude<keyof HubContent, "version">;
export const hubTopLevelKeys: readonly HubTopLevelKey[] = ["notices", "announcements", "sections", "featuredEventIds", "navLinks", "footer", "calendarCategories"];

function defaultSections(): HubSection[] {
  return sectionKeys.map((key) => ({ key, visible: true }));
}

/** Today's public output exactly: the current section order and headings, the footer verse, and nothing curated. */
export function defaultHubContent(): HubContent {
  return {
    version: hubContentVersion,
    notices: [],
    announcements: [],
    sections: defaultSections(),
    featuredEventIds: [],
    navLinks: [],
    footer: { verse: defaultFooterVerse, contactLines: [], links: [] },
    calendarCategories: { order: [], hidden: [] },
  };
}

/** Stored content read back: the parsed document, or null when it no longer fits the rules. */
export function parseHubContent(raw: unknown): HubContent | null {
  const parsed = hubContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The first problem in plain words, for a 4xx message. */
export function hubContentProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That content could not be saved.";
  const where = issue.path.filter((part) => typeof part === "string" || typeof part === "number").join(" > ");
  return where ? `${issue.message} (${where})` : issue.message;
}

// ---- Reading the content ----

/** Whether a dated item shows on `today` (a conference-calendar date): from its first day through its last, inclusive. */
export function isShowingOn(item: Windowed, today: string): boolean {
  if (item.startsOn && today < item.startsOn) return false;
  if (item.endsOn && today > item.endsOn) return false;
  return true;
}

const levelRank: Record<NoticeLevel, number> = { EMERGENCY: 0, URGENT: 1, INFO: 2 };

/** The notices showing today, the most serious first (ties keep the order staff set). */
export function activeNotices(content: Pick<HubContent, "notices">, today: string): HubNotice[] {
  return content.notices
    .map((notice, index) => ({ notice, index }))
    .filter(({ notice }) => isShowingOn(notice, today))
    .sort((a, b) => levelRank[a.notice.level] - levelRank[b.notice.level] || a.index - b.index)
    .map(({ notice }) => notice);
}

export function activeAnnouncements(content: Pick<HubContent, "announcements">, today: string): HubAnnouncement[] {
  return content.announcements.filter((item) => isShowingOn(item, today));
}

/** The sections in homepage order, with each one's heading filled in. */
export function orderedSections(content: Pick<HubContent, "sections">): Array<HubSection & { heading: string }> {
  return content.sections.map((section) => ({ ...section, heading: section.heading || defaultSectionHeadings[section.key] }));
}

/** A link's text: the staff-written label, else "Learn more". */
export function linkText(item: { linkLabel?: string }) {
  return item.linkLabel || "Learn more";
}

/** The footer verse split into the sentence and a trailing Bible reference (shown as a citation), when it ends in one. */
export function splitVerse(verse: string): { text: string; cite: string | null } {
  const match = /^(.*?\S)\s+((?:[1-3]\s)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?)$/.exec(verse);
  return match ? { text: match[1], cite: match[2] } : { text: verse, cite: null };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The category choices staff arranged: those in `order` first (in that order), then the rest in their existing order;
 * hidden ones are removed. `keep` (the category already chosen in the address) stays so the form can still show it.
 * Names match without regard to case. Only the choices change: events stay listed.
 */
export function applyCategoryPreferences(categories: readonly string[], prefs: HubContent["calendarCategories"], keep = ""): string[] {
  const isHidden = (name: string) => prefs.hidden.some((hidden) => sameName(hidden, name)) && !(keep && sameName(keep, name));
  const visible = categories.filter((name) => !isHidden(name));
  const rank = (name: string) => {
    const index = prefs.order.findIndex((ordered) => sameName(ordered, name));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return visible
    .map((name, position) => ({ name, position }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.position - b.position)
    .map(({ name }) => name);
}

/** Which top-level parts differ between two documents, for the audit trail. */
export function changedHubKeys(before: HubContent | null, after: HubContent): HubTopLevelKey[] {
  const base = before ?? defaultHubContent();
  return hubTopLevelKeys.filter((key) => JSON.stringify(base[key]) !== JSON.stringify(after[key]));
}
