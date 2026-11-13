import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { deleteAsset, writeStoredFile } from "@/modules/events/asset-storage";
import { logError } from "@/lib/logger";
import { processProfilePhoto } from "@/modules/profile-photos/processing";

/** The partition under the shared asset storage root; file names inside it are generated. */
export const PROFILE_PHOTO_PARTITION = "profile-photos";

export type ProfilePhotoState = {
  hasPhoto: boolean;
  /** Milliseconds since the epoch of the current photo; the cache-busting `v` in photo URLs. */
  version: number | null;
  /** Set when a system administrator removed the photo and the person has not added a new one. */
  removedByStaffAt: Date | null;
};

export function profilePhotoUrl(userId: string, size: "thumb" | "full", version: number) {
  return `/api/profile-photos/${encodeURIComponent(userId)}?size=${size}&v=${version}`;
}

export async function getProfilePhotoState(userId: string): Promise<ProfilePhotoState> {
  const row = await getPrisma().profilePhoto.findUnique({
    where: { userId },
    select: { storageKey: true, uploadedAt: true, removedByStaffAt: true },
  });
  const hasPhoto = Boolean(row?.storageKey && row.uploadedAt);
  return {
    hasPhoto,
    version: hasPhoto && row?.uploadedAt ? row.uploadedAt.getTime() : null,
    removedByStaffAt: row?.removedByStaffAt ?? null,
  };
}

/** The photo's URL for a page that already has the user's photo version, or null when there is none. */
export function photoUrlFor(userId: string, version: number | null | undefined, size: "thumb" | "full" = "thumb") {
  return typeof version === "number" ? profilePhotoUrl(userId, size, version) : null;
}

export async function findProfilePhotoFile(userId: string, size: "thumb" | "full") {
  const row = await getPrisma().profilePhoto.findUnique({
    where: { userId },
    select: { storageKey: true, thumbStorageKey: true },
  });
  const storageKey = size === "thumb" ? row?.thumbStorageKey : row?.storageKey;
  return storageKey ?? null;
}

async function deleteFilesQuietly(keys: Array<string | null | undefined>) {
  for (const key of keys) {
    if (!key) continue;
    try {
      await deleteAsset(key);
    } catch (error) {
      logError("Could not delete a stored profile photo file", error);
    }
  }
}

/** Stores a new photo for the person, replacing (and deleting) the old files once the new row is saved. */
export async function saveOwnProfilePhoto(userId: string, bytes: Uint8Array) {
  const { full, thumb } = await processProfilePhoto(bytes);
  const prisma = getPrisma();
  const written: string[] = [];
  try {
    const fullFile = await writeStoredFile(PROFILE_PHOTO_PARTITION, "webp", full);
    written.push(fullFile.storageKey);
    const thumbFile = await writeStoredFile(PROFILE_PHOTO_PARTITION, "webp", thumb);
    written.push(thumbFile.storageKey);
    const previous = await prisma.profilePhoto.findUnique({
      where: { userId },
      select: { storageKey: true, thumbStorageKey: true },
    });
    const uploadedAt = new Date();
    const data = {
      storageKey: fullFile.storageKey,
      thumbStorageKey: thumbFile.storageKey,
      byteSize: fullFile.byteSize,
      checksum: fullFile.checksum,
      uploadedAt,
      removedByStaffAt: null,
      removedByUserId: null,
    };
    await prisma.profilePhoto.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await deleteFilesQuietly([previous?.storageKey, previous?.thumbStorageKey]);
    return { version: uploadedAt.getTime() };
  } catch (error) {
    await deleteFilesQuietly(written);
    throw error;
  }
}

const clearedFields = { storageKey: null, thumbStorageKey: null, byteSize: null, checksum: null, uploadedAt: null };

/** Deletes the stored files (not just the link) and clears the row. Returns whether there was a photo. */
async function clearPhoto(userId: string, extra: { removedByStaffAt: Date; removedByUserId: string } | null) {
  const prisma = getPrisma();
  const row = await prisma.profilePhoto.findUnique({ where: { userId }, select: { storageKey: true, thumbStorageKey: true } });
  if (!row) return false;
  const hadPhoto = Boolean(row.storageKey || row.thumbStorageKey);
  await prisma.profilePhoto.update({
    where: { userId },
    data: { ...clearedFields, ...(extra ?? { removedByStaffAt: null, removedByUserId: null }) },
  });
  await deleteFilesQuietly([row.storageKey, row.thumbStorageKey]);
  return hadPhoto;
}

export async function removeOwnProfilePhoto(userId: string) {
  return clearPhoto(userId, null);
}

/** A system administrator removes an inappropriate photo: files deleted, the person told, the action logged. */
export async function removeProfilePhotoByStaff(targetUserId: string, actorUserId: string) {
  const removed = await clearPhoto(targetUserId, { removedByStaffAt: new Date(), removedByUserId: actorUserId });
  if (removed) {
    await writeAuditLog({
      actorUserId,
      action: "PROFILE_PHOTO_REMOVED_BY_STAFF",
      entityType: "User",
      entityId: targetUserId,
      summary: `Removed the profile photo of staff account ${targetUserId}.`,
      metadata: { targetUserId },
    });
  }
  return removed;
}

/** Clears the person's "a staff member removed your photo" notice. */
export async function dismissRemovalNotice(userId: string) {
  await getPrisma().profilePhoto.updateMany({
    where: { userId, storageKey: null },
    data: { removedByStaffAt: null, removedByUserId: null },
  });
}

/**
 * Deletes the profile photos of every staff account linked to a person (used when the person is anonymized, #1640).
 * Best effort: a failure is logged and never thrown, so it cannot fail the anonymization.
 */
export async function removeProfilePhotosForPerson(personId: string) {
  try {
    const links = await getPrisma().userPersonLink.findMany({ where: { personId }, select: { userId: true } });
    for (const { userId } of links) {
      try {
        await clearPhoto(userId, null);
      } catch (error) {
        logError("Could not remove a profile photo after anonymization", error);
      }
    }
  } catch (error) {
    logError("Could not look up profile photos after anonymization", error);
  }
}
