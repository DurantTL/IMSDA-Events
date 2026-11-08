import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { buildHubView, neededMetrics, type HubViewer } from "@/modules/system-admin/admin-hubs-model";

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
  it("keeps the header's Create chooser a labelled secondary button, never a filled primary", () => {
    for (const path of ["/home", "/admin", "/admin/clubs", "/admin/events", "/overview", "/registrations", "/check-in", "/money"]) {
      const html = shell(path, "content");
      const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      expect(header, path).toMatch(/<button type="button" class="secondary-button [^"]*" aria-haspopup="dialog">/);
      expect(header, path).toMatch(/Create<\/button>/);
      expect(html.match(filledPrimary) ?? [], path).toHaveLength(0);
    }
  });

  it("draws a hub's main action filled only when it is primary, and as a plain link otherwise", () => {
    const render = (primary: boolean | undefined) => renderToStaticMarkup(createElement(AdminHub, {
      view: { key: "clubs", description: "Intro text for the hub.", stats: [], groups: [], action: { href: "/x", label: "Do it", primary } },
    }));
    const filled = (html: string) => /class="[^"]*_action_[^"]*"/.test(html) && !/_actionQuiet_/.test(html);
    expect(filled(render(true))).toBe(true);
    expect(filled(render(undefined))).toBe(true);
    expect(render(false)).toMatch(/_actionQuiet_/);
    expect(render(false)).toContain('data-primary="false"');
  });

  it("shows no filled action on a hub with nothing waiting", () => {
    const idle = renderToStaticMarkup(createElement(AdminHub, { view: buildHubView("clubs", system, Object.fromEntries(neededMetrics("clubs", system).map((key) => [key, 0]))) }));
    expect(idle).toContain('data-primary="false"');
    expect(idle).not.toContain('data-primary="true"');
    const busy = renderToStaticMarkup(createElement(AdminHub, { view: buildHubView("clubs", system, Object.fromEntries(neededMetrics("clubs", system).map((key) => [key, 2]))) }));
    expect(busy).toContain('data-primary="true"');
  });

  it("keeps the Club administration page's own Manage event link secondary", () => {
    expect(readFileSync(join(process.cwd(), "app/(workspace)/admin/clubs/page.tsx"), "utf8")).not.toMatch(/primary-button/);
  });
});
