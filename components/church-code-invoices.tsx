import { Building2 } from "lucide-react";
import { ChurchDraftControl } from "@/components/church-code-invoice-control";
import {
  churchDraftAction,
  churchInvoiceStateLabel,
  type ChurchCodeReportRow,
} from "@/modules/promo-codes/church-invoice";
import type { ChurchCodeReport } from "@/modules/promo-codes/church-invoice-repository";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * The church promo code report and invoices (#399). For each church that sponsors a code: who used it (by confirmation
 * code, never a name), what it covered, what its invoice bills, what was paid and what is still owed. Staff prepare or
 * refresh a DRAFT invoice here; the office finalizes and sends it from the invoice, which stays a named human action
 * (the Finalize invoices permission), and recording a payment is the invoice's own action. Nothing on this screen
 * finalizes, sends or emails anything.
 */
export function ChurchCodeInvoices({ eventId, report, canFinalize }: { eventId: string; report: ChurchCodeReport; canFinalize: boolean }) {
  if (report.rows.length === 0) return null;
  return (
    <section className="page-stack" aria-label="Church promo code invoices">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Church-sponsored promo codes</p>
          <h2>Church promo code invoices</h2>
          <p>
            Each church is invoiced for what its code covered. Create a draft from the code&apos;s usage, then the office reviews, finalizes
            and sends it
            {canFinalize ? "." : " (finalizing needs permission to finalize invoices, which a system administrator grants)."}
            {" "}Nothing is sent from here.
          </p>
        </div>
      </div>
      {!report.eligible && (
        <section className="panel billing-settings" role="status">
          <p>This event is not a general event that guests pay for themselves, so church codes bill nothing here.</p>
        </section>
      )}
      <section className="finance-summary" aria-label="Church promo code totals">
        <article className="finance-stat">
          <span><Building2 aria-hidden="true" size={18} /></span>
          <small>Covered by codes</small>
          <strong>{money(report.totals.coveredCents)}</strong>
        </article>
        <article className="finance-stat">
          <span><Building2 aria-hidden="true" size={18} /></span>
          <small>Invoiced</small>
          <strong>{money(report.totals.invoicedCents)}</strong>
        </article>
        <article className="finance-stat">
          <span><Building2 aria-hidden="true" size={18} /></span>
          <small>Paid</small>
          <strong>{money(report.totals.paidCents)}</strong>
        </article>
        <article className="finance-stat warning">
          <span><Building2 aria-hidden="true" size={18} /></span>
          <small>Still owed on invoices</small>
          <strong>{money(report.totals.owedOnInvoiceCents)}</strong>
        </article>
      </section>
      {report.rows.map((row) => <ChurchRow canFinalize={canFinalize} eventId={eventId} key={row.churchId} row={row} />)}
    </section>
  );
}

function ChurchRow({ eventId, row, canFinalize }: { eventId: string; row: ChurchCodeReportRow; canFinalize: boolean }) {
  const action = churchDraftAction(row.state);
  const invoiceHref = row.invoiceId ? `/finance/invoices/${row.invoiceId}?event=${eventId}` : null;
  return (
    <section className="panel finance-list" aria-label={`${row.churchName} promo code invoice`}>
      <div className="finance-row finance-head"><span>{row.churchName}</span><span>Covered</span><span>Invoiced / paid</span><span>Owed</span></div>
      <div className="finance-row">
        <span>
          <strong>{churchInvoiceStateLabel(row.state)}</strong>
          <small>
            {row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : row.draftAmountCents !== null ? `Draft for ${money(row.draftAmountCents)}` : "No invoice yet"}
            {row.contact ? ` · billing contact ${row.contact.name}${row.contact.verified ? "" : " (not verified)"}` : " · no billing contact on file"}
          </small>
        </span>
        <span>{money(row.coveredCents)}</span>
        <span>{money(row.invoicedCents)} / {money(row.paidCents)}</span>
        <span>
          <strong>{money(row.owedOnInvoiceCents)}</strong>
          {row.notInvoicedCents !== 0 && <small>{row.notInvoicedCents > 0 ? `${money(row.notInvoicedCents)} not invoiced yet` : `${money(-row.notInvoicedCents)} invoiced beyond current use`}</small>}
          {row.overpaidCents > 0 && <small>{money(row.overpaidCents)} overpaid</small>}
        </span>
      </div>
      <div className="finance-row">
        <span>
          <ChurchDraftControl churchId={row.churchId} disabled={!action.enabled} eventId={eventId} label={action.label} />
          {invoiceHref && <> <a className="secondary-button" href={invoiceHref}>{row.state === "FINALIZED_CURRENT" || row.state === "FINALIZED_STALE" ? "Open invoice" : "Review draft"}</a></>}
          {!canFinalize && row.state === "DRAFT_CURRENT" && <small>The office finalizes this draft.</small>}
        </span>
        <span />
        <span />
        <span />
      </div>
      {row.codes.map((code) => (
        <div className="finance-row" key={code.id}>
          <span><small>Code {code.code}{code.isActive ? "" : " (off)"}</small></span>
          <span />
          <span><small>{code.redeemedCount}{code.maximumUses !== null ? ` of ${code.maximumUses}` : ""} {code.redeemedCount === 1 ? "use" : "uses"}</small></span>
          <span />
        </div>
      ))}
      {row.lines.length === 0
        ? <div className="finance-row"><span><small>No active registration has used this church&apos;s codes yet.</small></span><span /><span /><span /></div>
        : row.lines.map((line) => (
          <div className="finance-row" key={line.lineId}>
            <span><small>Used by registration {line.confirmationCode} · code {line.promoCode} · {line.status.toLowerCase()}</small></span>
            <span>{money(line.amountCents)}</span>
            <span />
            <span />
          </div>
        ))}
    </section>
  );
}
