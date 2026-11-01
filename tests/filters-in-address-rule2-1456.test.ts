import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClub } from "@/modules/club-reports/area-summary-domain";

/**
 * Rule B2 (#1456): filters live in the web address (Back and shared links keep them), and every filtered list has a
 * "Clear filters" control with exactly that wording. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  session: vi.fn(), allowed: vi.fn(), clubs: vi.fn(), events: vi.fn(), newYear: vi.fn(),
  directory: vi.fn(), contacts: vi.fn(), resolveEventContext: vi.fn(), listRegistrations: vi.fn(), isClubAudienceEvent: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => { throw new Error(`redirect:${target}`); },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.allowed }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: mocks.clubs, listAreaClubEvents: mocks.events }));
vi.mock("@/modules/club-rosters/carry-forward", () => ({ listClubsNewYearStatus: mocks.newYear }));
vi.mock("@/modules/organizations/eadventist-import-repository", () => ({ listDirectoryOrganizations: mocks.directory }));
vi.mock("@/modules/organizations/contacts-repository", () => ({ listDirectoryContacts: mocks.contacts }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: mocks.listRegistrations }));
vi.mock("@/modules/events/repository", () => ({ isClubAudienceEvent: mocks.isClubAudienceEvent }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/components/admin-section-header", () => ({ AdminSectionHeaderFor: () => null }));
vi.mock("@/components/use-accessible-dialog", () => ({ useAccessibleDialog: () => ({ current: null }) }));

import AttendeeListingPage from "@/app/(workspace)/people/attendees/page";
import DirectoryPage from "@/app/(workspace)/admin/organizations/directory/page";
import ClubSummaryPage from "@/app/(workspace)/admin/clubs/summary/page";
import { ClubLeadersList } from "@/components/club-leaders-list";
import { addressWith } from "@/components/search-as-you-type";
import { defaultEntryDropdownFilters, parseEntryDropdownFilters } from "@/modules/calendar/admin-list";

const root = path.resolve(__dirname, "..");
function walk(dir: string, found: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (full.endsWith(".tsx")) found.push(full);
  }
  return found;
}
const sources = [...walk(path.join(root, "app")), ...walk(path.join(root, "components"))]
  .map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") }));

describe("filters change the address with push, not replace (rule B2)", () => {
  /**
   * A file that renders a `<select>` filter must not call `router.replace(` itself: a select change has to push so Back
   * steps through filter changes. The shared module (`useListNavigation`) is the one place that calls it, and only for
   * typed text. The two files below use replace for something that is not a list filter.
   */
  const replaceAllowed: Record<string, string> = {
    "components/people-workspace.tsx": "replace closes the registration detail by dropping `?registration=`; its selects are modal forms, not list filters",
    "components/communications-workspace.tsx": "replace switches between the Messages, Templates and Drafts views (`?view=`); that is tab navigation, not a list filter",
  };

  /** Any way a file can write a replace-mode history entry itself: the router, the native API, or the shared helper's replace mode. */
  const replaceCall = /router\.replace\(|history\.replaceState\(|["']replace["']\s*\)/;
  replaceAllowed["components/people-quick-filters.tsx"] = "replace is for the typed search only; its select change calls go(..., \"push\") (asserted below)";

  it("has no replace-mode call in a file that renders a <select>, except the reviewed list and the shared module", () => {
    const offenders = sources
      .filter(({ file, text }) => file !== "components/search-as-you-type.tsx" && /<select\b/.test(text) && replaceCall.test(text))
      .map(({ file }) => file)
      .filter((file) => !(file in replaceAllowed));
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest: each entry still renders a <select> and makes a replace-mode call", () => {
    for (const file of Object.keys(replaceAllowed)) {
      const text = sources.find((source) => source.file === file)?.text ?? "";
      expect(replaceCall.test(text) && /<select\b/.test(text), file).toBe(true);
    }
  });

  it("the quick filters' select change pushes", () => {
    const text = sources.find(({ file }) => file === "components/people-quick-filters.tsx")!.text;
    const change = text.slice(text.indexOf("const change ="), text.indexOf("const formRef"));
    expect(change).toContain('"push")');
    expect(change).not.toContain('"replace")');
  });

  it("the shared hook module is where replace is chosen, for typed text only", () => {
    const shared = sources.find(({ file }) => file === "components/search-as-you-type.tsx")!.text;
    expect(shared).toContain('router.push(href, { scroll: false })');
    expect(shared).toContain('router.replace(href, { scroll: false })');
    expect(shared).toContain('applyNow(addressModeFor(event.target))');
    expect(shared).toContain('useDebouncedCallback(() => applyNow("replace"), delayMs)');
  });
});

describe("every filter clear control says exactly Clear filters (rule B2)", () => {
  /** Buttons that clear a picked selection or a text box, not a list filter, so they keep their own wording. */
  const selectionClears: Record<string, string> = {
    "components/club-earned-awards-workspace.tsx": "unticks the selected members",
    "components/club-honors-workspace.tsx": "unticks the selected members",
    "components/club-uniform-section.tsx": "unticks the selected members",
    "components/club-registration-workspace.tsx": "unticks every person in the registration",
    "components/club-order-workspace.tsx": "unticks the visible rows' checkboxes (select all / clear all)",
    "components/asset-return-panel.tsx": "clears the scanned codes",
    "components/instructor-roster.tsx": "clears one person's attendance mark",
  };
  const oldWording = />\s*(Clear search|Reset filters|Reset search|Reset|Clear filter|Clear)\s*<\/(button|Link|a)>|<\/(?:svg|span)>\s*(Clear|Reset)\s*<\/(?:button|Link|a)>|(?:label|text): "(?:Clear search|Reset filters|Reset|Clear)"/;

  it("no list clear control uses Clear search, Reset filters, Reset or a bare Clear", () => {
    const offenders = sources
      .filter(({ file, text }) => oldWording.test(text) && !(file in selectionClears))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest: each entry still matches the old wording it excuses", () => {
    for (const file of Object.keys(selectionClears)) {
      const text = sources.find((source) => source.file === file)?.text ?? "";
      expect(oldWording.test(text), file).toBe(true);
    }
  });
});

const FILTER_PARAMS = ["q", "kind", "status", "statuses", "attention", "role", "club", "meal", "dietary", "filter", "compliance", "page", "category", "source", "state", "time", "entryType"];
/** The `Clear filters` links of a page, as [href, filter params still in it]. */
function clearLinks(html: string) {
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(?:(?!<\/a>)[\s\S])*?Clear filters(?:<span\b[^>]*><\/span>)?<\/a>/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
  return links.map((href) => {
    const params = new URL(href, "https://example.test").searchParams;
    return { href, filters: FILTER_PARAMS.filter((name) => params.has(name)) };
  });
}

describe("a list loaded with ?q=zzzz shows Clear filters with an address that has no filter params", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "synthetic-admin", globalRole: "SYSTEM_ADMIN" } });
    mocks.allowed.mockResolvedValue(true);
  });

  it("organization directory (also with only the kind filter set)", async () => {
    mocks.directory.mockResolvedValue({ organizations: [], total: 0, page: 1, pageSize: 25 });
    mocks.contacts.mockResolvedValue(new Map());
    const html = renderToStaticMarkup(await DirectoryPage({ searchParams: Promise.resolve({ q: "zzzz" }) }));
    const links = clearLinks(html);
    expect(links.length).toBeGreaterThanOrEqual(2); // the filter bar's, and the nothing-matches state's
    for (const link of links) expect(link).toEqual({ href: "/admin/organizations/directory", filters: [] });
    const kindOnly = renderToStaticMarkup(await DirectoryPage({ searchParams: Promise.resolve({ kind: "CHURCH" }) }));
    expect(clearLinks(kindOnly)[0]).toEqual({ href: "/admin/organizations/directory", filters: [] });
    const none = renderToStaticMarkup(await DirectoryPage({ searchParams: Promise.resolve({}) }));
    expect(clearLinks(none)).toEqual([]);
  });

  it("attendees (keeps the event, drops every filter)", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt-1", name: "Synthetic Event" }, permissions: ["VIEW_SENSITIVE_DATA"] });
    mocks.listRegistrations.mockResolvedValue([]);
    mocks.isClubAudienceEvent.mockResolvedValue(false);
    const html = renderToStaticMarkup(await AttendeeListingPage({ searchParams: Promise.resolve({ event: "evt-1", q: "zzzz" }) }));
    const links = clearLinks(html);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toEqual({ href: "/people/attendees?event=evt-1", filters: [] });
  });

  it("club leaders", () => {
    const html = renderToStaticMarkup(createElement(ClubLeadersList, { leaders: [], clubs: [{ id: "club-1", name: "Synthetic Club" }], filters: { clubId: "club-1", role: "DIRECTOR" }, canOpenPeople: false }));
    expect(clearLinks(html)).toEqual([{ href: "/admin/clubs/leaders", filters: [] }]);
    const bare = renderToStaticMarkup(createElement(ClubLeadersList, { leaders: [], clubs: [], filters: { clubId: null, role: null }, canOpenPeople: false }));
    expect(clearLinks(bare)).toEqual([]);
  });

  it("club summary: the directory and the monthly records view", async () => {
    const now = new Date("2026-10-26T18:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      const clubYear = "2026-27";
      const club = summarizeClub({ id: "club-1", name: "Synthetic Club", church: "Cedar Church", directors: [], rosterSize: 3, registrationOnTime: false, reports: [], backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 } }, clubYear, now);
      mocks.clubs.mockResolvedValue([club]);
      mocks.events.mockResolvedValue([]);
      mocks.newYear.mockResolvedValue(null);
      for (const view of [undefined, "records"]) {
        const html = renderToStaticMarkup(await ClubSummaryPage({ searchParams: Promise.resolve({ year: clubYear, q: "zzzz", ...(view ? { view } : {}) }) }));
        const links = clearLinks(html);
        expect(links.length, String(view)).toBeGreaterThan(0);
        for (const link of links) expect(link.filters, link.href).toEqual([]);
        expect(html).not.toContain("Clear search");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the address helpers behind client-filtered lists", () => {
  const at = (search: string) => ({ pathname: "/account/clubs/c1/roster", search, hash: "" });

  it("sets and removes params, keeps the rest (?year=), and returns null when nothing changes", () => {
    expect(addressWith(at("?year=2026-27"), { q: "ann" })).toBe("/account/clubs/c1/roster?year=2026-27&q=ann");
    expect(addressWith(at("?year=2026-27&q=ann&filter=details-needed"), { q: null, filter: "" })).toBe("/account/clubs/c1/roster?year=2026-27");
    expect(addressWith(at("?year=2026-27&q=ann"), { q: null, filter: null, compliance: null })).toBe("/account/clubs/c1/roster?year=2026-27");
    expect(addressWith(at("?q=ann"), { q: "ann" })).toBeNull();
    expect(addressWith(at(""), { q: "" })).toBeNull();
    expect(addressWith({ ...at("?q=a"), hash: "#roster" }, { q: null })).toBe("/account/clubs/c1/roster#roster");
  });

  it("reads the calendar's select filters from an address; unknown values are the defaults", () => {
    expect(parseEntryDropdownFilters(new URLSearchParams())).toEqual(defaultEntryDropdownFilters);
    expect(parseEntryDropdownFilters(new URLSearchParams("category=Camp&state=draft&time=past&entryType=DEADLINE&source=feed-1")))
      .toEqual({ category: "Camp", source: "feed-1", state: "draft", time: "past", entryType: "DEADLINE" });
    expect(parseEntryDropdownFilters(new URLSearchParams("state=bogus&time=never&entryType=NOPE"))).toEqual(defaultEntryDropdownFilters);
  });
});
