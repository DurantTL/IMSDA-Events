import type { Prisma } from "@prisma/client";
import { selectPolicyVersion, type PolicyVersionRecord } from "@/modules/cancellation-policy/calculator";
import { cancellationRulesSchema } from "@/modules/cancellation-policy/rules";

/**
 * The one rule for "this event has a cancellation policy" (#1408): a saved version whose rules still parse and whose
 * effective time has arrived. The registrant's cancellation request view, the My registrations note and the event's
 * publish readiness all ask this, so they never disagree. Kept apart from the repository so a light caller (readiness)
 * does not pull in its payment and club imports.
 */

type PolicyClient = Pick<Prisma.TransactionClient, "eventCancellationPolicyVersion">;

export function toPolicyRecord(row: { id: string; version: number; effectiveFrom: Date; rules: unknown }): PolicyVersionRecord | null {
  const parsed = cancellationRulesSchema.safeParse(row.rules);
  if (!parsed.success) return null;
  return { id: row.id, version: row.version, effectiveFrom: row.effectiveFrom, rules: parsed.data };
}

export async function usablePolicyVersions(client: PolicyClient, eventId: string) {
  const rows = await client.eventCancellationPolicyVersion.findMany({
    where: { eventId },
    select: { id: true, version: true, effectiveFrom: true, rules: true },
  });
  return rows.flatMap((row) => { const parsed = toPolicyRecord(row); return parsed ? [parsed] : []; });
}

/** The version in effect at `now`, or null when the event has none. */
export async function policyVersionInEffect(client: PolicyClient, eventId: string, now = new Date()) {
  return selectPolicyVersion(await usablePolicyVersions(client, eventId), now);
}

/** Whether the event has a cancellation policy in effect now. */
export async function eventHasCancellationPolicy(client: PolicyClient, eventId: string, now = new Date()) {
  return (await policyVersionInEffect(client, eventId, now)) !== null;
}
