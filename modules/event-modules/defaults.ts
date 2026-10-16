import "server-only";

import type { Prisma } from "@prisma/client";
import { creationModuleKeys, defaultModuleKeys, isEventModuleKey, type EventModuleKey } from "@/modules/event-modules/catalog";

type Tx = Pick<Prisma.TransactionClient, "eventModule">;

/**
 * Writes the starting modules for a new event (#741), from its audience. Called
 * inside each event-creating transaction (create, template, clone without a
 * source row set) so a new event has stored rows from its first moment.
 */
export async function writeDefaultModules(tx: Tx, eventId: string, audience: "GENERAL" | "CLUB") {
  await tx.eventModule.createMany({
    data: defaultModuleKeys(audience).map((moduleKey) => ({ eventId, moduleKey })),
    skipDuplicates: true,
  });
}

/**
 * The starting modules for a new event when staff chose them on the features step
 * (#965): `requested` is the chosen set, or undefined (step skipped) for the
 * audience's defaults. Same transaction and same `skipDuplicates` write as
 * `writeDefaultModules`, so a repeat of the write changes nothing. System
 * administrators create events, so this never widens who may turn modules on.
 */
export async function writeCreationModules(
  tx: Tx,
  eventId: string,
  audience: "GENERAL" | "CLUB",
  requested?: readonly EventModuleKey[],
) {
  await tx.eventModule.createMany({
    data: creationModuleKeys(audience, requested).map((moduleKey) => ({ eventId, moduleKey })),
    skipDuplicates: true,
  });
}

/** Copies the source event's module rows to a clone, inside the clone transaction. Data is never copied by this. */
export async function copyEventModules(tx: Tx, sourceEventId: string, targetEventId: string) {
  const rows = await tx.eventModule.findMany({ where: { eventId: sourceEventId }, select: { moduleKey: true } });
  const known = rows.filter((row) => isEventModuleKey(row.moduleKey));
  if (known.length === 0) return 0;
  const created = await tx.eventModule.createMany({
    data: known.map((row) => ({ eventId: targetEventId, moduleKey: row.moduleKey })),
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * The clone's modules (#741). The source's rows carry over only when its event
 * details were copied, because that is where the audience comes from; otherwise,
 * or when the source has no usable rows, the clone gets the defaults for its own
 * audience.
 */
export async function writeCloneModules(
  tx: Tx,
  input: { sourceEventId: string; targetEventId: string; audience: "GENERAL" | "CLUB"; detailsCopied: boolean },
) {
  const copied = input.detailsCopied ? await copyEventModules(tx, input.sourceEventId, input.targetEventId) : 0;
  if (copied === 0) await writeDefaultModules(tx, input.targetEventId, input.audience);
}
