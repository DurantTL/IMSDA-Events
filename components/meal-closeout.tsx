import { Money } from "@/components/exact-value";
import { Download } from "lucide-react";
import { MealCloseoutReviewForm } from "@/components/meal-closeout-review-form";
import {
  exceptionCategoryLabels, formatCents, totalMeals,
  type CloseoutRow, type CloseoutTotals, type MealCases, type ReviewedException,
} from "@/modules/meals/closeout";
import { eventLocalDateTime } from "@/modules/meals/scanner-import";

type Closeout = {
  rows: CloseoutRow[];
  totals: CloseoutTotals;
  exceptions: ReviewedException[];
  openExceptions: number;
  asOf: string;
  timeZone: string;
  sources: { selections: number; ledgerEntries: number; adjustments: number; tickets: number; served: number; kitchenEntries: number; digest: string };
};

/** What each figure means, shown with the table so a total is never read as something else. */
export const closeoutDefinitions = [
  ["Meal charges and credits", "From the meal ledger, attendee-paid only. A cancellation or a lower quantity is a credit at the price charged. Nothing is edited or netted away."],
  ["Where the net went", "In registration price: already in the registration's total. Posted: a meal line on the registration. Walk-up: paid at the counter. Not live: the registration is cancelled, so the credit is on the ledger only."],
  ["Ordered and served", "Active café tickets by case: paid, complimentary (no charge), conference-paid, walk-up. Served is what the scanner shows as eaten, never changed by kitchen counts."],
  ["Served on cancelled tickets or registrations", "Meals eaten on a ticket cancelled afterwards, or on a registration that is no longer submitted or confirmed. They stay served and are kept apart from the cases above."],
  ["Billed to conference", "Conference-paid meals served times the rate on file for each order. A meal with no rate is an exception, not zero."],
  ["Kitchen counts", "Prepared, wasted, donated and transferred, as entered. Shown for reading: they are not charges and not proof of revenue."],
] as const;

const cases = (value: MealCases) => `${value.paid} paid · ${value.complimentary} complimentary · ${value.conference} conference · ${value.walkUp} walk-up`;
const kitchenFigure = (value: number | null) => (value === null ? "—" : String(value));

function MoneyRow({ name, row, header }: { name: string; row: CloseoutTotals; header?: boolean }) {
  return (
    <tr role="row" className={header ? "served-total" : undefined}>
      <th role="rowheader" scope="row">{name}</th>
      <td role="cell" data-label="Charges and credits">
        <strong><Money cents={row.net} /></strong>
        <span className="field-help served-split"><Money cents={row.charges} /> charged · <Money cents={row.credits} /> credited</span>
      </td>
      <td role="cell" data-label="Where the net went">
        <span className="served-split">In registration price <Money cents={row.settlement.inRegistration} /></span>
        <span className="served-split">Posted to registration <Money cents={row.settlement.registrationAdjustment} /></span>
        <span className="served-split">Walk-up at counter <Money cents={row.settlement.counter} /></span>
        <span className="served-split">Registration not live <Money cents={row.settlement.registrationNotLive} /></span>
      </td>
      <td role="cell" data-label="Ordered">
        <strong>{totalMeals(row.ordered)}</strong>
        <span className="field-help served-split">{cases(row.ordered)}</span>
      </td>
      <td role="cell" data-label="Served">
        <strong>{totalMeals(row.served) + row.servedOnCancelled}</strong>
        <span className="field-help served-split">{cases(row.served)}</span>
        {row.servedOnCancelled > 0 && <span className="field-help served-split">{row.servedOnCancelled} on cancelled tickets</span>}
      </td>
      <td role="cell" data-label="Billed to conference">
        <strong><Money cents={row.conferenceBilled} /></strong>
        <span className="field-help served-split">{row.conferenceServed} served{row.conferenceRateMissing > 0 ? ` · ${row.conferenceRateMissing} with no rate` : ""}</span>
      </td>
      <td role="cell" data-label="Kitchen counts">
        <span className="served-split">Prepared {kitchenFigure(row.kitchen.prepared)} · Wasted {kitchenFigure(row.kitchen.wasted)}</span>
        <span className="served-split">Donated {kitchenFigure(row.kitchen.donated)} · Transferred {kitchenFigure(row.kitchen.transferred)}</span>
      </td>
    </tr>
  );
}

/**
 * Meal money closeout (#212): money by service beside ordered and served, then the exceptions with their review state.
 * Amounts and ids only, no attendee names. Reviewing an exception records a note; it moves no money.
 */
export function MealCloseout({ eventId, closeout, csvHref, exceptionsCsvHref }: { eventId: string; closeout: Closeout; csvHref: string; exceptionsCsvHref: string }) {
  const { rows, totals, exceptions, openExceptions, sources } = closeout;
  return (
    <>
      <section className="panel kitchen-counts meal-closeout" aria-labelledby="closeout-title">
        <div className="section-heading">
          <div>
            <h3 id="closeout-title">Meal money by service</h3>
            <p className="field-help">
              As of {eventLocalDateTime(new Date(closeout.asOf), closeout.timeZone)}. Built from {sources.ledgerEntries} ledger entries, {sources.adjustments} registration meal lines
              and {sources.tickets} tickets; the same source records always give the same figures (check code {sources.digest.slice(0, 12)}).
              This page reads only: it posts no charge, issues no refund and changes no price.
            </p>
          </div>
          <div className="intro-actions">
            <a className="secondary-button" href={csvHref}><Download aria-hidden="true" size={16} /> Download CSV</a>
          </div>
        </div>
        <dl className="kitchen-definitions field-help">
          {closeoutDefinitions.map(([term, text]) => <div key={term}><dt><strong>{term}</strong></dt><dd>{text}</dd></div>)}
        </dl>
        {rows.length === 0 ? (
          <p>This event has no meal orders, tickets or kitchen counts, so there is nothing to close out.</p>
        ) : (
          <div className="report-table-wrap"><table role="table" className="report-table report-table-auto table-cards table-cards-tablet">
            <caption className="sr-only">Meal charges, credits, ordered and served meals, conference billing and kitchen counts by service</caption>
            <thead role="rowgroup"><tr role="row">
              <th role="columnheader" scope="col">Service</th><th role="columnheader" scope="col">Charges and credits</th><th role="columnheader" scope="col">Where the net went</th>
              <th role="columnheader" scope="col">Ordered</th><th role="columnheader" scope="col">Served</th><th role="columnheader" scope="col">Billed to conference</th>
              <th role="columnheader" scope="col">Kitchen counts</th>
            </tr></thead>
            <tbody role="rowgroup">
              {rows.map((row) => <MoneyRow key={row.key} name={row.label} row={row} />)}
              <MoneyRow name="All services" row={totals} header />
            </tbody>
          </table></div>
        )}
      </section>

      <section className="panel meal-closeout-exceptions" aria-labelledby="closeout-exceptions-title">
        <div className="section-heading">
          <div>
            <h3 id="closeout-exceptions-title">Exceptions to review</h3>
            <p className="field-help" role="status">
              {exceptions.length === 0 ? "No exceptions." : `${openExceptions} open of ${exceptions.length}.`} Acknowledging records who looked and why; it changes no figure.
              An acknowledged exception opens again if its figures change.
            </p>
          </div>
          <div className="intro-actions">
            <a className="secondary-button" href={exceptionsCsvHref}><Download aria-hidden="true" size={16} /> Download exceptions CSV</a>
          </div>
        </div>
        {exceptions.length > 0 && (
          <ul className="closeout-exception-list">
            {exceptions.map((exception) => (
              <li key={exception.key} className="closeout-exception">
                <h4>{exceptionCategoryLabels[exception.category]}: {exception.scope}</h4>
                <p>{exception.message}</p>
                <p className="field-help">
                  {Object.entries(exception.detail).map(([name, value]) => `${name}: ${typeof value === "number" && name.endsWith("Cents") ? formatCents(value) : value}`).join(" · ")}
                </p>
                {exception.sourceIds.length > 0 && (
                  <p className="field-help">
                    Source records: {exception.sourceIds.join(", ")}
                    {exception.sourceIdsTotal > exception.sourceIds.length ? ` and ${exception.sourceIdsTotal - exception.sourceIds.length} more` : ""}
                  </p>
                )}
                <p className="field-help">
                  {exception.state === "ACKNOWLEDGED" ? "Acknowledged" : exception.changedSinceReview ? "Open: its figures changed since it was acknowledged" : "Open"}
                  {exception.current ? ` · last review by ${exception.current.reviewedBy}, ${eventLocalDateTime(new Date(exception.current.reviewedAt), closeout.timeZone)}: ${exception.current.note}` : ""}
                </p>
                <MealCloseoutReviewForm
                  eventId={eventId} exceptionKey={exception.key} detailDigest={exception.detailDigest}
                  acknowledged={exception.state === "ACKNOWLEDGED"} label={`${exception.code} ${exception.scope}`}
                />
                {exception.history.length > 1 && (
                  <details>
                    <summary>Review history ({exception.history.length})</summary>
                    <ul className="field-help">
                      {exception.history.map((review) => (
                        <li key={review.id}>{review.status === "ACKNOWLEDGED" ? "Acknowledged" : "Reopened"} · {review.reviewedBy} · {eventLocalDateTime(new Date(review.reviewedAt), closeout.timeZone)}: {review.note}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
