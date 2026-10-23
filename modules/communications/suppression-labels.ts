/**
 * The staff-facing wording for a suppressed address (#863). Pure, so a client component can use it: the person, the
 * registration, Email health and the delivery log all say the same thing.
 */

export type SuppressionReasonName = "BOUNCE" | "COMPLAINT";

export function suppressionLabel(reason: SuppressionReasonName): string {
  return reason === "COMPLAINT" ? "Not sending: complaint" : "Not sending: bounced";
}

/** What the delivery log records on a message that was held back because of its address. */
export function suppressionSkipNote(reason: SuppressionReasonName): string {
  return reason === "COMPLAINT"
    ? "Not sent: this address reported an earlier email as spam, so no email goes to it until a system administrator re-enables it."
    : "Not sent: an earlier email to this address bounced permanently, so no email goes to it until a system administrator re-enables it.";
}

/** The longer explanation shown beside the label. */
export function suppressionExplanation(reason: SuppressionReasonName): string {
  return reason === "COMPLAINT"
    ? "This address reported an email as spam. No email of any kind goes to it, confirmations and receipts included, until a system administrator re-enables it."
    : "An email to this address bounced permanently. No email of any kind goes to it, confirmations and receipts included, until a system administrator re-enables it.";
}
