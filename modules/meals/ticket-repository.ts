import "server-only";

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Café ticket numbers (#916). Every unit of an active selection is one EventMealTicket whose number is unique within
 * the event and never reused:
 * - the numbers come from Event.mealTicketSeq, advanced with a single UPDATE that takes the event row's lock, so two
 *   transactions can never hand out the same number (the unique index on (eventId, number) is the backstop);
 * - a quantity increase adds tickets with new numbers;
 * - a decrease, or cancelling the selection, sets `cancelledAt` on the highest-numbered active tickets, so the
 *   lower numbers a scanner already holds keep working and a cancelled number is never handed out again.
 *
 * Call it inside the transaction that creates, re-quantifies or cancels a selection, after the selection row is
 * written. It makes the tickets match the selection (status ACTIVE: `quantity` tickets; anything else: none).
 */
export async function syncSelectionTickets(tx: Tx, selection: { id: string; eventId: string; status: string; quantity: number }) {
  const wanted = selection.status === "ACTIVE" ? selection.quantity : 0;
  const active = await tx.eventMealTicket.findMany({
    where: { selectionId: selection.id, cancelledAt: null }, orderBy: { number: "asc" }, select: { id: true },
  });
  if (active.length > wanted) {
    await tx.eventMealTicket.updateMany({ where: { id: { in: active.slice(wanted).map((ticket) => ticket.id) } }, data: { cancelledAt: new Date() } });
    return;
  }
  const missing = wanted - active.length;
  if (missing <= 0) return;
  const [{ mealTicketSeq }] = await tx.$queryRaw<Array<{ mealTicketSeq: number }>>`
    UPDATE "Event" SET "mealTicketSeq" = "mealTicketSeq" + ${missing} WHERE "id" = ${selection.eventId} RETURNING "mealTicketSeq"`;
  const first = mealTicketSeq - missing + 1;
  await tx.eventMealTicket.createMany({
    data: Array.from({ length: missing }, (_, index) => ({ eventId: selection.eventId, selectionId: selection.id, number: first + index })),
  });
}

/**
 * A safety net for selections written outside the selection repository (a repair script, an old row): gives every
 * active selection of the event the tickets it is missing, in a stable order, and retires tickets of selections
 * that are no longer active. A no-op when nothing is out of step, which is the normal case.
 */
export async function ensureEventTickets(tx: Tx, eventId: string) {
  const selections = await tx.eventMealSelection.findMany({
    where: { eventId, OR: [{ status: "ACTIVE" }, { tickets: { some: { cancelledAt: null } } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, eventId: true, status: true, quantity: true, tickets: { where: { cancelledAt: null }, select: { id: true } } },
  });
  for (const selection of selections) {
    const wanted = selection.status === "ACTIVE" ? selection.quantity : 0;
    if (selection.tickets.length !== wanted) await syncSelectionTickets(tx, selection);
  }
}
