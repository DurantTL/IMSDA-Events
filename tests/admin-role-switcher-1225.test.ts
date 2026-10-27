import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminRoleSwitcher } from "@/components/admin-role-switcher";
import { clubsAdminActiveHref, clubsAdminNavigation } from "@/components/staff-navigation";

/** #1225: the switcher shows only the roles held, marks the current one, and is plain links (no /api form POST). */

const render = (props: Parameters<typeof AdminRoleSwitcher>[0]) => renderToStaticMarkup(createElement(AdminRoleSwitcher, props));

describe("AdminRoleSwitcher", () => {
  it("shows only the roles held, in order, as plain links, with the current one marked as the page", () => {
    const html = render({ held: ["EVENTS_ADMIN", "CLUBS_ADMIN"], active: "CLUBS_ADMIN", counts: { CLUBS_ADMIN: 3 } });
    expect(html).toContain("Events Administrator");
    expect(html).toContain("Clubs Administrator");
    expect(html).not.toContain("System Administrator");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html.indexOf('href="/admin-role/EVENTS_ADMIN"')).toBeLessThan(html.indexOf('href="/admin-role/CLUBS_ADMIN"'));
    expect(html).toMatch(/<a aria-current="page" class="admin-role-pill" href="\/admin-role\/CLUBS_ADMIN">/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // No form, no button, nothing posting to /api: Cloudflare challenged that on every click.
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("/api/");
    expect(html).not.toContain("aria-pressed");
  });

  it("says how many roles are held when there is a choice, and counts what is waiting", () => {
    const html = render({ held: ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"], active: "SYSTEM_ADMIN", counts: { CLUBS_ADMIN: 2, SYSTEM_ADMIN: 7 } });
    expect(html).toContain("You hold 3 admin roles. Switch between them any time.");
    expect(html).toContain("2 waiting");
    expect(html).toContain("7 waiting");
  });

  it("with one role shows just that role, no switching note, and leaves a zero or missing count off", () => {
    const html = render({ held: ["CLUBS_ADMIN"], active: "CLUBS_ADMIN", counts: { CLUBS_ADMIN: 0 } });
    expect(html).toContain("Clubs Administrator");
    expect(html).not.toContain("Switch between them");
    expect(html).not.toContain("waiting");
  });

  it("renders nothing for an account with no admin role", () => {
    expect(render({ held: [], active: null })).toBe("");
  });
});

describe("the Clubs sidebar", () => {
  it("lists only the club areas, with the club management pages opened in #1232, and lights the most specific page", () => {
    // The flat page list behind the phone bar and the active match (#1245): the grouped sidebar's pages, each once.
    expect([...clubsAdminNavigation.map((item) => item.href)].sort()).toEqual([
      "/admin/club-forms", "/admin/club-supplies", "/admin/clubs", "/admin/clubs/applications", "/admin/clubs/health-import",
      "/admin/clubs/import", "/admin/clubs/invites", "/admin/clubs/reports", "/admin/clubs/reports/year-end", "/admin/clubs/summary",
      "/admin/clubs/transfers", "/admin/honors", "/admin/organizations/background-checks",
    ]);
    // Never a page a Clubs Administrator cannot open.
    for (const href of clubsAdminNavigation.map((item) => item.href)) {
      expect(href).not.toMatch(/^\/admin\/(accounts|team|settings|email|organizations$|master-award-rules)/);
    }
    expect(clubsAdminNavigation.find((item) => item.href === "/admin/organizations/background-checks")?.label).toBe("Sterling Volunteers");
    expect(clubsAdminActiveHref("/admin/clubs/invites")).toBe("/admin/clubs/invites");
    expect(clubsAdminActiveHref("/admin/organizations/background-checks")).toBe("/admin/organizations/background-checks");
    expect(clubsAdminActiveHref("/admin/clubs/reports/year-end")).toBe("/admin/clubs/reports/year-end");
    expect(clubsAdminActiveHref("/admin/clubs/reports/club-1/2026-10")).toBe("/admin/clubs/reports");
    expect(clubsAdminActiveHref("/admin/club-forms/some_form")).toBe("/admin/club-forms");
    expect(clubsAdminActiveHref("/admin/accounts")).toBeNull();
  });
});

describe("the switcher styles", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  const block = css.slice(css.indexOf("/* Admin role switcher (#1225)"), css.indexOf("/* Registration form builder editor shell (#1132)"));

  it("is placed before the form builder marker, keeps 44px targets, the staff text floor and wraps on a phone", () => {
    expect(block.length).toBeGreaterThan(100);
    expect(block).toMatch(/\.admin-role-pill \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.admin-role-pill \{[^}]*font-size: max\(var\(--type-staff-floor, 0px\), 0\.875rem\)/);
    expect(block).toMatch(/\.admin-role-pills \{[^}]*flex-wrap: wrap/);
    expect(block).toMatch(/\.admin-role-pill \{[^}]*text-decoration: none/);
    expect(block).toContain('.admin-role-pill[aria-current="page"]');
    expect(block).not.toContain(":hover");
  });
});
