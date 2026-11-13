/** The centered square inside a width by height image: where the browser crops a photo before upload (#1640). */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

export const PROFILE_PHOTO_UPLOAD_SIZE = 512;
export const PROFILE_PHOTO_UNREADABLE = "That photo could not be read. Please choose a JPG or PNG.";

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to an <img>, which some browsers decode when createImageBitmap refuses.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(PROFILE_PHOTO_UNREADABLE);
  }
}

/** Shrinks a chosen photo to a centered 512 px square JPEG in the browser, so a large phone photo is never rejected. */
export async function shrinkProfilePhoto(file: File): Promise<Blob> {
  const decoded = await decode(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error(PROFILE_PHOTO_UNREADABLE);
    const { sx, sy, side } = centerSquare(decoded.width, decoded.height);
    const size = Math.min(PROFILE_PHOTO_UPLOAD_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(PROFILE_PHOTO_UNREADABLE);
    context.drawImage(decoded.source, sx, sy, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error(PROFILE_PHOTO_UNREADABLE);
    return blob;
  } finally {
    decoded.release();
  }
}
