import { getPrisma } from "@/lib/prisma";
import { AccessDeniedError } from "@/modules/access/authorization";
import type { EventPermission } from "@/modules/access/permissions";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { loadOperationsSearchCatalog } from "@/modules/registrations/operations-search-repository";
import type { SearchCatalog } from "@/modules/registrations/operations-search-domain";
import {
  checkSavedViewQuery,
  hasSavableContent,
  normalizeSavedViewName,
  normalizeSavedViewQuery,
  savedViewFilterKeys,
  type SavedViewItem,
} from "@/modules/registrations/saved-views-domain";

/**
 * Saved views of the Registrations list, the database half (#1511).
 *
 * Every function takes the signed-in person's own permissions for ONE event
 * (from the server's permission check, never from the request) and scopes each
 * query to that event. Someone else's unshared view is never read, changed or
 * deleted: it answers "not found", exactly like an id that does not exist.
 */

export class SavedViewError extends Error {
  constructor(public readonly code: "INVALID" | "NOT_FOUND" | "NAME_TAKEN", message: string) {
    super(message);
    this.name = "SavedViewError";
  }
}

export type SavedViewViewer = { eventId: string; userId: string; permissions: readonly EventPermission[] };

const notFound = () => new SavedViewError("NOT_FOUND", "That saved view could not be found.");
const nameTaken = () => new SavedViewError("NAME_TAKEN", "You already have a view with this name. Choose another name.");

function denied(message = "Your event role doesn't include this. Ask your event administrator if you need access.") {
  return new AccessDeniedError(message, 403, "PERMISSION_DENIED");
}

function requireRead(viewer: SavedViewViewer) {
  if (!viewer.permissions.includes("VIEW_SENSITIVE_DATA")) throw denied();
}

/** Publishing to other staff needs the right to manage registrations as well as to read the list. */
export function canShareSavedViews(permissions: readonly EventPermission[]) {
  return permissions.includes("VIEW_SENSITIVE_DATA") && permissions.includes("MANAGE_REGISTRATION");
}

function requireShare(viewer: SavedViewViewer) {
  requireRead(viewer);
  if (!canShareSavedViews(viewer.permissions)) throw denied("Sharing a view with event staff needs permission to manage registrations.");
}

const searchViewer = (viewer: SavedViewViewer) => ({ eventId: viewer.eventId, permissions: viewer.permissions });

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const GENERIC_REFUSAL = "This view has a filter that isn't available for this event or to you, so it can't be saved. Change the filters and try again.";

/**
 * The views this person can open: their own, and those other staff shared on the event. Each is checked against
 * the CURRENT viewer and catalog (the page already holds it), so one whose filter was removed, or that this person
 * may not use, is flagged `stale`; it can still be opened (the list then says why) and deleted.
 */
export async function listSavedViews(viewer: SavedViewViewer, catalog: SearchCatalog): Promise<SavedViewItem[]> {
  requireRead(viewer);
  const rows = await getPrisma().registrationSavedView.findMany({
    where: { eventId: viewer.eventId, OR: [{ ownerUserId: viewer.userId }, { shared: true }] },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, query: true, shared: true, ownerUserId: true, owner: { select: { displayName: true } } },
  });
  const search = searchViewer(viewer);
  return rows.map((row) => {
    const isOwn = row.ownerUserId === viewer.userId;
    return {
      id: row.id,
      name: row.name,
      query: normalizeSavedViewQuery(row.query).stored,
      shared: row.shared,
      isOwn,
      ownerName: isOwn ? null : row.owner.displayName,
      stale: !checkSavedViewQuery(row.query, search, catalog).ok,
    };
  });
}

/** Saves the current filters as the person's own view; refused when the saver could not run the query themselves. */
export async function createSavedView(viewer: SavedViewViewer, input: { name: string; query: string; shared?: boolean }) {
  requireRead(viewer);
  if (input.shared) requireShare(viewer);
  const name = normalizeSavedViewName(input.name);
  if (!name.ok) throw new SavedViewError("INVALID", name.message);
  const normalized = normalizeSavedViewQuery(input.query);
  if (!hasSavableContent(normalized.query)) throw new SavedViewError("INVALID", "Choose at least one filter before saving a view.");
  const catalog = await loadOperationsSearchCatalog(searchViewer(viewer));
  const checked = checkSavedViewQuery(input.query, searchViewer(viewer), catalog);
  if (!checked.ok) throw new SavedViewError("INVALID", GENERIC_REFUSAL);

  const prisma = getPrisma();
  const existing = await prisma.registrationSavedView.findFirst({
    where: { eventId: viewer.eventId, ownerUserId: viewer.userId, name: { equals: name.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw nameTaken();
  const shared = Boolean(input.shared);
  let row;
  try {
    row = await prisma.registrationSavedView.create({
      data: {
        eventId: viewer.eventId,
        ownerUserId: viewer.userId,
        name: name.name,
        query: checked.stored,
        shared,
        ...(shared ? { sharedAt: new Date(), sharedByUserId: viewer.userId } : {}),
      },
      select: { id: true, name: true, query: true, shared: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  const filterKeys = savedViewFilterKeys(row.query);
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "REGISTRATION_SAVED_VIEW_SAVED",
    entityType: "RegistrationSavedView",
    entityId: row.id,
    summary: "Saved a Registrations list view.",
    metadata: { savedViewId: row.id, shared, filterKeys },
  });
  if (shared) {
    await writeAuditLog({
      eventId: viewer.eventId,
      actorUserId: viewer.userId,
      action: "REGISTRATION_SAVED_VIEW_SHARED",
      entityType: "RegistrationSavedView",
      entityId: row.id,
      summary: "Shared a Registrations list view with event staff.",
      metadata: { savedViewId: row.id, shared: true, filterKeys },
    });
  }
  return { id: row.id, name: row.name, query: row.query, shared: row.shared };
}

/** Shares a view with the event's staff, or stops sharing it. Only its owner can, and only with the right to publish. */
export async function setSavedViewShared(viewer: SavedViewViewer, viewId: string, shared: boolean) {
  requireShare(viewer);
  const prisma = getPrisma();
  const row = await prisma.registrationSavedView.findFirst({
    where: { id: viewId, eventId: viewer.eventId, OR: [{ ownerUserId: viewer.userId }, { shared: true }] },
    select: { id: true, query: true, shared: true, ownerUserId: true },
  });
  if (!row) throw notFound();
  if (row.ownerUserId !== viewer.userId) throw denied("Only the person who saved a view can change whether it is shared.");
  if (shared) {
    // Re-checked at the moment of sharing, so a view that has gone stale is not published to others.
    const catalog = await loadOperationsSearchCatalog(searchViewer(viewer));
    if (!checkSavedViewQuery(row.query, searchViewer(viewer), catalog).ok) throw new SavedViewError("INVALID", GENERIC_REFUSAL);
  }
  if (row.shared !== shared) {
    const updated = await prisma.registrationSavedView.updateMany({
      where: { id: row.id, eventId: viewer.eventId, ownerUserId: viewer.userId },
      data: shared ? { shared: true, sharedAt: new Date(), sharedByUserId: viewer.userId } : { shared: false, sharedAt: null, sharedByUserId: null },
    });
    if (updated.count === 0) throw notFound();
    await writeAuditLog({
      eventId: viewer.eventId,
      actorUserId: viewer.userId,
      action: shared ? "REGISTRATION_SAVED_VIEW_SHARED" : "REGISTRATION_SAVED_VIEW_UNSHARED",
      entityType: "RegistrationSavedView",
      entityId: row.id,
      summary: shared ? "Shared a Registrations list view with event staff." : "Stopped sharing a Registrations list view.",
      metadata: { savedViewId: row.id, shared, filterKeys: savedViewFilterKeys(row.query) },
    });
  }
  return { id: row.id, shared };
}

/**
 * Deletes a view. The owner can delete their own; someone who manages registrations can also remove another
 * person's SHARED view. Another person's unshared view is not found.
 */
export async function deleteSavedView(viewer: SavedViewViewer, viewId: string) {
  requireRead(viewer);
  const prisma = getPrisma();
  const mayRemoveShared = viewer.permissions.includes("MANAGE_REGISTRATION");
  const row = await prisma.registrationSavedView.findFirst({
    where: { id: viewId, eventId: viewer.eventId, OR: [{ ownerUserId: viewer.userId }, { shared: true }] },
    select: { id: true, query: true, shared: true, ownerUserId: true },
  });
  if (!row) throw notFound();
  const isOwner = row.ownerUserId === viewer.userId;
  if (!isOwner && !mayRemoveShared) throw denied("Only the person who saved a view, or someone who manages registrations, can delete a shared view.");
  const removed = await prisma.registrationSavedView.deleteMany({
    where: {
      id: row.id,
      eventId: viewer.eventId,
      // Re-stated in the delete itself, so a view unshared in the meantime is not removed by someone else.
      ...(isOwner ? { ownerUserId: viewer.userId } : { shared: true }),
    },
  });
  if (removed.count === 0) throw notFound();
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "REGISTRATION_SAVED_VIEW_DELETED",
    entityType: "RegistrationSavedView",
    entityId: row.id,
    summary: "Deleted a Registrations list view.",
    metadata: { savedViewId: row.id, shared: row.shared, removedByOwner: isOwner, filterKeys: savedViewFilterKeys(row.query) },
  });
}
