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

/**
 * The latest club year the club started that is not after the current one
 * (club years are "YYYY-YY", so they sort as text), and whether any link or
 * form is from before the current year yet not moved into Past years.
 */
export async function getClubFormsYearState(viewer: ClubFormsViewer, organizationId: string, currentClubYear: string) {
  leaderOnly(viewer, organizationId);
  const prisma = getPrisma();
  const latest = await prisma.clubFormYearStart.findFirst({
    where: { organizationId, clubYear: { lte: currentClubYear } },
    orderBy: { clubYear: "desc" },
    select: { clubYear: true },
  });
  const startedClubYear = latest?.clubYear ?? null;
  const unmoved = { organizationId, clubYear: { lt: currentClubYear, ...(startedClubYear ? { gte: startedClubYear } : {}) } };
  const [earlierLink, earlierForm] = await Promise.all([
    prisma.clubFormLink.findFirst({ where: unmoved, select: { id: true } }),
    prisma.clubFormSubmission.findFirst({ where: unmoved, select: { id: true } }),
  ]);
  return {
    startedClubYear,
    yearStarted: startedClubYear === currentClubYear,
    hasEarlierYears: Boolean(earlierLink || earlierForm),
  };
}

/** Starts the current club year for the club. Safe to repeat: a second call changes nothing and writes no second audit row. */
export async function startClubFormsYear(viewer: ClubFormsViewer, organizationId: string, now = new Date()) {
  const leader = leaderOnly(viewer, organizationId);
  const clubYear = clubYearFor(now);
  const who = viewerAuditFields(leader);
  const actor = leader.actor;
  const startedBy = actor.kind === "ATTENDEE" ? { startedByAccountId: actor.accountId } : { startedByUserId: actor.userId };
  return getPrisma().$transaction(async (tx) => {
    // One insert that ignores a duplicate, so two requests at once start the year once and audit it once.
    const created = await tx.clubFormYearStart.createMany({
      data: [{ organizationId, clubYear, startedAt: now, ...startedBy }],
      skipDuplicates: true,
    });
    if (created.count !== 1) return { clubYear, alreadyStarted: true };
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
