/** Widths the public event asset route can resize an image to (#1207). Anything else serves the original. */
export const variantWidths = [640, 960, 1280, 1920] as const;

/** Content types that are resized; gif (animation), svg and documents are always served as stored. */
export const resizableContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;

/** The `?w=` value as an allowed width, or null for a missing, malformed or unlisted one. */
export function parseVariantWidth(value: string | null | undefined): (typeof variantWidths)[number] | null {
  if (!value || !/^\d{3,4}$/.test(value)) return null;
  const width = Number(value);
  return String(width) === value && (variantWidths as readonly number[]).includes(width) ? (width as (typeof variantWidths)[number]) : null;
}

export function isResizableContentType(contentType: string) {
  return (resizableContentTypes as readonly string[]).includes(contentType.toLowerCase());
}
