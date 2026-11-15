import { getPrisma } from "@/lib/prisma";
import { resolveEmailLook, type EmailLook } from "./email-look";

/** The database reads behind the email look, as one injectable piece so delivery tests need no database. */
export type EmailLookSource = {
  /** The id of the event's PUBLISHED version, or null when it uses the platform look. */
  findPublishedVersionId: (eventId: string) => Promise<string | null>;
  /** Whether the event's club emails use its registration look. Off by default: club mail keeps the platform header. */
  clubEmailsUseLook: (eventId: string) => Promise<boolean>;
  /** The look of one stored version, or null when the platform layout applies. */
  loadLook: (versionId: string, appOrigin: string | null) => Promise<EmailLook | null>;
};

export async function loadEmailLookByVersionId(versionId: string, appOrigin: string | null): Promise<EmailLook | null> {
  const prisma = getPrisma();
  const row = await prisma.registrationThemeVersion.findUnique({
    where: { id: versionId },
    select: {
      status: true,
      tokens: true,
      logoAssetId: true,
      event: { select: { slug: true, name: true, isPublished: true, archivedAt: true } },
    },
  });
  if (!row) return null;
  // The id is cleared when the upload is deleted, so a set id normally means the file exists; checked anyway.
  const logo = row.logoAssetId
    ? await prisma.eventAsset.findFirst({ where: { id: row.logoAssetId, event: { slug: row.event.slug } }, select: { id: true } })
    : null;
  return resolveEmailLook({ row, event: row.event, logoAssetExists: Boolean(logo), appOrigin });
}

export async function findPublishedThemeVersionId(eventId: string): Promise<string | null> {
  const row = await getPrisma().registrationThemeVersion.findFirst({ where: { eventId, status: "PUBLISHED" }, select: { id: true } });
  return row?.id ?? null;
}

export async function findClubEmailsUseLook(eventId: string): Promise<boolean> {
  const row = await getPrisma().event.findUnique({ where: { id: eventId }, select: { clubEmailsUseRegistrationLook: true } });
  return row?.clubEmailsUseRegistrationLook === true;
}

export const defaultEmailLookSource: EmailLookSource = {
  findPublishedVersionId: findPublishedThemeVersionId,
  clubEmailsUseLook: findClubEmailsUseLook,
  loadLook: loadEmailLookByVersionId,
};
