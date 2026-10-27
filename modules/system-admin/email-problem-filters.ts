import type { Prisma } from "@prisma/client";

/**
 * The "failed email" rule, shared by the System attention summary and the Events Administrator dashboard (#1227) so the
 * two can never disagree. A message counts when it failed, or the provider reported a bounce, spam mark or failure,
 * since `since`, and no later retry of it was sent (`retries: { none: { status: "SENT" } }`). The two filters cannot
 * overlap (the second leaves out status FAILED), so adding their counts never counts a message twice.
 * `eventIds` narrows to those events only; leave it out for every event.
 */
export function failedEmailWheres(since: Date, eventIds?: readonly string[]): [Prisma.MessageOutboxWhereInput, Prisma.MessageOutboxWhereInput] {
  const scope: Prisma.MessageOutboxWhereInput = eventIds ? { eventId: { in: [...eventIds] } } : {};
  const notRecovered = { retries: { none: { status: "SENT" as const } } };
  return [
    { status: "FAILED", failedAt: { gte: since }, ...notRecovered, ...scope },
    {
      status: { not: "FAILED" },
      provider: { in: ["RESEND", "SES"] },
      providerDeliveryStatus: { in: ["BOUNCED", "COMPLAINED", "FAILED"] },
      providerStatusAt: { gte: since },
      ...notRecovered,
      ...scope,
    },
  ];
}
