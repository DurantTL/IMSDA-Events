import "server-only";

import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/prisma";
import { parseEventContentItems } from "@/modules/events/content-schemas";

/**
 * Published versions of an event page (#1514).
 *
 * A version is the published sections in page order, stored in the shape of one section of the save schema
 * (`eventContentInputSchema`) so restoring one is an ordinary save. A version is written only when the published
 * sections differ from the latest version's, so saving a draft changes nothing here. History starts when this ships.
 */

export const PAGE_VERSION_LIST_LIMIT = 20;

export type PageVersionSource = "SAVE" | "SCHEDULED_PUBLISH" | "ROLLBACK";

export type PageVersionSection = {
  kind: string;
  title: string;
  body: string;
  tone: string | null;
  placement: string;
  items: Array<{ title: string; text: string }>;
  data: Record<string, unknown>;
  links: Array<{ label: string; description: string; url: string | null; assetId: string | null }>;
  isPublished: true;
};

/** JSON with object keys sorted, so two snapshots of the same page compare equal whatever order a store returned keys in. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The event's published sections, in page order, as they would be saved. Read inside the caller's transaction. */
export async function snapshotPublishedSections(tx: Prisma.TransactionClient, eventId: string): Promise<PageVersionSection[]> {
  const rows = await tx.eventContentSection.findMany({
    where: { eventId, isPublished: true },
    orderBy: { position: "asc" },
    select: {
      kind: true,
      title: true,
      body: true,
      tone: true,
      placement: true,
      items: true,
      data: true,
      links: { orderBy: { position: "asc" }, select: { label: true, description: true, url: true, assetId: true } },
    },
  });
  return (rows ?? []).map((row) => ({
    kind: row.kind,
    title: row.title,
    body: row.body,
    tone: row.tone ?? null,
    placement: row.placement,
    items: parseEventContentItems(row.items),
    data: row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {},
    links: (row.links ?? []).map((link) => ({ label: link.label, description: link.description, url: link.url, assetId: link.assetId })),
    isPublished: true as const,
  }));
}

/**
 * Writes the next version when the published sections changed since the latest one. Returns the new version number,
 * or null when nothing published changed. Call it inside the transaction that changed the sections.
 */
export async function recordPageVersionIfChanged(
  tx: Prisma.TransactionClient,
  eventId: string,
  options: { source: PageVersionSource; actorUserId?: string | null; restoredFromId?: string | null },
): Promise<number | null> {
  const snapshot = await snapshotPublishedSections(tx, eventId);
  const latest = await tx.eventPageVersion.findFirst({
    where: { eventId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, sections: true },
  });
  const before = latest ? stableJson(latest.sections) : stableJson([]);
  if (stableJson(snapshot) === before) return null;
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  await tx.eventPageVersion.create({
    data: {
      eventId,
      versionNumber,
      sections: snapshot as unknown as Prisma.InputJsonValue,
      source: options.source,
      restoredFromId: options.restoredFromId ?? null,
      createdByUserId: options.actorUserId ?? null,
    },
  });
  return versionNumber;
}

export type PageVersionSummary = {
  id: string;
  versionNumber: number;
  createdAt: string;
  source: PageVersionSource;
  /** The person's name; null for a scheduled publish or a removed account. */
  who: string | null;
  sectionCount: number;
  titles: string[];
};

function sectionTitles(sections: unknown): string[] {
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => (
    section && typeof section === "object" && typeof (section as { title?: unknown }).title === "string"
      ? [(section as { title: string }).title]
      : []
  ));
}

/** The latest versions, newest first. Names and titles only; never the section bodies. */
export async function listPageVersions(eventId: string): Promise<PageVersionSummary[]> {
  const rows = await getPrisma().eventPageVersion.findMany({
    where: { eventId },
    orderBy: { versionNumber: "desc" },
    take: PAGE_VERSION_LIST_LIMIT,
    select: {
      id: true,
      versionNumber: true,
      createdAt: true,
      source: true,
      sections: true,
      createdBy: { select: { displayName: true } },
    },
  });
  return rows.map((row) => {
    const titles = sectionTitles(row.sections);
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      createdAt: row.createdAt.toISOString(),
      source: row.source,
      who: row.createdBy?.displayName ?? null,
      sectionCount: titles.length,
      titles,
    };
  });
}

/** One version of this event, or null when the id belongs to another event or does not exist. */
export async function getPageVersion(eventId: string, versionId: string) {
  return getPrisma().eventPageVersion.findFirst({
    where: { id: versionId, eventId },
    select: { id: true, versionNumber: true, sections: true },
  });
}
