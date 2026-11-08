import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { LONG_TRANSACTION, lockEvent } from "@/modules/attendance-reconciliation/repository";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { ClubOrderError, auditActorFields, loadOrderExportHeader, lockClubOrders, type ClubOrderActor } from "@/modules/club-orders/repository";
import {
  CLUB_ORDERS_GROUP_KEY_PREFIX,
  CONFERENCE_ORDER_REASON_MAX,
  NO_CHURCH_MESSAGE,
  billingContainerName,
  billingContainerSlug,
  buildOrderLines,
  directorCanCancel,
  itemsTotalCents,
  parsePostageCents,
  staffCanCancel,
  staffCanFill,
  wholeCount,
  type ConferenceOrderStatus,
  type OrderableItem,
} from "@/modules/club-orders/conference-orders";
import { deliverConferenceOrderEmails, queueConferenceOrderEmails, resolveConferenceOrdersEmail } from "@/modules/club-orders/conference-email";
import { prepareClubOrdersInvoiceDraftInTx, type ClubOrdersDraftOutcome } from "@/modules/club-orders/conference-invoice-repository";
import { getPlatformSettings } from "@/modules/system-admin/platform-settings";

/**
 * Conference club order storage (#1688). A club orders the conference-supplied patches and pins; the order goes to the youth
 * department (never AdventSource) and, once staff mark it Filled, becomes lines on the sponsoring church's invoice on the club
 * year's hidden billing event (`Event.isBillingContainer`). Unit prices are copied onto the order lines when it is submitted,
 * so a later price change never alters a submitted order. Every status change is audited with ids, counts and amounts only.
 * Each write that moves an order takes the club's order lock (and filling also takes the billing event's lock), and every
 * status change is a guarded `updateMany`, so two taps of a button can never fill or cancel an order twice.
 */

export type ConferenceItem = OrderableItem;

/** The conference-supplied items a club can order now: active, with a price. */
export async function listConferenceItems(db: Pick<Prisma.TransactionClient, "clubSupplyItem"> = getPrisma()): Promise<ConferenceItem[]> {
  const rows = await db.clubSupplyItem.findMany({
    where: { supplier: "CONFERENCE", isActive: true, unitPriceCents: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, unitPriceCents: true },
  });
  return rows.map((row) => ({ itemId: row.id, name: row.name, unitPriceCents: row.unitPriceCents ?? 0 }));
}

const orderSelect = {
  id: true,
  status: true,
  clubYear: true,
  patchesToExchange: true,
  itemsTotalCents: true,
  postageCents: true,
  submittedAt: true,
  filledAt: true,
  addedToStock: true,
  cancelledAt: true,
  cancelledReason: true,
  lines: { orderBy: { itemName: "asc" }, select: { itemId: true, itemName: true, quantity: true, unitPriceCents: true } },
} satisfies Prisma.ConferenceClubOrderSelect;

type OrderRow = Prisma.ConferenceClubOrderGetPayload<{ select: typeof orderSelect }>;

export type ConferenceOrderRecord = {
  id: string;
  status: ConferenceOrderStatus;
  clubYear: string;
  patchesToExchange: number;
  itemsTotalCents: number;
  postageCents: number | null;
  submittedAt: string;
  filledAt: string | null;
  addedToStock: boolean;
  cancelledAt: string | null;
  cancelledReason: string | null;
  lines: Array<{ itemId: string; itemName: string; quantity: number; unitPriceCents: number }>;
};

function toRecord(row: OrderRow): ConferenceOrderRecord {
  return {
    id: row.id,
    status: row.status,
    clubYear: row.clubYear,
    patchesToExchange: row.patchesToExchange,
    itemsTotalCents: row.itemsTotalCents,
    postageCents: row.postageCents,
    submittedAt: row.submittedAt.toISOString(),
    filledAt: row.filledAt?.toISOString() ?? null,
    addedToStock: row.addedToStock,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledReason: row.cancelledReason,
    lines: row.lines,
  };
}

export type ClubConferenceOrderWorkspace = {
  items: ConferenceItem[];
  /** The sponsoring church that will be billed, or null: the club cannot submit and is told to contact the youth department. */
  churchName: string | null;
  orders: ConferenceOrderRecord[];
};

async function sponsoringChurch(db: Pick<Prisma.TransactionClient, "organization">, organizationId: string) {
  const club = await db.organization.findUnique({
    where: { id: organizationId },
    select: { type: true, isActive: true, name: true, parentOrganization: { select: { id: true, name: true, isActive: true } } },
  });
  if (!club || club.type !== "CLUB" || !club.isActive) throw new ClubOrderError("CLUB_NOT_FOUND", "That club could not be found.");
  const church = club.parentOrganization;
  return { clubName: club.name, church: church && church.isActive ? { id: church.id, name: church.name } : null };
}

/** The club's Orders tab data for the conference order section: the orderable items, who is billed, and the club's own orders (newest first). */
export async function loadClubConferenceOrders(organizationId: string): Promise<ClubConferenceOrderWorkspace> {
  const prisma = getPrisma();
  const [items, club, orders] = await Promise.all([
    listConferenceItems(prisma),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { parentOrganization: { select: { name: true, isActive: true } } } }),
    prisma.conferenceClubOrder.findMany({ where: { organizationId }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 50, select: orderSelect }),
  ]);
  const church = club?.parentOrganization;
  return { items, churchName: church?.isActive ? church.name : null, orders: orders.map(toRecord) };
}

/** Creates the club year's hidden billing event when it is missing (#1688). Under a lock, so two first orders make one event. */
async function ensureBillingContainer(tx: Prisma.TransactionClient, clubYear: string, actorUserId: string | null) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conference-billing-container:${clubYear}`}))`;
  const slug = billingContainerSlug(clubYear);
  const existing = await tx.event.findUnique({ where: { slug }, select: { id: true, isBillingContainer: true } });
  if (existing) {
    if (!existing.isBillingContainer) throw new ClubOrderError("INVALID_ORDER", "The billing event for this club year could not be set up. Contact the system administrator.");
    return existing.id;
  }
  const startYear = Number(clubYear.slice(0, 4));
  const created = await tx.event.create({
    data: {
      slug,
      name: billingContainerName(clubYear),
      startsAt: new Date(Date.UTC(startYear, 8, 1, 12)),
      endsAt: new Date(Date.UTC(startYear + 1, 7, 31, 12)),
      isPublished: false,
      showOnCalendar: false,
      archivedAt: new Date(),
      archivedByUserId: actorUserId,
      isBillingContainer: true,
      billingMode: "ATTENDEE_PAY",
      audience: "GENERAL",
    },
    select: { id: true },
  });
  await writeAuditLog({
    eventId: created.id,
    actorUserId: actorUserId ?? undefined,
    action: "CONFERENCE_BILLING_EVENT_CREATED",
    entityType: "Event",
    entityId: created.id,
    summary: "Created the hidden billing event for a club year's conference club orders.",
    metadata: { eventId: created.id, clubYear },
  }, tx);
  return created.id;
}

export type SubmitConferenceOrderInput = {
  quantities: Readonly<Record<string, unknown>>;
  patchesToExchange?: unknown;
};

/**
 * Submits a conference order for a club. The caller has established that the actor is the club's director or deputy (or a staff
 * "act as" director). Refused with no sponsoring church (the club is told to contact the youth department), with nothing
 * ordered, or with an item that is not an active conference item. The sponsoring church, the item names and the unit prices
 * are copied onto the order now. One order email and one director confirmation are queued in the same transaction.
 */
export async function submitConferenceOrder(organizationId: string, input: SubmitConferenceOrderInput, actor: ClubOrderActor, now = new Date()) {
  const prisma = getPrisma();
  const { clubName, church } = await sponsoringChurch(prisma, organizationId);
  if (!church) throw new ClubOrderError("NO_SPONSORING_CHURCH", NO_CHURCH_MESSAGE);
  const items = await listConferenceItems(prisma);
  const orderable = new Set(items.map((item) => item.itemId));
  for (const [itemId, quantity] of Object.entries(input.quantities)) {
    if (wholeCount(quantity) > 0 && !orderable.has(itemId)) throw new ClubOrderError("ITEM_NOT_ORDERABLE", "One of those items can't be ordered from the conference.");
  }
  const lines = buildOrderLines(items, input.quantities);
  if (lines.length === 0) throw new ClubOrderError("INVALID_ORDER", "Enter a quantity for at least one item.");
  const patchesToExchange = wholeCount(input.patchesToExchange);
  const total = itemsTotalCents(lines);
  const [settings, header] = await Promise.all([getPlatformSettings(), loadOrderExportHeader(organizationId, now)]);
  const clubYear = clubYearFor(now);
  const who = auditActorFields(actor);
  const submittedBy = "accountId" in actor
    ? { submittedByAccountId: actor.accountId, submittedByUserId: null }
    : { submittedByAccountId: null, submittedByUserId: actor.userId };

  const { order, messageIds } = await prisma.$transaction(async (tx) => {
    await lockClubOrders(tx, organizationId);
    const eventId = await ensureBillingContainer(tx, clubYear, "userId" in actor ? actor.userId : null);
    const created = await tx.conferenceClubOrder.create({
      data: {
        organizationId,
        churchId: church.id,
        eventId,
        clubYear,
        patchesToExchange,
        itemsTotalCents: total,
        submittedAt: now,
        ...submittedBy,
        lines: { create: lines.map((line) => ({ itemId: line.itemId, itemName: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents })) },
      },
      select: orderSelect,
    });
    await writeAuditLog({
      ...who.actorFields,
      eventId,
      action: "CONFERENCE_CLUB_ORDER_SUBMITTED",
      entityType: "ConferenceClubOrder",
      entityId: created.id,
      summary: `Submitted a conference club order for ${lines.length} item${lines.length === 1 ? "" : "s"}.`,
      metadata: { orderId: created.id, organizationId, churchId: church.id, clubYear, itemCount: lines.length, totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0), patchesToExchange, itemsTotalCents: total, ...who.metadata },
    }, tx);
    const queued = await queueConferenceOrderEmails(tx, {
      orderId: created.id,
      staffEmail: resolveConferenceOrdersEmail(settings.conferenceOrdersEmail),
      directorEmail: header.directorEmail,
      clubName,
      churchName: church.name,
      directorName: header.directorName,
      lines: lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
      patchesToExchange,
      itemsTotalCents: total,
    });
    return { order: created, messageIds: queued };
  });
  await deliverConferenceOrderEmails(messageIds);
  return toRecord(order);
}

/** A director cancels their club's order, only while it is still Submitted. Another club's order is never found. */
export async function cancelConferenceOrderAsDirector(organizationId: string, orderId: string, actor: ClubOrderActor, now = new Date()) {
  const who = auditActorFields(actor);
  const cancelledBy = "accountId" in actor
    ? { cancelledByAccountId: actor.accountId, cancelledByUserId: null }
    : { cancelledByAccountId: null, cancelledByUserId: actor.userId };
  return getPrisma().$transaction(async (tx) => {
    await lockClubOrders(tx, organizationId);
    const order = await tx.conferenceClubOrder.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, eventId: true } });
    if (!order) throw new ClubOrderError("ORDER_NOT_FOUND", "That order could not be found.");
    if (!directorCanCancel(order.status)) {
      throw new ClubOrderError("ORDER_NOT_SUBMITTED", "This order can't be cancelled here any more. Contact the youth department.");
    }
    const moved = await tx.conferenceClubOrder.updateMany({
      where: { id: orderId, organizationId, status: "SUBMITTED" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledReason: "Cancelled by the club.", ...cancelledBy },
    });
    if (moved.count === 0) throw new ClubOrderError("ORDER_NOT_SUBMITTED", "This order can't be cancelled here any more. Contact the youth department.");
    await writeAuditLog({
      ...who.actorFields,
      eventId: order.eventId,
      action: "CONFERENCE_CLUB_ORDER_CANCELLED",
      entityType: "ConferenceClubOrder",
      entityId: orderId,
      summary: "A club cancelled its conference club order before it was filled.",
      metadata: { orderId, organizationId, by: "CLUB", ...who.metadata },
    }, tx);
    return { orderId };
  });
}

// ---------------------------------------------------------------------------------------------
// Youth department staff
// ---------------------------------------------------------------------------------------------

export type StaffConferenceOrderRecord = ConferenceOrderRecord & {
  clubId: string;
  clubName: string;
  churchId: string;
  churchName: string;
  eventId: string;
};

export type ChurchBillRecord = {
  eventId: string;
  clubYear: string;
  churchId: string;
  churchName: string;
  invoiceId: string;
  /** The version staff and the treasurer work on: the open draft if there is one, else the finalized one. */
  status: "DRAFT" | "FINALIZED";
  number: string | null;
  amountDueCents: number;
  hasOpenRevision: boolean;
};

const STAFF_LIST_LIMIT = 300;

/** Conference club orders for youth department staff: newest first, with who is billed, and each church's bill on the billing events. */
export async function loadConferenceOrdersForStaff(): Promise<{ orders: StaffConferenceOrderRecord[]; bills: ChurchBillRecord[]; items: ConferenceItem[] }> {
  const prisma = getPrisma();
  const [rows, invoices, items] = await Promise.all([
    prisma.conferenceClubOrder.findMany({
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: STAFF_LIST_LIMIT,
      select: { ...orderSelect, organizationId: true, churchId: true, eventId: true, club: { select: { name: true } }, church: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { event: { isBillingContainer: true }, groupKey: { startsWith: CLUB_ORDERS_GROUP_KEY_PREFIX } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        eventId: true,
        partyId: true,
        event: { select: { name: true, slug: true } },
        versions: { where: { status: { in: ["DRAFT", "FINALIZED"] } }, orderBy: { revision: "desc" }, select: { status: true, number: true, amountDueCents: true, revision: true, organizationName: true } },
      },
    }),
    listConferenceItems(prisma),
  ]);
  const orders = rows.map((row) => ({
    ...toRecord(row),
    clubId: row.organizationId,
    clubName: row.club.name,
    churchId: row.churchId,
    churchName: row.church.name,
    eventId: row.eventId,
  }));
  const bills = invoices.flatMap((invoice): ChurchBillRecord[] => {
    const draft = invoice.versions.find((version) => version.status === "DRAFT");
    const finalized = invoice.versions.find((version) => version.status === "FINALIZED");
    const shown = draft ?? finalized;
    if (!shown || !invoice.partyId) return [];
    return [{
      eventId: invoice.eventId,
      clubYear: invoice.event.slug.replace(/^conference-club-orders-/, ""),
      churchId: invoice.partyId,
      churchName: shown.organizationName,
      invoiceId: invoice.id,
      status: draft ? "DRAFT" : "FINALIZED",
      number: shown.number,
      amountDueCents: shown.amountDueCents,
      hasOpenRevision: Boolean(draft && draft.revision > 0),
    }];
  });
  return { orders, bills, items };
}

export type FillConferenceOrderResult = {
  orderId: string;
  eventId: string;
  invoiceId: string | null;
  invoiceOutcome: ClubOrdersDraftOutcome | null;
  addedToStock: boolean;
};

/**
 * Staff mark a Submitted order Filled (#1688): they enter the postage (blank is none), it is billed to the church as lines on
 * the club year's billing event (the church's draft is created or refreshed, or a revision draft is started when its invoice is
 * already finalized; the treasurer finalizes as usual and nothing is finalized here), and optionally the quantities join the
 * club's stock. All of it commits together or not at all.
 */
export async function fillConferenceOrder(
  orderId: string,
  input: { postage: unknown; addToStock: boolean },
  actorUserId: string,
  now = new Date(),
): Promise<FillConferenceOrderResult> {
  const postageCents = parsePostageCents(input.postage ?? "");
  if (postageCents === null) throw new ClubOrderError("INVALID_POSTAGE", "Enter the postage in dollars and cents, such as 4.50, or leave it blank for none.");
  const prisma = getPrisma();
  const found = await prisma.conferenceClubOrder.findUnique({ where: { id: orderId }, select: { organizationId: true, eventId: true } });
  if (!found) throw new ClubOrderError("ORDER_NOT_FOUND", "That order could not be found.");
  return prisma.$transaction(async (tx) => {
    // Club lock first, then the billing event's lock (the one finalizing takes): the same order everywhere.
    await lockClubOrders(tx, found.organizationId);
    await lockEvent(tx, found.eventId);
    const order = await tx.conferenceClubOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, organizationId: true, churchId: true, eventId: true, itemsTotalCents: true, lines: { select: { itemId: true, quantity: true } } },
    });
    if (!order) throw new ClubOrderError("ORDER_NOT_FOUND", "That order could not be found.");
    if (!staffCanFill(order.status)) throw new ClubOrderError("ORDER_NOT_SUBMITTED", "Only a submitted order can be filled.");
    const moved = await tx.conferenceClubOrder.updateMany({
      where: { id: orderId, status: "SUBMITTED" },
      data: { status: "FILLED", postageCents, filledAt: now, filledByUserId: actorUserId, addedToStock: input.addToStock },
    });
    if (moved.count === 0) throw new ClubOrderError("ORDER_NOT_SUBMITTED", "Only a submitted order can be filled.");
    if (input.addToStock) {
      for (const line of order.lines) {
        await tx.clubSupplyStock.upsert({
          where: { organizationId_itemId: { organizationId: order.organizationId, itemId: line.itemId } },
          create: { organizationId: order.organizationId, itemId: line.itemId, quantityOnHand: line.quantity, updatedByAccountId: null, updatedByUserId: actorUserId },
          update: { quantityOnHand: { increment: line.quantity }, updatedByAccountId: null, updatedByUserId: actorUserId },
        });
      }
    }
    const draft = await prepareClubOrdersInvoiceDraftInTx(tx, { eventId: order.eventId, churchId: order.churchId, actorUserId });
    await writeAuditLog({
      eventId: order.eventId,
      actorUserId,
      action: "CONFERENCE_CLUB_ORDER_FILLED",
      entityType: "ConferenceClubOrder",
      entityId: orderId,
      summary: "Marked a conference club order filled and added it to the church's bill.",
      metadata: {
        orderId,
        organizationId: order.organizationId,
        churchId: order.churchId,
        itemsTotalCents: order.itemsTotalCents,
        postageCents,
        addedToStock: input.addToStock,
        stockItemCount: input.addToStock ? order.lines.length : 0,
        invoiceId: draft?.invoiceId ?? null,
        invoiceVersionId: draft?.versionId ?? null,
        invoiceOutcome: draft?.outcome ?? null,
      },
    }, tx);
    return { orderId, eventId: order.eventId, invoiceId: draft?.invoiceId ?? null, invoiceOutcome: draft?.outcome ?? null, addedToStock: input.addToStock };
  }, LONG_TRANSACTION);
}

/** Staff cancel a Submitted order with a reason (#1688). A filled order is never cancelled here: it is already on the church's bill. */
export async function cancelConferenceOrderAsStaff(orderId: string, reason: unknown, actorUserId: string, now = new Date()) {
  const text = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  if (!text) throw new ClubOrderError("REASON_REQUIRED", "Give a reason for cancelling the order.");
  if (text.length > CONFERENCE_ORDER_REASON_MAX) throw new ClubOrderError("REASON_REQUIRED", `Keep the reason to ${CONFERENCE_ORDER_REASON_MAX} characters or fewer.`);
  const prisma = getPrisma();
  const found = await prisma.conferenceClubOrder.findUnique({ where: { id: orderId }, select: { organizationId: true } });
  if (!found) throw new ClubOrderError("ORDER_NOT_FOUND", "That order could not be found.");
  return prisma.$transaction(async (tx) => {
    await lockClubOrders(tx, found.organizationId);
    const order = await tx.conferenceClubOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true, organizationId: true, eventId: true } });
    if (!order) throw new ClubOrderError("ORDER_NOT_FOUND", "That order could not be found.");
    if (!staffCanCancel(order.status)) throw new ClubOrderError("ORDER_NOT_SUBMITTED", "Only a submitted order can be cancelled.");
    const moved = await tx.conferenceClubOrder.updateMany({
      where: { id: orderId, status: "SUBMITTED" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledReason: text, cancelledByAccountId: null, cancelledByUserId: actorUserId },
    });
    if (moved.count === 0) throw new ClubOrderError("ORDER_NOT_SUBMITTED", "Only a submitted order can be cancelled.");
    await writeAuditLog({
      eventId: order.eventId,
      actorUserId,
      action: "CONFERENCE_CLUB_ORDER_CANCELLED",
      entityType: "ConferenceClubOrder",
      entityId: orderId,
      summary: "Youth department staff cancelled a conference club order.",
      metadata: { orderId, organizationId: order.organizationId, by: "STAFF", reasonLength: text.length },
    }, tx);
    return { orderId };
  });
}
