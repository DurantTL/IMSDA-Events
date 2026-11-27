import "server-only";

import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isClubFeatureEnabled, type ClubFeatureActor } from "@/modules/club-features/repository";
import {
  CLUB_CERTIFICATES_FEATURE_KEY,
  ISSUED_CERTIFICATES_LIST_MAX,
  canManageClubCertificates,
  certificateActiveKey,
  certificateRefId,
  classCandidates,
  generateCertificateCode,
  normalizeCertificateCode,
  honorCandidates,
  selectCertificates,
  sortCandidates,
  parseCertificateItems,
  type CertificateCandidate,
  type CertificateCheckRecord,
  type IssuedCertificateRow,
} from "@/modules/club-certificates/domain";
import { clubYearFor, type ClubClassLevel } from "@/modules/club-rosters/domain";
import { listClubHonorsPage } from "@/modules/honors/member-honor-repository";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/** Whether this viewer and club may use certificates: the one check the pages and the access tests share. */
export async function clubCertificatesAvailable(organizationId: string, capabilities: Pick<ClubCapabilities, "editProfile">): Promise<boolean> {
  if (!canManageClubCertificates(capabilities)) return false;
  return isClubFeatureEnabled(organizationId, CLUB_CERTIFICATES_FEATURE_KEY);
}

/**
 * Every current completion for people on this club's active roster this club year: honors from the current-status
 * reader (a voided entry never counts) and the club's own class completions.
 */
async function loadCandidates(organizationId: string, now: Date): Promise<CertificateCandidate[]> {
  const clubYear = clubYearFor(now);
  const prisma = getPrisma();
  const honorRows = await listClubHonorsPage(organizationId, clubYear);
  const members = await prisma.clubRosterMember.findMany({
    where: { organizationId, clubYear, status: "ACTIVE", personId: { not: null } },
    select: { id: true, personId: true, person: { select: { firstName: true, lastName: true } } },
    orderBy: { id: "asc" },
  });
  const memberByPerson = new Map<string, { id: string; firstName: string; lastName: string }>();
  const personIdByMember = new Map<string, string>();
  for (const member of members) {
    if (member.personId && member.person && !memberByPerson.has(member.personId)) {
      memberByPerson.set(member.personId, { id: member.id, firstName: member.person.firstName, lastName: member.person.lastName });
      personIdByMember.set(member.id, member.personId);
    }
  }
  const completions = memberByPerson.size === 0 ? [] : await prisma.memberClassCompletion.findMany({
    where: { organizationId, personId: { in: [...memberByPerson.keys()] } },
    select: { personId: true, classLevel: true, completedOn: true },
  });
  const classRows = completions.flatMap((completion) => {
    const member = memberByPerson.get(completion.personId);
    return member ? [{ memberId: member.id, personId: completion.personId, firstName: member.firstName, lastName: member.lastName, classLevel: completion.classLevel as ClubClassLevel, completedOn: completion.completedOn }] : [];
  });
  return sortCandidates([...honorCandidates(honorRows, organizationId, personIdByMember), ...classCandidates(classRows)]);
}

export type ClubCertificateList = { clubYear: string; clubName: string; candidates: CertificateCandidate[]; issued: { total: number; rows: IssuedCertificateRow[] } };

/** The completions to list, or null when this viewer or club may not use certificates. */
export async function loadClubCertificates(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  now = new Date(),
): Promise<ClubCertificateList | null> {
  if (!(await clubCertificatesAvailable(organizationId, capabilities))) return null;
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return { clubYear: clubYearFor(now), clubName: club?.name ?? "", candidates: await loadCandidates(organizationId, now), issued: await listIssuedCertificates(organizationId) };
}

/** This club's printed certificates, newest first, the latest few with the full count. */
async function listIssuedCertificates(organizationId: string): Promise<{ total: number; rows: IssuedCertificateRow[] }> {
  const prisma = getPrisma();
  const [total, rows] = await Promise.all([
    prisma.clubCertificate.count({ where: { organizationId } }),
    prisma.clubCertificate.findMany({
      where: { organizationId },
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      take: ISSUED_CERTIFICATES_LIST_MAX,
      select: { id: true, code: true, title: true, kind: true, completedOn: true, issuedAt: true, voidedAt: true, person: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      firstName: row.person?.firstName ?? null,
      lastName: row.person?.lastName ?? null,
      title: row.title,
      kind: row.kind,
      completedOn: row.completedOn,
      issuedAt: row.issuedAt.toISOString(),
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    })),
  };
}

export type CertificateSheet = CertificateCandidate & { code: string };
export type ClubCertificateSheets = { clubName: string; sheets: CertificateSheet[] };

const CODE_ATTEMPTS = 6;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function issuerColumns(actor: ClubFeatureActor) {
  return "accountId" in actor ? { issuedByAccountId: actor.accountId } : { issuedByUserId: actor.userId };
}

function actorMetadata(actor: ClubFeatureActor) {
  return "accountId" in actor
    ? { actorAttendeeAccountId: actor.accountId }
    : { ...(actor.actAsId ? { actAsId: actor.actAsId } : {}), ...(actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}) };
}

/**
 * The record of each sheet: the valid one for this completion when there is one (a reprint keeps its number), otherwise
 * a new one with a fresh verification number. A voided certificate is never reused. Two prints at once end in one row:
 * the loser of the unique key re-reads the winner's, and a number that collides is drawn again.
 */
async function issueSheets(organizationId: string, clubName: string, candidates: CertificateCandidate[], actor: ClubFeatureActor): Promise<{ sheets: CertificateSheet[]; createdIds: string[] }> {
  const prisma = getPrisma();
  const keyOf = (candidate: CertificateCandidate) => certificateActiveKey({ organizationId, personId: candidate.personId, kind: candidate.kind, refId: certificateRefId(candidate), completedOn: candidate.completedOn });
  const existing = candidates.length === 0 ? [] : await prisma.clubCertificate.findMany({ where: { activeKey: { in: candidates.map(keyOf) } }, select: { activeKey: true, code: true } });
  const codeByKey = new Map(existing.flatMap((row) => (row.activeKey ? [[row.activeKey, row.code] as const] : [])));
  const createdIds: string[] = [];
  const sheets: CertificateSheet[] = [];
  for (const candidate of candidates) {
    const activeKey = keyOf(candidate);
    let code = codeByKey.get(activeKey);
    for (let attempt = 0; !code && attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        const created = await prisma.clubCertificate.create({
          data: {
            code: generateCertificateCode(randomInt),
            organizationId,
            personId: candidate.personId,
            kind: candidate.kind,
            refId: certificateRefId(candidate),
            title: candidate.title,
            completedOn: candidate.completedOn,
            clubName,
            activeKey,
            ...issuerColumns(actor),
          },
          select: { id: true, code: true },
        });
        createdIds.push(created.id);
        code = created.code;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Either another print made this certificate first (use theirs) or the number collided (draw another).
        const winner = await prisma.clubCertificate.findUnique({ where: { activeKey }, select: { code: true } });
        if (winner) code = winner.code;
      }
    }
    if (!code) throw new Error("A certificate number could not be made. Try printing again.");
    sheets.push({ ...candidate, code });
  }
  return { sheets, createdIds };
}

/**
 * The certificates to print. Each requested item is re-checked on the server against this club's current completions;
 * anything else (another club's member, a voided or replaced entry, a made-up key) is dropped without a word. Each kept
 * one is recorded with its verification number, or gets the number it already has (#2052). Null when this viewer or
 * club may not use certificates.
 */
export async function loadCertificateSheets(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  items: string | string[] | undefined,
  actor: ClubFeatureActor,
  now = new Date(),
): Promise<ClubCertificateSheets | null> {
  if (!(await clubCertificatesAvailable(organizationId, capabilities))) return null;
  const keys = parseCertificateItems(items);
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const clubName = club?.name ?? "";
  const chosen = keys.length === 0 ? [] : selectCertificates(keys, await loadCandidates(organizationId, now));
  const { sheets, createdIds } = await issueSheets(organizationId, clubName, chosen, actor);
  if (createdIds.length > 0) {
    await writeAuditLog({
      ...("userId" in actor ? { actorUserId: actor.userId } : {}),
      action: "CLUB_CERTIFICATES_ISSUED",
      entityType: "ClubCertificate",
      entityId: createdIds[0],
      summary: `Printed ${createdIds.length} ${createdIds.length === 1 ? "certificate" : "certificates"} for the club.`,
      metadata: { organizationId, certificateIds: createdIds, count: createdIds.length, ...actorMetadata(actor) },
    });
  }
  return { clubName, sheets };
}

/**
 * Voids one of this club's valid certificates: the row stays as history, its key is freed, and the check page then says
 * it was withdrawn. False (nothing changed, nothing said about whose it is) when this viewer or club may not use
 * certificates, or the certificate is not this club's or is already voided.
 */
export async function voidClubCertificate(
  organizationId: string,
  certificateId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  actor: ClubFeatureActor,
  now = new Date(),
): Promise<boolean> {
  if (!(await clubCertificatesAvailable(organizationId, capabilities))) return false;
  const result = await getPrisma().clubCertificate.updateMany({
    where: { id: certificateId, organizationId, voidedAt: null },
    data: { voidedAt: now, activeKey: null, ...("accountId" in actor ? { voidedByAccountId: actor.accountId } : { voidedByUserId: actor.userId }) },
  });
  if (result.count === 0) return false;
  await writeAuditLog({
    ...("userId" in actor ? { actorUserId: actor.userId } : {}),
    action: "CLUB_CERTIFICATE_VOIDED",
    entityType: "ClubCertificate",
    entityId: certificateId,
    summary: "Voided a printed certificate for the club.",
    metadata: { organizationId, certificateId, ...actorMetadata(actor) },
  });
  return true;
}

/**
 * The public check (#2052): one certificate by the number written on it, with only the fields the check page may show.
 * Null for a malformed or unknown number alike. Works whether or not the club still has the feature switched on, since
 * the certificate was really issued.
 */
export async function findCertificateForCheck(rawCode: string): Promise<CertificateCheckRecord | null> {
  const code = normalizeCertificateCode(rawCode);
  if (!code) return null;
  const row = await getPrisma().clubCertificate.findUnique({ where: { code }, select: { kind: true, title: true, completedOn: true, clubName: true, voidedAt: true } });
  return row;
}
