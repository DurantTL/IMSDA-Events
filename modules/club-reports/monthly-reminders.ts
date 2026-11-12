import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { CONFERENCE_TIME_ZONE } from "@/modules/calendar/conference-format";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubJoinSelect, clubJoinedOn } from "@/modules/club-reports/domain";
import {
  clubOwesRecord,
  planReminders,
  recordIsSubmitted,
  recordsPageUrl,
  reminderEmail,
  reminderIdempotencyKey,
  reminderWindow,
  summaryEmail,
  summaryIdempotencyKey,
  type ReminderClub,
  type ReminderGrant,
  type ReminderWindow,
} from "@/modules/club-reports/monthly-reminders-domain";
import { EMAIL_DELIVERY_BATCH_SIZE } from "@/modules/communications/delivery-timing";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { directorGrantIsActive } from "@/modules/organizations/director-grants-domain";
import { clubYearFor } from "@/modules/club-rosters/domain";

/**
 * The automatic Monthly Record reminder (#1895), run by the scheduled outbox sweep. From the 11th of the month
 * (conference time), each active club whose record for the previous month is not submitted gets one email to its
 * director and deputy; Area Coordinators get one counts-only summary. Caleb approved this reminder as automatic on
 * November 11, 2026; everything else that sends email in bulk still waits for a person.
 *
 * Why it cannot send twice: the claim is a row in `MonthlyRecordReminderLog`, unique on (club, month), written in the
 * same transaction that queues the club's emails. A second or concurrent run finds the row (or loses the unique write)
 * and queues nothing; a failed run rolls both back, so the next sweep retries. The outbox keys are also unique per
 * club, month and address. Only the previous month is ever reminded, from the 11th on, so a late first run still
 * sends and an older month is never caught up.
 *
 * Delivery goes through the account email adapter, which already skips suppressed (bounced or complained) addresses.
 */

export type MonthlyRecordReminderResult = {
  status: "NOT_DUE" | "SWITCHED_OFF" | "EMAIL_NOT_CONFIGURED" | "RAN";
  reportMonth: string | null;
  /** Clubs reminded by this run. */
  reminded: number;
  /** Clubs owing the month with nobody to email (left unclaimed so a later director still gets it). */
  noRecipient: number;
  failed: number;
  /** Area Coordinator summaries queued by this run. */
  summaries: number;
  delivered: number;
};

function empty(status: MonthlyRecordReminderResult["status"], reportMonth: string | null = null): MonthlyRecordReminderResult {
  return { status, reportMonth, reminded: 0, noRecipient: 0, failed: 0, summaries: 0, delivered: 0 };
}

/** The club year whose switch governs a run on this instant: the club year of today's conference date. */
export function reminderSwitchClubYear(now: Date) {
  const today = calendarDateInEventTimeZone(now, CONFERENCE_TIME_ZONE);
  return clubYearFor(new Date(`${today}T12:00:00Z`));
}

async function switchIsOn(client: Pick<ReturnType<typeof getPrisma>, "monthlyRecordReminderSetting">, clubYear: string) {
  const row = await client.monthlyRecordReminderSetting.findUnique({ where: { clubYear }, select: { enabled: true } });
  return row ? row.enabled : true;
}

export async function sendDueMonthlyRecordReminders(options: { now?: Date } = {}): Promise<MonthlyRecordReminderResult> {
  const now = options.now ?? new Date();
  const window = reminderWindow(calendarDateInEventTimeZone(now, CONFERENCE_TIME_ZONE));
  if (!window) return empty("NOT_DUE");
  const prisma = getPrisma();
  if (!(await switchIsOn(prisma, window.switchClubYear))) return empty("SWITCHED_OFF", window.reportMonth);
  if (!isAccountEmailConfigured()) return empty("EMAIL_NOT_CONFIGURED", window.reportMonth);

  const result = empty("RAN", window.reportMonth);
  const sender = getAccountEmailSender();
  const baseUrl = getServerEnv().APP_BASE_URL;

  const orgs = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true },
    select: { id: true, name: true, ...clubJoinSelect },
  });
  const clubIds = orgs.map((club) => club.id);
  const [reports, logged] = await Promise.all([
    prisma.clubMonthlyReport.findMany({ where: { reportMonth: window.reportMonth, organizationId: { in: clubIds } }, select: { organizationId: true, status: true, firstSubmittedAt: true } }),
    prisma.monthlyRecordReminderLog.findMany({ where: { reportMonth: window.reportMonth }, select: { organizationId: true } }),
  ]);
  const reportByClub = new Map(reports.map((report) => [report.organizationId, report]));
  const clubs: ReminderClub[] = orgs.map((club) => {
    const report = reportByClub.get(club.id);
    return { id: club.id, name: club.name, joinedOn: clubJoinedOn(club), status: (report?.status as "DRAFT" | "SUBMITTED" | undefined) ?? null, everSubmitted: Boolean(report?.firstSubmittedAt) };
  });
  const alreadyReminded = new Set(logged.map((row) => row.organizationId));

  const candidateIds = clubs.filter((club) => !alreadyReminded.has(club.id) && !recordIsSubmitted(club.status) && !club.everSubmitted).map((club) => club.id);
  const grantsByClub = new Map<string, ReminderGrant[]>();
  if (candidateIds.length > 0) {
    const grants = await prisma.clubDirectorGrant.findMany({
      where: {
        organizationId: { in: candidateIds },
        role: { in: ["DIRECTOR", "DEPUTY"] },
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        // A disabled or unverified account is never emailed.
        attendeeAccount: { disabledAt: null, status: "ACTIVE" },
      },
      select: { organizationId: true, role: true, effectiveFrom: true, effectiveTo: true, revokedAt: true, attendeeAccount: { select: { displayName: true, email: true } } },
    });
    for (const grant of grants) {
      if (!directorGrantIsActive(grant, now)) continue;
      const list = grantsByClub.get(grant.organizationId) ?? [];
      list.push({ role: grant.role, email: grant.attendeeAccount.email, name: grant.attendeeAccount.displayName });
      grantsByClub.set(grant.organizationId, list);
    }
  }

  const plan = planReminders({ clubs, reportMonth: window.reportMonth, alreadyReminded, grantsByClub });
  result.noRecipient = clubs.filter((club) => candidateIds.includes(club.id) && clubOwesRecord(club, window.reportMonth)).length - plan.length;

  const messageIds: string[] = [];
  for (const entry of plan) {
    try {
      const ids = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the switch may have been turned off, or the record submitted, since the read above.
        if (!(await switchIsOn(tx, window.switchClubYear))) return [];
        const current = await tx.clubMonthlyReport.findUnique({
          where: { organizationId_reportMonth: { organizationId: entry.clubId, reportMonth: window.reportMonth } },
          select: { status: true, firstSubmittedAt: true },
        });
        if (current?.status === "SUBMITTED" || current?.firstSubmittedAt) return [];
        // The claim. A second run (or a concurrent one that lost the unique write) writes nothing and queues nothing.
        const claimed = await tx.monthlyRecordReminderLog.createMany({
          data: [{ organizationId: entry.clubId, reportMonth: window.reportMonth, clubYear: window.reportClubYear, recipients: entry.recipients.length, sentAt: now }],
          skipDuplicates: true,
        });
        if (claimed.count === 0) return [];
        const correlationId = randomUUID();
        const created: string[] = [];
        for (const recipient of entry.recipients) {
          const content = reminderEmail({
            directorName: recipient.name,
            clubName: entry.clubName,
            reportMonth: window.reportMonth,
            recordsUrl: recordsPageUrl(baseUrl, entry.clubId),
          });
          const message = await tx.messageOutbox.create({
            data: {
              eventId: null,
              templateKey: "MONTHLY_RECORD_REMINDER",
              recipientKind: "ACCOUNT",
              recipientEmail: recipient.email,
              recipientName: recipient.name.trim() || null,
              senderNameSnapshot: sender.name,
              senderEmailSnapshot: sender.address,
              replyToEmailSnapshot: sender.replyTo,
              subjectSnapshot: content.subject,
              bodyTextSnapshot: content.bodyText,
              metadata: { trigger: "MONTHLY_RECORD_REMINDER", accountEmail: true, realDelivery: true, reportMonth: window.reportMonth },
              idempotencyKey: reminderIdempotencyKey(entry.clubId, window.reportMonth, recipient.email),
              correlationId,
              status: "PENDING",
            },
            select: { id: true },
          });
          created.push(message.id);
        }
        await writeAuditLog({
          action: "MONTHLY_RECORD_REMINDER_SENT",
          entityType: "Organization",
          entityId: entry.clubId,
          summary: `Sent the ${window.reportMonth} Monthly Record reminder to ${entry.recipients.length} ${entry.recipients.length === 1 ? "person" : "people"} for ${entry.clubName}.`,
          metadata: { organizationId: entry.clubId, reportMonth: window.reportMonth, recipients: entry.recipients.length },
        }, tx);
        return created;
      }, { timeout: 30_000, maxWait: 10_000 });
      if (ids.length > 0) {
        result.reminded += 1;
        messageIds.push(...ids);
      }
    } catch (error) {
      result.failed += 1;
      logError("A Monthly Record reminder could not be queued", error, { organizationId: entry.clubId, reportMonth: window.reportMonth });
    }
  }

  // The coordinator summary waits for a run with no failures, so its counts are final; one per coordinator per month.
  if (result.failed === 0) {
    try {
      const summaryIds = await queueCoordinatorSummary({ window, clubs, now, sender });
      result.summaries = summaryIds.length;
      messageIds.push(...summaryIds);
    } catch (error) {
      result.failed += 1;
      logError("The Monthly Record reminder summary could not be queued", error, { reportMonth: window.reportMonth });
    }
  }

  if (messageIds.length > 0) {
    try {
      const delivery = await processAccountEmailQueue({ messageIds, limit: Math.min(messageIds.length, EMAIL_DELIVERY_BATCH_SIZE) });
      result.delivered = delivery.sentIds.length;
    } catch (error) {
      // What does not go now stays queued for the scheduled sweep.
      logError("Monthly Record reminders were queued but could not be delivered immediately", error);
    }
  }
  return result;
}

/**
 * One summary email per active Area Coordinator for the month, once clubs were reminded for it: counts only. The grant
 * has no area, so the counts are conference-wide. Temporary acting grants (an expiry date) are not coordinators.
 */
async function queueCoordinatorSummary(input: {
  window: ReminderWindow;
  clubs: readonly ReminderClub[];
  now: Date;
  sender: ReturnType<typeof getAccountEmailSender>;
}): Promise<string[]> {
  const prisma = getPrisma();
  const reminded = await prisma.monthlyRecordReminderLog.count({ where: { reportMonth: input.window.reportMonth } });
  if (reminded === 0) return [];
  const coordinators = await prisma.areaCoordinatorGrant.findMany({
    where: { revokedAt: null, expiresAt: null, attendeeAccount: { disabledAt: null, status: "ACTIVE" } },
    select: { attendeeAccountId: true, attendeeAccount: { select: { displayName: true, email: true } } },
  });
  if (coordinators.length === 0) return [];
  const content = summaryEmail({
    reportMonth: input.window.reportMonth,
    counts: {
      reminded,
      submitted: input.clubs.filter((club) => recordIsSubmitted(club.status)).length,
      total: input.clubs.length,
    },
  });
  const ids: string[] = [];
  for (const coordinator of coordinators) {
    const email = coordinator.attendeeAccount.email.trim().toLowerCase();
    if (!email) continue;
    const idempotencyKey = summaryIdempotencyKey(input.window.reportMonth, coordinator.attendeeAccountId);
    const existing = await prisma.messageOutbox.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) continue;
    const message = await prisma.messageOutbox.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        eventId: null,
        templateKey: "MONTHLY_RECORD_REMINDER_SUMMARY",
        recipientKind: "ACCOUNT",
        recipientEmail: email,
        recipientName: coordinator.attendeeAccount.displayName.trim() || null,
        senderNameSnapshot: input.sender.name,
        senderEmailSnapshot: input.sender.address,
        replyToEmailSnapshot: input.sender.replyTo,
        subjectSnapshot: content.subject,
        bodyTextSnapshot: content.bodyText,
        metadata: { trigger: "MONTHLY_RECORD_REMINDER_SUMMARY", accountEmail: true, realDelivery: true, reportMonth: input.window.reportMonth },
        idempotencyKey,
        correlationId: randomUUID(),
        status: "PENDING",
      },
      select: { id: true },
    });
    ids.push(message.id);
  }
  return ids;
}

// --- The Clubs Administrator view ---------------------------------------------------------------------------------

export const REMINDER_LOG_LIMIT = 100;

export type MonthlyRecordReminderLogRow = { id: string; reportMonth: string; clubId: string; clubName: string; recipients: number; sentAt: string };

/** What a Clubs Administrator sees: the switch for the current club year and the latest reminders (month, club, recipient count, time). No address or name. */
export async function getMonthlyRecordReminderOverview(now = new Date()) {
  const prisma = getPrisma();
  const clubYear = reminderSwitchClubYear(now);
  const [enabled, rows] = await Promise.all([
    switchIsOn(prisma, clubYear),
    prisma.monthlyRecordReminderLog.findMany({ orderBy: [{ sentAt: "desc" }, { id: "asc" }], take: REMINDER_LOG_LIMIT }),
  ]);
  const orgs = rows.length === 0
    ? []
    : await prisma.organization.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.organizationId))] } }, select: { id: true, name: true } });
  const names = new Map(orgs.map((org) => [org.id, org.name]));
  const log: MonthlyRecordReminderLogRow[] = rows.map((row) => ({
    id: row.id,
    reportMonth: row.reportMonth,
    clubId: row.organizationId,
    clubName: names.get(row.organizationId) ?? "Club",
    recipients: row.recipients,
    sentAt: row.sentAt.toISOString(),
  }));
  return { clubYear, enabled, log };
}

/**
 * Turns the reminder off or back on for the current club year. The caller has passed `requireClubsAdministration()`.
 * The change and its audit entry are written together; nothing is written when it is already in the wanted state.
 */
export async function setMonthlyRecordReminderEnabled(enabled: boolean, actorUserId: string, now = new Date()) {
  const clubYear = reminderSwitchClubYear(now);
  return getPrisma().$transaction(async (tx) => {
    const current = await switchIsOn(tx, clubYear);
    if (current === enabled) return { clubYear, enabled, changed: false };
    await tx.monthlyRecordReminderSetting.upsert({
      where: { clubYear },
      update: { enabled, updatedByUserId: actorUserId },
      create: { clubYear, enabled, updatedByUserId: actorUserId },
    });
    await writeAuditLog({
      actorUserId,
      action: enabled ? "MONTHLY_RECORD_REMINDER_TURNED_ON" : "MONTHLY_RECORD_REMINDER_TURNED_OFF",
      entityType: "MonthlyRecordReminderSetting",
      entityId: clubYear,
      summary: `${enabled ? "Turned on" : "Turned off"} the automatic Monthly Record reminder for club year ${clubYear}.`,
      metadata: { clubYear, enabled, at: now.toISOString() },
    }, tx);
    return { clubYear, enabled, changed: true };
  });
}
