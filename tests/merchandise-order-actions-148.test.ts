import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  enqueueReceipt: vi.fn(),
  squareCalls: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/communications/transactional-messages", () => ({ enqueueMerchandiseReceiptMessage: mocks.enqueueReceipt }));

import { POST } from "@/app/api/events/[eventId]/merchandise/orders/[orderId]/actions/route";
import { applyMerchandiseOrderAction, MerchandiseOrderActionError } from "@/modules/merchandise/order-actions";
import {
  availableMerchandiseOrderActions,
  merchandiseOrderActionAllowed,
  merchandiseOrderActionPermissions,
  merchandiseOrderActionSchema,
  merchandisePaymentMethodLine,
  planMerchandiseOrderTransition,
} from "@/modules/merchandise/order-actions-domain";
import { merchandiseTotalsBySize, staffOrderFromRecord } from "@/modules/merchandise/order-list-domain";
import { merchandiseOrderStatusWords } from "@/modules/merchandise/domain";

const eventId = "event_1";
const orderId = "order_1";
const requestId = "6f1c8d52-3a47-4b7e-9d0a-5b1c2e3f4a5b";
const now = new Date("2027-03-02T15:00:00Z");

type OrderState = { status: string; receiptNumber: string | null; paymentMethod: string | null; paymentReference: string | null; paidAt: Date | null; registrationId: string | null };

function makeDb(overrides: { order?: Partial<OrderState> | null; maxReceipt?: number | null; lifecycle?: string; existingChange?: Record<string, unknown> | null; updateCount?: number } = {}) {
  const order = overrides.order === null ? null : {
    id: orderId, status: "PENDING", totalCents: 4250, subtotalCents: 4000, feeCents: 150, taxCents: 100,
    registrationId: "reg_1", receiptNumber: null, paymentMethod: null, paymentReference: null, paidAt: null, ...overrides.order,
  };
  const tx = {
    merchandiseOrder: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string; eventId: string } }) => Promise.resolve(order && where.id === orderId && where.eventId === eventId ? order : null)),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.updateCount ?? 1 }),
    },
    merchandiseOrderStatusChange: {
      findFirst: vi.fn().mockResolvedValue(overrides.existingChange ?? null),
      create: vi.fn().mockResolvedValue({ id: "change_1" }),
    },
    merchandiseOrderLine: { findMany: vi.fn().mockResolvedValue([{ productNameSnapshot: "Camp Shirt", variantLabelSnapshot: "Medium", quantity: 2, lineTotalCents: 4000 }]) },
    event: { findUnique: vi.fn().mockResolvedValue({ timezone: "America/Chicago" }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit_1" }) },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("lifecycleState")) return Promise.resolve([{ lifecycleState: overrides.lifecycle ?? "PUBLISHED" }]);
      if (sql.includes("MAX(")) return Promise.resolve([{ max: overrides.maxReceipt ?? null }]);
      return Promise.resolve([]);
    }),
  };
  mocks.getPrisma.mockReturnValue({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) });
  return tx;
}

const markPaid = (extra: Record<string, unknown> = {}) => merchandiseOrderActionSchema.parse({ action: "MARK_PAID", clientRequestId: requestId, method: "CASH", ...extra });
const comp = (reason = "Volunteer shirt") => merchandiseOrderActionSchema.parse({ action: "COMP", clientRequestId: requestId, reason });
const cancel = (reason = "Ordered by mistake") => merchandiseOrderActionSchema.parse({ action: "CANCEL", clientRequestId: requestId, reason });

beforeEach(() => vi.clearAllMocks());

describe("transition rules", () => {
  it("allows each action only from the statuses the issue names", () => {
    expect(planMerchandiseOrderTransition("MARK_PAID", "PENDING")).toEqual({ ok: true, to: "PAID" });
    expect(planMerchandiseOrderTransition("COMP", "PENDING")).toEqual({ ok: true, to: "COMPED" });
    expect(planMerchandiseOrderTransition("CANCEL", "PENDING")).toEqual({ ok: true, to: "CANCELLED" });
    expect(planMerchandiseOrderTransition("CANCEL", "COMPED")).toEqual({ ok: true, to: "CANCELLED" });
    for (const from of ["PAID", "COMPED", "CANCELLED", "REFUNDED"] as const) {
      expect(planMerchandiseOrderTransition("MARK_PAID", from).ok).toBe(false);
      expect(planMerchandiseOrderTransition("COMP", from).ok).toBe(false);
    }
    expect(planMerchandiseOrderTransition("CANCEL", "CANCELLED").ok).toBe(false);
  });

  it("refuses to cancel a paid order and says why", () => {
    const plan = planMerchandiseOrderTransition("CANCEL", "PAID");
    expect(plan).toMatchObject({ ok: false, code: "PAID_ORDER_NEEDS_REFUND" });
    expect(plan.ok === false && plan.message).toMatch(/refund/i);
  });

  it("lists the actions an order can still take", () => {
    expect(availableMerchandiseOrderActions("PENDING")).toEqual(["MARK_PAID", "COMP", "CANCEL"]);
    expect(availableMerchandiseOrderActions("COMPED")).toEqual(["CANCEL"]);
    expect(availableMerchandiseOrderActions("PAID")).toEqual([]);
  });

  it("hides Cancel on a comped order from staff without finance access", () => {
    const registration = merchandiseOrderActionPermissions(["CONFIGURE_EVENT", "MANAGE_REGISTRATION"]);
    const finance = merchandiseOrderActionPermissions(["CONFIGURE_EVENT", "MANAGE_FINANCE"]);
    expect(merchandiseOrderActionAllowed("CANCEL", "PENDING", registration)).toBe(true);
    expect(merchandiseOrderActionAllowed("CANCEL", "COMPED", registration)).toBe(false);
    expect(merchandiseOrderActionAllowed("CANCEL", "COMPED", finance)).toBe(true);
  });

  it("maps button visibility from permissions", () => {
    expect(merchandiseOrderActionPermissions(["CONFIGURE_EVENT", "MANAGE_FINANCE"])).toEqual({ canMarkPaid: true, canComp: true, canCancel: true });
    expect(merchandiseOrderActionPermissions(["CONFIGURE_EVENT", "MANAGE_REGISTRATION"])).toEqual({ canMarkPaid: false, canComp: false, canCancel: true });
    expect(merchandiseOrderActionPermissions(["MANAGE_FINANCE"])).toEqual({ canMarkPaid: false, canComp: false, canCancel: false });
  });
});

describe("request body", () => {
  it("needs a check number for a check, and a Square reference for a card payment", () => {
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "CHECK" }).success).toBe(false);
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "CHECK", reference: "1042" }).success).toBe(true);
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "CARD_REFERENCE" }).success).toBe(false);
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "CARD_REFERENCE", reference: "  " }).success).toBe(false);
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "CARD_REFERENCE", reference: "SQ-RCPT-77" }).success).toBe(true);
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "CASH" }).success).toBe(true);
  });

  it("refuses other methods, a missing reason and a bad request id; carries no amount", () => {
    expect(merchandiseOrderActionSchema.safeParse({ action: "MARK_PAID", clientRequestId: requestId, method: "MANUAL" }).success).toBe(false);
    expect(merchandiseOrderActionSchema.safeParse({ action: "COMP", clientRequestId: requestId, reason: " " }).success).toBe(false);
    expect(merchandiseOrderActionSchema.safeParse({ action: "CANCEL", clientRequestId: "x", reason: "Duplicate order" }).success).toBe(false);
    expect(markPaid({ amountCents: 1 })).not.toHaveProperty("amountCents");
  });
});

describe("applyMerchandiseOrderAction", () => {
  it("marks a cash payment paid for the full total, with receipt number, status change, audit and email", async () => {
    const tx = makeDb({ maxReceipt: 6 });
    const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid({ note: "Paid at the desk" }), now);
    expect(result).toMatchObject({ replayed: false, order: { status: "PAID", statusWord: "Confirmed", receiptNumber: "M-0007", paymentMethod: "CASH", paymentReference: null } });
    expect(tx.merchandiseOrder.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, eventId, status: "PENDING" },
      data: { status: "PAID", receiptNumber: "M-0007", paymentMethod: "CASH", paymentReference: null, paidAt: now },
    });
    expect(tx.merchandiseOrderStatusChange.create.mock.calls[0][0].data).toMatchObject({
      orderId, eventId, fromStatus: "PENDING", toStatus: "PAID", actorUserId: "usr_1", action: "MARK_PAID", reason: "Paid at the desk",
      paymentMethod: "CASH", paymentReference: null, amountCents: 4250, clientRequestId: requestId,
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "MERCHANDISE_ORDER_MARKED_PAID", entityType: "MerchandiseOrder", entityId: orderId, eventId, actorUserId: "usr_1" });
    expect(mocks.enqueueReceipt).toHaveBeenCalledTimes(1);
    const email = mocks.enqueueReceipt.mock.calls[0][1];
    expect(email).toMatchObject({ eventId, registrationId: "reg_1", orderId, action: "MARK_PAID" });
    expect(email.merchandiseReceiptBlock).toContain("M-0007");
    expect(email.merchandiseReceiptBlock).toContain("Cash");
  });

  it("starts receipt numbers at M-0001 for an event with none", async () => {
    makeDb({ maxReceipt: null });
    expect((await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now)).order.receiptNumber).toBe("M-0001");
  });

  it("takes the receipt lock before reading the highest number, so two receipts cannot share one", async () => {
    const tx = makeDb({ maxReceipt: 2 });
    await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now);
    expect((tx.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?")).toContain("pg_advisory_xact_lock");
    const maxCall = tx.$queryRaw.mock.calls.findIndex((call) => (call[0] as TemplateStringsArray).join("?").includes("MAX("));
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[maxCall]);
  });

  it("records a check number as the payment reference", async () => {
    const tx = makeDb();
    const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid({ method: "CHECK", reference: "1042" }), now);
    expect(result.order).toMatchObject({ paymentMethod: "CHECK", paymentReference: "1042" });
    expect(mocks.enqueueReceipt.mock.calls[0][1].merchandiseReceiptBlock).toContain("Check \\#1042");
    expect(tx.merchandiseOrderStatusChange.create.mock.calls[0][0].data).toMatchObject({ paymentMethod: "CHECK", paymentReference: "1042" });
  });

  it("records a Square card payment as CARD_REFERENCE with its reference and never touches Square", async () => {
    const tx = makeDb();
    const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid({ method: "CARD_REFERENCE", reference: "SQ-RCPT-77" }), now);
    expect(result.order).toMatchObject({ status: "PAID", paymentMethod: "CARD_REFERENCE", paymentReference: "SQ-RCPT-77" });
    expect(tx.merchandiseOrderStatusChange.create.mock.calls[0][0].data).toMatchObject({ paymentMethod: "CARD_REFERENCE", paymentReference: "SQ-RCPT-77", amountCents: 4250 });
    expect(mocks.enqueueReceipt.mock.calls[0][1].merchandiseReceiptBlock).toContain("Card \\(Square\\)\\, ref SQ\\-RCPT\\-77");
    expect(mocks.squareCalls).not.toHaveBeenCalled();
    const fs = await import("node:fs");
    const source = fs.readFileSync("modules/merchandise/order-actions.ts", "utf8") + fs.readFileSync("app/api/events/[eventId]/merchandise/orders/[orderId]/actions/route.ts", "utf8");
    expect(source).not.toMatch(/from "@\/modules\/payments|square-adapter|squareup|createSquare/i);
  });

  it("comps a pending order: no payment fields, a receipt number, a receipt email", async () => {
    const tx = makeDb({ maxReceipt: 1 });
    const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", comp(), now);
    expect(result.order).toMatchObject({ status: "COMPED", statusWord: "Confirmed", receiptNumber: "M-0002", paymentMethod: null, paidAt: null });
    expect(tx.merchandiseOrder.updateMany.mock.calls[0][0].data).toEqual({ status: "COMPED", receiptNumber: "M-0002" });
    expect(tx.merchandiseOrderStatusChange.create.mock.calls[0][0].data).toMatchObject({ action: "COMP", reason: "Volunteer shirt", amountCents: null });
    expect(mocks.enqueueReceipt.mock.calls[0][1]).toMatchObject({ action: "COMP" });
    expect(mocks.enqueueReceipt.mock.calls[0][1].merchandiseReceiptBlock).toContain("Comped — no charge");
  });

  it("sends no receipt for an order without a registration", async () => {
    makeDb({ order: { registrationId: null } });
    await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now);
    expect(mocks.enqueueReceipt).not.toHaveBeenCalled();
  });

  it("cancels a pending or comped order without a receipt number or email", async () => {
    for (const status of ["PENDING", "COMPED"]) {
      const tx = makeDb({ order: { status, receiptNumber: status === "COMPED" ? "M-0001" : null } });
      const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", cancel(), now, true);
      expect(result.order.status).toBe("CANCELLED");
      expect(tx.merchandiseOrder.updateMany).toHaveBeenCalledWith({ where: { id: orderId, eventId, status }, data: { status: "CANCELLED" } });
      expect(tx.merchandiseOrderStatusChange.create.mock.calls[0][0].data).toMatchObject({ action: "CANCEL", reason: "Ordered by mistake" });
    }
    expect(mocks.enqueueReceipt).not.toHaveBeenCalled();
  });

  it("needs finance access to cancel a comped order, but not a pending one", async () => {
    const tx = makeDb({ order: { status: "COMPED", receiptNumber: "M-0001" } });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_1", cancel(), now, false)).rejects.toMatchObject({ code: "FINANCE_REQUIRED", status: 403 });
    expect(tx.merchandiseOrder.updateMany).not.toHaveBeenCalled();
    makeDb({ order: { status: "PENDING" } });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_1", cancel(), now, false)).resolves.toMatchObject({ order: { status: "CANCELLED" } });
  });

  it("words a refusal without a raw status", async () => {
    makeDb({ order: { status: "CANCELLED" } });
    const error = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now).catch((caught) => caught);
    expect(error.message).toContain('"Cancelled"');
    expect(error.message).not.toContain("cancelled,");
  });

  it("refuses to cancel a paid order with a 409 and changes nothing", async () => {
    const tx = makeDb({ order: { status: "PAID" } });
    const error = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", cancel(), now).catch((caught) => caught);
    expect(error).toBeInstanceOf(MerchandiseOrderActionError);
    expect(error).toMatchObject({ code: "PAID_ORDER_NEEDS_REFUND", status: 409 });
    expect(error.message).toMatch(/refund/i);
    expect(tx.merchandiseOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses marking a non-pending order paid", async () => {
    makeDb({ order: { status: "CANCELLED" } });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now)).rejects.toMatchObject({ code: "ORDER_NOT_ACTIONABLE", status: 409 });
  });

  it("writes no personal details or reason text into the audit entry", async () => {
    const tx = makeDb();
    await applyMerchandiseOrderAction(eventId, orderId, "usr_1", comp("Pastor asked for it"), now);
    const entry = tx.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(entry)).not.toContain("Pastor");
    expect(entry.metadata).toMatchObject({ reasonProvided: true, toStatus: "COMPED" });
  });

  it("returns the stored result for a retry with the same id, with no second change, audit or email", async () => {
    const tx = makeDb({ order: { status: "PAID", receiptNumber: "M-0003" }, existingChange: { action: "MARK_PAID", paymentMethod: "CASH", paymentReference: null } });
    const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now);
    expect(result).toMatchObject({ replayed: true, order: { status: "PAID", receiptNumber: "M-0003" } });
    expect(tx.merchandiseOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.merchandiseOrderStatusChange.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mocks.enqueueReceipt).not.toHaveBeenCalled();
  });

  it("refuses the same id used for a different action, method or reference", async () => {
    makeDb({ order: { status: "PAID" }, existingChange: { action: "MARK_PAID", paymentMethod: "CASH", paymentReference: null } });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_1", comp(), now)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid({ method: "CHECK", reference: "9" }), now)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("lets only one of two simultaneous clicks change the order", async () => {
    // The second click read PENDING, but the conditional update finds the order already moved.
    const tx = makeDb({ updateCount: 0 });
    tx.merchandiseOrder.findFirst
      .mockResolvedValueOnce({ id: orderId, status: "PENDING", totalCents: 4250, subtotalCents: 4000, feeCents: 150, taxCents: 100, registrationId: "reg_1", receiptNumber: null, paymentMethod: null, paymentReference: null, paidAt: null })
      .mockResolvedValueOnce({ id: orderId, status: "COMPED", totalCents: 4250, subtotalCents: 4000, feeCents: 150, taxCents: 100, registrationId: "reg_1", receiptNumber: "M-0001", paymentMethod: null, paymentReference: null, paidAt: null });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_2", markPaid(), now)).rejects.toMatchObject({ code: "ORDER_NOT_ACTIONABLE", status: 409 });
    expect(tx.merchandiseOrderStatusChange.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mocks.enqueueReceipt).not.toHaveBeenCalled();
  });

  it("answers the same submission sent twice at once with the stored result", async () => {
    const tx = makeDb({ updateCount: 0 });
    tx.merchandiseOrderStatusChange.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ action: "MARK_PAID", paymentMethod: "CASH", paymentReference: null });
    const result = await applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now);
    expect(result.replayed).toBe(true);
    expect(tx.merchandiseOrderStatusChange.create).not.toHaveBeenCalled();
  });

  it("refuses on a closed event before writing anything", async () => {
    const tx = makeDb({ lifecycle: "CLOSED" });
    await expect(applyMerchandiseOrderAction(eventId, orderId, "usr_1", markPaid(), now)).rejects.toMatchObject({ code: "EVENT_CLOSED", status: 409 });
    expect(tx.merchandiseOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("treats an order id from another event as not found", async () => {
    const tx = makeDb();
    await expect(applyMerchandiseOrderAction("event_other", orderId, "usr_1", markPaid(), now)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", status: 404 });
    expect(tx.merchandiseOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: orderId, eventId: "event_other" } }));
    expect(tx.merchandiseOrder.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST route permissions", () => {
  const session = { user: { id: "usr_1", email: "staff@example.test", displayName: "Staff", globalRole: null } };
  const membership = (role: string, permissions: string[] = []) => ({ eventId, userId: "usr_1", role, status: "ACTIVE", permissions });
  const post = (body: unknown, id = eventId) => POST(
    new Request(`https://events.imsda.test/api/events/${id}/merchandise/orders/${orderId}/actions`, { method: "POST", headers: { "Content-Type": "application/json", origin: "https://events.imsda.test", host: "events.imsda.test" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ eventId: id, orderId }) },
  );
  const bodies = {
    MARK_PAID: { action: "MARK_PAID", clientRequestId: requestId, method: "CASH" },
    COMP: { action: "COMP", clientRequestId: requestId, reason: "Volunteer shirt" },
    CANCEL: { action: "CANCEL", clientRequestId: requestId, reason: "Ordered by mistake" },
  };

  beforeEach(() => {
    mocks.getCurrentSession.mockResolvedValue(session);
    makeDb();
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await post(bodies.CANCEL)).status).toBe(401);
  });

  it("lets finance-and-configuration staff do all three", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("FINANCE_MANAGER", ["CONFIGURE_EVENT"]));
    for (const key of ["MARK_PAID", "COMP", "CANCEL"] as const) {
      makeDb();
      expect((await post(bodies[key])).status).toBe(201);
    }
  });

  it("lets registration staff cancel but not mark paid or comp", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER", ["CONFIGURE_EVENT"]));
    expect((await post(bodies.CANCEL)).status).toBe(201);
    expect((await post(bodies.MARK_PAID)).status).toBe(403);
    expect((await post(bodies.COMP)).status).toBe(403);
  });

  it("lets only finance staff cancel a comped order", async () => {
    makeDb({ order: { status: "COMPED" } });
    mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER", ["CONFIGURE_EVENT"]));
    expect((await post(bodies.CANCEL)).status).toBe(403);
    makeDb({ order: { status: "COMPED" } });
    mocks.findActiveMembership.mockResolvedValue(membership("FINANCE_MANAGER", ["CONFIGURE_EVENT"]));
    expect((await post(bodies.CANCEL)).status).toBe(201);
  });

  it("refuses staff without configuration access, and read-only staff, for every action", async () => {
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      for (const body of Object.values(bodies)) expect((await post(body)).status).toBe(403);
    }
  });

  it("answers a bad body with 400, a paid-order cancel and a closed event with 409, and a missing order with 404", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    expect((await post({ action: "MARK_PAID", clientRequestId: requestId, method: "CHECK" })).status).toBe(400);
    expect((await post({ action: "REFUND", clientRequestId: requestId })).status).toBe(400);
    makeDb({ order: { status: "PAID" } });
    const paid = await post(bodies.CANCEL);
    expect(paid.status).toBe(409);
    expect((await paid.json()).message).toMatch(/refund/i);
    makeDb({ lifecycle: "CLOSED" });
    expect((await post(bodies.MARK_PAID)).status).toBe(409);
    makeDb({ order: null });
    expect((await post(bodies.MARK_PAID)).status).toBe(404);
  });

  it("replays a retry with 200 instead of 201", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    makeDb({ order: { status: "PAID" }, existingChange: { action: "MARK_PAID", paymentMethod: "CASH", paymentReference: null } });
    const response = await post(bodies.MARK_PAID);
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
  });
});

describe("COMPED in lists and totals", () => {
  const line = (quantity: number) => [{ productName: "Camp Shirt", variantLabel: "Medium", quantity, lineTotalCents: 0 }];

  it("counts a comped order in pickup totals and leaves a cancelled one out", () => {
    expect(merchandiseTotalsBySize([
      { status: "COMPED", lines: line(2) }, { status: "PAID", lines: line(1) }, { status: "CANCELLED", lines: line(9) },
    ])).toEqual([{ productName: "Camp Shirt", variantLabel: "Medium", quantity: 3 }]);
  });

  it("shows a comped order as Confirmed, with its receipt and a plain payment line", () => {
    expect(merchandiseOrderStatusWords.COMPED).toBe("Confirmed");
    const order = staffOrderFromRecord({
      id: "o", createdAt: now, status: "COMPED", totalCents: 4250, purchaserSnapshot: { name: "Avery Guest" }, registrationId: null, registration: null,
      receiptNumber: "M-0004", paymentMethod: null, paymentReference: null, paidAt: null, lines: [],
      statusChanges: [{ id: "c1", action: "COMP", fromStatus: "PENDING", toStatus: "COMPED", reason: "Volunteer shirt", createdAt: now, actor: { displayName: "Finance Staff" } }],
    });
    expect(order).toMatchObject({ statusWord: "Confirmed", receiptNumber: "M-0004", paymentLine: "Comped — no charge" });
    expect(order.history[0]).toMatchObject({ actorName: "Finance Staff", action: "COMP", reason: "Volunteer shirt" });
  });

  it("words each payment method", () => {
    expect(merchandisePaymentMethodLine({ status: "PAID", method: "CASH", reference: null })).toBe("Cash");
    expect(merchandisePaymentMethodLine({ status: "PAID", method: "CHECK", reference: "1042" })).toBe("Check #1042");
    expect(merchandisePaymentMethodLine({ status: "PAID", method: "CARD_REFERENCE", reference: "SQ-1" })).toBe("Card (Square), ref SQ-1");
    expect(merchandisePaymentMethodLine({ status: "PENDING", method: null, reference: null })).toBeNull();
  });
});
