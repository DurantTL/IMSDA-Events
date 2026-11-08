// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** #1483: field errors in the popup form land next to their field and take focus after they render; the Security check load flag. */
import { ProblemReportSection } from "@/components/problem-report-form";
import { SecurityCheck, securityCheckLoadFailed } from "@/components/security-check/security-check";
import { buttonByText, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

let mounted: Mounted | null = null;
const fetchMock = vi.fn();
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

async function openForm() {
  fetchMock.mockResolvedValueOnce(Response.json({ siteKey: null, email: null }));
  mounted = await mount(createElement(ProblemReportSection));
  const details = mounted.container.querySelector("details")!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  await flush(10);
  return mounted.container;
}

describe("field errors in the popup form", () => {
  it("shows the required message error beside the textarea, then focuses it", async () => {
    const root = await openForm();
    await submitForm(root.querySelector("form")!);
    await flush(10);
    const area = root.querySelector("textarea")!;
    expect(area.getAttribute("aria-invalid")).toBe("true");
    const errorId = area.getAttribute("aria-describedby")!.split(" ").find((id) => id.endsWith("-error"))!;
    expect(root.querySelector(`#${errorId}`)?.textContent).toContain("Tell us what happened");
    expect(document.activeElement).toBe(area);
  });

  it("shows a bad email beside the email input and focuses it, sending nothing", async () => {
    const root = await openForm();
    await typeInto(root.querySelector("textarea")!, "The page froze after Submit.");
    await typeInto(root.querySelector<HTMLInputElement>("#problem-report-email")!, "not-an-email");
    await submitForm(root.querySelector("form")!);
    await flush(10);
    const email = root.querySelector<HTMLInputElement>("#problem-report-email")!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(root.textContent).toContain("Enter a valid email address.");
    expect(document.activeElement).toBe(email);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the config read
  });

  it.each([["message", "textarea"], ["email", "#problem-report-email"]])("places a server %s error on that field and focuses it", async (field, selector) => {
    const root = await openForm();
    await typeInto(root.querySelector("textarea")!, "The page froze after Submit.");
    fetchMock.mockResolvedValueOnce(Response.json({ error: "INVALID_PROBLEM_REPORT", message: `Server says ${field} is wrong.`, field }, { status: 400 }));
    await submitForm(root.querySelector("form")!);
    await flush(10);
    const control = root.querySelector<HTMLElement>(selector)!;
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(root.querySelector(`#${control.getAttribute("aria-describedby")!.split(" ").find((id) => id.endsWith("error") || id.startsWith(":"))}`)?.textContent ?? root.textContent).toContain(`Server says ${field} is wrong.`);
    expect(document.activeElement).toBe(control);
    expect(buttonByText(root, "Send report").disabled).toBe(false);
  });

  it("shows an answer with no field as one message above the button", async () => {
    const root = await openForm();
    await typeInto(root.querySelector("textarea")!, "The page froze after Submit.");
    fetchMock.mockResolvedValueOnce(Response.json({ error: "PROBLEM_REPORT_FAILED", message: "Nope." }, { status: 500 }));
    await submitForm(root.querySelector("form")!);
    await flush(10);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("Nope.");
    expect(root.querySelector("textarea")!.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("securityCheckLoadFailed", () => {
  const script = () => document.getElementById("cf-turnstile-api");
  const config = { siteKey: "site-key-test" };

  it("is false while loading, true after an error, and reset on the next load", async () => {
    delete (window as { turnstile?: unknown }).turnstile;
    mounted = await mount(createElement(SecurityCheck, { action: "problem-report", config, handleRef: { current: null } }));
    await flush(0);
    expect(script()).not.toBeNull();
    expect(securityCheckLoadFailed()).toBe(false); // still loading
    script()!.dispatchEvent(new Event("error"));
    await flush(0);
    expect(securityCheckLoadFailed()).toBe(true);
    // Try again loads the script again: the flag clears at the start of that load.
    await mounted.unmount();
    mounted = await mount(createElement(SecurityCheck, { action: "problem-report", config, handleRef: { current: null } }));
    await flush(0);
    expect(script()).not.toBeNull();
    expect(securityCheckLoadFailed()).toBe(false);
    // Finish this load (as a failure) so the module's pending load does not leak into the next test.
    script()!.dispatchEvent(new Event("error"));
    await flush(0);
    await mounted.unmount();
    mounted = null;
  });

  it("is true after the load times out", async () => {
    document.getElementById("cf-turnstile-api")?.remove();
    delete (window as { turnstile?: unknown }).turnstile;
    vi.useFakeTimers();
    mounted = await mount(createElement(SecurityCheck, { action: "problem-report", config, handleRef: { current: null } }));
    expect(securityCheckLoadFailed()).toBe(false);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(securityCheckLoadFailed()).toBe(true);
  });
});
