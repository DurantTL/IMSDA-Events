import { describe, expect, it } from "vitest";
import {
  activeAnnouncements,
  activeNotices,
  applyCategoryPreferences,
  changedHubKeys,
  defaultHubContent,
  hubContentSchema,
  isSafeHubHref,
  isShowingOn,
  orderedSections,
  parseHubContent,
  sectionKeys,
  splitVerse,
  type HubContent,
} from "@/modules/site-content/hub-content-domain";

/** #111: the hub content document's rules. Pure, synthetic data only. */

function content(patch: Partial<HubContent> = {}): HubContent {
  return { ...defaultHubContent(), ...patch };
}

describe("links", () => {
  it.each(["/", "/calendar?view=list", "https://imsda.example/page", "/events/camp-2027"])("accepts %s", (href) => {
    expect(isSafeHubHref(href)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<b>x</b>",
    "http://imsda.example",
    "//evil.example/path",
    "/\\evil.example",
    "/path with space",
    "/path\nbreak",
    "/path\u0000nul",
    "",
    "mailto:someone@example.org",
    "https://",
    "calendar",
  ])("rejects %j", (href) => {
    expect(isSafeHubHref(href)).toBe(false);
  });

  it("rejects an unsafe link inside a notice, navigation link or footer link", () => {
    const bad = "javascript:alert(1)";
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), notices: [{ id: "a", level: "INFO", message: "Hi", linkHref: bad, linkLabel: "Go" }] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), navLinks: [{ label: "Go", href: bad }] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), footer: { contactLines: [], links: [{ label: "Go", href: "http://insecure.example" }] } }).success).toBe(false);
  });

  it("needs an address when there is link text", () => {
    const result = hubContentSchema.safeParse({ ...defaultHubContent(), announcements: [{ id: "a", title: "T", body: "B", linkLabel: "Read more" }] });
    expect(result.success).toBe(false);
  });
});

describe("limits", () => {
  const base = defaultHubContent();
  const notice = (index: number) => ({ id: `n${index}`, level: "INFO" as const, message: "Office closed Friday." });

  it("allows 3 notices and refuses a 4th", () => {
    expect(hubContentSchema.safeParse({ ...base, notices: [1, 2, 3].map(notice) }).success).toBe(true);
    expect(hubContentSchema.safeParse({ ...base, notices: [1, 2, 3, 4].map(notice) }).success).toBe(false);
  });

  it("limits message and title lengths", () => {
    expect(hubContentSchema.safeParse({ ...base, notices: [{ ...notice(1), message: "x".repeat(280) }] }).success).toBe(true);
    expect(hubContentSchema.safeParse({ ...base, notices: [{ ...notice(1), message: "x".repeat(281) }] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, announcements: [{ id: "a", title: "x".repeat(81), body: "b" }] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, announcements: [{ id: "a", title: "t", body: "x".repeat(501) }] }).success).toBe(false);
  });

  it("limits announcements, navigation links, footer parts and featured events", () => {
    const announcement = (index: number) => ({ id: `a${index}`, title: "T", body: "B" });
    expect(hubContentSchema.safeParse({ ...base, announcements: [1, 2, 3, 4, 5, 6].map(announcement) }).success).toBe(true);
    expect(hubContentSchema.safeParse({ ...base, announcements: [1, 2, 3, 4, 5, 6, 7].map(announcement) }).success).toBe(false);
    const link = (index: number) => ({ label: `L${index}`, href: "/events" });
    expect(hubContentSchema.safeParse({ ...base, navLinks: [1, 2, 3, 4, 5, 6, 7].map(link) }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, footer: { contactLines: ["a", "b", "c", "d", "e"], links: [] } }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, footer: { verse: "x".repeat(201), contactLines: [], links: [] } }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, featuredEventIds: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, featuredEventIds: ["a", "a"] }).success).toBe(false);
  });

  it("refuses duplicate ids and an end date before the start", () => {
    expect(hubContentSchema.safeParse({ ...base, notices: [notice(1), notice(1)] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, notices: [{ ...notice(1), startsOn: "2026-11-10", endsOn: "2026-11-01" }] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...base, notices: [{ ...notice(1), startsOn: "2026-02-30" }] }).success).toBe(false);
  });

  it("treats blank optional fields as not set", () => {
    const parsed = hubContentSchema.parse({ ...base, notices: [{ ...notice(1), linkHref: "", linkLabel: " ", startsOn: "", endsOn: "" }] });
    expect(parsed.notices[0].linkHref).toBeUndefined();
    expect(parsed.notices[0].linkLabel).toBeUndefined();
    expect(parsed.notices[0].startsOn).toBeUndefined();
  });
});

describe("one entry per line (#111 review)", () => {
  const base = defaultHubContent();
  it("drops blank lines before checking, so a trailing newline saves and blanks do not count toward the limit", () => {
    const parsed = hubContentSchema.parse({ ...base, footer: { contactLines: ["a", "", "b", "c", "d", "  ", ""], links: [] }, calendarCategories: { order: ["Camp", "", " "], hidden: ["Youth", ""] } });
    expect(parsed.footer.contactLines).toEqual(["a", "b", "c", "d"]);
    expect(parsed.calendarCategories).toEqual({ order: ["Camp"], hidden: ["Youth"] });
    expect(hubContentSchema.safeParse({ ...base, footer: { contactLines: ["a", "b", "c", "d", "e"], links: [] } }).success).toBe(false);
  });

  it("says plainly when a category name is too long, and has no blank-name error to show", () => {
    const result = hubContentSchema.safeParse({ ...base, calendarCategories: { order: ["x".repeat(41)], hidden: [] } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("A category can be at most 40 characters.");
  });
});

describe("sections", () => {
  it("needs exactly one entry per key", () => {
    const sections = sectionKeys.map((key) => ({ key, visible: true }));
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), sections }).success).toBe(true);
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), sections: sections.slice(1) }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), sections: [...sections, sections[0]] }).success).toBe(false);
    expect(hubContentSchema.safeParse({ ...defaultHubContent(), sections: [...sections.slice(1), { key: "bogus", visible: true }] }).success).toBe(false);
  });

  it("keeps staff's order and fills in default headings", () => {
    const sections = [...defaultHubContent().sections].reverse().map((section) => (section.key === "featured" ? { ...section, heading: "Don't miss" } : section));
    const ordered = orderedSections({ sections });
    expect(ordered.map((section) => section.key)).toEqual([...sectionKeys].reverse());
    expect(ordered.find((section) => section.key === "featured")?.heading).toBe("Don't miss");
    expect(ordered.find((section) => section.key === "find-your-place")?.heading).toBe("Find your place");
  });
});

describe("the default content", () => {
  it("is today's homepage: standard order and headings, the standard verse, nothing curated", () => {
    const fallback = defaultHubContent();
    expect(fallback.sections.map((section) => section.key)).toEqual(["closing-soon", "featured", "announcements", "season-ribbon", "find-your-place"]);
    expect(orderedSections(fallback).map((section) => section.heading)).toEqual(["Closing soon", "Featured", "Announcements", "Next six months", "Find your place"]);
    expect(fallback.sections.every((section) => section.visible)).toBe(true);
    expect([fallback.notices, fallback.announcements, fallback.navLinks, fallback.featuredEventIds]).toEqual([[], [], [], []]);
    expect(fallback.calendarCategories).toEqual({ order: [], hidden: [] });
    expect(splitVerse(fallback.footer.verse!)).toEqual({ text: "Not forsaking the assembling of ourselves together.", cite: "Hebrews 10:25" });
    expect(hubContentSchema.safeParse(fallback).success).toBe(true);
  });

  it("is what an empty or damaged stored document falls back to", () => {
    expect(parseHubContent({ nope: true, sections: "x" })).toBeNull();
    expect(parseHubContent(null)).toBeNull();
    // A document from before a part existed still reads, with that part empty.
    expect(parseHubContent({ version: 1 })?.notices).toEqual([]);
  });

  it("splits a verse only when it ends in a reference", () => {
    expect(splitVerse("Be still and know.")).toEqual({ text: "Be still and know.", cite: null });
    expect(splitVerse("Rejoice always. 1 Thessalonians 5:16")).toEqual({ text: "Rejoice always.", cite: "1 Thessalonians 5:16" });
  });
});

describe("dates", () => {
  const notice = (id: string, level: "INFO" | "URGENT" | "EMERGENCY", window: { startsOn?: string; endsOn?: string } = {}) => ({ id, level, message: id, ...window });

  it("shows an item through its last day, inclusive, and not before its first day", () => {
    expect(isShowingOn({ startsOn: "2026-11-02", endsOn: "2026-11-04" }, "2026-11-01")).toBe(false);
    expect(isShowingOn({ startsOn: "2026-11-02", endsOn: "2026-11-04" }, "2026-11-02")).toBe(true);
    expect(isShowingOn({ startsOn: "2026-11-02", endsOn: "2026-11-04" }, "2026-11-04")).toBe(true);
    expect(isShowingOn({ startsOn: "2026-11-02", endsOn: "2026-11-04" }, "2026-11-05")).toBe(false);
    expect(isShowingOn({}, "2030-01-01")).toBe(true);
  });

  it("hides expired and future notices and puts the most serious first", () => {
    const shown = activeNotices(content({
      notices: [notice("past", "EMERGENCY", { endsOn: "2026-10-01" }), notice("info", "INFO"), notice("future", "URGENT", { startsOn: "2026-12-01" }), notice("urgent", "URGENT", { startsOn: "2026-10-01", endsOn: "2026-10-31" })],
    }), "2026-10-28");
    expect(shown.map((item) => item.id)).toEqual(["urgent", "info"]);
  });

  it("filters announcements the same way", () => {
    const items = [{ id: "a", title: "A", body: "x", endsOn: "2026-10-27" }, { id: "b", title: "B", body: "x" }];
    expect(activeAnnouncements({ announcements: items }, "2026-10-28").map((item) => item.id)).toEqual(["b"]);
  });
});

describe("category choices", () => {
  const categories = ["Camp", "Retreat", "Youth", "Women"];

  it("leaves the choices alone when nothing is arranged", () => {
    expect(applyCategoryPreferences(categories, { order: [], hidden: [] })).toEqual(categories);
  });

  it("puts ordered ones first, in order, then the rest as they were; names ignore case", () => {
    expect(applyCategoryPreferences(categories, { order: ["women", "Camp"], hidden: [] })).toEqual(["Women", "Camp", "Retreat", "Youth"]);
  });

  it("hides choices but keeps one already chosen in the address", () => {
    expect(applyCategoryPreferences(categories, { order: [], hidden: ["retreat", "Youth"] })).toEqual(["Camp", "Women"]);
    expect(applyCategoryPreferences(categories, { order: [], hidden: ["Youth"] }, "youth")).toEqual(categories);
  });
});

describe("which parts changed", () => {
  it("names the top-level keys that differ, and everything differing from the default when nothing was published", () => {
    const before = defaultHubContent();
    const after = content({ navLinks: [{ label: "Camp", href: "/events" }] });
    expect(changedHubKeys(before, after)).toEqual(["navLinks"]);
    expect(changedHubKeys(null, after)).toEqual(["navLinks"]);
    expect(changedHubKeys(before, before)).toEqual([]);
  });
});
