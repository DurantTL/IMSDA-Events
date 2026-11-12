import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";

/**
 * System-administrator approval of an event's merchandise catalog (#146). This
 * is the only way a catalog reaches APPROVED: the normal staff save refuses it.
 * The caller (the route) checks the system administrator role; this module
 * does not, so never expose these functions to a request without that check.
 *
 * Decisions:
 * - Approving a catalog that is already approved and open changes nothing and
 *   writes no audit entry (the original approver and time stay).
 * - Approving a catalog that is approved but switched off by staff turns it
 *   back on and records the acting administrator and time again.
 * - Closing clears the approver and time; the audit log keeps the history.
 *   Existing orders are never touched.
 */

export type CatalogApprovalErrorCode = "NO_SELLABLE_PRODUCT";
export class MerchandiseCatalogApprovalError extends Error {
  constructor(public readonly code: CatalogApprovalErrorCode, message: string) {
    super(message);
    this.name = "MerchandiseCatalogApprovalError";
  }
}

export type CatalogApprovalResult = {
  eventId: string;
  isEnabled: boolean;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED";
  approvedAt: string | null;
  approvedByUserId: string | null;
  changed: boolean;
};

function result(catalog: { eventId: string; isEnabled: boolean; status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED"; approvedAt: Date | null; approvedByUserId: string | null }, changed: boolean): CatalogApprovalResult {
  return { eventId: catalog.eventId, isEnabled: catalog.isEnabled, status: catalog.status, approvedAt: catalog.approvedAt?.toISOString() ?? null, approvedByUserId: catalog.approvedByUserId, changed };
}

export async function approveAndOpenCatalogSales(eventId: string, actorUserId: string, now: Date = new Date()): Promise<CatalogApprovalResult> {
  return getPrisma().$transaction(async (tx) => {
    const sellable = await tx.merchandiseProductVariant.count({
      where: {
        isEnabled: true,
        isArchived: false,
        product: { eventId, isEnabled: true, isArchived: false },
        availability: { some: { isActive: true } },
      },
    });
    if (sellable === 0) throw new MerchandiseCatalogApprovalError("NO_SELLABLE_PRODUCT", "Add an enabled product with at least one enabled, priced size before opening sales.");
    const before = await tx.merchandiseCatalog.findUnique({ where: { eventId } });
    if (before && before.status === "APPROVED" && before.isEnabled) return result(before, false);
    const next = await tx.merchandiseCatalog.upsert({
      where: { eventId },
      create: { eventId, isEnabled: true, status: "APPROVED", approvedByUserId: actorUserId, approvedAt: now },
      update: { isEnabled: true, status: "APPROVED", approvedByUserId: actorUserId, approvedAt: now },
    });
    await writeAuditLog({
      eventId, actorUserId, action: "MERCHANDISE_CATALOG_APPROVED", entityType: "MerchandiseCatalog", entityId: next.id,
      summary: "Approved the merchandise catalog and opened sales.",
      metadata: { before: before ? { isEnabled: before.isEnabled, status: before.status } : null, after: { isEnabled: next.isEnabled, status: next.status } },
    }, tx);
    return result(next, true);
  });
}

export async function closeCatalogSales(eventId: string, actorUserId: string): Promise<CatalogApprovalResult> {
  return getPrisma().$transaction(async (tx) => {
    const before = await tx.merchandiseCatalog.findUnique({ where: { eventId } });
    if (!before || (before.status === "DRAFT" && !before.isEnabled && !before.approvedAt)) {
      return { eventId, isEnabled: false, status: "DRAFT", approvedAt: null, approvedByUserId: null, changed: false };
    }
    const next = await tx.merchandiseCatalog.update({ where: { eventId }, data: { isEnabled: false, status: "DRAFT", approvedByUserId: null, approvedAt: null } });
    await writeAuditLog({
      eventId, actorUserId, action: "MERCHANDISE_CATALOG_CLOSED", entityType: "MerchandiseCatalog", entityId: next.id,
      summary: "Closed merchandise sales. Existing orders are unchanged.",
      metadata: { before: { isEnabled: before.isEnabled, status: before.status }, after: { isEnabled: next.isEnabled, status: next.status } },
    }, tx);
    return result(next, true);
  });
}
