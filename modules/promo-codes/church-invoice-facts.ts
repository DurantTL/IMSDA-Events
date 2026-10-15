import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { InvoiceContact, InvoiceFigures } from "@/modules/invoices/domain";
import { buildChurchPromoInvoiceFigures } from "@/modules/promo-codes/church-invoice";
import { eventBillsSponsoredPromoCodes } from "@/modules/promo-codes/church-sponsored";
import { listChurchSponsoredPromoLines } from "@/modules/promo-codes/church-sponsored-repository";

type Client = Prisma.TransactionClient | PrismaClient;

/** The church's active billing contact as an invoice carries it: name, role, email and verification only. */
export async function loadChurchBillingContact(client: Client, churchId: string): Promise<InvoiceContact | null> {
  const row = await client.organizationBillingContact.findFirst({
    where: { organizationId: churchId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
    select: { name: true, email: true, roleLabel: true, verifiedAt: true },
  });
  return row ? { name: row.name, email: row.email, roleLabel: row.roleLabel, verified: row.verifiedAt !== null } : null;
}

export type ChurchInvoiceInputs = {
  event: { id: string; name: string; eligible: boolean };
  church: { id: string; name: string };
  figures: InvoiceFigures;
  contact: InvoiceContact | null;
  /** The church sponsors at least one promo code on the event (the only way it gets an invoice here). */
  sponsorsACode: boolean;
};

/**
 * What a church promo code invoice is built from, read now: the event, the church, the church's billed redemption lines
 * (#545), its figures and its billing contact. Read inside the caller's transaction so the lines and the contact are one
 * consistent view. Returns null when the event or the organization does not exist.
 */
export async function loadChurchInvoiceInputs(client: Client, eventId: string, churchId: string): Promise<ChurchInvoiceInputs | null> {
  const [event, church, codeCount] = await Promise.all([
    client.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, audience: true, billingMode: true } }),
    client.organization.findUnique({ where: { id: churchId }, select: { id: true, name: true } }),
    client.promoCode.count({ where: { eventId, sponsoringOrganizationId: churchId } }),
  ]);
  if (!event || !church) return null;
  const eligible = eventBillsSponsoredPromoCodes(event);
  const lines = eligible ? await listChurchSponsoredPromoLines(eventId, client) : [];
  return {
    event: { id: event.id, name: event.name, eligible },
    church,
    figures: buildChurchPromoInvoiceFigures({ event: { id: event.id, name: event.name }, church, lines }),
    contact: await loadChurchBillingContact(client, churchId),
    sponsorsACode: codeCount > 0,
  };
}
