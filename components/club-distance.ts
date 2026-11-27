/**
 * "Near me" on Find a club (#2056): straight-line distances from a point the
 * visitor chose (their device's location, or a town or ZIP they typed) to
 * each listed club. Everything here runs in the visitor's browser; the point
 * is never sent to the server, stored, put in the web address or measured.
 */
export type DistanceOrigin = {
  latitude: number;
  longitude: number;
  /** What the status line says the list is sorted from, e.g. "your location" or "Ames, IA". */
  label: string;
  /** "place" when it came from the bundled town and ZIP table, which is credited where the list says what it is sorted from. */
  source: "device" | "place";
};

type Located = { latitude: number | null; longitude: number | null };

const EARTH_RADIUS_MILES = 3958.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle ("as the crow flies") distance in miles. */
export function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A club's distance from the origin, or null when the club has no map location. */
export function clubMiles(club: Located, origin: DistanceOrigin | null) {
  if (!origin || club.latitude === null || club.longitude === null) return null;
  return milesBetween(origin, { latitude: club.latitude, longitude: club.longitude });
}

/**
 * Nearest first. Clubs without a map location keep their usual order at the
 * end, and clubs at the same distance (one church, one pin) keep theirs too.
 */
export function sortByDistance<T extends Located>(clubs: T[], origin: DistanceOrigin | null): T[] {
  if (!origin) return clubs;
  return clubs
    .map((club, index) => ({ club, index, miles: clubMiles(club, origin) }))
    .sort((a, b) => {
      if (a.miles === null || b.miles === null) {
        if (a.miles === b.miles) return a.index - b.index;
        return a.miles === null ? 1 : -1;
      }
      return a.miles - b.miles || a.index - b.index;
    })
    .map((entry) => entry.club);
}

/** "Under 1 mi", "4 mi", "128 mi". */
export function formatMiles(miles: number) {
  if (miles < 1) return "Under 1 mi";
  return `${Math.round(miles).toLocaleString("en-US")} mi`;
}

/** The points the map frames when sorting by distance: the origin and its nearest few pins. */
export function nearestPoints<T extends { latitude: number; longitude: number }>(points: T[], origin: DistanceOrigin, count = 3): T[] {
  return points
    .map((point) => ({ point, miles: milesBetween(origin, point) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, count)
    .map((entry) => entry.point);
}
