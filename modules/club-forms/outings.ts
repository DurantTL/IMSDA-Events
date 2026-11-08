import "server-only";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { formatPersonName } from "@/lib/person-name";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { clubFormEmailDelivery, viewerAuditFields, type ClubFormsViewer } from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import {
  OUTING_MAX_SEND,
  OUTING_TEMPLATE_KEY,
  outingDateLabel,
  outingDetailRows,
  outingLinkState,
  parseOutingInput,
  readStoredOuting,
  type OutingInput,
  type OutingLinkState,
  type OutingSendOutcome,
} from "@/modules/club-forms/outing-domain";
import { createClubFormLink, leaderOnly } from "@/modules/club-forms/links";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import type { ClubFormOutingRecipientLimit } from "@/modules/rate-limit/service";

/**
 * Outing permission slips (#1672): a club's director sets the details of one outing on the conference's Off-Premises
 * Permission Slip, adds up to five questions, sends each chosen family its own private link and watches who has
 * signed. The slip itself (its sections and wording) is the template's; an outing holds no answer. Every function
 * takes the resolved viewer and checks it again: only the club's director and deputy (or an administrator acting as
 * them) can reach an outing, and another club's outing is "not found".
 */

const OUTING_NOT_FOUND = () => new ClubFormError("OUTING_NOT_FOUND", "That outing could not be found.");

/** Whether the conference has switched the slip on. A director can't start an outing until it has. */
export async function getOutingSlipAvailability() {
  const template = await getPrisma().clubFormTemplate.findUnique({ where: { key: OUTING_TEMPLATE_KEY }, select: { enabled: true } });
  return { enabled: Boolean(template?.enabled) };
}

async function requireSlipOn(client = getPrisma()) {
  const template = await client.clubFormTemplate.findUnique({ where: { key: OUTING_TEMPLATE_KEY }, select: { id: true, enabled: true } });
  if (!template?.enabled) {
    throw new ClubFormError("SLIP_TEMPLATE_OFF", "The Off-Premises Permission Slip is not turned on yet. Ask a system administrator to turn it on, then try again.");
  }
  return template;
}

export async function createOuting(viewer: ClubFormsViewer, organizationId: string, rawInput: unknown, now = new Date()) {
  const leader = leaderOnly(viewer, organizationId);
  const input = parseOutingInput(rawInput);
  const prisma = getPrisma();
  const template = await requireSlipOn(prisma);
  const club = await prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true, isActive: true } });
  if (!club || club.type !== "CLUB" || !club.isActive) throw new ClubFormError("CLUB_NOT_FOUND", "That club could not be found.");
  return prisma.$transaction(async (tx) => {
    const outing = await tx.clubFormOuting.create({
      data: {
        organizationId,
        templateId: template.id,
        clubYear: clubYearFor(now),
        activity: input.details.activity,
        startDate: input.details.startDate,
        details: input.details,
        questions: input.questions,
      },
      select: { id: true },
    });
    const who = viewerAuditFields(leader);
    // Counts and ids only: no activity text and no question wording.
    await writeAuditLog({
      actorUserId: who.actorUserId,
      action: "CLUB_FORM_OUTING_CREATED",
      entityType: "ClubFormOuting",
      entityId: outing.id,
      summary: "Created an outing permission slip.",
      metadata: { ...who.metadata, organizationId, questionCount: input.questions.length },
    }, tx);
    return { outingId: outing.id };
  });
}

const outingSelect = {
  id: true, organizationId: true, clubYear: true, activity: true, startDate: true, details: true, questions: true, status: true, closedAt: true, createdAt: true,
  template: { select: { definition: true } },
} as const;

async function findOuting(organizationId: string, outingId: string) {
  const row = await getPrisma().clubFormOuting.findFirst({ where: { id: outingId, organizationId }, select: outingSelect });
  const parsed = row ? readStoredOuting(row) : null;
  if (!row || !parsed) throw OUTING_NOT_FOUND();
  return { row, outing: parsed };
}

/** One outing's details and questions, for the copy form: a past outing to start the next from. Dates are left for the director to enter. */
export async function getOutingForCopy(viewer: ClubFormsViewer, organizationId: string, outingId: string): Promise<OutingInput> {
  leaderOnly(viewer, organizationId);
  const { outing } = await findOuting(organizationId, outingId);
  return { ...outing, details: { ...outing.details, startDate: "", endDate: "" } };
}

export type OutingCounts = Record<OutingLinkState, number>;

/** Per member, the link that counts: a signed one, else the newest. */
function latestPerMember<T extends { rosterMemberId: string | null; status: "OPEN" | "USED" | "REVOKED"; createdAt: Date }>(links: T[]) {
  const byMember = new Map<string, T>();
  for (const link of links) {
    if (!link.rosterMemberId) continue;
    const held = byMember.get(link.rosterMemberId);
    if (!held || (held.status !== "USED" && (link.status === "USED" || link.createdAt > held.createdAt))) byMember.set(link.rosterMemberId, link);
  }
  return [...byMember.values()];
}

/** The club's outings, newest first, with how many families have signed, not yet, or have an expired link. */
export async function listOutings(viewer: ClubFormsViewer, organizationId: string, now = new Date()) {
  leaderOnly(viewer, organizationId);
  const rows = await getPrisma().clubFormOuting.findMany({
    where: { organizationId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { ...outingSelect, links: { select: { rosterMemberId: true, status: true, expiresAt: true, createdAt: true } } },
  });
  return rows.flatMap((row) => {
    const outing = readStoredOuting(row);
    if (!outing) return [];
    const counts: OutingCounts = { SIGNED: 0, NOT_YET: 0, EXPIRED: 0 };
    for (const link of latestPerMember(row.links)) counts[outingLinkState(link, now)] += 1;
    return [{
      id: row.id,
      activity: row.activity,
      startDate: row.startDate,
      dateLabel: outingDateLabel(outing.details),
      clubYear: row.clubYear,
      status: row.status,
      questionCount: outing.questions.length,
      counts,
    }];
  });
}

export type OutingListRow = Awaited<ReturnType<typeof listOutings>>[number];

/** The tracking page's data: the outing, who it was sent to and how each is doing. No answers, no email addresses. */
export async function getOutingTracking(viewer: ClubFormsViewer, organizationId: string, outingId: string, now = new Date()) {
  leaderOnly(viewer, organizationId);
  const { row, outing } = await findOuting(organizationId, outingId);
  const prisma = getPrisma();
  const links = await prisma.clubFormLink.findMany({
    where: { outingId: row.id, organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, messageId: true, rosterMemberId: true, status: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true,
      rosterMember: { select: { person: { select: { firstName: true, lastName: true } } } },
      submission: { select: { id: true } },
    },
  });
  const messageIds = links.flatMap((link) => (link.messageId ? [link.messageId] : []));
  const messages = messageIds.length === 0
    ? []
    : await prisma.messageOutbox.findMany({ where: { id: { in: messageIds } }, select: { id: true, status: true, providerDeliveryStatus: true } });
  const delivery = new Map(messages.map((message) => [message.id, clubFormEmailDelivery(message)]));
  const members = latestPerMember(links).map((link) => {
    const state = outingLinkState(link, now);
    return {
      memberId: link.rosterMemberId as string,
      name: link.rosterMember?.person ? formatPersonName(link.rosterMember.person) : "Removed from the roster",
      state,
      sentAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      /** A link the director or a close withdrew, or whose email failed: "Withdrawn", not "Expired". */
      withdrawnAt: link.status === "REVOKED" ? (link.revokedAt ?? link.createdAt).toISOString() : null,
      signedAt: link.usedAt?.toISOString() ?? null,
      submissionId: link.submission?.id ?? null,
      delivery: link.messageId ? delivery.get(link.messageId) ?? "UNKNOWN" : "UNKNOWN",
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  const counts: OutingCounts = { SIGNED: 0, NOT_YET: 0, EXPIRED: 0 };
  for (const member of members) counts[member.state] += 1;
  return {
    id: row.id,
    status: row.status,
    clubYear: row.clubYear,
    details: outing.details,
    /** The details as read-only rows, with the slip's own labels for activity, date and ride-with. */
    detailRows: outingDetailRows(outing.details, registrationFormDefinitionSchema.safeParse(row.template.definition).data ?? null),
    questions: outing.questions,
    members,
    counts,
  };
}

export type OutingTracking = Awaited<ReturnType<typeof getOutingTracking>>;

/** Closes an outing: no more sends, and every link still open stops working. Slips already signed stay. */
export async function closeOuting(viewer: ClubFormsViewer, organizationId: string, outingId: string, now = new Date()) {
  const leader = leaderOnly(viewer, organizationId);
  return getPrisma().$transaction(async (tx) => {
    const outing = await tx.clubFormOuting.findFirst({ where: { id: outingId, organizationId }, select: { id: true, status: true } });
    if (!outing) throw OUTING_NOT_FOUND();
    if (outing.status === "CLOSED") return { closedLinks: 0 };
    await tx.clubFormOuting.update({ where: { id: outing.id }, data: { status: "CLOSED", closedAt: now } });
    const closed = await tx.clubFormLink.updateMany({ where: { outingId: outing.id, status: "OPEN" }, data: { status: "REVOKED", revokedAt: now } });
    const who = viewerAuditFields(leader);
    await writeAuditLog({
      actorUserId: who.actorUserId,
      action: "CLUB_FORM_OUTING_CLOSED",
      entityType: "ClubFormOuting",
      entityId: outing.id,
      summary: "Closed an outing permission slip.",
      metadata: { ...who.metadata, organizationId, withdrawnLinks: closed.count },
    }, tx);
    return { closedLinks: closed.count };
  });
}

export const sendOutingSchema = z.object({
  memberIds: z.array(z.string().trim().min(1).max(80)).min(1, "Choose at least one member.").max(OUTING_MAX_SEND, `Choose ${OUTING_MAX_SEND} members or fewer at a time.`),
  /** Send again to a member who has a link already (a lost email or an expired link). */
  resend: z.boolean().default(false),
  expiresInDays: z.number().int("Links must last a whole number of days.").min(1, "Links must last 1 to 30 days.").max(30, "Links must last 1 to 30 days.").optional(),
}).strict();

export type OutingSendResult = { memberId: string; name: string; outcome: OutingSendOutcome };

const emailSchema = z.email().max(160);

const CHILD_TYPES = new Set(["YOUTH", "UNDERAGE"]);

/**
 * Sends each chosen member's parent their own private link, through the same link and email flow as any club form
 * link: one email to one family, never a list. The parent is the roster member's first guardian with an email on the
 * roster. A member who already signed is left alone; one with a live link is skipped unless this is a resend.
 * Outcomes name members, never an address. `allowRecipient` lets the route apply its per-recipient rate limit.
 */
export async function sendOuting(
  viewer: ClubFormsViewer,
  organizationId: string,
  outingId: string,
  rawInput: unknown,
  options: { allowRecipient?: (email: string, familySize: number) => Promise<ClubFormOutingRecipientLimit> } = {},
  now = new Date(),
) {
  leaderOnly(viewer, organizationId);
  const input = sendOutingSchema.parse(rawInput);
  const { row } = await findOuting(organizationId, outingId);
  if (row.status !== "OPEN") throw new ClubFormError("OUTING_CLOSED", "This outing is closed, so slips can't be sent for it.");
  const prisma = getPrisma();
  const memberIds = [...new Set(input.memberIds)];
  const members = await prisma.clubRosterMember.findMany({
    where: { id: { in: memberIds }, organizationId, status: "ACTIVE", clubYear: row.clubYear },
    select: {
      id: true,
      attendeeType: true,
      person: { select: { firstName: true, lastName: true } },
      guardians: { orderBy: { position: "asc" }, select: { email: true } },
    },
  });
  const known = new Map(members.map((member) => [member.id, member]));
  const existing = await prisma.clubFormLink.findMany({
    where: { outingId: row.id, rosterMemberId: { in: memberIds } },
    select: { id: true, rosterMemberId: true, status: true, expiresAt: true },
  });
  const messageIds: string[] = [];
  const results: OutingSendResult[] = [];
  const pending: Array<{ memberId: string; name: string; email: string }> = [];
  for (const memberId of memberIds) {
    const member = known.get(memberId);
    if (!member) {
      results.push({ memberId, name: "", outcome: "NOT_FOUND" });
      continue;
    }
    const name = member.person ? formatPersonName(member.person) : "";
    const done = (outcome: OutingSendOutcome) => results.push({ memberId, name, outcome });
    if (!CHILD_TYPES.has(member.attendeeType) || !member.person) {
      done("NOT_ELIGIBLE");
      continue;
    }
    const links = existing.filter((link) => link.rosterMemberId === memberId);
    if (links.some((link) => link.status === "USED")) {
      done("ALREADY_SIGNED");
      continue;
    }
    const live = links.filter((link) => link.status === "OPEN" && link.expiresAt > now);
    if (live.length > 0 && !input.resend) {
      done("ALREADY_SENT");
      continue;
    }
    const email = member.guardians.map((guardian) => guardian.email.trim().toLowerCase()).find((value) => emailSchema.safeParse(value).success);
    if (!email) {
      done("NO_PARENT_EMAIL");
      continue;
    }
    pending.push({ memberId, name, email });
  }
  // A family is one address: it is charged once per send, however many children share it, and all of them get their links
  // when it passes. Siblings on one guardian email are the normal case, not a burst.
  const families = new Map<string, typeof pending>();
  for (const entry of pending) families.set(entry.email, [...(families.get(entry.email) ?? []), entry]);
  for (const [email, children] of families) {
    const limit = options.allowRecipient ? await options.allowRecipient(email, children.length) : null;
    for (const { memberId, name } of children) {
      const done = (outcome: OutingSendOutcome) => results.push({ memberId, name, outcome });
      if (limit && !limit.allowed) {
        done(limit.reason === "CLUB_DAY" ? "CLUB_LIMIT" : "RATE_LIMITED");
        continue;
      }
      try {
        const created = await createClubFormLink(viewer, {
          organizationId,
          templateKey: OUTING_TEMPLATE_KEY,
          recipientEmail: email,
          rosterMemberId: memberId,
          outingId: row.id,
          resend: input.resend,
          ...(input.expiresInDays ? { expiresInDays: input.expiresInDays } : {}),
        }, now);
        messageIds.push(created.messageId);
        done("SENT");
      } catch (error) {
        // Another send for this member got in first (a double click): the link already made stands.
        if (error instanceof ClubFormError && (error.code === "OUTING_ALREADY_SENT" || error.code === "OUTING_ALREADY_SIGNED")) {
          done(error.code === "OUTING_ALREADY_SIGNED" ? "ALREADY_SIGNED" : "ALREADY_SENT");
          continue;
        }
        // A closed outing, a switched-off slip or email not set up stops the whole send; any other problem is that member's alone.
        if (error instanceof ClubFormError && ["OUTING_CLOSED", "OUTING_NOT_FOUND", "TEMPLATE_NOT_FOUND", "EMAIL_NOT_CONFIGURED", "FORM_UNAVAILABLE", "FORBIDDEN"].includes(error.code)) throw error;
        done("FAILED");
      }
    }
  }
  results.sort((left, right) => memberIds.indexOf(left.memberId) - memberIds.indexOf(right.memberId));
  return { results, messageIds, sent: results.filter((result) => result.outcome === "SENT").length };
}

/**
 * The members an outing can still be sent to: active youth on this year's roster with no link for this outing yet
 * (the ones that have one are on the tracking list, with Resend). Whether a parent email is on the roster is a yes or no;
 * the address itself never leaves this function.
 */
export async function listOutingRosterChoices(viewer: ClubFormsViewer, organizationId: string, outingId: string) {
  leaderOnly(viewer, organizationId);
  const { row } = await findOuting(organizationId, outingId);
  const prisma = getPrisma();
  const [members, sent] = await Promise.all([
    prisma.clubRosterMember.findMany({
      where: { organizationId, clubYear: row.clubYear, status: "ACTIVE", attendeeType: { in: ["YOUTH", "UNDERAGE"] }, personId: { not: null } },
      select: { id: true, person: { select: { firstName: true, lastName: true } }, guardians: { select: { email: true } } },
    }),
    prisma.clubFormLink.findMany({ where: { outingId: row.id }, select: { rosterMemberId: true } }),
  ]);
  const sentIds = new Set(sent.flatMap((link) => (link.rosterMemberId ? [link.rosterMemberId] : [])));
  return members
    .filter((member) => member.person && !sentIds.has(member.id))
    .map((member) => ({
      id: member.id,
      name: formatPersonName(member.person!),
      hasParentEmail: member.guardians.some((guardian) => emailSchema.safeParse(guardian.email.trim()).success),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
}
