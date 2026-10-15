import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #399: the draft service's refusals, against a small in-memory stand-in for the Prisma calls it makes and mocked
 * church facts. What only a real database proves (races, finalization, the ledger) is proved by
 * scripts/verify-church-code-invoices.ts. Synthetic data only.
 */
vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  figures: { amountDueCents: 0, amountsFingerprint: "fp-0", billableCount: 0, snapshot: {}, groupTitle: "Church A promo codes", organizationName: "Church A", registeredCount: 0 } as Record<string, unknown>,
  contact: { name: "Tina Treasurer", email: "tina@example.test", roleLabel: "Treasurer", verified: true } as Record<string, unknown> | null,
  invoice: null as Row | null,
  created: [] as Row[],
  updated: [] as Row[],
  audits: [] as Row[],
}));

const tx = {
  invoice: {
    findUnique: vi.fn(async () => state.invoice),
    create: vi.fn(async () => ({ id: "inv-1" })),
  },
  invoiceVersion: {
    create: vi.fn(async ({ data }: { data: Row }) => { state.created.push(data); return { id: "ver-new", revision: data.revision }; }),
    update: vi.fn(async ({ data }: { data: Row }) => { state.updated.push(data); return {}; }),
  },
};
const prismaMock = { ...tx, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };

vi.mock("@/lib/prisma", () => ({ getPrisma: () => prismaMock }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn(async (entry: Row) => { state.audits.push(entry); }) }));
vi.mock("@/modules/attendance-reconciliation/repository", () => ({ LONG_TRANSACTION: { timeout: 30_000, maxWait: 10_000 }, lockEvent: vi.fn(async () => undefined) }));
vi.mock("@/modules/invoices/ledger-repository", () => ({ loadEventLedger: vi.fn(async () => []) }));
vi.mock("@/modules/promo-codes/church-sponsored-repository", () => ({ listChurchSponsoredPromoLines: vi.fn(async () => []) }));
vi.mock("@/modules/promo-codes/church-invoice-facts", () => ({
  loadChurchBillingContact: vi.fn(async () => state.contact),
  loadChurchInvoiceInputs: vi.fn(async () => ({
    event: { id: "event-1", name: "Women's Retreat", eligible: true },
    church: { id: "church-a", name: "Church A" },
    figures: state.figures,
    contact: state.contact,
    sponsorsACode: true,
  })),
}));
vi.mock("@/modules/invoices/repository", () => {
  class InvoiceError extends Error {
    constructor(message: string, public readonly code: string) { super(message); }
  }
  return { InvoiceError, figureColumns: (figures: Record<string, unknown>) => ({ amountDueCents: figures.amountDueCents, amountsFingerprint: figures.amountsFingerprint }) };
});

import { prepareChurchCodeInvoiceDraft } from "@/modules/promo-codes/church-invoice-repository";

const base = { eventId: "event-1", churchId: "church-a", actorUserId: "user-1" };
const code = (promise: Promise<unknown>) => promise.then(() => "none", (error: { code?: string }) => error.code ?? "other");
const version = (overrides: Row) => ({ id: "ver-1", revision: 0, status: "DRAFT", basis: "CHURCH_PROMO_CODES", amountsFingerprint: "fp-old", amountDueCents: 5000, contactName: "Tina Treasurer", contactEmail: "tina@example.test", billableCount: 2, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  state.created.length = 0;
  state.updated.length = 0;
  state.audits.length = 0;
  state.contact = { name: "Tina Treasurer", email: "tina@example.test", roleLabel: "Treasurer", verified: true };
  state.figures = { amountDueCents: 5000, amountsFingerprint: "fp-new", billableCount: 2, snapshot: {}, groupTitle: "Church A promo codes", organizationName: "Church A", registeredCount: 2 };
  state.invoice = { id: "inv-1", versions: [version({})] };
});

describe("refreshing a church draft to $0", () => {
  it("refuses an original draft whose uses were all cancelled, and tells staff to discard it", async () => {
    state.figures = { ...state.figures, amountDueCents: 0, amountsFingerprint: "fp-zero", billableCount: 0 };
    const error = await prepareChurchCodeInvoiceDraft(base).catch((caught: Error & { code?: string }) => caught);
    expect((error as { code?: string }).code).toBe("NOTHING_TO_INVOICE");
    expect((error as Error).message).toMatch(/discard this draft/i);
    expect(state.updated).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("still lets a revision draft go to $0 (a finalized invoice is corrected to $0 by a revision), and refreshes a non-zero original", async () => {
    state.figures = { ...state.figures, amountDueCents: 0, amountsFingerprint: "fp-zero", billableCount: 0 };
    state.invoice = { id: "inv-1", versions: [version({ revision: 1 })] };
    expect((await prepareChurchCodeInvoiceDraft(base)).outcome).toBe("REFRESHED");
    state.invoice = { id: "inv-1", versions: [version({})] };
    state.figures = { ...state.figures, amountDueCents: 2500, amountsFingerprint: "fp-two" };
    expect((await prepareChurchCodeInvoiceDraft(base)).outcome).toBe("REFRESHED");
  });
});

describe("regenerating and revising a church invoice from the invoice screen", () => {
  it("regenerate (requireDraft) refuses with NOT_A_DRAFT when the latest version is finalized, and starts no revision", async () => {
    state.invoice = { id: "inv-1", versions: [version({ status: "FINALIZED" })] };
    expect(await code(prepareChurchCodeInvoiceDraft({ ...base, requireDraft: true }))).toBe("NOT_A_DRAFT");
    expect(state.created).toHaveLength(0);
    state.invoice = null;
    expect(await code(prepareChurchCodeInvoiceDraft({ ...base, requireDraft: true }))).toBe("NOT_A_DRAFT");
    expect(state.created).toHaveLength(0);
  });

  it("regenerate still refreshes an open draft", async () => {
    expect((await prepareChurchCodeInvoiceDraft({ ...base, requireDraft: true })).outcome).toBe("REFRESHED");
  });

  it("without requireDraft, a changed finalized invoice starts a revision that carries the user's reason, trimmed, or a default", async () => {
    state.invoice = { id: "inv-1", versions: [version({ status: "FINALIZED" })] };
    expect((await prepareChurchCodeInvoiceDraft({ ...base, revisionReason: "  Two women cancelled  " })).outcome).toBe("REVISION_STARTED");
    expect(state.created[0]).toMatchObject({ revision: 1, basis: "CHURCH_PROMO_CODES", revisionReason: "Two women cancelled", supersedesVersionId: "ver-1" });
    await prepareChurchCodeInvoiceDraft(base);
    expect(state.created[1]!.revisionReason).toMatch(/promo code redemptions/);
  });
});
