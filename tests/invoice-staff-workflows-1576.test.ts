import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #1576: where the invoice and statement pages sit in Money, their parent links and their record headers. Synthetic data only. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("server-only", () => ({}));

import { InvoiceDetailView } from "@/components/invoice-detail";
import { StatementsList } from "@/components/invoice-ledger";
import { InvoiceSendView } from "@/components/invoice-send";
import { Invoices } from "@/components/invoices";
import { currentEventPlace } from "@/components/staff-event-tabs";
import type { SendPreview } from "@/modules/invoices/delivery-repository";
import type { InvoiceSnapshot } from "@/modules/invoices/domain";
import type { InvoiceDetail, InvoiceVersionSummary } from "@/modules/invoices/repository";

const place = (path: string, query = "") => currentEventPlace(path, new URLSearchParams(query));
const contact = { name: "Tina Treasurer", email: "tina@contact.test", roleLabel: "Treasurer", verified: true };

describe("invoice pages place (#1576)", () => {
  it("light Money and More money tools on every invoice and statement route, with a version or a filter", () => {
    for (const [path, query] of [
      ["/finance/invoices", ""],
      ["/finance/invoices/inv_1", "event=e1"],
      ["/finance/invoices/inv_1", "event=e1&version=v2"],
      ["/finance/invoices/inv_1/send", "event=e1&version=v2"],
      ["/finance/invoices/statements", "event=e1"],
      ["/finance/invoices/statements/p1", "event=e1"],
    ] as const) {
      expect(place(path, query), `${path}?${query}`).toEqual({ tab: "money", view: "more-tools" });
    }
  });
});

describe("invoice parent links (#1576)", () => {
  it("the list and the statements list go back to More money tools for the same event", () => {
    const list = renderToStaticMarkup(createElement(Invoices, { eventId: "event-1", canFinalize: false, view: { isDeferred: false } }));
    expect(list).toContain('href="/finance/tools?event=event-1"');
    expect(list).toContain("Back to More money tools");
    const statements = renderToStaticMarkup(createElement(StatementsList, { eventId: "event-1", eventName: "Spring Camporee 2027", parties: [], totals: { invoiceCount: 0, invoicedCents: 0, paidCents: 0, outstandingCents: 0, overpaidCents: 0 } }));
    expect(statements).toContain('href="/finance/tools?event=event-1"');
    expect(statements).toContain('href="/finance/invoices?event=event-1"');
    expect(statements.match(/Back to More money tools/g)).toHaveLength(1);
  });
});

function version(): InvoiceVersionSummary {
  return {
    id: "v1", invoiceId: "i1", revision: 0, status: "FINALIZED", basis: "RECONCILIATION", supersedesVersionId: null, reconciliationVersionId: "recon-1", reconciliationVersionNumber: 2,
    number: "SC27-0001", groupTitle: "Church One", organizationName: "Church One", contact, registeredCount: 5, billableCount: 4, amountDueCents: 10000, amountsFingerprint: "fp",
    manualLines: [], revisionReason: null, createdAt: "2026-10-04T10:00:00.000Z", createdByName: "Fran Finance", regenerationCount: 0, finalizedAt: "2026-10-04T12:00:00.000Z", finalizedByName: "Tess Treasurer",
    supersededAt: null, supersededByVersionId: null, receivable: { amountCents: 10000, status: "OPEN" },
  };
}

describe("invoice record headers (#1576)", () => {
  it("the detail header names the event, payer, number and state before the sections", () => {
    const shown = version();
    const snapshot: InvoiceSnapshot = {
      schema: 1, event: { id: "event-1", name: "Spring Camporee 2027" }, groupKey: "organization:church-1", groupTitle: "Church One", invoiceGrouping: "PER_CHURCH",
      party: { kind: "ORGANIZATION", id: "church-1", name: "Church One" }, clubId: null, reconciliation: { versionId: "recon-1", versionNumber: 2, ruleVersion: "attended-v1" },
      lines: [], totals: { registered: 0, checkedIn: 0, noShow: 0, billable: 0, amountDueCents: 10000 },
    };
    const detail: InvoiceDetail = {
      invoice: { id: "i1", groupKey: "organization:church-1", baseNumber: "SC27-0001", invoiceGrouping: "PER_CHURCH", partyKind: "ORGANIZATION" },
      versions: [shown], discarded: [], shown, snapshot, change: null, needsFinalizePermission: false, currentContact: contact, contactChanged: false, amountsOutOfDate: false, churchDraftStale: false,
      hasOpenDraft: false, liveFinalized: shown, reconciliationFreshness: "CURRENT", approvedReconciliationVersionId: "recon-1",
    };
    const markup = renderToStaticMarkup(createElement(InvoiceDetailView, { eventId: "event-1", eventName: "Renamed Camporee", detail, canFinalize: false, viewerName: "Tess Treasurer" }));
    const header = markup.slice(0, markup.indexOf('aria-label="Invoice summary"'));
    expect(header).toContain("Event Renamed Camporee");
    expect(header).toContain("Billed to Church One");
    expect(header).toContain("SC27-0001");
    expect(header).toContain("Finalized");
    expect(header).toContain("/finance/invoices?event=event-1");
  });

  it("the send header names the event, payer, number and state, and links back with its version", () => {
    const preview = {
      eventId: "event-1", eventName: "Spring Camporee 2027", invoiceId: "i1",
      version: { id: "v1", number: "SC27-0001", status: "FINALIZED", amountDueCents: 10000, organizationName: "Church One", finalizedAt: "2026-10-04T12:00:00.000Z" },
      canSend: false, blockedReason: null, newerVersion: null, snapshotContact: contact, currentContact: contact, contactChanged: false, recipients: [], recipientsFingerprint: "fp",
      subject: "s", body: "b", sender: { name: "Sender", email: null, replyTo: null }, deliveryMode: "EXTERNAL_EMAIL", pdf: { filename: "f.pdf", exists: true, sha256: null }, history: [], isResend: false,
    } satisfies SendPreview;
    const markup = renderToStaticMarkup(createElement(InvoiceSendView, { preview, viewerName: "Tess Treasurer" }));
    expect(markup).toContain("Event Spring Camporee 2027");
    expect(markup).toContain("Billed to Church One");
    expect(markup).toContain("Finalized");
    expect(markup).toContain("SC27-0001");
    expect(markup).toContain('href="/finance/invoices/i1?event=event-1&amp;version=v1"');
    expect(markup).toContain("Back to the invoice");
  });

  const detailFor = (shown: InvoiceVersionSummary) => ({
    invoice: { id: "i1", groupKey: "organization:church-1", baseNumber: "SC27-0001", invoiceGrouping: "PER_CHURCH", partyKind: "ORGANIZATION" },
    versions: [shown], discarded: [], shown, change: null, needsFinalizePermission: false, currentContact: contact, contactChanged: false, amountsOutOfDate: false, churchDraftStale: false,
    hasOpenDraft: shown.status === "DRAFT", liveFinalized: shown.status === "FINALIZED" ? shown : null, reconciliationFreshness: "CURRENT", approvedReconciliationVersionId: "recon-1",
    snapshot: { schema: 1, event: { id: "event-1", name: "Old name" }, groupKey: "organization:church-1", groupTitle: "Church One", invoiceGrouping: "PER_CHURCH", party: { kind: "ORGANIZATION", id: "church-1", name: "Church One" }, clubId: null, reconciliation: { versionId: "recon-1", versionNumber: 2, ruleVersion: "attended-v1" }, lines: [], totals: { registered: 0, checkedIn: 0, noShow: 0, billable: 0, amountDueCents: 10000 } },
  }) as unknown as InvoiceDetail;
  const ledgerFor = (settlement: string) => ({ invoiceId: "i1", settlement, live: { id: "v1", number: "SC27-0001", status: "FINALIZED", posting: null }, versions: [{ id: "v1", number: "SC27-0001", status: "FINALIZED", posting: null }], payments: [], figures: { amountDueCents: 10000, paidCents: 5000, outstandingCents: 5000, overpaidCents: 0 }, postingCount: 0 }) as never;

  it("the detail header carries the payment status in words for a finalized invoice", () => {
    for (const [settlement, words] of [["PARTIALLY_PAID", "Partly paid"], ["PAID", "Paid"]] as const) {
      const markup = renderToStaticMarkup(createElement(InvoiceDetailView, { eventId: "event-1", eventName: "Renamed", detail: detailFor(version()), canFinalize: false, viewerName: "T", ledger: ledgerFor(settlement) }));
      const header = markup.slice(0, markup.indexOf('aria-label="Invoice summary"'));
      expect(header).toContain(words);
      expect(header).toContain("Finalized");
    }
  });

  it("a draft header has no payment status and says the number is assigned when finalized", () => {
    const draft = { ...version(), status: "DRAFT", number: null, finalizedAt: null, finalizedByName: null, receivable: null } as InvoiceVersionSummary;
    const markup = renderToStaticMarkup(createElement(InvoiceDetailView, { eventId: "event-1", eventName: "Renamed", detail: detailFor(draft), canFinalize: false, viewerName: "T", ledger: ledgerFor("UNPAID") }));
    const header = markup.slice(0, markup.indexOf('aria-label="Invoice summary"'));
    expect(header).toContain("Draft");
    expect(header).toContain("Number assigned when finalized");
    expect(header).not.toContain("Unpaid");
  });

  it("the send header shows payment status once and the number once", () => {
    const preview = {
      eventId: "event-1", eventName: "Renamed", invoiceId: "i1",
      version: { id: "v1", number: "SC27-0001", status: "FINALIZED", amountDueCents: 10000, organizationName: "Church One", finalizedAt: "2026-10-04T12:00:00.000Z" },
      canSend: false, blockedReason: null, newerVersion: null, snapshotContact: contact, currentContact: contact, contactChanged: false, recipients: [], recipientsFingerprint: "fp",
      subject: "s", body: "b", sender: { name: "Sender", email: null, replyTo: null }, deliveryMode: "EXTERNAL_EMAIL", pdf: { filename: "f.pdf", exists: true, sha256: null }, history: [], isResend: false,
    } satisfies SendPreview;
    const markup = renderToStaticMarkup(createElement(InvoiceSendView, { preview, viewerName: "T", settlement: "PARTIALLY_PAID" }));
    expect(markup).toContain("Partly paid");
    expect(markup.match(/SC27-0001/g)?.length).toBe(1);
    expect(renderToStaticMarkup(createElement(InvoiceSendView, { preview, viewerName: "T", settlement: "UNAVAILABLE" }))).toContain("Payment status unavailable");
  });

  it("shows Unpaid and Nothing due once, and no payment word on a replaced version or a draft", () => {
    const render = (shown: InvoiceVersionSummary, settlement: string, liveId = "v1") => {
      const ledger = { ...(ledgerFor(settlement) as object), live: { id: liveId, number: "SC27-0001", status: "FINALIZED", posting: null } } as never;
      const markup = renderToStaticMarkup(createElement(InvoiceDetailView, { eventId: "event-1", eventName: "Renamed", detail: detailFor(shown), canFinalize: false, viewerName: "T", ledger }));
      return markup.slice(0, markup.indexOf('aria-label="Invoice summary"'));
    };
    expect(render(version(), "UNPAID")).toContain("Unpaid");
    const zero = render({ ...version(), amountDueCents: 0 }, "NOTHING_DUE");
    expect(zero).toContain("Nothing due");
    expect(zero).not.toContain("nothing owed");
    const replaced = { ...version(), status: "SUPERSEDED" } as InvoiceVersionSummary;
    const header = render(replaced, "PARTIALLY_PAID", "v2");
    expect(header).toContain("Superseded");
    expect(header).not.toMatch(/Partly paid|Unpaid|Paid/);
  });

  it("the send header shows no payment word for a replaced version or without a status", () => {
    const base = {
      eventId: "event-1", eventName: "Renamed", invoiceId: "i1",
      version: { id: "v1", number: "SC27-0001", status: "SUPERSEDED", amountDueCents: 10000, organizationName: "Church One", finalizedAt: "2026-10-04T12:00:00.000Z" },
      canSend: false, blockedReason: "replaced", newerVersion: null, snapshotContact: contact, currentContact: contact, contactChanged: false, recipients: [], recipientsFingerprint: "fp",
      subject: "s", body: "b", sender: { name: "Sender", email: null, replyTo: null }, deliveryMode: "EXTERNAL_EMAIL", pdf: { filename: "f.pdf", exists: true, sha256: null }, history: [], isResend: false,
    } satisfies SendPreview;
    const markup = renderToStaticMarkup(createElement(InvoiceSendView, { preview: base, viewerName: "T", settlement: "PARTIALLY_PAID" }));
    expect(markup).toContain("Superseded");
    expect(markup).not.toMatch(/Partly paid|unavailable/);
    const live = { ...base, version: { ...base.version, status: "FINALIZED" as const } };
    expect(renderToStaticMarkup(createElement(InvoiceSendView, { preview: live, viewerName: "T", settlement: null }))).not.toMatch(/Partly paid|Unpaid|unavailable/);
    expect(renderToStaticMarkup(createElement(InvoiceSendView, { preview: live, viewerName: "T", settlement: "UNPAID" }))).toContain("Unpaid");
  });
});
