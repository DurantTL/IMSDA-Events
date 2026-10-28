// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("event=event_1"),
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", null, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";

const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.sidebar;
});

it("clips the brand and system labels when collapsed even with trailing navigation status spans", () => {
  const css = readFileSync("app/globals.css", "utf8");
  // Apply the real desktop clipping rule; jsdom does not evaluate media queries.
  const clippingRule = css.match(/html\[data-sidebar="collapsed"\] \.brand >[^{}]+\{[^{}]+\}/)?.[0];
  expect(clippingRule).toBeDefined();
  const style = document.createElement("style");
  style.textContent = clippingRule!;
  document.body.append(style);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(AppShellElement, {
    user: { displayName: "Synthetic Admin", email: "admin@example.test", globalRole: "SYSTEM_ADMIN" },
    events: [{ id: "event_1", slug: "demo", name: "Synthetic event", permissions: [] }],
  }, createElement("p", null, "Workspace")));
  document.body.append(host);

  for (const selector of [".brand", ".system-navigation-link"]) {
    const link = host.querySelector(selector)!;
    const label = link.querySelector("span:has(> strong)")!;
    const icon = link.firstElementChild!;
    expect(link.lastElementChild?.hasAttribute("data-navigation-pending")).toBe(true);
    document.documentElement.dataset.sidebar = "collapsed";
    expect(getComputedStyle(label).position).toBe("absolute");
    expect(getComputedStyle(label).width).toBe("1px");
    expect(getComputedStyle(label).clipPath).toBe("inset(50%)");
    expect(getComputedStyle(icon).width).not.toBe("1px");
    expect(link.textContent).toContain(label.textContent);
    document.documentElement.dataset.sidebar = "expanded";
    expect(getComputedStyle(label).width).not.toBe("1px");
  }
});
