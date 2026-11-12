import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const dependencies = vi.hoisted(() => ({ findActiveMembership: vi.fn(), getCurrentSession: vi.fn(), findMany: vi.fn() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ merchandiseOrder: { findMany: dependencies.findMany } }) }));

import { GET } from "@/app/api/events/[eventId]/merchandise/orders/route";
import { canViewMerchandiseOrders } from "@/modules/merchandise/order-list";
import { merchandiseTotalsBySize, staffOrderFromRecord } from "@/modules/merchandise/order-list-domain";

const eventId = "event_1";
const call = (id = eventId) => GET(new Request(`https://events.imsda.test/api/events/${id}/merchandise/orders`), { params: Promise.resolve({ eventId: id }) });
const session = { user: { id: "usr_1", email: "staff@example.test", displayName: "Staff", globalRole: null } };
const membership = (role: string) => ({ eventId, userId: "usr_1", role, status: "ACTIVE", permissions: [] });

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCurrentSession.mockResolvedValue(session);
  dependencies.findMany.mockResolvedValue([]);
});

describe("GET merchandise orders", () => {
  it("rejects an unauthenticated caller", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call()).status).toBe(401);
    expect(dependencies.findMany).not.toHaveBeenCalled();
  });

  it("rejects a member with no membership for this event", async () => {
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await call()).status).toBe(403);
    expect(dependencies.findMany).not.toHaveBeenCalled();
  });

  it("rejects read-only staff, a configurator without registration or finance access, and registration staff without configuration access", async () => {
    for (const role of ["READ_ONLY_STAFF", "REGISTRATION_MANAGER", "FINANCE_MANAGER"]) {
      dependencies.findActiveMembership.mockResolvedValue(membership(role));
      expect((await call()).status).toBe(403);
    }
    expect(dependencies.findMany).not.toHaveBeenCalled();
  });

  it("allows an event admin and scopes every query to the event", async () => {
    dependencies.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    dependencies.findMany.mockResolvedValue([{
      id: "order_1", createdAt: new Date("2027-03-01T12:00:00Z"), status: "PENDING", totalCents: 5000,
      purchaserSnapshot: { name: "Avery Guest", email: "guest@example.test", confirmationCode: "REG-ABC" },
      registrationId: "reg_1", registration: { status: "SUBMITTED" },
      lines: [{ productNameSnapshot: "Camp Shirt", variantLabelSnapshot: "Medium", quantity: 2, lineTotalCents: 5000 }],
    }]);
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orders[0]).toMatchObject({ confirmationCode: "REG-ABC", purchaserName: "Avery Guest", statusWord: "Pending payment", totalCents: 5000, registrationActive: true });
    expect(body.totals).toEqual([{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 2 }]);
    expect(dependencies.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId } }));
    expect(JSON.stringify(body)).not.toContain("guest@example.test");
  });
});

describe("order list helpers", () => {
  it("excludes cancelled and refunded orders from the totals", () => {
    const line = (quantity: number) => [{ productName: "Camp Shirt", variantLabel: "Medium", quantity, lineTotalCents: 0 }];
    expect(merchandiseTotalsBySize([
      { status: "PENDING", lines: line(1) }, { status: "PAID", lines: line(2) },
      { status: "CANCELLED", lines: line(5) }, { status: "REFUNDED", lines: line(7) },
    ])).toEqual([{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 3 }]);
  });

  it("lists an order whose registration was cancelled but leaves it out of the totals", () => {
    const line = [{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 4, lineTotalCents: 0 }];
    expect(merchandiseTotalsBySize([
      { status: "PENDING", registrationActive: false, lines: line },
      { status: "PENDING", registrationActive: true, lines: line },
    ])).toEqual([{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 4 }]);
    const record = { id: "o", createdAt: new Date("2027-03-01T12:00:00Z"), status: "PENDING" as const, totalCents: 1, purchaserSnapshot: {}, lines: [] };
    expect(staffOrderFromRecord({ ...record, registrationId: "r", registration: { status: "CANCELLED" } }).registrationActive).toBe(false);
    expect(staffOrderFromRecord({ ...record, registrationId: "r", registration: { status: "CONFIRMED" } }).registrationActive).toBe(true);
    expect(staffOrderFromRecord({ ...record, registrationId: null, registration: null }).registrationActive).toBe(true);
  });

  it("needs configuration plus registration or finance permission", () => {
    expect(canViewMerchandiseOrders(["CONFIGURE_EVENT", "MANAGE_FINANCE"])).toBe(true);
    expect(canViewMerchandiseOrders(["CONFIGURE_EVENT", "MANAGE_REGISTRATION"])).toBe(true);
    expect(canViewMerchandiseOrders(["CONFIGURE_EVENT"])).toBe(false);
    expect(canViewMerchandiseOrders(["MANAGE_FINANCE"])).toBe(false);
  });
});
