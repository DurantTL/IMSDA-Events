import "server-only";

import { getPrisma } from "@/lib/prisma";
import { AccessDeniedError, type AuthenticatedUser } from "@/modules/access/authorization";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { hashOpaqueToken } from "@/modules/access/tokens";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { deliverApplicationEmails } from "@/modules/club-applications/deliver";
import { CLUB_EVENT_GATE } from "@/modules/club-registrations/event-gate";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { normalizeOrganizationName } from "@/modules/organizations/domain";
import {
  VISITING_CLUB_INVITE_LIFETIME_DAYS,
  VISITING_DECLINE_REASON_MAX,
  cleanVisitingText,
  visitingClubSourceOrgType,
  visitingInviteState,
  type VisitingClubDecision,
  type VisitingClubInviteState,
  type VisitingClubRequestInput,
  type VisitingClubStatusValue,
  type VisitingClubTypeValue,
} from "@/modules/visiting-clubs/domain";
import { queueVisitingApprovedEmail, queueVisitingDeclinedEmail, queueVisitingInviteEmail } from "@/modules/visiting-clubs/email";

/**
 * Visiting club invites (#835). The rules, in one place:
 *
 * - A visiting club is a guest for one event, never a permanent club: its organization carries `guestEventId`, and it
 *   is billed to itself at the same prices as a conference club (nothing about price or capacity is touched here).
 * - Only a system administrator or Clubs Administrator sends, withdraws, reads or decides. The role is read now, so a
 *   revoke applies at once. Area Coordinators get nothing.
 * - The private link is bound to one event, one address and an expiry, and grants nothing by itself: the director must
 *   be signed in with the verified email the link was sent to, and staff approve the request before a club exists.
 * - Submitting claims the link once (a guarded update), so a replay finds it used. Approving claims the request once
 *   (`PENDING` to `APPROVED`), so a second approval is impossible. Both re-check that the event is still a club event
 *   and not archived.
 * - Audit metadata holds ids only: never a name, phone, address, email or the decline reason.
 */

export type VisitingClubErrorCode =
  | "INVITE_UNAVAILABLE"
  | "INVITE_NOT_FOUND"
  | "EMAIL_MISMATCH"
  | "EVENT_NOT_FOUND"
  | "EMAIL_NOT_CONFIGURED"
  | "REQUEST_NOT_FOUND"
  | "ALREADY_DECIDED"
  | "INVALID_REASON"
  | "ACCOUNT_NOT_FOUND";

export class VisitingClubError extends Error {
  constructor(public readonly code: VisitingClubErrorCode, message: string) {
    super(message);
    this.name = "VisitingClubError";
  }
}

type Actor = Pick<AuthenticatedUser, "id" | "globalRole">;

/** Sending, withdrawing, reading and deciding are for system administrators and Clubs Administrators, read fresh each time. */
async function requireVisitingStaff(actor: Actor | null | undefined): Promise<Actor> {
  if (!actor) throw new AccessDeniedError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED");
  if (!(await hasClubsAdministration(actor))) {
    throw new AccessDeniedError("Only a system administrator or Clubs Administrator can manage visiting clubs.", 403, "PERMISSION_DENIED");
  }
  return actor;
}

const EVENT_NOT_AVAILABLE = "That club event isn't open for visiting clubs.";

// --- Staff: events and links -------------------------------------------

export type VisitingEventOption = { id: string; name: string; startsAt: string };

/** The club events a link can be sent for: the same gate the club portal uses, and not yet over. */
export async function listVisitingClubEventOptions(actorInput: Actor | null | undefined, now = new Date()): Promise<VisitingEventOption[]> {
  await requireVisitingStaff(actorInput);
  const events = await getPrisma().event.findMany({
    where: { ...CLUB_EVENT_GATE, endsAt: { gte: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, name: true, startsAt: true },
  });
  return events.map((event) => ({ id: event.id, name: event.name, startsAt: event.startsAt.toISOString() }));
}

/** Staff email a visiting director a private link for one event. */
export async function createVisitingClubInvite(
  actorInput: Actor | null | undefined,
  input: { eventId: string; email: string; name?: string },
  now = new Date(),
) {
  const actor = await requireVisitingStaff(actorInput);
  if (!isAccountEmailConfigured()) {
    throw new VisitingClubError("EMAIL_NOT_CONFIGURED", "Account email isn't set up on this server, so the link can't be sent yet.");
  }
  const email = input.email.trim().toLowerCase();
  const name = cleanVisitingText(input.name ?? "");
  const messageIds = await getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: input.eventId, ...CLUB_EVENT_GATE }, select: { id: true, name: true } });
    if (!event) throw new VisitingClubError("EVENT_NOT_FOUND", EVENT_NOT_AVAILABLE);
    const invite = await tx.visitingClubInvite.create({
      data: {
        eventId: event.id,
        email,
        name,
        createdByUserId: actor.id,
        expiresAt: new Date(now.getTime() + VISITING_CLUB_INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const messageId = await queueVisitingInviteEmail(tx, { inviteId: invite.id, email, name, eventName: event.name, days: VISITING_CLUB_INVITE_LIFETIME_DAYS });
    if (!messageId) {
      throw new VisitingClubError("EMAIL_NOT_CONFIGURED", "Account email isn't set up on this server, so the link can't be sent yet.");
    }
    await tx.visitingClubInvite.update({ where: { id: invite.id }, data: { messageId } });
    await writeAuditLog({
      actorUserId: actor.id,
      eventId: event.id,
      action: "VISITING_CLUB_INVITE_SENT",
      entityType: "VisitingClubInvite",
      entityId: invite.id,
      summary: "Sent a private link for a visiting club.",
      metadata: { inviteId: invite.id, eventId: event.id },
    }, tx);
    return [messageId];
  });
  await deliverApplicationEmails(messageIds);
}

export type VisitingInviteRecord = {
  id: string;
  email: string;
  name: string;
  eventId: string;
  eventName: string;
  state: VisitingClubInviteState;
  createdAt: string;
  expiresAt: string;
};

export async function listVisitingClubInvites(actorInput: Actor | null | undefined, now = new Date()): Promise<VisitingInviteRecord[]> {
  await requireVisitingStaff(actorInput);
  const rows = await getPrisma().visitingClubInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, email: true, name: true, eventId: true, usedAt: true, cancelledAt: true, expiresAt: true, createdAt: true, event: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    eventId: row.eventId,
    eventName: row.event.name,
    state: visitingInviteState(row, now),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/** Withdraws an unused link. */
export async function cancelVisitingClubInvite(actorInput: Actor | null | undefined, inviteId: string, now = new Date()) {
  const actor = await requireVisitingStaff(actorInput);
  await getPrisma().$transaction(async (tx) => {
    const cancelled = await tx.visitingClubInvite.updateMany({
      where: { id: inviteId, usedAt: null, cancelledAt: null },
      data: { cancelledAt: now, tokenHash: null },
    });
    if (cancelled.count === 0) throw new VisitingClubError("INVITE_NOT_FOUND", "That link was already used or withdrawn.");
    await writeAuditLog({
      actorUserId: actor.id,
      action: "VISITING_CLUB_INVITE_CANCELLED",
      entityType: "VisitingClubInvite",
      entityId: inviteId,
      summary: "Withdrew a private link for a visiting club.",
      metadata: { inviteId },
    }, tx);
  });
}

// --- The visiting director ---------------------------------------------

export type VisitingAccount = { id: string; verifiedEmail: string; displayName: string };

type OpenInvite = { id: string; eventId: string; email: string; name: string; eventName: string };

async function findOpenInvite(token: string, now: Date): Promise<OpenInvite | null> {
  if (!token || token.length > 200) return null;
  const invite = await getPrisma().visitingClubInvite.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: { id: true, eventId: true, email: true, name: true, usedAt: true, cancelledAt: true, expiresAt: true, event: { select: { name: true } } },
  });
  if (!invite || visitingInviteState(invite, now) !== "OPEN") return null;
  return { id: invite.id, eventId: invite.eventId, email: invite.email, name: invite.name, eventName: invite.event.name };
}

export type VisitingInviteView =
  | { status: "UNAVAILABLE" }
  | { status: "EMAIL_MISMATCH" }
  | { status: "READY"; eventName: string; email: string; name: string }
  | { status: "SENT"; eventName: string; requestStatus: VisitingClubStatusValue };

/**
 * What the link's page needs for a signed-in account. A bad, used, expired or withdrawn link is UNAVAILABLE (the page
 * answers 404), except that the account that sent the request on a used link sees SENT, so a reload after sending still
 * shows the confirmation. A different account's address is EMAIL_MISMATCH, which says nothing about the event or the address.
 */
export async function viewVisitingInvite(token: string, account: VisitingAccount, now = new Date()): Promise<VisitingInviteView> {
  const invite = await findOpenInvite(token, now);
  if (!invite) return findSentRequest(token, account);
  if (invite.email !== account.verifiedEmail.trim().toLowerCase()) return { status: "EMAIL_MISMATCH" };
  // The event may have closed since the email went out.
  const event = await getPrisma().event.findFirst({ where: { id: invite.eventId, ...CLUB_EVENT_GATE }, select: { id: true } });
  if (!event) return { status: "UNAVAILABLE" };
  return { status: "READY", eventName: invite.eventName, email: invite.email, name: invite.name };
}

/** A used link shows its request only to the account that sent it; everyone else, and every other state, is UNAVAILABLE. */
async function findSentRequest(token: string, account: VisitingAccount): Promise<VisitingInviteView> {
  if (!token || token.length > 200) return { status: "UNAVAILABLE" };
  const used = await getPrisma().visitingClubRequest.findFirst({
    where: { invite: { tokenHash: hashOpaqueToken(token) }, submittedByAccountId: account.id },
    select: { status: true, event: { select: { name: true } } },
  });
  if (!used) return { status: "UNAVAILABLE" };
  return { status: "SENT", eventName: used.event.name, requestStatus: used.status };
}

/**
 * The director's request. Re-checks the link, the address and the event, claims the link once, and creates a waiting
 * request. It creates no club and no grant: staff approve first. A director who already runs another club may still
 * submit; approval just gives them a second club.
 */
export async function submitVisitingClubRequest(
  account: VisitingAccount,
  token: string,
  input: VisitingClubRequestInput,
  now = new Date(),
): Promise<{ id: string }> {
  const invite = await findOpenInvite(token, now);
  if (!invite) throw new VisitingClubError("INVITE_UNAVAILABLE", "This link can't be used any more. Ask the conference for a new one.");
  const email = account.verifiedEmail.trim().toLowerCase();
  if (invite.email !== email) throw new VisitingClubError("EMAIL_MISMATCH", "This link was sent to a different email address.");

  return getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: invite.eventId, ...CLUB_EVENT_GATE }, select: { id: true } });
    if (!event) throw new VisitingClubError("EVENT_NOT_FOUND", EVENT_NOT_AVAILABLE);
    // The claim: of two submissions on one link, one wins.
    const claimed = await tx.visitingClubInvite.updateMany({
      where: { id: invite.id, usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) throw new VisitingClubError("INVITE_UNAVAILABLE", "This link can't be used any more. Ask the conference for a new one.");
    const created = await tx.visitingClubRequest.create({
      data: {
        eventId: invite.eventId,
        inviteId: invite.id,
        submittedByAccountId: account.id,
        clubName: cleanVisitingText(input.clubName),
        clubType: input.clubType,
        homeConference: cleanVisitingText(input.homeConference),
        homeChurch: cleanVisitingText(input.homeChurch),
        directorName: cleanVisitingText(account.displayName) || email,
        directorEmail: email,
        directorPhone: input.directorPhone,
        screeningConfirmedAt: now,
      },
      select: { id: true },
    });
    await writeAuditLog({
      eventId: invite.eventId,
      action: "VISITING_CLUB_REQUEST_SUBMITTED",
      entityType: "VisitingClubRequest",
      entityId: created.id,
      summary: "A visiting club request was submitted.",
      metadata: { requestId: created.id, inviteId: invite.id, eventId: invite.eventId, accountId: account.id },
    }, tx);
    return { id: created.id };
  });
}

// --- Staff: requests ----------------------------------------------------

export type VisitingRequestRecord = {
  id: string;
  status: VisitingClubStatusValue;
  event: { id: string; name: string };
  clubName: string;
  clubType: VisitingClubTypeValue;
  homeConference: string;
  homeChurch: string;
  director: { name: string; email: string; phone: string };
  screeningConfirmedAt: string;
  submittedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  declineReason: string | null;
  createdOrganizationId: string | null;
};

const requestSelect = {
  id: true,
  status: true,
  clubName: true,
  clubType: true,
  homeConference: true,
  homeChurch: true,
  directorName: true,
  directorEmail: true,
  directorPhone: true,
  screeningConfirmedAt: true,
  createdAt: true,
  decidedAt: true,
  declineReason: true,
  createdOrganizationId: true,
  event: { select: { id: true, name: true } },
  decidedBy: { select: { displayName: true } },
} as const;

type RequestRow = {
  id: string;
  status: VisitingClubStatusValue;
  clubName: string;
  clubType: VisitingClubTypeValue;
  homeConference: string;
  homeChurch: string;
  directorName: string;
  directorEmail: string;
  directorPhone: string;
  screeningConfirmedAt: Date;
  createdAt: Date;
  decidedAt: Date | null;
  declineReason: string | null;
  createdOrganizationId: string | null;
  event: { id: string; name: string };
  decidedBy: { displayName: string } | null;
};

function toRecord(row: RequestRow): VisitingRequestRecord {
  return {
    id: row.id,
    status: row.status,
    event: row.event,
    clubName: row.clubName,
    clubType: row.clubType,
    homeConference: row.homeConference,
    homeChurch: row.homeChurch,
    director: { name: row.directorName, email: row.directorEmail, phone: row.directorPhone },
    screeningConfirmedAt: row.screeningConfirmedAt.toISOString(),
    submittedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByName: row.decidedBy?.displayName ?? null,
    declineReason: row.declineReason,
    createdOrganizationId: row.createdOrganizationId,
  };
}

/** Waiting requests first (oldest first), then the most recent decisions. */
export async function listVisitingClubRequests(actorInput: Actor | null | undefined): Promise<VisitingRequestRecord[]> {
  await requireVisitingStaff(actorInput);
  const prisma = getPrisma();
  const [waiting, decided] = await Promise.all([
    prisma.visitingClubRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 200, select: requestSelect }),
    prisma.visitingClubRequest.findMany({ where: { status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 50, select: requestSelect }),
  ]);
  return [...waiting, ...decided].map((row) => toRecord(row as RequestRow));
}

export async function getVisitingClubRequest(actorInput: Actor | null | undefined, requestId: string): Promise<VisitingRequestRecord | null> {
  await requireVisitingStaff(actorInput);
  if (!requestId || requestId.length > 100) return null;
  const row = await getPrisma().visitingClubRequest.findUnique({ where: { id: requestId }, select: requestSelect });
  return row ? toRecord(row as RequestRow) : null;
}

export async function countWaitingVisitingClubRequests(actorInput: Actor | null | undefined): Promise<number> {
  await requireVisitingStaff(actorInput);
  return getPrisma().visitingClubRequest.count({ where: { status: "PENDING" } });
}

/**
 * Approves or declines a waiting request.
 *
 * Approving, in one transaction: re-checks the event is still an open club event and the account still exists, claims
 * the request (the conditional update is what stops a second approval), creates the guest club (`parentOrganizationId`
 * null, `guestEventId` the event) and the director's grant, then emails the director. Declining emails the director,
 * with the reason when one was given; the reason is never put in the audit trail.
 */
export async function decideVisitingClubRequest(
  actorInput: Actor | null | undefined,
  requestId: string,
  decision: VisitingClubDecision,
  now = new Date(),
): Promise<{ status: "APPROVED" | "DECLINED"; organizationId: string | null }> {
  const actor = await requireVisitingStaff(actorInput);
  const declineReason = decision.decision === "decline" ? (decision.declineReason?.trim() || null) : null;
  if (declineReason && declineReason.length > VISITING_DECLINE_REASON_MAX) {
    throw new VisitingClubError("INVALID_REASON", `Keep the reason under ${VISITING_DECLINE_REASON_MAX} characters.`);
  }

  const result = await getPrisma().$transaction(async (tx) => {
    const request = await tx.visitingClubRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true, status: true, eventId: true, submittedByAccountId: true, clubName: true, clubType: true,
        directorName: true, directorEmail: true, event: { select: { name: true } },
      },
    });
    if (!request) throw new VisitingClubError("REQUEST_NOT_FOUND", "That request could not be found.");
    if (request.status !== "PENDING") throw new VisitingClubError("ALREADY_DECIDED", "That request was already decided.");

    if (decision.decision === "approve") {
      // Re-checked on every approval: the event may have been archived or changed since the request was sent.
      const event = await tx.event.findFirst({ where: { id: request.eventId, ...CLUB_EVENT_GATE }, select: { id: true } });
      if (!event) throw new VisitingClubError("EVENT_NOT_FOUND", EVENT_NOT_AVAILABLE);
      const account = await tx.attendeeAccount.findUnique({ where: { id: request.submittedByAccountId }, select: { id: true, disabledAt: true } });
      if (!account || account.disabledAt) {
        throw new VisitingClubError("ACCOUNT_NOT_FOUND", "The director's account is no longer available, so the club can't be approved.");
      }
    }

    // The claim: of two deciders, one wins; the other gets ALREADY_DECIDED and nothing is created twice.
    const claimed = await tx.visitingClubRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: {
        status: decision.decision === "approve" ? "APPROVED" : "DECLINED",
        decidedByUserId: actor.id,
        decidedAt: now,
        declineReason,
      },
    });
    if (claimed.count === 0) throw new VisitingClubError("ALREADY_DECIDED", "That request was already decided.");

    if (decision.decision === "decline") {
      await writeAuditLog({
        actorUserId: actor.id,
        eventId: request.eventId,
        action: "VISITING_CLUB_REQUEST_DECLINED",
        entityType: "VisitingClubRequest",
        entityId: request.id,
        summary: "Declined a visiting club request.",
        metadata: { requestId: request.id, eventId: request.eventId, hasReason: Boolean(declineReason) },
      }, tx);
      const messageIds = await queueVisitingDeclinedEmail(tx, {
        requestId: request.id,
        email: request.directorEmail,
        directorName: request.directorName,
        clubName: request.clubName,
        eventName: request.event.name,
        reason: declineReason,
      });
      return { status: "DECLINED" as const, organizationId: null, messageIds };
    }

    const club = await tx.organization.create({
      data: {
        type: "CLUB",
        name: request.clubName,
        normalizedName: normalizeOrganizationName(request.clubName),
        parentOrganizationId: null,
        guestEventId: request.eventId,
        isActive: true,
        sourceOrgType: visitingClubSourceOrgType[request.clubType],
        // The ministry follows the request, so an Adventurer visiting club is an Adventurer club (#843).
        clubKind: request.clubType === "ADVENTURER" ? "ADVENTURER" : "PATHFINDER",
      },
      select: { id: true },
    });
    await tx.visitingClubRequest.update({ where: { id: request.id }, data: { createdOrganizationId: club.id } });
    const grant = await tx.clubDirectorGrant.create({
      data: {
        organizationId: club.id,
        attendeeAccountId: request.submittedByAccountId,
        role: "DIRECTOR",
        effectiveFrom: now,
        reason: "Approved visiting club request.",
        grantedByUserId: actor.id,
      },
      select: { id: true },
    });
    await writeAuditLog({
      actorUserId: actor.id,
      eventId: request.eventId,
      action: "ORGANIZATION_CREATED",
      entityType: "Organization",
      entityId: club.id,
      summary: "Created a guest club from a visiting club request.",
      metadata: { type: "CLUB", guestEventId: request.eventId, requestId: request.id },
    }, tx);
    await writeAuditLog({
      actorUserId: actor.id,
      eventId: request.eventId,
      action: "VISITING_CLUB_REQUEST_APPROVED",
      entityType: "VisitingClubRequest",
      entityId: request.id,
      summary: "Approved a visiting club request.",
      metadata: { requestId: request.id, organizationId: club.id, eventId: request.eventId, grantId: grant.id },
    }, tx);
    const messageIds = await queueVisitingApprovedEmail(tx, {
      requestId: request.id,
      email: request.directorEmail,
      directorName: request.directorName,
      clubName: request.clubName,
      eventName: request.event.name,
    });
    return { status: "APPROVED" as const, organizationId: club.id, messageIds };
  });

  await deliverApplicationEmails(result.messageIds);
  return { status: result.status, organizationId: result.organizationId };
}
