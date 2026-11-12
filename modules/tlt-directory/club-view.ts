import "server-only";

import { getPrisma } from "@/lib/prisma";
import { clubYearFor } from "@/modules/club-rosters/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * What a club's own director and deputies see about their TLTs on the club roster (#1686, Caleb, November 12): each
 * TLT's TLT year and help-area tags, read-only. Position type and status stay with the TLT director.
 */
export type ClubTltDetail = { tltYear: number | null; tags: string[] };

/** Director and deputy only (the roster's `manageTeam` capability). A registrar, a reporter, an Area Coordinator or anyone else gets nothing. */
export function clubTltDetailsVisible(capabilities: Pick<ClubCapabilities, "manageTeam">, readOnlyYear: boolean) {
  return capabilities.manageTeam === true && !readOnlyYear;
}

/**
 * Year and tags for the TLTs on ONE club's current roster, keyed by roster member id. The roster rows are read by
 * `organizationId` first, so a person on another club's roster is never reached whatever ids are passed. Two reads for
 * the whole roster. Nothing else about the TLT (position, status, answers, other clubs) is read.
 */
export async function listClubTltDetails(organizationId: string, memberIds: readonly string[], now = new Date()): Promise<Record<string, ClubTltDetail>> {
  if (memberIds.length === 0) return {};
  const prisma = getPrisma();
  const members = await prisma.clubRosterMember.findMany({
    where: {
      organizationId,
      id: { in: [...memberIds] },
      clubYear: clubYearFor(now),
      attendeeType: "YOUTH",
      isTlt: true,
      status: "ACTIVE",
      personId: { not: null },
    },
    select: { id: true, personId: true },
  });
  const personIds = [...new Set(members.flatMap((member) => (member.personId ? [member.personId] : [])))];
  if (personIds.length === 0) return {};
  const profiles = await prisma.tltProfile.findMany({
    where: { personId: { in: personIds } },
    select: { personId: true, tltYear: true, tags: { select: { tag: { select: { name: true, sortOrder: true } } } } },
  });
  const byPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  const details: Record<string, ClubTltDetail> = {};
  for (const member of members) {
    const profile = byPerson.get(member.personId!);
    details[member.id] = {
      tltYear: profile?.tltYear ?? null,
      tags: (profile?.tags ?? [])
        .map((link) => link.tag)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "en-US"))
        .map((tag) => tag.name),
    };
  }
  return details;
}
