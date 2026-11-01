// @vitest-environment jsdom
import { createElement, createRef, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityCheckHandle } from "@/components/security-check/security-check";
import { click, mount, type Mounted } from "./helpers/dom-render";

/**
 * #1445: when Cloudflare's script is blocked (Brave Shields, Avast, a VPN or ad blocker) the Security check says so in
 * plain words and offers Try again, which asks for the script again. It never hides a failure and never offers a way
 * around the check: Submit still needs a token.
 */

let mounted: Mounted | null = null;

/** The widget keeps one script request per page load in module state, so each test starts from a fresh module. */
async function loadComponent() {
  vi.resetModules();
  return import("@/components/security-check/security-check");
}
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.getElementById("cf-turnstile-api")?.remove();
  vi.restoreAllMocks();
});

async function blockScript() {
  const script = document.getElementById("cf-turnstile-api");
  expect(script).not.toBeNull();
  await act(async () => {
    script!.dispatchEvent(new Event("error"));
  });
}

describe("Security check when the script is blocked", () => {
  it("shows a plain message and Try again, and Try again requests the script again", async () => {
    const { SecurityCheck, SECURITY_CHECK_BLOCKED_TEXT } = await loadComponent();
    const ref = createRef<SecurityCheckHandle>();
    mounted = await mount(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key" }, action: "registration", handleRef: ref }));
    await blockScript();
    expect(mounted.container.textContent).toContain(SECURITY_CHECK_BLOCKED_TEXT);
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-testid="security-check-retry"]');
    expect(retry?.textContent).toBe("Try again");
    expect(document.getElementById("cf-turnstile-api")).toBeNull();

    await click(retry!);
    expect(mounted.container.textContent).not.toContain(SECURITY_CHECK_BLOCKED_TEXT);
    expect(document.getElementById("cf-turnstile-api")).not.toBeNull();
    // No bypass: with no token the form is still told to wait, and nothing is sent.
    let allowed = true;
    await act(async () => { allowed = ref.current?.require("Submit") ?? true; });
    expect(allowed).toBe(false);
    expect(ref.current?.headers()).toEqual({});
  });

  it("shows the message again when the retry is blocked too", async () => {
    const { SecurityCheck, SECURITY_CHECK_BLOCKED_TEXT } = await loadComponent();
    const ref = createRef<SecurityCheckHandle>();
    mounted = await mount(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key" }, action: "registration", handleRef: ref }));
    await blockScript();
    await click(mounted.container.querySelector<HTMLButtonElement>('[data-testid="security-check-retry"]')!);
    await blockScript();
    expect(mounted.container.textContent).toContain(SECURITY_CHECK_BLOCKED_TEXT);
    expect(mounted.container.querySelector('[data-testid="security-check-retry"]')).not.toBeNull();
  });

  it("renders nothing, and no Try again, while Turnstile is off", async () => {
    const { SecurityCheck } = await loadComponent();
    const ref = createRef<SecurityCheckHandle>();
    mounted = await mount(createElement(SecurityCheck, { config: null, action: "registration", handleRef: ref }));
    expect(mounted.container.innerHTML).toBe("");
    expect(ref.current?.require("Submit")).toBe(true);
  });
});
