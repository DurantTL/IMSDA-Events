import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { resolveClubsActor } from "@/modules/access/admin-roles";
import { AccessDeniedError } from "@/modules/access/authorization";
import { applyClubsAdministrator } from "@/modules/access/clubs-administrator";
import {
  applyGlobalRole,
  assignEventMembership,
  createUnusableCredentialHash,
  findOrCreatePendingStaffUser,
} from "@/modules/access/membership-repository";
import { eventRoles } from "@/modules/access/permissions";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { deliverStaffActivation, type StaffActivationDelivery } from "@/modules/communications/staff-activation";
import { clubInviteSignUpUrl, createPeopleClubInvite, findOpenClubInvite } from "@/modules/club-imports/invites";
import { createAreaCoordinatorInvite, findOpenAreaCoordinatorInvite } from "@/modules/organizations/area-coordinator-invites";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import type { GrantItem } from "@/modules/system-admin/people-directory-model";
import { deferredPersonHref } from "@/modules/system-admin/people-invite-href";

/**
 * The one Invite a person (#1276). The person inviting ticks the access; this module decides which kind of account each
 * piece lives on. Staff-side access (system administrator, Clubs Administrator, event roles) lives on a staff login and
 * needs a system administrator; family-side access (Area Coordinator, club roles) lives on a website account and needs
 * a system administrator or an active Clubs Administrator. The actor is read from the database here, not only at the
 * route. An email that already has a login or account is never duplicated or linked (identity merging is a human step):
 * its items are deferred to the person's page, to be saved there.
 */

export class PeopleInviteError extends Error {
  constructor(
    public readonly code: "INVALID_ACCESS" | "ALREADY_INVITED" | "STAFF_LOGIN_EXISTS",
    message: string,
    /** For STAFF_LOGIN_EXISTS: where that person's page is. */
    public readonly personHref?: string,
  ) {
    super(message);
    this.name = "PeopleInviteError";
  }
}

const clubRoleValues = Object.keys(clubDirectorRoleLabels) as [ClubRole, ...ClubRole[]];
const idText = z.string().trim().min(1).max(64);
const nameField = z.string().trim().min(2, "Enter the person's name.").max(100);
const emailField = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));

const staffAccessShape = {
  systemAdmin: z.boolean().default(false),
  clubsAdministrator: z.boolean().default(false),
  events: z.array(z.object({ eventId: idText, role: z.enum(eventRoles) }).strict()).max(20).default([]),
};
const familyAccessShape = {
  areaCoordinator: z.boolean().default(false),
  clubs: z.array(z.object({ organizationId: idText, role: z.enum(clubRoleValues) }).strict()).max(20).default([]),
};

function uniqueBy<T>(values: readonly T[], key: (value: T) => string) {
  return new Set(values.map(key)).size === values.length;
}

const staffAccessSchema = z.object(staffAccessShape).strict();
const accessSchema = z.object({ ...staffAccessShape, ...familyAccessShape }).strict();

function refineAccess<T extends { systemAdmin: boolean; clubsAdministrator: boolean; events: Array<{ eventId: string }>; areaCoordinator?: boolean; clubs?: Array<{ organizationId: string; role: string }> }>(
  schema: z.ZodType<T>,
) {
  return schema
    .refine((access) => access.systemAdmin || access.clubsAdministrator || access.areaCoordinator || access.events.length > 0 || (access.clubs?.length ?? 0) > 0, { message: "Choose at least one kind of access." })
    .refine((access) => uniqueBy(access.events, (event) => event.eventId), { message: "Each event can be chosen once." })
    .refine((access) => uniqueBy(access.clubs ?? [], (club) => `${club.organizationId}:${club.role}`), { message: "Each club role can be chosen once." });
}

/** The dialog's input to `POST /api/admin/people/invite`. */
export const peopleInviteSchema = z.object({ name: nameField, email: emailField, access: refineAccess(accessSchema) }).strict();
/** `POST /api/admin/users`: a staff login and its staff-side access only. */
export const staffLoginInviteSchema = z.object({ name: nameField, email: emailField, access: refineAccess(staffAccessSchema) }).strict();

export type StaffAccessInput = z.infer<typeof staffAccessSchema>;
export type PeopleInviteInput = z.infer<typeof peopleInviteSchema>;

type Access = PeopleInviteInput["access"];

function hasStaffItems(access: StaffAccessInput) {
  return access.systemAdmin || access.clubsAdministrator || access.events.length > 0;
}
function hasFamilyItems(access: Pick<Access, "areaCoordinator" | "clubs">) {
  return access.areaCoordinator || access.clubs.length > 0;
}

async function requireSystemAdministratorActor(actorUserId: string) {
  const actor = await resolveClubsActor(actorUserId);
  if (!actor?.systemAdmin) {
    throw new AccessDeniedError("System administrator access is required to give staff access.", 403, "PERMISSION_DENIED");
  }
}

/** Every event and club the invite names must exist (clubs: active CLUB organizations). Nothing is written. */
async function assertTargetsExist(access: Pick<Access, "events"> & Partial<Pick<Access, "clubs">>) {
  const prisma = getPrisma();
  const eventIds = [...new Set(access.events.map((event) => event.eventId))];
  if (eventIds.length > 0) {
    const found = await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true } });
    if (found.length !== eventIds.length) throw new PeopleInviteError("INVALID_ACCESS", "One of the events you chose could not be found.");
  }
  const clubIds = [...new Set((access.clubs ?? []).map((club) => club.organizationId))];
  if (clubIds.length > 0) {
    const found = await prisma.organization.findMany({ where: { id: { in: clubIds }, type: "CLUB", isActive: true }, select: { id: true } });
    if (found.length !== clubIds.length) throw new PeopleInviteError("INVALID_ACCESS", "One of the clubs you chose could not be found.");
  }
}

/** What already exists for an email, counting a staff login and website account linked to each other as one person. */
async function findExistingPerson(email: string) {
  const prisma = getPrisma();
  const [user, account] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true, attendeeAccountId: true } }),
    prisma.attendeeAccount.findUnique({ where: { email }, select: { id: true, linkedUser: { select: { id: true } } } }),
  ]);
  return {
    staffId: user?.id ?? account?.linkedUser?.id ?? null,
    accountId: account?.id ?? user?.attendeeAccountId ?? null,
  };
}

function staffGrantItems(access: StaffAccessInput): GrantItem[] {
  return [
    ...(access.systemAdmin ? [{ type: "sa" } as const] : []),
    ...(access.clubsAdministrator ? [{ type: "ca" } as const] : []),
    ...access.events.map((event) => ({ type: "event", eventId: event.eventId, role: event.role }) as const),
  ];
}
function familyGrantItems(access: Pick<Access, "areaCoordinator" | "clubs">): GrantItem[] {
  return [
    ...(access.areaCoordinator ? [{ type: "ac" } as const] : []),
    ...access.clubs.map((club) => ({ type: "club", organizationId: club.organizationId, role: club.role }) as const),
  ];
}

export type StaffLoginInviteResult =
  | ({ outcome: "created"; userId: string } & StaffActivationDelivery)
  | { outcome: "exists"; staffId: string; accountId: string | null; personHref: string };

/**
 * Creates a staff login for an email (pending activation, the same code that adds a colleague to an event), applies the
 * staff-side access in the same transaction, and sends the activation email, or returns a one-time `setupUrl` where email
 * isn't configured. System administrators only, checked against the database here. An email that already has a staff
 * login (or a website account linked to one) creates nothing and reports `exists`.
 */
export async function createStaffLoginInvite(
  actorUserId: string,
  input: { name: string; email: string; access: StaffAccessInput },
): Promise<StaffLoginInviteResult> {
  await requireSystemAdministratorActor(actorUserId);
  const email = input.email.trim().toLowerCase();
  const displayName = input.name.trim();
  await assertTargetsExist(input.access);
  const existing = await findExistingPerson(email);
  if (existing.staffId) {
    return { outcome: "exists", staffId: existing.staffId, accountId: existing.accountId, personHref: deferredPersonHref(existing, staffGrantItems(input.access)) };
  }

  const unusableHash = await createUnusableCredentialHash();
  let userId: string;
  try {
    userId = await getPrisma().$transaction(async (tx) => {
      const user = await findOrCreatePendingStaffUser(tx, { email, displayName }, unusableHash);
      // A login that appeared between the check above and this write belongs to someone else: never give it roles,
      // rename it or email it an activation link. Throwing rolls the whole transaction back.
      if (!user.created) throw new PeopleInviteError("STAFF_LOGIN_EXISTS", "That email already has a staff login.");
      if (input.access.systemAdmin) await applyGlobalRole(tx, user.userId, actorUserId, "SYSTEM_ADMIN");
      if (input.access.clubsAdministrator) await applyClubsAdministrator(tx, user.userId, true, actorUserId);
      for (const event of input.access.events) {
        await assignEventMembership(tx, event.eventId, actorUserId, user, { displayName, role: event.role });
      }
      return user.userId;
    });
  } catch (error) {
    const raced = (error instanceof PeopleInviteError && error.code === "STAFF_LOGIN_EXISTS")
      || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    if (!raced) throw error;
    const current = await findExistingPerson(email);
    if (!current.staffId) throw error;
    return { outcome: "exists", staffId: current.staffId, accountId: current.accountId, personHref: deferredPersonHref(current, staffGrantItems(input.access)) };
  }
  const delivery = await deliverStaffActivation({ userId, email, displayName });
  return { outcome: "created", userId, ...delivery };
}

export type PeopleInviteResult = {
  created: {
    staffLogin: boolean;
    invitationEmailed: boolean;
    setupUrl?: string;
    setupExpiresAt?: string;
    clubInviteIds: string[];
    areaCoordinatorInviteId?: string;
    /** Only where account email isn't configured: the link staff pass on to the person. */
    signUpUrl?: string;
  };
  deferred: { personHref: string } | null;
  /** Set when the family invites went out but the staff login could not be created; no staff access was applied. */
  staffError?: string;
  /** Queued invite emails for the route to deliver after the response. */
  messageIds: string[];
};

/**
 * The dialog's invite. See the module comment for who may invite what. Everything is validated before anything is
 * written: the actor, the events and clubs, and any open invite the same email already has.
 */
export async function invitePerson(actorUserId: string, input: PeopleInviteInput, now = new Date()): Promise<PeopleInviteResult> {
  const actor = await resolveClubsActor(actorUserId);
  if (!actor) {
    throw new AccessDeniedError("Clubs Administrator or system administrator access is required to invite people.", 403, "PERMISSION_DENIED");
  }
  const { access } = input;
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const staffItems = hasStaffItems(access);
  const familyItems = hasFamilyItems(access);
  // A Clubs Administrator sending any staff-side item is refused before anything is read or written.
  if (staffItems && !actor.systemAdmin) {
    throw new AccessDeniedError("Only a system administrator can give system administrator, Clubs Administrator or event access.", 403, "PERMISSION_DENIED");
  }
  await assertTargetsExist(access);

  const existing = await findExistingPerson(email);
  const createStaff = staffItems && !existing.staffId;
  const inviteFamily = familyItems && !existing.accountId;
  if (inviteFamily) {
    const prisma = getPrisma();
    if (access.areaCoordinator && await findOpenAreaCoordinatorInvite(prisma, email)) {
      throw new PeopleInviteError("ALREADY_INVITED", `There's already a pending Area Coordinator invite for ${email}. Resend or cancel it from People & access.`);
    }
    for (const club of access.clubs) {
      if (await findOpenClubInvite(prisma, { organizationId: club.organizationId, email, role: club.role })) {
        throw new PeopleInviteError("ALREADY_INVITED", `There's already a pending club invite for ${email} with that role. Resend or cancel it from People & access.`);
      }
    }
  }

  const result: PeopleInviteResult = { created: { staffLogin: false, invitationEmailed: false, clubInviteIds: [] }, deferred: null, messageIds: [] };
  const staffDeferred: GrantItem[] = [];
  const familyDeferred: GrantItem[] = [];
  let personAfter = existing;

  // The family invites go first: they are validated above and are the part that can still be refused (a racing
  // duplicate), so a failure here leaves no staff login created and emailed behind an error message.
  if (familyItems && !inviteFamily) {
    familyDeferred.push(...familyGrantItems(access));
  } else if (inviteFamily) {
    const clubs = access.clubs.length > 0
      ? await getPrisma().organization.findMany({ where: { id: { in: access.clubs.map((entry) => entry.organizationId) } }, select: { id: true, name: true } })
      : [];
    const clubNames = new Map(clubs.map((entry) => [entry.id, entry.name]));
    try {
      await getPrisma().$transaction(async (tx) => {
        for (const entry of access.clubs) {
          const invite = await createPeopleClubInvite(tx, { organizationId: entry.organizationId, clubName: clubNames.get(entry.organizationId) ?? "the club", email, name, role: entry.role, actorUserId }, now);
          result.created.clubInviteIds.push(invite.inviteId);
          if (invite.messageId) result.messageIds.push(invite.messageId);
        }
        if (access.areaCoordinator) {
          const invite = await createAreaCoordinatorInvite(tx, { email, name, actorUserId }, now);
          result.created.areaCoordinatorInviteId = invite.inviteId;
          if (invite.messageId) result.messageIds.push(invite.messageId);
        }
      });
    } catch (error) {
      // The partial unique index on open Area Coordinator invites: two invites for one email racing each other.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PeopleInviteError("ALREADY_INVITED", `There's already a pending invite for ${email}. Resend or cancel it from People & access.`);
      }
      throw error;
    }
    if (!isAccountEmailConfigured()) result.created.signUpUrl = clubInviteSignUpUrl(email);
  }

  if (staffItems) {
    let staff: StaffLoginInviteResult | null = null;
    try {
      staff = createStaff ? await createStaffLoginInvite(actorUserId, { name, email, access }) : null;
    } catch (error) {
      // Family invites already committed and are queued. Nothing is thrown away: the route still delivers them, and
      // the dialog shows what was done and that the staff part failed. No staff access was applied.
      if (result.messageIds.length === 0 && result.created.clubInviteIds.length === 0 && !result.created.areaCoordinatorInviteId) throw error;
      logError("Inviting a person: the staff login could not be created after the family invites were sent.", error);
      result.staffError = "The club and Area Coordinator invites were sent, but the staff login couldn't be created. Try again from Invite a person with only the staff access ticked.";
      return result;
    }
    if (staff?.outcome === "created") {
      result.created = { ...result.created, staffLogin: true, invitationEmailed: staff.invitationEmailed, setupUrl: staff.setupUrl, setupExpiresAt: staff.setupExpiresAt };
      personAfter = { ...personAfter, staffId: staff.userId };
    } else {
      staffDeferred.push(...staffGrantItems(access));
      if (staff?.outcome === "exists") personAfter = { staffId: staff.staffId, accountId: staff.accountId ?? personAfter.accountId };
    }
  }

  const deferredItems = [...staffDeferred, ...familyDeferred];
  if (deferredItems.length > 0) result.deferred = { personHref: deferredPersonHref(personAfter, deferredItems) };
  return result;
}
