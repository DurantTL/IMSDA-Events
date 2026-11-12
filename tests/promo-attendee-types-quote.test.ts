import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import { getPublicPromoCodeQuote } from "@/modules/promo-codes/repository";

/** The public quote judges a restricted code on the server, from the attendee types the submission will save. Synthetic data only. */

const field = (id: string, key: string, label: string, type: string, scope: string, extra: Record<string, unknown> = {}) => ({
  id, key, label, type, scope, required: false, helpText: "", options: [], ...extra,
});

const registrationLevel = registrationFormDefinitionSchema.parse({
  title: "Synthetic retreat",
  description: "Synthetic form.",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 6, attendeeLabel: "Attendee", addButtonLabel: "Add attendee" },
  sections: [{
    id: "details", title: "Details", description: "",
    fields: [
      field("first_field", "first_name", "First name", "TEXT", "ATTENDEE", { required: true }),
      field("last_field", "last_name", "Last name", "TEXT", "ATTENDEE", { required: true }),
      field("type_field", "attendee_type", "Attendee type", "RADIO", "ATTENDEE", { required: true, optionSource: "ATTENDEE_TYPES" }),
      field("fee_field", "fee", "Registration", "CHECKBOX", "ATTENDEE", { priceCents: 10_000 }),
      field("promo_field", "promo_code", "Promo code", "TEXT", "REGISTRATION"),
    ],
  }],
});
const perPerson = registrationFormDefinitionSchema.parse({
  ...registrationLevel,
  sections: [{
    ...registrationLevel.sections[0],
    fields: registrationLevel.sections[0]!.fields.map((candidate) => (
      candidate.key === "promo_code" ? { ...candidate, scope: "ATTENDEE" } : candidate
    )),
  }],
});

const types = [
  { id: "t1", code: "ADULT", label: "Adult", description: "", sortOrder: 0, isActive: true },
  { id: "t2", code: "TEEN", label: "Teen", description: "", sortOrder: 1, isActive: true },
];

function setForm(definition: unknown, promo: Record<string, unknown>) {
  dependencies.getPrisma.mockReturnValue({
    registrationForm: {
      findFirst: vi.fn().mockResolvedValue({
        id: "form_1", slug: "registration", eventId: "event_1",
        event: {
          timezone: "America/Chicago", audience: "GENERAL", endsAt: new Date("2027-03-01T22:00:00.000Z"), isPublished: true,
          registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false, billingMode: "ATTENDEE_PAY", attendeeTypes: types,
        },
        versions: [{ id: "version_1", definition }],
      }),
    },
    promoCode: {
      findUnique: vi.fn().mockResolvedValue({
        id: "promo_1", code: "TEENS10", normalizedCode: "TEENS10", isActive: true, discountType: "PERCENT_BPS", discountValue: 1000,
        startsOn: null, endsOn: null, minimumSubtotalCents: null, maximumUses: null, maximumDiscountCents: null, redeemedCount: 0,
        sponsoringOrganizationId: null, attendeeTypeCodes: ["TEEN"], ...promo,
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  });
}

const person = (clientId: string, type: string, code = "") => ({
  clientId,
  responses: { first_name: clientId, last_name: "Lee", email: `${clientId}@example.org`, attendee_type: type, fee: true, ...(code ? { promo_code: code } : {}) },
});
const quoteInput = (attendees: unknown[], code = "TEENS10") => ({
  versionId: "version_1", code, responses: {}, attendees,
}) as unknown as Parameters<typeof getPublicPromoCodeQuote>[2];
const now = new Date("2027-02-01T12:00:00.000Z");

beforeEach(() => vi.clearAllMocks());

describe("public quote for a code restricted to attendee types (#102)", () => {
  it("registration-level: discounts only the allowed type's lines", async () => {
    setForm(registrationLevel, {});
    const quote = await getPublicPromoCodeQuote("synthetic-retreat", "registration", quoteInput([person("a1", "ADULT"), person("t1", "TEEN"), person("t2", "TEEN")]), now);
    expect(quote).toMatchObject({ preDiscountSubtotalCents: 30_000, discountAmountCents: 2_000, subtotalCents: 28_000 });
  });

  it("registration-level: refuses when nobody on the registration is of an allowed type", async () => {
    setForm(registrationLevel, {});
    await expect(getPublicPromoCodeQuote("synthetic-retreat", "registration", quoteInput([person("a1", "ADULT")]), now))
      .rejects.toMatchObject({ reason: "ATTENDEE_TYPE_NOT_ELIGIBLE", message: "TEENS10 doesn't apply to anyone on this registration." });
  });

  it("registration-level: an unrestricted code still discounts everyone", async () => {
    setForm(registrationLevel, { attendeeTypeCodes: [] });
    const quote = await getPublicPromoCodeQuote("synthetic-retreat", "registration", quoteInput([person("a1", "ADULT"), person("t1", "TEEN")]), now);
    expect(quote).toMatchObject({ preDiscountSubtotalCents: 20_000, discountAmountCents: 2_000 });
  });

  it("registration-level: the minimum is checked against the eligible subtotal", async () => {
    setForm(registrationLevel, { minimumSubtotalCents: 15_000 });
    await expect(getPublicPromoCodeQuote("synthetic-retreat", "registration", quoteInput([person("a1", "ADULT"), person("a2", "ADULT"), person("t1", "TEEN")]), now))
      .rejects.toMatchObject({ reason: "MINIMUM_NOT_MET" });
  });

  it("per person: warns on the adult and discounts the teen", async () => {
    setForm(perPerson, {});
    const quote = await getPublicPromoCodeQuote("synthetic-retreat", "registration", quoteInput([person("a1", "ADULT", "TEENS10"), person("t1", "TEEN", "TEENS10")]), now) as unknown as {
      attendeeDiscounts: Array<{ attendeeIndex: number; discountAmountCents: number }>;
      attendeeIssues: Array<{ attendeeIndex: number; message: string }>;
    };
    expect(quote.attendeeDiscounts).toEqual([expect.objectContaining({ attendeeIndex: 1, discountAmountCents: 1_000 })]);
    expect(quote.attendeeIssues).toEqual([expect.objectContaining({ attendeeIndex: 0, message: "TEENS10 doesn't apply to this attendee type." })]);
  });
});
