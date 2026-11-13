import "server-only";

import type { Prisma } from "@prisma/client";
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

type PhotoKeys = { storageKey: string | null; thumbStorageKey: string | null };

/**
 * Takes the person's row lock for the rest of the transaction, creating the row first when there is none, and returns
 * the stored keys as they are now. Overlapping saves and removals for one person queue on this lock, so each sees the
 * keys the one before it left and every file ends up either named by the row or deleted.
 */
async function lockPhotoRow(tx: Prisma.TransactionClient, userId: string, createIfMissing: boolean): Promise<PhotoKeys> {
  if (createIfMissing) await tx.profilePhoto.createMany({ data: [{ userId }], skipDuplicates: true });
  await tx.$queryRaw`SELECT "id" FROM "ProfilePhoto" WHERE "userId" = ${userId} FOR UPDATE`;
  const row = await tx.profilePhoto.findUnique({ where: { userId }, select: { storageKey: true, thumbStorageKey: true } });
  return { storageKey: row?.storageKey ?? null, thumbStorageKey: row?.thumbStorageKey ?? null };
}

/** Stores a new photo for the person, replacing the old one; the old files are deleted only after the new row commits. */
export async function saveOwnProfilePhoto(userId: string, bytes: Uint8Array) {
  const { full, thumb } = await processProfilePhoto(bytes);
  const written: string[] = [];
  try {
    const fullFile = await writeStoredFile(PROFILE_PHOTO_PARTITION, "webp", full);
    written.push(fullFile.storageKey);
    const thumbFile = await writeStoredFile(PROFILE_PHOTO_PARTITION, "webp", thumb);
    written.push(thumbFile.storageKey);
    const uploadedAt = new Date();
    const previous = await getPrisma().$transaction(async (tx) => {
      const keys = await lockPhotoRow(tx, userId, true);
      await tx.profilePhoto.update({
        where: { userId },
        data: {
          storageKey: fullFile.storageKey,
          thumbStorageKey: thumbFile.storageKey,
          byteSize: fullFile.byteSize,
          checksum: fullFile.checksum,
          uploadedAt,
          removedByStaffAt: null,
          removedByUserId: null,
        },
      });
      return keys;
    }, { timeout: 15000 });
    await deleteFilesQuietly([previous.storageKey, previous.thumbStorageKey]);
    return { version: uploadedAt.getTime() };
  } catch (error) {
    await deleteFilesQuietly(written);
    throw error;
  }
}

const clearedFields = { storageKey: null, thumbStorageKey: null, byteSize: null, checksum: null, uploadedAt: null };

/**
 * Clears the row under its lock (and, for a staff removal, writes the audit entry in the same transaction), then
 * deletes the stored files after commit. Returns whether there was a photo.
 */
async function clearPhoto(
  userId: string,
  mode: { kind: "own" } | { kind: "staff"; actorUserId: string },
) {
  const keys = await getPrisma().$transaction(async (tx) => {
    const current = await lockPhotoRow(tx, userId, false);
    const hadPhoto = Boolean(current.storageKey || current.thumbStorageKey);
    // No photo stored: nothing to delete, and a removal notice already on the row stays until a new photo is added.
    if (!hadPhoto) return null;
    await tx.profilePhoto.update({
      where: { userId },
      data: {
        ...clearedFields,
        ...(mode.kind === "staff"
          ? { removedByStaffAt: new Date(), removedByUserId: mode.actorUserId }
          : { removedByStaffAt: null, removedByUserId: null }),
      },
    });
    if (mode.kind === "staff") {
      await writeAuditLog({
        actorUserId: mode.actorUserId,
        action: "PROFILE_PHOTO_REMOVED_BY_STAFF",
        entityType: "User",
        entityId: userId,
        summary: `Removed the profile photo of staff account ${userId}.`,
        metadata: { targetUserId: userId },
      }, tx);
    }
    return current;
  }, { timeout: 15000 });
  if (!keys) return false;
  await deleteFilesQuietly([keys.storageKey, keys.thumbStorageKey]);
  return true;
}

export async function removeOwnProfilePhoto(userId: string) {
  return clearPhoto(userId, { kind: "own" });
}

/** A system administrator removes an inappropriate photo: files deleted, the person told, the action logged. */
export async function removeProfilePhotoByStaff(targetUserId: string, actorUserId: string) {
  return clearPhoto(targetUserId, { kind: "staff", actorUserId });
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
        await clearPhoto(userId, { kind: "own" });
      } catch (error) {
        logError("Could not remove a profile photo after anonymization", error);
      }
    }
  } catch (error) {
    logError("Could not look up profile photos after anonymization", error);
  }
}
