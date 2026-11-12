import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import {
  ALLOWED_ASSET_TYPES,
  bytesMatchType,
  deleteAsset,
  isAllowedAssetType,
  MAX_ASSET_BYTES,
  readAsset,
  safeDisplayName,
  writeAsset,
  writeStoredFile,
  type AllowedAssetType,
} from "@/modules/events/asset-storage";

/**
 * The shared library of event header images (#1913).
 *
 * The library keeps its own copy of every file (partition `image-library`), so removing an event or one of its uploads
 * never breaks a library entry. Using an image in an event copies it into that event as an ordinary `EventAsset`, which
 * is what the page blocks already know how to show. Retiring an image only hides it from the picker; events that already
 * hold a copy are not touched.
 */

export const LIBRARY_PARTITION = "image-library";
export const MAX_TAGS_PER_IMAGE = 12;
export const MAX_TAG_LENGTH = 30;
export const MAX_ALT_LENGTH = 200;
const LIST_LIMIT = 200;

export class ImageLibraryError extends Error {
  constructor(
    public readonly code:
      | "IMAGE_TYPE_NOT_ALLOWED"
      | "IMAGE_TOO_LARGE"
      | "IMAGE_CONTENT_MISMATCH"
      | "IMAGE_NOT_FOUND"
      | "IMAGE_RETIRED"
      | "INVALID_TAGS"
      | "FILE_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ImageLibraryError";
  }
}

export type ImageLibraryRecord = {
  id: string;
  displayName: string;
  contentType: string;
  byteSize: number;
  altText: string;
  tags: string[];
  sourceEventTitle: string;
  sourceEventStartsAt: string | null;
  createdAt: string;
  retired: boolean;
  /** Events whose content blocks show a copy of this image. Titles only for events the viewer can configure. */
  usage: { eventCount: number; eventTitles: string[] };
  url: string;
};

export type ImageLibraryFilters = {
  q?: string;
  tag?: string;
  /** Four-digit year of the source event's start. */
  year?: number;
  /** Source event started on or after / before this date (inclusive of the whole day). */
  from?: Date;
  to?: Date;
  includeRetired?: boolean;
};

/** Trimmed, lower-cased, single-spaced, de-duplicated; empty entries dropped. Throws when over the limits. */
export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") {
      throw new ImageLibraryError("INVALID_TAGS", "Tags must be plain text.");
    }
    const tag = item.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new ImageLibraryError("INVALID_TAGS", `A tag can be at most ${MAX_TAG_LENGTH} characters.`);
    }
    seen.add(tag);
  }
  if (seen.size > MAX_TAGS_PER_IMAGE) {
    throw new ImageLibraryError("INVALID_TAGS", `An image can have at most ${MAX_TAGS_PER_IMAGE} tags.`);
  }
  return [...seen];
}

function libraryFileUrl(eventId: string, imageId: string) {
  return `/api/events/${encodeURIComponent(eventId)}/image-library/${encodeURIComponent(imageId)}/file?disposition=inline`;
}

const recordSelect = {
  id: true,
  displayName: true,
  contentType: true,
  byteSize: true,
  altText: true,
  tags: true,
  sourceEventTitle: true,
  sourceEventStartsAt: true,
  createdAt: true,
  retiredAt: true,
  // Only copies a content block actually shows count as "used" (#1913).
  copies: { where: { blockRefs: { some: {} } }, select: { event: { select: { id: true, name: true } } } },
} as const;

type RecordRow = Prisma.EventImageLibraryImageGetPayload<{ select: typeof recordSelect }>;

/** Decides which using events' titles a viewer may see (event ids are the ones the viewer can configure). */
export type LibraryViewer = {
  /** The subset of these event ids the viewer can configure, looked up once per list call. */
  configurableEventIds: (eventIds: string[]) => Promise<Set<string>>;
};

function toRecord(eventId: string, row: RecordRow, configurable: Set<string>): ImageLibraryRecord {
  const events = new Map<string, string>();
  for (const copy of row.copies) events.set(copy.event.id, copy.event.name);
  const eventTitles = [...events].filter(([id]) => configurable.has(id)).map(([, name]) => name);
  return {
    id: row.id,
    displayName: row.displayName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    altText: row.altText,
    tags: row.tags,
    sourceEventTitle: row.sourceEventTitle,
    sourceEventStartsAt: row.sourceEventStartsAt ? row.sourceEventStartsAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    retired: row.retiredAt !== null,
    usage: { eventCount: events.size, eventTitles },
    url: libraryFileUrl(eventId, row.id),
  };
}

async function configurableFor(rows: RecordRow[], viewer?: LibraryViewer) {
  if (!viewer) return new Set<string>();
  const ids = [...new Set(rows.flatMap((row) => row.copies.map((copy) => copy.event.id)))];
  return ids.length > 0 ? viewer.configurableEventIds(ids) : new Set<string>();
}

export async function listLibraryImages(
  eventId: string,
  filters: ImageLibraryFilters = {},
  viewer?: LibraryViewer,
): Promise<ImageLibraryRecord[]> {
  const where: Prisma.EventImageLibraryImageWhereInput[] = [];
  if (!filters.includeRetired) where.push({ retiredAt: null });
  const q = filters.q?.trim();
  if (q) {
    where.push({
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { sourceEventTitle: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
      ],
    });
  }
  const tag = filters.tag?.trim().toLowerCase();
  if (tag) where.push({ tags: { has: tag } });
  if (filters.year !== undefined && Number.isInteger(filters.year)) {
    where.push({
      sourceEventStartsAt: {
        gte: new Date(Date.UTC(filters.year, 0, 1)),
        lt: new Date(Date.UTC(filters.year + 1, 0, 1)),
      },
    });
  }
  if (filters.from) where.push({ sourceEventStartsAt: { gte: filters.from } });
  if (filters.to) where.push({ sourceEventStartsAt: { lt: new Date(filters.to.getTime() + 24 * 60 * 60 * 1000) } });

  const rows = await getPrisma().eventImageLibraryImage.findMany({
    where: where.length > 0 ? { AND: where } : undefined,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: recordSelect,
  });
  const configurable = await configurableFor(rows, viewer);
  return rows.map((row) => toRecord(eventId, row, configurable));
}

/** Every tag in use, for the picker's tag filter. */
export async function listLibraryTags(): Promise<string[]> {
  const rows = await getPrisma().eventImageLibraryImage.findMany({
    where: { retiredAt: null },
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((row) => row.tags))].sort();
}

export async function getLibraryImageRecord(eventId: string, imageId: string, viewer?: LibraryViewer) {
  const row = await getPrisma().eventImageLibraryImage.findUnique({ where: { id: imageId }, select: recordSelect });
  return row ? toRecord(eventId, row, await configurableFor([row], viewer)) : null;
}

/** The stored file, for the staff-only preview route. */
export async function findLibraryImageFile(imageId: string) {
  return getPrisma().eventImageLibraryImage.findUnique({
    where: { id: imageId },
    select: { displayName: true, contentType: true, storageKey: true },
  });
}

/** Same size, type and signature checks as an event upload, images only. */
async function readCheckedImage(file: File): Promise<{ type: AllowedAssetType; bytes: Uint8Array }> {
  if (file.size > MAX_ASSET_BYTES) {
    throw new ImageLibraryError(
      "IMAGE_TOO_LARGE",
      `Images must be ${Math.floor(MAX_ASSET_BYTES / (1024 * 1024))} MB or smaller.`,
    );
  }
  const declaredType = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isAllowedAssetType(declaredType) || !declaredType.startsWith("image/")) {
    throw new ImageLibraryError("IMAGE_TYPE_NOT_ALLOWED", "Upload a PNG, JPEG, or WebP image.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytesMatchType(bytes, declaredType)) {
    throw new ImageLibraryError(
      "IMAGE_CONTENT_MISMATCH",
      "That file's contents do not match the kind of image it claims to be.",
    );
  }
  return { type: declaredType, bytes };
}

type SourceEvent = { id: string; name: string; startsAt: Date };

async function loadSourceEvent(eventId: string): Promise<SourceEvent | null> {
  return getPrisma().event.findUnique({ where: { id: eventId }, select: { id: true, name: true, startsAt: true } });
}

/** An upload records its event's title and start only when that event is published and not archived (#1913). */
async function loadPublishedSourceEvent(eventId: string): Promise<SourceEvent | null> {
  const event = await getPrisma().event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, startsAt: true, isPublished: true, archivedAt: true },
  });
  if (!event || !event.isPublished || event.archivedAt) return null;
  return { id: event.id, name: event.name, startsAt: event.startsAt };
}

type StoreInput = {
  type: AllowedAssetType;
  bytes: Uint8Array;
  checksum: string;
  displayName: string;
  altText: string;
  source: SourceEvent | null;
  createdByUserId: string | null;
};

/** Writes the library's own copy and its row; a lost race on the checksum keeps the winner. */
async function storeNewImage(input: StoreInput): Promise<{ id: string; created: boolean }> {
  const prisma = getPrisma();
  const stored = await writeStoredFile(LIBRARY_PARTITION, ALLOWED_ASSET_TYPES[input.type].extension, input.bytes);
  try {
    const row = await prisma.eventImageLibraryImage.create({
      data: {
        displayName: input.displayName,
        contentType: input.type,
        byteSize: stored.byteSize,
        checksum: input.checksum,
        storageKey: stored.storageKey,
        altText: input.altText.slice(0, MAX_ALT_LENGTH),
        sourceEventId: input.source?.id ?? null,
        sourceEventTitle: input.source?.name ?? "",
        sourceEventStartsAt: input.source?.startsAt ?? null,
        createdByUserId: input.createdByUserId,
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (error) {
    await deleteAsset(stored.storageKey);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.eventImageLibraryImage.findUnique({
        where: { checksum: input.checksum },
        select: { id: true },
      });
      if (winner) return { id: winner.id, created: false };
    }
    throw error;
  }
}

/** Adds an uploaded image to the library; the same bytes already there are not added twice. */
export async function addUploadToLibrary(
  file: File,
  actorUserId: string,
  eventId: string,
  options: { altText?: string } = {},
): Promise<{ id: string; created: boolean }> {
  const { type, bytes } = await readCheckedImage(file);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const existing = await getPrisma().eventImageLibraryImage.findUnique({ where: { checksum }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  return storeNewImage({
    type,
    bytes,
    checksum,
    displayName: safeDisplayName(file.name, type),
    altText: options.altText ?? "",
    source: await loadPublishedSourceEvent(eventId),
    createdByUserId: actorUserId,
  });
}

/**
 * Adds an image an event already holds. The library copy carries the event's title and start, and the event's file
 * is linked to it so "where it is used" counts that event. Deduplicated by checksum.
 */
export async function addEventAssetToLibrary(
  assetId: string,
  options: { altText?: string } = {},
): Promise<{ id: string; created: boolean } | null> {
  const prisma = getPrisma();
  const asset = await prisma.eventAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      eventId: true,
      displayName: true,
      contentType: true,
      checksum: true,
      storageKey: true,
      uploadedByUserId: true,
      libraryImageId: true,
    },
  });
  if (!asset || !isAllowedAssetType(asset.contentType) || !asset.contentType.startsWith("image/")) return null;
  const type: AllowedAssetType = asset.contentType;

  let result: { id: string; created: boolean };
  const existing = await prisma.eventImageLibraryImage.findUnique({
    where: { checksum: asset.checksum },
    select: { id: true, altText: true },
  });
  if (existing) {
    result = { id: existing.id, created: false };
    // A later save that supplies alt text fills in a library entry that has none.
    const alt = options.altText?.trim();
    if (!existing.altText && alt) {
      await prisma.eventImageLibraryImage.update({ where: { id: existing.id }, data: { altText: alt.slice(0, MAX_ALT_LENGTH) } });
    }
  } else {
    const bytes = new Uint8Array(await readAsset(asset.storageKey));
    result = await storeNewImage({
      type,
      bytes,
      checksum: asset.checksum,
      displayName: asset.displayName,
      altText: options.altText ?? "",
      source: await loadSourceEvent(asset.eventId),
      createdByUserId: asset.uploadedByUserId,
    });
  }
  if (!asset.libraryImageId) {
    await prisma.eventAsset.update({ where: { id: asset.id }, data: { libraryImageId: result.id } });
  }
  return result;
}

/**
 * Makes a library image available in an event as one of its files. An event that already holds a copy (or the same
 * bytes) reuses it; otherwise the library file is copied in once. A retired image cannot be chosen.
 */
export async function applyLibraryImageToEvent(
  eventId: string,
  imageId: string,
  actorUserId: string,
): Promise<{ assetId: string; reused: boolean }> {
  const prisma = getPrisma();
  const image = await prisma.eventImageLibraryImage.findUnique({
    where: { id: imageId },
    select: { id: true, displayName: true, contentType: true, checksum: true, storageKey: true, retiredAt: true },
  });
  if (!image) throw new ImageLibraryError("IMAGE_NOT_FOUND", "That image is no longer in the library.");
  if (image.retiredAt) {
    throw new ImageLibraryError("IMAGE_RETIRED", "That image has been retired. Restore it to use it again.");
  }
  const existing = await prisma.eventAsset.findFirst({
    where: { eventId, OR: [{ libraryImageId: image.id }, { checksum: image.checksum }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, libraryImageId: true },
  });
  if (existing) {
    if (!existing.libraryImageId) {
      await prisma.eventAsset.update({ where: { id: existing.id }, data: { libraryImageId: image.id } });
    }
    return { assetId: existing.id, reused: true };
  }
  if (!isAllowedAssetType(image.contentType)) {
    throw new ImageLibraryError("IMAGE_TYPE_NOT_ALLOWED", "Upload a PNG, JPEG, or WebP image.");
  }
  const bytes = new Uint8Array(await readAsset(image.storageKey));
  const stored = await writeAsset(eventId, image.contentType, bytes);
  try {
    const asset = await prisma.eventAsset.create({
      data: {
        eventId,
        displayName: image.displayName,
        contentType: image.contentType,
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        storageKey: stored.storageKey,
        uploadedByUserId: actorUserId,
        libraryImageId: image.id,
      },
      select: { id: true },
    });
    return { assetId: asset.id, reused: false };
  } catch (error) {
    await deleteAsset(stored.storageKey);
    throw error;
  }
}

export async function updateLibraryImageTags(
  eventId: string,
  imageId: string,
  rawTags: unknown,
  actorUserId: string,
): Promise<string[]> {
  const tags = normalizeTags(rawTags);
  const prisma = getPrisma();
  const image = await prisma.eventImageLibraryImage.findUnique({
    where: { id: imageId },
    select: { id: true, displayName: true, sourceEventId: true },
  });
  if (!image) throw new ImageLibraryError("IMAGE_NOT_FOUND", "That image is no longer in the library.");
  await prisma.$transaction(async (tx) => {
    await tx.eventImageLibraryImage.update({ where: { id: imageId }, data: { tags } });
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "EVENT_IMAGE_LIBRARY_TAGS_CHANGED",
        entityType: "EventImageLibraryImage",
        entityId: imageId,
        correlationId: randomUUID(),
        summary: `Changed the tags on the library image "${image.displayName}".`,
        metadata: { imageId, sourceEventId: image.sourceEventId, tags, productionWrite: false },
      },
    });
  });
  return tags;
}

/** Hides an image from the picker (or brings it back). Files already copied into events are not touched. */
export async function setLibraryImageRetired(
  eventId: string,
  imageId: string,
  retired: boolean,
  actorUserId: string,
): Promise<void> {
  const prisma = getPrisma();
  const image = await prisma.eventImageLibraryImage.findUnique({
    where: { id: imageId },
    select: { id: true, displayName: true, retiredAt: true, sourceEventId: true },
  });
  if (!image) throw new ImageLibraryError("IMAGE_NOT_FOUND", "That image is no longer in the library.");
  if ((image.retiredAt !== null) === retired) return;
  await prisma.$transaction(async (tx) => {
    await tx.eventImageLibraryImage.update({
      where: { id: imageId },
      data: retired
        ? { retiredAt: new Date(), retiredByUserId: actorUserId }
        : { retiredAt: null, retiredByUserId: null },
    });
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: retired ? "EVENT_IMAGE_LIBRARY_RETIRED" : "EVENT_IMAGE_LIBRARY_RESTORED",
        entityType: "EventImageLibraryImage",
        entityId: imageId,
        correlationId: randomUUID(),
        summary: `${retired ? "Retired" : "Restored"} the library image "${image.displayName}".`,
        metadata: { imageId, sourceEventId: image.sourceEventId, productionWrite: false },
      },
    });
  });
}

/**
 * Keeps a published header image. Only published content enters the library from events: the caller passes a banner
 * that is published, and the event itself must be published and not archived. Best effort and meant for after the save
 * has committed: a failure is logged and never thrown, so the page save the person made always stands.
 */
export async function keepHeaderImageInLibrary(eventId: string, assetId: string, altText: string): Promise<void> {
  try {
    const event = await getPrisma().event.findUnique({ where: { id: eventId }, select: { isPublished: true, archivedAt: true } });
    if (!event || !event.isPublished || event.archivedAt) return;
    await addEventAssetToLibrary(assetId, { altText });
  } catch (error) {
    logError("Keeping a header image in the shared library failed", error, { eventId, assetId });
  }
}

/** When an event is published, its already-published banner joins the library. Best effort, like the save hook. */
export async function keepPublishedHeaderImagesForEvent(eventId: string): Promise<void> {
  try {
    const sections = await getPrisma().eventContentSection.findMany({
      where: { eventId, kind: "HERO", isPublished: true },
      select: { data: true },
    });
    for (const section of sections) {
      const data = section.data as { assetId?: unknown; alt?: unknown } | null;
      if (typeof data?.assetId === "string" && data.assetId) {
        await keepHeaderImageInLibrary(eventId, data.assetId, typeof data.alt === "string" ? data.alt : "");
      }
    }
  } catch (error) {
    logError("Keeping an event's header image in the shared library failed", error, { eventId });
  }
}

/**
 * Backfill for `npm run event-image-library:sync`: adds the header images of published banners on published events. Safe to repeat;
 * images already there are only linked. Reads event sections and files and writes only library rows and copies.
 */
export async function syncHeaderImagesToLibrary() {
  const prisma = getPrisma();
  const sections = await prisma.eventContentSection.findMany({
    where: { kind: "HERO", isPublished: true, event: { isPublished: true, archivedAt: null } },
    select: { eventId: true, data: true },
  });
  const counts = { added: 0, alreadyThere: 0, skipped: 0 };
  for (const section of sections) {
    const data = section.data as { assetId?: unknown; alt?: unknown } | null;
    const assetId = typeof data?.assetId === "string" ? data.assetId : "";
    if (!assetId) {
      counts.skipped += 1;
      continue;
    }
    try {
      const result = await addEventAssetToLibrary(assetId, {
        altText: typeof data?.alt === "string" ? data.alt : "",
      });
      if (!result) counts.skipped += 1;
      else if (result.created) counts.added += 1;
      else counts.alreadyThere += 1;
    } catch (error) {
      counts.skipped += 1;
      logError("Adding a header image to the shared library failed", error, { eventId: section.eventId, assetId });
    }
  }
  return counts;
}
