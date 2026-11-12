import { describe, expect, it } from "vitest";
import type { MerchandiseProjectionInput } from "@/modules/merchandise/catalog-domain";
import {
  buildPublicMerchandiseOffer,
  planRegistrationMerchandiseOrder,
  RegistrationMerchandiseError,
} from "@/modules/merchandise/registration-order-domain";
import { registrationMerchandiseSchema } from "@/modules/merchandise/registration-order-schema";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";

/** Synthetic catalog only. */
const NOW = "2027-03-01T12:00:00.000Z";
type Avail = Partial<NonNullable<MerchandiseProjectionInput["products"][number]["variants"][number]["availability"]>>;
function variant(id: string, label: string, availability: Avail | null = {}, extra: { isEnabled?: boolean } = {}) {
  return {
    id, label, sku: null, isEnabled: extra.isEnabled ?? true, isArchived: false,
    availability: availability === null ? null : {
      id: `av_${id}`, priceCents: 2500, taxTreatment: "TAXABLE" as const, feePolicy: "PASSED_TO_BUYER" as const,
      inventoryPolicy: "UNLIMITED" as const, inventoryQuantity: null, minQuantity: 1, maxQuantity: null,
      attendeeAvailability: "ALL", salesStartsAt: null, salesEndsAt: null, isActive: true, ...availability,
    },
  };
}
function catalog(variants: ReturnType<typeof variant>[], over: Partial<MerchandiseProjectionInput> = {}): MerchandiseProjectionInput {
  return {
    eventId: "event_1", status: "APPROVED", isEnabled: true,
    products: [{ id: "product_1", eventId: "event_1", name: "Camp Shirt", description: "Soft cotton", isEnabled: true, isArchived: false, position: 0, artwork: null, variants }],
    ...over,
  };
}
const ctx = { eventId: "event_1", registrationId: "reg_1", purchaserSnapshot: { name: "Avery Guest" } };
const plan = (c: MerchandiseProjectionInput, lines: Array<{ variantId: string; quantity: number; shownUnitPriceCents?: number }>, sold: Record<string, number> = {}) =>
  planRegistrationMerchandiseOrder(c, sold, { ...ctx, lines }, NOW);
function codeOf(fn: () => unknown) {
  try { fn(); } catch (error) { return error instanceof RegistrationMerchandiseError ? error.code : `other:${String(error)}`; }
  return null;
}

describe("public merchandise offer", () => {
  it("is null when the catalog is off, not approved, or empty", () => {
    const v = [variant("v1", "Medium")];
    expect(buildPublicMerchandiseOffer(catalog(v, { isEnabled: false }), {}, NOW)).toBeNull();
    expect(buildPublicMerchandiseOffer(catalog(v, { status: "PENDING_APPROVAL" }), {}, NOW)).toBeNull();
    expect(buildPublicMerchandiseOffer(catalog(v, { status: "DRAFT" }), {}, NOW)).toBeNull();
    expect(buildPublicMerchandiseOffer(catalog([]), {}, NOW)).toBeNull();
  });

  it("shows price, limits and sold-out, never stock counts", () => {
    const offer = buildPublicMerchandiseOffer(catalog([
      variant("v1", "Medium", { inventoryPolicy: "TRACKED", inventoryQuantity: 5 }),
      variant("v2", "Large", { inventoryPolicy: "TRACKED", inventoryQuantity: 5, maxQuantity: 3 }),
    ]), { v2: 5 }, NOW)!;
    expect(offer.products[0]!.variants).toEqual([
      { id: "v1", label: "Medium", priceCents: 2500, minQuantity: 1, maxQuantity: 10, soldOut: false },
      { id: "v2", label: "Large", priceCents: 2500, minQuantity: 1, maxQuantity: 3, soldOut: true },
    ]);
    expect(JSON.stringify(offer)).not.toMatch(/inventory/i);
  });

  it("hides disabled, closed-window, staff-only and unpriced variants, keeps registered-only", () => {
    const offer = buildPublicMerchandiseOffer(catalog([
      variant("v1", "Disabled", {}, { isEnabled: false }),
      variant("v2", "Ended", { salesEndsAt: "2027-02-01T00:00:00.000Z" }),
      variant("v3", "Staff", { attendeeAvailability: "STAFF_ONLY" }),
      variant("v4", "None", null),
      variant("v5", "Registered", { attendeeAvailability: "REGISTERED" }),
    ]), {}, NOW)!;
    expect(offer.products[0]!.variants.map((v) => v.label)).toEqual(["Registered"]);
  });
});

describe("planning a registration merchandise order", () => {
  it("prices from the catalog with no fee and no tax, and ignores browser prices", () => {
    const draft = plan(catalog([variant("v1", "Medium"), variant("v2", "Large", { priceCents: 3000 })]), [
      { variantId: "v1", quantity: 2, priceCents: 1, unitPriceCents: 1 } as never,
      { variantId: "v2", quantity: 1 },
    ]);
    expect(draft).toMatchObject({ subtotalCents: 8000, feeCents: 0, taxCents: 0, totalCents: 8000, clientRequestId: "registration:reg_1", registrationId: "reg_1" });
    expect(draft.lines.map((l) => [l.variantLabelSnapshot, l.unitPriceCentsSnapshot, l.lineTotalCents, l.availabilityId])).toEqual([["Medium", 2500, 5000, "av_v1"], ["Large", 3000, 3000, "av_v2"]]);
  });

  it("takes the last tracked item, and refuses one more", () => {
    const c = catalog([variant("v1", "Medium", { inventoryPolicy: "TRACKED", inventoryQuantity: 3 })]);
    expect(plan(c, [{ variantId: "v1", quantity: 1 }], { v1: 2 }).totalCents).toBe(2500);
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 2 }], { v1: 2 }))).toBe("SOLD_OUT");
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 1 }], { v1: 3 }))).toBe("SOLD_OUT");
  });

  it("accepts stock exactly enough", () => {
    const c = catalog([variant("v1", "Medium", { inventoryPolicy: "TRACKED", inventoryQuantity: 4 })]);
    expect(plan(c, [{ variantId: "v1", quantity: 4 }]).lines[0]!.quantity).toBe(4);
  });

  it("enforces minimum and maximum quantity", () => {
    const c = catalog([variant("v1", "Medium", { minQuantity: 2, maxQuantity: 4 })]);
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 1 }]))).toBe("INVALID_QUANTITY");
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 5 }]))).toBe("INVALID_QUANTITY");
    expect(plan(c, [{ variantId: "v1", quantity: 4 }]).lines[0]!.quantity).toBe(4);
  });

  it("refuses disabled, closed-window, unknown, staff-only and unapproved selections", () => {
    const c = catalog([
      variant("v1", "Off", {}, { isEnabled: false }),
      variant("v2", "Ended", { salesEndsAt: "2027-02-01T00:00:00.000Z" }),
      variant("v3", "Staff", { attendeeAvailability: "STAFF_ONLY" }),
      variant("v4", "Fine"),
    ]);
    for (const id of ["v1", "v2", "v3", "nope"]) expect(codeOf(() => plan(c, [{ variantId: id, quantity: 1 }]))).toBe("VARIANT_UNAVAILABLE");
    expect(codeOf(() => plan({ ...c, status: "DRAFT" }, [{ variantId: "v4", quantity: 1 }]))).toBe("VARIANT_UNAVAILABLE");
  });

  it("refuses a variant named twice", () => {
    const c = catalog([variant("v1", "Medium")]);
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 1 }, { variantId: "v1", quantity: 1 }]))).toBe("DUPLICATE_VARIANT");
  });

  it("applies the default maximum of 10 when staff set none", () => {
    const c = catalog([variant("v1", "Medium")]);
    expect(plan(c, [{ variantId: "v1", quantity: 10 }]).lines[0]!.quantity).toBe(10);
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 11 }]))).toBe("INVALID_QUANTITY");
  });

  it("refuses a stale shown price with its own code, and accepts a matching one", () => {
    const c = catalog([variant("v1", "Medium")]);
    expect(codeOf(() => plan(c, [{ variantId: "v1", quantity: 1, shownUnitPriceCents: 2000 }]))).toBe("PRICE_CHANGED");
    expect(() => plan(c, [{ variantId: "v1", quantity: 1, shownUnitPriceCents: 2000 }])).toThrow("the price of Camp Shirt Medium changed. Review it and submit again.");
    expect(plan(c, [{ variantId: "v1", quantity: 1, shownUnitPriceCents: 2500 }]).totalCents).toBe(2500);
  });

  it("says plainly which size is sold out", () => {
    const c = catalog([variant("v1", "Medium", { inventoryPolicy: "TRACKED", inventoryQuantity: 0 })]);
    expect(() => plan(c, [{ variantId: "v1", quantity: 1 }])).toThrow("Camp Shirt Medium is sold out. Remove it or choose another size.");
  });
});

describe("input schema", () => {
  const base = { versionId: "version_1", idempotencyKey: "5f1f6f27-0f8f-4f9b-8b37-2b6b6d6f1a11", responses: {} };
  it("keeps merchandise optional and strict", () => {
    expect(publicRegistrationInputSchema.safeParse(base).success).toBe(true);
    expect(publicRegistrationInputSchema.safeParse({ ...base, merchandise: [{ variantId: "v1", quantity: 2 }] }).success).toBe(true);
    expect(registrationMerchandiseSchema.safeParse([{ variantId: "v1", quantity: 0 }]).success).toBe(false);
    expect(registrationMerchandiseSchema.safeParse([{ variantId: "v1", quantity: 1, priceCents: 1 }]).success).toBe(false);
    expect(registrationMerchandiseSchema.safeParse(Array.from({ length: 51 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 }))).success).toBe(false);
  });
});
