// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { ClubFormFillIn } from "@/components/club-form-fill-in";
import { SITE_UPDATING_MESSAGE } from "@/lib/submit-json";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { buttonByText, choose, click, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/**
 * A club form submit that hits a restart keeps every answer, says the site is updating, and Try again
 * re-sends the same answers with the same idempotency key, one request at a time (#1263). Synthetic data only.
 */
const definition = {
  title: "Sample application", description: "", confirmationMessage: "Thanks",
  sections: [{ id: "sec_a", title: "Applicant", description: "", fields: [
    { id: "f_name", key: "full_name", label: "Full name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
    { id: "f_notes", key: "medical_notes", label: "Medical conditions", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
  ] }],
} as unknown as RegistrationFormDefinition;

const openProps = {
  definition, sectionNotes: {}, sensitiveFieldKeys: [] as string[], mode: "open" as const, templateKey: "club_tlt_application",
  clubs: [{ id: "club-a", name: "Example Pathfinders" }],
};

function bodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

let mounted: Mounted | null = null;

async function fill(container: HTMLElement) {
  await choose(container.querySelector("select")!, "club-a");
  await typeInto(container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!, "Alex Example");
}

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

const html502 = () => new Response("<html>Bad Gateway</html>", { status: 502 });

describe("club form: submit during a restart (#1263)", () => {
  it.each([
    ["a network error", () => { throw new TypeError("Failed to fetch"); }],
    ["a 502 gateway page", html502],
    ["a 503 page", () => new Response("<html>Unavailable</html>", { status: 503 })],
  ])("keeps the answers after %s and Try again re-sends them with the same key", async (_label, failure) => {
    let failing = true;
    const fetchMock = vi.fn(async () => {
      if (failing) return (failure as () => Response)();
      return new Response(JSON.stringify({ confirmationMessage: "Thank you. Your form has been received." }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubFormFillIn, openProps));
    const { container } = mounted;
    await fill(container);

    await submitForm(container.querySelector("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    const alert = container.querySelector(".submit-retry-notice")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(SITE_UPDATING_MESSAGE);
    expect(container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!.value).toBe("Alex Example");
    expect(container.querySelector("select")!.value).toBe("club-a");
    const failedCalls = fetchMock.mock.calls.length;
    expect(failedCalls).toBe(2); // the key makes exactly one quiet retry safe

    failing = false;
    await click(buttonByText(container, "Try again"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock.mock.calls.length).toBe(failedCalls + 1);
    const sent = bodies(fetchMock);
    expect(new Set(sent.map((body) => body.idempotencyKey)).size).toBe(1);
    expect(sent[0].idempotencyKey).toBeTruthy();
    expect(sent.at(-1)).toMatchObject({ organizationId: "club-a", answers: { full_name: "Alex Example" } });
    expect(container.textContent).toContain("Thank you. Your form has been received.");
  });

  it("never sends two requests for one click, even when submitted twice while one is in flight", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubFormFillIn, openProps));
    await fill(mounted.container);
    const form = mounted.container.querySelector("form")!;
    await submitForm(form);
    await submitForm(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(new Response(JSON.stringify({ confirmationMessage: "Done." }), { status: 200 })); });
    expect(mounted.container.textContent).toContain("Done.");
  });

  it("does not call a JSON 500 an update and does not retry it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "That club cannot apply." }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubFormFillIn, openProps));
    await fill(mounted.container);
    await submitForm(mounted.container.querySelector("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mounted.container.querySelector(".submit-retry-notice")).toBeNull();
    expect(mounted.container.textContent).toContain("That club cannot apply.");
  });
});

describe("club form: local draft (#1263)", () => {
  it("restores typed answers after a reload, never writes a sensitive-looking field, and clears on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ confirmationMessage: "Done." }), { status: 200 })));
    mounted = await mount(createElement(ClubFormFillIn, openProps));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await fill(mounted.container);
    const inputs = mounted.container.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])');
    await typeInto(inputs[1]!, "peanut allergy");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const stored = [...Array(window.localStorage.length).keys()].map((index) => window.localStorage.getItem(window.localStorage.key(index)!)!).join("\n");
    expect(stored).toContain("Alex Example");
    expect(stored).not.toContain("peanut");
    expect(stored).not.toMatch(/idempotency/i);

    await mounted.unmount();
    mounted = await mount(createElement(ClubFormFillIn, openProps));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(mounted.container.textContent).toContain("We restored your answers from earlier.");
    expect(mounted.container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!.value).toBe("Alex Example");
    expect(mounted.container.querySelector("select")!.value).toBe("club-a");

    await submitForm(mounted.container.querySelector("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("single-use club form link (#1263)", () => {
  it("clears the local draft when the link turns out to be already used", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "That link was already used or withdrawn." }), { status: 404 })));
    mounted = await mount(createElement(ClubFormFillIn, { definition, sectionNotes: {}, sensitiveFieldKeys: [], mode: "link" as const, token: "synthetic-link-token" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await typeInto(mounted.container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!, "Alex Example");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).not.toContain("synthetic-link-token"); // the token is never part of a storage key
    await submitForm(mounted.container.querySelector("form")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mounted.container.textContent).toContain("already used or withdrawn");
    expect(window.localStorage.length).toBe(0);
  });
});
