/**
 * The checks for the event logo and banner on a registration look (#283). Pure apart from the injected readers, so tests
 * need no files. An image must be an upload of the same event, a PNG, JPEG or WebP (never a PDF; SVG is never an allowed
 * upload at all), small enough to load quickly on a phone, and big enough to look sharp.
 */

export const THEME_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ThemeImageKind = "logo" | "hero";

export const THEME_IMAGE_LIMITS = {
  logo: { label: "logo", maxBytes: 2 * 1024 * 1024, minWidth: 120, minHeight: 48 },
  hero: { label: "banner", maxBytes: 10 * 1024 * 1024, minWidth: 1200, minHeight: 300 },
} as const;

export type ThemeImageAsset = { eventId: string; contentType: string; byteSize: number };
export type ImageDimensions = { width: number; height: number };
/** Reads the pixel size of an image, or null when it cannot be read as one. */
export type ImageDimensionReader = (bytes: Uint8Array) => Promise<ImageDimensions | null>;

export function isThemeImageType(contentType: string) {
  return (THEME_IMAGE_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

const megabytes = (bytes: number) => `${Math.floor(bytes / (1024 * 1024))} MB`;

/** Reads dimensions with sharp, turning a sideways photo (EXIF orientation 5 to 8) the right way up. Null when unreadable. */
export const readImageDimensionsWithSharp: ImageDimensionReader = async (bytes) => {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    const sideways = (meta.orientation ?? 1) >= 5;
    return sideways ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
};

/**
 * The plain-language reason an upload can't be the logo or banner, or null when it can. The cheap checks (event, type, size)
 * run before the bytes are read.
 */
export async function themeImageProblem(
  kind: ThemeImageKind,
  asset: ThemeImageAsset | null,
  eventId: string,
  readBytes: () => Promise<Uint8Array>,
  readDimensions: ImageDimensionReader = readImageDimensionsWithSharp,
): Promise<string | null> {
  const limits = THEME_IMAGE_LIMITS[kind];
  // The same words for a missing file and another event's file, so a request can't probe what other events hold.
  if (!asset || asset.eventId !== eventId) return `That file isn't one of this event's uploads. Choose the ${limits.label} from the list.`;
  if (!isThemeImageType(asset.contentType)) return `The ${limits.label} must be a PNG, JPEG or WebP picture. PDFs and other files can't be used.`;
  if (asset.byteSize > limits.maxBytes) return `That file is too large for the ${limits.label}. Use one that is ${megabytes(limits.maxBytes)} or smaller.`;
  let bytes: Uint8Array;
  try {
    bytes = await readBytes();
  } catch {
    return `That file couldn't be read. Upload it again and choose the new copy.`;
  }
  const size = await readDimensions(bytes);
  if (!size) return `That file couldn't be read as a picture. Upload a PNG, JPEG or WebP and choose the new copy.`;
  if (size.width < limits.minWidth || size.height < limits.minHeight) {
    return `The ${limits.label} is ${size.width} by ${size.height} pixels. It needs to be at least ${limits.minWidth} by ${limits.minHeight} pixels to look sharp.`;
  }
  if (kind === "hero" && size.width <= size.height) return `The banner is ${size.width} by ${size.height} pixels. It needs to be wider than it is tall.`;
  return null;
}

export type ThemeImageAltTokens = { logoAlt?: string; heroAlt?: string; heroFocus?: string };

/**
 * The tokens with alt text kept only for an image that is chosen: a description is dropped when there is no image, and
 * returns the plain-language problem when an image has none.
 */
export function reconcileImageAlt<T extends ThemeImageAltTokens>(
  tokens: T,
  ids: { logoAssetId: string | null; heroAssetId: string | null },
): { tokens: T; problem: string | null } {
  const next = { ...tokens };
  let problem: string | null = null;
  if (ids.logoAssetId) {
    if (!next.logoAlt?.trim()) problem = "Describe the logo in a few words so people who can't see it know what it is.";
  } else delete next.logoAlt;
  if (ids.heroAssetId) {
    if (!next.heroAlt?.trim() && !problem) problem = "Describe the banner in a few words so people who can't see it know what it shows.";
  } else {
    delete next.heroAlt;
    delete next.heroFocus;
  }
  return { tokens: next, problem };
}
