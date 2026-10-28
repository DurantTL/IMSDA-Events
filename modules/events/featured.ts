import "server-only";

import { getPrisma } from "@/lib/prisma";
import { calendarDateIn } from "@/modules/calendar/domain";
import { parseBlockData } from "@/modules/events/content-schemas";
import { activeFeaturedRows, type FeaturedEventRow } from "@/modules/events/featured-domain";

/**
 * Events staff have featured that may still show today (#1218). Published, shown on the calendar and not archived are
 * checked in the query, so unpublishing or archiving removes an event at once; expiry is applied on the same read. A
 * `limit` cuts the ordered list. The homepage passes none: a row with no public calendar item must not take a slot, so it matches rows to items first and then keeps three.
 */
export async function listFeaturedEventRows(today: string, limit?: number): Promise<FeaturedEventRow[]> {
  const events = await getPrisma().event.findMany({
    where: { featured: true, isPublished: true, archivedAt: null, showOnCalendar: true },
    select: { slug: true, startsAt: true, endsAt: true, timezone: true, featuredOrder: true, featureUntil: true },
  });
  return activeFeaturedRows(
    events.map((event) => ({
      slug: event.slug,
      featuredOrder: event.featuredOrder,
      featureUntil: event.featureUntil,
      startsOn: calendarDateIn(event.startsAt, event.timezone),
      endsOn: calendarDateIn(event.endsAt, event.timezone),
    })),
    today,
    limit,
  );
}

/**
 * The photo header image of each event page (#1207), by event slug, for cards. Only a published header section counts,
 * which is also what lets the public asset route serve the file, so a card never points at an image it cannot load.
 */
export async function listEventCardImages(slugs: readonly string[]): Promise<Map<string, { assetId: string }>> {
  const images = new Map<string, { assetId: string }>();
  if (slugs.length === 0) return images;
  const sections = await getPrisma().eventContentSection.findMany({
    where: { kind: "HERO", isPublished: true, event: { slug: { in: [...slugs] }, isPublished: true, archivedAt: null } },
    select: { data: true, event: { select: { slug: true } } },
  });
  for (const section of sections) {
    const data = parseBlockData("HERO", section.data);
    if (data) images.set(section.event.slug, { assetId: data.assetId });
  }
  return images;
}

/**
 * The events staff chose by hand for the homepage (#111), in the order chosen. Each must still pass the public rules
 * (published, shown on the calendar, not archived, not ended); the featured flag itself is not needed. An id that is
 * unknown, private, unpublished or past is dropped without a trace, so a private event's title can never leak.
 */
export async function listCuratedFeaturedRows(ids: readonly string[], today: string): Promise<FeaturedEventRow[]> {
  if (ids.length === 0) return [];
  const events = await getPrisma().event.findMany({
    where: { id: { in: [...ids] }, isPublished: true, archivedAt: null, showOnCalendar: true },
    select: { id: true, slug: true, startsAt: true, endsAt: true, timezone: true },
  });
  const byId = new Map(events.map((event) => [event.id, event]));
  const rows: FeaturedEventRow[] = [];
  ids.forEach((id, index) => {
    const event = byId.get(id);
    if (!event) return;
    const endsOn = calendarDateIn(event.endsAt, event.timezone);
    rows.push({ slug: event.slug, featuredOrder: index + 1, featureUntil: endsOn, startsOn: calendarDateIn(event.startsAt, event.timezone), endsOn });
  });
  return activeFeaturedRows(rows, today);
}

/** Public events staff can choose to feature: published, on the calendar, not archived and not ended. Titles and dates only. */
export async function listFeaturableEvents(today: string): Promise<Array<{ id: string; name: string; startsOn: string; endsOn: string }>> {
  const events = await getPrisma().event.findMany({
    where: { isPublished: true, archivedAt: null, showOnCalendar: true, endsAt: { gte: new Date(`${today}T00:00:00Z`) } },
    select: { id: true, name: true, startsAt: true, endsAt: true, timezone: true },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  return events
    .map((event) => ({ id: event.id, name: event.name, startsOn: calendarDateIn(event.startsAt, event.timezone), endsOn: calendarDateIn(event.endsAt, event.timezone) }))
    .filter((event) => event.endsOn >= today);
}
