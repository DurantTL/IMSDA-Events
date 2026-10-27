// @vitest-environment jsdom
import { createElement, useEffect, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/script", () => {
  function SquareScript({ onReady }: { onReady?: () => void }) {
    useEffect(() => { onReady?.(); }, [onReady]);
    return null;
  }
  return { default: SquareScript };
});

import { PublicSquarePayment } from "@/components/public-square-payment";
import { SITE_UPDATING_MESSAGE } from "@/lib/submit-json";
import { buttonByText, click, mount, type Mounted } from "./helpers/dom-render";

/**
 * A payment submitted while the site restarts never double-charges (#1263): the card token and the
 * idempotency key survive, "Try again" re-sends the same ones, and one click is one request.
 * Synthetic data only; the Square SDK is a stand-in.
 */
const checkout = {
  state: "READY", message: "", amountCents: 12_500, balanceCents: 12_500, surchargeCents: 0, currency: "USD",
  cardSelected: true, paymentKind: "BALANCE", deposit: null, depositRecorded: false, hostedLink: true, paymentChoice: null,
  square: { environment: "sandbox", applicationId: "sandbox-sq0idb-synthetic", locationId: "L_SYNTHETIC", scriptUrl: "https://sandbox.web.squarecdn.com/v1/square.js" },
  billingContact: { givenName: "Avery", familyName: "Guest", email: "guest@example.test", phone: "(515) 555-0100" },
};

let mounted: Mounted | null = null;
const tokenize = vi.fn(async () => ({ status: "OK", token: "cnon:synthetic-token" }));

type Call = { url: string; method: string; body: Record<string, unknown> | null };
/** POSTs fail with `failure` until `state.failing` is turned off, then answer with `success`. */
function installFetch(failure: () => Response, success: () => Response) {
  const calls: Call[] = [];
  const state = { failing: true };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(JSON.stringify({ checkout }), { status: 200 });
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return state.failing ? failure() : success();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, state };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  (window as unknown as { Square: unknown }).Square = {
    payments: async () => ({
      paymentRequest: () => ({}),
      card: async () => ({ attach: async () => undefined, tokenize, destroy: async () => undefined }),
      applePay: async () => { throw new Error("no apple pay"); },
      googlePay: async () => { throw new Error("no google pay"); },
    }),
  };
  tokenize.mockClear();
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { Square?: unknown }).Square;
});

async function open() {
  mounted = await mount(createElement(PublicSquarePayment, { token: "synthetic-token" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  return mounted.container;
}

const payment = () => ({ payment: { status: "SUCCEEDED", message: "Payment received." } });
const failures: Array<[string, () => Response]> = [
  ["a network error", () => { throw new TypeError("Failed to fetch"); }],
  ["a 502 gateway page", () => new Response("<html>Bad Gateway</html>", { status: 502 })],
  ["a 503 page", () => new Response("<html>Unavailable</html>", { status: 503 })],
];

describe("card payment during a restart (#1263)", () => {
  it.each(failures)("after %s, Try again re-sends the same key and the same card token, without a second tokenize", async (_label, failure) => {
    const { calls, state } = installFetch(failure, () => new Response(JSON.stringify(payment()), { status: 200 }));
    const container = await open();
    const payButton = container.querySelector<HTMLButtonElement>(".public-square-pay-button")!;
    expect(payButton.disabled).toBe(false);

    await click(payButton);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(container.querySelector(".submit-retry-notice")!.textContent).toContain(SITE_UPDATING_MESSAGE);
    const failed = calls.length;
    expect(failed).toBe(2); // the key makes exactly one quiet retry safe

    state.failing = false;
    await click(buttonByText(container, "Try again"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(calls.length).toBe(failed + 1);
    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(new Set(calls.map((call) => call.body!.idempotencyKey)).size).toBe(1);
    expect(new Set(calls.map((call) => call.body!.sourceId))).toEqual(new Set(["cnon:synthetic-token"]));
    expect(calls.every((call) => call.url.endsWith("/payment"))).toBe(true);
    expect(container.querySelector(".submit-retry-notice")).toBeNull();
    expect(container.textContent).toContain("Payment received.");
  });

  it("sends one payment request per click while one is in flight", async () => {
    let release!: (response: Response) => void;
    const calls: Call[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ checkout }), { status: 200 });
      calls.push({ url, method: "POST", body: JSON.parse(String(init!.body)) });
      return new Promise<Response>((resolve) => { release = resolve; });
    }));
    const container = await open();
    const payButton = container.querySelector<HTMLButtonElement>(".public-square-pay-button")!;
    await click(payButton);
    await click(payButton);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(calls).toHaveLength(1);
    await act(async () => { release(new Response(JSON.stringify(payment()), { status: 200 })); });
  });

  it("does not call a retryable JSON answer from the payment service 'updating'", async () => {
    const { calls } = installFetch(() => new Response(JSON.stringify({ message: "Square is still confirming.", retryable: true }), { status: 409 }), () => new Response("{}"));
    const container = await open();
    await click(container.querySelector<HTMLButtonElement>(".public-square-pay-button")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(calls).toHaveLength(1);
    expect(container.querySelector(".submit-retry-notice")).toBeNull();
    expect(container.textContent).toContain("Square is still confirming.");
  });
});

describe("card payment after a timeout (#1263)", () => {
  it("keeps the key and the card token, so the next press replays the same payment without a second tokenize", async () => {
    const calls: Call[] = [];
    let hang = true;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return Promise.resolve(new Response(JSON.stringify({ checkout }), { status: 200 }));
      calls.push({ url, method: "POST", body: JSON.parse(String(init!.body)) });
      if (!hang) return Promise.resolve(new Response(JSON.stringify(payment()), { status: 200 }));
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }));
    const container = await open();
    await click(container.querySelector<HTMLButtonElement>(".public-square-pay-button")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(calls).toHaveLength(1);
    expect(container.querySelector(".submit-retry-notice")).toBeNull();
    hang = false;
    await click(container.querySelector<HTMLButtonElement>(".public-square-pay-button")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toHaveLength(2);
    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(calls[1]!.body!.idempotencyKey).toBe(calls[0]!.body!.idempotencyKey);
    expect(calls[1]!.body!.sourceId).toBe(calls[0]!.body!.sourceId);
  });
});

/** Hangs until aborted (a timeout), then, when `hang` is turned off, answers `success`. */
function installTimeoutFetch(checkoutBody: unknown, success: () => Response) {
  const calls: Call[] = [];
  const state = { hang: true };
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") return Promise.resolve(new Response(JSON.stringify({ checkout: checkoutBody }), { status: 200 }));
    calls.push({ url, method: "POST", body: JSON.parse(String(init!.body)) });
    if (!state.hang) return Promise.resolve(success());
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }));
  return { calls, state };
}

describe("Pay on Square and payment choice after a timeout (#1263)", () => {
  it("reuses the same link key and return id on the next press", async () => {
    const { calls, state } = installTimeoutFetch(checkout, () => new Response(JSON.stringify({ message: "No link available." }), { status: 422 }));
    const container = await open();
    await click(container.querySelector<HTMLButtonElement>(".public-square-hosted-button")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(calls).toHaveLength(1);
    state.hang = false;
    await click(container.querySelector<HTMLButtonElement>(".public-square-hosted-button")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body!.idempotencyKey).toBe(calls[0]!.body!.idempotencyKey);
    expect(calls[1]!.body!.returnId).toBe(calls[0]!.body!.returnId);
  });

  it("replays the same payment-choice request id on the next press", async () => {
    const choiceCheckout = {
      ...checkout, state: "CHOICE_REQUIRED", hostedLink: false,
      paymentChoice: { available: true, locked: false, selected: null, currentOperationId: null, baseSubtotalCents: 12_000, cardProcessingFeeCents: 500, cardTotalCents: 12_500, payLaterTotalCents: 12_000 },
    };
    const { calls, state } = installTimeoutFetch(choiceCheckout, () => new Response(JSON.stringify({ message: "Not saved." }), { status: 422 }));
    const container = await open();
    const choiceButton = () => container.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    await click(choiceButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(calls).toHaveLength(1);
    state.hang = false;
    await click(choiceButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body!.clientRequestId).toBe(calls[0]!.body!.clientRequestId);
    expect(calls.every((call) => call.url.endsWith("/payment-choice"))).toBe(true);
  });
});

describe("Pay on Square during a restart (#1263)", () => {
  it("keeps the link key and return id on Try again, and does not leave the page on a failure", async () => {
    const { calls, state } = installFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 }), () => new Response(JSON.stringify({ message: "No link available." }), { status: 422 }));
    const container = await open();
    await click(container.querySelector<HTMLButtonElement>(".public-square-hosted-button")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelector(".submit-retry-notice")).not.toBeNull();
    state.failing = false;
    await click(buttonByText(container, "Try again"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const links = calls.filter((call) => call.url.endsWith("/payment-link"));
    expect(new Set(links.map((call) => call.body!.idempotencyKey)).size).toBe(1);
    expect(new Set(links.map((call) => call.body!.returnId)).size).toBe(1);
  });
});
