import "server-only";

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Café ticket numbers (#916). Every unit of an active selection is one EventMealTicket whose number is unique within
 * the event and never reused:
 * - the numbers come from the PostgreSQL sequence "EventMealTicket_number_seq" (`nextval`), which is not
 *   transactional: it never conflicts with another transaction, never hands out a number twice, and a rolled-back
 *   transaction just leaves a gap (fine, numbers are never reused). Nothing here writes an event-wide row, so
 *   overlapping meal-bearing submissions never contend on the event;
 * - the unique index on (eventId, number) is the backstop;
 * - a quantity increase adds tickets with new numbers;
 * - a decrease, or cancelling the selection, sets `cancelledAt` on the highest-numbered active tickets, so the
 *   lower numbers a scanner already holds keep working and a cancelled number is never handed out again.
 *
 * Call it inside the transaction that creates, re-quantifies or cancels a selection, after the selection row is
 * written. It locks the selection row (`FOR UPDATE`) and re-reads its status and quantity, so it never acts on a
 * caller's stale values (`isNew`: the selection was created in this transaction, so it has no tickets yet), then makes the tickets match (status ACTIVE: `quantity` tickets; anything else: none).
 */
export async function syncSelectionTickets(tx: Tx, selection: { id: string }, options: { isNew?: boolean } = {}) {
  const [locked] = await tx.$queryRaw<Array<{ eventId: string; status: string; quantity: number }>>`
    SELECT "eventId", "status"::text AS "status", "quantity" FROM "EventMealSelection" WHERE "id" = ${selection.id} FOR UPDATE`;
  if (!locked) return;
  const wanted = locked.status === "ACTIVE" ? locked.quantity : 0;
  // A selection made in this very transaction has no tickets, so skip the read: under SERIALIZABLE, reading the
  // selection's ticket index would make overlapping submissions look like they depend on each other (a false conflict).
  const active = options.isNew ? [] : await tx.eventMealTicket.findMany({
    where: { selectionId: selection.id, cancelledAt: null }, orderBy: { number: "asc" }, select: { id: true },
  });
  if (active.length > wanted) {
    await tx.eventMealTicket.updateMany({ where: { id: { in: active.slice(wanted).map((ticket) => ticket.id) } }, data: { cancelledAt: new Date() } });
    return;
  }
  const missing = wanted - active.length;
  if (missing <= 0) return;
  const numbers = await tx.$queryRaw<Array<{ number: number }>>`
    SELECT nextval('"EventMealTicket_number_seq"')::integer AS "number" FROM generate_series(1, ${missing}::integer)`;
  await tx.eventMealTicket.createMany({
    data: numbers.map((row) => row.number).sort((a, b) => a - b).map((number) => ({ eventId: locked.eventId, selectionId: selection.id, number })),
  });
}

/**
 * Read-only: the ids of the event's selections whose active tickets do not match what the selection calls for
 * (ACTIVE: `quantity` tickets; anything else: none). Empty in the normal case, so a plain export writes nothing.
 */
export async function selectionsMissingTickets(tx: Tx, eventId: string): Promise<string[]> {
  const selections = await tx.eventMealSelection.findMany({
    where: { eventId, OR: [{ status: "ACTIVE" }, { tickets: { some: { cancelledAt: null } } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, quantity: true, _count: { select: { tickets: { where: { cancelledAt: null } } } } },
  });
  return selections
    .filter((selection) => selection._count.tickets !== (selection.status === "ACTIVE" ? selection.quantity : 0))
    .map((selection) => selection.id);
}

/**
 * The repair for selections written outside the selection repository (a repair script, an old row): gives each
 * mismatched selection the tickets it is missing, in a stable order, and retires tickets of selections that are no
 * longer active. Run it in a SERIALIZABLE transaction after `selectionsMissingTickets` found something; it re-checks
 * inside, and each sync locks and re-reads its selection.
 */
export async function repairEventTickets(tx: Tx, eventId: string) {
  for (const id of await selectionsMissingTickets(tx, eventId)) await syncSelectionTickets(tx, { id });
}
