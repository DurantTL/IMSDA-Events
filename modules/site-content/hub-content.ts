import "server-only";

import { cache } from "react";
import { Prisma, type SiteContentStatus } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  changedHubKeys,
  defaultHubContent,
  hubContentProblem,
  hubContentSchema,
  limits,
  parseHubContent,
  type HubContent,
} from "@/modules/site-content/hub-content-domain";

/**
 * The public hub's content store (#111), modelled on the event content sections: one working draft, one published
 * version, and every earlier published version kept for rollback. Every change writes an audit row. The caller has
 * already passed `canManageSiteContent`; nothing here checks who is asking.
 */

export class SiteContentError extends Error {
  constructor(
    public readonly code: "INVALID_CONTENT" | "NO_DRAFT" | "NOT_FOUND" | "NOT_RESTORABLE" | "CONFLICT",
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "SiteContentError";
  }
}

export type RevisionSummary = {
  id: string;
  status: SiteContentStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  restoredFromId: string | null;
};

export type SiteContentAdminState = {
  /** What the editor starts from: the draft, else the published version, else the built-in default. */
  content: HubContent;
  draft: RevisionSummary | null;
  published: RevisionSummary | null;
  /** Whether the draft differs from what is published (or from the default when nothing is published). */
  draftDiffers: boolean;
  history: RevisionSummary[];
};

const historyLimit = 50;

/**
 * What the editor last saw of the draft: its id and `updatedAt` (as returned by a save), or null for "there was no
 * draft". A save or publish carrying it is refused with 409 when the draft has since changed, so two editors cannot
 * silently overwrite each other. Omitted by callers that do not track it.
 */
export type DraftBase = { id: string; updatedAt: string } | null;

const staleDraft = () => new SiteContentError("CONFLICT", "Someone else changed the draft. Reload the page to see their changes.", 409);

function matchesBase(draft: { id: string; updatedAt: Date } | null, base: DraftBase | undefined) {
  if (base === undefined) return true;
  if (base === null) return draft === null;
  return draft !== null && draft.id === base.id && draft.updatedAt.toISOString() === base.updatedAt;
}

const withActors = { createdBy: { select: { displayName: true } }, publishedBy: { select: { displayName: true } } } as const;
type RevisionRow = Prisma.SiteContentRevisionGetPayload<{ include: typeof withActors }>;

function summarize(row: RevisionRow): RevisionSummary {
  return {
    id: row.id,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy?.displayName ?? null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    publishedByName: row.publishedBy?.displayName ?? null,
    restoredFromId: row.restoredFromId,
  };
}

const asJson = (content: HubContent) => content as unknown as Prisma.InputJsonValue;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Validates what the editor sent. The first problem comes back as a plain-words 400. */
export function validateHubContent(input: unknown): HubContent {
  const parsed = hubContentSchema.safeParse(input);
  if (!parsed.success) throw new SiteContentError("INVALID_CONTENT", hubContentProblem(parsed.error));
  return parsed.data;
}

function cleanNote(note: string | null | undefined) {
  const trimmed = (note ?? "").trim();
  if (trimmed.length > limits.revisionNote) throw new SiteContentError("INVALID_CONTENT", `A note can be at most ${limits.revisionNote} characters.`);
  return trimmed === "" ? null : trimmed;
}

/**
 * What the public pages show: the published version, or the built-in default when nothing is published or the stored
 * document no longer fits the rules (logged without its content). Read once per request. Never throws, so a database
 * problem cannot take the homepage down.
 */
export const getPublishedHubContent = cache(async (): Promise<HubContent> => {
  try {
    const row = await getPrisma().siteContentRevision.findFirst({ where: { status: "PUBLISHED" }, select: { id: true, content: true } });
    if (!row) return defaultHubContent();
    const parsed = parseHubContent(row.content);
    if (!parsed) {
      logWarn("Published site content did not match the rules; showing the default homepage", { revisionId: row.id });
      return defaultHubContent();
    }
    return parsed;
  } catch (error) {
    logWarn("Reading the published site content failed; showing the default homepage", { reason: error instanceof Error ? error.name : "unknown" });
    return defaultHubContent();
  }
});

/** The working draft's content for the preview, or null when there is none (or it no longer parses). */
export async function getDraftHubContent(): Promise<HubContent | null> {
  const row = await getPrisma().siteContentRevision.findFirst({ where: { status: "DRAFT" }, select: { content: true } });
  return row ? parseHubContent(row.content) : null;
}

export async function getSiteContentAdminState(): Promise<SiteContentAdminState> {
  const prisma = getPrisma();
  const [draftRow, publishedRow, historyRows] = await Promise.all([
    prisma.siteContentRevision.findFirst({ where: { status: "DRAFT" }, include: withActors }),
    prisma.siteContentRevision.findFirst({ where: { status: "PUBLISHED" }, include: withActors }),
    prisma.siteContentRevision.findMany({ where: { status: { in: ["PUBLISHED", "SUPERSEDED"] } }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: historyLimit, include: withActors }),
  ]);
  const published = publishedRow ? parseHubContent(publishedRow.content) : null;
  const draft = draftRow ? parseHubContent(draftRow.content) : null;
  const live = published ?? defaultHubContent();
  const content = draft ?? live;
  return {
    content,
    draft: draftRow ? summarize(draftRow) : null,
    published: publishedRow ? summarize(publishedRow) : null,
    draftDiffers: draft ? changedHubKeys(live, draft).length > 0 : false,
    history: historyRows.map(summarize),
  };
}

/**
 * Saves the working draft (creating it on the first save) and audits it. The row is only changed while it is still the
 * draft and unchanged since it was read, so a publish or another save in between can never be overwritten: that is a
 * 409, not a lost update. The last person to save is recorded as the draft's author.
 */
export async function saveHubDraft(input: unknown, note: string | null | undefined, actorUserId: string, base?: DraftBase): Promise<RevisionSummary> {
  const content = validateHubContent(input);
  const cleanedNote = cleanNote(note);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const live = await tx.siteContentRevision.findFirst({ where: { status: "PUBLISHED" }, select: { content: true } });
      const before = live ? parseHubContent(live.content) : null;
      const existing = await tx.siteContentRevision.findFirst({ where: { status: "DRAFT" }, select: { id: true, updatedAt: true } });
      if (!matchesBase(existing, base)) throw staleDraft();
      let id: string;
      if (existing) {
        const changed = await tx.siteContentRevision.updateMany({
          where: { id: existing.id, status: "DRAFT", updatedAt: existing.updatedAt },
          data: { content: asJson(content), note: cleanedNote, createdByUserId: actorUserId },
        });
        if (changed.count !== 1) throw staleDraft();
        id = existing.id;
      } else {
        id = (await tx.siteContentRevision.create({ data: { content: asJson(content), status: "DRAFT", note: cleanedNote, createdByUserId: actorUserId } })).id;
      }
      const row = await tx.siteContentRevision.findUniqueOrThrow({ where: { id }, include: withActors });
      await writeAuditLog({
        actorUserId,
        action: "SITE_CONTENT_DRAFT_SAVED",
        entityType: "SiteContentRevision",
        entityId: row.id,
        summary: "Saved the homepage and site content draft.",
        metadata: { revisionId: row.id, changedKeys: changedHubKeys(before, content) },
      }, tx);
      return summarize(row);
    });
  } catch (error) {
    // A second first save at the same moment: the database allows one draft only.
    if (isUniqueViolation(error)) throw staleDraft();
    throw error;
  }
}

/** Publishes the draft: it becomes the one PUBLISHED version and the previous one is kept as SUPERSEDED, in one transaction. */
export async function publishHubDraft(actorUserId: string, now = new Date(), base?: DraftBase): Promise<RevisionSummary> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      const draft = await tx.siteContentRevision.findFirst({ where: { status: "DRAFT" } });
      if (!draft) throw new SiteContentError("NO_DRAFT", "There is no draft to publish. Save a draft first.", 409);
      if (!matchesBase(draft, base)) throw staleDraft();
      const content = parseHubContent(draft.content);
      if (!content) throw new SiteContentError("INVALID_CONTENT", "The draft no longer fits the rules. Fix it and save again before publishing.");
      const previous = await tx.siteContentRevision.findFirst({ where: { status: "PUBLISHED" }, select: { id: true, content: true } });
      if (previous) await tx.siteContentRevision.updateMany({ where: { id: previous.id, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
      // Conditional on still being the draft we read, unchanged: a second publish or a save at the same moment changes
      // nothing and reports a conflict, so what goes live is exactly the content the audit row describes.
      const claimed = await tx.siteContentRevision.updateMany({
        where: { id: draft.id, status: "DRAFT", updatedAt: draft.updatedAt },
        data: { status: "PUBLISHED", publishedByUserId: actorUserId, publishedAt: now },
      });
      if (claimed.count !== 1) throw staleDraft();
      const row = await tx.siteContentRevision.findUniqueOrThrow({ where: { id: draft.id }, include: withActors });
      await writeAuditLog({
        actorUserId,
        action: "SITE_CONTENT_PUBLISHED",
        entityType: "SiteContentRevision",
        entityId: draft.id,
        summary: "Published the homepage and site content.",
        metadata: {
          revisionId: draft.id,
          supersededRevisionId: previous?.id ?? null,
          changedKeys: changedHubKeys(previous ? parseHubContent(previous.content) : null, content),
        },
      }, tx);
      return summarize(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SiteContentError("CONFLICT", "Someone else just published. Reload the page and try again.", 409);
    throw error;
  }
}

/** Rolls back: a new PUBLISHED version copied from an earlier one, which is kept untouched; the previous live version becomes SUPERSEDED. */
export async function restoreHubRevision(revisionId: string, actorUserId: string, now = new Date()): Promise<RevisionSummary> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      const source = await tx.siteContentRevision.findUnique({ where: { id: revisionId } });
      if (!source) throw new SiteContentError("NOT_FOUND", "That version could not be found.", 404);
      if (source.status === "DRAFT") throw new SiteContentError("NOT_RESTORABLE", "Only a published version can be restored. Publish the draft instead.", 409);
      if (source.status === "PUBLISHED") throw new SiteContentError("NOT_RESTORABLE", "That version is already the one showing.", 409);
      const content = parseHubContent(source.content);
      if (!content) throw new SiteContentError("NOT_RESTORABLE", "That version no longer fits the rules and cannot be restored.", 409);
      const previous = await tx.siteContentRevision.findFirst({ where: { status: "PUBLISHED" }, select: { id: true, content: true } });
      if (previous) await tx.siteContentRevision.updateMany({ where: { id: previous.id, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
      const row = await tx.siteContentRevision.create({
        data: {
          content: asJson(content),
          status: "PUBLISHED",
          note: source.note,
          createdByUserId: actorUserId,
          publishedByUserId: actorUserId,
          publishedAt: now,
          restoredFromId: source.id,
        },
        include: withActors,
      });
      await writeAuditLog({
        actorUserId,
        action: "SITE_CONTENT_RESTORED",
        entityType: "SiteContentRevision",
        entityId: row.id,
        summary: "Restored an earlier version of the homepage and site content.",
        metadata: {
          revisionId: row.id,
          restoredFromId: source.id,
          supersededRevisionId: previous?.id ?? null,
          changedKeys: changedHubKeys(previous ? parseHubContent(previous.content) : null, content),
        },
      }, tx);
      return summarize(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SiteContentError("CONFLICT", "Someone else just published. Reload the page and try again.", 409);
    throw error;
  }
}

/** Throws the working draft away (the published version is untouched). Only a row that is still the draft can be deleted. */
export async function discardHubDraft(actorUserId: string, base?: DraftBase): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const draft = await tx.siteContentRevision.findFirst({ where: { status: "DRAFT" }, select: { id: true, updatedAt: true } });
    if (!draft) throw new SiteContentError("NO_DRAFT", "There is no draft to discard.", 409);
    if (!matchesBase(draft, base)) throw staleDraft();
    const removed = await tx.siteContentRevision.deleteMany({ where: { id: draft.id, status: "DRAFT" } });
    if (removed.count !== 1) throw staleDraft();
    await writeAuditLog({
      actorUserId,
      action: "SITE_CONTENT_DRAFT_DISCARDED",
      entityType: "SiteContentRevision",
      entityId: draft.id,
      summary: "Discarded the homepage and site content draft.",
      metadata: { revisionId: draft.id },
    }, tx);
  });
}
