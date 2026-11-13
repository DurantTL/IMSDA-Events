import "server-only";

import { getPrisma } from "@/lib/prisma";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import {
  CLUB_CERTIFICATES_FEATURE_KEY,
  canManageClubCertificates,
  classCandidates,
  honorCandidates,
  selectCertificates,
  sortCandidates,
  parseCertificateItems,
  type CertificateCandidate,
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
  for (const member of members) {
    if (member.personId && member.person && !memberByPerson.has(member.personId)) {
      memberByPerson.set(member.personId, { id: member.id, firstName: member.person.firstName, lastName: member.person.lastName });
    }
  }
  const completions = memberByPerson.size === 0 ? [] : await prisma.memberClassCompletion.findMany({
    where: { organizationId, personId: { in: [...memberByPerson.keys()] } },
    select: { personId: true, classLevel: true, completedOn: true },
  });
  const classRows = completions.flatMap((completion) => {
    const member = memberByPerson.get(completion.personId);
    return member ? [{ memberId: member.id, firstName: member.firstName, lastName: member.lastName, classLevel: completion.classLevel as ClubClassLevel, completedOn: completion.completedOn }] : [];
  });
  return sortCandidates([...honorCandidates(honorRows, organizationId), ...classCandidates(classRows)]);
}

export type ClubCertificateList = { clubYear: string; clubName: string; candidates: CertificateCandidate[] };

/** The completions to list, or null when this viewer or club may not use certificates. */
export async function loadClubCertificates(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  now = new Date(),
): Promise<ClubCertificateList | null> {
  if (!(await clubCertificatesAvailable(organizationId, capabilities))) return null;
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return { clubYear: clubYearFor(now), clubName: club?.name ?? "", candidates: await loadCandidates(organizationId, now) };
}

export type ClubCertificateSheets = { clubName: string; sheets: CertificateCandidate[] };

/**
 * The certificates to print. Each requested item is re-checked on the server against this club's current completions;
 * anything else (another club's member, a voided or replaced entry, a made-up key) is dropped without a word. Null when
 * this viewer or club may not use certificates.
 */
export async function loadCertificateSheets(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  items: string | string[] | undefined,
  now = new Date(),
): Promise<ClubCertificateSheets | null> {
  if (!(await clubCertificatesAvailable(organizationId, capabilities))) return null;
  const keys = parseCertificateItems(items);
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const sheets = keys.length === 0 ? [] : selectCertificates(keys, await loadCandidates(organizationId, now));
  return { clubName: club?.name ?? "", sheets };
}
