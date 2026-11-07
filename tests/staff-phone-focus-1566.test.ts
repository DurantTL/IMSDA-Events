// @vitest-environment jsdom
import { act, createElement, Fragment, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", async () => {
  const react = await import("react");
  const Link = react.forwardRef<HTMLAnchorElement, { href: string; children?: unknown } & Record<string, unknown>>(
    function MockLink({ href, children, ...rest }, ref) {
      const dom = Object.fromEntries(Object.entries(rest).filter(([key]) => !["replace", "scroll", "prefetch"].includes(key)));
      return react.createElement("a", { ref, href, ...dom }, children as ReactNode);
    },
  );
  return { default: Link, useLinkStatus: () => ({ pending: false }) };
});
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => createElement("button", { type: "button" }, "Sign out") }));

import { MoreLauncher } from "@/components/more-launcher";
import { StaffAccountMenu } from "@/components/staff-account-menu";
import { StaffKeyboardWatch } from "@/components/staff-keyboard-watch";
import { StaffMenuDialog } from "@/components/staff-menu-dialog";
import { buildMoreDirectoryCards } from "@/components/staff-navigation";
import { forgetLauncherPosition } from "@/components/more-launcher-model";
import { openDialogCount } from "@/components/use-accessible-dialog";
import { eventPermissions } from "@/modules/access/permissions";
import { click, flush, mount, type Mounted } from "./helpers/dom-render";

/**
 * Behavior of the staff sheets on a phone (#1566): each has a visible title and a Close button, takes focus in, keeps Tab
 * inside, closes on Escape or Close and hands focus back, including when the keyboard watch had the bottom bar out of the way.
 * Synthetic data only.
 */

beforeAll(() => {
  // jsdom has no layout: say every element takes up room.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  HTMLElement.prototype.getClientRects = function getClientRects() { return [{}] as unknown as DOMRectList; };
});

let mounted: Mounted | null = null;
const frame = () => flush(40);
async function show(element: ReturnType<typeof createElement>) {
  mounted = await mount(element);
  await frame();
  return mounted;
}
async function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(event); });
  await frame();
}
const focusOn = (element: Element) => { (element as HTMLElement).focus(); };

beforeEach(() => {
  forgetLauncherPosition();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-keyboard");
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  expect(openDialogCount()).toBe(0);
});

const cards = buildMoreDirectoryCards({
  permissions: eventPermissions, clubOversight: true, clubEvent: true, isSystemAdmin: false, clubFormsAccess: true, eventQuery: "?event=event_1", hiddenCardKeys: new Set(),
});

describe("the More sheet with the keyboard watch (#1566)", () => {
  async function openSheet() {
    const props = { variant: "tab", href: "/more", isActive: false, cards, isSystemAdmin: false, eventQuery: "?event=event_1", userId: "user_1" };
    const view = await show(createElement(Fragment, null,
      createElement(StaffKeyboardWatch),
      createElement("nav", { className: "mobile-nav" }, createElement(MoreLauncher, props as ComponentProps<typeof MoreLauncher>, "More")),
    ));
    const trigger = view.container.querySelector<HTMLAnchorElement>("a[aria-haspopup='dialog']")!;
    focusOn(trigger);
    await click(trigger);
    await frame();
    return { trigger, panel: document.querySelector<HTMLElement>(".more-launcher")! };
  }

  it("has a visible title and a Close button that closes it and returns focus to More", async () => {
    const { trigger, panel } = await openSheet();
    expect(panel.getAttribute("role")).toBe("dialog");
    const title = document.getElementById(panel.getAttribute("aria-labelledby")!)!;
    expect(title.textContent).toBe("More");
    const close = panel.querySelector<HTMLButtonElement>("button.more-launcher-close")!;
    expect(close.textContent).toContain("Close");
    await click(close);
    await frame();
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  // jsdom loads no stylesheet, so this proves the focus and keyboard-mark sequence only. That the bar stays focusable while
  // the mark is set (no display:none) is guarded by the CSS check in tests/staff-phone-ipad-1566.test.ts.
  it("Escape from the focused search box twice closes it, clears the keyboard mark and puts focus on the More button", async () => {
    const { trigger, panel } = await openSheet();
    const search = panel.querySelector<HTMLInputElement>("input.more-launcher-search-input")!;
    focusOn(search);
    await act(async () => { search.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(document.documentElement.getAttribute("data-keyboard")).toBe("open");
    await press("Escape");
    await press("Escape");
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await frame();
    expect(document.documentElement.hasAttribute("data-keyboard")).toBe(false);
  });
});

describe("the keyboard watch (#1566)", () => {
  it("marks the page while a text field has focus, and not for a checkbox", async () => {
    await show(createElement(Fragment, null,
      createElement(StaffKeyboardWatch),
      createElement("input", { id: "text", type: "text" }),
      createElement("input", { id: "box", type: "checkbox" }),
    ));
    const root = document.documentElement;
    focusOn(document.getElementById("text")!);
    expect(root.getAttribute("data-keyboard")).toBe("open");
    focusOn(document.getElementById("box")!);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    focusOn(document.getElementById("text")!);
    (document.activeElement as HTMLElement).blur();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });

  it("looks again on pageshow and when the tab becomes visible, so a stale mark never keeps the bar away", async () => {
    await show(createElement(StaffKeyboardWatch));
    const root = document.documentElement;
    for (const resume of [() => window.dispatchEvent(new Event("pageshow")), () => document.dispatchEvent(new Event("visibilitychange"))]) {
      root.setAttribute("data-keyboard", "open");
      await act(async () => { resume(); });
      expect(root.hasAttribute("data-keyboard")).toBe(false);
    }
  });

  it("removes the mark when it unmounts", async () => {
    const view = await show(createElement(Fragment, null, createElement(StaffKeyboardWatch), createElement("input", { id: "text" })));
    focusOn(document.getElementById("text")!);
    expect(document.documentElement.hasAttribute("data-keyboard")).toBe(true);
    await view.unmount();
    mounted = null;
    expect(document.documentElement.hasAttribute("data-keyboard")).toBe(false);
  });
});

describe("the account menu and workspace switcher (#1566)", () => {
  const workspaces = [
    { kind: "system_admin", label: "System management", href: "/admin", method: "get", current: false },
    { kind: "staff_workspace", label: "Staff workspace", href: "/overview", method: "get", current: true },
  ] as never;
  async function openMenu() {
    const view = await show(createElement(StaffAccountMenu, { attendeePreviewHref: "/account", displayName: "Synthetic Admin", email: "synthetic@imsda-events.test", workspaces }));
    const trigger = view.container.querySelector<HTMLButtonElement>("button[aria-label='Staff account']")!;
    focusOn(trigger);
    await click(trigger);
    await frame();
    return { trigger, dialog: document.getElementById("staff-account-menu")! };
  }

  it("is a labelled dialog that takes focus in, keeps Tab inside, and closes with Escape or Close, returning focus", async () => {
    const { trigger, dialog } = await openMenu();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("Your account");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.textContent).toContain("Switch workspace");
    const stops = [...dialog.querySelectorAll<HTMLElement>("a[href], button")];
    focusOn(stops.at(-1)!);
    await press("Tab");
    expect(document.activeElement).toBe(stops[0]);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(stops.at(-1));
    await press("Escape");
    expect(document.getElementById("staff-account-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    await frame();
    await click(document.querySelector<HTMLButtonElement>("#staff-account-menu [data-account-close]")!);
    await frame();
    expect(document.getElementById("staff-account-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("the menu-line dialog (#1566)", () => {
  it("has a visible title and Close, focuses the current item, keeps Tab inside and returns focus on Escape", async () => {
    const tabs = [
      { key: "a", label: "Event home", href: "/overview", current: true },
      { key: "b", label: "Registrations", href: "/people" },
    ];
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    focusOn(opener);
    const onClose = vi.fn();
    await show(createElement(StaffMenuDialog, { title: "Event menu", titleId: "menu-title", tabs: tabs as never, onClose, returnTo: { current: opener } }));
    const dialog = document.querySelector<HTMLElement>("[data-staff-menu]")!;
    expect(document.getElementById("menu-title")!.textContent).toBe("Event menu");
    expect(dialog.textContent).toContain("Close");
    const stops = [...dialog.querySelectorAll<HTMLElement>("a[href], button")];
    focusOn(stops.at(-1)!);
    await press("Tab");
    expect(document.activeElement).toBe(stops[0]);
    await press("Escape");
    expect(onClose).toHaveBeenCalled();
  });
});
