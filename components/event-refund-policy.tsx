import { ReceiptText } from "lucide-react";
import { refundPolicyParagraphs } from "@/modules/events/refund-policy";

/**
 * An event's refund policy as plain paragraphs (#891). Renders nothing when the
 * event has no policy, so there is never an empty heading. Display only: every
 * paragraph is a React text child, so staff-authored text is escaped.
 */
export function EventRefundPolicy({
  policy,
  headingLevel = 2,
  className = "",
}: {
  policy: string | null | undefined;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const paragraphs = refundPolicyParagraphs(policy);
  if (paragraphs.length === 0) return null;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={`event-refund-policy ${className}`.trim()} aria-label="Refund policy">
      <div className="event-refund-policy-heading">
        <ReceiptText size={18} aria-hidden="true" />
        <Heading>Refund policy</Heading>
      </div>
      {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </section>
  );
}
