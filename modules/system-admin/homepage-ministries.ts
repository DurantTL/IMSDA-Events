import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import {
  fallbackHomepageMinistries,
  homepageMinistryCount,
  ministryIconOrDefault,
  type HomepageMinistriesInput,
  type HomepageMinistry,
} from "@/modules/system-admin/homepage-ministries-domain";

export type HomepageMinistryRecord = HomepageMinistry & { updatedAt: string | null };

function toTile(row: { position: number; name: string; description: string | null; linkHref: string | null; categories: string[]; icon: string }): HomepageMinistry {
  return {
    position: row.position,
    name: row.name,
    description: row.description?.trim() ? row.description.trim() : null,
    linkHref: row.linkHref?.trim() ? row.linkHref.trim() : null,
    categories: row.categories ?? [],
    icon: ministryIconOrDefault(row.icon),
  };
}

/**
 * The tiles the public homepage shows, in position order. Never throws: an empty or unreadable table gives the six
 * names with no categories, so the homepage still loads (#1251).
 */
export async function listHomepageMinistries(): Promise<HomepageMinistry[]> {
  try {
    const rows = await getPrisma().homepageMinistry.findMany({ orderBy: { position: "asc" }, take: homepageMinistryCount });
    return rows.length > 0 ? rows.map(toTile) : fallbackHomepageMinistries;
  } catch (error) {
    logError("Reading the homepage ministries failed; showing the default names", error);
    return fallbackHomepageMinistries;
  }
}

/** The tiles for the Platform settings form: the stored rows, with the default name for any slot not stored yet. */
export async function getHomepageMinistriesForAdmin(): Promise<{ ministries: HomepageMinistry[]; updatedAt: string | null; updatedByName: string | null }> {
  const rows = await getPrisma().homepageMinistry.findMany({
    orderBy: { position: "asc" },
    take: homepageMinistryCount,
    include: { updatedBy: { select: { displayName: true } } },
  });
  const byPosition = new Map(rows.map((row) => [row.position, row]));
  const latest = rows.reduce<(typeof rows)[number] | null>((best, row) => (!best || row.updatedAt > best.updatedAt ? row : best), null);
  return {
    ministries: fallbackHomepageMinistries.map((fallback) => {
      const row = byPosition.get(fallback.position);
      return row ? toTile(row) : fallback;
    }),
    updatedAt: latest ? latest.updatedAt.toISOString() : null,
    updatedByName: latest?.updatedBy?.displayName ?? null,
  };
}

/**
 * Saves all six tiles and writes one audit row, with both sides, in the same transaction (#1251). The audit row
 * carries the tiles' names, descriptions, links, categories and icons: staff-written public copy, no personal data.
 */
export async function updateHomepageMinistries(input: HomepageMinistriesInput, actorUserId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const beforeRows = await tx.homepageMinistry.findMany({ orderBy: { position: "asc" } });
    const snapshot = (tile: HomepageMinistry) => ({ position: tile.position, name: tile.name, description: tile.description, linkHref: tile.linkHref, categories: tile.categories, icon: tile.icon });
    const after = [...input.ministries].sort((a, b) => a.position - b.position).map((tile) => snapshot({
      position: tile.position, name: tile.name, description: tile.description ?? null, linkHref: tile.linkHref ?? null, categories: tile.categories, icon: tile.icon,
    }));
    for (const tile of after) {
      await tx.homepageMinistry.upsert({
        where: { position: tile.position },
        update: { name: tile.name, description: tile.description, linkHref: tile.linkHref, categories: tile.categories, icon: tile.icon, updatedByUserId: actorUserId },
        create: { ...tile, updatedByUserId: actorUserId },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "HOMEPAGE_MINISTRIES_UPDATED",
        entityType: "HomepageMinistry",
        entityId: "homepage-ministries",
        correlationId: `homepage-ministries:${Date.now()}`,
        summary: "Updated the homepage ministry tiles.",
        metadata: { before: beforeRows.map((row) => snapshot(toTile(row))), after },
      },
    });
  });
  return getHomepageMinistriesForAdmin();
}
