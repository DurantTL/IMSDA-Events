// @vitest-environment jsdom
import { act, createElement, Fragment, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/overview" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
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

const builder = vi.hoisted(() => ({ model: null as unknown }));
vi.mock("@/components/registration-builder/builder-context", () => ({ useBuilder: () => builder.model }));

import { ContextualHelp } from "@/components/contextual-help";
import { MoreLauncher } from "@/components/more-launcher";
import { SystemPhoneMenu } from "@/components/system-phone-menu";
import { BuilderSaveQuestionDialog } from "@/components/registration-builder/builder-save-question";
import { PhoneSheet } from "@/components/registration-builder/builder-phone-sheet";
import { usePhoneModal } from "@/components/registration-builder/use-phone-modal";
import { openDialogCount, useAccessibleDialog, type AccessibleDialogOptions } from "@/components/use-accessible-dialog";
import { buildMoreDirectoryCards } from "@/components/staff-navigation";
import { forgetLauncherPosition, rememberLauncherPosition } from "@/components/more-launcher-model";
import { eventPermissions } from "@/modules/access/permissions";
import { click, flush, mount, type Mounted } from "./helpers/dom-render";

/**
 * The five dialogs that used their own keyboard code now run on the shared accessible-dialog hook (#1354): Escape closes
 * each, Tab and Shift+Tab stay inside, and focus goes back to the opener (except where it must not). The hook's new
 * options are unit-tested with defaults unchanged. Synthetic data only.
 */

beforeAll(() => {
  // jsdom has no layout: say every element takes up room, and give <dialog> the modal methods it lacks.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  HTMLElement.prototype.getClientRects = function getClientRects() { return [{}] as unknown as DOMRectList; };
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
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
  return event;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const focusOn = (element: Element) => { (element as HTMLElement).focus(); };

beforeEach(() => {
  forgetLauncherPosition();
  nav.pathname = "/overview";
  document.body.innerHTML = "";
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  expect(openDialogCount()).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// The hook's options
// ---------------------------------------------------------------------------------------------------------------------

function Harness({ open, onClose, options, inner }: { open: boolean; onClose: () => void; options?: AccessibleDialogOptions; inner?: boolean }) {
  const ref = useAccessibleDialog<HTMLDivElement>(open, onClose, options);
  return createElement(Fragment, null,
    createElement("button", { id: "opener", type: "button" }, "Open"),
    createElement("button", { id: "elsewhere", type: "button" }, "Elsewhere"),
    open && createElement("div", { id: "dlg", ref, tabIndex: -1, "data-testid": "dlg" },
      createElement("button", { id: "first", type: "button" }, "First"),
      createElement("input", { id: "name" }),
      inner ? createElement("button", { id: "last", type: "button", onKeyDown: (event: { preventDefault(): void }) => event.preventDefault() }, "Last")
        : createElement("button", { id: "last", type: "button" }, "Last")),
  );
}

async function openHarness(options?: AccessibleDialogOptions, inner = false) {
  const onClose = vi.fn();
  const view = await show(createElement(Harness, { open: false, onClose, options, inner }));
  focusOn(byId("opener"));
  await act(async () => { view.root.render(createElement(Harness, { open: true, onClose, options, inner })); });
  await frame();
  return { onClose, view, close: async () => { await act(async () => { view.root.render(createElement(Harness, { open: false, onClose, options, inner })); }); await frame(); } };
}

describe("useAccessibleDialog options (#1354)", () => {
  it("defaults are unchanged: first focusable, Escape closes, Tab wraps, focus returns to the opener", async () => {
    const { onClose, close } = await openHarness();
    expect(document.activeElement).toBe(byId("first"));
    focusOn(byId("last"));
    await press("Tab");
    expect(document.activeElement).toBe(byId("first"));
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(byId("last"));
    await press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    await close();
    expect(document.activeElement).toBe(byId("opener"));
  });

  it("pulls focus back in when it fell to the page, and Escape acts even on an event something already prevented", async () => {
    const { onClose } = await openHarness(undefined, true);
    focusOn(byId("elsewhere"));
    await press("Tab");
    expect(document.activeElement).toBe(byId("first"));
    focusOn(byId("last"));
    const event = await press("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Tab inside when focus rests on the dialog itself", async () => {
    const { } = await openHarness({ initialFocus: "dialog" });
    expect(document.activeElement).toBe(byId("dlg"));
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(byId("last"));
  });

  it("initialFocus: a function chooses the element, and falls back to the default when it returns nothing", async () => {
    await openHarness({ initialFocus: () => byId("name") });
    expect(document.activeElement).toBe(byId("name"));
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await openHarness({ initialFocus: () => null });
    expect(document.activeElement).toBe(byId("first"));
  });

  it("returnFocus: read at close time; it can name another element or leave focus alone", async () => {
    let target: string | null = "elsewhere";
    const { close } = await openHarness({ returnFocus: () => (target ? byId(target) : null) });
    await close();
    expect(document.activeElement).toBe(byId("elsewhere"));

    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    target = null;
    const second = await openHarness({ returnFocus: () => (target ? byId(target) : null) });
    focusOn(byId("name"));
    await second.close();
    expect(document.activeElement).not.toBe(byId("opener"));
  });

  it("skipHandled: ignores Escape (and, with 'all', Tab) that something inside already prevented", async () => {
    const escapeOnly = await openHarness({ skipHandled: "escape" }, true);
    focusOn(byId("last"));
    await press("Escape");
    expect(escapeOnly.onClose).not.toHaveBeenCalled();
    // Tab on "last" is prevented by the inner handler but the dialog still wraps it under "escape".
    await press("Tab");
    expect(document.activeElement).toBe(byId("first"));
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";

    const all = await openHarness({ skipHandled: "all" }, true);
    focusOn(byId("last"));
    await press("Tab");
    expect(document.activeElement).toBe(byId("last"));
    await press("Escape");
    expect(all.onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 1. Contextual help (a native <dialog>)
// ---------------------------------------------------------------------------------------------------------------------

const help = { title: "Registering a club", summary: "A short guide.", steps: ["Open the form.", "Fill it in."], fullHref: "/help/clubs" } as unknown as ComponentProps<typeof ContextualHelp>["help"];

describe("contextual help dialog", () => {
  async function openHelp() {
    const view = await show(createElement(ContextualHelp, { help }));
    const trigger = view.container.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    focusOn(trigger);
    await click(trigger);
    await frame();
    return { trigger, dialog: view.container.querySelector("dialog")! };
  }

  it("stays a native modal dialog and opens with showModal", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { dialog } = await openHelp();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(openDialogCount()).toBe(1);
    showModal.mockRestore();
  });

  it("Escape closes it once and focus returns to the Help button", async () => {
    const { trigger, dialog } = await openHelp();
    await press("Escape");
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("the native cancel event is stopped and closes through state", async () => {
    const { trigger, dialog } = await openHelp();
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => { dialog.dispatchEvent(cancel); });
    await frame();
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Close closes it, Tab and Shift+Tab stay between its two controls, and it can reopen", async () => {
    const { trigger, dialog } = await openHelp();
    const link = dialog.querySelector<HTMLElement>("a")!;
    const close = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Close")!;
    expect(document.activeElement).toBe(link);
    focusOn(close);
    await press("Tab");
    expect(document.activeElement).toBe(link);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(close);
    await click(close);
    await frame();
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    await frame();
    expect(dialog.hasAttribute("open")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. Save to library
// ---------------------------------------------------------------------------------------------------------------------

describe("save-to-library dialog", () => {
  function model(target: { fieldId: string } | null, setLibraryTarget = vi.fn()) {
    builder.model = {
      libraryTarget: target, setLibraryTarget, eventId: "event_1", information: null, setNotice: vi.fn(), setLibraryRefresh: vi.fn(),
      definition: { title: "Sample", description: "", confirmationMessage: "", sections: [{ id: "s", title: "S", description: "", fields: [
        { id: "f1", key: "q1", label: "Sample question", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
      ] }] },
    };
    return setLibraryTarget;
  }
  const dialogElement = () => document.querySelector<HTMLElement>("[role='dialog']")!;

  async function openSave() {
    const setTarget = model(null);
    const view = await show(createElement(Fragment, null, createElement("button", { id: "opener", type: "button" }, "Save to library"), createElement(BuilderSaveQuestionDialog)));
    focusOn(byId("opener"));
    model({ fieldId: "f1" }, setTarget);
    await act(async () => { view.root.render(createElement(Fragment, null, createElement("button", { id: "opener", type: "button" }, "Save to library"), createElement(BuilderSaveQuestionDialog))); });
    await frame();
    return { setTarget, view };
  }

  it("focus lands on the name field, not the close button", async () => {
    await openSave();
    expect(document.activeElement).toBe(document.querySelector("input[name='builder-library-name']"));
  });

  it("Escape closes it", async () => {
    const { setTarget } = await openSave();
    await press("Escape");
    expect(setTarget).toHaveBeenCalledWith(null);
  });

  it("Tab and Shift+Tab stay inside", async () => {
    await openSave();
    const focusable = [...dialogElement().querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea")];
    focusOn(focusable.at(-1)!);
    await press("Tab");
    expect(document.activeElement).toBe(focusable[0]);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(focusable.at(-1));
  });

  it("returns focus to the opener once it closes", async () => {
    const { view } = await openSave();
    model(null);
    await act(async () => { view.root.render(createElement(Fragment, null, createElement("button", { id: "opener", type: "button" }, "Save to library"), createElement(BuilderSaveQuestionDialog))); });
    await frame();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(byId("opener"));
  });

  it("keeps the guard: Escape does nothing while a save is running", async () => {
    const { setTarget } = await openSave();
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const save = [...dialogElement().querySelectorAll("button")].find((button) => button.textContent === "Save to library")!;
    await click(save);
    await press("Escape");
    expect(setTarget).not.toHaveBeenCalled();
    release(new Response(JSON.stringify({}), { status: 500 }));
    await frame();
    vi.unstubAllGlobals();
  });
});

function Fallback({ active, hasOpener, fallback }: { active: boolean; hasOpener: boolean; fallback: () => void }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ref = useMemo(() => ({ current: node }), [node]);
  usePhoneModal({ active, ref, onClose: () => {}, fallback, fit: false });
  return createElement(Fragment, null,
    hasOpener && createElement("button", { id: "gone", type: "button" }, "x"),
    createElement("div", { id: "sheet", tabIndex: -1, ref: setNode }));
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Phone builder sheet
// ---------------------------------------------------------------------------------------------------------------------

describe("phone builder sheet", () => {
  async function openSheet(onClose = vi.fn()) {
    const view = await show(createElement("button", { id: "opener", type: "button" }, "More"));
    focusOn(byId("opener"));
    await act(async () => { view.root.render(createElement(Fragment, null,
      createElement("button", { id: "opener", type: "button" }, "More"),
      createElement(PhoneSheet, { title: "More", onClose, variant: "menu" } as unknown as ComponentProps<typeof PhoneSheet>, createElement("button", { id: "a", type: "button", "data-autofocus": "" }, "A"), createElement("button", { id: "b", type: "button" }, "B")))); });
    await frame();
    return { onClose, view };
  }

  it("focuses the marked control, closes on Escape, and keeps Tab inside", async () => {
    const { onClose } = await openSheet();
    expect(document.activeElement).toBe(byId("a"));
    expect(openDialogCount()).toBe(1);
    const panel = document.querySelector<HTMLElement>("[role='dialog']")!;
    const stops = [...panel.querySelectorAll<HTMLElement>("button")];
    focusOn(stops.at(-1)!);
    await press("Tab");
    expect(document.activeElement).toBe(stops[0]);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(stops.at(-1));
    focusOn(panel);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(stops.at(-1));
    await press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an inner picker that took Escape (prevented it) keeps the sheet open", async () => {
    const { onClose } = await openSheet();
    const stop = (event: Event) => event.preventDefault();
    byId("b").addEventListener("keydown", stop);
    focusOn(byId("b"));
    await press("Escape");
    expect(onClose).not.toHaveBeenCalled();
    byId("b").removeEventListener("keydown", stop);
  });

  it("gives focus back to the opener, or to the fallback when the opener is gone", async () => {
    const { view } = await openSheet();
    await act(async () => { view.root.render(createElement("button", { id: "opener", type: "button" }, "More")); });
    await frame();
    expect(document.activeElement).toBe(byId("opener"));

    const fallback = vi.fn();
    await mounted?.unmount();
    mounted = await mount(createElement(Fallback, { active: false, hasOpener: true, fallback }));
    focusOn(byId("gone"));
    await act(async () => { mounted!.root.render(createElement(Fallback, { active: true, hasOpener: true, fallback })); });
    await act(async () => { mounted!.root.render(createElement(Fallback, { active: true, hasOpener: false, fallback })); });
    await act(async () => { mounted!.root.render(createElement(Fallback, { active: false, hasOpener: false, fallback })); });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. System phone menu
// ---------------------------------------------------------------------------------------------------------------------

const systemGroups = [{ key: "g", label: "People", items: [
  { key: "a", label: "People & access", href: "/admin/people", description: "", active: false },
  { key: "b", label: "Calendar", href: "/admin/calendar", description: "", active: false },
] }] as unknown as ComponentProps<typeof SystemPhoneMenu>["groups"];
const destinations = [{ key: "d1", scope: "System", label: "Invite staff", description: "", href: "/admin/people", keywords: [] }] as unknown as ComponentProps<typeof SystemPhoneMenu>["destinations"];

describe("system phone menu", () => {
  async function openMenu() {
    const view = await show(createElement(SystemPhoneMenu, { isSystemAdmin: true, groups: systemGroups, switches: [], destinations }));
    const trigger = view.container.querySelector<HTMLAnchorElement>(".mobile-nav-system-trigger")!;
    focusOn(trigger);
    await click(trigger);
    await frame();
    return { trigger, sheet: document.querySelector<HTMLElement>(".system-menu")! };
  }

  it("focus starts on the sheet itself, not the search field", async () => {
    const { sheet } = await openMenu();
    expect(document.activeElement).toBe(sheet);
    expect(openDialogCount()).toBe(1);
  });

  it("Escape closes it and focus returns to the trigger", async () => {
    const { trigger } = await openMenu();
    await press("Escape");
    expect(document.querySelector(".system-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Close returns focus, but following a link does not", async () => {
    const { trigger, sheet } = await openMenu();
    await click(sheet.querySelector(".system-menu-close")!);
    await frame();
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    await frame();
    focusOn(document.body);
    await click(document.querySelector(".system-menu-item")!);
    await frame();
    expect(document.querySelector(".system-menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("Tab and Shift+Tab stay inside, including from the sheet itself", async () => {
    const { sheet } = await openMenu();
    const stops = [...sheet.querySelectorAll<HTMLElement>("input, a[href], button")];
    focusOn(stops.at(-1)!);
    await press("Tab");
    expect(document.activeElement).toBe(stops[0]);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(stops.at(-1));
    focusOn(sheet);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(stops.at(-1));
  });

  it("an Escape the search handles (closing its list, then clearing it) does not close the sheet; an empty one does", async () => {
    const { sheet, trigger } = await openMenu();
    const input = sheet.querySelector<HTMLInputElement>("input")!;
    focusOn(input);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "invite"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await press("Escape");
    expect(document.querySelector(".system-menu")).not.toBeNull();
    await press("Escape");
    expect(document.querySelector(".system-menu")).not.toBeNull();
    expect(input.value).toBe("");
    await press("Escape");
    expect(document.querySelector(".system-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("an outside press closes it without taking focus, and a back/forward step does too", async () => {
    const { trigger } = await openMenu();
    focusOn(byId("elsewhere") ?? document.body);
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await frame();
    expect(document.querySelector(".system-menu")).toBeNull();
    expect(trigger.isConnected).toBe(true);
    await click(trigger);
    await frame();
    await act(async () => { window.dispatchEvent(new Event("popstate")); });
    await frame();
    expect(document.querySelector(".system-menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 5. More launcher
// ---------------------------------------------------------------------------------------------------------------------

const cards = buildMoreDirectoryCards({
  permissions: eventPermissions, clubOversight: true, clubEvent: true, isSystemAdmin: false, clubFormsAccess: true, eventQuery: "?event=event_1", hiddenCardKeys: new Set(),
});

describe("More launcher", () => {
  async function openLauncher(variant: "tab" | "sidebar", extra: Partial<ComponentProps<typeof MoreLauncher>> = {}) {
    const props = { variant, href: "/more", isActive: false, cards, isSystemAdmin: false, eventQuery: "?event=event_1", userId: "user_1", ...extra };
    const view = await show(createElement(MoreLauncher, props as ComponentProps<typeof MoreLauncher>, "More"));
    const trigger = view.container.querySelector<HTMLAnchorElement>("a[aria-haspopup='dialog']")!;
    focusOn(trigger);
    await click(trigger);
    await frame();
    return { trigger, panel: document.querySelector<HTMLElement>(".more-launcher")! };
  }
  const links = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>("input.destination-search-input, input.more-launcher-search-input, a[href], button.more-launcher-toggle:not([disabled])")];

  it("phone sheet: opens on the first link, Escape closes it and returns focus to the trigger", async () => {
    const { trigger, panel } = await openLauncher("tab");
    expect(document.activeElement).toBe(panel.querySelector("a[href]"));
    expect(openDialogCount()).toBe(1);
    await press("Escape");
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("phone sheet: Tab and Shift+Tab walk the links in a loop, and arrows move through them", async () => {
    const { panel } = await openLauncher("tab");
    const items = links(panel);
    focusOn(items.at(-1)!);
    await press("Tab");
    expect(document.activeElement).toBe(items[0]);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(items.at(-1));
    focusOn(items[0]);
    await press("ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    await press("End");
    expect(document.activeElement).toBe(items.at(-1));
    // Tab from the sheet itself (nothing focused inside) still enters the loop.
    focusOn(panel);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(items.at(-1));
  });

  it("phone sheet: an outside press or following a link closes it without taking focus", async () => {
    const { trigger } = await openLauncher("tab");
    focusOn(document.body);
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await frame();
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);

    await click(trigger);
    await frame();
    await act(async () => { window.dispatchEvent(new Event("popstate")); });
    await frame();
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("phone sheet: clicking the trigger again closes it and returns focus", async () => {
    const { trigger } = await openLauncher("tab");
    await click(trigger);
    await frame();
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("phone sheet: the remembered card takes focus, and Escape forgets it", async () => {
    const card = cards.find((entry) => entry.allowed)!;
    rememberLauncherPosition({ userId: "user_1", eventQuery: "?event=event_1", cardKey: card.key, href: "/overview", scrollTop: 0 });
    const { panel } = await openLauncher("tab");
    expect((document.activeElement as HTMLElement).dataset.card).toBe(card.key);
    expect(panel.contains(document.activeElement)).toBe(true);
    await press("Escape");
    const again = await (async () => { const trigger = document.querySelector<HTMLAnchorElement>("a[aria-haspopup='dialog']")!; await click(trigger); await frame(); return document.querySelector<HTMLElement>(".more-launcher")!; })();
    expect(document.activeElement).toBe(again.querySelector("a[href]"));
  });

  it("phone sheet: Escape in a typed search clears it first; the next Escape closes", async () => {
    const { panel, trigger } = await openLauncher("tab");
    const input = panel.querySelector<HTMLInputElement>("input.more-launcher-search-input")!;
    focusOn(input);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "reg"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await press("Escape");
    expect(document.querySelector(".more-launcher")).not.toBeNull();
    expect(input.value).toBe("");
    await press("Escape");
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("phone sheet: the Turn-off confirm owns Escape and Tab while it is open", async () => {
    const { panel } = await openLauncher("tab", { isSystemAdmin: true, eventId: "event_1", removableModules: cards.map((entry) => entry.key) });
    const toggle = panel.querySelector<HTMLButtonElement>("button.more-launcher-toggle");
    expect(toggle).not.toBeNull();
    if (!toggle) return;
    focusOn(toggle);
    await click(toggle);
    await frame();
    const confirm = document.querySelector<HTMLElement>("[role='alertdialog']")!;
    const [cancel, turnOff] = [...confirm.querySelectorAll<HTMLButtonElement>("button")];
    expect(document.activeElement).toBe(cancel);
    await press("Tab");
    expect(document.activeElement).toBe(turnOff);
    await press("Tab");
    expect(document.activeElement).toBe(cancel);
    await press("Escape");
    expect(document.querySelector("[role='alertdialog']")).toBeNull();
    expect(document.querySelector(".more-launcher")).not.toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("desktop popover is not modal: it keeps its own handling (search first, Escape returns focus, no dialog stack)", async () => {
    const { trigger, panel } = await openLauncher("sidebar");
    expect(panel.getAttribute("aria-modal")).toBeNull();
    expect(openDialogCount()).toBe(0);
    expect(document.activeElement).toBe(panel.querySelector("input.more-launcher-search-input"));
    await press("Escape");
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("desktop popover: an outside press closes it without taking focus", async () => {
    const { trigger } = await openLauncher("sidebar");
    focusOn(document.body);
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await frame();
    expect(document.querySelector(".more-launcher")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });
});
