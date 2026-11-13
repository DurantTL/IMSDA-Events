import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { CLUB_EVENT_GATE } from "@/modules/club-registrations/event-gate";
import {
  CLUB_DRAFT_REMINDER_OBSOLETE_NOTE,
  CLUB_DRAFT_REMINDER_TEMPLATE_KEY,
  clubDraftReminderPolicySchema,
  draftIsStale,
  draftReminderEmail,
  draftReminderIdempotencyKey,
  draftReminderRecipients,
  draftReminderUrl,
  forecastReminders,
  isWithinSendHours,
  nextReminderDue,
  policyFromRow,
  registrationIsOpen,
  type ClubDraftReminderOverview,
  type ClubDraftReminderPolicyValues,
  type ReminderGrant,
} from "@/modules/club-registrations/draft-reminders-domain";
import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { directorGrantIsActive } from "@/modules/organizations/director-grants-domain";

/**
 * Reminders for an unsubmitted club registration (#164), run by the scheduled outbox sweep. A club director's saved,
 * unsubmitted registration (`ClubRegistrationDraft`) gets a reminder to the club's director and deputy when its event's
 * staff have turned reminders on and the draft has sat untouched long enough. Off until staff turn it on: no policy row
 * means off, so a deploy never sends anything by itself.
 *
 * Why it cannot send twice: the claim is a row in `ClubDraftReminderLog`, unique on (draft, attempt), written in the
 * same transaction that queues the emails. A second or concurrent run finds the row (or loses the unique write) and
 * queues nothing; a failed run rolls both back, so the next sweep retries. The outbox keys are unique per draft,
 * attempt and address as well. A draft's id names one draft: a registration started again after a submit is a new draft.
 *
 * What is re-read, and when: inside the claiming transaction the policy, the draft and its earlier attempts are read
 * again, so a switch turned off or a draft submitted since the first read sends nothing. At delivery the worker asks
 * `clubDraftReminderObsoleteReason` once more (policy, draft, expiry, registration still open, recipient still a
 * director or deputy), so a reminder that waited in the queue is cancelled when it stopped being true.
 *
 * Delivery goes through the event's own outbox slice and delivery mode; announcement opt-outs and provider suppression
 * apply at delivery. The email carries no answer and no token (see `draftReminderEmail`).
 */

export type ClubDraftReminderResult = {
  status: "RAN";
  /** Events with reminders switched on that this run looked at. */
  events: number;
  /** Drafts reminded by this run. */
  reminded: number;
  /** Drafts due with nobody to email (left unclaimed, so a director added later still gets it). */
  noRecipient: number;
  /** Events skipped because their email is paused, captured locally or not set up. */
  skippedEmailOff: number;
  /** Events skipped because it is outside the 9:00 to 19:00 send hours where the event is held. */
  skippedQuietHours: number;
  failed: number;
  delivered: number;
};

function empty(): ClubDraftReminderResult {
  return { status: "RAN", events: 0, reminded: 0, noRecipient: 0, skippedEmailOff: 0, skippedQuietHours: 0, failed: 0, delivered: 0 };
}

/** Most events and most reminders one run handles; the rest wait for the next sweep. */
export const CLUB_DRAFT_REMINDER_EVENT_LIMIT = 50;
export const CLUB_DRAFT_REMINDER_RUN_LIMIT = 100;
const DRAFT_READ_LIMIT = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

const eventSelect = {
  id: true,
  name: true,
  timezone: true,
  isPublished: true,
  archivedAt: true,
  lifecycleState: true,
  registrationOpensOn: true,
  registrationClosesOn: true,
  waitlistEnabled: true,
  endsAt: true,
} satisfies Prisma.EventSelect;

const policySelect = { enabled: true, firstAfterDays: true, repeatEveryDays: true, maxReminders: true, staleAfterDays: true } as const;

/**
 * The club's active director and deputy grants with active, non-disabled accounts, read now. A person whose grant
 * ended or whose account is disabled or not yet verified is never emailed.
 */
async function loadReminderGrants(client: Client, organizationIds: readonly string[], now: Date) {
  const byClub = new Map<string, ReminderGrant[]>();
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
    select: { organizationId: true, role: true, effectiveFrom: true, effectiveTo: true, revokedAt: true, attendeeAccount: { select: { displayName: true, email: true } } },
  });
  for (const grant of grants) {
    if (!directorGrantIsActive(grant, now)) continue;
    const list = byClub.get(grant.organizationId) ?? [];
    list.push({ role: grant.role, email: grant.attendeeAccount.email, name: grant.attendeeAccount.displayName });
    byClub.set(grant.organizationId, list);
  }
  return byClub;
}

export async function sendDueClubDraftReminders(options: { now?: Date } = {}): Promise<ClubDraftReminderResult> {
  const now = options.now ?? new Date();
  const prisma = getPrisma();
  const result = empty();
  const baseUrl = getServerEnv().APP_BASE_URL;

  const policies = await prisma.clubDraftReminderPolicy.findMany({
    where: { enabled: true, event: { ...CLUB_EVENT_GATE } },
    select: { eventId: true, ...policySelect, event: { select: eventSelect } },
    orderBy: { eventId: "asc" },
    take: CLUB_DRAFT_REMINDER_EVENT_LIMIT,
  });

  const messageIds: string[] = [];
  let budget = CLUB_DRAFT_REMINDER_RUN_LIMIT;

  for (const row of policies) {
    if (budget <= 0) break;
    result.events += 1;
    const policy = policyFromRow(row);
    const event = row.event;
    try {
      // Only real email. A paused or locally captured event, or one with no sender set, queues nothing.
      const settings = await loadEventEmailSettings(prisma, event.id);
      if (!settings || settings.deliveryMode !== "EXTERNAL_EMAIL" || settings.deliveryReason !== "ON") {
        result.skippedEmailOff += 1;
        continue;
      }
      const registrationOpen = registrationIsOpen(event, now);
      if (!registrationOpen) continue;
      if (!isWithinSendHours(now, event.timezone)) {
        result.skippedQuietHours += 1;
        continue;
      }

      // Drafts that could be due: untouched for the first wait and not yet expired. The exact rule is applied below.
      const drafts = await prisma.clubRegistrationDraft.findMany({
        where: {
          eventId: event.id,
          updatedAt: { lte: new Date(now.getTime() - policy.firstAfterDays * DAY_MS), gt: new Date(now.getTime() - policy.staleAfterDays * DAY_MS) },
          organization: { isActive: true },
        },
        select: { id: true, organizationId: true, draftKey: true, updatedAt: true, organization: { select: { name: true } } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: DRAFT_READ_LIMIT,
      });
      if (drafts.length === 0) continue;
      const logs = await prisma.clubDraftReminderLog.findMany({
        where: { draftId: { in: drafts.map((draft) => draft.id) } },
        select: { draftId: true, attempt: true, sentAt: true },
      });
      const priorByDraft = new Map<string, Array<{ attempt: number; sentAt: Date }>>();
      for (const log of logs) priorByDraft.set(log.draftId, [...(priorByDraft.get(log.draftId) ?? []), { attempt: log.attempt, sentAt: log.sentAt }]);

      const due = drafts.flatMap((draft) => {
        const decision = nextReminderDue(draft, policy, priorByDraft.get(draft.id) ?? [], now, { registrationOpen });
        return decision.due ? [{ draft, attempt: decision.attempt }] : [];
      }).slice(0, budget);
      if (due.length === 0) continue;

      const grantsByClub = await loadReminderGrants(prisma, [...new Set(due.map((entry) => entry.draft.organizationId))], now);

      for (const entry of due) {
        const recipients = draftReminderRecipients(grantsByClub.get(entry.draft.organizationId) ?? []);
        if (recipients.length === 0) {
          result.noRecipient += 1;
          continue;
        }
        budget -= 1;
        try {
          const ids = await prisma.$transaction(async (tx) => {
            // Re-read inside the transaction: the switch may have been turned off, or the draft submitted, removed or
            // edited, since the reads above.
            const current = await tx.clubDraftReminderPolicy.findUnique({ where: { eventId: event.id }, select: policySelect });
            if (!current?.enabled) return [];
            const fresh = await tx.clubRegistrationDraft.findUnique({ where: { id: entry.draft.id }, select: { id: true, eventId: true, organizationId: true, updatedAt: true } });
            if (!fresh || fresh.eventId !== event.id) return [];
            const priorNow = await tx.clubDraftReminderLog.findMany({ where: { draftId: fresh.id }, select: { attempt: true, sentAt: true } });
            const decision = nextReminderDue(fresh, policyFromRow(current), priorNow, now, { registrationOpen });
            if (!decision.due || decision.attempt !== entry.attempt) return [];
            // The claim. A second run (or a concurrent one that lost the unique write) writes nothing and queues nothing.
            const correlationId = randomUUID();
            const claimed = await tx.clubDraftReminderLog.createMany({
              data: [{ eventId: event.id, organizationId: entry.draft.organizationId, draftId: fresh.id, draftKey: entry.draft.draftKey, attempt: entry.attempt, recipients: recipients.length, sentAt: now, correlationId }],
              skipDuplicates: true,
            });
            if (claimed.count === 0) return [];
            const created: string[] = [];
            for (const recipient of recipients) {
              const content = draftReminderEmail({
                directorName: recipient.name,
                clubName: entry.draft.organization.name,
                eventName: event.name,
                registrationClosesOn: event.registrationClosesOn,
                registrationUrl: draftReminderUrl(baseUrl, entry.draft.organizationId, event.id),
              });
              const message = await tx.messageOutbox.create({
                data: {
                  eventId: event.id,
                  templateKey: CLUB_DRAFT_REMINDER_TEMPLATE_KEY,
                  recipientKind: "CLUB_DIRECTOR",
                  recipientEmail: recipient.email,
                  recipientName: recipient.name.trim() || null,
                  senderNameSnapshot: settings.senderName,
                  senderEmailSnapshot: settings.senderEmail,
                  replyToEmailSnapshot: settings.replyToEmail,
                  subjectSnapshot: content.subject,
                  bodyTextSnapshot: content.bodyText,
                  metadata: {
                    trigger: CLUB_DRAFT_REMINDER_TEMPLATE_KEY,
                    draftId: fresh.id,
                    organizationId: entry.draft.organizationId,
                    attempt: entry.attempt,
                    deliveryMode: settings.deliveryMode,
                    realDelivery: true,
                  },
                  idempotencyKey: draftReminderIdempotencyKey(fresh.id, entry.attempt, recipient.email),
                  correlationId,
                  status: "PENDING",
                },
                select: { id: true },
              });
              created.push(message.id);
            }
            await writeAuditLog({
              eventId: event.id,
              action: "CLUB_DRAFT_REMINDER_QUEUED",
              entityType: "ClubRegistrationDraft",
              entityId: fresh.id,
              correlationId,
              summary: `Queued reminder ${entry.attempt} for an unsubmitted club registration to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}.`,
              metadata: { eventId: event.id, organizationId: entry.draft.organizationId, draftId: fresh.id, attempt: entry.attempt, recipients: recipients.length },
            }, tx);
            return created;
          }, { timeout: 30_000, maxWait: 10_000 });
          if (ids.length > 0) {
            result.reminded += 1;
            messageIds.push(...ids);
          }
        } catch (error) {
          result.failed += 1;
          logError("A club registration reminder could not be queued", error, { eventId: event.id, organizationId: entry.draft.organizationId });
        }
      }
    } catch (error) {
      result.failed += 1;
      logError("The club registration reminders for an event could not be prepared", error, { eventId: event.id });
    }
  }

  if (messageIds.length > 0) {
    try {
      const delivery = await processQueuedMessageIdsAfterCommit(messageIds);
      result.delivered = delivery.sentIds.length;
    } catch (error) {
      // What does not go now stays queued for the scheduled sweep.
      logError("Club registration reminders were queued but could not be delivered immediately", error);
    }
  }
  return result;
}

// --- The re-check at delivery -------------------------------------------------------------------------------------

function metadataFields(metadata: unknown) {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return {
    draftId: typeof record.draftId === "string" ? record.draftId : null,
    organizationId: typeof record.organizationId === "string" ? record.organizationId : null,
  };
}

/**
 * Whether a queued reminder is no longer wanted, read as it is now: the event's reminders are off or missing, the draft
 * was submitted or removed (its id is gone) or has expired, registration has closed, or the recipient is no longer an
 * active director or deputy of that club with an active account (a changed contact). Returns the note to record, or
 * `null` when the reminder may go. A failed read throws; the delivery worker then retries instead of sending on a guess.
 */
export async function clubDraftReminderObsoleteReason(
  message: { eventId: string | null; recipientEmail: string; metadata: unknown },
  now: Date,
  client: Client = getPrisma(),
): Promise<string | null> {
  const { draftId, organizationId } = metadataFields(message.metadata);
  if (!message.eventId || !draftId || !organizationId) return CLUB_DRAFT_REMINDER_OBSOLETE_NOTE;
  const [policy, draft] = await Promise.all([
    client.clubDraftReminderPolicy.findUnique({ where: { eventId: message.eventId }, select: policySelect }),
    client.clubRegistrationDraft.findUnique({ where: { id: draftId }, select: { eventId: true, organizationId: true, updatedAt: true, event: { select: eventSelect } } }),
  ]);
  if (!policy?.enabled || !draft) return CLUB_DRAFT_REMINDER_OBSOLETE_NOTE;
  if (draft.eventId !== message.eventId || draft.organizationId !== organizationId) return CLUB_DRAFT_REMINDER_OBSOLETE_NOTE;
  if (draftIsStale(draft, policyFromRow(policy).staleAfterDays, now)) return CLUB_DRAFT_REMINDER_OBSOLETE_NOTE;
  if (!registrationIsOpen(draft.event, now)) return CLUB_DRAFT_REMINDER_OBSOLETE_NOTE;
  const grants = await loadReminderGrants(client, [organizationId], now);
  const recipient = message.recipientEmail.trim().toLowerCase();
  if (!draftReminderRecipients(grants.get(organizationId) ?? []).some((person) => person.email === recipient)) return CLUB_DRAFT_REMINDER_OBSOLETE_NOTE;
  return null;
}

// --- The staff view -----------------------------------------------------------------------------------------------

/** The settings and a counts-only preview for staff. Never reads or returns an answer, a name or an address. */
export async function getClubDraftReminderOverview(eventId: string, now = new Date()): Promise<ClubDraftReminderOverview> {
  const prisma = getPrisma();
  const [row, event, settings, draftRows, grouped] = await Promise.all([
    prisma.clubDraftReminderPolicy.findUnique({ where: { eventId }, select: policySelect }),
    prisma.event.findUnique({ where: { id: eventId }, select: eventSelect }),
    loadEventEmailSettings(prisma, eventId),
    prisma.clubRegistrationDraft.findMany({ where: { eventId, organization: { isActive: true } }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 2000 }),
    prisma.messageOutbox.groupBy({ by: ["status"], where: { eventId, templateKey: CLUB_DRAFT_REMINDER_TEMPLATE_KEY }, _count: { _all: true } }),
  ]);
  const policy = policyFromRow(row);
  const registrationOpen = event ? registrationIsOpen(event, now) : false;
  const logs = draftRows.length === 0 ? [] : await prisma.clubDraftReminderLog.findMany({ where: { draftId: { in: draftRows.map((draft) => draft.id) } }, select: { draftId: true, attempt: true, sentAt: true } });
  const priorByDraft = new Map<string, Array<{ attempt: number; sentAt: Date }>>();
  for (const log of logs) priorByDraft.set(log.draftId, [...(priorByDraft.get(log.draftId) ?? []), { attempt: log.attempt, sentAt: log.sentAt }]);
  // Previewed as if switched on, so staff see what turning it on would do; the page says whether it is on.
  const forecast = forecastReminders(
    draftRows.map((draft) => ({ updatedAt: draft.updatedAt, prior: priorByDraft.get(draft.id) ?? [] })),
    { ...policy, enabled: true },
    now,
    { registrationOpen },
  );
  const count = (...statuses: string[]) => grouped.filter((entry) => statuses.includes(entry.status)).reduce((sum, entry) => sum + entry._count._all, 0);
  return {
    policy,
    emailOn: settings?.deliveryMode === "EXTERNAL_EMAIL" && settings.deliveryReason === "ON",
    registrationOpen,
    drafts: draftRows.length,
    dueNow: forecast.dueNow,
    upcoming: forecast.upcoming.map((date) => date.toISOString()),
    counts: {
      queued: count("PENDING", "PROCESSING"),
      sent: count("SENT", "CAPTURED"),
      failed: count("FAILED"),
      suppressed: count("SUPPRESSED"),
      cancelled: count("CANCELLED"),
    },
    limits: {
      firstAfterDays: [1, 14],
      repeatEveryDays: [1, 14],
      maxReminders: [1, 3],
      staleAfterDays: [7, 90],
    },
  };
}

/**
 * Saves the event's policy. The caller has checked MANAGE_COMMUNICATIONS for this event. The change and its audit entry
 * are written together; nothing is written when nothing changed. The audit entry holds the old and new values (numbers
 * and the switch only).
 */
export async function saveClubDraftReminderPolicy(eventId: string, actorUserId: string, input: unknown) {
  const next = clubDraftReminderPolicySchema.parse(input);
  return getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) return { changed: false as const, found: false as const, policy: policyFromRow(null) };
    const existing = await tx.clubDraftReminderPolicy.findUnique({ where: { eventId }, select: policySelect });
    const before = policyFromRow(existing);
    const same = existing !== null && (Object.keys(next) as Array<keyof ClubDraftReminderPolicyValues>).every((key) => before[key] === next[key]);
    if (same) return { changed: false as const, found: true as const, policy: before };
    await tx.clubDraftReminderPolicy.upsert({
      where: { eventId },
      update: { ...next, updatedByUserId: actorUserId },
      create: { eventId, ...next, updatedByUserId: actorUserId },
    });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: next.enabled === before.enabled ? "CLUB_DRAFT_REMINDER_POLICY_CHANGED" : next.enabled ? "CLUB_DRAFT_REMINDER_TURNED_ON" : "CLUB_DRAFT_REMINDER_TURNED_OFF",
      entityType: "ClubDraftReminderPolicy",
      entityId: eventId,
      summary: `${next.enabled ? "Reminders for unfinished club registrations are on" : "Reminders for unfinished club registrations are off"} for this event.`,
      metadata: { eventId, before: existing ? before : null, after: next },
    }, tx);
    return { changed: true as const, found: true as const, policy: next };
  });
}
