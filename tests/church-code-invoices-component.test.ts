import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #399: what the church promo code report and a church promo code invoice show and offer. Synthetic data only. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("server-only", () => ({}));

import { ChurchCodeInvoices } from "@/components/church-code-invoices";
import { InvoiceDetailView } from "@/components/invoice-detail";
import type { InvoiceSnapshot } from "@/modules/invoices/domain";
import type { InvoiceDetail, InvoiceVersionSummary } from "@/modules/invoices/repository";
import { buildChurchCodeReportRow, buildChurchPromoInvoiceFigures, summarizeChurchCodeReport } from "@/modules/promo-codes/church-invoice";
import type { ChurchCodeReport } from "@/modules/promo-codes/church-invoice-repository";

const event = { id: "event-1", name: "Women's Retreat 2027" };
const church = { id: "church-a", name: "Church A" };
const lines = [
  { lineId: "redemption:r1", churchId: "church-a", churchName: "Church A", promoCode: "CHURCHA", confirmationCode: "WR-0001", status: "CONFIRMED" as const, amountCents: 5000 },
  { lineId: "redemption:r2", churchId: "church-a", churchName: "Church A", promoCode: "CHURCHA", confirmationCode: "WR-0002", status: "SUBMITTED" as const, amountCents: 2500 },
];
const figures = buildChurchPromoInvoiceFigures({ event, church, lines });

function report(invoice: Parameters<typeof buildChurchCodeReportRow>[0]["invoice"], eligible = true): ChurchCodeReport {
  const rows = [buildChurchCodeReportRow({
    event, church, lines, invoice,
    lineNames: new Map([["redemption:r1", "Quillon Fernsby"], ["redemption:r2", "Marisol Teague"]]),
    codes: [{ id: "c1", code: "CHURCHA", isActive: true, redeemedCount: 2, maximumUses: 10 }],
    contact: { name: "Tina Treasurer", email: "tina@contact.test", verified: true },
  })];
  return { eventId: "event-1", eligible, rows, totals: summarizeChurchCodeReport(rows) };
}

const render = (value: ChurchCodeReport, canFinalize = false) => renderToStaticMarkup(createElement(ChurchCodeInvoices, { eventId: "event-1", report: value, canFinalize }));

describe("Church promo code report", () => {
  it("shows who used the code by name and confirmation code, what it covered, and offers to create a draft", () => {
    const markup = render(report(null));
    expect(markup).toContain("Church A");
    expect(markup).toContain("WR-0001");
    expect(markup).toContain("WR-0002");
    expect(markup).toContain("Quillon Fernsby");
    expect(markup).toContain("Marisol Teague");
    expect(markup).toContain("$75.00");
    expect(markup).toContain("Not invoiced");
    expect(markup).toContain("Create draft invoice");
    expect(markup).toContain("Tina Treasurer");
    expect(markup).toContain("Nothing is sent from here");
    expect(markup).toContain("covers the whole event, whatever location filter");
    expect(markup).not.toMatch(/finalize invoice<\/button>/i);
  });

  it("says so when a registrant has no name on file, and keeps the report line otherwise", () => {
    const rows = [buildChurchCodeReportRow({
      event, church, lines, invoice: null, lineNames: new Map(),
      codes: [], contact: null,
    })];
    const markup = render({ eventId: "event-1", eligible: true, rows, totals: summarizeChurchCodeReport(rows) });
    expect(markup).toContain("no name on file");
    expect(markup).toContain("WR-0001");
  });

  it("names the covered attendee on a per-person line and the registrant on a whole-registration line, and neither reaches the invoice", () => {
    const mixed = [
      lines[0]!,
      { lineId: "adjustment:a1", churchId: "church-a", churchName: "Church A", promoCode: "CHURCHA", confirmationCode: "WR-0003", status: "CONFIRMED" as const, amountCents: 1234 },
    ];
    const rows = [buildChurchCodeReportRow({
      event, church, lines: mixed, invoice: null, codes: [], contact: null,
      lineNames: new Map([["redemption:r1", "Quillon Fernsby"], ["adjustment:a1", "Odalys Pemberton"]]),
    })];
    expect(rows[0]!.lines.map((line) => line.registrantName)).toEqual(["Quillon Fernsby", "Odalys Pemberton"]);
    const markup = render({ eventId: "event-1", eligible: true, rows, totals: summarizeChurchCodeReport(rows) });
    expect(markup).toContain("Odalys Pemberton");
    const figures = JSON.stringify(buildChurchPromoInvoiceFigures({ event, church, lines: mixed }));
    expect(figures).not.toContain("Odalys");
    expect(figures).not.toContain("Pemberton");
  });

  it("keeps the registrant name out of the church invoice figures, snapshot and layout", () => {
    const withNames = JSON.stringify(buildChurchPromoInvoiceFigures({ event, church, lines }));
    expect(withNames).not.toContain("Quillon");
    expect(withNames).not.toContain("Fernsby");
    expect(withNames).not.toContain("Marisol");
    // The report line is a separate type: the shared line the invoice is built from never gains a name.
    expect(Object.keys(lines[0]!)).not.toContain("registrantName");
  });

  it("shows invoiced, paid and owed for a finalized invoice, and links to it", () => {
    const markup = render(report({
      invoiceId: "i1", baseNumber: "WR27-0001",
      finalized: { versionId: "v1", number: "WR27-0001", amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint },
      draft: null, paidCents: 2500,
    }));
    expect(markup).toContain("Invoice WR27-0001");
    expect(markup).toContain("$75.00 / $25.00");
    expect(markup).toContain("$50.00");
    expect(markup).toContain("/finance/invoices/i1?event=event-1");
    expect(markup).toContain("Open invoice");
  });

  it("says a finalized invoice no longer matches the usage, and offers a revision draft", () => {
    const markup = render(report({
      invoiceId: "i1", baseNumber: "WR27-0001",
      finalized: { versionId: "v1", number: "WR27-0001", amountDueCents: 5000, amountsFingerprint: "old" },
      draft: null, paidCents: 0,
    }));
    expect(markup).toContain("usage changed");
    expect(markup).toContain("Start a revision draft");
    expect(markup).toContain("$25.00 not invoiced yet");
  });

  it("renders nothing without a sponsoring church, and warns when the event bills nothing", () => {
    expect(render({ eventId: "event-1", eligible: true, rows: [], totals: summarizeChurchCodeReport([]) })).toBe("");
    expect(render(report(null, false))).toContain("church codes bill nothing here");
  });

  it("tells staff without the permission that the office finalizes", () => {
    const withDraft = report({
      invoiceId: "i1", baseNumber: null, finalized: null,
      draft: { versionId: "v1", revision: 0, amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint, contactName: "Tina Treasurer", contactEmail: "tina@contact.test" },
      paidCents: 0,
    });
    expect(render(withDraft, false)).toContain("The office finalizes this draft.");
    expect(render(withDraft, false)).toContain("needs permission to finalize invoices");
    expect(render(withDraft, true)).not.toContain("The office finalizes this draft.");
  });
});

const contact = { name: "Tina Treasurer", email: "tina@contact.test", roleLabel: "Treasurer", verified: true };

function version(overrides: Partial<InvoiceVersionSummary> = {}): InvoiceVersionSummary {
  return {
    id: "v1", invoiceId: "i1", revision: 0, status: "DRAFT", basis: "CHURCH_PROMO_CODES", supersedesVersionId: null, reconciliationVersionId: null, reconciliationVersionNumber: null,
    number: null, groupTitle: "Church A promo codes", organizationName: "Church A", contact, registeredCount: 2, billableCount: 2, amountDueCents: 7500, amountsFingerprint: figures.amountsFingerprint,
    manualLines: [], revisionReason: null, createdAt: "2027-01-04T10:00:00.000Z", createdByName: "Fran Finance", regenerationCount: 0, finalizedAt: null, finalizedByName: null,
    supersededAt: null, supersededByVersionId: null, receivable: null,
    ...overrides,
  };
}

function detail(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  const shown = overrides.shown ?? version();
  const snapshot: InvoiceSnapshot = figures.snapshot;
  return {
    invoice: { id: "i1", groupKey: "church-promo:church-a", baseNumber: null, invoiceGrouping: "PER_CHURCH", partyKind: "ORGANIZATION" },
    versions: [shown], discarded: [], shown, snapshot, change: null, needsFinalizePermission: true, currentContact: contact, contactChanged: false, amountsOutOfDate: false, churchDraftStale: false,
    hasOpenDraft: shown.status === "DRAFT", liveFinalized: shown.status === "FINALIZED" ? shown : null, reconciliationFreshness: "NONE", approvedReconciliationVersionId: null,
    ...overrides,
  };
}

const renderDetail = (value: InvoiceDetail, canFinalize = false) => renderToStaticMarkup(createElement(InvoiceDetailView, { eventId: "event-1", detail: value, canFinalize, viewerName: "Tess Treasurer" }));

describe("Church promo code invoice detail", () => {
  it("shows the sponsored registrations and the total, never a reconciliation, and offers finalizing only with the permission", () => {
    const markup = renderDetail(detail(), true);
    expect(markup).toContain("Church A promo codes");
    expect(markup).toContain("Sponsored registration");
    expect(markup).toContain("WR-0001");
    expect(markup).toContain("$75.00");
    expect(markup).toContain("2 sponsored registrations");
    expect(markup).toContain("built from the church&#x27;s promo code redemptions");
    expect(markup).not.toContain("reconciliation version");
    expect(markup).not.toContain("Reconciliation version");
    expect(markup).toContain("/finance/church-owed?event=event-1");
    expect(markup).toContain("Finalize");
    expect(markup).not.toContain("Manual lines");
    const without = renderDetail(detail(), false);
    expect(without).toContain("needs permission to finalize invoices");
    expect(without).not.toContain("Finalize invoice");
  });

  it("does not offer to finalize a stale draft, and says to refresh it", () => {
    const markup = renderDetail(detail({ churchDraftStale: true }), true);
    expect(markup).toContain("cannot be finalized yet");
    expect(markup).toContain("Refresh the draft");
    expect(markup).not.toContain("Finalize invoice");
  });

  it("points a finalized invoice whose usage changed at the church report instead of the reconciliation revise form", () => {
    const finalized = version({ status: "FINALIZED", number: "WR27-0001", finalizedAt: "2027-01-05T10:00:00.000Z", finalizedByName: "Tess Treasurer", receivable: { amountCents: 7500, status: "OPEN" } });
    const markup = renderDetail(detail({ shown: finalized, amountsOutOfDate: true, needsFinalizePermission: false }), true);
    expect(markup).toContain("promo code usage has changed");
    expect(markup).toContain("church promo code report");
    expect(markup).not.toContain("approved reconciliation");
  });
});
