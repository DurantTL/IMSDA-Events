import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("event=event_1"),
}));

vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";
import { launcherGroups } from "@/components/more-launcher-model";
import { buildMoreDirectoryCards } from "@/components/staff-navigation";

const AppShellElement = AppShell as ComponentType<
  Omit<Parameters<typeof AppShell>[0], "children">
>;

function render(
  permissions: readonly string[],
  user: { displayName: string; email: string; globalRole?: "SYSTEM_ADMIN" | null },
  extra: Record<string, unknown> = {},
) {
  return renderToStaticMarkup(
    createElement(
      AppShellElement,
      {
        events: [{
          id: "event_1",
          slug: "womens-retreat-2026",
          name: "Women’s Retreat 2026",
          permissions: permissions as never,
          ...extra,
        }],
        user,
      },
      createElement("p", null, "Workspace content"),
    ),
  );
}

const rail = (markup: string) => markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf("</nav>", markup.indexOf('id="primary-navigation"')));
const tabRow = (markup: string) => markup.slice(markup.indexOf('data-staff-tabs="true"'), markup.indexOf("</nav>", markup.indexOf('data-staff-tabs="true"')));
const labels = (html: string) => [...html.matchAll(/<a [^>]*href="[^"]*">([^<]+)</g)].map((match) => match[1]);
const railLabels = (markup: string) => [...rail(markup).matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
const bar = (markup: string) => markup.slice(markup.indexOf('aria-label="Mobile navigation"'));
const staff = { displayName: "Riley Registration", email: "registration@imsda-events.test" };
const admin = { displayName: "Casey System Admin", email: "system@imsda-events.test", globalRole: "SYSTEM_ADMIN" as const };

describe("application shell navigation (#1565)", () => {
  it("draws a branded header, an icon rail and one row of tabs, and no sidebar", () => {
    const markup = render(["VIEW_EVENT", "MANAGE_CHECK_IN"], admin);
    expect(markup).not.toContain('class="sidebar"');
    expect(markup).not.toContain("Global administration");
    expect(markup).not.toContain("nav-group-toggle");
    expect(markup).toContain('aria-label="IMAdventist calendar"');
    expect(markup).toContain("Find a page or task");
    expect(markup).toContain("Help &amp; learning");
    expect(markup.indexOf("<header")).toBeLessThan(markup.indexOf('id="primary-navigation"'));
    expect(markup.indexOf('id="primary-navigation"')).toBeLessThan(markup.indexOf('data-staff-tabs="true"'));
    expect(markup.match(/data-staff-tabs="true"/g)).toHaveLength(1);
  });

  it("gives a system administrator all six areas, and event-only staff just Events", () => {
    expect(railLabels(render(["VIEW_EVENT"], admin))).toEqual(["Events", "Clubs", "People", "Reports", "Admin"]);
    const eventOnly = render(["VIEW_EVENT"], staff);
    expect(railLabels(eventOnly)).toEqual(["Events"]);
    expect(eventOnly).not.toContain("System management");
    expect(rail(eventOnly)).not.toContain('href="/admin');
  });

  it("lists the seven event tabs in order, with Payments under Money and the old sidebar items as views", () => {
    const markup = render(["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN", "MANAGE_COMMUNICATIONS", "MANAGE_FINANCE", "VIEW_REPORTS", "CONFIGURE_EVENT", "MANAGE_STAFF", "MANAGE_FORMS", "MANAGE_IMPORTS"], staff);
    expect(labels(tabRow(markup))).toEqual(["Event home", "Registrations", "Check-in", "Communications", "Money", "Reports", "Event setup"]);
    expect(tabRow(markup)).not.toContain(">Payments<");
    expect(tabRow(markup)).not.toContain(">Refunds<");
    // The current tab (Event home) has one aria-current, and the event bar names the event and switches it.
    expect(tabRow(markup).match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain("Women’s Retreat 2026");
    expect(markup).toContain('aria-label="Switch event"');
  });

  it("shows no tab for a role with just MANAGE_CHECK_IN other than Check-in", () => {
    const markup = render(["MANAGE_CHECK_IN"], staff);
    expect(labels(tabRow(markup))).toEqual(["Check-in"]);
    expect(rail(markup)).toContain('href="/check-in?event=event_1"');
  });

  it("leaves Clubs and churches to the More directory and the Clubs area: the directory for a system admin on a CLUB-audience event (#481, #741)", () => {
    const permissions = ["VIEW_SENSITIVE_DATA", "MANAGE_FINANCE"] as const;
    const markup = render(permissions, admin, { clubOversight: true });
    expect(markup).not.toContain('href="/admin/organizations?event=event_1"');
    // System management is the rail's Admin area, with the event carried.
    expect(rail(markup)).toContain('href="/admin?event=event_1"');
    const cards = buildMoreDirectoryCards({ permissions, clubOversight: true, clubEvent: true, isSystemAdmin: true, clubFormsAccess: true, eventQuery: "?event=event_1" });
    const launcher = launcherGroups(cards).flatMap((group) => group.cards);
    expect(launcher.find((card) => card.key === "clubs-and-churches")?.href).toBe("/admin/organizations");
    expect(launcher.find((card) => card.key === "clubs")?.title).toBe("This event's clubs");
  });

  it("does not show the club directory card for a system admin on a GENERAL event, or to staff without club oversight (#481)", () => {
    const general = buildMoreDirectoryCards({ permissions: ["MANAGE_FINANCE"], clubOversight: false, clubEvent: false, isSystemAdmin: true, clubFormsAccess: false, eventQuery: "?event=event_1" });
    expect(launcherGroups(general).flatMap((group) => group.cards).some((card) => card.key === "clubs-and-churches")).toBe(false);
    const overseer = buildMoreDirectoryCards({ permissions: ["MANAGE_FINANCE"], clubOversight: true, clubEvent: true, isSystemAdmin: false, clubFormsAccess: true, eventQuery: "?event=event_1" });
    const cards = launcherGroups(overseer).flatMap((group) => group.cards);
    expect(cards.find((card) => card.key === "clubs")).toMatchObject({ href: "/more/clubs?event=event_1", title: "Clubs and churches" });
    expect(cards.some((card) => card.key === "clubs-and-churches")).toBe(false);
  });

  it("keeps the phone bar to Home, Events, Check-in, Clubs and More, filtered by access", () => {
    const markup = render(["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_FINANCE", "MANAGE_CHECK_IN", "MANAGE_COMMUNICATIONS"], admin);
    const phone = bar(markup);
    const order = ["Home", "Events", "Check-in", "Clubs", "More"];
    let last = -1;
    for (const label of order) {
      const index = phone.indexOf(`<span>${label}</span>`);
      expect(index, label).toBeGreaterThan(last);
      last = index;
    }
    expect(phone.match(/<span>[^<]+<\/span>/g)).toHaveLength(5);
    // Not a person who can check in or open clubs: neither item is drawn.
    const limited = bar(render(["VIEW_EVENT"], staff));
    expect(limited).not.toContain("<span>Check-in</span>");
    expect(limited).not.toContain("<span>Clubs</span>");
    expect(limited).toContain("<span>Home</span>");
  });

  it("points the account menu's workspace switcher at only the workspaces held", async () => {
    const { staffWorkspaceOptions } = await import("@/modules/access/workspace-contexts");
    const options = staffWorkspaceOptions({ isSystemAdmin: false, attendeeAccountAvailable: true, staffHref: "/overview", onSystemPage: false });
    expect(options.map((option) => option.label)).toEqual(["Staff workspace", "My registrations"]);
    expect(options.find((option) => option.kind === "attendee")).toMatchObject({ method: "post", href: "/api/auth/switch-to-attendee" });
  });
});
