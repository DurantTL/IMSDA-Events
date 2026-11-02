// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionsMenu } from "@/components/actions-menu";
import { ExportLink } from "@/components/export-link";
import { mount, type Mounted } from "./helpers/dom-render";

let mounted: Mounted;
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); });

describe("the Actions menu's download status (#1458)", () => {
  it("has no live region when no download link is inside, and one as soon as a link mounts", async () => {
    mounted = await mount(createElement(ActionsMenu, null, createElement("li", null, "Just a button")));
    expect(mounted.container.querySelector('[role="status"]')).toBeNull();
    await mounted.unmount();
    mounted = await mount(createElement(ActionsMenu, null, createElement("li", null, createElement(ExportLink, { href: "/api/x" }))));
    const region = mounted.container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe("");
    // It sits beside the menu, not inside the list that closes.
    expect(mounted.container.querySelector("details")!.contains(region)).toBe(false);
  });

  it("shows a refused download beside the menu even though the click closes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "This event has no lodging set up." }), { status: 409 })));
    mounted = await mount(createElement(ActionsMenu, null, createElement("li", null, createElement(ExportLink, { href: "/api/x" }))));
    const link = mounted.container.querySelector("a")!;
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    expect(mounted.container.querySelector("details")!.open).toBe(false);
    expect(mounted.container.querySelector('[role="status"]')!.textContent).toBe("This event has no lodging set up.");
    // The link inside the menu has no region of its own.
    expect(mounted.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});
