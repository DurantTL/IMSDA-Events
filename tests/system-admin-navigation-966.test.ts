import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** System admin home cards and the groups behind the Admin tabs (#966, #1565). Synthetic data only. */

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
import { clubsAdminRecordsHref, eventFeaturesItem } from "@/components/staff-navigation";
import { StaffAccountMenu } from "@/components/staff-account-menu";
import {
  adminDirectoryGroups,
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

/** The rail, then the row of tabs and the view strip. */
function railOf(markup: string) {
  const start = markup.indexOf('id="primary-navigation"');
  return markup.slice(start, markup.indexOf("</nav>", start));
}
function tabsOf(markup: string) {
  const start = markup.indexOf('data-staff-tabs="true"');
  const strip = markup.indexOf("data-staff-views");
  return markup.slice(start, strip > start ? markup.indexOf("</div>", strip) : markup.indexOf("</nav>", start));
}

beforeEach(() => {
  navigation.pathname = "/admin";
  navigation.search = "";
});

describe("system navigation groups", () => {
  it("lists the groups in order, with only Catalogs and settings collapsed by default on the dashboard", () => {
    expect(systemNavGroups.map((group) => group.label)).toEqual(["Events", "Clubs", "People", "Forms", "Catalogs and settings"]);
    expect(systemNavGroups.filter((group) => group.collapsedByDefault).map((group) => group.label)).toEqual(["Catalogs and settings"]);
  });

  it("lists All forms first in Forms, ahead of the existing entries, with no duplicate destinations (#1151)", () => {
    const forms = systemNavGroups.find((group) => group.key === "system-forms")!;
    expect(forms.items.map((item) => item.label)).toEqual(["All forms", "Club forms", "Public club forms page", "Form templates", "Question library", "Information forms"]);
    const hrefs = systemNavGroups.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs.filter((href) => href === "/admin/forms")).toHaveLength(1);
  });

  it("puts the daily tasks one click from /admin", () => {
    const hrefs = systemNavGroups.flatMap((group) => group.items.map((item) => item.href));
    for (const href of [
      "/event-setup",
      "/admin/calendar",
      "/event-setup/copy",
      clubsAdminRecordsHref,
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
    expect(systemNavActiveItem("/admin/clubs/reports/org_1/2026-09")?.label).toBe("Monthly Records");
    expect(systemNavActiveItem("/admin/clubs/invites")?.label).toBe("New club applications");
    expect(systemNavActiveItem("/admin/organizationsx")).toBeNull();
    expect(systemNavActiveItem("/admin")).toBeNull();
    expect(systemNavActiveItem("/admin/calendar")?.label).toBe("Conference calendar");
    expect(systemNavActiveEntryKey("/admin/calendar")).toBe("system-events:/admin/calendar");
  });

  it("keeps the dashboard's collapse rule out of the shell: no group opens or closes there any more (#1565)", () => {
    expect(readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8")).not.toContain("group.collapsedByDefault");
  });
});

describe("the Admin area on /admin pages", () => {
  it("shows a system admin the rail's Admin area with its six tabs, and no sidebar groups", () => {
    const markup = render(admin);
    const row = tabsOf(markup);
    for (const label of ["System administration", "Events", "Clubs", "People", "Forms", "Catalogs and settings"]) expect(row).toContain(`>${label}`);
    expect(row.match(/<li>/g)).toHaveLength(6);
    expect(railOf(markup)).toContain("<span>Admin</span>");
    expect(markup).not.toContain("nav-group-toggle");
    // The event workspace tabs are not drawn on System pages.
    expect(row).not.toContain("Registrations");
  });

  it("opens each hub tab on its hub page, and the System administration dashboard keeps its task directory (#1569)", () => {
    const row = tabsOf(render(admin));
    expect(row).toContain('href="/admin/hubs/events?event=evt_one">Events');
    expect(row).toContain('href="/admin/hubs/clubs?event=evt_one">Clubs');
    expect(row).toContain('href="/admin/hubs/people?event=evt_one">People');
    expect(row).toContain('href="/admin/hubs/forms?event=evt_one">Forms');
    expect(row).toContain('href="/admin/hubs/catalogs?event=evt_one">Catalogs and settings');
    expect(row).toContain('aria-current="page" href="/admin?event=evt_one">System administration');
  });

  it("highlights the tab of a page the hub tab does not itself open, and marks the hub tab as the page on its hub", () => {
    navigation.pathname = "/admin/honors";
    expect(render(admin)).toContain('aria-current="true" href="/admin/hubs/catalogs?event=evt_one">Catalogs and settings');
    navigation.pathname = "/admin/hubs/catalogs";
    expect(tabsOf(render(admin))).toContain('aria-current="page" href="/admin/hubs/catalogs?event=evt_one">Catalogs and settings');
  });

  it("keeps the current event on system links and lists Archived events once per page", () => {
    navigation.search = "event=evt_one";
    navigation.pathname = "/admin/calendar";
    const events = render(admin);
    expect(tabsOf(events)).toContain('href="/archived-events?event=evt_one">Archived events');
    expect(events.match(/>Archived events</g)).toHaveLength(1);
    navigation.pathname = "/overview";
    // On an event page the list is the event switcher's last choice, once (#1734), not a link in the event bar.
    const eventPage = render(admin);
    expect(eventPage.match(/>Archived events…</g)).toHaveLength(1);
    expect(eventPage).not.toContain('href="/archived-events"');
  });

  it("leaves the event tabs unchanged off /admin, and never shows system pages to non-admins", () => {
    navigation.pathname = "/overview";
    const eventRow = tabsOf(render(admin));
    expect(eventRow).toContain("Registrations");
    expect(eventRow).not.toContain("Catalogs and settings");
    navigation.pathname = "/admin";
    const nonAdmin = render(staff);
    expect(railOf(nonAdmin)).not.toContain("Admin");
    expect(nonAdmin).not.toContain('href="/admin/clubs/summary?view=records&amp;event=evt_one#monthly-records"');
    expect(nonAdmin).not.toContain('href="/event-setup"');
    expect(nonAdmin).not.toContain("Catalogs and settings");
  });
});

describe("account menu Create event", () => {
  const menu = (createEventHref?: string) => renderToStaticMarkup(createElement(StaffAccountMenu, {
    attendeePreviewHref: "/account",
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

  it("draws the Catalogs and settings cards from the shared groups (the other groups are Common tasks, #1228), and still gates on system admin", () => {
    expect(source).toContain("const catalogGroups = adminDirectoryGroups;");
    expect(adminDirectoryGroups.map((group) => group.key)).toEqual(["system-catalogs"]);
    expect(source).toContain("catalogGroups.map");
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

  it("orders the page: header, summary, work across the platform, upcoming events, common tasks, health, the task directory and the footer cards (#1182)", () => {
    const at = (text: string) => source.indexOf(text);
    const order = ["styles.hero", "styles.metrics", "styles.workPanel", "styles.primaryColumn", "styles.commonTasks", "styles.health}", "styles.tasks", "styles.footerCards"].map(at);
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
    for (const text of ["Upcoming events", "System health", "System version", "Event module requests"]) expect(source).toContain(text);
  });
});
