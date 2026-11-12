import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  approve: vi.fn(),
  close: vi.fn(),
  getMerchandiseCatalog: vi.fn(),
  eventFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));

import { approveAndOpenCatalogSales, closeCatalogSales, MerchandiseCatalogApprovalError } from "@/modules/merchandise/catalog-approval";
import { merchandiseCatalogInputSchema } from "@/modules/merchandise/catalog-domain";
import { MerchandiseSalesStatus, merchandiseSalesStatusLine } from "@/components/merchandise-admin-workspace";

const now = new Date("2026-11-12T21:04:00Z");

function makeTx(overrides: { sellable?: number; catalog?: Record<string, unknown> | null } = {}) {
  const tx = {
    merchandiseProductVariant: { count: vi.fn().mockResolvedValue(overrides.sellable ?? 1) },
    merchandiseCatalog: {
      findUnique: vi.fn().mockResolvedValue(overrides.catalog ?? null),
      upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ id: "catalog_1", ...create })),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "catalog_1", eventId: "event_1", ...data })),
    },
    merchandiseOrder: { update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit_1" }) },
  };
  dependencies.getPrisma.mockReturnValue({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) });
  return tx;
}

beforeEach(() => vi.clearAllMocks());

describe("approveAndOpenCatalogSales", () => {
  it("approves, opens, records who and when, and audits", async () => {
    const tx = makeTx({ catalog: { id: "catalog_1", eventId: "event_1", isEnabled: false, status: "DRAFT", approvedAt: null, approvedByUserId: null } });
    const result = await approveAndOpenCatalogSales("event_1", "usr_admin", now);
    expect(tx.merchandiseCatalog.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { isEnabled: true, status: "APPROVED", approvedByUserId: "usr_admin", approvedAt: now } }));
    expect(result).toMatchObject({ status: "APPROVED", isEnabled: true, approvedByUserId: "usr_admin", changed: true });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "MERCHANDISE_CATALOG_APPROVED", entityType: "MerchandiseCatalog", eventId: "event_1", actorUserId: "usr_admin",
      metadata: { before: { isEnabled: false, status: "DRAFT" }, after: { isEnabled: true, status: "APPROVED" } },
    });
  });

  it("refuses a catalog with no enabled, active priced size", async () => {
    const tx = makeTx({ sellable: 0 });
    await expect(approveAndOpenCatalogSales("event_1", "usr_admin", now)).rejects.toBeInstanceOf(MerchandiseCatalogApprovalError);
    expect(tx.merchandiseCatalog.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("leaves an already approved and open catalog unchanged, with no new audit entry", async () => {
    const tx = makeTx({ catalog: { id: "catalog_1", eventId: "event_1", isEnabled: true, status: "APPROVED", approvedAt: now, approvedByUserId: "usr_first" } });
    const result = await approveAndOpenCatalogSales("event_1", "usr_other", now);
    expect(result).toMatchObject({ changed: false, approvedByUserId: "usr_first" });
    expect(tx.merchandiseCatalog.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("closeCatalogSales", () => {
  it("returns to draft, clears the approval, audits, and never touches orders", async () => {
    const tx = makeTx({ catalog: { id: "catalog_1", eventId: "event_1", isEnabled: true, status: "APPROVED", approvedAt: now, approvedByUserId: "usr_admin" } });
    const result = await closeCatalogSales("event_1", "usr_admin");
    expect(tx.merchandiseCatalog.update).toHaveBeenCalledWith({ where: { eventId: "event_1" }, data: { isEnabled: false, status: "DRAFT", approvedByUserId: null, approvedAt: null } });
    expect(result).toMatchObject({ status: "DRAFT", isEnabled: false, approvedAt: null, approvedByUserId: null, changed: true });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "MERCHANDISE_CATALOG_CLOSED", metadata: { before: { isEnabled: true, status: "APPROVED" }, after: { isEnabled: false, status: "DRAFT" } } });
    expect(tx.merchandiseOrder.update).not.toHaveBeenCalled();
    expect(tx.merchandiseOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.merchandiseOrder.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when sales are already closed", async () => {
    const tx = makeTx({ catalog: null });
    expect(await closeCatalogSales("event_1", "usr_admin")).toMatchObject({ changed: false, status: "DRAFT" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("normal staff save", () => {
  it("still refuses APPROVED", () => {
    expect(() => merchandiseCatalogInputSchema.parse({ status: "APPROVED" })).toThrow();
  });
});

describe("approval route", () => {
  const origin = "https://events.imsda.test";
  const params = { params: Promise.resolve({ eventId: "event_1" }) };
  const call = async (method: "POST" | "DELETE", requestOrigin = origin) => {
    vi.resetModules();
    vi.doMock("@/modules/merchandise/catalog-approval", () => ({
      approveAndOpenCatalogSales: dependencies.approve,
      closeCatalogSales: dependencies.close,
      MerchandiseCatalogApprovalError,
    }));
    vi.doMock("@/modules/merchandise/catalog-repository", () => ({ getMerchandiseCatalog: dependencies.getMerchandiseCatalog }));
    dependencies.getPrisma.mockReturnValue({ event: { findUnique: dependencies.eventFindUnique } });
    const route = await import("@/app/api/events/[eventId]/merchandise/approval/route");
    return route[method](new Request(`${origin}/api/events/event_1/merchandise/approval`, { method, headers: { origin: requestOrigin } }), params);
  };
  beforeEach(() => {
    dependencies.eventFindUnique.mockResolvedValue({ id: "event_1" });
    dependencies.getMerchandiseCatalog.mockResolvedValue({ eventId: "event_1", status: "APPROVED" });
  });

  it("returns 401 when signed out", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call("POST")).status).toBe(401);
    expect(dependencies.approve).not.toHaveBeenCalled();
  });

  it("returns 403 for an event administrator who is not a system administrator", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "usr_staff", email: "s@example.test", displayName: "Staff", globalRole: null } });
    expect((await call("POST")).status).toBe(403);
    expect((await call("DELETE")).status).toBe(403);
    expect(dependencies.approve).not.toHaveBeenCalled();
    expect(dependencies.close).not.toHaveBeenCalled();
  });

  it("lets a system administrator approve and close", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "usr_admin", email: "a@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    expect((await call("POST")).status).toBe(200);
    expect(dependencies.approve).toHaveBeenCalledWith("event_1", "usr_admin");
    expect((await call("DELETE")).status).toBe(200);
    expect(dependencies.close).toHaveBeenCalledWith("event_1", "usr_admin");
  });

  it("returns 404 for an unknown event and 409 when nothing is sellable", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "usr_admin", email: "a@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    dependencies.eventFindUnique.mockResolvedValueOnce(null);
    expect((await call("POST")).status).toBe(404);
    dependencies.approve.mockRejectedValueOnce(new MerchandiseCatalogApprovalError("NO_SELLABLE_PRODUCT", "Add a product."));
    expect((await call("POST")).status).toBe(409);
  });

  it("refuses a cross-origin request before checking the session", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "usr_admin", email: "a@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    expect((await call("POST", "https://untrusted.example")).status).toBe(403);
    expect(dependencies.approve).not.toHaveBeenCalled();
  });
});

describe("sales status line", () => {
  it("describes open and closed sales with a Central time label", () => {
    expect(merchandiseSalesStatusLine({ isEnabled: true, status: "APPROVED", approvedAt: "2026-11-12T21:04:00.000Z", approvedByName: "Pat Example" })).toBe("Sales open · approved by Pat Example on Nov 12, 2026, 3:04 PM CST");
    expect(merchandiseSalesStatusLine({ isEnabled: false, status: "DRAFT", approvedAt: null, approvedByName: null })).toBe("Sales closed · not approved");
  });
  it("shows the buttons to system administrators only", () => {
    const render = (canApproveSales: boolean, catalog: Parameters<typeof merchandiseSalesStatusLine>[0]) => renderToStaticMarkup(createElement(MerchandiseSalesStatus, { canApproveSales, catalog, onApprove: () => {}, onClose: () => {} }));
    const closed = { isEnabled: false, status: "DRAFT" as const, approvedAt: null, approvedByName: null };
    const open = { isEnabled: true, status: "APPROVED" as const, approvedAt: "2026-11-12T21:04:00.000Z", approvedByName: "Pat Example" };
    expect(render(true, closed)).toContain("Approve and open sales");
    expect(render(true, closed)).not.toContain("Close sales");
    expect(render(true, open)).toContain("Close sales");
    expect(render(true, open)).not.toContain("Approve and open sales");
    const staff = render(false, closed);
    expect(staff).toContain("A system administrator approves and opens sales.");
    expect(staff).not.toContain("<button");
    expect(render(false, open)).not.toContain("<button");
  });
});
