import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { conferenceClubWhere } from "@/modules/organizations/area-coordinator-ministries-domain";
import { directorGrantIsActive } from "@/modules/organizations/director-grants-domain";
import { getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { EMAIL_DELIVERY_BATCH_SIZE } from "@/modules/communications/delivery-timing";
import { announcementOptOutFor, CLUB_CALENDAR_REMINDER_TEMPLATE_KEY, normalizeEmailAddress } from "@/modules/communications/email-preferences";
import { loadAnnouncementOptOuts } from "@/modules/communications/email-preferences-repository";
import {
  CLUB_CALENDAR_FEATURE_KEY,
  REMINDER_RUN_CAP,
  REMINDER_START_HOUR,
  calendarPageUrl,
  calendarReminderEmail,
  calendarReminderIdempotencyKey,
  conferenceHour,
  conferenceToday,
  reminderDateBounds,
  reminderIsDue,
  type ClubCalendarKind,
} from "@/modules/club-calendar/domain";

/**
 * The club calendar reminder (#1700), run by the scheduled outbox sweep. A club that switched the calendar on AND turned
 * reminders on (both off until then, so a deploy sends nothing) has its director and deputy emailed once for an item
 * when today, in conference time, is within the club's chosen days before the item, from 8 a.m. on.
 *
 * Why it cannot send twice: the claim is a row in `ClubCalendarReminderLog`, unique on (item, item date), written in the
 * same transaction that queues the emails. A second or concurrent run finds the row (or loses the unique write) and
 * queues nothing; a failed run rolls both back, so the next sweep retries. Moving an item to a new date is a new claim.
 * The outbox keys are also unique per item, date and address. An item with nobody to email is left unclaimed.
 *
 * Opt-outs: an address that opted out of ALL IMAdventist announcements is skipped here and again at delivery. Delivery
 * also re-checks (`clubCalendarReminderCheck`) that the item, the switches and the recipient's role still stand.
 */

export type ClubCalendarReminderResult = {
  status: "NOT_DUE" | "EMAIL_NOT_CONFIGURED" | "RAN";
  /** Clubs with reminders on that were looked at. */
  clubs: number;
  /** Items reminded by this run. */
  reminded: number;
  /** Due items with nobody to email (left unclaimed). */
  noRecipient: number;
  failed: number;
  delivered: number;
};

function empty(status: ClubCalendarReminderResult["status"]): ClubCalendarReminderResult {
  return { status, clubs: 0, reminded: 0, noRecipient: 0, failed: 0, delivered: 0 };
}

type Client = Pick<ReturnType<typeof getPrisma>, "clubDirectorGrant" | "organization" | "clubCalendarReminderSetting" | "clubOptionalFeature" | "clubCalendarItem">;

type Recipient = { email: string; name: string };

/** The club's active director and deputy (the people who can turn reminders off) with an active, enabled account, read now. */
async function loadRecipients(client: Pick<Client, "clubDirectorGrant">, organizationIds: readonly string[], now: Date) {
  const byClub = new Map<string, Recipient[]>();
  if (organizationIds.length === 0) return byClub;
  const grants = await client.clubDirectorGrant.findMany({
    where: {
      organizationId: { in: [...organizationIds] },
      role: { in: ["DIRECTOR", "DEPUTY"] },
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      attendeeAccount: { disabledAt: null, status: "ACTIVE" },
    },
    select: { organizationId: true, effectiveFrom: true, effectiveTo: true, revokedAt: true, attendeeAccount: { select: { displayName: true, email: true } } },
  });
  for (const grant of grants) {
    if (!directorGrantIsActive(grant, now)) continue;
    const email = normalizeEmailAddress(grant.attendeeAccount.email);
    if (!email) continue;
    const list = byClub.get(grant.organizationId) ?? [];
    if (!list.some((person) => person.email === email)) list.push({ email, name: grant.attendeeAccount.displayName });
    byClub.set(grant.organizationId, list);
  }
  return byClub;
}

export async function sendDueClubCalendarReminders(options: { now?: Date } = {}): Promise<ClubCalendarReminderResult> {
  const now = options.now ?? new Date();
  if (conferenceHour(now) < REMINDER_START_HOUR) return empty("NOT_DUE");
  if (!isAccountEmailConfigured()) return empty("EMAIL_NOT_CONFIGURED");
  const prisma = getPrisma();
  const result = empty("RAN");
  const sender = getAccountEmailSender();
  const baseUrl = getServerEnv().APP_BASE_URL;

  // Only active clubs with the calendar on AND reminders on. No setting row means off.
  const settings = await prisma.clubCalendarReminderSetting.findMany({
    where: {
      enabled: true,
      organization: { ...conferenceClubWhere(), clubOptionalFeatures: { some: { featureKey: CLUB_CALENDAR_FEATURE_KEY } } },
    },
    select: { organizationId: true, daysBefore: true, organization: { select: { name: true } } },
  });
  result.clubs = settings.length;
  if (settings.length === 0) return result;
  const settingByClub = new Map(settings.map((setting) => [setting.organizationId, setting]));

  const bounds = reminderDateBounds(now);
  const candidates = await prisma.clubCalendarItem.findMany({
    where: { organizationId: { in: [...settingByClub.keys()] }, date: { gte: bounds.from, lte: bounds.to } },
    select: { id: true, organizationId: true, kind: true, title: true, date: true, startTime: true, endTime: true, location: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const due = candidates.filter((item) => reminderIsDue(item.date, settingByClub.get(item.organizationId)!.daysBefore, now));
  if (due.length === 0) return result;
  const logged = await prisma.clubCalendarReminderLog.findMany({ where: { itemId: { in: due.map((item) => item.id) } }, select: { itemId: true, itemDate: true } });
  const alreadyReminded = new Set(logged.map((row) => `${row.itemId}|${row.itemDate}`));
  const unreminded = due.filter((item) => !alreadyReminded.has(`${item.id}|${item.date}`));
  if (unreminded.length === 0) return result;

  const clubIds = [...new Set(unreminded.map((item) => item.organizationId))];
  const recipientsByClub = await loadRecipients(prisma, clubIds, now);
  // Opted out of ALL IMAdventist announcements: skipped here, and again at delivery. An event-less message has no event
  // id, so only the global opt-out can match.
  const everyone = [...recipientsByClub.values()].flat().map((person) => person.email);
  const optOuts = await loadAnnouncementOptOuts(prisma, everyone, "");

  // The cap counts items that can be claimed: one with nobody to email is set aside first, so it cannot starve the rest.
  const recipientsFor = (organizationId: string) => (recipientsByClub.get(organizationId) ?? []).filter((person) => announcementOptOutFor(optOuts, person.email, "") === null);
  const claimable = unreminded.filter((item) => recipientsFor(item.organizationId).length > 0);
  result.noRecipient = unreminded.length - claimable.length;
  const wanted = claimable.slice(0, REMINDER_RUN_CAP);

  const messageIds: string[] = [];
  for (const item of wanted) {
    const setting = settingByClub.get(item.organizationId)!;
    const recipients = recipientsFor(item.organizationId);
    try {
      const ids = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the switches may have been turned off, or the item changed or deleted, since the reads above.
        const [currentSetting, feature, current] = await Promise.all([
          tx.clubCalendarReminderSetting.findUnique({ where: { organizationId: item.organizationId }, select: { enabled: true, daysBefore: true } }),
          tx.clubOptionalFeature.findUnique({ where: { organizationId_featureKey: { organizationId: item.organizationId, featureKey: CLUB_CALENDAR_FEATURE_KEY } }, select: { id: true } }),
          tx.clubCalendarItem.findUnique({ where: { id: item.id }, select: { id: true, date: true, kind: true, title: true, startTime: true, endTime: true, location: true } }),
        ]);
        if (!currentSetting?.enabled || !feature || !current) return [];
        if (current.date !== item.date || !reminderIsDue(current.date, currentSetting.daysBefore, now)) return [];
        // The claim. A second run (or a concurrent one that lost the unique write) writes nothing and queues nothing.
        const claimed = await tx.clubCalendarReminderLog.createMany({
          data: [{ itemId: item.id, itemDate: item.date, organizationId: item.organizationId, recipients: recipients.length, sentAt: now }],
          skipDuplicates: true,
        });
        if (claimed.count === 0) return [];
        const correlationId = randomUUID();
        const created: string[] = [];
        for (const recipient of recipients) {
          const content = calendarReminderEmail({
            recipientName: recipient.name,
            clubName: setting.organization.name,
            item: { id: current.id, kind: current.kind as ClubCalendarKind, title: current.title, date: current.date, startTime: current.startTime, endTime: current.endTime, location: current.location },
            calendarUrl: calendarPageUrl(baseUrl, item.organizationId, current.date),
          });
          const message = await tx.messageOutbox.create({
            data: {
              eventId: null,
              templateKey: CLUB_CALENDAR_REMINDER_TEMPLATE_KEY,
              recipientKind: "ACCOUNT",
              recipientEmail: recipient.email,
              recipientName: recipient.name.trim() || null,
              senderNameSnapshot: sender.name,
              senderEmailSnapshot: sender.address,
              replyToEmailSnapshot: sender.replyTo,
              subjectSnapshot: content.subject,
              bodyTextSnapshot: content.bodyText,
              metadata: { trigger: CLUB_CALENDAR_REMINDER_TEMPLATE_KEY, accountEmail: true, realDelivery: true, organizationId: item.organizationId, itemId: item.id, itemDate: item.date } satisfies Prisma.InputJsonObject,
              idempotencyKey: calendarReminderIdempotencyKey(item.id, item.date, recipient.email),
              correlationId,
              status: "PENDING",
            },
            select: { id: true },
          });
          created.push(message.id);
        }
        await writeAuditLog({
          action: "CLUB_CALENDAR_REMINDER_SENT",
          entityType: "ClubCalendarItem",
          entityId: item.id,
          summary: `Queued the reminder for a club calendar item to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}.`,
          metadata: { organizationId: item.organizationId, itemId: item.id, kind: current.kind, recipients: recipients.length },
        }, tx);
        return created;
      }, { timeout: 30_000, maxWait: 10_000 });
      if (ids.length > 0) {
        result.reminded += 1;
        messageIds.push(...ids);
      }
    } catch (error) {
      result.failed += 1;
      logError("A club calendar reminder could not be queued", error, { organizationId: item.organizationId, itemId: item.id });
    }
  }

  if (messageIds.length > 0) {
    try {
      const delivery = await processAccountEmailQueue({ messageIds, limit: Math.min(messageIds.length, EMAIL_DELIVERY_BATCH_SIZE) });
      result.delivered = delivery.sentIds.length;
    } catch (error) {
      // What does not go now stays queued for the scheduled sweep.
      logError("Club calendar reminders were queued but could not be delivered immediately", error);
    }
  }
  return result;
}

// --- The re-check at delivery -------------------------------------------------------------------------------------

export const CLUB_CALENDAR_REMINDER_OBSOLETE_NOTE = "The calendar item was deleted, moved or has passed, or reminders were turned off, or the recipient no longer has a club role, so the reminder was not sent.";

export type CalendarReminderCheck = null | { kind: "OBSOLETE"; note: string };

function metadataFields(metadata: unknown) {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return { organizationId: text(record.organizationId), itemId: text(record.itemId), itemDate: text(record.itemDate) };
}

/**
 * Whether a queued reminder is still wanted, read as it is now. It is obsolete when the club is no longer an active
 * conference club, the calendar or its reminders are off, the item was deleted, moved to another date or has passed, or
 * the recipient no longer holds an active club role with an active account. A failed read throws; the delivery worker
 * then retries instead of sending on a guess.
 */
export async function clubCalendarReminderCheck(
  message: { recipientEmail: string; metadata: unknown },
  now: Date,
  client: Client = getPrisma(),
): Promise<CalendarReminderCheck> {
  const obsolete: CalendarReminderCheck = { kind: "OBSOLETE", note: CLUB_CALENDAR_REMINDER_OBSOLETE_NOTE };
  const { organizationId, itemId, itemDate } = metadataFields(message.metadata);
  if (!organizationId || !itemId || !itemDate) return obsolete;
  if (itemDate < conferenceToday(now)) return obsolete;
  const [club, setting, feature, item] = await Promise.all([
    client.organization.findFirst({ where: { id: organizationId, ...conferenceClubWhere() }, select: { id: true } }),
    client.clubCalendarReminderSetting.findUnique({ where: { organizationId }, select: { enabled: true } }),
    client.clubOptionalFeature.findUnique({ where: { organizationId_featureKey: { organizationId, featureKey: CLUB_CALENDAR_FEATURE_KEY } }, select: { id: true } }),
    client.clubCalendarItem.findFirst({ where: { id: itemId, organizationId }, select: { date: true } }),
  ]);
  if (!club || !setting?.enabled || !feature || !item || item.date !== itemDate) return obsolete;
  const recipients = await loadRecipients(client, [organizationId], now);
  const recipient = normalizeEmailAddress(message.recipientEmail);
  if (!(recipients.get(organizationId) ?? []).some((person) => person.email === recipient)) return obsolete;
  return null;
}
