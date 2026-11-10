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

const topbar = (markup: string) => markup.slice(markup.indexOf("<header"), markup.indexOf("</header>"));
const rail = (markup: string) => markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf("</nav>", markup.indexOf('id="primary-navigation"')));
const helpLit = (markup: string) => /aria-label="Help &amp; learning" aria-current="page"/.test(topbar(markup));
const currentTabs = (markup: string) => [...(markup.split('data-staff-tabs="true"')[1]?.split("</nav>")[0] ?? "").matchAll(/<a aria-current="page"[^>]*>([^<]+)</g)].map((match) => match[1]);

describe("Help & learning in the shell", () => {
  it("draws one Help & learning link in the header, for staff with only check-in", () => {
    const markup = render("/overview", ["MANAGE_CHECK_IN"]);
    expect(topbar(markup).match(/Help &amp; learning/g)?.length).toBeGreaterThanOrEqual(1);
    expect(topbar(markup)).toContain('href="/help?event=event_1"');
    expect(rail(markup)).not.toContain("Help &amp; learning");
    expect(markup.match(/href="\/help\?event=event_1"/g)).toHaveLength(1);
  });

  it("lights only Help & learning on /help and below, and no tab, never Event home", () => {
    for (const path of ["/help", "/help/invite-staff"]) {
      const markup = render(path, ["VIEW_EVENT", "MANAGE_CHECK_IN"]);
      expect(helpLit(markup)).toBe(true);
      expect(currentTabs(markup)).toEqual([]);
    }
    const overview = render("/overview", ["VIEW_EVENT"]);
    expect(helpLit(overview)).toBe(false);
    expect(currentTabs(overview)).toEqual(["Event home"]);
  });

  it("titles the topbar and keeps Help & learning for staff with no event, without event controls", () => {
    const markup = render("/help", [], false);
    expect(markup).toMatch(/<h1[^>]*>Help &amp; learning<\/h1>/);
    expect(helpLit(markup)).toBe(true);
    expect(markup).not.toContain('id="event-picker"');
    expect(render("/help/glossary", ["VIEW_EVENT"])).toMatch(/<h1[^>]*>Glossary<\/h1>/);
  });
});
