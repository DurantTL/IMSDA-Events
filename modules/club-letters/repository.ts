import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import {
  CLUB_LETTERS_FEATURE_KEY,
  LETTERS_PER_CLUB_MAX,
  PRINT_PEOPLE_MAX,
  canAddLetter,
  canManageClubLetters,
  fillInLetter,
  parsePrintPersonIds,
  type ClubLetterKindValue,
  type ClubLetterView,
} from "@/modules/club-letters/domain";
import type { ClubLetterInput } from "@/modules/club-letters/schemas";
import { clubYearFor } from "@/modules/club-rosters/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * Club letters and certificates (#1708): the templates a club's director or deputy wrote, and the filled-in pages they
 * print. The callers (the pages, the route handlers) have already checked the club role; every function here also needs
 * the feature switched on. Every create, change and delete is audited. Nothing here sends anything.
 */

/** Who wrote it: the attendee account of a director or deputy, or a staff user acting as the club's director (#442). */
export type ClubLetterActor = { accountId: string } | { userId: string; actAsId?: string; viaClubsAdministrator?: true };

export class ClubLetterError extends Error {
  constructor(public readonly code: "FEATURE_OFF" | "LETTER_NOT_FOUND" | "LIMIT_REACHED", message: string) {
    super(message);
    this.name = "ClubLetterError";
  }
}

export type ClubLetterPerson = { personId: string; firstName: string; lastName: string };

export type ClubLetterList = {
  clubYear: string;
  letters: ClubLetterView[];
  /** Everyone on this club year's active roster who has a person record, by last name. */
  people: ClubLetterPerson[];
};

export type ClubLetterSheets = {
  kind: ClubLetterKindValue;
  title: string;
  /** One filled-in text per person kept, in last-name order. */
  sheets: Array<{ personId: string; text: string }>;
};

/** Whether this viewer and club may use letters: the one check the page, the links and the route handlers share. */
export async function clubLettersAvailable(organizationId: string, capabilities: Pick<ClubCapabilities, "editProfile">): Promise<boolean> {
  if (!canManageClubLetters(capabilities)) return false;
  return isClubFeatureEnabled(organizationId, CLUB_LETTERS_FEATURE_KEY);
}

const letterSelect = { id: true, kind: true, title: true, body: true, updatedAt: true } as const;

function toView(row: { id: string; kind: string; title: string; body: string; updatedAt: Date }): ClubLetterView {
  return { id: row.id, kind: row.kind as ClubLetterKindValue, title: row.title, body: row.body, updatedAt: row.updatedAt.toISOString() };
}

/** This club year's active roster people, each once, by last name then first name. */
async function activeRosterPeople(organizationId: string, now: Date, onlyIds?: string[]): Promise<ClubLetterPerson[]> {
  const members = await getPrisma().clubRosterMember.findMany({
    where: {
      organizationId,
      clubYear: clubYearFor(now),
      status: "ACTIVE",
      personId: onlyIds ? { in: onlyIds } : { not: null },
    },
    select: { personId: true, person: { select: { firstName: true, lastName: true } } },
  });
  const byPerson = new Map<string, ClubLetterPerson>();
  for (const member of members) {
    if (member.personId && member.person && !byPerson.has(member.personId)) {
      byPerson.set(member.personId, { personId: member.personId, firstName: member.person.firstName, lastName: member.person.lastName });
    }
  }
  return [...byPerson.values()].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.personId.localeCompare(b.personId));
}

/** The templates (newest change first) and the roster to print for, or null when this viewer or club may not have them. */
export async function loadClubLetters(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  now = new Date(),
): Promise<ClubLetterList | null> {
  if (!(await clubLettersAvailable(organizationId, capabilities))) return null;
  const rows = await getPrisma().clubLetterTemplate.findMany({
    where: { organizationId },
    select: letterSelect,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: LETTERS_PER_CLUB_MAX,
  });
  return { clubYear: clubYearFor(now), letters: rows.map(toView), people: await activeRosterPeople(organizationId, now) };
}

/**
 * The filled-in pages for one of this club's templates. Only people on this club's active roster this club year are
 * kept (anyone else in the request is dropped without a word), at most 200. Returns null when this viewer or club may
 * not print, or the template belongs to another club or does not exist.
 */
export async function loadClubLetterSheets(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  templateId: string,
  people: string | string[] | undefined,
  now = new Date(),
): Promise<ClubLetterSheets | null> {
  if (!(await clubLettersAvailable(organizationId, capabilities))) return null;
  const prisma = getPrisma();
  const template = await prisma.clubLetterTemplate.findFirst({ where: { id: templateId, organizationId }, select: letterSelect });
  if (!template) return null;
  const ids = parsePrintPersonIds(people);
  const club = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const kept = ids.length > 0 ? (await activeRosterPeople(organizationId, now, ids)).slice(0, PRINT_PEOPLE_MAX) : [];
  const clubYear = clubYearFor(now);
  return {
    kind: template.kind as ClubLetterKindValue,
    title: template.title,
    sheets: kept.map((person) => ({
      personId: person.personId,
      text: fillInLetter(template.body, { firstName: person.firstName, lastName: person.lastName, clubName: club?.name ?? "", clubYear, date: now }),
    })),
  };
}

function actorFields(actor: ClubLetterActor) {
  return "accountId" in actor ? { createdByAccountId: actor.accountId } : { createdByUserId: actor.userId };
}

function auditActor(actor: ClubLetterActor) {
  return "accountId" in actor
    ? { metadata: { actorAttendeeAccountId: actor.accountId } }
    : {
      actorUserId: actor.userId,
      metadata: { ...(actor.actAsId ? { actAsId: actor.actAsId } : {}), ...(actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}) },
    };
}

async function requireFeature(organizationId: string) {
  if (!(await isClubFeatureEnabled(organizationId, CLUB_LETTERS_FEATURE_KEY))) {
    throw new ClubLetterError("FEATURE_OFF", "That page could not be found.");
  }
}

/** Saves a new template. Needs the feature on and room under the limit. Audited with the club, kind and title. */
export async function createClubLetter(organizationId: string, input: ClubLetterInput, actor: ClubLetterActor): Promise<ClubLetterView> {
  return getPrisma().$transaction(async (tx) => {
    await requireFeature(organizationId);
    const existing = await tx.clubLetterTemplate.count({ where: { organizationId } });
    if (!canAddLetter(existing)) {
      throw new ClubLetterError("LIMIT_REACHED", `A club can keep at most ${LETTERS_PER_CLUB_MAX} letters and certificates. Delete one first.`);
    }
    const created = await tx.clubLetterTemplate.create({
      data: { organizationId, kind: input.kind, title: input.title, body: input.body, ...actorFields(actor) },
      select: letterSelect,
    });
    const who = auditActor(actor);
    await writeAuditLog({
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_LETTER_CREATED",
      entityType: "ClubLetterTemplate",
      entityId: created.id,
      summary: `Added a ${input.kind === "CERTIFICATE" ? "certificate" : "letter"} template for the club.`,
      metadata: { organizationId, kind: created.kind, title: created.title, ...who.metadata },
    }, tx);
    return toView(created);
  });
}

/** Changes one of this club's templates. Needs the feature on. Audited. */
export async function updateClubLetter(organizationId: string, templateId: string, input: ClubLetterInput, actor: ClubLetterActor): Promise<ClubLetterView> {
  return getPrisma().$transaction(async (tx) => {
    await requireFeature(organizationId);
    const changed = await tx.clubLetterTemplate.updateMany({
      where: { id: templateId, organizationId },
      data: { kind: input.kind, title: input.title, body: input.body },
    });
    if (changed.count === 0) throw new ClubLetterError("LETTER_NOT_FOUND", "That letter could not be found.");
    const row = await tx.clubLetterTemplate.findFirst({ where: { id: templateId, organizationId }, select: letterSelect });
    if (!row) throw new ClubLetterError("LETTER_NOT_FOUND", "That letter could not be found.");
    const who = auditActor(actor);
    await writeAuditLog({
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_LETTER_UPDATED",
      entityType: "ClubLetterTemplate",
      entityId: row.id,
      summary: `Changed a ${row.kind === "CERTIFICATE" ? "certificate" : "letter"} template for the club.`,
      metadata: { organizationId, kind: row.kind, title: row.title, ...who.metadata },
    }, tx);
    return toView(row);
  });
}

/** Deletes one of this club's templates. Needs the feature on. Audited with the same details as the add. */
export async function deleteClubLetter(organizationId: string, templateId: string, actor: ClubLetterActor): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    await requireFeature(organizationId);
    const row = await tx.clubLetterTemplate.findFirst({ where: { id: templateId, organizationId }, select: { id: true, kind: true, title: true } });
    if (!row) throw new ClubLetterError("LETTER_NOT_FOUND", "That letter could not be found.");
    const removed = await tx.clubLetterTemplate.deleteMany({ where: { id: row.id, organizationId } });
    if (removed.count === 0) throw new ClubLetterError("LETTER_NOT_FOUND", "That letter could not be found.");
    const who = auditActor(actor);
    await writeAuditLog({
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "CLUB_LETTER_DELETED",
      entityType: "ClubLetterTemplate",
      entityId: row.id,
      summary: `Deleted a ${row.kind === "CERTIFICATE" ? "certificate" : "letter"} template from the club.`,
      metadata: { organizationId, kind: row.kind, title: row.title, ...who.metadata },
    }, tx);
  });
}
