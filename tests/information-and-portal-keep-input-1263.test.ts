// @vitest-environment jsdom
import { createElement, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { InformationFormFillIn } from "@/components/information-form-fill-in";
import { PublicRegistrationContactForm } from "@/components/public-registration-contact-form";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { SITE_MAYBE_UPDATING_MESSAGE, SITE_UPDATING_MESSAGE } from "@/lib/submit-json";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { buttonByText, click, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/** Information form and portal edit during a restart (#1263). Synthetic data only. */
const definition = {
  title: "Synthetic information form", description: "", confirmationMessage: "Thanks",
  sections: [{ id: "s1", title: "Details", description: "", fields: [
    { id: "f1", key: "preferred_name", label: "Preferred name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
    { id: "f2", key: "allergy_details", label: "Allergy details", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
  ] }],
} as unknown as RegistrationFormDefinition;

let mounted: Mounted | null = null;
const textInputs = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')];

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sentBodies = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));

describe("information form (#1263)", () => {
  it("keeps answers across a 502, retries with the same key, and clears its draft on success", async () => {
    let failing = true;
    const fetchMock = vi.fn(async () => (failing
      ? new Response("<html>Bad Gateway</html>", { status: 502 })
      : new Response(JSON.stringify({ confirmationMessage: "Received, thank you." }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(InformationFormFillIn, { definition, slug: "synthetic-info" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const { container } = mounted;
    const [name, allergy] = textInputs(container);
    await typeInto(name!, "Avery");
    await typeInto(allergy!, "synthetic allergy");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const stored = [...Array(window.localStorage.length).keys()].map((index) => window.localStorage.getItem(window.localStorage.key(index)!)!).join("\n");
    expect(stored).toContain("Avery");
    expect(stored).not.toContain("synthetic allergy");

    await submitForm(container.querySelector("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelector(".submit-retry-notice")!.textContent).toContain(SITE_UPDATING_MESSAGE);
    expect(textInputs(container).map((input) => input.value)).toEqual(["Avery", "synthetic allergy"]);
    expect(window.localStorage.length).toBe(1); // the draft survives a failed submit
    const failed = fetchMock.mock.calls.length;
    expect(failed).toBe(2); // the key makes exactly one quiet retry safe

    failing = false;
    await click(buttonByText(container, "Try again"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock.mock.calls.length).toBe(failed + 1);
    const bodies = sentBodies(fetchMock);
    expect(new Set(bodies.map((body) => body.idempotencyKey)).size).toBe(1);
    expect(container.textContent).toContain("Received, thank you.");
    expect(window.localStorage.length).toBe(0);
  });

  it("restores a draft after a reload", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = await mount(createElement(InformationFormFillIn, { definition, slug: "synthetic-info" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await typeInto(textInputs(mounted.container)[0]!, "Avery");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await mounted.unmount();
    mounted = await mount(createElement(InformationFormFillIn, { definition, slug: "synthetic-info" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(mounted.container.textContent).toContain("We restored your answers from earlier.");
    expect(textInputs(mounted.container)[0]!.value).toBe("Avery");
  });
});

describe("information form for a signed-in visitor (#1263)", () => {
  it("never writes or restores a browser draft", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = await mount(createElement(InformationFormFillIn, { definition, slug: "synthetic-info", disableDrafts: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await typeInto(textInputs(mounted.container)[0]!, "Avery");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("registration contact edit (#1263)", () => {
  it("keeps what was typed after a network error and Try again saves it", async () => {
    let failing = true;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (failing) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ registration: { contact: JSON.parse(String(init!.body)) } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const contact = { firstName: "Avery", lastName: "Guest", email: "guest@example.test", phone: "(515) 555-0100" };
    mounted = await mount(createElement(PublicRegistrationContactForm, { token: "synthetic-token", initialContact: contact } as never));
    const { container } = mounted;
    await typeInto(textInputs(container)[0]!, "Avery Jo");
    await submitForm(container.querySelector("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // a bare network error on a non-keyed edit is not auto-retried
    // An unkeyed edit may have reached the server: the notice says to check before trying again.
    expect(container.querySelector(".submit-retry-notice")!.textContent).toContain(SITE_MAYBE_UPDATING_MESSAGE);
    expect(textInputs(container)[0]!.value).toBe("Avery Jo");
    failing = false;
    await click(buttonByText(container, "Try again"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)).firstName).toBe("Avery Jo");
    expect(container.textContent).toContain("Contact details saved.");
    expect(container.querySelector(".submit-retry-notice")).toBeNull();
  });
});

describe("the retry notice (#1263)", () => {
  it("is an alert with a labelled Try again button, disabled while busy", async () => {
    const onRetry = vi.fn();
    mounted = await mount(createElement(SubmitRetryNotice, { onRetry, message: SITE_UPDATING_MESSAGE }));
    const notice = mounted.container.querySelector(".submit-retry-notice")!;
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain(SITE_UPDATING_MESSAGE);
    await click(buttonByText(mounted.container, "Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await mounted.unmount();
    mounted = await mount(createElement(SubmitRetryNotice, { onRetry, busy: true, message: SITE_UPDATING_MESSAGE }));
    expect(mounted.container.querySelector("button")!.disabled).toBe(true);
  });
});
