import type { Prisma } from "@prisma/client";

/**
 * The gate every club event passes (#481): published, not archived, CLUB audience and church billing. One definition, so
 * the club portal's event list, `requireClubEvent` and the visiting club invites (#835) cannot drift apart.
 */
export const CLUB_EVENT_GATE = {
  isPublished: true,
  archivedAt: null,
  audience: "CLUB",
  billingMode: "DEFERRED_ORGANIZATION_INVOICE",
} as const satisfies Prisma.EventWhereInput;
