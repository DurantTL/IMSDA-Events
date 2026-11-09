import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_ORDERS_GROUP_KEY_PREFIX } from "@/modules/club-orders/conference-orders";
import { CHURCH_PROMO_GROUP_KEY_PREFIX } from "@/modules/promo-codes/church-invoice";

vi.mock("server-only", () => ({}));

const prisma = {
  event: { findUnique: vi.fn() },
  invoice: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ getPrisma: () => prisma }));

const { countOpenInvoiceDrafts } = await import("@/modules/invoices/repository");

beforeEach(() => {
  prisma.event.findUnique.mockReset();
  prisma.invoice.findMany.mockReset();
  prisma.event.findUnique.mockResolvedValue({ billingMode: "DEFERRED_ORGANIZATION_INVOICE" });
});

describe("open invoice draft count (#1575)", () => {
  it("asks for the Invoices page's invoices only: church promo-code invoices left out, discarded versions ignored", async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    await countOpenInvoiceDrafts("evt_1");
    const args = prisma.invoice.findMany.mock.calls[0][0];
    expect(args.where.eventId).toBe("evt_1");
    // Church promo-code invoices and club-order invoices (#1688) are left out, as on the Invoices page.
    expect(args.where.AND).toEqual([
      { NOT: { groupKey: { startsWith: CHURCH_PROMO_GROUP_KEY_PREFIX } } },
      { NOT: { groupKey: { startsWith: CLUB_ORDERS_GROUP_KEY_PREFIX } } },
    ]);
    expect(args.select.versions.where).toEqual({ status: { not: "DISCARDED" } });
    expect(args.select.versions.take).toBe(1);
  });

  it("counts an invoice whose latest live version is a draft, like the page's Drafts number", async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { versions: [{ status: "DRAFT" }] },
      { versions: [{ status: "FINALIZED" }] },
      { versions: [] },
      { versions: [{ status: "DRAFT" }] },
    ]);
    expect(await countOpenInvoiceDrafts("evt_1")).toBe(2);
  });

  it("is 0 when only a church promo-code draft exists (the database filter returns nothing for it)", async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    expect(await countOpenInvoiceDrafts("evt_1")).toBe(0);
  });

  it("is 0 for an event not billed to organizations, as the page shows no drafts there", async () => {
    prisma.event.findUnique.mockResolvedValue({ billingMode: "PAY_AT_REGISTRATION" });
    expect(await countOpenInvoiceDrafts("evt_1")).toBe(0);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});
