import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navState = vi.hoisted(() => ({ pathname: "/admin", search: "event=evt_one" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navState.search),
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AdminHub } from "@/components/admin-hub";
import { AppShell } from "@/components/app-shell";
import { eventPermissions } from "@/modules/access/permissions";
import { buildHubView, neededMetrics, type AdminHubKey, type HubViewer } from "@/modules/system-admin/admin-hubs-model";

/** One filled primary button per staff view (#1733). Synthetic data only. */

const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
const filledPrimary = /class="[^"]*\bprimary-button\b/g;

function shell(pathname: string, body: string) {
  navState.pathname = pathname;
  return renderToStaticMarkup(createElement(AppShellElement, {
    events: [{ id: "evt_one", slug: "one", name: "Synthetic Event One", permissions: eventPermissions }],
    user: { displayName: "Synthetic Admin", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" },
    defaultEventId: "evt_one",
  }, createElement("p", null, body)));
}

const system: HubViewer = { isSystemAdmin: true, clubsAdmin: false, siteContentEditor: false };

describe("one filled primary button per staff view", () => {
  it("keeps the header's Create chooser quiet on every staff page, so a page's own action is the only filled button", () => {
    for (const path of ["/home", "/admin", "/admin/clubs", "/admin/events", "/overview", "/registrations", "/check-in", "/money"]) {
      const html = shell(path, "content");
      const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      expect(header, path).toContain("Create");
      expect(header.match(filledPrimary) ?? [], `${path} header`).toHaveLength(0);
      expect(html.match(filledPrimary) ?? [], path).toHaveLength(0);
    }
  });

  it("makes the Create chooser a visible-label secondary button", () => {
    const html = shell("/home", "content");
    expect(html).toMatch(/<button type="button" class="secondary-button [^"]*" aria-haspopup="dialog">/);
    expect(html).toMatch(/Create<\/button>/);
  });

  it("gives each hub at most one filled action, and none when nothing is waiting", () => {
    for (const hub of ["events", "clubs", "people", "forms", "catalogs"] as AdminHubKey[]) {
      for (const value of [0, 2]) {
        const values = Object.fromEntries(neededMetrics(hub, system).map((key) => [key, value]));
        const html = renderToStaticMarkup(createElement(AdminHub, { view: buildHubView(hub, system, values) }));
        expect(html.match(/data-primary="true"/g)?.length ?? 0, `${hub} ${value}`).toBeLessThanOrEqual(1);
        expect(html.match(filledPrimary) ?? [], hub).toHaveLength(0);
      }
    }
    const idle = renderToStaticMarkup(createElement(AdminHub, { view: buildHubView("clubs", system, Object.fromEntries(neededMetrics("clubs", system).map((key) => [key, 0]))) }));
    expect(idle).toContain('data-primary="false"');
    expect(idle).not.toContain('data-primary="true"');
  });
});
