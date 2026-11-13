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
  CLUB_DRAFT_REMINDER_LIMITS,
  clubDraftReminderPolicySchema,
  draftIsStale,
  draftReminderEmail,
  draftReminderIdempotencyKey,
  draftRegistrationWindow,
  nextSendWindowStart,
  draftReminderRecipients,
  draftReminderUrl,
  forecastReminders,
  isWithinSendHours,
  nextReminderDue,
  policyFromRow,
  sendHoursLabel,
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
  startsAt: true,
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

/** The event's active locations, with their own dates: what the club's page decides a draft's registration window from. */
async function loadActiveLocations(client: Client, eventId: string) {
  return client.eventLocation.findMany({
    where: { eventId, isActive: true },
    select: { id: true, firstDay: true, lastDay: true, registrationClosesOn: true },
  });
}

type DueDraft = { id: string; organizationId: string; draftKey: string; updatedAt: Date; locationId: string | null; clubName: string; attempt: number; closesOn: string | null };

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
      if (!isWithinSendHours(now, event.timezone)) {
        result.skippedQuietHours += 1;
        continue;
      }

      // Drafts that could be due: untouched for the first wait and not yet expired. The exact rule is applied below.
      const [drafts, locations] = await Promise.all([
        prisma.clubRegistrationDraft.findMany({
          where: {
            eventId: event.id,
            updatedAt: { lte: new Date(now.getTime() - policy.firstAfterDays * DAY_MS), gt: new Date(now.getTime() - policy.staleAfterDays * DAY_MS) },
            organization: { isActive: true },
          },
          select: { id: true, organizationId: true, draftKey: true, updatedAt: true, locationId: true, organization: { select: { name: true } } },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: DRAFT_READ_LIMIT,
        }),
        loadActiveLocations(prisma, event.id),
      ]);
      if (drafts.length === 0) continue;
      const logs = await prisma.clubDraftReminderLog.findMany({
        where: { draftId: { in: drafts.map((draft) => draft.id) } },
        select: { draftId: true, attempt: true, sentAt: true },
      });
      const priorByDraft = new Map<string, Array<{ attempt: number; sentAt: Date }>>();
      for (const log of logs) priorByDraft.set(log.draftId, [...(priorByDraft.get(log.draftId) ?? []), { attempt: log.attempt, sentAt: log.sentAt }]);

      // One group per club: a club with several team drafts gets one email per person, not one per draft.
      const groups = new Map<string, DueDraft[]>();
      for (const draft of drafts) {
        const window = draftRegistrationWindow(event, locations, draft.locationId, now);
        const decision = nextReminderDue(draft, policy, priorByDraft.get(draft.id) ?? [], now, { registrationOpen: window.open });
        if (!decision.due) continue;
        const list = groups.get(draft.organizationId) ?? [];
        list.push({ id: draft.id, organizationId: draft.organizationId, draftKey: draft.draftKey, updatedAt: draft.updatedAt, locationId: draft.locationId, clubName: draft.organization.name, attempt: decision.attempt, closesOn: window.closesOn });
        groups.set(draft.organizationId, list);
      }
      if (groups.size === 0) continue;

      const grantsByClub = await loadReminderGrants(prisma, [...groups.keys()], now);

      for (const [organizationId, group] of groups) {
        if (budget <= 0) break;
        const recipients = draftReminderRecipients(grantsByClub.get(organizationId) ?? []);
        if (recipients.length === 0) {
          result.noRecipient += group.length;
          continue;
        }
        budget -= 1;
        try {
          const ids = await prisma.$transaction(async (tx) => {
            // Re-read inside the transaction: the switch may have been turned off, or a draft submitted, removed or
            // edited, since the reads above. Only the drafts still due are claimed.
            const current = await tx.clubDraftReminderPolicy.findUnique({ where: { eventId: event.id }, select: policySelect });
            if (!current?.enabled) return [];
            const currentPolicy = policyFromRow(current);
            const stillDue: DueDraft[] = [];
            for (const entry of group) {
              const fresh = await tx.clubRegistrationDraft.findUnique({ where: { id: entry.id }, select: { id: true, eventId: true, organizationId: true, updatedAt: true, locationId: true } });
              if (!fresh || fresh.eventId !== event.id) continue;
              const priorNow = await tx.clubDraftReminderLog.findMany({ where: { draftId: fresh.id }, select: { attempt: true, sentAt: true } });
              const window = draftRegistrationWindow(event, locations, fresh.locationId, now);
              const decision = nextReminderDue(fresh, currentPolicy, priorNow, now, { registrationOpen: window.open });
              if (decision.due && decision.attempt === entry.attempt) stillDue.push({ ...entry, closesOn: window.closesOn });
            }
            // The claim, one row per draft and attempt. A second run (or a concurrent one that lost the unique write)
            // writes nothing and queues nothing for the drafts it lost.
            const correlationId = randomUUID();
            const claimedDrafts: DueDraft[] = [];
            for (const entry of stillDue) {
              const claimed = await tx.clubDraftReminderLog.createMany({
                data: [{ eventId: event.id, organizationId, draftId: entry.id, draftKey: entry.draftKey, attempt: entry.attempt, recipients: recipients.length, sentAt: now, correlationId }],
                skipDuplicates: true,
              });
              if (claimed.count === 1) claimedDrafts.push(entry);
            }
            if (claimedDrafts.length === 0) return [];
            const closeDates = claimedDrafts.map((entry) => entry.closesOn).filter((date): date is string => date !== null).sort();
            const created: string[] = [];
            for (const recipient of recipients) {
              const content = draftReminderEmail({
                directorName: recipient.name,
                clubName: claimedDrafts[0]!.clubName,
                eventName: event.name,
                registrationClosesOn: closeDates[0] ?? null,
                registrationUrl: draftReminderUrl(baseUrl, organizationId, event.id),
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
                    draftIds: claimedDrafts.map((entry) => entry.id),
                    organizationId,
                    attempts: claimedDrafts.map((entry) => entry.attempt),
                    deliveryMode: settings.deliveryMode,
                    realDelivery: true,
                  },
                  idempotencyKey: draftReminderIdempotencyKey(claimedDrafts, recipient.email),
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
              entityType: "Organization",
              entityId: organizationId,
              correlationId,
              summary: `Queued a reminder about ${claimedDrafts.length} unsubmitted club ${claimedDrafts.length === 1 ? "registration" : "registrations"} to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}.`,
              metadata: { eventId: event.id, organizationId, draftIds: claimedDrafts.map((entry) => entry.id), attempts: claimedDrafts.map((entry) => entry.attempt), recipients: recipients.length },
            }, tx);
            return created;
          }, { timeout: 30_000, maxWait: 10_000 });
          if (ids.length > 0) {
            result.reminded += 1;
            messageIds.push(...ids);
          }
        } catch (error) {
          result.failed += 1;
          logError("A club registration reminder could not be queued", error, { eventId: event.id, organizationId });
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
  const ids = Array.isArray(record.draftIds) ? record.draftIds.filter((id): id is string => typeof id === "string") : typeof record.draftId === "string" ? [record.draftId] : [];
  return { draftIds: ids, organizationId: typeof record.organizationId === "string" ? record.organizationId : null };
}

/** What delivery does with a queued reminder: go, wait for the send hours, or never go. */
export type DraftReminderCheck = null | { kind: "OBSOLETE"; note: string } | { kind: "WAIT"; until: Date; note: string };

export const CLUB_DRAFT_REMINDER_WAIT_NOTE = "Waiting for the morning: reminders go out between the send hours only.";

/**
 * Whether a queued reminder is still wanted, read as it is now. It is obsolete when the event no longer passes the
 * club event gate, the club is no longer active, reminders are off or missing, none of its drafts still qualifies (a
 * draft qualifies while it exists, is not expired and its registration window is open), or the recipient is no longer
 * an active director or deputy of that club with an active account. Outside the send hours a wanted reminder waits
 * until the next 9 a.m. where the event is held. A failed read throws; the delivery worker then retries instead of
 * sending on a guess.
 */
export async function clubDraftReminderCheck(
  message: { eventId: string | null; recipientEmail: string; metadata: unknown },
  now: Date,
  client: Client = getPrisma(),
): Promise<DraftReminderCheck> {
  const obsolete: DraftReminderCheck = { kind: "OBSOLETE", note: CLUB_DRAFT_REMINDER_OBSOLETE_NOTE };
  const { draftIds, organizationId } = metadataFields(message.metadata);
  if (!message.eventId || draftIds.length === 0 || !organizationId) return obsolete;
  const [policy, event, club, drafts, locations] = await Promise.all([
    client.clubDraftReminderPolicy.findUnique({ where: { eventId: message.eventId }, select: policySelect }),
    client.event.findFirst({ where: { id: message.eventId, ...CLUB_EVENT_GATE }, select: eventSelect }),
    client.organization.findFirst({ where: { id: organizationId, isActive: true }, select: { id: true } }),
    client.clubRegistrationDraft.findMany({ where: { id: { in: draftIds }, eventId: message.eventId, organizationId }, select: { updatedAt: true, locationId: true } }),
    loadActiveLocations(client, message.eventId),
  ]);
  if (!policy?.enabled || !event || !club) return obsolete;
  const staleAfterDays = policyFromRow(policy).staleAfterDays;
  const qualifies = drafts.some((draft) => !draftIsStale(draft, staleAfterDays, now) && draftRegistrationWindow(event, locations, draft.locationId, now).open);
  if (!qualifies) return obsolete;
  const grants = await loadReminderGrants(client, [organizationId], now);
  const recipient = message.recipientEmail.trim().toLowerCase();
  if (!draftReminderRecipients(grants.get(organizationId) ?? []).some((person) => person.email === recipient)) return obsolete;
  if (!isWithinSendHours(now, event.timezone)) return { kind: "WAIT", until: nextSendWindowStart(now, event.timezone), note: CLUB_DRAFT_REMINDER_WAIT_NOTE };
  return null;
}

// --- The staff view -----------------------------------------------------------------------------------------------

/**
 * The settings and a counts-only preview for staff, or `null` for an event that is not a club event (the sweep only
 * reminds events that pass `CLUB_EVENT_GATE`). Never reads or returns an answer, a name or an address.
 */
export async function getClubDraftReminderOverview(eventId: string, now = new Date()): Promise<ClubDraftReminderOverview | null> {
  const prisma = getPrisma();
  const event = await prisma.event.findFirst({ where: { id: eventId, ...CLUB_EVENT_GATE }, select: eventSelect });
  if (!event) return null;
  const [row, settings, draftRows, grouped, locations] = await Promise.all([
    prisma.clubDraftReminderPolicy.findUnique({ where: { eventId }, select: policySelect }),
    loadEventEmailSettings(prisma, eventId),
    prisma.clubRegistrationDraft.findMany({ where: { eventId, organization: { isActive: true } }, select: { id: true, updatedAt: true, locationId: true }, orderBy: { updatedAt: "desc" }, take: 2000 }),
    prisma.messageOutbox.groupBy({ by: ["status"], where: { eventId, templateKey: CLUB_DRAFT_REMINDER_TEMPLATE_KEY }, _count: { _all: true } }),
    loadActiveLocations(prisma, eventId),
  ]);
  const policy = policyFromRow(row);
  const registrationOpen = draftRegistrationWindow(event, locations, null, now).open;
  const logs = draftRows.length === 0 ? [] : await prisma.clubDraftReminderLog.findMany({ where: { draftId: { in: draftRows.map((draft) => draft.id) } }, select: { draftId: true, attempt: true, sentAt: true } });
  const priorByDraft = new Map<string, Array<{ attempt: number; sentAt: Date }>>();
  for (const log of logs) priorByDraft.set(log.draftId, [...(priorByDraft.get(log.draftId) ?? []), { attempt: log.attempt, sentAt: log.sentAt }]);
  // Previewed as if switched on, so staff see what turning it on would do; the page says whether it is on.
  const forecast = forecastReminders(
    draftRows.map((draft) => ({ updatedAt: draft.updatedAt, prior: priorByDraft.get(draft.id) ?? [], registrationOpen: draftRegistrationWindow(event, locations, draft.locationId, now).open })),
    { ...policy, enabled: true },
    now,
  );
  const count = (...statuses: string[]) => grouped.filter((entry) => statuses.includes(entry.status)).reduce((sum, entry) => sum + entry._count._all, 0);
  const range = (key: keyof typeof CLUB_DRAFT_REMINDER_LIMITS): [number, number] => [CLUB_DRAFT_REMINDER_LIMITS[key].min, CLUB_DRAFT_REMINDER_LIMITS[key].max];
  return {
    policy,
    emailOn: settings?.deliveryMode === "EXTERNAL_EMAIL" && settings.deliveryReason === "ON",
    registrationOpen,
    sendHours: sendHoursLabel(event.timezone),
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
    limits: { firstAfterDays: range("firstAfterDays"), repeatEveryDays: range("repeatEveryDays"), maxReminders: range("maxReminders"), staleAfterDays: range("staleAfterDays") },
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
    if (!event) return { changed: false as const, found: false as const, eligible: false as const, policy: policyFromRow(null) };
    // Only a club event is ever reminded (the sweep's own gate), so nothing else gets a policy.
    if (!await tx.event.findFirst({ where: { id: eventId, ...CLUB_EVENT_GATE }, select: { id: true } })) {
      return { changed: false as const, found: true as const, eligible: false as const, policy: policyFromRow(null) };
    }
    const existing = await tx.clubDraftReminderPolicy.findUnique({ where: { eventId }, select: policySelect });
    const before = policyFromRow(existing);
    const same = existing !== null && (Object.keys(next) as Array<keyof ClubDraftReminderPolicyValues>).every((key) => before[key] === next[key]);
    if (same) return { changed: false as const, found: true as const, eligible: true as const, policy: before };
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
    return { changed: true as const, found: true as const, eligible: true as const, policy: next };
  });
}
