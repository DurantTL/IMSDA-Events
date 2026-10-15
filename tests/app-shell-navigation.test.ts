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

const events = [{
  id: "event_1",
  slug: "womens-retreat-2026",
  name: "Women’s Retreat 2026",
  permissions: [
    "VIEW_SENSITIVE_DATA",
    "MANAGE_FINANCE",
  ] as const,
}];

describe("application shell navigation", () => {
  it("places global system management before the event workspace", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events,
          user: {
            displayName: "Casey System Admin",
            email: "system@imsda-events.test",
            globalRole: "SYSTEM_ADMIN",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    expect(markup).toContain("Global administration");
    expect(markup).toContain("System management");
    expect(markup).toContain("Event workspace");
    expect(markup.indexOf("System management")).toBeLessThan(
      markup.indexOf("Event workspace"),
    );
    expect(markup).toContain("All events and integrations");
    expect(markup).toContain("Attendee experience");
    expect(markup).toContain(
      "/account/events/womens-retreat-2026?preview=staff",
    );
  });

  it("does not expose system management to event-only staff", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events,
          user: {
            displayName: "Riley Registration",
            email: "registration@imsda-events.test",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    expect(markup).not.toContain("Global administration");
    expect(markup).not.toContain("System management");
    expect(markup).toContain("Event workspace");
    expect(markup).toContain("Attendee experience");
  });

  // A group heading is a button (#964); the label is its first span.
  function groupHeading(label: string) {
    return `class="nav-group-toggle"`.concat(`[^>]*><span>${label}</span>`);
  }
  function hasHeading(markup: string, label: string) {
    return new RegExp(groupHeading(label)).test(markup);
  }
  const navOf = (markup: string) => markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf('class="sidebar-foot"'));

  it("groups Set up and Reports under button headings, in order, and leaves the moved items out (#964)", () => {
    const groupedEvents = [{
      id: "event_1",
      slug: "womens-retreat-2026",
      name: "Women’s Retreat 2026",
      permissions: [
        "VIEW_SENSITIVE_DATA",
        "MANAGE_FINANCE",
        "MANAGE_CHECK_IN",
        "MANAGE_COMMUNICATIONS",
        "MANAGE_STAFF",
        "CONFIGURE_EVENT",
        "VIEW_REPORTS",
      ] as const,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: groupedEvents,
          user: {
            displayName: "Riley Registration",
            email: "registration@imsda-events.test",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );
    const nav = navOf(markup);

    expect(nav).toMatch(new RegExp(groupHeading("Set up")));
    expect(nav).toMatch(new RegExp(groupHeading("Reports")));
    expect(nav.search(new RegExp(groupHeading("Set up")))).toBeLessThan(nav.search(new RegExp(groupHeading("Reports"))));
    // The old headings are gone. No club oversight and not a system admin: no Clubs and churches or System heading.
    for (const label of ["Main", "Run the event", "Set up the event", "People", "Money", "Clubs and churches", "System"]) {
      expect(hasHeading(nav, label), label).toBe(false);
    }
    expect(nav).not.toContain("nav-group-label");
    // The daily items come before the first group, More after the last.
    const firstGroup = nav.indexOf("nav-group-toggle");
    for (const href of ["/overview", "/check-in", "/people", "/finance", "/communications"]) {
      expect(nav.indexOf(`href="${href}?event=event_1"`), href).toBeGreaterThan(-1);
      expect(nav.indexOf(`href="${href}?event=event_1"`), href).toBeLessThan(firstGroup);
    }
    expect(nav.lastIndexOf("/more?event=event_1")).toBeGreaterThan(nav.lastIndexOf("/more/health?event=event_1"));
    // Attendee list, Imports, Team and Promo codes left the sidebar; More and the parent pages reach them.
    for (const href of ["/people/attendees", "/imports", "/staff", "/more/promo-codes"]) {
      expect(nav, href).not.toContain(`href="${href}?event=event_1"`);
    }
  });

  it("shows no group heading for a role with just MANAGE_CHECK_IN", () => {
    const checkInOnlyEvents = [{
      id: "event_1",
      slug: "womens-retreat-2026",
      name: "Women’s Retreat 2026",
      permissions: ["MANAGE_CHECK_IN"] as const,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: checkInOnlyEvents,
          user: {
            displayName: "Casey Check-in",
            email: "checkin@imsda-events.test",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );
    const nav = navOf(markup);

    expect(nav).toContain('href="/overview?event=event_1"');
    expect(nav).toContain('href="/check-in?event=event_1"');
    expect(nav).not.toContain("nav-group-toggle");
    expect(nav).not.toContain("nav-group-label");
    for (const label of ["Set up", "Reports", "Clubs and churches", "System"]) expect(hasHeading(nav, label), label).toBe(false);
  });

  it("moves Clubs and churches out of the sidebar into the More launcher: the directory for a system admin on a CLUB-audience event, even one that is attendee-paid (#481, #741)", () => {
    const clubAudienceEvents = [{
      id: "event_1",
      slug: "man-camp-2026",
      name: "Man Camp 2026",
      permissions: [
        "VIEW_SENSITIVE_DATA",
        "MANAGE_FINANCE",
      ] as const,
      // Server-computed (app/(workspace)/layout.tsx): true only for a
      // CLUB-audience event, independent of billing mode.
      clubOversight: true,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: clubAudienceEvents,
          user: {
            displayName: "Casey System Admin",
            email: "system@imsda-events.test",
            globalRole: "SYSTEM_ADMIN",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    // No longer a pinned sidebar group (#741); it is a club-audience launcher card.
    expect(hasHeading(markup, "Clubs and churches")).toBe(false);
    expect(markup).not.toContain('href="/admin/organizations?event=event_1"');
    // System management is drawn once, above the picker, not as a nav group (#741 slice 4).
    expect(markup).toContain('href="/admin?event=event_1"');
    expect(hasHeading(markup, "System")).toBe(false);
    const cards = buildMoreDirectoryCards({
      permissions: clubAudienceEvents[0].permissions,
      clubOversight: true,
      clubEvent: true,
      isSystemAdmin: true,
      clubFormsAccess: true,
      eventQuery: "?event=event_1",
    });
    const launcher = launcherGroups(cards).flatMap((group) => group.cards);
    expect(launcher.find((card) => card.key === "clubs-and-churches")?.href).toBe("/admin/organizations");
    expect(launcher.find((card) => card.key === "clubs")?.title).toBe("This event's clubs");
  });

  it("does not show Clubs and churches for a system admin on a GENERAL event (#481)", () => {
    const generalAudienceEvents = [{
      id: "event_1",
      slug: "womens-retreat-2026",
      name: "Women’s Retreat 2026",
      permissions: [
        "VIEW_SENSITIVE_DATA",
        "MANAGE_FINANCE",
      ] as const,
      clubOversight: false,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: generalAudienceEvents,
          user: {
            displayName: "Casey System Admin",
            email: "system@imsda-events.test",
            globalRole: "SYSTEM_ADMIN",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    expect(hasHeading(markup, "Clubs and churches")).toBe(false);
    expect(hasHeading(markup, "System")).toBe(false);
    expect(markup).toContain('href="/admin?event=event_1"');
  });

  it("lists Clubs and churches in the More launcher, pointed at club oversight, for an event manager with club oversight on the selected event (#741)", () => {
    const clubOversightEvents = [{
      id: "event_1",
      slug: "pathfinder-camporee-2026",
      name: "Pathfinder Camporee 2026",
      permissions: ["MANAGE_FINANCE"] as const,
      clubOversight: true,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: clubOversightEvents,
          user: {
            displayName: "Riley Event Admin",
            email: "eventadmin@imsda-events.test",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    expect(hasHeading(markup, "Clubs and churches")).toBe(false);
    // Not a system admin: no System heading.
    expect(hasHeading(markup, "System")).toBe(false);
    const cards = buildMoreDirectoryCards({
      permissions: clubOversightEvents[0].permissions,
      clubOversight: true,
      clubEvent: true,
      isSystemAdmin: false,
      clubFormsAccess: true,
      eventQuery: "?event=event_1",
    });
    const launcher = launcherGroups(cards).flatMap((group) => group.cards);
    expect(launcher.find((card) => card.key === "clubs")).toMatchObject({ href: "/more/clubs?event=event_1", title: "Clubs and churches" });
    expect(launcher.some((card) => card.key === "clubs-and-churches")).toBe(false);
  });

  it("does not show Clubs and churches when the selected event has no club oversight and the viewer isn't a system admin", () => {
    const noOversightEvents = [{
      id: "event_1",
      slug: "womens-retreat-2026",
      name: "Women’s Retreat 2026",
      permissions: ["MANAGE_FINANCE"] as const,
      clubOversight: false,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: noOversightEvents,
          user: {
            displayName: "Riley Registration",
            email: "registration@imsda-events.test",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    expect(hasHeading(markup, "Clubs and churches")).toBe(false);
  });

  it("keeps the mobile tab bar's own order regardless of the sidebar's grouping", () => {
    const fullEvents = [{
      id: "event_1",
      slug: "womens-retreat-2026",
      name: "Women’s Retreat 2026",
      permissions: [
        "VIEW_SENSITIVE_DATA",
        "MANAGE_FINANCE",
        "MANAGE_CHECK_IN",
        "MANAGE_COMMUNICATIONS",
      ] as const,
    }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          events: fullEvents,
          user: {
            displayName: "Riley Registration",
            email: "registration@imsda-events.test",
            globalRole: "SYSTEM_ADMIN",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    const mobileNav = markup.slice(markup.indexOf('<nav class="mobile-nav"'));
    // Home, People, Check-in, Pay, Emails, More (#711, #890: the system admin holds
    // MANAGE_FINANCE so Payments is a tab; Promo codes stay in More) — unaffected by the sidebar's Events/People/Finance/… grouping or by the new
    // Clubs and churches / System entries (neither ever appears in the mobile bar).
    const order = ["/overview?", "/people?", "/check-in?", "/finance?", "/communications?", "/more?"];
    let lastIndex = -1;
    for (const href of order) {
      const index = mobileNav.indexOf(`href="${href}`);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
    expect(mobileNav).not.toContain("/admin/organizations");
    expect(mobileNav).not.toContain('href="/admin"');
    expect(mobileNav).toContain('aria-label="Payments"');
    expect(mobileNav).not.toContain("/more/promo-codes");
  });

  it("offers a real attendee-session switch when the staff email has an account", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        {
          attendeeAccountAvailable: true,
          events,
          user: {
            displayName: "Riley Registration",
            email: "registration@imsda-events.test",
          },
        },
        createElement("p", null, "Workspace content"),
      ),
    );

    expect(markup).toContain('action="/api/auth/switch-to-attendee"');
    expect(markup).toContain("My attendee account");
    expect(markup).toContain("Switch to your matching attendee account");
  });
});
