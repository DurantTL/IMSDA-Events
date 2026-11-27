import type { DistanceOrigin } from "@/components/club-distance";
import { createRetryableLoader } from "@/components/public-club-finder-logic";

/**
 * Town and ZIP lookup for "Near me" on Find a club (#2056), for visitors who
 * don't share their location. It runs entirely in the browser against a
 * bundled Iowa and Missouri table (components/place-lookup-data.ts, from
 * GeoNames), so what they type is never sent anywhere: no geocoding service,
 * no server request, no web address, no measuring.
 */
type Place = { name: string; state: string; latitude: number; longitude: number };

export type PlaceIndex = {
  zips: Map<string, Place>;
  /** Normalized town name, then one entry per state the town is in. */
  towns: Map<string, Place[]>;
};

export type PlaceLookupResult =
  | { status: "found"; origin: DistanceOrigin }
  | { status: "empty" }
  | { status: "bad-zip" }
  | { status: "zip-not-found"; zip: string }
  | { status: "not-found"; query: string }
  | { status: "ambiguous"; town: string };

const STATE_WORDS: Record<string, string> = { ia: "IA", iowa: "IA", mo: "MO", missouri: "MO" };
const LEADING_ABBREVIATIONS: Record<string, string> = { st: "saint", ste: "sainte", ft: "fort", mt: "mount" };

/** Lowercase, no punctuation, single spaces, and "St."/"Ft."/"Mt." spelled out, so "St. Louis" finds "Saint Louis". */
export function normalizeTownName(value: string) {
  const words = value
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[-,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 0 && LEADING_ABBREVIATIONS[words[0]]) words[0] = LEADING_ABBREVIATIONS[words[0]];
  return words.join(" ");
}

export function buildPlaceIndex(rows: string): PlaceIndex {
  const zips = new Map<string, Place>();
  const sums = new Map<string, { name: string; state: string; latitude: number; longitude: number; count: number }>();
  for (const row of rows.split("\n")) {
    const [zip, name, state, lat, lng] = row.split("|");
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!zip || !name || !state || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    zips.set(zip, { name, state, latitude, longitude });
    const key = `${normalizeTownName(name)}|${state}`;
    const sum = sums.get(key);
    if (sum) {
      sum.latitude += latitude;
      sum.longitude += longitude;
      sum.count += 1;
    } else {
      sums.set(key, { name, state, latitude, longitude, count: 1 });
    }
  }
  const towns = new Map<string, Place[]>();
  for (const [key, sum] of sums) {
    const town = key.slice(0, key.lastIndexOf("|"));
    const place = { name: sum.name, state: sum.state, latitude: sum.latitude / sum.count, longitude: sum.longitude / sum.count };
    towns.set(town, [...(towns.get(town) ?? []), place].sort((a, b) => a.state.localeCompare(b.state)));
  }
  return { zips, towns };
}

/** "Ames", "Ames, IA", "ames iowa", "50010" or "50010-1234". */
export function lookUpPlace(index: PlaceIndex, input: string): PlaceLookupResult {
  const query = input.trim().replace(/\s+/g, " ");
  if (!query) return { status: "empty" };
  if (/^\d/.test(query)) {
    const zip = /^(\d{5})(-\d{4})?$/.exec(query)?.[1];
    if (!zip) return { status: "bad-zip" };
    const place = index.zips.get(zip);
    if (!place) return { status: "zip-not-found", zip };
    return { status: "found", origin: { latitude: place.latitude, longitude: place.longitude, label: `ZIP ${zip} (${place.name}, ${place.state})`, source: "place" } };
  }

  let town = query;
  let state: string | null = null;
  const withState = /^(.+?)[,\s]+(ia|iowa|mo|missouri)\.?$/i.exec(query);
  if (withState && normalizeTownName(withState[1])) {
    town = withState[1];
    state = STATE_WORDS[withState[2].toLowerCase()];
  }
  const places = index.towns.get(normalizeTownName(town)) ?? [];
  const matches = state ? places.filter((place) => place.state === state) : places;
  if (matches.length === 0) return { status: "not-found", query };
  if (matches.length > 1) return { status: "ambiguous", town: matches[0].name };
  const [place] = matches;
  return { status: "found", origin: { latitude: place.latitude, longitude: place.longitude, label: `${place.name}, ${place.state}`, source: "place" } };
}

/** The message shown next to the town or ZIP box when a lookup doesn't find one place. */
export function placeLookupMessage(result: Exclude<PlaceLookupResult, { status: "found" }>) {
  switch (result.status) {
    case "empty":
      return "Enter a town or a 5-digit ZIP code.";
    case "bad-zip":
      return "Enter a 5-digit ZIP code, like 50010.";
    case "zip-not-found":
      return `ZIP ${result.zip} isn't in Iowa or Missouri. Try a nearby town in Iowa or Missouri.`;
    case "not-found":
      return `We couldn't find “${result.query}” in Iowa or Missouri. Check the spelling or try a ZIP code.`;
    case "ambiguous":
      return `There is a ${result.town} in Iowa and in Missouri. Add IA or MO, like “${result.town}, IA”.`;
  }
}

/** The table is loaded only when someone looks up a town or ZIP; a failed load is retried next time. */
export const loadPlaceIndex = createRetryableLoader(() =>
  import("@/components/place-lookup-data").then((data) => buildPlaceIndex(data.placeLookupRows)),
);
