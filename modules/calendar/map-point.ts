/**
 * The map pin of a public calendar event (#1212): the host church or site's
 * name and coordinates, present only when the event has a site that is active
 * and has a map location. An event without one is simply not on the map.
 */
export type CalendarMapPoint = {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
};

export type CalendarMapSite = {
  id: string;
  name: string;
  isActive: boolean;
  churchLocation: { latitude: number | null; longitude: number | null } | null;
} | null;

export function calendarMapPoint(site: CalendarMapSite | undefined): CalendarMapPoint | undefined {
  if (!site || !site.isActive || !site.churchLocation) return undefined;
  const { latitude, longitude } = site.churchLocation;
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { siteId: site.id, siteName: site.name, latitude, longitude };
}
