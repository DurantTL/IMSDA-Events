// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buttonByText, click, flush, mount, type Mounted } from "./helpers/dom-render";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// #1836 review: with storage blocked (a private window), "Not now" must still hide the card, and focus must not be lost.
describe("staff install card with blocked storage (#1836)", () => {
  let mounted: Mounted | null = null;
  beforeAll(() => {
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => IPHONE_SAFARI });
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  });
  afterEach(async () => { await mounted?.unmount(); mounted = null; });

  it("hides the card on Not now, leaves a focused status line, and Help can bring it back", async () => {
    const { StaffInstallCard, StaffInstallCardRestore } = await import("@/components/staff-install-card");
    mounted = await mount(createElement(StaffInstallCard));
    await flush();
    expect(mounted.container.querySelector("#install-card-heading")?.textContent).toBe("Save IMAdventist to your Home Screen");

    await click(buttonByText(mounted.container, "Not now"));
    await flush();
    expect(mounted.container.querySelector("#install-card-heading")).toBeNull();
    const status = mounted.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("You can bring this back from Help.");
    expect(document.activeElement).toBe(status);
    await mounted.unmount();

    mounted = await mount(createElement(StaffInstallCardRestore));
    await flush();
    await click(buttonByText(mounted.container, "Show the Home Screen card on Home again"));
    await flush();
    const restored = mounted.container.querySelector('[role="status"]');
    expect(restored?.textContent).toBe("The card will show on Home again.");
    expect(document.activeElement).toBe(restored);
    await mounted.unmount();

    mounted = await mount(createElement(StaffInstallCard));
    await flush();
    expect(mounted.container.querySelector("#install-card-heading")).not.toBeNull();
  });
});
