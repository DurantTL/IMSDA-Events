// @vitest-environment jsdom
import { createElement, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { PublicRegistrationForm } from "@/components/public-registration-form";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { buttonByText, click, mount, typeInto, type Mounted } from "./helpers/dom-render";

/**
 * Submit pressed while the promo total is being re-quoted (#1404): it waits for the new quote, then sends,
 * or stops with a message that stays. Synthetic data only.
 */
const base = { helpText: "", options: [] as string[], scope: "REGISTRATION", required: false };
const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic retreat form", description: "Synthetic.", confirmationMessage: "Received.",
  payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Credit / debit card", percentageBasisPoints: 290, fixedFeeCents: 30, passFeeToRegistrant: true },
  sections: [{ id: "details", title: "Details", description: "", fields: [
    { ...base, id: "contact_field", key: "contact_name", label: "Contact name", type: "TEXT", required: true },
    { ...base, id: "email_field", key: "email", label: "Email", type: "EMAIL", required: true },
    { ...base, id: "fee_field", key: "registration_type", label: "Registration type", type: "SELECT", required: true, options: ["Adult", "Youth"], choicePricesCents: { Adult: 10000, Youth: 5000 } },
    { ...base, id: "promo_field", key: "promo_code", label: "Promo code", type: "TEXT" },
    { ...base, id: "payment_field", key: "payment_method", label: "Payment method", type: "SELECT", required: true, options: ["Pay later by check", "Credit / debit card"] },
    { ...base, id: "ack_field", key: "ack", label: "Acknowledgment", type: "ACKNOWLEDGMENT", required: true, acknowledgment: { source: "TEXT", text: "I agree to the synthetic terms." } },
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
  confirmationCode: "SYN-0001", registrationStatus: "CONFIRMED", message: "Received.", email: "guest@example.test", promoCode: "MOCK10",
  totalCents: 9330, balanceCents: 9330, lineItems: [], pricingDate: "2026-09-29", cardSelected: true, emailSent: true,
  paymentCollected: false, notificationQueued: false, notificationStatus: "SENT", managePath: "/manage/synthetic",
};
const quote = (promoCode = "MOCK10") => ({
  promoCode, discountAmountCents: 1000, preDiscountSubtotalCents: 10000, subtotalCents: 9000, totalCents: 9330, processingFeeCents: 330, lineItems: [],
});

let mounted: Mounted | null = null;
let promoResponses: Array<() => Response | Promise<Response>> = [];
let promoCalls = 0;
const fetchMock = vi.fn(async (url: string) => {
  if (String(url).endsWith("/promo-code")) { promoCalls += 1; return promoResponses.shift()!(); }
  return new Response(JSON.stringify({ confirmation }), { status: 201 });
});
const registrationCalls = () => fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/promo-code"));
const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const radio = (container: HTMLElement, value: string) => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((input) => input.closest("label")?.textContent?.includes(value))!;
const submitButtons = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>("button[type='submit']")];

async function reachReviewWithPromo(container: HTMLElement) {
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])')].filter((input) => !input.closest(".public-registration-honeypot"));
  await typeInto(inputs.find((input) => input.type === "email")!, "guest@example.test");
  await typeInto(inputs.find((input) => input.type !== "email")!, "Avery Guest");
  await click(radio(container, "Adult"));
  const promo = inputs.find((input) => input.getAttribute("autocomplete") === "off")!;
  await typeInto(promo, "MOCK10");
  await click(radio(container, "Pay later by check"));
  await click(buttonByText(container, "Apply"));
  await settle(0);
  await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
}

/** Choosing card changes the processing fee, so the quote is stale and a re-quote waits on its debounce. */
async function chooseCard(container: HTMLElement) {
  await click(radio(container, "Credit / debit card"));
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockClear();
  promoCalls = 0;
  promoResponses = [() => new Response(JSON.stringify({ quote: quote() }), { status: 200 })];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public registration: submit during a promo re-quote (#1404)", () => {
  it("queues the submit, shows Updating total…, then sends one request with the new quote", async () => {
    let release!: (response: Response) => void;
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReviewWithPromo(container);
    expect(promoCalls).toBe(1);
    await chooseCard(container);
    promoResponses.push(() => new Promise<Response>((resolve) => { release = resolve; }));

    await click(submitButtons(container)[0]!); // straight away: the 700ms debounce has not fired
    expect(promoCalls).toBe(2); // the re-quote started at once
    expect(registrationCalls()).toHaveLength(0);
    for (const button of submitButtons(container)) {
      expect(button.textContent).toContain("Updating total…");
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.disabled).toBe(true);
    }
    expect([...container.querySelectorAll('p.sr-only[role="status"]')].map((node) => node.textContent)).toContain("Updating total…");

    await act(async () => { container.querySelector("form")!.requestSubmit(); }); // a second submit does nothing extra
    expect(promoCalls).toBe(2);

    await act(async () => { release(new Response(JSON.stringify({ quote: quote() }), { status: 200 })); });
    await settle(0);
    expect(registrationCalls()).toHaveLength(1);
    const body = JSON.parse(String((registrationCalls()[0] as unknown as [string, RequestInit])[1].body));
    expect(body.responses).toMatchObject({ promo_code: "MOCK10", payment_method: "Credit / debit card" });
    await settle(5000);
    expect(registrationCalls()).toHaveLength(1);
    expect(container.textContent).toContain("SYN-0001");
  });

  it("stops and keeps a message when the re-quote fails, sending no registration", async () => {
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReviewWithPromo(container);
    await chooseCard(container);
    promoResponses.push(() => new Response(JSON.stringify({ message: "That promo code has expired." }), { status: 400 }));

    await click(submitButtons(container)[0]!);
    await settle(0);
    await settle(5000);
    expect(registrationCalls()).toHaveLength(0);
    const alert = container.querySelector(".public-registration-error-summary")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("That promo code has expired.");
    expect(alert.textContent!.split("That promo code has expired.")).toHaveLength(2); // read once, not as heading and list item
    expect(submitButtons(container)[0]!.textContent).toContain("Submit registration");
    expect(submitButtons(container)[0]!.disabled).toBe(false);
  });

  it("stops with a message when the re-quote request cannot be made", async () => {
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    const { container } = mounted;
    await reachReviewWithPromo(container);
    await chooseCard(container);
    promoResponses.push(() => { throw new TypeError("Failed to fetch"); });
    await click(submitButtons(container)[0]!);
    await settle(5000);
    expect(registrationCalls()).toHaveLength(0);
    expect(container.querySelector(".public-registration-error-summary")!.textContent).toContain("could not be checked right now");
  });
});
