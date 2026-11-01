import "server-only";

import { z } from "zod";
import { emailToStore, phoneToStore } from "@/lib/field-validation";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import type { ClubProfileInput } from "@/modules/organizations/club-profile-schemas";
import { SPONSOR_ORGANIZATION_TYPES, canSponsorClub, normalizeOrganizationName } from "@/modules/organizations/domain";
import { OrganizationOperationError } from "@/modules/organizations/repository";

/**
 * Club profile (#375): the club's name, sponsoring church, meeting details,
 * and public contact. Edited by the club's director or deputy, or by
 * conference staff. Every save is audited with the fields that changed.
 */

/** `actAsId` is set for a staff "act as" director (#442); never both `userId` and `accountId`. */
export type ClubProfileActor = { userId: string; actAsId?: string } | { accountId: string };

const profileFields = ["meetingPlace", "meetingSchedule", "contactEmail", "contactPhone", "publicDescription", "listPublicly"] as const;

export async function getClubProfile(organizationId: string) {
  const club = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      type: true,
      name: true,
      isActive: true,
      parentOrganization: { select: { id: true, name: true } },
      clubProfile: true,
    },
  });
  if (!club || club.type !== "CLUB") return null;
  const profile = club.clubProfile;
  return {
    id: club.id,
    name: club.name,
    isActive: club.isActive,
    sponsoringChurchId: club.parentOrganization?.id ?? null,
    sponsoringChurchName: club.parentOrganization?.name ?? null,
    meetingPlace: profile?.meetingPlace ?? "",
    meetingSchedule: profile?.meetingSchedule ?? "",
    contactEmail: profile?.contactEmail ?? "",
    contactPhone: profile?.contactPhone ?? "",
    publicDescription: profile?.publicDescription ?? "",
    listPublicly: profile?.listPublicly ?? false,
    updatedAt: profile?.updatedAt.toISOString() ?? null,
  };
}

export type ClubProfileRecord = NonNullable<Awaited<ReturnType<typeof getClubProfile>>>;

/** Active churches, companies and groups a club may name as its sponsor (#822), plus the club's current one even if inactive. */
export async function listSponsorOptions(currentSponsorId: string | null = null) {
  const sponsors = await getPrisma().organization.findMany({
    where: { type: { in: [...SPONSOR_ORGANIZATION_TYPES] }, OR: [{ isActive: true }, ...(currentSponsorId ? [{ id: currentSponsorId }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true },
  });
  return sponsors;
}

/**
 * The contact email and phone to store (#1451). A changed value has to pass the shared check and a phone is stored
 * normalised; a value equal to the one in the database is kept exactly as stored, so an old bad one never blocks saving
 * another field and is never rewritten. `stored` is read from the database, never the request. Both problems are
 * reported together, without the values.
 */
function contactToStore(input: ClubProfileInput, stored: { contactEmail: string; contactPhone: string } | null) {
  const issues: z.core.$ZodIssue[] = [];
  const attempt = (work: () => string) => {
    try {
      return work();
    } catch (error) {
      if (error instanceof z.ZodError) issues.push(...error.issues);
      else throw error;
      return "";
    }
  };
  const contactEmail = attempt(() => emailToStore(["contactEmail"], input.contactEmail, stored?.contactEmail));
  const contactPhone = attempt(() => phoneToStore(["contactPhone"], input.contactPhone, stored?.contactPhone));
  if (issues.length > 0) throw new z.ZodError(issues);
  return { contactEmail, contactPhone };
}

export async function updateClubProfile(organizationId: string, submitted: ClubProfileInput, actor: ClubProfileActor) {
  await getPrisma().$transaction(async (tx) => {
    const club = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, type: true, name: true, parentOrganizationId: true, clubProfile: true },
    });
    if (!club || club.type !== "CLUB") {
      throw new OrganizationOperationError("ORGANIZATION_NOT_FOUND", "That club could not be found.");
    }
    const input = { ...submitted, ...contactToStore(submitted, club.clubProfile) };
    if (input.sponsoringChurchId === null) {
      throw new OrganizationOperationError("ORGANIZATION_PARENT_REQUIRED", "Choose the club's sponsoring church or company. Every club needs one.");
    }
    if (input.sponsoringChurchId !== club.parentOrganizationId) {
      const church = await tx.organization.findUnique({
        where: { id: input.sponsoringChurchId },
        select: { type: true, isActive: true },
      });
      if (!canSponsorClub(church)) {
        throw new OrganizationOperationError("ORGANIZATION_PARENT_INVALID", "Choose an active church or company as the club's sponsor.");
      }
    }

    const changed: string[] = [];
    if (input.name !== club.name) changed.push("name");
    if (input.sponsoringChurchId !== club.parentOrganizationId) changed.push("sponsoringChurch");
    for (const field of profileFields) {
      const before = club.clubProfile?.[field] ?? (field === "listPublicly" ? false : "");
      if (input[field] !== before) changed.push(field);
    }
    if (changed.length === 0) return;

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        name: input.name,
        normalizedName: normalizeOrganizationName(input.name),
        parentOrganizationId: input.sponsoringChurchId,
      },
    });
    const details = {
      meetingPlace: input.meetingPlace,
      meetingSchedule: input.meetingSchedule,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      publicDescription: input.publicDescription,
      listPublicly: input.listPublicly,
    };
    await tx.clubProfile.upsert({
      where: { organizationId },
      create: { organizationId, ...details },
      update: details,
    });
    await writeAuditLog({
      ...("userId" in actor ? { actorUserId: actor.userId } : {}),
      action: "CLUB_PROFILE_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
      summary: `Updated the club profile for ${input.name}.`,
      metadata: {
        organizationId,
        fields: changed,
        ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : actor.actAsId ? { actAsId: actor.actAsId } : {}),
      },
    }, tx);
  });
  return getClubProfile(organizationId);
}
