import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import {
  detectProfilePhotoType,
  MAX_PROFILE_PHOTO_BYTES,
  PROFILE_PHOTO_UNREADABLE_MESSAGE,
  processProfilePhoto,
  ProfilePhotoError,
} from "@/modules/profile-photos/processing";

// Synthetic images only: flat colour built in memory, never a real photo.
async function syntheticJpeg(width: number, height: number, withExif = false) {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } } }).jpeg();
  return (withExif
    ? image.withExif({ IFD0: { Copyright: "Synthetic Test Owner", ImageDescription: "GPS 41.6,-93.6 synthetic" } })
    : image).toBuffer();
}
const syntheticPng = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();

describe("profile photo processing (#1640)", () => {
  it("makes a 512 and a 128 pixel square WebP from a wide image", async () => {
    const { full, thumb } = await processProfilePhoto(await syntheticJpeg(1600, 900));
    const fullMeta = await sharp(full).metadata();
    const thumbMeta = await sharp(thumb).metadata();
    expect([fullMeta.format, fullMeta.width, fullMeta.height]).toEqual(["webp", 512, 512]);
    expect([thumbMeta.format, thumbMeta.width, thumbMeta.height]).toEqual(["webp", 128, 128]);
  });

  it("accepts PNG and WebP by their bytes", async () => {
    expect(detectProfilePhotoType(await syntheticPng(10, 10))).toBe("image/png");
    expect(detectProfilePhotoType(await sharp(await syntheticPng(10, 10)).webp().toBuffer())).toBe("image/webp");
    expect((await sharp((await processProfilePhoto(await syntheticPng(300, 700))).full).metadata()).width).toBe(512);
  });

  it("drops EXIF and other embedded metadata when re-encoding", async () => {
    const input = await syntheticJpeg(800, 800, true);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { full, thumb } = await processProfilePhoto(input);
    for (const output of [full, thumb]) {
      const meta = await sharp(output).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(output.includes(Buffer.from("Synthetic Test Owner"))).toBe(false);
    }
  });

  it("refuses anything that is not a JPEG, PNG or WebP, whatever it claims", async () => {
    for (const bytes of [
      Buffer.from("%PDF-1.4 not an image"),
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      Buffer.from("ftypheic0000"),
      Buffer.alloc(0),
    ]) {
      await expect(processProfilePhoto(bytes)).rejects.toMatchObject({ code: "UNREADABLE", message: PROFILE_PHOTO_UNREADABLE_MESSAGE });
    }
  });

  it("gives the plain message for a corrupt file with a valid signature", async () => {
    const jpeg = await syntheticJpeg(200, 200);
    const corrupt = Buffer.concat([jpeg.subarray(0, 40), Buffer.alloc(200, 7)]);
    const error = await processProfilePhoto(corrupt).catch((caught) => caught);
    expect(error).toBeInstanceOf(ProfilePhotoError);
    expect(error.message).toBe("That photo could not be read. Please choose a JPG or PNG.");
  });

  it("refuses a file over 5 MB", async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_PROFILE_PHOTO_BYTES)]);
    await expect(processProfilePhoto(big)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
});
