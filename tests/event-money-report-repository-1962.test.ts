import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  listRegistrations: vi.fn(),
  loadEventLedger: vi.fn(),
  listUnmatchedSquarePayments: vi.fn(),
  prisma: {
    event: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    registrationAdjustment: { findMany: vi.fn() },
    promoCodeRedemption: { findMany: vi.fn() },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/invoices/ledger-repository", () => ({ loadEventLedger: mocks.loadEventLedger }));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: mocks.listRegistrations }));
vi.mock("@/modules/payments/square-match-repository", () => ({ listUnmatchedSquarePayments: mocks.listUnmatchedSquarePayments }));
vi.mock("@/modules/payments/money-tools-repository", async () => ({
  squareTimeoutMs: 50,
  isExpectedUnavailable: (error: unknown) => (error as { code?: unknown } | null)?.code === "SQUARE_NOT_CONFIGURED",
  withTimeout: <T,>(read: () => Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("slow")), ms);
    read().then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  }),
}));

import { exportEventMoneyReport, loadEventMoneyReport, loadUnmatchedSquareSummary } from "@/modules/payments/event-money-report-repository";

const registration = {
  id: "reg_1", confirmationCode: "SYN-CODE-1", status: "CONFIRMED", totalAmountCents: 10_000, paidCents: 2500, balanceCents: 7500,
  isDeferredOrganizationBilling: false, accountHolder: { firstName: "Sample", lastName: "Holder" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.event.findUnique.mockResolvedValue({ name: "Test Event" });
  mocks.listRegistrations.mockResolvedValue([registration]);
  mocks.prisma.payment.findMany.mockResolvedValue([{ registrationId: "reg_1", status: "SUCCEEDED", method: "CASH", amount: "25.00", refunds: [] }]);
  mocks.prisma.registrationAdjustment.findMany.mockResolvedValue([]);
  mocks.prisma.promoCodeRedemption.findMany.mockResolvedValue([]);
  mocks.loadEventLedger.mockResolvedValue([]);
});

describe("event money report repository (#1962)", () => {
  it("names the account holder with the shared name formatter", async () => {
    const { report } = await loadEventMoneyReport("event_a");
    expect(report.owing[0]?.accountHolderName).toBe("Sample Holder");
    expect(report.check.ok).toBe(true);
  });

  it("audits a download with counts and cents only: no names, codes or event name", async () => {
    await exportEventMoneyReport("event_a", "user_one");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ eventId: "event_a", actorUserId: "user_one", action: "EVENT_MONEY_REPORT_EXPORTED", entityType: "EventMoneyReport" });
    expect(entry.metadata).toEqual({ owingRegistrations: 1, outstandingCents: 7500, checkOk: true });
    const written = JSON.stringify(entry);
    for (const secret of ["Sample", "Holder", "SYN-CODE-1", "Test Event"]) expect(written).not.toContain(secret);
  });

  it("asks Square about this event only, never for payments that name no registration", async () => {
    mocks.listUnmatchedSquarePayments.mockResolvedValue({ findings: [{ amountCents: 500 }, { amountCents: 250 }], unreachableSquare: false });
    expect(await loadUnmatchedSquareSummary("event_a")).toEqual({ state: "ok", count: 2, cents: 750 });
    expect(mocks.listUnmatchedSquarePayments).toHaveBeenCalledWith({ eventId: "event_a", includeUnattributed: false });
  });

  it("tells not configured apart from an outage or a slow read", async () => {
    mocks.listUnmatchedSquarePayments.mockRejectedValueOnce(Object.assign(new Error("Square is not configured for this site."), { code: "SQUARE_NOT_CONFIGURED" }));
    expect(await loadUnmatchedSquareSummary("event_a")).toEqual({ state: "notConfigured" });
    mocks.listUnmatchedSquarePayments.mockResolvedValueOnce({ findings: [], unreachableSquare: true });
    expect(await loadUnmatchedSquareSummary("event_a")).toEqual({ state: "unavailable" });
    mocks.listUnmatchedSquarePayments.mockImplementationOnce(() => new Promise(() => {}));
    expect(await loadUnmatchedSquareSummary("event_a")).toEqual({ state: "unavailable" });
  });
});
