import { CreditCard } from "lucide-react";
import { formatCents, inPersonCardQuote } from "@/modules/payments/in-person-card";

/**
 * Shown at check-in when a registration still owes money. Staff take card
 * payments in the Square app on their phones, so this gives them the exact
 * amount to key in (balance plus Square's in-person fee) and the code to type
 * into the Square note so finance can attach the payment afterwards.
 */
export function CheckInPaymentDue({
  balanceCents,
  confirmationCode,
  partySize,
  compact = false,
}: {
  balanceCents: number;
  confirmationCode: string;
  partySize: number;
  /** A short badge for a roster row (#981): the balance and the card total, with the full wording on hover. */
  compact?: boolean;
}) {
  const quote = inPersonCardQuote(balanceCents);
  if (!quote) return null;
  if (compact) {
    return (
      <span
        className="checkin-due-badge"
        role="note"
        title={`${formatCents(quote.balanceCents)} due for ${partySize > 1 ? `all ${partySize} people on ` : ""}${confirmationCode}. Card in Square app: ${formatCents(quote.cardTotalCents)} (includes ${formatCents(quote.cardFeeCents)} card fee). Square note: ${confirmationCode}.`}
      >
        <CreditCard aria-hidden="true" size={13} />
        <b translate="no">{formatCents(quote.balanceCents)}</b> due
        {" · "}<span translate="no">{formatCents(quote.cardTotalCents)}</span> by card
      </span>
    );
  }
  return (
    <span className="checkin-payment-due" role="note">
      <CreditCard aria-hidden="true" size={14} />
      <span>
        <b>
          <span translate="no">{formatCents(quote.balanceCents)}</span> due
          {partySize > 1 && (
            <> for all {partySize} people on <span translate="no">{confirmationCode}</span></>
          )}
        </b>
        {" · "}Card in Square app: <b translate="no">{formatCents(quote.cardTotalCents)}</b>
        {" "}(includes <span translate="no">{formatCents(quote.cardFeeCents)}</span> card fee)
        {" · "}Cash or check: <span translate="no">{formatCents(quote.balanceCents)}</span>
        {" · "}Square note: <b translate="no">{confirmationCode}</b>
      </span>
    </span>
  );
}
