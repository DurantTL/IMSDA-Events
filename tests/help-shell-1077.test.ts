import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/overview" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("event=event_1"),
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";
import type { EventPermission } from "@/modules/access/permissions";

/** The pinned Help & learning sidebar link and the topbar on /help (#1077). Synthetic data only. */

const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;

function render(pathname: string, permissions: EventPermission[], events = true) {
  route.pathname = pathname;
  return renderToStaticMarkup(
    createElement(
      AppShellElement,
      {
        events: events ? [{ id: "event_1", slug: "synthetic-retreat", name: "Synthetic Retreat", permissions }] : [],
        user: { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null },
      },
      createElement("p", null, "Workspace content"),
    ),
  );
}

const nav = (markup: string) => markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf('class="sidebar-foot"'));
const activeItems = (markup: string) => [...nav(markup).matchAll(/<a [^>]*class="nav-item active"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)].map((match) => match[1]);

describe("Help & learning in the shell", () => {
  it("pins one Help & learning link after the other items, for staff with only check-in", () => {
    const markup = nav(render("/overview", ["MANAGE_CHECK_IN"]));
    expect(markup.match(/Help &amp; learning/g)).toHaveLength(1);
    expect(markup).toContain('href="/help?event=event_1"');
    expect(markup.lastIndexOf("Help &amp; learning")).toBeGreaterThan(markup.lastIndexOf("Check-in"));
  });

  it("lights only Help & learning on /help and below, never the Dashboard", () => {
    expect(activeItems(render("/help", ["VIEW_EVENT", "MANAGE_CHECK_IN"]))).toEqual(["Help &amp; learning"]);
    expect(activeItems(render("/help/invite-staff", ["VIEW_EVENT"]))).toEqual(["Help &amp; learning"]);
    expect(activeItems(render("/overview", ["VIEW_EVENT"]))).toEqual(["Dashboard"]);
  });

  it("titles the topbar and keeps Help & learning for staff with no event, without event controls", () => {
    const markup = render("/help", [], false);
    expect(markup).toContain("<h1>Help &amp; learning</h1>");
    expect(activeItems(markup)).toEqual(["Help &amp; learning"]);
    expect(markup).not.toContain('id="event-picker"');
    expect(render("/help/glossary", ["VIEW_EVENT"])).toContain("<h1>Glossary</h1>");
  });
});
