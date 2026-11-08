import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/public-metrics/repository", () => ({ recordPublicMetric: vi.fn() }));

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/modules/forms/public-repository", () => ({
  PublicRegistrationError: class extends Error {},
  getPublicRegistrationExperience: vi.fn(),
  submitPublicRegistration: mocks.submit,
}));
vi.mock("@/modules/rate-limit/service", () => ({
  checkPublicRegistrationRateLimit: vi.fn(async () => ({ allowed: true, decisions: [] })),
  checkPublicFormRoommateLookupRateLimit: vi.fn(async () => ({ allowed: true, decisions: [] })),
  publicRequestClientHash: vi.fn(() => "client-hash-1"),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { POST } from "@/app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { preparePublicRegistration, type PublicRegistrationInput } from "@/modules/forms/public-domain";

/**
 * #1445 (rule P1), route level: the registration route is given a body the way the privacy-browser journey tampers it
 * (a fake total at the top, or amount keys inside the answers) while the page's price preview is broken. The route
 * refuses the first and, for the second, hands the shared pricing function a body whose total is still the form's own.
 * The page sends no total at all: `versionId`, `idempotencyKey`, `responses`, `website` (plus attendees, responsible
 * adults and lodging where used).
 */

const form = registrationFormDefinitionSchema.parse({
  title: "Tampered total check",
  description: "",
  confirmationMessage: "Received.",
  payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Credit / debit card", percentageBasisPoints: 0, fixedFeeCents: 0, passFeeToRegistrant: false },
  sections: [{
    id: "s_1_id", title: "Registration", description: "",
    fields: [
      { id: "f_1_id", key: "ticket", label: "Ticket", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Standard", "Premium"], choicePricesCents: { Standard: 5000, Premium: 9000 } },
      { id: "f_2_id", key: "shirts", label: "Shirts", helpText: "", type: "NUMBER", scope: "REGISTRATION", required: false, options: [], priceCents: 1500 },
      { id: "f_3_id", key: "payment_method", label: "Payment method", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Pay later", "Credit / debit card"] },
    ],
  }],
});
const SERVER_TOTAL_CENTS = 5000 + 2 * 1500;
const KEY = "5b0c8c4e-6f6d-4f6b-9f7e-0f1e2d3c4b5a";
const AMOUNT_KEYS = ["total", "totalAmount", "totalCents", "subtotalCents", "amount", "amountCents", "price", "priceCents", "fee", "processingFeeCents", "discount", "discountAmountCents", "balanceCents"];
const fake = Object.fromEntries(AMOUNT_KEYS.map((key) => [key, key.includes("iscount") ? -500 : 1]));
const context = { params: Promise.resolve({ eventSlug: "summer-retreat", formSlug: "attendee" }) };

function post(body: unknown) {
  return POST(new Request("https://events.imsda.test/api/public/events/summer-retreat/forms/attendee/registrations", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify(body),
  }), context);
}

beforeEach(() => {
  // Stands in for the repository: the same shared function prices the answers it was given.
  mocks.submit.mockImplementation(async (_event: string, _form: string, input: PublicRegistrationInput) => {
    const prepared = preparePublicRegistration(form, input, { timeZone: "America/Chicago", now: new Date("2026-11-01T18:00:00Z") });
    return { confirmationCode: "REG-TAMPER", totalAmountCents: prepared.calculation.totalCents };
  });
});
afterEach(() => vi.resetAllMocks());

describe("registration route with a tampered total (#1445, P1)", () => {
  it("refuses an amount key at the top of the body and stores nothing", async () => {
    for (const key of AMOUNT_KEYS) {
      const response = await post({ versionId: "v1", idempotencyKey: KEY, responses: { ticket: "Standard", shirts: 2, payment_method: "Pay later" }, website: "", [key]: 1 });
      expect(response.status, key).toBe(400);
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("prices the answers from the form's own prices, and reports amount keys in them as unknown fields", async () => {
    const answers = { ticket: "Standard", shirts: 2, payment_method: "Pay later", ...fake, ticket_price: 1 };
    const body = { versionId: "v1", idempotencyKey: KEY, responses: answers, website: "" };
    // The route passes the answers on; the repository then refuses them (422 UNKNOWN_FIELD, see the browser journey).
    expect((await post(body)).status).toBe(201);
    const sent = mocks.submit.mock.calls[0][2] as PublicRegistrationInput;
    const prepared = preparePublicRegistration(form, sent, { timeZone: "America/Chicago", now: new Date("2026-11-01T18:00:00Z") });
    const unknown = prepared.issues.filter((issue) => issue.code === "UNKNOWN_FIELD").map((issue) => issue.key).sort();
    expect(unknown).toEqual([...AMOUNT_KEYS, "ticket_price"].sort());
    expect(prepared.calculation.totalCents).toBe(SERVER_TOTAL_CENTS);
    for (const key of AMOUNT_KEYS) expect(Object.keys(prepared.responses)).not.toContain(key);
  });
});
