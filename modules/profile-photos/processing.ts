import "server-only";

import { bytesMatchType, isAllowedAssetType, type AllowedAssetType } from "@/modules/events/asset-storage";

/** Profile photos are shrunk in the browser first, so this is generous; the limit is on what the server will read. */
export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_FULL_SIZE = 512;
export const PROFILE_PHOTO_THUMB_SIZE = 128;
/** Refuses images that would decode to an enormous bitmap. */
const MAX_INPUT_PIXELS = 40_000_000;

export const PROFILE_PHOTO_UNREADABLE_MESSAGE = "That photo could not be read. Please choose a JPG or PNG.";

export type ProfilePhotoErrorCode = "UNREADABLE" | "TOO_LARGE";

export class ProfilePhotoError extends Error {
  constructor(public readonly code: ProfilePhotoErrorCode, message: string) {
    super(message);
    this.name = "ProfilePhotoError";
  }
}

const PHOTO_TYPES: readonly AllowedAssetType[] = ["image/jpeg", "image/png", "image/webp"];

/** The photo type, decided from the bytes alone; the type a browser claimed is never used. */
export function detectProfilePhotoType(bytes: Uint8Array): AllowedAssetType | null {
  return PHOTO_TYPES.find((type) => isAllowedAssetType(type) && bytesMatchType(bytes, type)) ?? null;
}

export type ProcessedProfilePhoto = { full: Buffer; thumb: Buffer };

/**
 * Re-encodes an uploaded photo as two square WebP files: it applies the camera's orientation, crops to the centre, and
 * writes a fresh file, so EXIF, GPS and other embedded metadata are not carried over (no metadata option is passed to
 * the encoder, which drops it).
 */
export async function processProfilePhoto(bytes: Uint8Array): Promise<ProcessedProfilePhoto> {
  if (bytes.byteLength > MAX_PROFILE_PHOTO_BYTES) {
    throw new ProfilePhotoError("TOO_LARGE", "Photos must be 5 MB or smaller.");
  }
  if (!detectProfilePhotoType(bytes)) throw new ProfilePhotoError("UNREADABLE", PROFILE_PHOTO_UNREADABLE_MESSAGE);
  try {
    const sharp = (await import("sharp")).default;
    const square = (size: number) => sharp(Buffer.from(bytes), { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(size, size, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
    const [full, thumb] = await Promise.all([square(PROFILE_PHOTO_FULL_SIZE), square(PROFILE_PHOTO_THUMB_SIZE)]);
    return { full, thumb };
  } catch {
    throw new ProfilePhotoError("UNREADABLE", PROFILE_PHOTO_UNREADABLE_MESSAGE);
  }
}
