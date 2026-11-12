import { z } from "zod";
import {
  projectMerchandiseCatalog,
  type MerchandiseProjectionInput,
} from "@/modules/merchandise/catalog-domain";
import {
  buildMerchandiseOrderDraft,
  type MerchandiseCatalog,
  type MerchandiseOrderDraft,
} from "@/modules/merchandise/domain";

/** The largest quantity a size's picker offers when staff set no maximum. The server accepts up to the schema limit. */
export const defaultMerchandiseMaxQuantity = 10;

/** What the individual registration form sends for merchandise: variant ids and quantities only, never a price. */
export const registrationMerchandiseSchema = z
  .array(z.object({
    variantId: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(1000),
  }).strict())
  .max(50);

export type RequestedMerchandiseLine = { variantId: string; quantity: number };

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

export type RegistrationMerchandiseErrorCode = "VARIANT_UNAVAILABLE" | "SOLD_OUT" | "INVALID_QUANTITY" | "DUPLICATE_VARIANT";

export class RegistrationMerchandiseError extends Error {
  constructor(public readonly code: RegistrationMerchandiseErrorCode, message: string) {
    super(message);
    this.name = "RegistrationMerchandiseError";
  }
}

/** Units already on PENDING or PAID orders, by variant id. */
export type SoldQuantities = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

function soldFor(sold: SoldQuantities, variantId: string) {
  return (sold instanceof Map ? sold.get(variantId) : (sold as Record<string, number>)[variantId]) ?? 0;
}

/** The buyer is registering, so REGISTERED variants are visible; STAFF_ONLY and everything the catalog gate hides are not. */
function visibleVariants(catalog: MerchandiseProjectionInput, now: string) {
  const projected = projectMerchandiseCatalog(catalog, { isRegisteredAttendee: true }, now);
  const visible = new Set(projected.products.flatMap((product) => product.variants.map((variant) => variant.id)));
  const byId = new Map<string, { product: MerchandiseProjectionInput["products"][number]; variant: MerchandiseProjectionInput["products"][number]["variants"][number] }>();
  for (const product of catalog.products) {
    for (const variant of product.variants) {
      if (visible.has(variant.id) && variant.availability) byId.set(variant.id, { product, variant });
    }
  }
  return { projected, byId };
}

function remainingStock(availability: { inventoryPolicy: "UNLIMITED" | "TRACKED"; inventoryQuantity: number | null }, sold: number) {
  if (availability.inventoryPolicy !== "TRACKED") return null;
  return Math.max(0, (availability.inventoryQuantity ?? 0) - sold);
}

/** The offer shown on the form: null when the catalog is off, not approved, or has nothing buyable. */
export function buildPublicMerchandiseOffer(
  catalog: MerchandiseProjectionInput,
  sold: SoldQuantities,
  now = new Date().toISOString(),
): PublicMerchandiseOffer | null {
  const { projected, byId } = visibleVariants(catalog, now);
  const products = projected.products.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    variants: product.variants.flatMap((variant) => {
      const entry = byId.get(variant.id);
      const availability = entry?.variant.availability;
      if (!availability) return [];
      const remaining = remainingStock(availability, soldFor(sold, variant.id));
      return [{
        id: variant.id,
        label: variant.label,
        priceCents: availability.priceCents,
        minQuantity: availability.minQuantity,
        maxQuantity: availability.maxQuantity ?? defaultMerchandiseMaxQuantity,
        soldOut: remaining !== null && remaining < availability.minQuantity,
      }];
    }),
  })).filter((product) => product.variants.length > 0);
  return products.length > 0 ? { products } : null;
}

export type PlanRegistrationMerchandiseInput = {
  eventId: string;
  registrationId: string;
  purchaserSnapshot: Record<string, unknown>;
  lines: RequestedMerchandiseLine[];
};

/**
 * Decides an order from what the browser asked for. Prices, names and stock come only from the persisted catalog; the
 * browser's lines carry a variant id and a quantity. Throws RegistrationMerchandiseError for anything not buyable.
 */
export function planRegistrationMerchandiseOrder(
  catalog: MerchandiseProjectionInput,
  sold: SoldQuantities,
  input: PlanRegistrationMerchandiseInput,
  now = new Date().toISOString(),
): MerchandiseOrderDraft {
  const { byId } = visibleVariants(catalog, now);
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.variantId)) {
      throw new RegistrationMerchandiseError("DUPLICATE_VARIANT", "Each merchandise size can be chosen only once.");
    }
    seen.add(line.variantId);
    const entry = byId.get(line.variantId);
    if (!entry?.variant.availability) {
      throw new RegistrationMerchandiseError("VARIANT_UNAVAILABLE", "A merchandise item you chose is no longer available. Remove it and try again.");
    }
    const name = `${entry.product.name} ${entry.variant.label}`;
    const availability = entry.variant.availability;
    if (!Number.isSafeInteger(line.quantity) || line.quantity < availability.minQuantity || (availability.maxQuantity !== null && line.quantity > availability.maxQuantity)) {
      const range = availability.maxQuantity === null ? `at least ${availability.minQuantity}` : `${availability.minQuantity} to ${availability.maxQuantity}`;
      throw new RegistrationMerchandiseError("INVALID_QUANTITY", `${name}: choose ${range}, or remove it.`);
    }
    const remaining = remainingStock(availability, soldFor(sold, line.variantId));
    if (remaining !== null && line.quantity > remaining) {
      throw new RegistrationMerchandiseError("SOLD_OUT", remaining === 0
        ? `${name} is sold out. Remove it or choose another size.`
        : `${name} does not have that many left. Lower the quantity or choose another size.`);
    }
  }

  const visibleProductIds = new Set([...byId.values()].map((entry) => entry.product.id));
  const draftCatalog: MerchandiseCatalog = {
    eventId: catalog.eventId,
    isPublished: true,
    products: catalog.products.filter((product) => visibleProductIds.has(product.id)).map((product) => ({
      id: product.id,
      eventId: product.eventId,
      name: product.name,
      isEnabled: true,
      variants: product.variants.filter((variant) => byId.has(variant.id)).map((variant) => ({
        id: variant.id,
        label: variant.label,
        isEnabled: true,
        availability: variant.availability,
      })),
    })),
  };
  return buildMerchandiseOrderDraft({
    eventId: input.eventId,
    registrationId: input.registrationId,
    purchaserSnapshot: input.purchaserSnapshot,
    clientRequestId: `registration:${input.registrationId}`,
    feeCents: 0,
    taxCents: 0,
    lines: input.lines,
  }, draftCatalog);
}

export function summarizeMerchandiseDraft(draft: Pick<MerchandiseOrderDraft, "lines" | "totalCents">): RegistrationMerchandiseSummary {
  return {
    lines: draft.lines.map((line) => ({
      productName: line.productNameSnapshot,
      variantLabel: line.variantLabelSnapshot,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
    })),
    totalCents: draft.totalCents,
  };
}

/** The message shown on the form for a merchandise problem. */
export function merchandiseIssueMessage(error: RegistrationMerchandiseError) {
  return `Merchandise: ${error.message}`;
}
