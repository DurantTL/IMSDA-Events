// @vitest-environment jsdom
import { createElement, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { PublicRegistrationForm } from "@/components/public-registration-form";
import { PublicMerchandiseStep, merchandiseLines, merchandiseNotChargedNotice } from "@/components/public-merchandise-step";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import type { PublicMerchandiseOffer } from "@/modules/merchandise/registration-order-schema";
import { buttonByText, choose, click, mount, typeInto, type Mounted } from "./helpers/dom-render";

/** Synthetic form, people and merchandise only. */
const offer: PublicMerchandiseOffer = { products: [{
  id: "product_1", name: "Camp Shirt", description: "Soft cotton, synthetic.",
  variants: [
    { id: "v_m", label: "Medium", priceCents: 2500, minQuantity: 1, maxQuantity: 3, soldOut: false },
    { id: "v_l", label: "Large", priceCents: 2500, minQuantity: 1, maxQuantity: 10, soldOut: true },
  ],
}] };

const base = { helpText: "", options: [] as string[], scope: "REGISTRATION", required: false };
const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic retreat form", description: "Synthetic.", confirmationMessage: "Received.",
  sections: [{ id: "details", title: "Details", description: "", fields: [
    { ...base, id: "contact_field", key: "contact_name", label: "Contact name", type: "TEXT", required: true },
    { ...base, id: "email_field", key: "email", label: "Email", type: "EMAIL", required: true },
  ] }],
});
const props = {
  event: { name: "Synthetic Retreat", slug: "synthetic-retreat", startsAt: "2026-10-09T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z", timezone: "America/Chicago", location: null, capacity: null, billingMode: "ATTENDEE_PAY" },
  form: { slug: "main", versionId: "version-1", versionNumber: 1, definition },
  choiceUsage: {}, pricingDate: "2026-09-29",
  lifecycle: { phase: "OPEN" as const, capacityDecision: "REGISTER" as const, remainingSpots: null, waitingRegistrations: 0 },
};
const confirmation = {
  confirmationCode: "SYN-0001", registrationStatus: "SUBMITTED", message: "Received.", email: "guest@example.test", promoCode: null,
  totalCents: 0, lineItems: [], pricingDate: "2026-09-29", cardSelected: false, emailSent: true, paymentCollected: false, notificationQueued: false,
  notificationStatus: "SENT", managePath: "/manage/synthetic", attendeeCount: 1, attendeeNames: [],
  merchandise: { lines: [{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 2, lineTotalCents: 5000 }], totalCents: 5000 },
};

let mounted: Mounted | null = null;
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ confirmation }), { status: 201 }));
beforeEach(() => { window.localStorage.clear(); fetchMock.mockClear(); vi.stubGlobal("scrollTo", vi.fn()); vi.stubGlobal("fetch", fetchMock); });
afterEach(async () => { await mounted?.unmount(); mounted = null; vi.unstubAllGlobals(); });

describe("merchandise selection helpers", () => {
  it("ignores sold-out sizes and zero quantities", () => {
    expect(merchandiseLines(offer, { v_m: 2, v_l: 4 })).toEqual([{ productName: "Camp Shirt", variantLabel: "Medium", variantId: "v_m", quantity: 2, unitPriceCents: 2500, lineTotalCents: 5000 }]);
    expect(merchandiseLines(null, { v_m: 2 })).toEqual([]);
  });
});

describe("merchandise section", () => {
  it("labels each quantity, disables sold-out sizes and shows the subtotal and not-charged line", async () => {
    let selection = { v_m: 2 };
    mounted = await mount(createElement(PublicMerchandiseStep, { offer, selection, onChange: (next: Record<string, number>) => { selection = next as never; } }));
    const { container } = mounted;
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Camp Shirt Medium quantity"]')!;
    expect([...select.options].map((option) => option.value)).toEqual(["0", "1", "2", "3"]);
    expect(select.value).toBe("2");
    expect(container.querySelector('select[aria-label="Camp Shirt Large quantity"]')).toBeNull();
    expect(container.textContent).toContain("Sold out");
    expect(container.textContent).toContain("Merchandise subtotal");
    expect(container.textContent).toContain("$50.00");
    expect(container.textContent).toContain(merchandiseNotChargedNotice);
    await choose(select, "3");
    expect(selection).toEqual({ v_m: 3 });
  });
});

describe("individual registration form with merchandise", () => {
  async function fillAndReachReview(container: HTMLElement) {
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])')].filter((input) => !input.closest(".public-registration-honeypot"));
    await typeInto(inputs.find((input) => input.type === "email")!, "guest@example.test");
    await typeInto(inputs.find((input) => input.type !== "email")!, "Avery Guest");
    await click(buttonByText(container, "Continue"));
  }

  it("sends only variant ids and quantities, then shows the merchandise order on the confirmation", async () => {
    mounted = await mount(createElement(PublicRegistrationForm, { ...props, merchandise: offer } as never));
    const { container } = mounted;
    await fillAndReachReview(container);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Camp Shirt Medium quantity"]');
    expect(select).not.toBeNull();
    await choose(select!, "2");
    expect(container.textContent).toContain("Ordered separately");
    await act(async () => { container.querySelector("form")!.requestSubmit(); });
    await act(async () => { await Promise.resolve(); });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1].body)).merchandise).toEqual([{ variantId: "v_m", quantity: 2, shownUnitPriceCents: 2500 }]);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Merchandise order");
    expect(container.textContent).toContain("$50.00");
  });

  it("shows no merchandise section for a club registration or when there is no offer", async () => {
    mounted = await mount(createElement(PublicRegistrationForm, props as never));
    expect(mounted.container.querySelector('[data-testid="merchandise-step"]')).toBeNull();
  });
});
