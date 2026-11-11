import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { paginate } from "@/lib/pagination";
import { formatPersonName } from "@/lib/person-name";
import { CONFERENCE_TIME_ZONE } from "@/modules/calendar/conference-format";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubComplianceState } from "@/modules/background-checks/domain";
import { BackgroundCheckOperationError } from "@/modules/background-checks/errors";
import {
  FOLLOW_UP_PAGE_SIZE,
  REMINDER_MAX_PEOPLE,
  REMINDER_RECENT_DAYS,
  filterRows,
  isReminderState,
  planSterlingReminders,
  reminderCounts,
  reminderStatusText,
  sortFollowUpRows,
  type ReminderDirector,
  type ReminderFilter,
  type ReminderPerson,
  type ReminderPlan,
  type ReminderSortKey,
  type SterlingActionRow,
} from "@/modules/background-checks/reminders-domain";
import {
  personCheckEvidenceSelect,
  rosterMemberCheckEvidenceSelect,
  uncachedChecksForRosterMembers,
} from "@/modules/background-checks/repository";
import { EMAIL_DELIVERY_BATCH_SIZE } from "@/modules/communications/delivery-timing";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { clubRosterAttendeeTypeLabels, clubYearFor } from "@/modules/club-rosters/domain";
import { directorGrantIsActive } from "@/modules/organizations/director-grants-domain";

/**
 * Sterling Volunteers reminders (#1844): the staff list of people who need action, the preview of exactly what would
 * be sent, and the Send itself. Nothing here sends on its own. A Send is one staff request made after a preview, and
 * it is refused when what would go out differs from what staff saw.
 *
 * Reminders go to the volunteer's club director(s), since most volunteers have no account, and also to the volunteer
 * when an address is on file. Check dates, roster notes and the uncached-lookup evidence stay inside this file: the
 * list carries a state and (for a Sterling date) an expiry, and the emails carry neither.
 */


export type ReminderSelection = { rosterMemberIds: string[] } | { filter: ReminderFilter; all: true };

type NowOption = { now?: Date };

/** Every active adult or staff member of this club year, one row each, with their current state. */
async function loadRows(now: Date): Promise<Array<SterlingActionRow & { ownEmail: string | null }>> {
  const prisma = getPrisma();
  const today = calendarDateInEventTimeZone(now, CONFERENCE_TIME_ZONE);
  const clubYear = clubYearFor(now);
  const members = await prisma.clubRosterMember.findMany({
    where: {
      clubYear,
      status: "ACTIVE",
      attendeeType: { in: ["ADULT", "STAFF"] },
      personId: { not: null },
      organization: { isActive: true },
    },
    select: {
      id: true,
      organizationId: true,
      personId: true,
      role: true,
      attendeeType: true,
      ...rosterMemberCheckEvidenceSelect,
      person: {
        select: {
          firstName: true,
          lastName: true,
          ...personCheckEvidenceSelect,
          backgroundCheckMatch: { select: { entry: { select: { complianceStatus: true, expiresOn: true } } } },
        },
      },
    },
  });
  // Staff-only evidence for the read-time match stays in this function; only the resulting check is used below.
  const uncached = await uncachedChecksForRosterMembers(members, prisma);
  const reminders = await prisma.backgroundCheckReminder.findMany({
    where: { clubYear },
    select: { personId: true, organizationId: true, sentAt: true },
  });
  const lastReminded = new Map<string, Date>();
  for (const reminder of reminders) {
    const key = `${reminder.personId}:${reminder.organizationId}`;
    const known = lastReminded.get(key);
    if (!known || reminder.sentAt > known) lastReminded.set(key, reminder.sentAt);
  }
  const rows: Array<SterlingActionRow & { ownEmail: string | null }> = [];
  for (const member of members) {
    if (!member.personId || !member.person) continue;
    const check = member.person.backgroundCheckMatch?.entry ?? uncached.get(member.personId) ?? null;
    const state = clubComplianceState(check, today);
    const ownEmail = member.person.normalizedEmail?.trim() || member.person.attendeeAccountLinks?.[0]?.account.email.trim() || null;
    const last = lastReminded.get(`${member.personId}:${member.organizationId}`);
    rows.push({
      rosterMemberId: member.id,
      personId: member.personId,
      firstName: member.person.firstName,
      lastName: member.person.lastName,
      name: formatPersonName(member.person),
      organizationId: member.organizationId,
      clubName: member.organization?.name ?? "",
      role: member.role.trim() || clubRosterAttendeeTypeLabels[member.attendeeType],
      state,
      statusText: reminderStatusText(state),
      // Only a Sterling date; a roster export's mark has no date to show.
      expiresOn: !check?.complianceStatus && check?.expiresOn ? check.expiresOn : null,
      lastRemindedAt: last ? last.toISOString() : null,
      hasOwnEmail: Boolean(ownEmail),
      personHref: `/admin/organizations/${encodeURIComponent(member.organizationId)}/club#member-${encodeURIComponent(member.id)}`,
      ownEmail,
    });
  }
  return rows;
}

/** The list rows without the address: the address is never sent to the page. */
function publicRow(row: SterlingActionRow & { ownEmail: string | null }): SterlingActionRow {
  const { ownEmail, ...rest } = row;
  void ownEmail;
  return rest;
}

/**
 * The "People to follow up" list: filtered, ordered and paged here, with the count behind each quick filter. `page` is
 * 1-based. The order never changes which people are listed.
 */
export async function listSterlingActionPeople(input: {
  filter: ReminderFilter;
  sort: ReminderSortKey;
  dir: "asc" | "desc";
  page: number;
} & NowOption) {
  const rows = await loadRows(input.now ?? new Date());
  const counts = reminderCounts(rows);
  const matching = sortFollowUpRows(filterRows(rows, input.filter).map(publicRow), input.sort, input.dir);
  const slice = paginate(matching, input.page, FOLLOW_UP_PAGE_SIZE);
  return { filter: input.filter, counts, ...slice, pageSize: FOLLOW_UP_PAGE_SIZE };
}

export type { SterlingActionRow };

// --- Preview and send -------------------------------------------------------------------------------------------

type PrismaReader = Pick<ReturnType<typeof getPrisma>, "backgroundCheckReminder">;

async function directorsByClub(organizationIds: string[], now: Date) {
  const grants = organizationIds.length === 0
    ? []
    : await getPrisma().clubDirectorGrant.findMany({
      where: {
        organizationId: { in: organizationIds },
        role: "DIRECTOR",
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { organizationId: true, role: true, effectiveFrom: true, effectiveTo: true, revokedAt: true, attendeeAccount: { select: { displayName: true, email: true } } },
    });
  const map = new Map<string, ReminderDirector[]>();
  for (const grant of grants) {
    if (!directorGrantIsActive(grant, now)) continue;
    const list = map.get(grant.organizationId) ?? [];
    list.push({ email: grant.attendeeAccount.email, name: grant.attendeeAccount.displayName });
    map.set(grant.organizationId, list);
  }
  return map;
}

export type RecentReminder = { rosterMemberId: string; name: string; clubName: string; remindedAt: string };

/** People in the plan who were reminded about this club within `REMINDER_RECENT_DAYS`. */
async function recentReminders(client: PrismaReader, people: ReadonlyArray<{ rosterMemberId: string; personId: string; organizationId: string; name: string; clubName: string }>, now: Date): Promise<RecentReminder[]> {
  if (people.length === 0) return [];
  const since = new Date(now.getTime() - REMINDER_RECENT_DAYS * 24 * 60 * 60 * 1000);
  const found = await client.backgroundCheckReminder.findMany({
    where: { personId: { in: people.map((person) => person.personId) }, sentAt: { gte: since } },
    select: { personId: true, organizationId: true, sentAt: true },
  });
  const latest = new Map<string, Date>();
  for (const reminder of found) {
    const key = `${reminder.personId}:${reminder.organizationId}`;
    const known = latest.get(key);
    if (!known || reminder.sentAt > known) latest.set(key, reminder.sentAt);
  }
  const recent: RecentReminder[] = [];
  for (const person of people) {
    const when = latest.get(`${person.personId}:${person.organizationId}`);
    if (when) recent.push({ rosterMemberId: person.rosterMemberId, name: person.name, clubName: person.clubName, remindedAt: when.toISOString() });
  }
  return recent.sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.rosterMemberId.localeCompare(b.rosterMemberId));
}

function clubUrlFor(organizationId: string) {
  return new URL(`/account/clubs/${encodeURIComponent(organizationId)}`, getServerEnv().APP_BASE_URL).toString();
}

function fingerprintOf(plan: ReminderPlan) {
  const material = {
    messages: plan.messages.map((message) => [message.key, message.to.email, message.subject, message.bodyText, message.rosterMemberIds]),
    outcomes: [...plan.outcomes].sort((a, b) => a.rosterMemberId.localeCompare(b.rosterMemberId)).map((outcome) => [outcome.rosterMemberId, outcome.state, outcome.directorRecipients, outcome.volunteerEmailed]),
    noRecipient: plan.noRecipient.map((person) => person.rosterMemberId).sort(),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

/** Recomputed from the server every time: only people who are expiring or not current today are ever included. */
async function buildPlan(selection: ReminderSelection, now: Date) {
  if ("rosterMemberIds" in selection && selection.rosterMemberIds.length > REMINDER_MAX_PEOPLE) {
    throw new BackgroundCheckOperationError("TOO_MANY_PEOPLE", `Choose at most ${REMINDER_MAX_PEOPLE} people for one reminder.`);
  }
  const rows = await loadRows(now);
  const wanted = "rosterMemberIds" in selection ? new Set(selection.rosterMemberIds) : null;
  const chosen = rows.filter((row) => isReminderState(row.state)
    && (wanted ? wanted.has(row.rosterMemberId) : filterRows([row], (selection as { filter: ReminderFilter }).filter).length === 1));
  if (chosen.length > REMINDER_MAX_PEOPLE) {
    throw new BackgroundCheckOperationError("TOO_MANY_PEOPLE", `That is ${chosen.length} people. Choose at most ${REMINDER_MAX_PEOPLE} for one reminder.`);
  }
  const people: ReminderPerson[] = chosen.map((row) => ({
    rosterMemberId: row.rosterMemberId,
    personId: row.personId,
    name: row.name,
    organizationId: row.organizationId,
    clubName: row.clubName,
    state: row.state as ReminderPerson["state"],
    ownEmail: row.ownEmail,
  }));
  const directors = await directorsByClub([...new Set(people.map((person) => person.organizationId))], now);
  const plan = planSterlingReminders({ people, directorsByClub: directors, clubUrl: clubUrlFor });
  const sendable = people.filter((person) => plan.outcomes.some((outcome) => outcome.rosterMemberId === person.rosterMemberId && (outcome.directorRecipients > 0 || outcome.volunteerEmailed)));
  const recent = await recentReminders(getPrisma(), sendable, now);
  return { plan, people, sendable, recent, fingerprint: fingerprintOf(plan) };
}

/**
 * What a Send would do right now, for staff to read first: who gets which message (exactly as it will be sent), who
 * has nobody to tell, and who was reminded in the last week. Writes nothing.
 */
export async function previewSterlingReminders(selection: ReminderSelection, options: NowOption = {}) {
  const { plan, people, recent, fingerprint } = await buildPlan(selection, options.now ?? new Date());
  const nameOf = new Map(people.map((person) => [person.rosterMemberId, person]));
  return {
    fingerprint,
    selected: people.length,
    directorOnly: plan.directorOnly,
    recipients: plan.messages.map((message) => ({
      key: message.key,
      name: message.to.name,
      email: message.to.email,
      label: message.recipientLabel,
    })),
    messages: plan.messages.map((message) => ({
      key: message.key,
      to: message.to,
      label: message.recipientLabel,
      about: message.rosterMemberIds.map((id) => nameOf.get(id)?.name ?? "").filter(Boolean),
      subject: message.subject,
      bodyText: message.bodyText,
    })),
    noRecipient: plan.noRecipient.map((person) => ({ rosterMemberId: person.rosterMemberId, name: person.name, clubName: person.clubName })),
    recentlyReminded: recent,
  };
}

export type SendSterlingRemindersResult = {
  batchId: string;
  people: number;
  directorEmails: number;
  volunteerEmails: number;
  noRecipient: number;
};

/**
 * Sends what the preview showed. Refused, with nothing written, when the account email is not set up, when the plan
 * no longer matches the preview (`PREVIEW_CHANGED`), or when someone in it was reminded within the last week and the
 * actor has not confirmed (`RECENTLY_REMINDED`, checked again inside the transaction so two quick presses cannot both
 * pass). One transaction writes the outbox rows, one log row per person reminded and one audit row; delivery is then
 * attempted straight away, and anything that does not go at once is picked up by the scheduled sweep.
 */
export async function sendSterlingReminders(
  selection: ReminderSelection,
  options: { fingerprint: string; confirmRecent?: boolean; actorUserId: string } & NowOption,
): Promise<SendSterlingRemindersResult> {
  if (!isAccountEmailConfigured()) {
    throw new BackgroundCheckOperationError("REMINDER_EMAIL_NOT_CONFIGURED", "Email sending isn't set up on this site, so nothing was sent.");
  }
  const now = options.now ?? new Date();
  const { plan, sendable, fingerprint } = await buildPlan(selection, now);
  if (fingerprint !== options.fingerprint) {
    throw new BackgroundCheckOperationError("PREVIEW_CHANGED", "The people or the messages changed since you opened the preview. Review it again, then send.");
  }
  if (plan.messages.length === 0) {
    throw new BackgroundCheckOperationError("NOTHING_TO_SEND", "There is nobody to send these reminders to.");
  }
  const sender = getAccountEmailSender();
  const batchId = randomUUID();
  const clubYear = clubYearFor(now);

  const messageIds = await getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"sterling-reminders"}, 0))`;
    const recent = await recentReminders(tx, sendable, now);
    if (recent.length > 0 && !options.confirmRecent) {
      throw new BackgroundCheckOperationError("RECENTLY_REMINDED", `${recent.length} ${recent.length === 1 ? "person was" : "people were"} reminded in the last ${REMINDER_RECENT_DAYS} days. Confirm to send again.`, { recentlyReminded: recent });
    }
    const correlationId = randomUUID();
    const ids: string[] = [];
    for (const message of plan.messages) {
      const created = await tx.messageOutbox.create({
        data: {
          eventId: null,
          templateKey: "STERLING_REMINDER",
          recipientKind: "ACCOUNT",
          recipientEmail: message.to.email,
          recipientName: message.to.name.trim() || null,
          senderNameSnapshot: sender.name,
          senderEmailSnapshot: sender.address,
          replyToEmailSnapshot: sender.replyTo,
          subjectSnapshot: message.subject,
          bodyTextSnapshot: message.bodyText,
          metadata: { trigger: "STERLING_REMINDER", accountEmail: true, realDelivery: true, sterlingReminderBatchId: batchId },
          idempotencyKey: `sterling-reminder:${batchId}:${message.key}`,
          correlationId,
          status: "PENDING",
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    await tx.backgroundCheckReminder.createMany({
      data: plan.outcomes
        .filter((outcome) => outcome.directorRecipients > 0 || outcome.volunteerEmailed)
        .map((outcome) => ({
          personId: outcome.personId,
          organizationId: outcome.organizationId,
          clubYear,
          state: outcome.state,
          sentByUserId: options.actorUserId,
          sentAt: now,
          directorRecipients: outcome.directorRecipients,
          volunteerEmailed: outcome.volunteerEmailed,
          batchId,
        })),
    });
    const directorEmails = plan.messages.filter((message) => message.kind === "DIRECTOR").length;
    const volunteerEmails = plan.messages.length - directorEmails;
    await writeAuditLog({
      actorUserId: options.actorUserId,
      action: "BACKGROUND_CHECK_REMINDERS_SENT",
      entityType: "BackgroundCheckReminderBatch",
      entityId: batchId,
      summary: `Sent Sterling Volunteers reminders about ${sendable.length} ${sendable.length === 1 ? "person" : "people"}.`,
      metadata: { batchId, people: sendable.length, directorEmails, volunteerEmails, noRecipient: plan.noRecipient.length },
    }, tx);
    return ids;
  }, { timeout: 60_000, maxWait: 10_000 });

  // Best effort, like other account email: what does not go now stays queued for the scheduled sweep.
  try {
    await processAccountEmailQueue({ messageIds, limit: Math.min(messageIds.length, EMAIL_DELIVERY_BATCH_SIZE) });
  } catch (error) {
    logError("Sterling reminders were queued but could not be delivered immediately.", error, { batchId });
  }

  const directorEmails = plan.messages.filter((message) => message.kind === "DIRECTOR").length;
  return {
    batchId,
    people: sendable.length,
    directorEmails,
    volunteerEmails: plan.messages.length - directorEmails,
    noRecipient: plan.noRecipient.length,
  };
}
