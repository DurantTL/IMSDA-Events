// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/communications",
}));

import { TabList, TabPanel } from "@/components/dashboard-tabs";
import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { CommunicationsWorkspace } from "@/components/communications-workspace";
import { BuilderSidebar } from "@/components/registration-builder/builder-sidebar";
import { DEFAULT_EDITOR_LAYOUT } from "@/components/registration-builder/editor-layout";
import { mount, click, type Mounted } from "./helpers/dom-render";

/** The one shared tabs component (#1353): WAI-ARIA Tabs keyboard and attributes, and its three users. Synthetic data only. */

let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

const tabsIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
async function press(element: Element, key: string) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

const items = [
  { key: "a", id: "t-a", label: "Alpha", panelId: "p-a" },
  { key: "b", id: "t-b", label: "Beta", panelId: "p-b" },
  { key: "c", id: "t-c", label: "Gamma", panelId: "p-c" },
];

function Harness({ activation, onSelect, tabs = items }: { activation?: "automatic" | "manual"; onSelect?: (key: string) => void; tabs?: typeof items }) {
  const [selected, setSelected] = useState("a");
  return createElement("div", null,
    createElement(TabList, {
      label: "Letters", tabs, selectedKey: selected, activation, className: "row", tabClassName: "tab", selectedClassName: "active",
      onSelect: (key: string) => { onSelect?.(key); setSelected(key); },
    }),
    createElement(TabPanel, { id: "p-a", tabId: "t-a", hidden: selected !== "a" }, "Alpha panel"));
}

describe("TabList", () => {
  it("renders the tabs pattern: tablist label, selected state, roving tabindex, controls and classes", async () => {
    mounted = await mount(createElement(Harness));
    const list = mounted.container.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Letters");
    expect(list.className).toBe("row");
    const tabs = tabsIn(mounted.container);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs.map((tab) => tab.getAttribute("aria-controls"))).toEqual(["p-a", "p-b", "p-c"]);
    expect(tabs.map((tab) => tab.className)).toEqual(["tab active", "tab", "tab"]);
    expect(tabs.every((tab) => tab.type === "button" && tab.hasAttribute("aria-current") === false)).toBe(true);
    const panel = mounted.container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe("t-a");
    expect(panel.id).toBe("p-a");
  });

  it("automatic: arrows select and focus, wrapping, Home and End jump", async () => {
    const onSelect = vi.fn();
    mounted = await mount(createElement(Harness, { onSelect }));
    const tabs = () => tabsIn(mounted!.container);
    await press(tabs()[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(tabs()[2]);
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    await press(tabs()[2]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs()[0]);
    await press(tabs()[0]!, "End");
    expect(document.activeElement).toBe(tabs()[2]);
    await press(tabs()[2]!, "Home");
    expect(document.activeElement).toBe(tabs()[0]);
    expect(onSelect.mock.calls.map(([key]) => key)).toEqual(["c", "a", "c", "a"]);
    await press(tabs()[0]!, "x");
    expect(onSelect).toHaveBeenCalledTimes(4);
  });

  it("manual: arrows move focus only; a click (Enter or Space on a button) selects", async () => {
    const onSelect = vi.fn();
    mounted = await mount(createElement(Harness, { activation: "manual", onSelect }));
    const tabs = () => tabsIn(mounted!.container);
    await press(tabs()[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs()[1]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    await click(tabs()[1]!);
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  it("leaves aria-controls off a tab whose panel is not in the page", async () => {
    mounted = await mount(createElement(Harness, { tabs: [items[0]!, { ...items[1]!, panelId: undefined as unknown as string }, items[2]!] }));
    expect(tabsIn(mounted.container).map((tab) => tab.hasAttribute("aria-controls"))).toEqual([true, false, true]);
  });

  it("TabPanel adds no box by default and can be hidden", async () => {
    mounted = await mount(createElement(TabPanel, { id: "x", tabId: "y", hidden: true }, "Body"));
    const panel = mounted.container.firstElementChild as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(panel.className).toContain("panel");
  });
});

describe("calendar admin tabs", () => {
  it("is a keyboard tablist; only the shown (or kept-mounted) panels are named", async () => {
    mounted = await mount(createElement(CalendarAdminWorkspace, { initialEntries: [], initialEvents: [] }));
    const root = mounted.container;
    const list = root.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Calendar settings");
    expect(list.className).toBe("communications-tabs");
    const tabs = tabsIn(root);
    expect(tabs).toHaveLength(4);
    expect(tabs[0]!.className).toBe("active");
    // Entries (selected) and the two kept-mounted panels exist; Events is not rendered yet.
    expect(tabs.map((tab) => tab.hasAttribute("aria-controls"))).toEqual([true, false, true, true]);
    for (const tab of tabs) {
      const id = tab.getAttribute("aria-controls");
      if (id) expect(root.querySelector(`#${id}`)?.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    await press(tabs[0]!, "ArrowRight");
    const after = tabsIn(root);
    expect(after[1]!.getAttribute("aria-selected")).toBe("true");
    expect(after[1]!.className).toBe("active");
    expect(document.activeElement).toBe(after[1]);
    expect(root.querySelector("#calendar-panel-events")).not.toBeNull();
    expect(root.querySelector("#calendar-panel-entries")).toBeNull();
  });
});

describe("communications tabs", () => {
  it("is a manual-activation tablist without aria-current or a nav element", async () => {
    mounted = await mount(createElement(CommunicationsWorkspace, {
      eventId: "event-1", eventName: "Synthetic Event", initialAnnouncements: [], initialMessaging: null, canManage: true, initialView: "announcements",
    }));
    const root = mounted.container;
    const list = root.querySelector('[role="tablist"]')!;
    expect(list.tagName).toBe("DIV");
    expect(list.getAttribute("aria-label")).toBe("Communication tools");
    expect(list.className).toBe("communications-tabs");
    const tabs = tabsIn(root);
    expect(tabs.length).toBeGreaterThan(1);
    expect(root.querySelectorAll('[role="tab"][aria-current]')).toHaveLength(0);
    expect(tabs.map((tab) => tab.hasAttribute("aria-controls"))).toEqual(tabs.map((_, index) => index === 0));
    const panel = root.querySelector(`#${tabs[0]!.getAttribute("aria-controls")}`)!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
    // Manual: an arrow moves focus without changing the view.
    await press(tabs[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabsIn(root)[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabsIn(root)[1]!.getAttribute("aria-selected")).toBe("false");
  });
});

describe("builder sidebar tabs", () => {
  it("keeps its ids, roving tabindex and arrow selection", async () => {
    const onTabChange = vi.fn();
    mounted = await mount(createElement(BuilderSidebar, {
      tabs: [
        { id: "questions", label: "Questions", panel: "Q" },
        { id: "settings", label: "Settings", panel: "S" },
      ],
      activeTab: "questions", onTabChange, layout: DEFAULT_EDITOR_LAYOUT, shownWidth: 320, maxWidth: 600, onResize: () => {},
      containerRef: { current: null },
    }));
    const root = mounted.container;
    const tabs = tabsIn(root);
    expect(tabs.map((tab) => tab.id)).toEqual(["fb-tab-questions", "fb-tab-settings"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-controls"))).toEqual(["fb-panel-questions", "fb-panel-settings"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    expect(root.querySelector(".fb-tablist")?.getAttribute("aria-label")).toBe("Sidebar");
    expect(tabs.every((tab) => tab.className === "fb-tab")).toBe(true);
    await press(tabs[0]!, "ArrowRight");
    expect(onTabChange).toHaveBeenCalledWith("settings");
    expect(document.activeElement).toBe(tabs[1]);
    expect(root.querySelector("#fb-panel-settings")?.hasAttribute("hidden")).toBe(true);
  });
});
