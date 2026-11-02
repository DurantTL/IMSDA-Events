import type { ElementType, ReactNode } from "react";
import { formatCents } from "@/modules/payments/format-cents";

/**
 * Text a browser translator must leave exactly as written (rule T1): names,
 * confirmation and sign-in codes, amounts, emails, phone numbers and web
 * addresses. It renders one element with `translate="no"` around the value.
 *
 * Use it for values only. Never wrap an instruction, label, heading, button or
 * a container that holds them; those must translate. Put the English fallback
 * ("Not named", "None entered") outside, so only a real value is protected:
 * `{name ? <ExactValue>{name}</ExactValue> : "Not named"}`.
 *
 * It is also the unit that keeps React's text node alive when a translator
 * rewrites the page around it (lib/translation-safety.ts).
 */
export function ExactValue({
  as,
  children,
  className,
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
}) {
  const Tag = as ?? "span";
  return <Tag className={className} translate="no">{children}</Tag>;
}

/** A dollar amount from whole cents, printed by `formatCents` and never translated. */
export function Money({
  as,
  cents,
  className,
  options,
}: {
  as?: ElementType;
  cents: number;
  className?: string;
  options?: Parameters<typeof formatCents>[1];
}) {
  return <ExactValue as={as} className={className}>{formatCents(cents, options)}</ExactValue>;
}

/** An email address, never translated. */
export function EmailValue({ address, className }: { address: string; className?: string }) {
  return <ExactValue className={className}>{address}</ExactValue>;
}

/** A phone number, never translated. */
export function PhoneValue({ number, className }: { number: string; className?: string }) {
  return <ExactValue className={className}>{number}</ExactValue>;
}

/** A confirmation, sign-in or invite code, never translated. */
export function CodeValue({ code, className }: { code: string; className?: string }) {
  return <ExactValue className={className}>{code}</ExactValue>;
}
