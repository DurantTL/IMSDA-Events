import { describe, expect, it } from "vitest";
import {
  CHURCH_PROMO_GROUP_KEY_PREFIX,
  buildChurchCodeReportRow,
  buildChurchPromoInvoiceFigures,
  churchDraftAction,
  churchIdOfPromoGroupKey,
  churchInvoiceState,
  churchPromoGroupKey,
  churchPromoInvoiceLine,
  summarizeChurchCodeReport,
  type ChurchInvoiceFacts,
} from "@/modules/promo-codes/church-invoice";
import { buildInvoiceLayout } from "@/modules/invoices/invoice-layout";
import type { ChurchSponsoredPromoLine } from "@/modules/promo-codes/church-sponsored";

/**
 * #399: the pure rules of a church's promo code invoice and report. Real database:
 * scripts/verify-church-code-invoices.ts. Synthetic data only.
 */

const event = { id: "event-1", name: "Women's Retreat 2027" };
const church = { id: "church-a", name: "Church A" };

function line(overrides: Partial<ChurchSponsoredPromoLine> = {}): ChurchSponsoredPromoLine {
  return {
    lineId: "redemption:r1",
    churchId: "church-a",
    churchName: "Church A",
    promoCode: "CHURCHA",
    confirmationCode: "WR-0001",
    status: "CONFIRMED",
    amountCents: 5000,
    ...overrides,
  };
}

describe("church promo code group key", () => {
  it("round-trips and never reads as another kind of group key", () => {
    expect(churchPromoGroupKey("church-a")).toBe("church-promo:church-a");
    expect(churchIdOfPromoGroupKey("church-promo:church-a")).toBe("church-a");
    expect(churchIdOfPromoGroupKey(CHURCH_PROMO_GROUP_KEY_PREFIX)).toBeNull();
    expect(churchIdOfPromoGroupKey("organization:church-a")).toBeNull();
    expect(churchIdOfPromoGroupKey("person:church-a")).toBeNull();
  });
});

describe("church promo code invoice figures", () => {
  it("bills each billed redemption at its own cents, for this church only, and nothing else", () => {
    const lines = [
      line({ lineId: "redemption:r1", confirmationCode: "WR-0001", amountCents: 5000 }),
      line({ lineId: "adjustment:a1", confirmationCode: "WR-0002", amountCents: 1234 }),
      line({ lineId: "redemption:r3", confirmationCode: "WR-0003", status: "CANCELLED", amountCents: 9999 }),
      line({ lineId: "redemption:r4", confirmationCode: "WR-0004", status: "WAITLISTED", amountCents: 7777 }),
      line({ lineId: "redemption:r5", confirmationCode: "WR-0005", amountCents: 0 }),
      line({ lineId: "redemption:r6", churchId: "church-b", churchName: "Church B", confirmationCode: "WR-0006", amountCents: 4000 }),
    ];
    const figures = buildChurchPromoInvoiceFigures({ event, church, lines });
    expect(figures.amountDueCents).toBe(6234);
    expect(figures.snapshot.lines.map((entry) => entry.confirmationCode)).toEqual(["WR-0001", "WR-0002"]);
    expect(figures.snapshot.totals).toEqual({ registered: 2, checkedIn: 0, noShow: 0, billable: 2, amountDueCents: 6234 });
    expect(figures.billableCount).toBe(2);
    expect(figures.snapshot.kind).toBe("CHURCH_PROMO_CODES");
    expect(figures.snapshot.reconciliation).toBeNull();
    expect(figures.snapshot.party).toEqual({ kind: "ORGANIZATION", id: "church-a", name: "Church A" });
    expect(figures.snapshot.groupKey).toBe("church-promo:church-a");
    expect(Number.isInteger(figures.amountDueCents)).toBe(true);
  });

  it("is $0 with no lines", () => {
    const figures = buildChurchPromoInvoiceFigures({ event, church, lines: [] });
    expect(figures.amountDueCents).toBe(0);
    expect(figures.snapshot.lines).toEqual([]);
  });

  it("has a fingerprint that follows what is owed and ignores the order of the lines", () => {
    const a = line({ lineId: "redemption:r1", confirmationCode: "WR-0001", amountCents: 5000 });
    const b = line({ lineId: "redemption:r2", confirmationCode: "WR-0002", amountCents: 2500 });
    const base = buildChurchPromoInvoiceFigures({ event, church, lines: [a, b] }).amountsFingerprint;
    expect(buildChurchPromoInvoiceFigures({ event, church, lines: [b, a] }).amountsFingerprint).toBe(base);
    expect(buildChurchPromoInvoiceFigures({ event, church, lines: [a, { ...b, amountCents: 2501 }] }).amountsFingerprint).not.toBe(base);
    expect(buildChurchPromoInvoiceFigures({ event, church, lines: [a] }).amountsFingerprint).not.toBe(base);
    // A cancelled registration drops out, so the fingerprint is the one without it.
    expect(buildChurchPromoInvoiceFigures({ event, church, lines: [a, { ...b, status: "CANCELLED" }] }).amountsFingerprint)
      .toBe(buildChurchPromoInvoiceFigures({ event, church, lines: [a] }).amountsFingerprint);
  });

  it("prints one row per redemption that adds up to the total, and never prints a code or a confirmation code", () => {
    const lines = [line({ lineId: "redemption:r1", amountCents: 5000 }), line({ lineId: "adjustment:a1", confirmationCode: "WR-0002", amountCents: 1234 })];
    const figures = buildChurchPromoInvoiceFigures({ event, church, lines });
    const layout = buildInvoiceLayout({ snapshot: figures.snapshot, manualLines: [], clubType: null, paymentsCreditsCents: 0 });
    const rows = layout.groups.flatMap((group) => group.rows);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((total, row) => total + row.amountCents, 0)).toBe(layout.totalCents);
    expect(layout.totalCents).toBe(6234);
    const printed = JSON.stringify(layout);
    expect(printed).not.toContain("CHURCHA");
    expect(printed).not.toContain("WR-0001");
    expect(churchPromoInvoiceLine(lines[0]!).amountCents).toBe(5000);
  });
});

const facts = (overrides: Partial<ChurchInvoiceFacts> = {}): ChurchInvoiceFacts => ({
  invoiceId: "inv-1",
  baseNumber: null,
  finalized: null,
  draft: null,
  paidCents: 0,
  ...overrides,
});

describe("church promo code report", () => {
  const lines = [
    line({ lineId: "redemption:r1", confirmationCode: "WR-0001", amountCents: 5000 }),
    line({ lineId: "redemption:r2", confirmationCode: "WR-0002", amountCents: 2500 }),
    line({ lineId: "redemption:r3", confirmationCode: "WR-0003", status: "CANCELLED", amountCents: 5000 }),
  ];
  const figures = buildChurchPromoInvoiceFigures({ event, church, lines });
  const codes = [{ id: "code-1", code: "CHURCHA", isActive: true, redeemedCount: 3, maximumUses: 10 }];
  const row = (invoice: ChurchInvoiceFacts | null, contact: { name: string; email: string; verified: boolean } | null = { name: "Tina Treasurer", email: "tina@example.test", verified: true }) =>
    buildChurchCodeReportRow({ event, church, codes, lines, invoice, contact });

  it("lists who used the code and what it covered, with nothing invoiced yet", () => {
    const result = row(null);
    expect(result.lines.map((entry) => entry.confirmationCode)).toEqual(["WR-0001", "WR-0002"]);
    expect(result.coveredCents).toBe(7500);
    expect(result.invoicedCents).toBe(0);
    expect(result.paidCents).toBe(0);
    expect(result.owedOnInvoiceCents).toBe(0);
    expect(result.notInvoicedCents).toBe(7500);
    expect(result.state).toBe("NO_INVOICE");
  });

  it("owes nothing and has nothing to invoice when no registration used the code", () => {
    const empty = buildChurchCodeReportRow({ event, church, codes, lines: [], invoice: null, contact: null });
    expect(empty.state).toBe("NOTHING_TO_INVOICE");
    expect(empty.coveredCents).toBe(0);
  });

  it("shows a current draft as invoiced for nothing yet: only a finalized invoice is owed", () => {
    const result = row(facts({ draft: { versionId: "v1", revision: 0, amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint, contactName: "Tina Treasurer", contactEmail: "tina@example.test" } }));
    expect(result.state).toBe("DRAFT_CURRENT");
    expect(result.draftAmountCents).toBe(7500);
    expect(result.invoicedCents).toBe(0);
    expect(result.owedOnInvoiceCents).toBe(0);
  });

  it("calls a draft stale when the lines or the contact changed", () => {
    const draft = { versionId: "v1", revision: 0, amountDueCents: 5000, amountsFingerprint: "old", contactName: "Tina Treasurer", contactEmail: "tina@example.test" };
    expect(row(facts({ draft })).state).toBe("DRAFT_STALE");
    const sameLinesOtherContact = { ...draft, amountsFingerprint: figures.amountsFingerprint, contactName: "Old Treasurer", contactEmail: "old@example.test" };
    expect(row(facts({ draft: sameLinesOtherContact })).state).toBe("DRAFT_STALE");
  });

  it("computes invoiced, paid and owed in cents from the finalized invoice", () => {
    const finalized = { versionId: "v1", number: "WR27-0001", amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint };
    const unpaid = row(facts({ finalized, baseNumber: "WR27-0001" }));
    expect(unpaid).toMatchObject({ invoicedCents: 7500, paidCents: 0, owedOnInvoiceCents: 7500, notInvoicedCents: 0, overpaidCents: 0, state: "FINALIZED_CURRENT", invoiceNumber: "WR27-0001" });
    const partly = row(facts({ finalized, paidCents: 3000 }));
    expect(partly).toMatchObject({ paidCents: 3000, owedOnInvoiceCents: 4500 });
    const settled = row(facts({ finalized, paidCents: 7500 }));
    expect(settled).toMatchObject({ owedOnInvoiceCents: 0, overpaidCents: 0 });
    const over = row(facts({ finalized, paidCents: 8000 }));
    expect(over).toMatchObject({ owedOnInvoiceCents: 0, overpaidCents: 500 });
  });

  it("flags a finalized invoice whose usage changed, in both directions, without changing what is owed on it", () => {
    const grewLater = row(facts({ finalized: { versionId: "v1", number: "WR27-0001", amountDueCents: 5000, amountsFingerprint: "old" }, paidCents: 1000 }));
    expect(grewLater).toMatchObject({ state: "FINALIZED_STALE", owedOnInvoiceCents: 4000, notInvoicedCents: 2500 });
    const shrank = row(facts({ finalized: { versionId: "v1", number: "WR27-0001", amountDueCents: 9000, amountsFingerprint: "old" } }));
    expect(shrank).toMatchObject({ state: "FINALIZED_STALE", owedOnInvoiceCents: 9000, notInvoicedCents: -1500 });
  });

  it("a revision draft beside a finalized invoice keeps the finalized amounts as what is owed", () => {
    const result = row(facts({
      finalized: { versionId: "v1", number: "WR27-0001", amountDueCents: 5000, amountsFingerprint: "old" },
      draft: { versionId: "v2", revision: 1, amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint, contactName: "Tina Treasurer", contactEmail: "tina@example.test" },
      paidCents: 5000,
    }));
    expect(result.state).toBe("DRAFT_CURRENT");
    expect(result.invoicedCents).toBe(5000);
    expect(result.owedOnInvoiceCents).toBe(0);
    expect(result.draftAmountCents).toBe(7500);
  });

  it("totals the report and offers the draft button only when there is something to do", () => {
    const first = row(null);
    const second = row(facts({ finalized: { versionId: "v1", number: "WR27-0001", amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint }, paidCents: 2500 }));
    expect(summarizeChurchCodeReport([first, second])).toEqual({ churchCount: 2, coveredCents: 15000, invoicedCents: 7500, paidCents: 2500, owedOnInvoiceCents: 5000 });
    expect(churchDraftAction("NO_INVOICE")).toMatchObject({ enabled: true });
    expect(churchDraftAction("DRAFT_STALE")).toMatchObject({ enabled: true });
    expect(churchDraftAction("FINALIZED_STALE")).toMatchObject({ enabled: true });
    expect(churchDraftAction("NOTHING_TO_INVOICE")).toMatchObject({ enabled: false });
    expect(churchDraftAction("DRAFT_CURRENT")).toMatchObject({ enabled: false });
    expect(churchDraftAction("FINALIZED_CURRENT")).toMatchObject({ enabled: false });
  });

  it("keeps the state function honest with no invoice at all", () => {
    expect(churchInvoiceState({ figures: { amountDueCents: 100, amountsFingerprint: "x" }, invoice: null })).toBe("NO_INVOICE");
    expect(churchInvoiceState({ figures: { amountDueCents: 0, amountsFingerprint: "x" }, invoice: null })).toBe("NOTHING_TO_INVOICE");
  });
});
