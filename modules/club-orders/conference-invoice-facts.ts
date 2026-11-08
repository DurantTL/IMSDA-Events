import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { InvoiceContact, InvoiceFigures } from "@/modules/invoices/domain";
import { buildClubOrdersInvoiceFigures, type FilledOrderForInvoice } from "@/modules/club-orders/conference-invoice";
import { loadChurchBillingContact } from "@/modules/promo-codes/church-invoice-facts";

type Client = Prisma.TransactionClient | PrismaClient;

export type ClubOrdersInvoiceInputs = {
  /** `eligible` is true only on a club year's billing container event (#1688): the one event these invoices live on. */
  event: { id: string; name: string; eligible: boolean };
  church: { id: string; name: string };
  figures: InvoiceFigures;
  contact: InvoiceContact | null;
};

/** The FILLED orders billed to a church on a billing event, with their lines and clubs, for the invoice builder. */
export async function listFilledOrdersForInvoice(client: Client, eventId: string, churchId: string): Promise<FilledOrderForInvoice[]> {
  const orders = await client.conferenceClubOrder.findMany({
    where: { eventId, churchId, status: "FILLED", filledAt: { not: null } },
    orderBy: [{ filledAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      organizationId: true,
      postageCents: true,
      filledAt: true,
      club: { select: { name: true } },
      lines: { orderBy: { itemName: "asc" }, select: { itemName: true, quantity: true, unitPriceCents: true } },
    },
  });
  return orders.map((order) => ({
    orderId: order.id,
    clubId: order.organizationId,
    clubName: order.club.name,
    lines: order.lines,
    postageCents: order.postageCents ?? 0,
    filledAt: order.filledAt!,
  }));
}

/**
 * What a church's conference club orders invoice is built from, read now: the billing event, the church, the filled orders
 * billed to it, the figures and the church's billing contact. Read inside the caller's transaction so the lines and the
 * contact are one consistent view. Null when the event or the organization does not exist.
 */
export async function loadClubOrdersInvoiceInputs(client: Client, eventId: string, churchId: string): Promise<ClubOrdersInvoiceInputs | null> {
  const [event, church] = await Promise.all([
    client.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, isBillingContainer: true } }),
    client.organization.findUnique({ where: { id: churchId }, select: { id: true, name: true } }),
  ]);
  if (!event || !church) return null;
  const eligible = event.isBillingContainer;
  const orders = eligible ? await listFilledOrdersForInvoice(client, eventId, churchId) : [];
  return {
    event: { id: event.id, name: event.name, eligible },
    church,
    figures: buildClubOrdersInvoiceFigures({ event: { id: event.id, name: event.name }, church, orders }),
    contact: await loadChurchBillingContact(client, churchId),
  };
}
