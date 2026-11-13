import type { Prisma } from "@prisma/client";

/**
 * The money lock on a Closed event (#1515 follow-up). Staff, station, attendee and import paths that create a payment or
 * a refund call `assertEventOpenForMoney` inside their own transaction, before the write. The event row is read
 * `FOR KEY SHARE` there (it waits on the lifecycle transition's `FOR UPDATE`, but not on the `FOR NO KEY UPDATE` locks the
 * event settings saves take); the closeout sign-off and reopen lock the same row `FOR UPDATE`, so a payment and a sign-off are ordered:
 * either the payment commits first (and the sign-off sees it) or it sees the event as Closed and is refused.
 *
 * Square-originated money is never refused (the money already moved); it is recorded and listed for review instead
 * (`closed-event-money-reviews.ts`).
 */

export type MoneyLockAudience = "staff" | "attendee";

export const EVENT_CLOSED_STAFF_MESSAGE = "This event is closed. A finance admin must reopen it on the Closeout page before payments or refunds can be recorded.";
export const EVENT_CLOSED_ATTENDEE_MESSAGE = "Payments for this event are closed. Please contact the event office.";

export class EventClosedError extends Error {
  readonly code = "EVENT_CLOSED" as const;
  readonly status = 409;
  constructor(public readonly audience: MoneyLockAudience = "staff") {
    super(audience === "attendee" ? EVENT_CLOSED_ATTENDEE_MESSAGE : EVENT_CLOSED_STAFF_MESSAGE);
    this.name = "EventClosedError";
  }
}

/** Closed is the stored state; an archived event keeps the state it had, so a closed event that was archived stays locked. */
export function isMoneyLocked(state: string | null | undefined) {
  return state === "CLOSED";
}

type LockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/** Reads the stored lifecycle state of the event row with a key-share lock, inside the caller's transaction. */
export async function readEventLifecycleForMoney(client: LockClient, eventId: string) {
  const rows = await client.$queryRaw<Array<{ lifecycleState: string | null }>>`
    SELECT "lifecycleState"::text AS "lifecycleState" FROM "Event" WHERE "id" = ${eventId} FOR KEY SHARE
  `;
  return rows[0] ? { lifecycleState: rows[0].lifecycleState } : null;
}

/** Throws `EventClosedError` (EVENT_CLOSED, 409) when the event is Closed. Other states, and an unknown event, pass. */
export async function assertEventOpenForMoney(client: LockClient, eventId: string, audience: MoneyLockAudience) {
  const event = await readEventLifecycleForMoney(client, eventId);
  if (event && isMoneyLocked(event.lifecycleState)) throw new EventClosedError(audience);
}
