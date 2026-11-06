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

/**
 * What the editor last saw of the draft: its id and `updatedAt` (as returned by the state read or a save), or null for
 * "there was no draft". A save, publish or discard carrying it is refused with 409 when the draft has since changed, so
 * two editors cannot silently overwrite each other. Omitted (undefined) by callers that do not track it, which skips
 * the check, as the homepage editor does (#1601).
 */
export type PublicClubFormsDraftBase = { id: string; updatedAt: string } | null;

export const staleMessage = "Someone else changed this page. Reload to see their changes.";
const staleDraft = () => new ClubFormError("DRAFT_CHANGED", staleMessage);

function matchesBase(draft: { id: string; updatedAt: Date } | null, base: PublicClubFormsDraftBase | undefined) {
  if (base === undefined) return true;
  if (base === null) return draft === null;
  return draft !== null && draft.id === base.id && draft.updatedAt.toISOString() === base.updatedAt;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
  /** With `draftUpdatedAt`, the version the editor sends back as `base`. */
  draftId: string | null;
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
    draftId: draftRow ? draftRow.id : null,
    draftUpdatedAt: draftRow ? draftRow.updatedAt.toISOString() : null,
    publishedAt: publishedRow ? publishedRow.updatedAt.toISOString() : null,
    draftDiffers: draft ? changedPublicClubFormsKeys(published, draft).length > 0 : false,
  };
}

/**
 * Saves the working draft and audits it. Saving never changes what visitors see. The row is only changed while it is
 * still the draft and unchanged since it was read, so another save or a publish in between is a 409, not a lost update.
 */
export async function savePublicClubFormsDraft(input: unknown, actorUserId: string, base?: PublicClubFormsDraftBase) {
  const content = completePublicClubFormsSettings(validatePublicClubFormsSettings(input));
  try {
    return await getPrisma().$transaction(async (tx) => {
      const live = await tx.publicClubFormsSetting.findUnique({ where: { status: "PUBLISHED" }, select: { content: true } });
      const existing = await tx.publicClubFormsSetting.findUnique({ where: { status: "DRAFT" }, select: { id: true, updatedAt: true } });
      if (!matchesBase(existing, base)) throw staleDraft();
      let id: string;
      if (existing) {
        const changed = await tx.publicClubFormsSetting.updateMany({
          where: { id: existing.id, status: "DRAFT", updatedAt: existing.updatedAt },
          data: { content: asJson(content), updatedByUserId: actorUserId },
        });
        if (changed.count !== 1) throw staleDraft();
        id = existing.id;
      } else {
        id = (await tx.publicClubFormsSetting.create({ data: { status: "DRAFT", content: asJson(content), updatedByUserId: actorUserId } })).id;
      }
      const row = await tx.publicClubFormsSetting.findUniqueOrThrow({ where: { id } });
      await writeAuditLog({
        actorUserId,
        action: "PUBLIC_CLUB_FORMS_DRAFT_SAVED",
        entityType: "PublicClubFormsSetting",
        entityId: row.id,
        summary: "Saved the public Club forms page draft.",
        metadata: { changedKeys: changedPublicClubFormsKeys(live ? parsePublicClubFormsSettings(live.content) : null, content) },
      }, tx);
      return { draftId: row.id, draftUpdatedAt: row.updatedAt.toISOString() };
    });
  } catch (error) {
    // A second first save at the same moment: the database allows one draft only.
    if (isUniqueViolation(error)) throw staleDraft();
    throw error;
  }
}

/** Publishes the draft: it becomes the one PUBLISHED version and the draft is cleared, in one transaction. */
export async function publishPublicClubFormsDraft(actorUserId: string, base?: PublicClubFormsDraftBase) {
  return getPrisma().$transaction(async (tx) => {
    const draft = await tx.publicClubFormsSetting.findUnique({ where: { status: "DRAFT" } });
    if (!draft) {
      if (base) throw staleDraft();
      throw new ClubFormError("VALIDATION_FAILED", "There is no draft to publish. Save a draft first.");
    }
    if (!matchesBase(draft, base)) throw staleDraft();
    const content = parsePublicClubFormsSettings(draft.content);
    if (!content) throw new ClubFormError("VALIDATION_FAILED", "The draft no longer fits the rules. Fix it and save again before publishing.");
    // Claim the draft first, conditional on it being unchanged since it was read: a save or a second publish at the
    // same moment changes nothing and reports a conflict, so what goes live is exactly what the audit row describes.
    const claimed = await tx.publicClubFormsSetting.deleteMany({ where: { id: draft.id, status: "DRAFT", updatedAt: draft.updatedAt } });
    if (claimed.count !== 1) throw staleDraft();
    const previous = await tx.publicClubFormsSetting.findUnique({ where: { status: "PUBLISHED" }, select: { content: true } });
    const row = await tx.publicClubFormsSetting.upsert({
      where: { status: "PUBLISHED" },
      create: { status: "PUBLISHED", content: asJson(content), updatedByUserId: actorUserId },
      update: { content: asJson(content), updatedByUserId: actorUserId },
    });
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

/** Throws the working draft away; the published settings are untouched. Only a draft unchanged since it was read is deleted. */
export async function discardPublicClubFormsDraft(actorUserId: string, base?: PublicClubFormsDraftBase) {
  await getPrisma().$transaction(async (tx) => {
    const draft = await tx.publicClubFormsSetting.findUnique({ where: { status: "DRAFT" }, select: { id: true, updatedAt: true } });
    if (!draft) {
      if (base) throw staleDraft();
      throw new ClubFormError("VALIDATION_FAILED", "There is no draft to discard.");
    }
    if (!matchesBase(draft, base)) throw staleDraft();
    const removed = await tx.publicClubFormsSetting.deleteMany({ where: { id: draft.id, status: "DRAFT", updatedAt: draft.updatedAt } });
    if (removed.count !== 1) throw staleDraft();
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
