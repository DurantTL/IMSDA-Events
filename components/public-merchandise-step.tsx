"use client";

import { Money } from "@/components/exact-value";
import styles from "./public-merchandise-step.module.css";
import type { PublicMerchandiseOffer } from "@/modules/merchandise/registration-order-schema";

export const merchandiseNotChargedNotice = "Merchandise is not charged with your registration. The event team will tell you how to pay for it.";

export type MerchandiseSelection = Record<string, number>;

/** The chosen lines, in the order the form sends them. Sold-out sizes are never included. */
export function merchandiseLines(offer: PublicMerchandiseOffer | null, selection: MerchandiseSelection) {
  if (!offer) return [];
  return offer.products.flatMap((product) => product.variants.flatMap((variant) => {
    const quantity = selection[variant.id] ?? 0;
    return quantity > 0 && !variant.soldOut
      ? [{ productName: product.name, variantLabel: variant.label, variantId: variant.id, quantity, unitPriceCents: variant.priceCents, lineTotalCents: quantity * variant.priceCents }]
      : [];
  }));
}

export function merchandiseSubtotalCents(offer: PublicMerchandiseOffer | null, selection: MerchandiseSelection) {
  return merchandiseLines(offer, selection).reduce((sum, line) => sum + line.lineTotalCents, 0);
}

/** The optional merchandise section of the individual registration form (#146). Quantities only: the server prices them. */
export function PublicMerchandiseStep({ offer, selection, issues = [], onChange }: {
  offer: PublicMerchandiseOffer;
  selection: MerchandiseSelection;
  issues?: ReadonlyArray<{ message: string }>;
  onChange: (next: MerchandiseSelection) => void;
}) {
  const subtotal = merchandiseSubtotalCents(offer, selection);
  return (
    <section className="public-registration-review-card" data-testid="merchandise-step" aria-labelledby="public_merchandise_title">
      <p className="public-registration-eyebrow">Optional</p>
      <h3 id="public_merchandise_title">Merchandise</h3>
      <p className={styles.lead}>{merchandiseNotChargedNotice}</p>
      {issues.length > 0 ? <div role="alert">{issues.map((issue) => <p className={styles.error} key={issue.message}>{issue.message}</p>)}</div> : null}
      {offer.products.map((product) => (
        <div className={styles.product} key={product.id}>
          <h4>{product.name}</h4>
          {product.description ? <p className={styles.description}>{product.description}</p> : null}
          <div className={styles.sizes}>
            {product.variants.map((variant) => {
              const options = Array.from({ length: Math.min(variant.maxQuantity, 50) + 1 }, (_, quantity) => quantity).filter((quantity) => quantity === 0 || quantity >= variant.minQuantity);
              return (
                <div className={styles.size} key={variant.id}>
                  <span className={styles.sizeName}>
                    {variant.label}
                    <small><Money cents={variant.priceCents} /> each</small>
                  </span>
                  {variant.soldOut ? (
                    <span className={styles.soldOut}>Sold out</span>
                  ) : (
                    <select
                      className={`field-select ${styles.select}`}
                      aria-label={`${product.name} ${variant.label} quantity`}
                      value={selection[variant.id] ?? 0}
                      onChange={(event) => {
                        const quantity = Number(event.target.value);
                        const next = { ...selection };
                        if (quantity > 0) next[variant.id] = quantity; else delete next[variant.id];
                        onChange(next);
                      }}
                    >
                      {options.map((quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className={styles.subtotal}><span>Merchandise subtotal</span><Money cents={subtotal} /></p>
    </section>
  );
}
