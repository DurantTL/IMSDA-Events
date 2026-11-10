import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventPermissions } from "@/modules/access/permissions";
import type { AdminRole } from "@/modules/access/admin-roles-domain";

const state = vi.hoisted(() => ({ path: "/admin", query: "event=synthetic_event" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => h("button", {}, "Sign out") }));
import { AppShell } from "@/components/app-shell";
import { StaffAccountMenu } from "@/components/staff-account-menu";
import { opensKeyboard } from "@/components/staff-keyboard-model";
import { staffPlaceFor } from "@/components/staff-areas";
import { currentEventPlace } from "@/components/staff-event-tabs";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const held: AdminRole[] = ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"];

function shell(path: string, options: { query?: string; admin?: boolean; roles?: AdminRole[]; permissions?: readonly string[] } = {}) {
  const { query = "event=synthetic_event", admin = true, permissions = eventPermissions } = options;
  state.path = path;
  state.query = query;
  return renderToStaticMarkup(h(AppShell, {
    children: h("p", {}, "Synthetic content"),
    events: [{ id: "synthetic_event", slug: "synthetic-event", name: "Synthetic Event", permissions: permissions as never }],
    user: { id: "synthetic_admin", displayName: "Synthetic Admin", email: "synthetic@imsda-events.test", globalRole: admin ? "SYSTEM_ADMIN" : null },
    adminRoleView: options.roles ? { held: options.roles, active: options.roles.at(-1)!, counts: {} } : admin ? { held, active: "SYSTEM_ADMIN", counts: {} } : null,
  }));
}
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const rail = (html: string) => between(html, 'id="primary-navigation"', "</nav>");
const row = (html: string) => between(html, 'data-staff-tabs', "</nav>");
const phone = (html: string) => html.slice(html.indexOf('<nav class="mobile-nav"'));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));

// The focus behavior of the sheets (title, Close, focus in, Tab, Escape, return) is tested in tests/staff-phone-focus-1566.test.ts.
describe("sheets and dialogs (#1566)", () => {
  it("fits the menu-line dialog, the More sheet and the account menu to the height with an inner scroll and Close outside it", () => {
    const css = read("components/staff-shell.module.css");
    expect(css).toMatch(/\.dialog \{[^}]*max-height: min\(78vh, calc\(100dvh - 24px\)\)/);
    expect(css).toMatch(/\.dialogBody \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.dialogHead \{[^}]*flex: none/);
    const globals = read("app/globals.css");
    expect(globals).toMatch(/\.more-launcher-head \{[^}]*position: sticky/);
    expect(globals).toMatch(/max-height: min\(72dvh, calc\(100dvh - 120px/);
    expect(globals).toMatch(/\.more-launcher \{[^}]*overflow-y: auto/);
    expect(read("components/staff-account-menu.module.css")).toMatch(/div\.popover \{[^}]*max-height: calc\(100dvh - 96px\)[^}]*overflow-y: auto/);
  });

  it("renders the account menu open with a title, Close and the switcher", () => {
    const html = renderToStaticMarkup(h(StaffAccountMenu, {
      attendeePreviewHref: "/account", defaultOpen: true, displayName: "Synthetic Admin", email: "synthetic@imsda-events.test",
      workspaces: [{ kind: "system_admin", label: "System management", href: "/admin", method: "get" }, { kind: "staff", label: "Staff workspace", href: "/overview", method: "get", current: true }] as never,
    }));
    const id = html.match(/aria-labelledby="([^"]+)"/)![1];
    expect(html).toContain(`<h2 id="${id}">Your account</h2>`);
    expect(html).toContain("<span>Close</span>");
    expect(html).toContain("Switch workspace");
  });
});

describe("device conditions (#1566)", () => {
  it("runs edge to edge so safe-area insets are real, and the bottom bar pads by them", () => {
    expect(read("app/layout.tsx")).toMatch(/export const viewport: Viewport = \{[^}]*viewportFit: "cover"/);
    const css = read("app/globals.css");
    expect(css).toMatch(/\n\.?body \{ padding-left: env\(safe-area-inset-left, 0px\); padding-right: env\(safe-area-inset-right, 0px\)/);
    expect(css).toMatch(/\.mobile-nav \{[^}]*min-height: calc\(67px \+ env\(safe-area-inset-bottom, 0px\)\)[^}]*env\(safe-area-inset-left, 0px\)/);
    expect(css).toMatch(/\.more-launcher-tab \{\s*inset: auto env\(safe-area-inset-right, 0px\) calc\(67px \+ env\(safe-area-inset-bottom, 0px\)\) env\(safe-area-inset-left, 0px\)/);
    expect(read("components/staff-shell.module.css")).toContain("padding-bottom: env(safe-area-inset-bottom, 0px)");
  });

  it("steps the bottom bar aside while a text field has focus, and unpins the save bar", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/html\[data-keyboard="open"\] \.mobile-nav \{ transform: translateY/);
    expect(css).toMatch(/html\[data-keyboard="open"\] \.event-savebar\.is-pinned \{ position: static; \}/);
    // The rules sit in the phone query, so a hardware keyboard on a tablet never hides the bar.
    const block = css.slice(css.indexOf("While a text field has focus on a phone"));
    expect(block.slice(0, block.indexOf("}\n/* The More sheet's head")).includes("@media (max-width: 800px)")).toBe(true);
    // Slid away, never display:none: a hidden More button could not take focus back from a closing sheet.
    expect(css).not.toMatch(/html\[data-keyboard="open"\] \.mobile-nav \{[^}]*display: none/);
    expect(shell("/overview")).toContain("mobile-nav");
  });

  it("decides what opens the keyboard from the control, not the device", () => {
    expect(opensKeyboard({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(opensKeyboard({ tagName: "input", type: "search" })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT" })).toBe(true);
    expect(opensKeyboard({ tagName: "TEXTAREA" })).toBe(true);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
    for (const type of ["checkbox", "radio", "button", "submit", "file", "range", "color"]) expect(opensKeyboard({ tagName: "INPUT", type }), type).toBe(false);
    expect(opensKeyboard({ tagName: "INPUT", type: "text", readOnly: true })).toBe(false);
    expect(opensKeyboard({ tagName: "TEXTAREA", disabled: true })).toBe(false);
    expect(opensKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });

  it("changes between phone bar, menu line and tab row by width and fit, never by device", () => {
    const css = read("components/staff-shell.module.css");
    expect(css).not.toContain("@media (max-width: 1023.98px)");
    expect(css).toContain('.tabline[data-fit="tight"] .menuline { display: flex; }');
    for (const file of ["components/staff-tab-row.tsx", "components/staff-shell.module.css", "components/staff-phone-bar.tsx"]) {
      expect(read(file), file).not.toMatch(/iPad|iPhone|userAgent|navigator\.platform/);
    }
  });
});

describe("scope stays visible and never moves with a tab (#1566)", () => {
  it("shows the selected event inside an event, with its picker, and no picker on global pages", () => {
    const inEvent = shell("/finance");
    expect(inEvent).toContain('id="event-picker"');
    expect(inEvent).toContain("Synthetic Event");
    for (const path of ["/admin", "/admin/people", "/admin/analytics", "/admin/system-report", "/help", "/help/glossary", "/admin/honors"]) {
      const html = shell(path);
      expect(html, path).not.toContain('id="event-picker"');
      expect(html, path).not.toContain('aria-label="Switch event"');
    }
  });

  it("keeps the selected event on every tab, view, rail and phone link inside an event", () => {
    const html = shell("/finance");
    const links = [...hrefs(rail(html)), ...hrefs(row(html)), ...hrefs(phone(html))];
    expect(links.length).toBeGreaterThan(10);
    for (const href of links) {
      // The phone's Clubs slot opens the Clubs pages, which never carried an event.
      if (/^\/admin\/clubs/.test(href) || href === "/admin" || href.startsWith("/events-admin")) continue;
      if (href.startsWith("/help")) continue;
      expect(href, href).toContain("event=synthetic_event");
    }
  });

  it("keeps the club year on every Clubs tab and view, and shows the year picker only in Clubs", () => {
    const clubs = shell("/admin/clubs/summary", { query: "year=2025-26" });
    expect(clubs).toContain("Club year");
    // Every tab of the row, including the ones whose pages ignore ?year=, so passing through one cannot reset the year.
    const links = hrefs(row(clubs));
    expect(links.length).toBeGreaterThan(5);
    expect(links.some((href) => href.startsWith("/admin/clubs/applications"))).toBe(true);
    expect(hrefs(rail(clubs)).filter((href) => href.startsWith("/admin/clubs") && !href.includes("year=2025-26"))).toEqual([]);
    for (const href of links) expect(href, href).toContain("year=2025-26");
    for (const path of ["/admin/people", "/admin", "/overview", "/help"]) expect(shell(path, { query: "year=2025-26&event=synthetic_event" }), path).not.toContain("Club year");
  });
});

describe("deep pages light their parent tab, rail area and phone item (#1566)", () => {
  // A deep page: the rail area, the tab (null inside an event), and the bar item it lights on a phone.
  const deep: Array<[string, { area: string; tab: string | null; eventTab?: string; bar: string }]> = [
    ["/finance/invoices/inv_1", { area: "events", tab: null, eventTab: "money", bar: "Events" }],
    ["/finance/invoices/statements/p1", { area: "events", tab: null, eventTab: "money", bar: "Events" }],
    ["/more/clubs/org1", { area: "events", tab: null, eventTab: "setup", bar: "Events" }],
    ["/more/clubs/reports/org1/2026-10", { area: "events", tab: null, eventTab: "setup", bar: "Events" }],
    ["/more/health-records/org1/m1", { area: "events", tab: null, eventTab: "setup", bar: "Events" }],
    ["/more/reports/clubs/packet/org1", { area: "events", tab: null, eventTab: "reports", bar: "Events" }],
    ["/more/kitchen-report/closeout", { area: "events", tab: null, eventTab: "reports", bar: "Events" }],
    ["/more/lodging/assignments", { area: "events", tab: null, eventTab: "setup", bar: "Events" }],
    ["/more/issued-assets/closeout", { area: "events", tab: null, eventTab: "setup", bar: "Events" }],
    ["/check-in/assets", { area: "events", tab: null, eventTab: "check-in", bar: "Check-in" }],
    ["/people/staff-invitations/approvals", { area: "events", tab: null, eventTab: "registrations", bar: "Events" }],
    ["/admin/organizations/org1/profile", { area: "clubs", tab: "clubs-and-churches", bar: "Clubs" }],
    ["/admin/organizations/org1/club/honors", { area: "clubs", tab: "clubs-and-churches", bar: "Clubs" }],
    ["/admin/clubs/reports/org1/2026-10", { area: "clubs", tab: "monthly-records", bar: "Clubs" }],
    ["/admin/people/user/u1", { area: "people", tab: "people-access", bar: "More" }],
    ["/admin/information-forms/f1/responses", { area: "admin", tab: "hub-forms", bar: "More" }],
    ["/admin/club-forms/some-template", { area: "admin", tab: "hub-forms", bar: "More" }],
    ["/admin/event-templates/t1", { area: "events", tab: "templates", bar: "Events" }],
    ["/help/some-guide", { area: "home", tab: null, bar: "More" }],
  ];

  it("maps each deep page to its parent", () => {
    for (const [path, expected] of deep) {
      const place = staffPlaceFor(path);
      expect(place.area, path).toBe(expected.area);
      if (expected.eventTab) {
        expect(place.inEvent, path).toBe(true);
        expect(currentEventPlace(path).tab, path).toBe(expected.eventTab);
      } else {
        expect(place.tab, path).toBe(expected.tab);
      }
    }
  });

  it("renders exactly one lit rail area, one lit tab and one lit phone item for each", () => {
    for (const [path, expected] of deep) {
      const html = shell(path);
      const litRail = rail(html).match(/aria-current="true"/g) ?? [];
      // Every page lights exactly one area; Help belongs to Home (#1568 put Home on the rail).
      expect(litRail.length, `${path} rail`).toBe(1);
      expect([...phone(html).matchAll(/<a class="active"[^>]*>.*?<span>([^<]+)<\/span>/g)].map((match) => match[1]), `${path} phone`).toEqual([expected.bar]);
      if (expected.area !== "home") {
        const lit = row(html).match(/aria-current="(?:page|true)"/g) ?? [];
        expect(lit.length, `${path} tab`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("has an in-app way back on the deep pages that were missing one", () => {
    for (const [file, href] of [
      ["app/(workspace)/more/lodging/assignments/page.tsx", "/more/lodging?event="],
      ["app/(workspace)/more/lodging/requests/page.tsx", "/more/lodging?event="],
    ]) {
      const source = read(file);
      expect(source, file).toContain("<BackLink");
      expect(source, file).toContain(href);
    }
  });
});
