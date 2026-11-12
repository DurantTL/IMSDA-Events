import { z } from "zod";

/**
 * The parts of merchandise-on-registration that the browser bundle may import: the input schema, shared types and the
 * picker's default limit. No server, crypto or database imports belong here.
 */

/** The largest quantity a size allows when staff set no maximum. The picker offers it and the server enforces it. */
export const defaultMerchandiseMaxQuantity = 10;

/**
 * What the individual registration form sends for merchandise: variant ids, quantities and the unit price the form
 * showed. The server prices from the catalog and only compares the shown price to refuse a stale one.
 */
export const registrationMerchandiseSchema = z
  .array(z.object({
    variantId: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(1000),
    shownUnitPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  }).strict())
  .max(50);

export type RequestedMerchandiseLine = { variantId: string; quantity: number; shownUnitPriceCents?: number };

export type PublicMerchandiseOffer = {
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    variants: Array<{
      id: string;
      label: string;
      priceCents: number;
      minQuantity: number;
      /** What the picker offers; the server still checks stock. Never a stock count. */
      maxQuantity: number;
      soldOut: boolean;
    }>;
  }>;
};

export type RegistrationMerchandiseSummary = {
  lines: Array<{ productName: string; variantLabel: string; quantity: number; lineTotalCents: number }>;
  totalCents: number;
};
