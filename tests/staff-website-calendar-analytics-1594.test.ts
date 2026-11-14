import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/site-content",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { SiteContentWorkspace } from "@/components/site-content-workspace";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";

// #1594: presentation of the site content, calendar and analytics admin pages. Synthetic data only.
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe("the site content editor (#1594)", () => {
  const html = renderToStaticMarkup(createElement(SiteContentWorkspace, { initialContent: defaultHubContent(), draft: null, published: null, draftDiffers: false, history: [], events: [] }));

  it("has its header drawn once by the page, and the shell skips its title", () => {
    expect(count(html, /<h1\b/g)).toBe(0);
    const page = read("app/(workspace)/admin/site-content/page.tsx");
    expect(count(page, /<PageHeader\b/g)).toBe(1);
    expect(page).toContain('title="Homepage & site content"');
    expect(page).toContain('user.globalRole === "SYSTEM_ADMIN" ? <AdminSectionHeaderFor');
    expect(page).toContain("canManageSiteContent(user)");
    for (const route of ["/admin/site-content", "/admin/calendar", "/admin/analytics"]) expect(pageOwnsHeader(route), route).toBe(true);
  });

  it("keeps Publish the only filled button, with Save draft, Preview and Discard outlined", () => {
    expect(count(html, /\bprimary-button\b/g)).toBe(1);
    expect(html).toMatch(/class="primary-button"[^>]*>(?:(?!<\/button>)[\s\S])*Publish/);
    expect(html).toMatch(/class="secondary-button"[^>]*>(?:(?!<\/button>)[\s\S])*Save draft/);
    expect(html).toMatch(/class="secondary-button"[^>]*>(?:(?!<\/button>)[\s\S])*Discard draft/);
    expect(html).toContain("Preview<span class=\"sr-only\"> (opens in a new tab)</span>");
  });

  it("says what it changes on the public site and where it stands", () => {
    expect(html).toContain("What this changes on the public site:");
    expect(html).toContain("Nothing published yet");
    expect(html).toContain("No unpublished changes");
    expect(html).toContain("Preview is available once there is a saved draft.");
  });

  it("offers an add button in the empty notice and announcement lists, and no second one", () => {
    expect(html).toContain("No notices");
    expect(html).toContain("No announcements");
    expect(html).toContain("Add a notice");
    expect(html).toContain("Add an announcement");
    expect(count(html, /Add a notice/g)).toBe(1);
    expect(count(html, /Add an announcement/g)).toBe(1);
  });

  it("keeps the draft, publish and restore requests the same", () => {
    const source = read("components/site-content-workspace.tsx");
    for (const call of ['"/api/admin/site-content/draft", "PUT"', '"/api/admin/site-content/publish", "POST"', '"/api/admin/site-content/draft", "DELETE"', "/api/admin/site-content/restore/"]) expect(source).toContain(call);
  });
});

describe("the preview page (#1594)", () => {
  it("says it is not published and has a Back to the editor link to the editor", () => {
    const source = read("app/(workspace)/admin/site-content/preview/page.tsx");
    expect(source).toContain("Preview: not published. Visitors do not see this yet.");
    expect(source).toContain('<Link href="/admin/site-content">Back to the editor</Link>');
    expect(source).toContain('redirect("/no-access?from=site-content")');
  });
});

describe("the calendar admin (#1594)", () => {
  const html = renderToStaticMarkup(createElement(CalendarAdminWorkspace, { initialEntries: [], initialEvents: [] }));

  it("has its header drawn once by the page, with the public calendar link outlined", () => {
    expect(count(html, /<h1\b/g)).toBe(0);
    const page = read("app/(workspace)/admin/calendar/page.tsx");
    expect(count(page, /<PageHeader\b/g)).toBe(1);
    expect(page).toContain('title="Conference calendar"');
    expect(page).toMatch(/secondary=\{\(\s*<a className="secondary-button" href="\/calendar"/);
    expect(page).not.toContain("primary=");
    expect(page).toContain('user.globalRole !== "SYSTEM_ADMIN"');
  });

  it("says what it changes and keeps calendar entries apart from registration events", () => {
    expect(html).toContain("What this changes on the public calendar");
    expect(html).toContain("Calendar entries are not registration events.");
  });

  it("offers a next step when there are no entries, and keeps Add to calendar the one filled button", () => {
    expect(html).toContain("No entries yet");
    expect(html).toContain('href="#calendar-new-entry"');
    expect(html).toContain('id="calendar-new-entry"');
    expect(count(html.slice(html.indexOf('id="calendar-new-entry"')), /\bprimary-button\b/g)).toBe(1);
  });

  it("keeps Add registration and the link actions on every entry row", () => {
    expect(read("components/calendar-admin-workspace.tsx")).toContain("<CalendarEntryRegistration entry={entry} events={events}");
    expect(read("components/calendar-entry-registration.tsx")).toContain("Add registration");
  });
});

describe("the analytics page (#1594)", () => {
  it("draws its own header and keeps the privacy wording", () => {
    const source = read("app/(workspace)/admin/analytics/page.tsx");
    expect(source).toContain('title="Public analytics"');
    expect(source).toContain("Nothing here identifies a person, a device or a private event.");
    expect(source).toContain("each shown only once it reaches {minimumShownCount} uses");
    expect(source).toContain("Visitors who send a Global Privacy Control or Do Not Track signal are not counted");
    expect(source).toContain('user.globalRole !== "SYSTEM_ADMIN"');
    expect(source).not.toContain("style={{");
  });

  it("offers three periods and one event funnel table (#1560)", () => {
    const source = read("app/(workspace)/admin/analytics/page.tsx");
    expect(source).toContain("parseAnalyticsPeriod(search.days)");
    expect(source).toContain("Last 12 months");
    expect(source).toContain("Which event pages lead to registrations");
    expect(source).toContain("a rate can pass 100%");
  });
});
