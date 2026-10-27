// @vitest-environment jsdom
import { createElement, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { PublicRegistrationForm } from "@/components/public-registration-form";
import { SITE_UPDATING_MESSAGE } from "@/lib/submit-json";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { buttonByText, click, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/**
 * A registration submitted while the site restarts keeps every answer, shows the updating message,
 * and Try again re-sends with the same idempotency key, one request at a time (#1263). Synthetic data only.
 */
const base = { helpText: "", options: [] as string[], scope: "REGISTRATION", required: false };
const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic retreat form", description: "Synthetic.", confirmationMessage: "Received.",
  sections: [{ id: "details", title: "Details", description: "", fields: [
    { ...base, id: "contact_field", key: "contact_name", label: "Contact name", type: "TEXT", required: true },
    { ...base, id: "email_field", key: "email", label: "Email", type: "EMAIL", required: true },
    { ...base, id: "medical_field", key: "health_concerns", label: "Health concerns", type: "TEXT" },
  ] }],
});
const props = {
  event: { name: "Synthetic Retreat", slug: "synthetic-retreat", startsAt: "2026-10-09T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z", timezone: "America/Chicago", location: null, capacity: null, billingMode: "ATTENDEE_PAY" },
  form: { slug: "main", versionId: "version-1", versionNumber: 1, definition },
  choiceUsage: {},
  pricingDate: "2026-09-29",
  lifecycle: { phase: "OPEN" as const, capacityDecision: "REGISTER" as const, remainingSpots: null, waitingRegistrations: 0 },
};
const confirmation = {
  confirmationCode: "SYN-0001", registrationStatus: "CONFIRMED", message: "Received.", email: "guest@example.test", promoCode: null,
  totalCents: 0, balanceCents: 0, lineItems: [], pricingDate: "2026-09-29", cardSelected: false, emailSent: true,
  paymentCollected: false, notificationQueued: false, notificationStatus: "SENT", managePath: "/manage/synthetic",
};

let mounted: Mounted | null = null;
const textInputs = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])')]
  .filter((input) => !input.closest(".public-registration-honeypot"));

async function reachReview(container: HTMLElement) {
  const [name, email, health] = textInputs(container);
  await typeInto(name!, "Avery Guest");
  await typeInto(email!, "guest@example.test");
  await typeInto(health!, "synthetic concern");
  await click(buttonByText(container, "Continue"));
}

const submitButton = (container: HTMLElement) => [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Submit registration") as HTMLButtonElement;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const failures: Array<[string, () => Response]> = [
  ["a network error", () => { throw new TypeError("Failed to fetch"); }],
  ["a 502 gateway page", () => new Response("<html>Bad Gateway</html>", { status: 502 })],
  ["a 503 page", () => new Response("<html>Unavailable</html>", { status: 503 })],
  ["the app's UPDATING answer", () => new Response(JSON.stringify({ code: "UPDATING", message: SITE_UPDATING_MESSAGE }), { status: 503 })],
];

describe("public registration: submit during a restart (#1263)", () => {
  it.each(failures)("keeps the answers after %s, and Try again re-sends with the same key", async (_label, failure) => {
    let failing = true;
    const fetchMock = vi.fn(async () => (failing ? failure() : new Response(JSON.stringify({ confirmation }), { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReview(container);

    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(container.querySelector(".submit-retry-notice")!.textContent).toContain(SITE_UPDATING_MESSAGE);
    expect(container.querySelector(".submit-retry-notice")!.getAttribute("role")).toBe("alert");
    const failedCalls = fetchMock.mock.calls.length;
    expect(failedCalls).toBe(2); // the key makes exactly one quiet retry safe

    failing = false;
    await click(buttonByText(container, "Try again"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock.mock.calls.length).toBe(failedCalls + 1);

    const sent = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(new Set(sent.map((body) => body.idempotencyKey)).size).toBe(1);
    expect(sent[0].idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(sent.at(-1).responses).toMatchObject({ contact_name: "Avery Guest", email: "guest@example.test" });
    expect(container.textContent).toContain("SYN-0001");
  });

  it("keeps the typed values on screen after the failure (no reset)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>x</html>", { status: 504 })));
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReview(container);
    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await click(buttonByText(container, "Back"));
    expect(textInputs(container).map((input) => input.value)).toEqual(["Avery Guest", "guest@example.test", "synthetic concern"]);
  });

  it("sends one request per submit even if the button is pressed again while it is in flight", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReview(container);
    const form = container.querySelector("form")!;
    await submitForm(form);
    await submitForm(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(new Response(JSON.stringify({ confirmation }), { status: 201 })); });
  });

  it("does not treat a JSON 500 as an update, does not retry it, and keeps the key for a safe replay", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Something real broke." }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReview(container);
    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".submit-retry-notice")).toBeNull();
    expect(container.textContent).toContain("Something real broke.");
    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const [first, second] = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("keeps the browser draft after a failed submit, and never wrote the health answer or a key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>x</html>", { status: 502 })));
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReview(container);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const stored = [...Array(window.localStorage.length).keys()].map((index) => window.localStorage.getItem(window.localStorage.key(index)!)!).join("\n");
    expect(stored).toContain("Avery Guest");
    expect(stored).not.toContain("synthetic concern");
    expect(stored).not.toMatch(/idempotency/i);
  });

  it("keeps the key after a timeout, so the next submit replays the same registration", async () => {
    let hang = true;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => (hang
      ? new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })
      : Promise.resolve(new Response(JSON.stringify({ confirmation }), { status: 201 }))));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReview(container);
    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // a timeout is never retried automatically
    expect(container.querySelector(".submit-retry-notice")).toBeNull();
    expect(container.textContent).toContain("Check whether it finished before trying again.");
    hang = false;
    await click(submitButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const [first, second] = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
