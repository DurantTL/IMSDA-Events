// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonByText, click, flush, mount, type Mounted } from "./helpers/dom-render";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => userAgent });
}

describe("account install card (#1713)", () => {
  let mounted: Mounted | null = null;
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    delete (Navigator.prototype as { install?: unknown }).install;
  });
  afterEach(async () => { await mounted?.unmount(); mounted = null; delete (Navigator.prototype as { install?: unknown }).install; });

  it("shows nothing where the browser offers no install, rather than a button that cannot work", async () => {
    setUserAgent(ANDROID_CHROME);
    const { AccountInstallCard } = await import("@/components/account-install-card");
    mounted = await mount(createElement(AccountInstallCard));
    await flush();
    expect(mounted.container.querySelector("#install-card-heading")).toBeNull();
    expect(mounted.container.querySelector("button")).toBeNull();
  });

  it("calls navigator.install() straight from the click, with account wording", async () => {
    setUserAgent(ANDROID_CHROME);
    const install = vi.fn(() => Promise.resolve());
    (Navigator.prototype as { install?: unknown }).install = install;
    const { AccountInstallCard } = await import("@/components/account-install-card");
    mounted = await mount(createElement(AccountInstallCard));
    await flush();
    expect(mounted.container.textContent).toContain("opens your account");
    expect(mounted.container.textContent).toContain("The website works fine without it.");
    await click(buttonByText(mounted.container, "Install"));
    await flush();
    expect(install).toHaveBeenCalledTimes(1);
    expect(mounted.container.querySelector("#install-card-heading")).toBeNull();
  });

  it("keeps the card when the person cancels the install", async () => {
    setUserAgent(ANDROID_CHROME);
    (Navigator.prototype as { install?: unknown }).install = vi.fn(() => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })));
    const { AccountInstallCard } = await import("@/components/account-install-card");
    mounted = await mount(createElement(AccountInstallCard));
    await flush();
    await click(buttonByText(mounted.container, "Install"));
    await flush();
    expect(mounted.container.querySelector("#install-card-heading")).not.toBeNull();
  });

  it("uses a captured beforeinstallprompt when the Web Install API is missing", async () => {
    setUserAgent(ANDROID_CHROME);
    const { AccountInstallCard } = await import("@/components/account-install-card");
    mounted = await mount(createElement(AccountInstallCard));
    await flush();
    expect(mounted.container.querySelector("button")).toBeNull();
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "dismissed" as const }) });
    window.dispatchEvent(event);
    await flush();
    await click(buttonByText(mounted.container, "Install"));
    await flush();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("shows the Share steps on iPhone Safari", async () => {
    setUserAgent(IPHONE_SAFARI);
    const { AccountInstallCard } = await import("@/components/account-install-card");
    mounted = await mount(createElement(AccountInstallCard));
    await flush();
    expect(mounted.container.textContent).toContain("Choose Add to Home Screen");
    expect(mounted.container.textContent).not.toContain("Install");
  });

  it("hides with its own key, leaves the staff card alone, and Help brings it back", async () => {
    setUserAgent(IPHONE_SAFARI);
    const { AccountInstallCard, AccountInstallCardRestore } = await import("@/components/account-install-card");
    const { StaffInstallCard } = await import("@/components/staff-install-card");
    mounted = await mount(createElement(AccountInstallCard));
    await flush();
    await click(buttonByText(mounted.container, "Not now"));
    await flush();
    expect(window.localStorage.getItem("imsda-account-install-card-dismissed")).toBe("1");
    expect(window.localStorage.getItem("imsda-staff-install-card-dismissed")).toBeNull();
    await mounted.unmount();

    mounted = await mount(createElement(StaffInstallCard));
    await flush();
    expect(mounted.container.querySelector("#install-card-heading")).not.toBeNull();
    await mounted.unmount();

    mounted = await mount(createElement(AccountInstallCardRestore));
    await flush();
    await click(buttonByText(mounted.container, "Show the Home Screen card on your account again"));
    await flush();
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe("The card will show on your account again.");
    expect(window.localStorage.getItem("imsda-account-install-card-dismissed")).toBeNull();
  });
});
