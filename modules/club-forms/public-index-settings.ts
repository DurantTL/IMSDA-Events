import "server-only";

import { cache } from "react";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ClubFormError } from "@/modules/club-forms/errors";
import {
  changedPublicClubFormsKeys,
  completePublicClubFormsSettings,
  parsePublicClubFormsSettings,
  publicClubFormsProblem,
  publicClubFormsSettingsSchema,
  type PublicClubFormsSettings,
} from "@/modules/club-forms/public-index-settings-domain";

/**
 * The public Club forms page's settings store (#1562): one working draft and one published version, each change
 * audited. The caller has passed `requireClubsAdministration`; nothing here checks who is asking.
 */

const asJson = (content: PublicClubFormsSettings) => content as unknown as Prisma.InputJsonValue;

export function validatePublicClubFormsSettings(input: unknown): PublicClubFormsSettings {
  const parsed = publicClubFormsSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ClubFormError("VALIDATION_FAILED", publicClubFormsProblem(parsed.error));
  return parsed.data;
}

/** What the public page shows: the published settings, or null (today's built-in page). Never throws. */
export const getPublishedPublicClubFormsSettings = cache(async (): Promise<PublicClubFormsSettings | null> => {
  try {
    const row = await getPrisma().publicClubFormsSetting.findUnique({ where: { status: "PUBLISHED" }, select: { id: true, content: true } });
    if (!row) return null;
    const parsed = parsePublicClubFormsSettings(row.content);
    if (!parsed) logWarn("Published public club forms settings did not match the rules; showing the built-in page", { settingId: row.id });
    return parsed;
  } catch (error) {
    logWarn("Reading the public club forms settings failed; showing the built-in page", { reason: error instanceof Error ? error.name : "unknown" });
    return null;
  }
});

/** The working draft for the preview, or null when there is none. */
export async function getDraftPublicClubFormsSettings(): Promise<PublicClubFormsSettings | null> {
  const row = await getPrisma().publicClubFormsSetting.findUnique({ where: { status: "DRAFT" }, select: { content: true } });
  return row ? parsePublicClubFormsSettings(row.content) : null;
}

export type PublicClubFormsAdminState = {
  /** What the editor starts from, complete: the draft, else the published settings, else today's page. */
  content: PublicClubFormsSettings;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
  /** Whether the draft differs from what is live (or from today's built-in page when nothing is published). */
  draftDiffers: boolean;
};

export async function getPublicClubFormsAdminState(): Promise<PublicClubFormsAdminState> {
  const rows = await getPrisma().publicClubFormsSetting.findMany({ where: { status: { in: ["DRAFT", "PUBLISHED"] } } });
  const draftRow = rows.find((row) => row.status === "DRAFT");
  const publishedRow = rows.find((row) => row.status === "PUBLISHED");
  const draft = draftRow ? parsePublicClubFormsSettings(draftRow.content) : null;
  const published = publishedRow ? parsePublicClubFormsSettings(publishedRow.content) : null;
  return {
    content: completePublicClubFormsSettings(draft ?? published),
    hasDraft: Boolean(draftRow),
    draftUpdatedAt: draftRow ? draftRow.updatedAt.toISOString() : null,
    publishedAt: publishedRow ? publishedRow.updatedAt.toISOString() : null,
    draftDiffers: draft ? changedPublicClubFormsKeys(published, draft).length > 0 : false,
  };
}

/** Saves the working draft and audits it. Saving never changes what visitors see. */
export async function savePublicClubFormsDraft(input: unknown, actorUserId: string) {
  const content = completePublicClubFormsSettings(validatePublicClubFormsSettings(input));
  return getPrisma().$transaction(async (tx) => {
    const live = await tx.publicClubFormsSetting.findUnique({ where: { status: "PUBLISHED" }, select: { content: true } });
    const row = await tx.publicClubFormsSetting.upsert({
      where: { status: "DRAFT" },
      create: { status: "DRAFT", content: asJson(content), updatedByUserId: actorUserId },
      update: { content: asJson(content), updatedByUserId: actorUserId },
    });
    await writeAuditLog({
      actorUserId,
      action: "PUBLIC_CLUB_FORMS_DRAFT_SAVED",
      entityType: "PublicClubFormsSetting",
      entityId: row.id,
      summary: "Saved the public Club forms page draft.",
      metadata: { changedKeys: changedPublicClubFormsKeys(live ? parsePublicClubFormsSettings(live.content) : null, content) },
    }, tx);
    return { draftUpdatedAt: row.updatedAt.toISOString() };
  });
}

/** Publishes the draft: it becomes the one PUBLISHED version and the draft is cleared, in one transaction. */
export async function publishPublicClubFormsDraft(actorUserId: string) {
  return getPrisma().$transaction(async (tx) => {
    const draft = await tx.publicClubFormsSetting.findUnique({ where: { status: "DRAFT" } });
    if (!draft) throw new ClubFormError("VALIDATION_FAILED", "There is no draft to publish. Save a draft first.");
    const content = parsePublicClubFormsSettings(draft.content);
    if (!content) throw new ClubFormError("VALIDATION_FAILED", "The draft no longer fits the rules. Fix it and save again before publishing.");
    const previous = await tx.publicClubFormsSetting.findUnique({ where: { status: "PUBLISHED" }, select: { content: true } });
    const row = await tx.publicClubFormsSetting.upsert({
      where: { status: "PUBLISHED" },
      create: { status: "PUBLISHED", content: asJson(content), updatedByUserId: actorUserId },
      update: { content: asJson(content), updatedByUserId: actorUserId },
    });
    await tx.publicClubFormsSetting.delete({ where: { id: draft.id } });
    await writeAuditLog({
      actorUserId,
      action: "PUBLIC_CLUB_FORMS_PUBLISHED",
      entityType: "PublicClubFormsSetting",
      entityId: row.id,
      summary: "Published the public Club forms page.",
      metadata: { changedKeys: changedPublicClubFormsKeys(previous ? parsePublicClubFormsSettings(previous.content) : null, content) },
    }, tx);
    return { publishedAt: row.updatedAt.toISOString() };
  });
}

/** Throws the working draft away; the published settings are untouched. */
export async function discardPublicClubFormsDraft(actorUserId: string) {
  await getPrisma().$transaction(async (tx) => {
    const draft = await tx.publicClubFormsSetting.findUnique({ where: { status: "DRAFT" }, select: { id: true } });
    if (!draft) throw new ClubFormError("VALIDATION_FAILED", "There is no draft to discard.");
    await tx.publicClubFormsSetting.delete({ where: { id: draft.id } });
    await writeAuditLog({
      actorUserId,
      action: "PUBLIC_CLUB_FORMS_DRAFT_DISCARDED",
      entityType: "PublicClubFormsSetting",
      entityId: draft.id,
      summary: "Discarded the public Club forms page draft.",
      metadata: {},
    }, tx);
  });
}
