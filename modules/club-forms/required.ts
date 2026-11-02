import "server-only";

import { getPrisma } from "@/lib/prisma";
import { computeRequiredForms, isRequirement, type ClubRequiredForms, type RequiredTemplate } from "@/modules/club-forms/required-domain";
import { formatPersonName } from "@/lib/person-name";

/**
 * Where each active club stands on the forms staff marked required (#1246), for one club year. Reads only: it
 * authorizes nothing, so every caller (the Clubs dashboard card, its list page, a director's Forms page) has already
 * passed its own gate. Counts and the names a director already sees on the roster; never an answer.
 *
 * Done means a SUBMITTED entry in that club year (a draft does not count). Only enabled forms are counted.
 * `organizationIds` narrows to those clubs (the director page passes its own club); omitted means every active club.
 */
export async function getRequiredFormsStatus(clubYear: string, organizationIds?: readonly string[]): Promise<ClubRequiredForms[]> {
  const prisma = getPrisma();
  const templateRows = await prisma.clubFormTemplate.findMany({
    where: { enabled: true, requirement: { not: "NOT_REQUIRED" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, key: true, name: true, requirement: true, requiredRoles: true },
  });
  const templates: RequiredTemplate[] = templateRows.flatMap((row) => (isRequirement(row.requirement) ? [{ key: row.key, name: row.name, requirement: row.requirement, requiredRoles: row.requiredRoles }] : []));
  const clubRows = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true, ...(organizationIds ? { id: { in: [...organizationIds] } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentOrganization: { select: { name: true } } },
  });
  if (templates.length === 0) {
    return computeRequiredForms({ templates, clubs: clubRows.map((club) => ({ id: club.id, name: club.name, church: club.parentOrganization?.name ?? "" })), members: [], submissions: [] });
  }
  const clubIds = clubRows.map((club) => club.id);
  const needsMembers = templateRows.some((row) => row.requirement === "PER_ROLE_MEMBER_YEAR");
  const [memberRows, submissionRows] = await Promise.all([
    needsMembers
      ? prisma.clubRosterMember.findMany({
        // Members with no linked person are left out, matching the roster choices a director can send a link for.
        where: { organizationId: { in: clubIds }, clubYear, status: "ACTIVE", personId: { not: null } },
        select: { id: true, organizationId: true, attendeeType: true, person: { select: { firstName: true, lastName: true } } },
      })
      : Promise.resolve([]),
    prisma.clubFormSubmission.findMany({
      where: { organizationId: { in: clubIds }, clubYear, status: "SUBMITTED", templateId: { in: templateRows.map((row) => row.id) } },
      select: { organizationId: true, rosterMemberId: true, template: { select: { key: true } } },
    }),
  ]);
  return computeRequiredForms({
    templates,
    clubs: clubRows.map((club) => ({ id: club.id, name: club.name, church: club.parentOrganization?.name ?? "" })),
    members: memberRows.map((member) => ({
      id: member.id,
      organizationId: member.organizationId,
      attendeeType: member.attendeeType,
      name: member.person ? formatPersonName(member.person) : "Unnamed member",
    })),
    submissions: submissionRows.flatMap((row) => (row.organizationId ? [{ templateKey: row.template.key, organizationId: row.organizationId, rosterMemberId: row.rosterMemberId }] : [])),
  });
}
