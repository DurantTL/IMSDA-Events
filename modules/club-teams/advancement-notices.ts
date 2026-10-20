import "server-only";

import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { ClubTeamError } from "@/modules/club-teams/errors";
import { levelInfoFromJson, teamLevelLabels, type TeamLevel } from "@/modules/club-teams/domain";
import {
  advancementNotice,
  advancementNoticeKey,
  levelInfoFor,
} from "@/modules/club-teams/results-domain";

/**
 * Director notices for teams that advanced (#945). One email per team and level, to the team's director, with the next
 * level's date and place from the event's `levelInfo`. This is a bulk communication, so nothing here ever runs on its own:
 * `sendAdvancementNotices` is called only from the staff "Send notices" action. Each notice has a deterministic outbox key
 * (team and level), so pressing the button again, or two people at once, never queues or sends one twice.
 */

const PREVIOUS: Record<TeamLevel, TeamLevel | null> = { AREA: null, CONFERENCE: "AREA", UNION: "CONFERENCE" };

export type NoticePreview = {
  level: TeamLevel;
  /** Teams that advanced to this level and have no notice yet, with a director email to send to. */
  toSend: number;
  /** Teams whose notice is already queued or sent: never sent again. */
  alreadyQueued: number;
  /** Teams with no director email on file. */
  noEmail: number;
  /** The date and place the notice will carry, or what is still missing. */
  date: string | null;
  place: string;
};

function contactOf(registration: {
  contactSnapshot: unknown;
  accountHolderPerson: { firstName: string; lastName: string; normalizedEmail: string | null };
}) {
  const contact = registration.contactSnapshot && typeof registration.contactSnapshot === "object" && !Array.isArray(registration.contactSnapshot)
    ? registration.contactSnapshot as Record<string, unknown> : {};
  const text = (key: string) => (typeof contact[key] === "string" ? (contact[key] as string).trim() : "");
  const email = (text("email") || registration.accountHolderPerson.normalizedEmail || "").trim().toLowerCase();
  const name = `${text("firstName") || registration.accountHolderPerson.firstName} ${text("lastName") || registration.accountHolderPerson.lastName}`.trim();
  return { email, name };
}

function noticeLevel(level: TeamLevel) {
  const from = PREVIOUS[level];
  if (!from) throw new ClubTeamError("RESULT_INVALID", "Teams start at the Area level, so there is no notice for it. Choose Conference or Union.");
  return from;
}

async function advancedTeams(tx: Pick<Prisma.TransactionClient, "clubEventRegistration">, eventId: string, toLevel: TeamLevel) {
  const from = noticeLevel(toLevel);
  const rows = await tx.clubEventRegistration.findMany({
    where: {
      eventId,
      registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } },
      // At the Union level a team must also have advanced from Area, as the Conference list shows.
      AND: [
        { teamResults: { some: { level: from, qualified: true } } },
        ...(from === "CONFERENCE" ? [{ teamResults: { some: { level: "AREA" as const, qualified: true } } }] : []),
      ],
    },
    orderBy: [{ organization: { name: "asc" } }, { teamKey: "asc" }],
    select: {
      id: true,
      organizationId: true,
      teamName: true,
      teamKey: true,
      organization: { select: { name: true } },
      registration: { select: { id: true, confirmationCode: true, contactSnapshot: true, accountHolderPerson: { select: { firstName: true, lastName: true, normalizedEmail: true } } } },
    },
  });
  return rows;
}

/** What "Send notices" will do, read only: how many are new, how many already went, and the date and place they carry. */
export async function previewAdvancementNotices(eventId: string, toLevel: TeamLevel): Promise<NoticePreview> {
  const prisma = getPrisma();
  const [teams, settings] = await Promise.all([
    advancedTeams(prisma, eventId, toLevel),
    prisma.eventTeamSettings.findUnique({ where: { eventId }, select: { levelInfo: true } }),
  ]);
  const existing = await prisma.messageOutbox.findMany({
    where: { eventId, idempotencyKey: { in: teams.map((team) => advancementNoticeKey(team.id, toLevel)) } },
    select: { idempotencyKey: true },
  });
  const queued = new Set(existing.map((row) => row.idempotencyKey));
  const info = levelInfoFor(levelInfoFromJson(settings?.levelInfo), toLevel);
  const preview: NoticePreview = { level: toLevel, toSend: 0, alreadyQueued: 0, noEmail: 0, date: info?.date ?? null, place: info?.place.trim() ?? "" };
  for (const team of teams) {
    if (queued.has(advancementNoticeKey(team.id, toLevel))) preview.alreadyQueued += 1;
    else if (!contactOf(team.registration).email) preview.noEmail += 1;
    else preview.toSend += 1;
  }
  return preview;
}

export type SendNoticesResult = NoticePreview & { queued: number; messageIds: string[] };

/**
 * Staff pressed "Send notices" (#945): queues one notice per team that advanced to the level and has none yet, through the
 * transactional outbox, then hands them to delivery after the transaction commits. A team whose notice is already queued is
 * skipped, so this is safe to press twice. A failure to deliver never undoes the queue: the row stays for the outbox sweep.
 */
export async function sendAdvancementNotices(eventId: string, toLevel: TeamLevel, actorUserId: string): Promise<SendNoticesResult> {
  const from = noticeLevel(toLevel);
  const result = await getPrisma().$transaction(async (tx) => {
    const [event, settings, messageSettings] = await Promise.all([
      tx.event.findUnique({ where: { id: eventId }, select: { name: true } }),
      tx.eventTeamSettings.findUnique({ where: { eventId }, select: { levelInfo: true } }),
      loadEventEmailSettings(tx, eventId),
    ]);
    if (!event || !settings) throw new ClubTeamError("RESULT_INVALID", "This event doesn't use team rules, so it has no team levels.");
    const delivery = messageSettings ?? { deliveryMode: "LOCAL_CAPTURE" as const, senderName: "IMSDA Events", senderEmail: null, replyToEmail: null };
    const info = levelInfoFor(levelInfoFromJson(settings.levelInfo), toLevel);
    const teams = await advancedTeams(tx, eventId, toLevel);
    const base = getServerEnv().APP_BASE_URL;
    const suppressed = delivery.deliveryMode === "DISABLED";
    const summary: SendNoticesResult = { level: toLevel, toSend: 0, alreadyQueued: 0, noEmail: 0, date: info?.date ?? null, place: info?.place.trim() ?? "", queued: 0, messageIds: [] };
    const queuedTeamIds: string[] = [];
    for (const team of teams) {
      const key = advancementNoticeKey(team.id, toLevel);
      if (await tx.messageOutbox.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) {
        summary.alreadyQueued += 1;
        continue;
      }
      const { email, name } = contactOf(team.registration);
      if (!email) {
        summary.noEmail += 1;
        continue;
      }
      const link = `${base}/account/clubs/${team.organizationId}/events/${eventId}${team.teamKey ? `?team=${encodeURIComponent(team.teamKey)}` : ""}`;
      const notice = advancementNotice({ eventName: event.name, directorName: name, clubName: team.organization.name, teamName: team.teamName, fromLevel: from, toLevel, info, link });
      const message = await tx.messageOutbox.upsert({
        where: { idempotencyKey: key },
        update: {},
        create: {
          eventId,
          registrationId: team.registration.id,
          templateKey: "CLUB_TEAM_ADVANCEMENT_NOTICE",
          recipientKind: "INTERNAL",
          recipientEmail: email,
          recipientName: name || null,
          senderNameSnapshot: delivery.senderName,
          senderEmailSnapshot: delivery.senderEmail,
          replyToEmailSnapshot: delivery.replyToEmail,
          subjectSnapshot: notice.subject,
          bodyTextSnapshot: notice.text,
          metadata: {
            trigger: "CLUB_TEAM_ADVANCEMENT_NOTICE",
            deliveryMode: delivery.deliveryMode,
            realDelivery: delivery.deliveryMode === "EXTERNAL_EMAIL",
            confirmationCode: team.registration.confirmationCode,
            clubEventRegistrationId: team.id,
            level: toLevel,
          },
          idempotencyKey: key,
          correlationId: randomUUID(),
          status: suppressed ? "SUPPRESSED" : "PENDING",
          lastError: suppressed ? "Delivery is disabled for this event." : null,
        },
        select: { id: true, status: true },
      });
      summary.toSend += 1;
      summary.queued += 1;
      queuedTeamIds.push(team.id);
      if (message.status === "PENDING") summary.messageIds.push(message.id);
    }
    if (summary.queued > 0) {
      await writeAuditLog({
        eventId, actorUserId, action: "CLUB_TEAM_ADVANCEMENT_NOTICES_SENT", entityType: "Event", entityId: eventId,
        summary: `Staff sent the ${teamLevelLabels[toLevel]} advancement notices to team directors.`,
        metadata: { level: toLevel, queued: summary.queued, alreadyQueued: summary.alreadyQueued, noEmail: summary.noEmail, clubEventRegistrationIds: queuedTeamIds, suppressed } as Prisma.InputJsonValue,
      }, tx);
    }
    return summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

  // Delivery runs after the commit and never undoes it; a failure leaves each message queued for the outbox sweep.
  if (result.messageIds.length > 0) {
    try {
      await processQueuedMessageIdsAfterCommit([...result.messageIds]);
    } catch (error) {
      logError("Team advancement notices could not be delivered right now; they stay queued.", error);
    }
  }
  return result;
}
