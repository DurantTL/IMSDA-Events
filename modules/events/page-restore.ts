import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  EventContentError,
  listEventContentSections,
  replaceEventContent,
} from "@/modules/events/content-repository";
import { eventContentInputSchema } from "@/modules/events/content-schemas";
import { getPageVersion } from "@/modules/events/page-versions";

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
 * The version's sections come back published; the event's current unpublished sections stay as drafts, with their
 * schedule when it is still in the future. The result goes through the ordinary page save, so the custom HTML rule,
 * the contact check and the file ownership checks all apply as they do for any save. The save records the new state as
 * its own version, marked as a rollback.
 */
export async function restoreEventPageVersion(input: {
  eventId: string;
  versionId: string;
  actorUserId: string;
  isSystemAdmin: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
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
    // A time that has already passed would be refused by the save; the draft simply stays a draft.
    scheduledPublishAt: section.scheduledPublishAt && new Date(section.scheduledPublishAt).getTime() > now.getTime()
      ? section.scheduledPublishAt
      : null,
  }));
  const versionSections = Array.isArray(version.sections) ? version.sections : [];
  const parsed = eventContentInputSchema.safeParse({ sections: [...versionSections, ...drafts] });
  if (!parsed.success) throw new PageVersionRestoreError("VERSION_CANNOT_BE_RESTORED", VERSION_CANNOT_RESTORE_MESSAGE);

  let sections;
  try {
    sections = await replaceEventContent(input.eventId, parsed.data, input.actorUserId, {
      isSystemAdmin: input.isSystemAdmin,
      source: "ROLLBACK",
      restoredFromId: version.id,
    });
  } catch (error) {
    // A file or contact the old version used is gone or no longer valid: the version cannot come back as it was.
    if (error instanceof EventContentError && error.code !== "CUSTOM_HTML_FORBIDDEN") {
      throw new PageVersionRestoreError("VERSION_CANNOT_BE_RESTORED", VERSION_CANNOT_RESTORE_MESSAGE);
    }
    throw error;
  }
  await getPrisma().auditLog.create({
    data: {
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "EVENT_PAGE_ROLLED_BACK",
      entityType: "EventPageVersion",
      entityId: version.id,
      correlationId: `event-page-rollback:${input.eventId}:${now.getTime()}`,
      summary: `Restored published version ${version.versionNumber} of the event page.`,
      metadata: { versionNumber: version.versionNumber },
    },
  });
  return { sections, versionNumber: version.versionNumber };
}
