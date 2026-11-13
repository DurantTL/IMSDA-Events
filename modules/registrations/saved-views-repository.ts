import { getPrisma } from "@/lib/prisma";
import { AccessDeniedError } from "@/modules/access/authorization";
import type { EventPermission } from "@/modules/access/permissions";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isClubEvent } from "@/modules/access/club-event-access";
import { loadOperationsSearchCatalog } from "@/modules/registrations/operations-search-repository";
import type { SearchCatalog } from "@/modules/registrations/operations-search-domain";
import {
  checkSavedViewQuery,
  hasSavableContent,
  normalizeSavedViewName,
  normalizeSavedViewQuery,
  SAVED_VIEWS_PER_PERSON_MAX,
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
  constructor(public readonly code: "INVALID" | "NOT_FOUND" | "NAME_TAKEN" | "LIMIT_REACHED", message: string) {
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
 * A shared view whose owner has left the event's staff is archived: out of the shared list, kept in the database,
 * and restorable by someone who can share. "Left" matches the event access check: no active membership (a Clubs
 * Administrator on a club event still has one) and not a system administrator, who can always open the event.
 */
async function ownersWhoLeft(eventId: string, owners: readonly { id: string; globalRole: string | null }[]) {
  // The same meaning as `requireEventMembership` and `findEffectiveMembership`, read for all owners at once: a system
  // administrator is never gone; an ACTIVE membership keeps someone on staff; without one, an active Clubs
  // Administrator grant still counts on a club event.
  let candidates = owners.filter((owner) => owner.globalRole !== "SYSTEM_ADMIN").map((owner) => owner.id);
  if (candidates.length === 0) return new Set<string>();
  const prisma = getPrisma();
  const active = await prisma.eventMembership.findMany({ where: { eventId, userId: { in: candidates }, status: "ACTIVE" }, select: { userId: true } });
  const stillStaff = new Set(active.map((row) => row.userId));
  candidates = candidates.filter((id) => !stillStaff.has(id));
  if (candidates.length > 0 && (await isClubEvent(eventId, prisma))) {
    const grants = await prisma.clubsAdministratorGrant.findMany({ where: { userId: { in: candidates }, revokedAt: null }, select: { userId: true } });
    for (const grant of grants) stillStaff.add(grant.userId);
  }
  return new Set(candidates.filter((id) => !stillStaff.has(id)));
}

/**
 * The views this person can open: their own, and those other current staff shared on the event. Each is checked
 * against the CURRENT viewer and catalog (the page already holds it), so one whose filter was removed or
 * deactivated, or that this person may not use, is flagged `stale`; it can still be opened (the list then says
 * why) and deleted. Someone who can share also gets the archived views (shared by staff who have since left);
 * nobody else receives them.
 */
export async function listSavedViews(viewer: SavedViewViewer, catalog: SearchCatalog): Promise<{ views: SavedViewItem[]; archived: SavedViewItem[] }> {
  requireRead(viewer);
  const select = { id: true, name: true, query: true, shared: true, ownerUserId: true, owner: { select: { displayName: true, globalRole: true } } } as const;
  const orderBy = [{ name: "asc" as const }, { createdAt: "asc" as const }];
  // Two bounded reads, so many shared views never push the person's own views off the list.
  const [own, sharedByOthers] = await Promise.all([
    getPrisma().registrationSavedView.findMany({ where: { eventId: viewer.eventId, ownerUserId: viewer.userId }, orderBy, take: SAVED_VIEWS_PER_PERSON_MAX, select }),
    getPrisma().registrationSavedView.findMany({ where: { eventId: viewer.eventId, shared: true, ownerUserId: { not: viewer.userId } }, orderBy, take: 200, select }),
  ]);
  const owners = [...new Map(sharedByOthers.map((row) => [row.ownerUserId, { id: row.ownerUserId, globalRole: row.owner.globalRole as string | null }])).values()];
  const left = await ownersWhoLeft(viewer.eventId, owners);
  const search = searchViewer(viewer);
  const item = (row: (typeof own)[number]): SavedViewItem => {
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
  };
  return {
    views: [...own, ...sharedByOthers.filter((row) => !left.has(row.ownerUserId))].map(item),
    archived: canShareSavedViews(viewer.permissions) ? sharedByOthers.filter((row) => left.has(row.ownerUserId)).map(item) : [],
  };
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
  const kept = await prisma.registrationSavedView.count({ where: { eventId: viewer.eventId, ownerUserId: viewer.userId } });
  if (kept >= SAVED_VIEWS_PER_PERSON_MAX) throw new SavedViewError("LIMIT_REACHED", `You can keep up to ${SAVED_VIEWS_PER_PERSON_MAX} saved views for this event. Delete one you no longer use first.`);
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

/** Shares a view with the event's staff, or stops sharing it. Only its owner can; turning sharing on needs the right to publish. */
export async function setSavedViewShared(viewer: SavedViewViewer, viewId: string, shared: boolean) {
  // Publishing needs the right to; taking your own view back down only needs to be able to see the list.
  if (shared) requireShare(viewer);
  else requireRead(viewer);
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

/**
 * Restores an archived view (shared by someone who has left the event's staff): the restorer becomes its owner and it
 * stays shared. Only someone who can share, only for an archived view of this event; anything else is not found.
 */
export async function restoreSavedView(viewer: SavedViewViewer, viewId: string) {
  requireShare(viewer);
  const prisma = getPrisma();
  const row = await prisma.registrationSavedView.findFirst({
    where: { id: viewId, eventId: viewer.eventId, shared: true, ownerUserId: { not: viewer.userId } },
    select: { id: true, name: true, query: true, ownerUserId: true, owner: { select: { globalRole: true } } },
  });
  if (!row) throw notFound();
  const previousOwnerUserId = row.ownerUserId;
  const left = await ownersWhoLeft(viewer.eventId, [{ id: row.ownerUserId, globalRole: row.owner.globalRole as string | null }]);
  if (!left.has(row.ownerUserId)) throw notFound();
  const catalog = await loadOperationsSearchCatalog(searchViewer(viewer));
  if (!checkSavedViewQuery(row.query, searchViewer(viewer), catalog).ok) throw new SavedViewError("INVALID", GENERIC_REFUSAL);
  const clash = await prisma.registrationSavedView.findFirst({
    where: { eventId: viewer.eventId, ownerUserId: viewer.userId, name: { equals: row.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) throw nameTaken();
  const kept = await prisma.registrationSavedView.count({ where: { eventId: viewer.eventId, ownerUserId: viewer.userId } });
  if (kept >= SAVED_VIEWS_PER_PERSON_MAX) throw new SavedViewError("LIMIT_REACHED", `You can keep up to ${SAVED_VIEWS_PER_PERSON_MAX} saved views for this event. Delete one you no longer use first.`);
  let updated;
  try {
    updated = await prisma.registrationSavedView.updateMany({
      // Re-stated in the update, so a view that was unshared or restored in the meantime is not taken over.
      where: { id: row.id, eventId: viewer.eventId, shared: true, ownerUserId: previousOwnerUserId },
      data: { ownerUserId: viewer.userId, shared: true, sharedAt: new Date(), sharedByUserId: viewer.userId },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  if (updated.count === 0) throw notFound();
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "REGISTRATION_SAVED_VIEW_RESTORED",
    entityType: "RegistrationSavedView",
    entityId: row.id,
    summary: "Restored an archived Registrations list view.",
    metadata: { savedViewId: row.id, previousOwnerUserId, filterKeys: savedViewFilterKeys(row.query) },
  });
  return { id: row.id, shared: true };
}
