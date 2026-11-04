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
import { staffWorkspaceFor } from "@/components/staff-workspace-model";
import { StaffCreateMenu } from "@/components/staff-create-menu";
import { StaffWorkspaceSwitcher } from "@/components/staff-workspace-switcher";
import { buildAdminSectionNav } from "@/components/admin-section-nav";

const held: AdminRole[] = ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"];
function shell(path: string, active: AdminRole, withEvents = true) {
  state.path = path;
  return renderToStaticMarkup(h(AppShell, {
    children: h("p", {}, "Synthetic content"),
    events: withEvents ? [{ id: "synthetic_event", slug: "synthetic-event", name: "Synthetic Event", permissions: eventPermissions }] : [],
    user: { id: "synthetic_admin", displayName: "Synthetic Admin", email: "synthetic@imsda-events.test", globalRole: "SYSTEM_ADMIN" },
    adminRoleView: { held, active, counts: {} },
  }));
}
const primary = (html: string) => html.split('id="primary-navigation"')[1]?.split("</nav>")[0] ?? "";

describe("canonical staff workspace navigation", () => {
  it("uses the route's real section while preserving the selected view on shared pages", () => {
    expect(staffWorkspaceFor({ pathname: "/admin/settings", activeRole: "CLUBS_ADMIN", isSystemAdmin: true })).toBe("system");
    expect(staffWorkspaceFor({ pathname: "/admin/honors", activeRole: "CLUBS_ADMIN", isSystemAdmin: true })).toBe("clubs");
    expect(staffWorkspaceFor({ pathname: "/admin/honors", activeRole: "SYSTEM_ADMIN", isSystemAdmin: true })).toBe("system");
    expect(staffWorkspaceFor({ pathname: "/people", activeRole: "CLUBS_ADMIN", isSystemAdmin: true })).toBe("events");
  });

  it("keeps Clubs and System usable without an event or event sidebar", () => {
    for (const [path, role] of [["/admin/clubs", "CLUBS_ADMIN"], ["/admin", "SYSTEM_ADMIN"]] as const) {
      const html = shell(path, role, false);
      expect(html).not.toContain('id="event-picker"');
      expect(primary(html)).not.toContain('href="/finance');
      expect(primary(html)).not.toContain('href="/overview');
      expect(primary(html).match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  it("marks the portfolio or selected-event destination, never both", () => {
    const portfolio = shell("/events-admin", "EVENTS_ADMIN");
    expect(primary(portfolio).match(/aria-current="page"/g)).toHaveLength(1);
    expect(portfolio).not.toContain('id="event-picker"');
    const event = shell("/overview", "EVENTS_ADMIN");
    expect(primary(event).match(/aria-current="page"/g)).toHaveLength(1);
    expect(event).toContain('id="event-picker"');
    expect(event).toContain('href="/people?event=synthetic_event"');
  });

  it("uses the route workspace even when the remembered role belongs elsewhere", () => {
    const system = shell("/admin", "EVENTS_ADMIN");
    expect(primary(system)).not.toContain('href="/events-admin"');
    expect(primary(system).match(/aria-current="page"/g)).toHaveLength(1);
    const roleBar = system.split('aria-label="Admin role"')[1]?.split("</section>")[0];
    expect(roleBar).toContain('aria-current="page" class="admin-role-link" href="/admin-role/SYSTEM_ADMIN"');
  });

  it("does not offer unauthorized workspace or creation destinations", () => {
    const switcher = renderToStaticMarkup(h(StaffWorkspaceSwitcher, { held: ["CLUBS_ADMIN"], active: "clubs", counts: {}, eventId: "", hasEvents: false }));
    expect(switcher).toContain("Clubs");
    expect(switcher).not.toContain("/admin-role/SYSTEM_ADMIN");
    expect(switcher).not.toContain("/admin-role/EVENTS_ADMIN");
    expect(renderToStaticMarkup(h(StaffCreateMenu, { isSystemAdmin: false, clubFormsAccess: false, canManageForms: false, eventId: "" }))).toBe("");
    const forms = renderToStaticMarkup(h(StaffCreateMenu, { isSystemAdmin: false, clubFormsAccess: false, canManageForms: true, eventId: "synthetic_event" }));
    expect(forms).toContain('/registration-builder?event=synthetic_event');
    expect(forms).not.toContain('/event-setup');
  });

  it("limits desktop local tabs to this page's views or anchors", () => {
    expect(buildAdminSectionNav({ section: "system", pathname: "/admin/people" }).localTabs).toEqual([]);
    const home = buildAdminSectionNav({ section: "system", pathname: "/admin" });
    expect(home.localTabs?.every((tab) => tab.href.startsWith("#"))).toBe(true);
    expect(home.tabs.some((tab) => tab.href === "/admin/people")).toBe(true);
  });
});
