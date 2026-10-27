/**
 * "Get directions" targets for the public event page (#1213). Built only from the location text a person typed in: no
 * coordinates, no geocoding, no map embed, no API key. Pure so one tested helper decides what is a usable place.
 */

export type DirectionsSite = { name: string; address?: string | null };
export type DirectionsTarget = { label: string; href: string };

/** Whole-text matches (case-insensitive, ignoring surrounding punctuation) that never name a place. */
const UNUSABLE = new Set([
  "tbd",
  "tba",
  "to be determined",
  "to be announced",
  "location details coming soon",
  "online",
  "online only",
  "virtual",
  "virtual only",
  "zoom",
  "livestream",
  "live stream",
  "online event",
  "virtual event",
]);

function normalized(text: string) {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
}

/** The trimmed place text when it can be searched on a map, otherwise null. */
export function usableLocationText(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  return UNUSABLE.has(normalized(trimmed)) ? null : trimmed;
}

export function mapsSearchUrl(text: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

/**
 * One link per usable active site (its address, else its name); when the event has active sites they replace the
 * event-level text, which is often a region. With no usable site, the event-level text gives at most one link.
 */
export function directionsTargets(input: { location?: string | null; sites?: readonly DirectionsSite[] | null }): DirectionsTarget[] {
  const sites = (input.sites ?? [])
    .map((site) => ({ name: site.name.trim(), text: usableLocationText(site.address) ?? usableLocationText(site.name) }))
    .filter((site): site is { name: string; text: string } => site.text !== null);
  if ((input.sites ?? []).length > 0) {
    return sites.map((site) => ({
      label: sites.length > 1 ? `Get directions to ${site.name}` : "Get directions",
      href: mapsSearchUrl(site.text),
    }));
  }
  const text = usableLocationText(input.location);
  return text ? [{ label: "Get directions", href: mapsSearchUrl(text) }] : [];
}
