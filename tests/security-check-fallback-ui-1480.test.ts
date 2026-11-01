// @vitest-environment jsdom
import { createElement, createRef, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityCheckHandle } from "@/components/security-check/security-check";
import { click, mount, typeInto, flush, type Mounted } from "./helpers/dom-render";

/**
 * #1480: a blocked Security check shows the office contact (translate="no") on every form, "Email me a code instead" on
 * the sign-in, sign-up and reset forms only, and lets a public form send without a token. A rejected token is never
 * treated as blocked.
 */

let mounted: Mounted | null = null;

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
  vi.unstubAllGlobals();
});

async function blockScript() {
  await act(async () => {
    document.getElementById("cf-turnstile-api")!.dispatchEvent(new Event("error"));
  });
}

const contact = { email: "help@example.test", phone: "(515) 555-0100" };

async function mountBlocked(action: string, withEmailCode: boolean, getEmail = () => "person@example.test") {
  const { SecurityCheck } = await loadComponent();
  const ref = createRef<SecurityCheckHandle>();
  mounted = await mount(createElement(SecurityCheck, {
    config: { siteKey: "synthetic-site-key", contact },
    action,
    handleRef: ref,
    emailCode: withEmailCode ? { getEmail } : undefined,
  }));
  await blockScript();
  return ref;
}

describe("blocked check: office contact", () => {
  it("shows the email and phone as links with translate=no, on a public form too", async () => {
    await mountBlocked("registration", false);
    const links = [...mounted!.container.querySelectorAll('[data-testid="security-check-contact"] a')];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["mailto:help@example.test", "tel:+15155550100"]);
    expect(links.every((link) => link.getAttribute("translate") === "no")).toBe(true);
    expect(links.map((link) => link.textContent)).toEqual(["help@example.test", "(515) 555-0100"]);
  });

  it("falls back on the default contact when the page passes none", async () => {
    const { SecurityCheck } = await loadComponent();
    mounted = await mount(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key" }, action: "registration", handleRef: createRef<SecurityCheckHandle>() }));
    await blockScript();
    expect(mounted.container.querySelector('a[href="mailto:support@imsda.org"]')).not.toBeNull();
    expect(mounted.container.querySelector('a[href="tel:+15152231197"]')).not.toBeNull();
  });

  it("shows no contact while the check is working", async () => {
    const { SecurityCheck } = await loadComponent();
    mounted = await mount(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key", contact }, action: "registration", handleRef: createRef<SecurityCheckHandle>() }));
    expect(mounted.container.querySelector('[data-testid="security-check-contact"]')).toBeNull();
  });
});

describe("blocked check: public forms", () => {
  it("lets the form send without a token, and sends no code header", async () => {
    const ref = await mountBlocked("registration", false);
    let allowed = false;
    await act(async () => { allowed = ref.current?.require("Submit") ?? false; });
    expect(allowed).toBe(true);
    expect(ref.current?.headers()).toEqual({});
    expect(mounted!.container.querySelector('[data-testid="security-check-email-code-button"]')).toBeNull();
  });

  it("is not treated as blocked after the server rejects a token", async () => {
    const { SecurityCheck } = await loadComponent();
    const ref = createRef<SecurityCheckHandle>();
    mounted = await mount(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key", contact }, action: "registration", handleRef: ref }));
    await act(async () => { ref.current?.settle({ code: "security_check_failed" }); });
    expect(ref.current?.unavailable()).toBe(false);
    let allowed = true;
    await act(async () => { allowed = ref.current?.require("Submit") ?? true; });
    expect(allowed).toBe(false);
    expect(mounted.container.querySelector('[data-testid="security-check-contact"]')).toBeNull();
  });
});

describe("blocked check: sign-in, sign-up and reset forms", () => {
  it.each(["staff-sign-in", "attendee-sign-in", "attendee-sign-up", "forgot-password"])("%s offers Email me a code instead", async (action) => {
    await mountBlocked(action, true);
    const button = mounted!.container.querySelector<HTMLButtonElement>('[data-testid="security-check-email-code-button"]');
    expect(button?.textContent).toBe("Email me a code instead");
  });

  it("does not let Submit through without a code", async () => {
    const ref = await mountBlocked("staff-sign-in", true);
    let allowed = true;
    await act(async () => { allowed = ref.current?.require("Sign in") ?? true; });
    expect(allowed).toBe(false);
    expect(mounted!.container.querySelector('[role="alert"]')?.textContent).toContain("blocking it");
    expect(mounted!.container.querySelector('[data-testid="security-check-email-code"] [role="alert"]')?.textContent).toContain("Email me a code instead");
  });

  it("posts the form's email, announces the server's words, then shows a labelled code field whose value goes in the header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "If that address can use this, we sent a code. It works for 10 minutes." }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const ref = await mountBlocked("attendee-sign-in", true);
    expect(mounted!.container.querySelector('[data-testid="security-check-code-input"]')).toBeNull();
    await click(mounted!.container.querySelector('[data-testid="security-check-email-code-button"]')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/security-check/email-code", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "attendee-sign-in", email: "person@example.test", website: "" }) }));
    expect(mounted!.container.querySelector('[data-testid="security-check-email-code"] [role="status"]')?.textContent).toBe("If that address can use this, we sent a code. It works for 10 minutes.");
    const input = mounted!.container.querySelector<HTMLInputElement>('[data-testid="security-check-code-input"]')!;
    expect(input.closest("label")?.textContent).toContain("Code from your email");
    await typeInto(input, "123 456");
    let allowed = false;
    await act(async () => { allowed = ref.current?.require("Sign in") ?? false; });
    expect(allowed).toBe(true);
    expect(ref.current?.headers()).toEqual({ "x-security-check-code": "123 456" });
    // The code is spent by the request, whatever the answer: the field clears and a new code is offered.
    await act(async () => { ref.current?.settle({ error: "INVALID_CREDENTIALS" }); });
    expect(mounted!.container.querySelector('[data-testid="security-check-code-input"]')).toBeNull();
    expect(ref.current?.headers()).toEqual({});
  });

  it("moves focus to the code field once a code was sent, and does not disable the button while sending", async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    await mountBlocked("staff-sign-in", true);
    const button = mounted!.container.querySelector<HTMLButtonElement>('[data-testid="security-check-email-code-button"]')!;
    await click(button);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await click(button); // ignored while sending
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { finish(new Response(JSON.stringify({ ok: true, message: "Sent." }), { status: 202 })); });
    await flush();
    const input = mounted!.container.querySelector<HTMLInputElement>('[data-testid="security-check-code-input"]')!;
    expect(document.activeElement).toBe(input);
  });

  it("keeps the typed code when the server answered before looking at it (rate limited), and clears it after a security-check rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "Sent." }), { status: 202 })));
    const ref = await mountBlocked("attendee-sign-in", true);
    await click(mounted!.container.querySelector('[data-testid="security-check-email-code-button"]')!);
    await flush();
    await typeInto(mounted!.container.querySelector<HTMLInputElement>('[data-testid="security-check-code-input"]')!, "123456");
    await act(async () => { ref.current?.settle({ error: "RATE_LIMITED" }); });
    expect(mounted!.container.querySelector<HTMLInputElement>('[data-testid="security-check-code-input"]')?.value).toBe("123456");
    expect(ref.current?.headers()).toEqual({ "x-security-check-code": "123456" });
    await act(async () => { ref.current?.settle({ code: "security_check_failed" }); });
    expect(mounted!.container.querySelector('[data-testid="security-check-code-input"]')).toBeNull();
    expect(mounted!.container.querySelector('[data-testid="security-check-email-code"] [role="alert"]')?.textContent).toContain("didn't work");
  });

  it("asks for the address first when the form's email is empty, and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountBlocked("forgot-password", true, () => "");
    await click(mounted!.container.querySelector('[data-testid="security-check-email-code-button"]')!);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mounted!.container.querySelector('[data-testid="security-check-email-code"] [role="alert"]')?.textContent).toContain("email address");
  });

  it("never sends the code header beside a token", async () => {
    const { SecurityCheck } = await loadComponent();
    const ref = createRef<SecurityCheckHandle>();
    mounted = await mount(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key", contact }, action: "staff-sign-in", handleRef: ref, emailCode: { getEmail: () => "person@example.test" } }));
    expect(ref.current?.headers()).toEqual({});
    expect(mounted.container.querySelector('[data-testid="security-check-email-code-button"]')).toBeNull();
  });
});
