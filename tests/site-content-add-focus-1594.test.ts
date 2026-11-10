// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/site-content", useSearchParams: () => new URLSearchParams() }));

import { SiteContentWorkspace } from "@/components/site-content-workspace";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";
import { act } from "react";
import { flush, mount, type Mounted } from "./helpers/dom-render";

// #1594: adding a notice or announcement moves focus to the new item's first field, never to the page body. Synthetic data only.
let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

const button = (container: HTMLElement, label: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label))!;

async function pressAdd(label: string) {
  mounted = await mount(createElement(SiteContentWorkspace, { initialContent: defaultHubContent(), draft: null, published: null, draftDiffers: false, history: [], events: [] }));
  const container = mounted.container;
  await act(async () => { button(container, label).click(); });
  await flush();
  return container;
}

describe("adding an item keeps focus in the editor (#1594)", () => {
  it("focuses the new notice's Level field from the empty state", async () => {
    const container = await pressAdd("Add a notice");
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("SELECT");
    expect(container.contains(active)).toBe(true);
    expect(active.closest("label")?.textContent).toContain("Level");
  });

  it("focuses the new announcement's Title field from the empty state", async () => {
    const container = await pressAdd("Add an announcement");
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("INPUT");
    expect(container.contains(active)).toBe(true);
    expect(active.closest("label")?.textContent).toContain("Title");
  });

  it("focuses the second item when the regular Add button is used", async () => {
    const container = await pressAdd("Add an announcement");
    await act(async () => { button(container, "Add an announcement").click(); });
    await flush();
    const titles = [...container.querySelectorAll<HTMLInputElement>("input[data-focus-id]")];
    expect(titles).toHaveLength(2);
    expect(document.activeElement).toBe(titles[1]);
  });
});
