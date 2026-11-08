import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventPermissions, kitchenCountsPath, rolePermissions } from "@/modules/access/permissions";
import type { AdminRole } from "@/modules/access/admin-roles-domain";

const state = vi.hoisted(() => ({ path: "/admin", query: "event=synthetic_event" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => h("button", {}, "Sign out") }));
import { AppShell } from "@/components/app-shell";
import { StaffCreateMenu } from "@/components/staff-create-menu";
import { buildAdminSectionNav } from "@/components/admin-section-nav";
import { staffPlaceFor } from "@/components/staff-areas";
import { eventSwitchHref } from "@/components/shell-event-selection";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const held: AdminRole[] = ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"];

function shell(path: string, options: { active?: AdminRole; withEvents?: boolean; permissions?: readonly string[]; admin?: boolean; query?: string; roles?: AdminRole[] } = {}) {
  const { active = "SYSTEM_ADMIN", withEvents = true, permissions = eventPermissions, admin = true, query = "event=synthetic_event" } = options;
  state.path = path;
  state.query = query;
  return renderToStaticMarkup(h(AppShell, {
    children: h("p", {}, "Synthetic content"),
    events: withEvents ? [{ id: "synthetic_event", slug: "synthetic-event", name: "Synthetic Event", permissions: permissions as never }] : [],
    user: { id: "synthetic_admin", displayName: "Synthetic Admin", email: "synthetic@imsda-events.test", globalRole: admin ? "SYSTEM_ADMIN" : null },
    adminRoleView: options.roles ? { held: options.roles, active: options.roles.at(-1)!, counts: {} } : admin ? { held, active, counts: {} } : null,
  }));
}
const slice = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const rail = (html: string) => slice(html, 'id="primary-navigation"', "</nav>");
const row = (html: string) => slice(html, 'data-staff-tabs="true"', "</nav>");
const pageMarks = (html: string) => (html.match(/aria-current="page"/g) ?? []).length;

describe("canonical staff workspace navigation (#1565)", () => {
  it("lets the route own the area, whichever admin role was chosen last", () => {
    expect(staffPlaceFor("/admin/settings")).toMatchObject({ area: "admin", tab: "hub-catalogs" });
    expect(staffPlaceFor("/admin/honors")).toMatchObject({ area: "admin", tab: "hub-catalogs" });
    expect(staffPlaceFor("/admin/clubs/leaders")).toMatchObject({ area: "clubs", tab: "leaders" });
    expect(staffPlaceFor("/people")).toMatchObject({ area: "events", inEvent: true });
    // The chosen role only decides where Home opens, never which area a page is in.
    const system = shell("/admin", { active: "EVENTS_ADMIN" });
    expect(rail(system)).toMatch(/aria-current="true"[^>]*href="\/admin\?event=synthetic_event"[\s\S]*?<span>Admin<\/span>/);
    expect(row(system)).toContain('aria-current="page" href="/admin?event=synthetic_event">System administration');
  });

  it("keeps Clubs and System usable without an event or event tabs", () => {
    for (const [path, role] of [["/admin/clubs", "CLUBS_ADMIN"], ["/admin", "SYSTEM_ADMIN"]] as const) {
      const html = shell(path, { active: role, withEvents: false });
      expect(html).not.toContain('id="event-picker"');
      expect(row(html)).not.toContain("/finance");
      expect(row(html)).not.toContain("/overview");
      // One rail area and one tab are marked; only the tab says "page".
      expect(rail(html).match(/aria-current="true"/g)).toHaveLength(1);
      const chrome = html.slice(html.indexOf('data-staff-tabs="true"'), html.indexOf("<header", html.indexOf('data-staff-tabs="true"')));
      expect(pageMarks(chrome)).toBe(1);
    }
  });

  it("separates the portfolio from the selected event: one marks Event administration, the other the event's tabs", () => {
    const portfolio = shell("/events-admin", { active: "EVENTS_ADMIN" });
    expect(pageMarks(row(portfolio))).toBe(1);
    expect(row(portfolio)).toContain("Event administration");
    expect(portfolio).not.toContain('id="event-picker"');
    expect(portfolio).toContain("Event administration");
    const event = shell("/overview", { active: "EVENTS_ADMIN" });
    expect(pageMarks(row(event))).toBe(1);
    expect(event).toContain('id="event-picker"');
    expect(row(event)).toContain('href="/people?event=synthetic_event"');
    expect(event).toContain("‹ Events");
  });

  it("gives every page one current tab, and exactly one 'page' mark across rail, tabs and views", () => {
    for (const path of ["/overview", "/finance", "/more/promo-codes", "/check-in/badges", "/people/attendees", "/more/reports/packets"]) {
      const html = shell(path);
      expect(rail(html).match(/aria-current="true"/g), path).toHaveLength(1);
      const chrome = html.slice(html.indexOf('data-staff-tabs="true"'), html.indexOf("<header", html.indexOf('data-staff-tabs="true"')));
      expect(pageMarks(chrome), path).toBe(1);
    }
  });

  it("does not offer unauthorized creation destinations", () => {
    expect(renderToStaticMarkup(h(StaffCreateMenu, { isSystemAdmin: false, clubFormsAccess: false, canManageForms: false, eventId: "" }))).toBe("");
    const forms = renderToStaticMarkup(h(StaffCreateMenu, { isSystemAdmin: false, clubFormsAccess: false, canManageForms: true, eventId: "synthetic_event" }));
    expect(forms).toContain('aria-haspopup="dialog"');
    expect(forms).not.toContain("/event-setup");
  });

  it("limits the section header to this page's views or anchors: the area's row is the shell's, not the page's (#1565)", () => {
    expect(buildAdminSectionNav({ section: "system", pathname: "/admin/people" }).localTabs).toEqual([]);
    const home = buildAdminSectionNav({ section: "system", pathname: "/admin" });
    expect(home.localTabs?.every((tab) => tab.href.startsWith("#"))).toBe(true);
    const header = read("components/admin-section-header.tsx");
    expect(header).not.toContain("nav.tabs");
  });
});

describe("aria-current (#1565)", () => {
  it("marks one link 'page' in the whole document, and only the one that opens exactly this page", () => {
    for (const path of ["/people", "/help", "/admin/clubs", "/admin/feature-requests", "/admin/clubs/invites", "/more/promo-codes", "/admin/clubs/summary"]) {
      for (const role of ["SYSTEM_ADMIN", "CLUBS_ADMIN"] as const) {
        const html = shell(path, { active: role });
        expect(pageMarks(html), `${path} ${role}`).toBeLessThanOrEqual(1);
        for (const mark of html.matchAll(/<a [^>]*aria-current="page"[^>]*href="([^"?#]*)/g)) expect(mark[1], path).toBe(path);
      }
    }
    // On a page whose tab row or view strip says "page", the phone bar only says "true" (390px shows the bar, 1280px the row).
    const clubs = shell("/admin/clubs", { active: "CLUBS_ADMIN" });
    expect(pageMarks(clubs.slice(clubs.indexOf('<nav class="mobile-nav"')))).toBe(0);
    expect(pageMarks(clubs.slice(0, clubs.indexOf('<nav class="mobile-nav"')))).toBe(1);
    // The tab links elsewhere than the page (Events opens its hub, a card there opens the requests page): "true", not "page".
    const requests = shell("/admin/feature-requests");
    expect(row(requests)).toContain('aria-current="true" href="/admin/hubs/events?event=synthetic_event">Events');
  });
});

describe("the phone bar's where-you-are (#1565)", () => {
  const phone = (html: string) => html.slice(html.indexOf('<nav class="mobile-nav"'));
  const lit = (html: string) => [...phone(html).matchAll(/<a class="active"[^>]*>.*?<span>([^<]+)<\/span>/g)].map((match) => match[1]);
  const events = { roles: ["EVENTS_ADMIN"] as AdminRole[], admin: false };

  it("keeps Events its own slot for an Events Administrator, lit on event pages and Events pages, never Home", () => {
    for (const path of ["/overview", "/finance", "/archived-events", "/events-admin"]) {
      const html = shell(path, events);
      // Home opens /home (#1568), its own page, so Home and Events never share a link: one bar link per page.
      expect([...phone(html).matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]), path).toContain("Home");
      const hrefs = [...phone(html).matchAll(/<a [^>]*href="([^"?]+)/g)].map((match) => match[1]);
      expect(hrefs.filter((href) => href === "/events-admin"), path).toHaveLength(1);
      expect(lit(html), path).toEqual(["Events"]);
    }
  });

  it("lights Home on its own pages, and keeps one item per page for a Clubs Administrator", () => {
    for (const path of ["/home", "/home/coming-up"]) expect(lit(shell(path, events)), path).toEqual(["Home"]);
    const html = shell("/admin/clubs", { roles: ["CLUBS_ADMIN"], admin: false, withEvents: false });
    const hrefs = [...phone(html).matchAll(/<a [^>]*href="([^"?]+)/g)].map((match) => match[1]);
    expect(hrefs.filter((href) => href === "/admin/clubs")).toHaveLength(1);
    expect([...phone(html).matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1])).toContain("Clubs");
    expect(lit(html)).toEqual(["Clubs"]);
  });
});

describe("tab rows and the menu line (#1565)", () => {
  it("renders the tabs and the menu line together, so the stylesheet alone decides which shows without a layout shift", () => {
    const html = shell("/admin/clubs", { active: "CLUBS_ADMIN" });
    expect(html).toContain('data-staff-tabs="true" data-fit="ok"');
    expect(html).toContain('data-staff-menu-line="true"');
    expect(html).toContain('aria-label="Clubs menu, now on Club administration"');
    expect(html).toContain("Clubs menu");
    const inEvent = shell("/finance");
    expect(inEvent).toContain("Event menu");
    expect(inEvent).toContain('aria-label="Event menu, now on Money"');
  });

  it("names the menu line's button for each area", () => {
    const names: Array<[string, string]> = [["/admin/clubs", "Clubs menu"], ["/admin", "Admin menu"], ["/events-admin", "Events menu"], ["/admin/people", "People menu"], ["/admin/analytics", "Reports menu"]];
    for (const [path, name] of names) expect(shell(path), path).toContain(`${name}, now on`.replace(", now on", ""));
  });

  it("never scrolls a tab row sideways or cuts it off: below 1024px, or when it does not fit, it is the menu line", () => {
    const css = read("components/staff-shell.module.css");
    const tabsRule = css.match(/\.tabs \{[^}]*\}/)?.[0] ?? "";
    expect(tabsRule).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(css).toMatch(/@media \(max-width: 1023\.98px\) \{\s*\.tabs \{ display: none; \}\s*\.menuline \{ display: flex; \}/);
    expect(css).toMatch(/\.tabline\[data-fit="tight"\] \.tabs \{[^}]*visibility: hidden/);
    expect(css).toMatch(/\.tabline\[data-fit="tight"\] \.menuline \{ display: flex; \}/);
    expect(css).toMatch(/\.current \{[^}]*border-bottom: 4px solid var\(--imsda-gold\)/);
    expect(read("components/staff-tab-row.tsx")).toContain("new ResizeObserver(measure)");
  });

  it("marks where you are with the gold edge, the 4px underline and the phone bar's 4px top bar", () => {
    const css = read("components/staff-shell.module.css");
    expect(css).toMatch(/\.railItem\[aria-current\] \{[^}]*inset 3px 0 var\(--imsda-gold\)/);
    expect(css).toMatch(/\.tabs a\[aria-current\] \{ border-bottom-color: var\(--imsda-gold\)/);
    expect(css).toMatch(/\.item\[aria-current\] \{[^}]*inset 4px 0 var\(--imsda-gold\)/);
    expect(css).not.toContain("var(--imsda-purple)); }");
    const globals = read("app/globals.css");
    expect(globals).toMatch(/\.mobile-nav a\.active::before \{[^}]*height: 4px;[^}]*var\(--imsda-gold\)/);
  });

  it("keeps the account button at 44px and the shell's count text at 14px without touching the global badge", () => {
    expect(read("components/staff-account-menu.module.css")).toMatch(/button\.trigger \{ width: 44px; height: 44px; \}/);
    expect(read("components/staff-shell.module.css")).toMatch(/\.countText \{ font-size: max\(var\(--type-staff-floor, 0px\), 0\.875rem\)/);
    expect(read("components/staff-tab-row.tsx")).toContain("count-badge ${styles.countText}");
    expect(read("components/staff-menu-dialog.tsx")).toContain("count-badge ${styles.countText}");
    expect(read("components/staff-rail.tsx")).not.toContain("badges");
  });

  it("keeps the rail at 88px with navy gradient and 44px or larger targets", () => {
    const css = read("components/staff-shell.module.css");
    expect(css).toMatch(/\.rail \{[^}]*width: 88px;[^}]*linear-gradient\(180deg, var\(--imsda-navy\) 0%, var\(--imsda-navy-deep\) 100%\)/);
    expect(css).toMatch(/\.railItem \{[^}]*min-height: 64px/);
    expect(css).toMatch(/\.tabs a \{[^}]*min-height: 48px/);
    expect(css).toMatch(/\.views a \{[^}]*min-height: 44px/);
  });
});

describe("the kitchen-only view (#1029, #1565)", () => {
  it("shows kitchen staff only the kitchen counts: one tab, no empty tab, no event home", () => {
    const html = shell(kitchenCountsPath, { admin: false, permissions: rolePermissions.KITCHEN_STAFF });
    expect(row(html).match(/<li>/g)).toHaveLength(1);
    expect(row(html)).toContain(`href="${kitchenCountsPath}?event=synthetic_event"`);
    expect(row(html)).not.toContain("/overview");
    expect(row(html)).not.toContain("/people");
    expect(html.slice(html.indexOf('aria-label="Mobile navigation"')).match(/<span>[^<]+<\/span>/g)).toEqual(["<span>Home</span>", "<span>Events</span>"]);
  });
});

describe("switching event keeps the current page (#616)", () => {
  it("builds the switch link on the same path, dropping only the old event's own filters", () => {
    expect(eventSwitchHref("/finance", "event=a&filter=BALANCE&q=smith", "b")).toBe("/finance?event=b&filter=BALANCE");
    expect(eventSwitchHref("/more/promo-codes", "event=a", "b")).toBe("/more/promo-codes?event=b");
  });
});
