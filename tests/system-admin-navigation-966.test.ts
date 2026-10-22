import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** System admin home cards and sidebar groups (#966). Synthetic data only. */

const navigation = vi.hoisted(() => ({ pathname: "/admin", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";
import { eventFeaturesItem } from "@/components/staff-navigation";
import { StaffAccountMenu } from "@/components/staff-account-menu";
import { resolveSidebarGroupOpen } from "@/components/sidebar-groups";
import {
  createEventHrefFor,
  systemNavActiveEntryKey,
  systemNavActiveItem,
  systemNavGroups,
} from "@/components/system-navigation";

const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;

const events = [
  { id: "evt_one", slug: "one", name: "Synthetic Event", permissions: ["VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN"] as const },
];
const staff = { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null };
const admin = { ...staff, globalRole: "SYSTEM_ADMIN" as const };

function render(user: typeof staff | typeof admin) {
  return renderToStaticMarkup(
    createElement(AppShellElement, { events, user, defaultEventId: "evt_one" }, createElement("p", null, "content")),
  );
}

function sidebarOf(markup: string) {
  const start = markup.indexOf('<nav class="primary-nav"');
  return markup.slice(start, markup.indexOf("</nav>", start));
}

beforeEach(() => {
  navigation.pathname = "/admin";
  navigation.search = "";
});

describe("system navigation groups", () => {
  it("lists the groups in order, with only Catalogs and settings collapsed by default", () => {
    expect(systemNavGroups.map((group) => group.label)).toEqual(["Events", "Clubs", "People", "Forms", "Catalogs and settings"]);
    expect(systemNavGroups.filter((group) => group.collapsedByDefault).map((group) => group.label)).toEqual(["Catalogs and settings"]);
  });

  it("puts the daily tasks one click from /admin", () => {
    const hrefs = systemNavGroups.flatMap((group) => group.items.map((item) => item.href));
    for (const href of [
      "/event-setup",
      "/admin/calendar",
      "/event-setup/copy",
      "/admin/clubs/reports",
      "/admin/clubs/summary",
      "/admin/clubs/applications",
      "/admin/clubs/transfers",
      "/admin/organizations",
      "/archived-events",
    ]) expect(hrefs).toContain(href);
  });

  it("lists system-administrator pages, plus the staff-scoped Archived events", () => {
    for (const { href } of systemNavGroups.flatMap((group) => group.items)) {
      expect(href.startsWith("/admin") || href.startsWith("/event-setup") || href === "/archived-events", href).toBe(true);
    }
  });

  it("lights the most specific item for a page", () => {
    expect(systemNavActiveItem("/admin/organizations")?.label).toBe("Clubs and churches");
    expect(systemNavActiveItem("/admin/organizations/org_1/profile")?.label).toBe("Clubs and churches");
    expect(systemNavActiveItem("/admin/organizations/background-checks")?.label).toBe("Sterling Volunteers");
    expect(systemNavActiveItem("/admin/clubs/reports/org_1/2026-09")?.label).toBe("Monthly reports");
    expect(systemNavActiveItem("/admin/clubs/invites")?.label).toBe("New club applications and invites");
    expect(systemNavActiveItem("/admin/organizationsx")).toBeNull();
    expect(systemNavActiveItem("/admin")).toBeNull();
    expect(systemNavActiveEntryKey("/admin/calendar")).toBe("system-events:/admin/calendar");
  });

  it("opens a group by default unless it is collapsed by default, and keeps the saved choice", () => {
    const base = { containsCurrentPage: false, dismissedOnThisPage: false };
    expect(resolveSidebarGroupOpen({ ...base, saved: undefined, defaultOpen: true })).toBe(true);
    expect(resolveSidebarGroupOpen({ ...base, saved: undefined, defaultOpen: false })).toBe(false);
    expect(resolveSidebarGroupOpen({ ...base, saved: false, defaultOpen: true })).toBe(false);
    expect(resolveSidebarGroupOpen({ ...base, saved: undefined })).toBe(false);
    expect(resolveSidebarGroupOpen({ ...base, saved: undefined, containsCurrentPage: true })).toBe(true);
  });
});

describe("sidebar on /admin pages", () => {
  it("shows the system groups to a system admin, collapsible, with Catalogs and settings closed", () => {
    const nav = sidebarOf(render(admin));
    for (const label of ["Events", "Clubs", "People", "Forms", "Catalogs and settings"]) expect(nav).toContain(`<span>${label}</span>`);
    expect(nav).toContain('href="/admin/clubs/reports?event=evt_one"');
    expect(nav).toContain('href="/event-setup/copy?event=evt_one"');
    expect(nav).toMatch(/id="nav-group-system-catalogs-toggle"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*id="nav-group-system-catalogs-toggle"/);
    expect(nav).toMatch(/id="nav-group-system-clubs-toggle"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*id="nav-group-system-clubs-toggle"/);
    // The event workspace sections are not drawn on system pages.
    expect(nav).not.toContain("Registrations");
  });

  it("highlights the current page and opens its group", () => {
    navigation.pathname = "/admin/honors";
    const nav = sidebarOf(render(admin));
    expect(nav).toContain('class="nav-item active" aria-current="page" href="/admin/honors?event=evt_one"');
    expect(nav).toMatch(/aria-expanded="true"[^>]*id="nav-group-system-catalogs-toggle"|id="nav-group-system-catalogs-toggle"[^>]*aria-expanded="true"/);
  });

  it("keeps the current event on system links and lists Archived events once", () => {
    navigation.search = "event=evt_one";
    const markup = render(admin);
    expect(sidebarOf(markup)).toContain('href="/admin/clubs/reports?event=evt_one"');
    expect(markup.match(/>Archived events</g)).toHaveLength(1);
    navigation.pathname = "/overview";
    expect(render(admin).match(/>Archived events</g)).toHaveLength(1);
  });

  it("leaves the event workspace sidebar unchanged off /admin, and never shows system groups to non-admins", () => {
    navigation.pathname = "/overview";
    const eventNav = sidebarOf(render(admin));
    expect(eventNav).toContain("Registrations");
    expect(eventNav).not.toContain("Catalogs and settings");
    navigation.pathname = "/admin";
    const nonAdmin = sidebarOf(render(staff));
    expect(nonAdmin).not.toContain("Catalogs and settings");
    expect(nonAdmin).not.toContain('href="/admin/clubs/reports?event=evt_one"');
    expect(nonAdmin).not.toContain('href="/event-setup"');
  });
});

describe("account menu Create event", () => {
  const menu = (createEventHref?: string) => renderToStaticMarkup(createElement(StaffAccountMenu, {
    attendeePreviewHref: "/account",
    canSwitchToAttendee: false,
    createEventHref,
    defaultOpen: true,
    displayName: "Synthetic Staff",
    email: "staff@imsda-events.test",
  }));

  it("shows for a system admin only", () => {
    expect(menu("/event-setup")).toContain('href="/event-setup"');
    expect(menu("/event-setup")).toContain("Create event");
    expect(menu()).not.toContain("Create event");
  });

  it("is offered only to system administrators", () => {
    expect(createEventHrefFor(true)).toBe("/event-setup");
    expect(createEventHrefFor(false)).toBeUndefined();
    // The shell reads the helper (the popover itself is closed in static markup).
    const source = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
    expect(source).toContain("createEventHref={createEventHrefFor(isSystemAdmin)}");
  });
});

describe("/admin dashboard page", () => {
  const source = readFileSync(join(process.cwd(), "app/(workspace)/admin/page.tsx"), "utf8");

  it("draws the grouped task cards from the shared groups, and still gates on system admin", () => {
    expect(source).toContain("systemNavGroups.map");
    expect(source).toContain('user.globalRole !== "SYSTEM_ADMIN"');
    expect(source).not.toContain("heroActions");
    expect(source).toContain("group.collapsedByDefault");
    expect(source).toContain("<details");
  });

  it("links each event card to Features, placeholder until #965 lands", () => {
    expect(source).toContain("eventFeaturesItem.href");
    expect(source).not.toContain("TODO(#965)");
    expect(eventFeaturesItem.href.startsWith("/more")).toBe(true);
  });

  it("lists Archived events once (the Events card), and puts the per-event links in an Actions menu (#989)", () => {
    expect(source).not.toContain('href="/archived-events"');
    expect(systemNavGroups.flatMap((group) => group.items).filter((item) => item.href === "/archived-events")).toHaveLength(1);
    // The card description is read once, as the card text; there is no title tooltip repeating it.
    expect(source).not.toContain("title={description}");
    // All seven per-event links stay reachable, in the shared closed-by-default Actions menu (one primary action, #981).
    expect(source).toContain("<ActionsMenu label=\"Event links\" ariaLabel={`Event links for ${event.name}`}>");
    const menu = source.slice(source.indexOf("<ActionsMenu"), source.indexOf("</ActionsMenu>"));
    for (const target of ["/registration-builder?", "eventFeaturesItem.href", "/finance/square-payments?", "/more/promo-codes?", "/staff?", "/more/health?", "/more/event-settings?"]) {
      expect(menu, target).toContain(target);
    }
    expect(source).toContain("Open event <ArrowRight");
    const stylesheet = readFileSync(join(process.cwd(), "app/(workspace)/admin/system-admin.module.css"), "utf8");
    // On a phone the task cards drop their description and sit two to a row, so the page is much shorter.
    // The phone block is the last in the file, so these checks cannot match a rule in another media block.
    const phone = stylesheet.slice(stylesheet.indexOf("@media (max-width: 700px) {"));
    expect(phone.match(/@media/g)).toHaveLength(1);
    expect(phone).toMatch(/\.taskGrid,\s*\.taskGrid\[data-count\] \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(phone).toMatch(/\.eventButtons :global\(\.actions-menu-trigger\) \{\s*width: 100%;/);
    // Links keep 44px tap targets on a tablet (#447).
    expect(stylesheet).toMatch(/@media \(max-width: 768px\) \{\s*\.openEvent,\s*\.eventWarnings a,\s*\.eventStats a \{[^}]*min-height: 44px;/);
    expect(stylesheet).toMatch(/\.taskCard small \{\s*display: none;/);
    // Each event card drops its stat row on a phone (#987), and no later rule lays the row out again.
    expect(phone).toMatch(/\.eventStats \{\s*display: none;/);
    expect(stylesheet.slice(stylesheet.lastIndexOf(".eventStats {"))).toMatch(/^\.eventStats \{\s*display: none;/);
  });

  it("orders the page: hero, summary, task groups, health, then event operations and the footer cards (#989)", () => {
    const at = (text: string) => source.indexOf(text);
    const order = ["styles.hero", "styles.metrics", "styles.tasks", "styles.health}", "styles.primaryColumn", "styles.footerCards"].map(at);
    expect(order.every((position) => position > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // Tiles are equal height with a two-line description, and the grid is sized to the group's tile count.
    expect(source).toContain("data-count={group.items.length}");
    const stylesheet = readFileSync(join(process.cwd(), "app/(workspace)/admin/system-admin.module.css"), "utf8");
    expect(stylesheet).toMatch(/\.taskGrid \{[^}]*grid-auto-rows: 1fr;/);
    expect(stylesheet).toMatch(/\.taskCard small \{[^}]*-webkit-line-clamp: 2;/);
    expect(stylesheet).toMatch(/\.taskGrid\[data-count="5"\] \{\s*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
    // The health text never breaks mid-word unless one word is longer than the card.
    expect(stylesheet).not.toMatch(/overflow-wrap: anywhere/);
  });

  it("keeps the event operations, health and version panels", () => {
    for (const text of ["Event operations", "System health", "System version", "Feature requests"]) expect(source).toContain(text);
  });
});
