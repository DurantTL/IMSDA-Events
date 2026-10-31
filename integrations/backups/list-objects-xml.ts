import type { BackupObject } from "./types";

/**
 * A strict, small reader for an S3 ListObjectsV2 answer. It reads only `<Contents>` (Key, LastModified, Size),
 * `IsTruncated` and `NextContinuationToken`. An entry without a usable key or time is skipped, never guessed.
 */

export class ListObjectsXmlError extends Error {
  constructor() {
    super("The listing was not a ListObjectsV2 answer.");
    this.name = "ListObjectsXmlError";
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#")) {
      const code = body.startsWith("#x") ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** The text of the first `<tag>` in a fragment, or null. Tags here never nest, so a lazy match is exact. */
function textOf(fragment: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(fragment);
  return match ? decodeXmlEntities(match[1]) : null;
}

export type ParsedListing = {
  objects: BackupObject[];
  truncated: boolean;
  nextToken: string | null;
};

export function parseListObjectsV2(xml: string): ParsedListing {
  if (!/<ListBucketResult[\s>]/.test(xml)) throw new ListObjectsXmlError();

  const objects: BackupObject[] = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const entry = match[1];
    const key = textOf(entry, "Key");
    const modified = textOf(entry, "LastModified");
    if (!key || !modified) continue;
    const lastModified = new Date(modified);
    if (Number.isNaN(lastModified.getTime())) continue;
    const sizeText = textOf(entry, "Size");
    const size = sizeText !== null && /^\d{1,15}$/.test(sizeText) ? Number(sizeText) : null;
    objects.push({ key, lastModified, size });
  }

  // Look outside the Contents blocks so an object key cannot spoof these.
  const outside = xml.replace(/<Contents>[\s\S]*?<\/Contents>/g, "");
  return {
    objects,
    truncated: textOf(outside, "IsTruncated") === "true",
    nextToken: textOf(outside, "NextContinuationToken") || null,
  };
}
