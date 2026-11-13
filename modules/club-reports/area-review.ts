import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { CONFERENCE_TIME_ZONE } from "@/modules/calendar/conference-format";
import {
  AreaReviewError,
  checkItemDecision,
  mayChangeAfterReturn,
  type ItemDecision,
  type ItemDecisionInput,
  type MonthlyRecordItemOutcome,
} from "@/modules/club-reports/area-review-domain";
import { pointItems, type PointItemKey } from "@/modules/club-reports/domain";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { areaClubWhere } from "@/modules/organizations/area-coordinator-ministries-domain";
import { coordinatorMinistriesForAccount } from "@/modules/organizations/area-coordinators";

/**
 * Area Coordinator item-by-item review of Monthly Records (#1701), the data side. The conference switch is per club
 * year and off by default (no row means off). A coordinator's decision on one item is the one narrow write; the
 * rest of the record stays read-only for them.
 *
 * A changed decision writes a new row and sets `supersededAt` on the old one, so there is a history; a partial unique
 * index keeps at most one current row per record and item. Any save of the record as SUBMITTED supersedes the current
 * decisions (see `supersedeCurrentReviews`).
 */

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

/** The club year whose switch a Clubs Administrator changes: the year of today's conference date. */
export function areaReviewSwitchClubYear(now: Date) {
  const today = calendarDateInEventTimeZone(now, CONFERENCE_TIME_ZONE);
  return clubYearFor(new Date(`${today}T12:00:00Z`));
}

export async function areaReviewEnabledFor(client: Client, clubYear: string) {
  const row = await client.monthlyRecordAreaReviewSetting.findUnique({ where: { clubYear }, select: { enabled: true } });
  return row?.enabled === true;
}

export async function getAreaReviewSwitch(now = new Date()) {
  const clubYear = areaReviewSwitchClubYear(now);
  return { clubYear, enabled: await areaReviewEnabledFor(getPrisma(), clubYear) };
}

/**
 * Turns Area Coordinator review off or on for the current club year. The caller has passed `requireClubsAdministration()`.
 * The change and its audit entry are written together; nothing is written when it is already in the wanted state.
 */
export async function setMonthlyRecordAreaReviewEnabled(enabled: boolean, actorUserId: string, now = new Date()) {
  const clubYear = areaReviewSwitchClubYear(now);
  return getPrisma().$transaction(async (tx) => {
    if ((await areaReviewEnabledFor(tx, clubYear)) === enabled) return { clubYear, enabled, changed: false };
    await tx.monthlyRecordAreaReviewSetting.upsert({
      where: { clubYear },
      update: { enabled, updatedByUserId: actorUserId },
      create: { clubYear, enabled, updatedByUserId: actorUserId },
    });
    await writeAuditLog({
      actorUserId,
      action: enabled ? "MONTHLY_RECORD_AREA_REVIEW_TURNED_ON" : "MONTHLY_RECORD_AREA_REVIEW_TURNED_OFF",
      entityType: "MonthlyRecordAreaReviewSetting",
      entityId: clubYear,
      summary: `${enabled ? "Turned on" : "Turned off"} Area Coordinator review of Monthly Records for club year ${clubYear}.`,
      metadata: { clubYear, enabled, at: now.toISOString() },
    }, tx);
    return { clubYear, enabled, changed: true };
  });
}

type StoredDecision = { itemKey: string; outcome: MonthlyRecordItemOutcome; note: string; reviewedAt: Date; reviewedByAccount?: { displayName: string } | null };

function serializeDecision(row: StoredDecision): ItemDecision {
  return {
    itemKey: row.itemKey as PointItemKey,
    outcome: row.outcome,
    note: row.note,
    reviewedAt: row.reviewedAt.toISOString(),
    ...(row.reviewedByAccount !== undefined ? { reviewedByName: row.reviewedByAccount?.displayName ?? null } : {}),
  };
}

/** The current (not superseded) decisions on a record, in the order of the form's items. */
export async function currentItemDecisions(client: Client, reportId: string, options: { includeReviewer?: boolean } = {}): Promise<ItemDecision[]> {
  const rows = await client.clubMonthlyReportItemReview.findMany({
    where: { reportId, supersededAt: null },
    select: {
      itemKey: true, outcome: true, note: true, reviewedAt: true,
      ...(options.includeReviewer ? { reviewedByAccount: { select: { displayName: true } } } : {}),
    },
  });
  const order = pointItems.map((item) => item.key as string);
  return (rows as StoredDecision[]).map(serializeDecision).sort((a, b) => order.indexOf(a.itemKey) - order.indexOf(b.itemKey));
}

/**
 * The decisions to show beside a record's items: nothing at all while the switch is off for the record's club year, and
 * nothing for a record that is not there. `includeReviewer` adds the coordinator's name, for staff only.
 */
export async function getItemDecisionsForRecord(organizationId: string, reportMonth: string, options: { includeReviewer?: boolean } = {}) {
  const prisma = getPrisma();
  const report = await prisma.clubMonthlyReport.findUnique({
    where: { organizationId_reportMonth: { organizationId, reportMonth } },
    select: { id: true, clubYear: true },
  });
  if (!report) return { switchOn: false, decisions: [] as ItemDecision[] };
  if (!(await areaReviewEnabledFor(prisma, report.clubYear))) return { switchOn: false, decisions: [] as ItemDecision[] };
  return { switchOn: true, decisions: await currentItemDecisions(prisma, report.id, options) };
}

/** Whether the past-due exception applies to a record right now: the switch on for its year and a current returned item. */
export async function areaReturnAllowsChange(client: Client, report: { id: string; clubYear: string }) {
  if (!(await areaReviewEnabledFor(client, report.clubYear))) return false;
  const returned = await client.clubMonthlyReportItemReview.count({ where: { reportId: report.id, supersededAt: null, outcome: "RETURNED" } });
  return mayChangeAfterReturn(true, Array.from({ length: returned }, () => ({ outcome: "RETURNED" as const })));
}

/** Marks every current decision on a record superseded. Called in the transaction of any save that leaves it SUBMITTED. */
export async function supersedeCurrentReviews(tx: Prisma.TransactionClient, reportId: string, now: Date) {
  const result = await tx.clubMonthlyReportItemReview.updateMany({ where: { reportId, supersededAt: null }, data: { supersededAt: now } });
  return result.count;
}

export type AreaReviewActor = { accountId: string };

/**
 * The Area Coordinator sets one item's decision. In one transaction: the coordinator's ministries are read fresh, the
 * record's club must be an active, non-visiting club of those ministries (anything else answers "not found", with no
 * detail), the record must be SUBMITTED, and the switch must be on for its club year. An unchanged decision writes and
 * audits nothing. The audit entry holds ids and outcomes only, never the note.
 */
export async function reviewReportItem(
  input: { organizationId: string; month: string } & ItemDecisionInput,
  actor: AreaReviewActor,
  now = new Date(),
) {
  const decision = checkItemDecision(input);
  const notFound = () => new AreaReviewError("NOT_FOUND", "That record could not be found.");
  try {
    return await reviewInTransaction();
  } catch (error) {
    // Two decisions on the same item at once: the partial unique index lets one through.
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
      throw new AreaReviewError("CONFLICT", "That item was just changed. Reload and try again.");
    }
    throw error;
  }

  function reviewInTransaction() {
    return getPrisma().$transaction(async (tx) => {
    const ministries = await coordinatorMinistriesForAccount(actor.accountId, now, tx);
    if (ministries.length === 0) throw notFound();
    const report = await tx.clubMonthlyReport.findFirst({
      where: { organizationId: input.organizationId, reportMonth: input.month, organization: areaClubWhere(ministries) },
      select: { id: true, organizationId: true, clubYear: true, reportMonth: true, status: true },
    });
    if (!report) throw notFound();
    if (!(await areaReviewEnabledFor(tx, report.clubYear))) throw new AreaReviewError("FEATURE_OFF", "That record could not be found.");
    if (report.status !== "SUBMITTED") throw new AreaReviewError("NOT_SUBMITTED", "Only a submitted record can be reviewed.");
    if (!decision.ok) throw new AreaReviewError("INVALID_DECISION", decision.message);

    const current = await tx.clubMonthlyReportItemReview.findFirst({
      where: { reportId: report.id, itemKey: decision.itemKey, supersededAt: null },
      select: { id: true, outcome: true, note: true },
    });
    if (current && current.outcome === decision.outcome && current.note === decision.note) {
      return { changed: false, itemKey: decision.itemKey, outcome: decision.outcome };
    }
    if (current) await tx.clubMonthlyReportItemReview.update({ where: { id: current.id }, data: { supersededAt: now } });
    const created = await tx.clubMonthlyReportItemReview.create({
      data: { reportId: report.id, itemKey: decision.itemKey, outcome: decision.outcome, note: decision.note, reviewedByAccountId: actor.accountId, reviewedAt: now },
      select: { id: true },
    });
    await writeAuditLog({
      action: "CLUB_REPORT_ITEM_AREA_REVIEWED",
      entityType: "ClubMonthlyReport",
      entityId: report.id,
      summary: `An Area Coordinator marked a Monthly Record item ${decision.outcome === "OK" ? "OK" : "returned"}.`,
      metadata: {
        organizationId: report.organizationId,
        reportMonth: report.reportMonth,
        reportId: report.id,
        reviewId: created.id,
        itemKey: decision.itemKey,
        outcome: decision.outcome,
        previousOutcome: current?.outcome ?? null,
        actorAttendeeAccountId: actor.accountId,
      },
    }, tx);
    return { changed: true, itemKey: decision.itemKey, outcome: decision.outcome };
    });
  }
}
