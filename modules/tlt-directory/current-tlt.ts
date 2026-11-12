import "server-only";

import type { Prisma } from "@prisma/client";
import { clubYearFor } from "@/modules/club-rosters/domain";

/**
 * Who counts as a current TLT (#1686): a youth roster member flagged `isTlt`, ACTIVE, on an active club's roster for the
 * current club year. One definition for the directory's own edits and for assigning a TLT to an event activity (#1678).
 * Reads only; it returns ids, never a name or a detail.
 */

type Reader = Pick<Prisma.TransactionClient, "clubRosterMember">;

function currentTltWhere(now: Date): Prisma.ClubRosterMemberWhereInput {
  return {
    clubYear: clubYearFor(now),
    attendeeType: "YOUTH",
    isTlt: true,
    status: "ACTIVE",
    organization: { type: "CLUB", isActive: true },
  };
}

export async function personIsCurrentTlt(client: Reader, personId: string, now = new Date()): Promise<boolean> {
  const row = await client.clubRosterMember.findFirst({ where: { personId, ...currentTltWhere(now) }, select: { id: true } });
  return row !== null;
}

/** Which of these people are current TLTs, in one read. */
export async function currentTltPersonIds(client: Reader, personIds: readonly string[], now = new Date()): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await client.clubRosterMember.findMany({ where: { personId: { in: [...personIds] }, ...currentTltWhere(now) }, select: { personId: true } });
  return new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])));
}
