import "server-only";

import { getPrisma } from "@/lib/prisma";
import { calendarDateIn } from "@/modules/calendar/domain";
import { parseBlockData } from "@/modules/events/content-schemas";
import { activeFeaturedRows, type FeaturedEventRow } from "@/modules/events/featured-domain";

/**
 * Events staff have featured that may still show today (#1218). Published, shown on the calendar and not archived are
 * checked in the query, so unpublishing or archiving removes an event at once; expiry is applied on the same read. A
 * `limit` cuts the ordered list (the homepage shows three).
 */
export async function listFeaturedEventRows(today: string, limit?: number): Promise<FeaturedEventRow[]> {
  const events = await getPrisma().event.findMany({
    where: { featured: true, isPublished: true, archivedAt: null, showOnCalendar: true },
    select: { slug: true, startsAt: true, timezone: true, featuredOrder: true, featureUntil: true },
  });
  return activeFeaturedRows(
    events.map((event) => ({
      slug: event.slug,
      featuredOrder: event.featuredOrder,
      featureUntil: event.featureUntil,
      startsOn: calendarDateIn(event.startsAt, event.timezone),
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
