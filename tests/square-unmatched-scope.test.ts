import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  collect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/payments/square-reconciliation", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/modules/payments/square-reconciliation")
  >();
  return { ...original, collectSquareReconciliationReport: dependencies.collect };
});

import type { SquareRuntimeConfiguration } from "@/modules/payments/square-config";
import { listUnmatchedSquarePayments } from "@/modules/payments/square-match-repository";

const configuration = {
  environment: "production",
  locationId: "main-location",
  paymentConfigured: true,
} as SquareRuntimeConfiguration;

function finding(id: string, overrides: Record<string, unknown> = {}) {
  return {
    code: "AMOUNT_MISMATCH",
    providerPaymentId: id,
    amountCents: 1000,
    currency: "USD",
    createdAt: null,
    confirmationCode: null,
    balanceCents: 500,
    detail: "x",
    note: null,
    referenceId: null,
    orderId: null,
    registrationId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.collect.mockResolvedValue({
    environment: "production",
    examined: 4,
    unreachableSquare: false,
    findings: [
      finding("pay-this", { registrationId: "reg-this" }),
      finding("pay-other", { registrationId: "reg-other" }),
      finding("pay-unknown", { code: "NO_REGISTRATION" }),
      finding("pay-recorded", { code: "RECORDED", registrationId: "reg-this" }),
    ],
  });
  dependencies.getPrisma.mockReturnValue({
    registration: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; eventId: string } }) =>
        [
          { id: "reg-this", eventId: "event-1" },
          { id: "reg-other", eventId: "event-2" },
        ].filter((row) => where.id.in.includes(row.id) && row.eventId === where.eventId),
      ),
    },
  });
});

describe("unmatched Square payments for one event", () => {
  it("lists only payments tied to that event's registrations", async () => {
    const result = await listUnmatchedSquarePayments({ eventId: "event-1", configuration });
    expect(result.findings.map((f) => f.providerPaymentId)).toEqual(["pay-this"]);
  });

  it("leaves out payments that name no registration for event-level staff", async () => {
    const result = await listUnmatchedSquarePayments({ eventId: "event-2", configuration });
    expect(result.findings.map((f) => f.providerPaymentId)).toEqual(["pay-other"]);
  });

  it("shows payments that name no registration to system administrators", async () => {
    const result = await listUnmatchedSquarePayments({
      eventId: "event-1",
      includeUnattributed: true,
      configuration,
    });
    expect(result.findings.map((f) => f.providerPaymentId)).toEqual(["pay-this", "pay-unknown"]);
  });
});
