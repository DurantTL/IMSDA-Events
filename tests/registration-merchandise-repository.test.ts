import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const catalogMock = vi.hoisted(() => ({ getMerchandiseCatalogForProjection: vi.fn() }));
vi.mock("@/modules/merchandise/catalog-repository", () => catalogMock);

import { getPublicMerchandiseOffer, getRegistrationMerchandiseSummary, recordRegistrationMerchandiseOrder } from "@/modules/merchandise/registration-orders";
import { RegistrationMerchandiseError } from "@/modules/merchandise/registration-order-domain";

/** Synthetic catalog and a mocked transaction only. */
const catalog = (status: "APPROVED" | "DRAFT" = "APPROVED", quantity: number | null = 5) => ({
  eventId: "event_1", status, isEnabled: true,
  products: [{ id: "product_1", eventId: "event_1", name: "Camp Shirt", description: null, isEnabled: true, isArchived: false, position: 0, artwork: null, variants: [{
    id: "v1", label: "Medium", sku: null, isEnabled: true, isArchived: false,
    availability: { id: "av1", priceCents: 2500, taxTreatment: "TAXABLE", feePolicy: "ABSORBED_BY_EVENT", inventoryPolicy: quantity === null ? "UNLIMITED" : "TRACKED", inventoryQuantity: quantity, minQuantity: 1, maxQuantity: null, attendeeAvailability: "ALL", salesStartsAt: null, salesEndsAt: null, isActive: true },
  }] }],
});
function makeTx(sold = 0) {
  return {
    $queryRaw: vi.fn(async () => []),
    merchandiseOrderLine: { groupBy: vi.fn(async () => (sold > 0 ? [{ variantId: "v1", _sum: { quantity: sold } }] : [])) },
    merchandiseOrder: { create: vi.fn(async () => ({ id: "order_1" })), findFirst: vi.fn() },
  };
}
const input = { eventId: "event_1", registrationId: "reg_1", confirmationCode: "REG-ABC", purchaser: { name: "Avery Guest", email: "guest@example.test" }, lines: [{ variantId: "v1", quantity: 2 }], now: new Date("2027-03-01T12:00:00Z") };

beforeEach(() => { vi.clearAllMocks(); catalogMock.getMerchandiseCatalogForProjection.mockResolvedValue(catalog()); });

describe("recordRegistrationMerchandiseOrder", () => {
  it("locks the variant rows, then creates a pending unpaid order linked to the registration", async () => {
    const tx = makeTx();
    const summary = await recordRegistrationMerchandiseOrder(tx as never, input);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockQuery = JSON.stringify(tx.$queryRaw.mock.calls[0]);
    expect(lockQuery).toMatch(/FOR UPDATE/);
    expect(lockQuery).toMatch(/eventId/);
    expect(lockQuery).toContain("event_1");
    expect(catalogMock.getMerchandiseCatalogForProjection).toHaveBeenCalledWith("event_1", {}, tx);
    expect(tx.merchandiseOrder.create).toHaveBeenCalledTimes(1);
    const data = (tx.merchandiseOrder.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> & { lines: { create: Array<Record<string, unknown>> } } }])[0].data;
    expect(data).toMatchObject({
      eventId: "event_1", registrationId: "reg_1", clientRequestId: "registration:reg_1", status: "PENDING", paymentMethod: null,
      subtotalCents: 5000, feeCents: 0, taxCents: 0, totalCents: 5000,
      purchaserSnapshot: { name: "Avery Guest", email: "guest@example.test", confirmationCode: "REG-ABC" },
    });
    expect(data.lines.create).toEqual([expect.objectContaining({ eventId: "event_1", productNameSnapshot: "Camp Shirt", variantLabelSnapshot: "Medium", variantId: "v1", availabilityId: "av1", unitPriceCentsSnapshot: 2500, quantity: 2, lineTotalCents: 5000 })]);
    expect(summary).toEqual({ lines: [{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 2, lineTotalCents: 5000 }], totalCents: 5000 });
  });

  it("counts units already on pending or paid orders and refuses without creating", async () => {
    const tx = makeTx(4);
    await expect(recordRegistrationMerchandiseOrder(tx as never, input)).rejects.toBeInstanceOf(RegistrationMerchandiseError);
    expect(tx.merchandiseOrderLine.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ order: {
      status: { in: ["PENDING", "PAID", "COMPED"] },
      OR: [{ registrationId: null }, { registration: { status: { not: "CANCELLED" } } }],
    } }) }));
    expect(tx.merchandiseOrder.create).not.toHaveBeenCalled();
  });

  it("refuses when the catalog is not approved", async () => {
    catalogMock.getMerchandiseCatalogForProjection.mockResolvedValue(catalog("DRAFT"));
    const tx = makeTx();
    await expect(recordRegistrationMerchandiseOrder(tx as never, input)).rejects.toMatchObject({ code: "VARIANT_UNAVAILABLE" });
    expect(tx.merchandiseOrder.create).not.toHaveBeenCalled();
  });
});

describe("getPublicMerchandiseOffer", () => {
  it("is null for a catalog that is not approved", async () => {
    catalogMock.getMerchandiseCatalogForProjection.mockResolvedValue(catalog("DRAFT"));
    expect(await getPublicMerchandiseOffer("event_1", makeTx() as never)).toBeNull();
  });

  it("marks a size sold out once pending orders take the stock", async () => {
    const offer = await getPublicMerchandiseOffer("event_1", makeTx(5) as never);
    expect(offer?.products[0]?.variants[0]).toMatchObject({ id: "v1", soldOut: true });
  });
});

describe("getRegistrationMerchandiseSummary", () => {
  it("reads only the registration's own order", async () => {
    const tx = makeTx();
    tx.merchandiseOrder.findFirst.mockResolvedValue({ totalCents: 2500, lines: [{ productNameSnapshot: "Camp Shirt", variantLabelSnapshot: "Medium", quantity: 1, lineTotalCents: 2500 }] });
    expect(await getRegistrationMerchandiseSummary(tx as never, "reg_1")).toEqual({ lines: [{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 1, lineTotalCents: 2500 }], totalCents: 2500 });
    expect(tx.merchandiseOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { registrationId: "reg_1", clientRequestId: "registration:reg_1" } }));
    tx.merchandiseOrder.findFirst.mockResolvedValue(null);
    expect(await getRegistrationMerchandiseSummary(tx as never, "reg_2")).toBeNull();
  });
});
