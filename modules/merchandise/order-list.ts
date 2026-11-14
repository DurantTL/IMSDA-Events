import "server-only";

import { getPrisma } from "@/lib/prisma";
import { AccessDeniedError, requirePermission, type Session } from "@/modules/access/authorization";
import { findActiveMembership } from "@/modules/events/repository";
import { merchandiseTotalsBySize, staffOrderFromRecord } from "@/modules/merchandise/order-list-domain";

/** Merchandise orders hold purchaser names and are money-adjacent: configuration access plus registration or finance access. */
export async function requireMerchandiseOrderAccess(session: Session, eventId: string) {
  const access = await requirePermission(session, eventId, "CONFIGURE_EVENT", findActiveMembership);
  try {
    await requirePermission(session, eventId, "MANAGE_REGISTRATION", findActiveMembership);
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) throw error;
    await requirePermission(session, eventId, "MANAGE_FINANCE", findActiveMembership);
  }
  return access;
}

export function canViewMerchandiseOrders(permissions: ReadonlyArray<string>) {
  return permissions.includes("CONFIGURE_EVENT") && (permissions.includes("MANAGE_REGISTRATION") || permissions.includes("MANAGE_FINANCE"));
}

/** Read-only, newest first (the page sorts and pages it). Every query is scoped to the event. */
export async function listMerchandiseOrders(eventId: string) {
  const records = await getPrisma().merchandiseOrder.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      status: true,
      totalCents: true,
      purchaserSnapshot: true,
      registrationId: true,
      receiptNumber: true,
      paymentMethod: true,
      paymentReference: true,
      paidAt: true,
      statusChanges: { where: { eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, action: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, actor: { select: { displayName: true } } } },
      registration: { select: { status: true } },
      lines: { where: { eventId }, orderBy: { createdAt: "asc" }, select: { productNameSnapshot: true, variantLabelSnapshot: true, quantity: true, lineTotalCents: true } },
    },
  });
  const orders = records.map(staffOrderFromRecord);
  return { eventId, orders, totals: merchandiseTotalsBySize(orders) };
}
