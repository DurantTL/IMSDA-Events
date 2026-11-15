import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { assetInlineUrl } from "@/modules/events/asset-repository";
import { readAsset } from "@/modules/events/asset-storage";
import { reconcileImageAlt, themeImageProblem, THEME_IMAGE_TYPES, type ThemeImageKind } from "./assets";
import { checkThemeContrast, describeContrastFailures, type ThemeContrastReport } from "./contrast";
import { registrationThemeTokensSchema, normalizeThemeTokens, type RegistrationThemeTokens } from "./tokens";

export type RegistrationThemeErrorCode = "INVALID_TOKENS" | "CONTRAST_FAILED" | "INVALID_ASSET" | "NO_DRAFT" | "NO_PUBLISHED" | "CONFLICT";

/** A refusal with a plain-language message that is safe to show to staff. */
export class RegistrationThemeError extends Error {
  constructor(
    public readonly code: RegistrationThemeErrorCode,
    message: string,
    public readonly report?: ThemeContrastReport,
  ) {
    super(message);
    this.name = "RegistrationThemeError";
  }
}

export function registrationThemeErrorStatus(code: RegistrationThemeErrorCode) {
  switch (code) {
    case "INVALID_TOKENS":
    case "INVALID_ASSET": return 400;
    case "CONTRAST_FAILED": return 422;
    case "NO_DRAFT":
    case "NO_PUBLISHED": return 404;
    case "CONFLICT": return 409;
  }
}

export type RegistrationThemeVersionView = {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  /** Null only if the stored tokens no longer pass the schema. */
  tokens: RegistrationThemeTokens | null;
  /** The chosen logo and banner uploads (null when none, or when the file was deleted). */
  logoAssetId: string | null;
  heroAssetId: string | null;
  createdAt: string;
  createdByName: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  archivedAt: string | null;
};

/** An image upload of the event that the logo and banner pickers offer. `url` is the staff inline URL, for thumbnails. */
export type RegistrationThemeImageChoice = { id: string; name: string; contentType: string; byteSize: number; url: string };

/** What the save request carries besides the tokens. A missing id keeps the draft's current image; null clears it. */
export type RegistrationThemeImageIds = { logoAssetId?: string | null; heroAssetId?: string | null };

export type RegistrationThemeEditorState = {
  draft: RegistrationThemeVersionView | null;
  published: RegistrationThemeVersionView | null;
  /** Earlier published looks, newest first. */
  history: RegistrationThemeVersionView[];
  /** The event's PNG, JPEG and WebP uploads, newest first. */
  images: RegistrationThemeImageChoice[];
};

const HISTORY_LIMIT = 10;
const personSelect = { select: { displayName: true } } as const;

type ThemeRow = {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  tokens: unknown;
  logoAssetId: string | null;
  heroAssetId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdBy?: { displayName: string } | null;
  publishedBy?: { displayName: string } | null;
};

function view(row: ThemeRow): RegistrationThemeVersionView {
  const parsed = registrationThemeTokensSchema.safeParse(row.tokens);
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status,
    tokens: parsed.success ? normalizeThemeTokens(parsed.data) : null,
    logoAssetId: row.logoAssetId,
    heroAssetId: row.heroAssetId,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy?.displayName ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedByName: row.publishedBy?.displayName ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** The event's published version as the resolver reads it, or null when the event uses the platform look. */
export async function getPublishedThemeRow(eventId: string) {
  return getPrisma().registrationThemeVersion.findFirst({
    where: { eventId, status: "PUBLISHED" },
    select: { status: true, tokens: true, logoAssetId: true, heroAssetId: true },
  });
}

export async function getPublishedThemeRowBySlug(eventSlug: string) {
  return getPrisma().registrationThemeVersion.findFirst({
    where: { status: "PUBLISHED", event: { slug: eventSlug } },
    select: { status: true, tokens: true, logoAssetId: true, heroAssetId: true },
  });
}

export async function getRegistrationThemeEditorState(eventId: string): Promise<RegistrationThemeEditorState> {
  const prisma = getPrisma();
  const include = { createdBy: personSelect, publishedBy: personSelect } as const;
  const [draft, published, history, assets] = await Promise.all([
    prisma.registrationThemeVersion.findFirst({ where: { eventId, status: "DRAFT" }, include }),
    prisma.registrationThemeVersion.findFirst({ where: { eventId, status: "PUBLISHED" }, include }),
    prisma.registrationThemeVersion.findMany({ where: { eventId, status: "ARCHIVED" }, include, orderBy: { versionNumber: "desc" }, take: HISTORY_LIMIT }),
    prisma.eventAsset.findMany({
      where: { eventId, contentType: { in: [...THEME_IMAGE_TYPES] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, displayName: true, contentType: true, byteSize: true },
    }),
  ]);
  const images = assets.map((asset) => ({ id: asset.id, name: asset.displayName, contentType: asset.contentType, byteSize: asset.byteSize, url: assetInlineUrl(eventId, asset.id) }));
  return { draft: draft ? view(draft) : null, published: published ? view(published) : null, history: history.map(view), images };
}

function validTokens(input: unknown): RegistrationThemeTokens {
  const parsed = registrationThemeTokensSchema.safeParse(input);
  if (!parsed.success) throw new RegistrationThemeError("INVALID_TOKENS", "One of the look settings isn't allowed. Colors must be six-digit hex values and fonts must come from the list.");
  return normalizeThemeTokens(parsed.data);
}

type AssetReader = {
  eventAsset: { findMany(args: { where: { id: { in: string[] } }; select: { id: true; eventId: true; contentType: true; byteSize: true; storageKey: true } }): Promise<{ id: string; eventId: string; contentType: string; byteSize: number; storageKey: string }[]> };
};

/**
 * Checks the chosen logo and banner against the event and the size, shape and description rules, and returns the tokens with
 * descriptions kept only for the images that are chosen. Runs on save and again on publish.
 */
async function checkedThemeImages(client: AssetReader, eventId: string, tokens: RegistrationThemeTokens, ids: { logoAssetId: string | null; heroAssetId: string | null }) {
  const wanted = [ids.logoAssetId, ids.heroAssetId].filter((id): id is string => Boolean(id));
  const found = wanted.length > 0
    ? await client.eventAsset.findMany({ where: { id: { in: wanted } }, select: { id: true, eventId: true, contentType: true, byteSize: true, storageKey: true } })
    : [];
  for (const [kind, id] of [["logo", ids.logoAssetId], ["hero", ids.heroAssetId]] as [ThemeImageKind, string | null][]) {
    if (!id) continue;
    const asset = found.find((entry) => entry.id === id) ?? null;
    const problem = await themeImageProblem(kind, asset, eventId, () => readAsset(asset!.storageKey));
    if (problem) throw new RegistrationThemeError("INVALID_ASSET", problem);
  }
  const reconciled = reconcileImageAlt(tokens, ids);
  if (reconciled.problem) throw new RegistrationThemeError("INVALID_ASSET", reconciled.problem);
  return reconciled.tokens;
}

/** A unique-index collision (two drafts or two published versions at once), a row changed in between, or the immutability trigger refusing a change (SQLSTATE 23001). */
export function isThemeWriteConflict(error: unknown) {
  // P2025: the draft a save was updating was discarded or published in between.
  // P2003: the chosen image was deleted between the check and the write.
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2025" || error.code === "P2003")) return true;
  return error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('"23001"');
}

async function guardedWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isThemeWriteConflict(error)) throw conflict();
    throw error;
  }
}

const conflict = () => new RegistrationThemeError("CONFLICT", "Someone else changed this look at the same time. Refresh and try again.");

/** Saves the event's single draft (created as the next version number, or updated). The public form does not change. */
export async function saveRegistrationThemeDraft(eventId: string, input: unknown, actorUserId: string, imageInput: RegistrationThemeImageIds = {}) {
  const parsedTokens = validTokens(input);
  const prisma = getPrisma();
  const existing = await prisma.registrationThemeVersion.findFirst({ where: { eventId, status: "DRAFT" }, select: { logoAssetId: true, heroAssetId: true } });
  const ids = {
    logoAssetId: imageInput.logoAssetId === undefined ? existing?.logoAssetId ?? null : imageInput.logoAssetId,
    heroAssetId: imageInput.heroAssetId === undefined ? existing?.heroAssetId ?? null : imageInput.heroAssetId,
  };
  const tokens = await checkedThemeImages(prisma, eventId, parsedTokens, ids);
  try {
    await prisma.$transaction(async (tx) => {
      const draft = await tx.registrationThemeVersion.findFirst({ where: { eventId, status: "DRAFT" }, select: { id: true, versionNumber: true } });
      let versionNumber: number;
      if (draft) {
        await tx.registrationThemeVersion.update({ where: { id: draft.id }, data: { tokens, ...ids } });
        versionNumber = draft.versionNumber;
      } else {
        const latest = await tx.registrationThemeVersion.aggregate({ where: { eventId }, _max: { versionNumber: true } });
        versionNumber = (latest._max.versionNumber ?? 0) + 1;
        await tx.registrationThemeVersion.create({ data: { eventId, versionNumber, status: "DRAFT", tokens, ...ids, createdByUserId: actorUserId } });
      }
      await writeAuditLog({
        eventId, actorUserId, action: "REGISTRATION_THEME_DRAFT_SAVED", entityType: "RegistrationThemeVersion",
        summary: `Saved a draft of the registration look (version ${versionNumber}).`,
        metadata: { versionNumber, hasLogo: Boolean(ids.logoAssetId), hasBanner: Boolean(ids.heroAssetId) },
      }, tx);
    });
  } catch (error) {
    if (isThemeWriteConflict(error)) throw conflict();
    throw error;
  }
  return getRegistrationThemeEditorState(eventId);
}

/**
 * Publishes the draft. The server checks the stored tokens against the schema and the contrast rules again and refuses on any
 * failure; the previous published version is archived in the same transaction. Two publishes at once end in a conflict.
 */
export async function publishRegistrationThemeDraft(eventId: string, actorUserId: string) {
  try {
    await getPrisma().$transaction(async (tx) => {
      const draft = await tx.registrationThemeVersion.findFirst({ where: { eventId, status: "DRAFT" }, select: { id: true, versionNumber: true, tokens: true, updatedAt: true, logoAssetId: true, heroAssetId: true } });
      if (!draft) throw new RegistrationThemeError("NO_DRAFT", "There is no draft to publish. Save a draft first.");
      // The images are checked again: an upload that was deleted since the save has left the draft (its description goes with it).
      const tokens = await checkedThemeImages(tx, eventId, validTokens(draft.tokens), draft);
      const report = checkThemeContrast(tokens);
      if (!report.passes) {
        throw new RegistrationThemeError("CONTRAST_FAILED", `This look can't be published yet: ${describeContrastFailures(report)}.`, report);
      }
      const now = new Date();
      const archived = await tx.registrationThemeVersion.updateMany({ where: { eventId, status: "PUBLISHED" }, data: { status: "ARCHIVED", archivedAt: now } });
      // Conditional on the draft being exactly the one that was checked: a Save or another Publish in between changes
      // updatedAt or the status, this updates nothing, and the whole transaction (including the archive above) is rolled back.
      const published = await tx.registrationThemeVersion.updateMany({
        where: { id: draft.id, status: "DRAFT", updatedAt: draft.updatedAt },
        data: { tokens, status: "PUBLISHED", publishedAt: now, publishedByUserId: actorUserId },
      });
      if (published.count !== 1) throw conflict();
      await writeAuditLog({
        eventId, actorUserId, action: "REGISTRATION_THEME_PUBLISHED", entityType: "RegistrationThemeVersion", entityId: draft.id,
        summary: `Published version ${draft.versionNumber} of the registration look.`, metadata: { versionNumber: draft.versionNumber, replacedPublished: archived.count > 0, hasLogo: Boolean(draft.logoAssetId), hasBanner: Boolean(draft.heroAssetId) },
      }, tx);
    });
  } catch (error) {
    if (isThemeWriteConflict(error)) throw conflict();
    throw error;
  }
  return getRegistrationThemeEditorState(eventId);
}

/** Deletes the draft only. A published or archived version is never deleted. */
export async function discardRegistrationThemeDraft(eventId: string, actorUserId: string) {
  await guardedWrite(() => getPrisma().$transaction(async (tx) => {
    const draft = await tx.registrationThemeVersion.findFirst({ where: { eventId, status: "DRAFT" }, select: { id: true, versionNumber: true } });
    if (!draft) throw new RegistrationThemeError("NO_DRAFT", "There is no draft to discard.");
    const deleted = await tx.registrationThemeVersion.deleteMany({ where: { id: draft.id, status: "DRAFT" } });
    // A publish that landed after the read leaves nothing to delete: report a conflict, not a discard that didn't happen.
    if (deleted.count !== 1) throw conflict();
    await writeAuditLog({
      eventId, actorUserId, action: "REGISTRATION_THEME_DRAFT_DISCARDED", entityType: "RegistrationThemeVersion", entityId: draft.id,
      summary: `Discarded the draft registration look (version ${draft.versionNumber}).`, metadata: { versionNumber: draft.versionNumber },
    }, tx);
  }));
  return getRegistrationThemeEditorState(eventId);
}

/** Goes back to the platform look: archives the published version (kept in the history). */
export async function revertRegistrationThemeToPlatformDefault(eventId: string, actorUserId: string) {
  await guardedWrite(() => getPrisma().$transaction(async (tx) => {
    const published = await tx.registrationThemeVersion.findFirst({ where: { eventId, status: "PUBLISHED" }, select: { id: true, versionNumber: true } });
    if (!published) throw new RegistrationThemeError("NO_PUBLISHED", "This event already uses the platform look.");
    await tx.registrationThemeVersion.update({ where: { id: published.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await writeAuditLog({
      eventId, actorUserId, action: "REGISTRATION_THEME_REVERTED", entityType: "RegistrationThemeVersion", entityId: published.id,
      summary: `Went back to the platform registration look (version ${published.versionNumber} archived).`, metadata: { versionNumber: published.versionNumber },
    }, tx);
  }));
  return getRegistrationThemeEditorState(eventId);
}
