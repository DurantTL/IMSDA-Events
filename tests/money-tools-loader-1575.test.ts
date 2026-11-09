import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
const prisma = {};
vi.mock("@/lib/prisma", () => ({ getPrisma: () => prisma }));
const logError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => logError(...args) }));

const listPolicyVersions = vi.fn();
vi.mock("@/modules/cancellation-policy/repository", () => ({ listPolicyVersions: (...args: unknown[]) => { calls.push("policy"); return listPolicyVersions(...args); } }));
const reconcileRegistrationLedger = vi.fn();
vi.mock("@/modules/ledger/reconciliation", () => ({ reconcileRegistrationLedger: (...args: unknown[]) => { calls.push("ledger"); return reconcileRegistrationLedger(...args); } }));
const countOpenChurchSponsorFlags = vi.fn();
vi.mock("@/modules/promo-codes/church-sponsor-lodging", () => ({ countOpenChurchSponsorFlags: (...args: unknown[]) => { calls.push("flags"); return countOpenChurchSponsorFlags(...args); } }));
const getFundView = vi.fn();
vi.mock("@/modules/scholarship-funds/repository", () => ({ getFundView: (...args: unknown[]) => { calls.push("fund"); return getFundView(...args); } }));

const countOpenInvoiceDrafts = vi.fn();
vi.mock("@/modules/invoices/repository", () => ({ countOpenInvoiceDrafts: (...args: unknown[]) => { calls.push("drafts"); return countOpenInvoiceDrafts(...args); } }));
const getBillingResponsibilityView = vi.fn();
vi.mock("@/modules/billing-responsibility/repository", () => ({ getBillingResponsibilityView: (...args: unknown[]) => { calls.push("billing"); return getBillingResponsibilityView(...args); } }));
const hasApprovedReconciliation = vi.fn();
vi.mock("@/modules/attendance-reconciliation/repository", () => ({ hasApprovedReconciliation: (...args: unknown[]) => { calls.push("attendance"); return hasApprovedReconciliation(...args); } }));

const listUnmatchedSquarePayments = vi.fn();
vi.mock("@/modules/payments/square-match-repository", () => ({ listUnmatchedSquarePayments: (...args: unknown[]) => { calls.push("square"); return listUnmatchedSquarePayments(...args); } }));

const { loadMoneyToolMetrics } = await import("@/modules/payments/money-tools-repository");

const finance = { permissions: ["MANAGE_FINANCE" as const] };
const now = new Date("2026-11-07T18:00:00Z");

beforeEach(() => {
  calls.length = 0;
  logError.mockClear();
  listPolicyVersions.mockReset();
  listPolicyVersions.mockResolvedValue({ versions: [{ id: "v1" }, { id: "v2" }], inEffectVersionId: "v2" });
  reconcileRegistrationLedger.mockReset();
  reconcileRegistrationLedger.mockResolvedValue({ checked: 10, failing: [{}, {}, {}] });
  countOpenChurchSponsorFlags.mockReset();
  countOpenChurchSponsorFlags.mockResolvedValue(1);
  getFundView.mockReset();
  getFundView.mockResolvedValue({ summary: { balanceCents: 250000 } });
  countOpenInvoiceDrafts.mockReset();
  countOpenInvoiceDrafts.mockResolvedValue(2);
  getBillingResponsibilityView.mockReset();
  getBillingResponsibilityView.mockResolvedValue({ isDeferred: true, unrecordedCount: 4, outdatedCount: 1, summary: { unresolvedCount: 2, needsContactCount: 3 } });
  hasApprovedReconciliation.mockReset();
  hasApprovedReconciliation.mockResolvedValue(true);
  listUnmatchedSquarePayments.mockReset();
  listUnmatchedSquarePayments.mockResolvedValue({ findings: [{}, {}], examined: 9, unreachableSquare: false, environment: "sandbox" });
});

describe("More money tools loaders (#1575)", () => {
  it("reads each number for the one event, with the counts the pages use", async () => {
    const values = await loadMoneyToolMetrics(finance, "evt_1", now);
    expect(values).toEqual({ churchFlags: 1, ledgerDifferences: 3, policyVersions: 2, policyInEffect: 1, draftInvoices: 2, scholarshipBalanceCents: 250000, billingUnrecorded: 4, billingOutdated: 1, billingUnresolved: 2, billingNeedsContact: 3, billedToOrganizations: 1, attendanceApproved: 1, unmatchedSquare: 2 });
    expect(countOpenChurchSponsorFlags).toHaveBeenCalledWith("evt_1");
    expect(reconcileRegistrationLedger).toHaveBeenCalledWith(prisma, { eventId: "evt_1" });
    expect(countOpenInvoiceDrafts).toHaveBeenCalledWith("evt_1");
    expect(getBillingResponsibilityView).toHaveBeenCalledWith("evt_1");
    expect(calls.filter((call) => call === "billing")).toHaveLength(1);
    expect(getFundView).toHaveBeenCalledWith("evt_1");
    // Two numbers come from one policy read.
    expect(calls.filter((call) => call === "policy")).toHaveLength(1);
  });

  it("makes a failed read unavailable for its own numbers only, and logs it", async () => {
    getFundView.mockRejectedValue(new Error("down"));
    listPolicyVersions.mockRejectedValue(new Error("down"));
    const values = await loadMoneyToolMetrics(finance, "evt_1", now);
    expect(values.scholarshipBalanceCents).toBeNull();
    expect(values.policyVersions).toBeNull();
    expect(values.policyInEffect).toBeNull();
    expect(values.churchFlags).toBe(1);
    expect(values.draftInvoices).toBe(2);
    expect(logError).toHaveBeenCalledTimes(3);
  });

  it("gives up on the Square list after a few seconds, so the card never holds the page up (#1747)", async () => {
    vi.useFakeTimers();
    try {
      listUnmatchedSquarePayments.mockReturnValue(new Promise(() => {}));
      const pending = loadMoneyToolMetrics(finance, "evt_1", now);
      await vi.advanceTimersByTimeAsync(3100);
      const values = await pending;
      expect(values.unmatchedSquare).toBeNull();
      expect(values.churchFlags).toBe(1);
      // The whole list the Square page reads, so "OK" never stands for payments it did not read.
      expect(listUnmatchedSquarePayments).toHaveBeenCalledWith();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not log an error when Square is simply not set up, but logs a real failure (#1747)", async () => {
    listUnmatchedSquarePayments.mockRejectedValue(Object.assign(new Error("Square is not configured for this site."), { code: "SQUARE_NOT_CONFIGURED" }));
    expect((await loadMoneyToolMetrics(finance, "evt_1", now)).unmatchedSquare).toBeNull();
    expect(logError).not.toHaveBeenCalled();
    listUnmatchedSquarePayments.mockRejectedValue(new Error("boom"));
    await loadMoneyToolMetrics(finance, "evt_1", now);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("makes the unmatched Square count unavailable when Square is not configured or cannot be reached (#1747)", async () => {
    listUnmatchedSquarePayments.mockRejectedValue(new Error("Square is not configured for this site."));
    expect((await loadMoneyToolMetrics(finance, "evt_1", now)).unmatchedSquare).toBeNull();
    listUnmatchedSquarePayments.mockResolvedValue({ findings: [], examined: 0, unreachableSquare: true, environment: "sandbox" });
    expect((await loadMoneyToolMetrics(finance, "evt_1", now)).unmatchedSquare).toBeNull();
    listUnmatchedSquarePayments.mockResolvedValue({ findings: [], examined: 3, unreachableSquare: false, environment: "sandbox" });
    expect((await loadMoneyToolMetrics(finance, "evt_1", now)).unmatchedSquare).toBe(0);
  });

  it("makes the billing and approval numbers unavailable when their reads fail", async () => {
    getBillingResponsibilityView.mockRejectedValue(new Error("down"));
    hasApprovedReconciliation.mockRejectedValue(new Error("down"));
    const values = await loadMoneyToolMetrics(finance, "evt_1", now);
    expect(values).toMatchObject({ billingUnrecorded: null, billingOutdated: null, billingUnresolved: null, billingNeedsContact: null, billedToOrganizations: null, attendanceApproved: null, churchFlags: 1 });
  });

  it("reads an event not billed to organizations as not used, from the billing view's own flag", async () => {
    getBillingResponsibilityView.mockResolvedValue({ isDeferred: false, unrecordedCount: 0, outdatedCount: 0, summary: { unresolvedCount: 0, needsContactCount: 0 } });
    expect((await loadMoneyToolMetrics(finance, "evt_1", now)).billedToOrganizations).toBe(0);
  });

  it("does not read a saved but not-yet-effective policy as in effect", async () => {
    listPolicyVersions.mockResolvedValue({ versions: [{ id: "v1" }], inEffectVersionId: null });
    const values = await loadMoneyToolMetrics(finance, "evt_1", now);
    expect(values).toMatchObject({ policyVersions: 1, policyInEffect: 0 });
  });

  it("reads nothing for a viewer who sees no card", async () => {
    expect(await loadMoneyToolMetrics({ permissions: ["VIEW_EVENT"] }, "evt_1", now)).toEqual({});
    expect(calls).toEqual([]);
    expect(countOpenInvoiceDrafts).not.toHaveBeenCalled();
  });
});
