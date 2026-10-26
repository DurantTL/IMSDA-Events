import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminRoleSwitcher } from "@/components/admin-role-switcher";
import { clubsAdminActiveHref, clubsAdminNavigation } from "@/components/staff-navigation";

/** #1225: the switcher shows only the roles held, marks the current one, and is a real form with real buttons. */

const render = (props: Parameters<typeof AdminRoleSwitcher>[0]) => renderToStaticMarkup(createElement(AdminRoleSwitcher, props));

describe("AdminRoleSwitcher", () => {
  it("shows only the roles held, in order, as submit buttons, with the current one pressed", () => {
    const html = render({ held: ["EVENTS_ADMIN", "CLUBS_ADMIN"], active: "CLUBS_ADMIN", counts: { CLUBS_ADMIN: 3 } });
    expect(html).toContain("Events Administrator");
    expect(html).toContain("Clubs Administrator");
    expect(html).not.toContain("System Administrator");
    expect(html.match(/type="submit"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*name="role"[^>]*value="CLUBS_ADMIN"|value="CLUBS_ADMIN"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*value="CLUBS_ADMIN"/);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/staff/admin-role"');
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
    expect(clubsAdminNavigation.map((item) => item.href)).toEqual([
      "/admin/clubs/summary", "/admin/clubs/applications", "/admin/clubs/invites", "/admin/clubs/reports", "/admin/clubs/reports/year-end",
      "/admin/clubs/transfers", "/admin/clubs/import", "/admin/clubs/health-import", "/admin/club-forms",
      "/admin/honors", "/admin/club-supplies", "/admin/organizations/background-checks",
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
    expect(block).not.toContain(":hover");
  });
});
