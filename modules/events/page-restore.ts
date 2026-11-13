import "server-only";

import {
  EventContentError,
  listEventContentSections,
  replaceEventContent,
} from "@/modules/events/content-repository";
import { EVENT_CONTENT_SECTION_LIMIT, eventContentInputSchema } from "@/modules/events/content-schemas";
import { getPageVersion, stableJson } from "@/modules/events/page-versions";

export const VERSION_CANNOT_RESTORE_MESSAGE = "This version can no longer be restored.";

export class PageVersionRestoreError extends Error {
  constructor(public readonly code: "VERSION_NOT_FOUND" | "VERSION_CANNOT_BE_RESTORED", message: string) {
    super(message);
    this.name = "PageVersionRestoreError";
  }
}

/**
 * Puts an earlier published version of the page back (#1514).
 *
 * The version's sections come back published; the event's current unpublished sections stay as drafts with their
 * schedule, except that a draft whose scheduled time has already come is published by the save, as the sweep would. The result goes through the ordinary page save, so the custom HTML rule,
 * the contact check and the file ownership checks all apply as they do for any save. The save records the new state as
 * its own version, marked as a rollback.
 */
export async function restoreEventPageVersion(input: {
  eventId: string;
  versionId: string;
  actorUserId: string;
  isSystemAdmin: boolean;
}) {
  const version = await getPageVersion(input.eventId, input.versionId);
  if (!version) throw new PageVersionRestoreError("VERSION_NOT_FOUND", "That version was not found for this event.");

  const current = await listEventContentSections(input.eventId);
  const drafts = current.filter((section) => !section.isPublished).map((section) => ({
    kind: section.kind,
    title: section.title,
    body: section.body,
    tone: section.tone,
    placement: section.placement,
    items: section.items,
    data: section.data,
    links: section.links,
    isPublished: false,
    // Sent back as stored: a time that has passed since is accepted by the save, which publishes that section as due.
    scheduledPublishAt: section.scheduledPublishAt,
  }));
  const versionSections = Array.isArray(version.sections) ? version.sections : [];
  // A draft that is the same section as one coming back (it was unpublished after this version) would appear twice, and a
  // draft header banner that is not the same as the version's would clash with it and is refused below.
  const contentKey = (section: { kind: unknown; title: unknown; body: unknown; tone?: unknown; placement?: unknown; items?: unknown; data?: unknown; links?: unknown }) => stableJson({
    kind: section.kind, title: section.title, body: section.body, tone: section.tone ?? null, placement: section.placement,
    items: section.items ?? [], data: section.data ?? {}, links: section.links ?? [],
  });
  const comingBack = new Set(versionSections.map((section) => contentKey(section as Parameters<typeof contentKey>[0])));
  const versionHasHero = versionSections.some((section) => (section as { kind?: unknown }).kind === "HERO");
  const keptDrafts = drafts.filter((draft) => !comingBack.has(contentKey(draft)));
  if (versionHasHero && keptDrafts.some((draft) => draft.kind === "HERO")) {
    throw new PageVersionRestoreError("VERSION_CANNOT_BE_RESTORED", "Publish or remove your draft header banner first, then restore.");
  }
  if (versionSections.length + keptDrafts.length > EVENT_CONTENT_SECTION_LIMIT) {
    throw new PageVersionRestoreError(
      "VERSION_CANNOT_BE_RESTORED",
      `Restoring this version would put ${versionSections.length + keptDrafts.length} sections on the page, and a page holds at most ${EVENT_CONTENT_SECTION_LIMIT}. Remove some unpublished sections first.`,
    );
  }
  const parsed = eventContentInputSchema.safeParse({ sections: [...versionSections, ...keptDrafts] });
  if (!parsed.success) throw new PageVersionRestoreError("VERSION_CANNOT_BE_RESTORED", VERSION_CANNOT_RESTORE_MESSAGE);

  let sections;
  try {
    sections = await replaceEventContent(input.eventId, parsed.data, input.actorUserId, {
      isSystemAdmin: input.isSystemAdmin,
      source: "ROLLBACK",
      restoredFromId: version.id,
      extraAudit: {
        action: "EVENT_PAGE_ROLLED_BACK",
        entityType: "EventPageVersion",
        entityId: version.id,
        summary: `Restored published version ${version.versionNumber} of the event page.`,
        metadata: { versionNumber: version.versionNumber },
      },
    });
  } catch (error) {
    // A file or contact the old version used is gone or no longer valid: the version cannot come back as it was.
    if (error instanceof EventContentError && error.code !== "CUSTOM_HTML_FORBIDDEN") {
      throw new PageVersionRestoreError("VERSION_CANNOT_BE_RESTORED", VERSION_CANNOT_RESTORE_MESSAGE);
    }
    throw error;
  }
  return { sections, versionNumber: version.versionNumber };
}
