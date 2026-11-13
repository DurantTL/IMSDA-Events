import { Download, WalletCards } from "lucide-react";
import { ExportLink } from "@/components/export-link";
import { Money } from "@/components/exact-value";
import { withCurrentEvent } from "@/components/staff-navigation";
import { formatCents } from "@/modules/payments/format-cents";
import type { EventMoneyReport, UnmatchedSquareSummary } from "@/modules/payments/event-money-report-repository";
import { moneyMethodLabels, moneyMethods } from "@/modules/payments/event-money-report-domain";
import styles from "@/components/event-money-report.module.css";

type Props = {
  eventId: string;
  data: EventMoneyReport;
  /** The Payments page and its filters are for MANAGE_FINANCE; a reports-only viewer sees no links to them and no names. */
  canManageFinance: boolean;
  /** Square payments not matched to a registration of this event. "Unavailable" and "not configured" never read as zero. */
  unmatchedSquare: UnmatchedSquareSummary;
};

function Line({ label, cents, includes, href, linkLabel, sub }: { label: string; cents: number; includes: string; href?: string; linkLabel?: string; sub?: boolean }) {
  return (
    <li className={`${styles.line}${sub ? ` ${styles.sub}` : ""}`}>
      <p className={styles.label}>{label}</p>
      <strong className={styles.amount}><Money cents={cents} /></strong>
      <div className={styles.detail}>
        <p className={styles.detailText}>{includes}</p>
        {href ? <a className={styles.open} href={href}>{linkLabel ?? "Open the list"}</a> : null}
      </div>
    </li>
  );
}

export function EventMoneyReportView({ eventId, data, canManageFinance, unmatchedSquare }: Props) {
  const { report, eventName } = data;
  const payments = (filter: string) => (canManageFinance ? withCurrentEvent(`/finance?filter=${filter}`, eventId) : undefined);
  const page = (path: string) => (canManageFinance ? withCurrentEvent(path, eventId) : undefined);
  const { charges, paid, churchBilled } = report;
  const flagged = report.uncountedPayments;
  return (
    <section className={`page-stack ${styles.stack}`}>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Financial operations</p>
          <h2>Event money report</h2>
          <p>
            {eventName}: what was charged, discounted, paid and refunded, and what is still owed. Built from the payment, refund, discount and invoice
            records the site already keeps. It only reads: it never charges, refunds or changes a balance.
          </p>
        </div>
        <div className="page-intro-actions button-pair">
          {canManageFinance ? <a className="secondary-button" href={withCurrentEvent("/finance", eventId)}><WalletCards aria-hidden="true" size={17} /> Payments</a> : null}
          <ExportLink className="secondary-button" href={`/api/events/${encodeURIComponent(eventId)}/exports/money-report`}><Download aria-hidden="true" size={17} /> Download CSV</ExportLink>
        </div>
      </div>

      {report.check.ok
        ? <p className={styles.ok} role="status" data-testid="money-check">The lines below add up, and match each registration&apos;s balance on the Payments page.</p>
        : <p className={styles.bad} role="alert" data-testid="money-check">These lines do not add up to the balances on the Payments page. Do not rely on this report until the finance office has looked into it.</p>}

      <section className={styles.panel} aria-labelledby="money-charges">
        <h3 className={styles.panelHeading} id="money-charges">Charges</h3>
        <p className={styles.note}>Active registrations only (submitted or confirmed). Draft, waitlisted and cancelled registrations are never counted as owing.</p>
        <ul className={styles.lines}>
          <Line label="Gross charges" cents={charges.grossCents} includes="An estimate, not part of the reconciliation below: net due plus the discounts, promo codes and scholarships recorded on these registrations. Corrections, meal and asset lines stay inside this figure." href={payments("ACTIVE")} />
          <Line sub label="Promo code discounts" cents={charges.promoCents} includes="The promo code used at registration plus per-person promo codes added by staff, net of reversals." href={page("/more/promo-codes")} linkLabel="Open promo codes" />
          <Line sub label="Discounts" cents={charges.discountCents} includes="Discounts staff added to a registration, net of reversals." href={payments("ACTIVE")} />
          <Line sub label="Scholarships" cents={charges.scholarshipCents} includes="Scholarships, pledged and funded, net of reversals." href={page("/finance/scholarship-fund")} linkLabel="Open the scholarship fund" />
          <Line label="Net due" cents={charges.netDueCents} includes="What these registrations owe in total: the registration totals, including church-billed ones." href={payments("ACTIVE")} />
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="money-paid">
        <h3 className={styles.panelHeading} id="money-paid">Paid and refunded</h3>
        <ul className={styles.lines}>
          <Line label="Paid" cents={paid.totalCents} includes="Every successful payment on any registration of this event, before refunds." href={payments("ALL")} />
          {moneyMethods.map((method) => (
            <Line key={method} sub label={moneyMethodLabels[method]} cents={paid.byMethod[method]} includes={method === "CARD_REFERENCE" ? "Successful card payments taken through Square." : method === "MANUAL" ? "Payments staff recorded another way." : `Successful ${moneyMethodLabels[method].toLowerCase()} payments recorded by staff.`} />
          ))}
          <Line label="Church invoices received" cents={churchBilled.invoices.receivedCents} includes={`Payments recorded on ${churchBilled.invoices.invoiceCount} finalized church invoices, less voided payments. Not part of the line above.`} href={page("/finance/invoices")} linkLabel="Open invoices" />
          <Line label="Refunds" cents={report.refundsCents} includes="Successful refunds of successful payments." href={payments("REFUNDED")} />
          <Line sub label={`Pending payments (${flagged.PENDING.count})`} cents={flagged.PENDING.cents} includes="Started but not complete. Not counted as paid." href={payments("ALL")} />
          <Line sub label={`Failed payments (${flagged.FAILED.count})`} cents={flagged.FAILED.cents} includes="Declined or failed. Not counted as paid." href={payments("ALL")} />
          <Line sub label={`Voided payments (${flagged.VOIDED.count})`} cents={flagged.VOIDED.cents} includes="Cancelled before they counted. Not counted as paid." href={payments("ALL")} />
          <Line sub label={`Pending refunds (${report.uncountedRefunds.PENDING.count})`} cents={report.uncountedRefunds.PENDING.cents} includes="Requested but not complete. Not counted as refunded." href={payments("ALL")} />
          <Line sub label={`Failed refunds (${report.uncountedRefunds.FAILED.count})`} cents={report.uncountedRefunds.FAILED.cents} includes="Could not be completed. Not counted as refunded." href={payments("ALL")} />
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="money-owed">
        <h3 className={styles.panelHeading} id="money-owed">Outstanding</h3>
        <ul className={styles.lines}>
          <Line label="Outstanding balance" cents={report.outstandingCents} includes="What attendee-billed, active registrations still owe, as the Payments page shows each one. Church-billed registrations are not included." href={payments("BALANCE")} />
          <Line label="Billed to churches" cents={churchBilled.estimatedCents} includes={`${churchBilled.registrationCount} church-billed active registrations. The church is invoiced after the event, so this is never an attendee balance.`} href={payments("CHURCH_BILLED")} />
          <Line sub label="Church invoices still owed" cents={churchBilled.invoices.stillOwedCents} includes={`Of ${formatCents(churchBilled.invoices.invoicedCents)} on finalized invoices, per invoice and never below zero.`} href={page("/finance/invoices")} linkLabel="Open invoices" />
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="money-reconcile">
        <h3 className={styles.panelHeading} id="money-reconcile">How the outstanding balance adds up</h3>
        <p className={styles.note}>Attendee-billed active registrations only. A registration that paid more than it owes keeps its extra as overpaid credit; it is not used against anyone else&apos;s balance.</p>
        <ul className={styles.lines} data-testid="money-reconciliation">
          {report.reconciliation.map((line) => (
            <li key={line.key} className={styles.line}>
              <p className={styles.label}>{line.sign} {line.label}</p>
              <strong className={styles.amount}><Money cents={line.cents} /></strong>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          Left out of the lines above: {report.notActive.registrationCount} draft, waitlisted or cancelled registrations hold <Money cents={report.notActive.paymentsCents} /> in
          payments and <Money cents={report.notActive.refundsCents} /> in refunds
          {canManageFinance ? <> (<a href={withCurrentEvent("/finance?filter=CANCELLED", eventId)}>cancelled</a>, <a href={withCurrentEvent("/finance?filter=WAITLISTED", eventId)}>waitlisted</a>)</> : null}; church-billed
          registrations hold <Money cents={churchBilled.attendeePaymentsNetCents} /> in attendee payments, net of refunds.
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="money-square">
        <h3 className={styles.panelHeading} id="money-square">Square payments not matched</h3>
        <ul className={styles.lines}>
          {unmatchedSquare.state === "ok"
            ? <Line label={`${unmatchedSquare.count} not matched to a registration`} cents={unmatchedSquare.cents} includes="Read live from Square for this event. Not counted in any figure above until matched." href={page("/finance/square-payments")} linkLabel="Open the match tool" />
            : (
              <li className={styles.line}>
                <p className={styles.label}>{unmatchedSquare.state === "notConfigured" ? "Square is not set up" : "Unavailable"}</p>
                <div className={styles.detail}>
                  <p className={styles.detailText}>{unmatchedSquare.state === "notConfigured"
                    ? "Square is not configured for this site. Ask your event administrator or the system administrator to set it up; nothing is shown as zero."
                    : "Square could not be read just now, so this is not shown as zero. Try again shortly."}</p>
                  {canManageFinance ? <a className={styles.open} href={withCurrentEvent("/finance/square-payments", eventId)}>Open the match tool</a> : null}
                </div>
              </li>
            )}
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="money-owing">
        <h3 className={styles.panelHeading} id="money-owing">Registrations that still owe ({report.owing.length})</h3>
        {report.owing.length === 0 ? <p className={styles.note}>No active registration owes a balance.</p> : (
          <ul className={styles.owing} data-testid="money-owing">
            {report.owing.map((row) => (
              <li className={styles.owingRow} key={row.id}>
                <div className={styles.owingText}>
                  {canManageFinance
                    ? <a className={`${styles.code} ${styles.open}`} href={withCurrentEvent(`/finance?registration=${encodeURIComponent(row.id)}`, eventId)}>{row.confirmationCode}</a>
                    : <span className={styles.code}>{row.confirmationCode}</span>}
                  {canManageFinance && row.accountHolderName ? <span className={styles.note}>{row.accountHolderName}</span> : null}
                  <span className={styles.note}>Due <Money cents={row.totalAmountCents} />, paid <Money cents={row.paidCents} /></span>
                </div>
                <strong className={styles.amount}><Money cents={row.balanceCents} /></strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
