import "server-only";

import { Prisma } from "@prisma/client";
import { getMerchandiseCatalogForProjection } from "@/modules/merchandise/catalog-repository";
import {
  buildPublicMerchandiseOffer,
  planRegistrationMerchandiseOrder,
  summarizeMerchandiseDraft,
} from "@/modules/merchandise/registration-order-domain";
import type { PublicMerchandiseOffer, RegistrationMerchandiseSummary, RequestedMerchandiseLine } from "@/modules/merchandise/registration-order-schema";

const countedStatuses = ["PENDING", "PAID"] as const;

/** An order holds stock while it has no registration link (a staff order) or its registration is not cancelled. */
const activeRegistrationOrder = [{ registrationId: null }, { registration: { status: { not: "CANCELLED" as const } } }];

/** Units on PENDING or PAID orders, by variant id. */
async function soldByVariant(client: Prisma.TransactionClient, variantIds: string[]) {
  const sold = new Map<string, number>();
  if (variantIds.length === 0) return sold;
  const rows = await client.merchandiseOrderLine.groupBy({
    by: ["variantId"],
    where: { variantId: { in: variantIds }, order: { status: { in: [...countedStatuses] }, OR: activeRegistrationOrder } },
    _sum: { quantity: true },
  });
  for (const row of rows) if (row.variantId) sold.set(row.variantId, row._sum.quantity ?? 0);
  return sold;
}

/** The merchandise a registrant can add: null when the catalog is off, not approved, or has nothing buyable. */
export async function getPublicMerchandiseOffer(eventId: string, client: Prisma.TransactionClient): Promise<PublicMerchandiseOffer | null> {
  const catalog = await getMerchandiseCatalogForProjection(eventId, {}, client);
  const variantIds = catalog.products.flatMap((product) => product.variants.map((variant) => variant.id));
  if (!catalog.isEnabled || catalog.status !== "APPROVED" || variantIds.length === 0) return null;
  return buildPublicMerchandiseOffer(catalog, await soldByVariant(client, variantIds));
}

/**
 * Records a pending merchandise order for a new registration, inside that registration's transaction. It is not charged
 * with the registration: no card fee, no tax, and it is not part of the registration total. Selected variant rows are
 * locked first so two registrations racing for the last item cannot both take it.
 */
export async function recordRegistrationMerchandiseOrder(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    registrationId: string;
    confirmationCode: string;
    purchaser: { name: string; email: string };
    lines: RequestedMerchandiseLine[];
    now?: Date;
  },
): Promise<RegistrationMerchandiseSummary> {
  const variantIds = [...new Set(input.lines.map((line) => line.variantId))];
  // Locked in a fixed order so concurrent orders for overlapping sizes cannot deadlock.
  // Only this event's variants are locked; an id from another event is left alone and then refused as unavailable.
  await tx.$queryRaw(Prisma.sql`SELECT v."id" FROM "MerchandiseProductVariant" v JOIN "MerchandiseProduct" p ON p."id" = v."productId" WHERE v."id" IN (${Prisma.join([...variantIds].sort())}) AND p."eventId" = ${input.eventId} ORDER BY v."id" FOR UPDATE OF v`);
  const catalog = await getMerchandiseCatalogForProjection(input.eventId, {}, tx);
  const sold = await soldByVariant(tx, variantIds);
  const draft = planRegistrationMerchandiseOrder(catalog, sold, {
    eventId: input.eventId,
    registrationId: input.registrationId,
    purchaserSnapshot: { name: input.purchaser.name, email: input.purchaser.email, confirmationCode: input.confirmationCode },
    lines: input.lines,
  }, (input.now ?? new Date()).toISOString());
  await tx.merchandiseOrder.create({
    data: {
      eventId: draft.eventId,
      registrationId: draft.registrationId,
      purchaserSnapshot: draft.purchaserSnapshot as Prisma.InputJsonValue,
      clientRequestId: draft.clientRequestId,
      requestFingerprint: draft.requestFingerprint,
      status: "PENDING",
      subtotalCents: draft.subtotalCents,
      feeCents: draft.feeCents,
      taxCents: draft.taxCents,
      totalCents: draft.totalCents,
      paymentMethod: null,
      lines: {
        create: draft.lines.map((line) => ({
          eventId: line.eventId,
          productId: line.productId,
          productNameSnapshot: line.productNameSnapshot,
          variantId: line.variantId,
          variantLabelSnapshot: line.variantLabelSnapshot,
          availabilityId: line.availabilityId,
          unitPriceCentsSnapshot: line.unitPriceCentsSnapshot,
          quantity: line.quantity,
          taxTreatmentSnapshot: line.taxTreatmentSnapshot,
          feePolicySnapshot: line.feePolicySnapshot,
          lineTotalCents: line.lineTotalCents,
        })),
      },
    },
  });
  return summarizeMerchandiseDraft(draft);
}

/** The merchandise summary for a registration already submitted, read for a replayed confirmation. Null when it has no order. */
export async function getRegistrationMerchandiseSummary(
  client: Prisma.TransactionClient,
  registrationId: string,
): Promise<RegistrationMerchandiseSummary | null> {
  const order = await client.merchandiseOrder.findFirst({
    where: { registrationId, clientRequestId: `registration:${registrationId}` },
    select: { totalCents: true, lines: { orderBy: { createdAt: "asc" }, select: { productNameSnapshot: true, variantLabelSnapshot: true, quantity: true, lineTotalCents: true } } },
  });
  if (!order) return null;
  return {
    lines: order.lines.map((line) => ({ productName: line.productNameSnapshot, variantLabel: line.variantLabelSnapshot, quantity: line.quantity, lineTotalCents: line.lineTotalCents })),
    totalCents: order.totalCents,
  };
}
