import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { viewerAuditFields, type ClubFormsViewer } from "@/modules/club-forms/domain";
import { leaderOnly } from "@/modules/club-forms/links";
import { clubYearFor } from "@/modules/club-rosters/domain";

/**
 * "Start the new year" (#1323). Once a club does it for a club year, its forms
 * and links from earlier club years are listed under Past years. It only
 * records the choice: nothing is deleted, and who may read a form is unchanged.
 */

/** Whether the club has started `currentClubYear`, and whether any form or link is from an earlier year. */
export async function getClubFormsYearState(viewer: ClubFormsViewer, organizationId: string, currentClubYear: string) {
  leaderOnly(viewer, organizationId);
  const prisma = getPrisma();
  const [started, earlierLink, earlierForm] = await Promise.all([
    prisma.clubFormYearStart.findUnique({
      where: { organizationId_clubYear: { organizationId, clubYear: currentClubYear } },
      select: { startedAt: true },
    }),
    prisma.clubFormLink.findFirst({ where: { organizationId, clubYear: { lt: currentClubYear } }, select: { id: true } }),
    prisma.clubFormSubmission.findFirst({ where: { organizationId, clubYear: { lt: currentClubYear } }, select: { id: true } }),
  ]);
  return { yearStarted: Boolean(started), hasEarlierYears: Boolean(earlierLink || earlierForm) };
}

/** Starts the current club year for the club. Safe to repeat: a second call changes nothing and writes no second audit row. */
export async function startClubFormsYear(viewer: ClubFormsViewer, organizationId: string, now = new Date()) {
  const leader = leaderOnly(viewer, organizationId);
  const clubYear = clubYearFor(now);
  const who = viewerAuditFields(leader);
  const actor = leader.actor;
  const startedBy = actor.kind === "ATTENDEE" ? { startedByAccountId: actor.accountId } : { startedByUserId: actor.userId };
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.clubFormYearStart.findUnique({
      where: { organizationId_clubYear: { organizationId, clubYear } },
      select: { organizationId: true },
    });
    if (existing) return { clubYear, alreadyStarted: true };
    await tx.clubFormYearStart.upsert({
      where: { organizationId_clubYear: { organizationId, clubYear } },
      create: { organizationId, clubYear, startedAt: now, ...startedBy },
      update: {},
    });
    await writeAuditLog({
      actorUserId: who.actorUserId,
      action: "CLUB_FORMS_YEAR_STARTED",
      entityType: "Organization",
      entityId: organizationId,
      summary: "Started the new club year for club forms.",
      metadata: { ...who.metadata, organizationId, clubYear },
    }, tx);
    return { clubYear, alreadyStarted: false };
  });
}
