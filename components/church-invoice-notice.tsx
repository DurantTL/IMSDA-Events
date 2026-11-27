import { PerPersonPriceNotice } from "@/components/per-person-price-notice";
import {
  CHURCH_INVOICE_TIMING,
  NO_PAYMENT_ONLINE,
  linesNotCoveredByTerms,
  termsMatchPrice,
  type ChurchInvoiceTerms,
} from "@/modules/club-registrations/church-invoice-terms";
import type { PerPersonPrice } from "@/modules/club-registrations/per-person-price";
import {
  CHURCH_BILLED_ORGANIZATION,
  priceForBilledOrganization,
  schoolBilledSentence,
  schoolInvoiceTiming,
  type BilledOrganization,
} from "@/modules/club-registrations/billed-organization";

/**
 * What a church-invoiced registration leads with (#743): the per-person rate
 * and its terms, built from the event's configured fee and dates, then that no
 * payment is collected here. When the fee is too varied to state in one line
 * (`terms` is null) the per-person notice from #621 stands in. No total is
 * shown: a church-billed registrant is never given a sum (#621). A
 * school-billed form (`billed` is SCHOOL) names the school instead of a church.
 */
export function ChurchInvoiceNotice({
  terms,
  price,
  className,
  billed = CHURCH_BILLED_ORGANIZATION,
}: {
  terms: ChurchInvoiceTerms | null;
  price: PerPersonPrice;
  className?: string;
  billed?: BilledOrganization;
}) {
  if (!terms || !termsMatchPrice(terms, price)) return <PerPersonPriceNotice price={priceForBilledOrganization(price, billed)} className={className} />;
  return (
    <div className={`church-invoice-notice${className ? ` ${className}` : ""}`} data-testid="church-invoice-terms">
      <p className="church-invoice-rate"><strong>{terms.rateSentence}</strong></p>
      <p className="church-invoice-terms">
        {billed.kind === "SCHOOL"
          ? schoolBilledSentence(billed)
          : "No payment is collected with this form — your church will be invoiced after the event based on confirmed attendance."}
      </p>
      <PerPersonPriceNotice
        price={{ ...price, registrationLines: linesNotCoveredByTerms(terms, price) }}
        showNotice={false}
      />
    </div>
  );
}

/** The review step's invoice facts: nothing due online, who is invoiced, and when. */
export function ChurchInvoiceReviewFacts({ recipient, billed = CHURCH_BILLED_ORGANIZATION }: { recipient: string | null; billed?: BilledOrganization }) {
  const school = billed.kind === "SCHOOL";
  return (
    <dl className="church-invoice-facts" data-testid="church-invoice-facts">
      <div><dt>Payment</dt><dd>{NO_PAYMENT_ONLINE}</dd></div>
      <div><dt>Invoice recipient</dt><dd translate={recipient ? "no" : undefined}>{recipient ?? (school ? "Your school" : "Your church")}</dd></div>
      <div><dt>Invoice timing</dt><dd>{school ? schoolInvoiceTiming(billed) : CHURCH_INVOICE_TIMING}</dd></div>
    </dl>
  );
}
