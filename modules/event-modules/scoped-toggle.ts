import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { requireEventMembership, AccessDeniedError, type MembershipLookup, type Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { eventModuleDefinition, scopedToggleModuleKeys, type EventModuleKey } from "@/modules/event-modules/catalog";
import { currentAreaCoordinator, isAreaCoordinator } from "@/modules/organizations/area-coordinators";

/**
 * The switching part of an optional club-event tool that an Area Coordinator may turn on or off (#1681, #1676). Each tool
 * (Club teachers, Camporee scoring, ...) keeps its own rules and data; this is the one shared piece that decides WHO may
 * flip its module and writes the audited on/off row. It sits beside the system-administrator-only module service
 * (`service.ts`), which is left exactly as it was, and acts only on keys listed in `scopedToggleModuleKeys`, on club events:
 *   - staff: a system administrator, an Event Admin of the event, or an active Clubs Administrator (who holds the Event
 *     Admin role on every club event). A Registration Manager cannot. Staff may also set a tool up on an unpublished event;
 *   - an active Area Coordinator, on a published club event they can see in Club events, after the second sign-in step.
 * An Area Coordinator gains no other write from this file: not module requests, not events, not club records.
 */

export type ScopedToggleActor =
  | { kind: "staff"; userId: string }
  | { kind: "area-coordinator"; accountId: string };

export class ScopedToggleError extends Error {
  constructor(public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND", message: string) {
    super(message);
    this.name = "ScopedToggleError";
  }
}

/** Staff access: a system administrator or an Event Admin on this event (the Clubs Administrator role alone does not qualify). Returns the actor. */
export async function requireStaffToggleAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<ScopedToggleActor & { kind: "staff" }> {
  const access = await requireEventMembership(session, eventId, lookup);
  if (access.user.globalRole !== "SYSTEM_ADMIN" && access.membership?.role !== "EVENT_ADMIN") {
    throw new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");
  }
  return { kind: "staff", userId: access.user.id };
}

/** The signed-in Area Coordinator (grant active, second step passed), or a 404-shaped refusal that tells a non-coordinator nothing. */
export async function requireAreaCoordinatorToggleActor(): Promise<ScopedToggleActor & { kind: "area-coordinator" }> {
  const account = await currentAreaCoordinator();
  if (!account) throw new ScopedToggleError("NOT_AVAILABLE", "That could not be found.");
  return { kind: "area-coordinator", accountId: account.id };
}

/**
 * The club event a tool acts on. Who is asking decides which events exist for them: staff also see unpublished ones, a
 * coordinator only published ones. Archived and general events are never found.
 */
export async function loadScopedToolEvent(eventId: string, scope: ScopedToggleActor["kind"], notFoundMessage: string) {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, archivedAt: null, audience: "CLUB", ...(scope === "area-coordinator" ? { isPublished: true } : {}) },
    select: { id: true, name: true },
  });
  if (!event) throw new ScopedToggleError("EVENT_NOT_FOUND", notFoundMessage);
  return event;
}

/**
 * Refuses a module that may not be switched here, and re-reads a coordinator's grant: the route checked it, and this keeps
 * a service safe when called from anywhere else.
 */
export async function assertScopedToggleAllowed(moduleKey: EventModuleKey, actor: ScopedToggleActor): Promise<void> {
  if (!scopedToggleModuleKeys.includes(moduleKey)) throw new ScopedToggleError("NOT_AVAILABLE", "That module cannot be changed here.");
  if (actor.kind === "area-coordinator" && !(await isAreaCoordinator(actor.accountId))) {
    throw new ScopedToggleError("NOT_AVAILABLE", "That could not be found.");
  }
}

/** Who made the change, for an audit row: a staff user or an attendee account (a coordinator), never both. */
export function scopedActorAudit(actor: ScopedToggleActor): { actorUserId?: string; metadata: Prisma.InputJsonObject } {
  return actor.kind === "staff"
    ? { actorUserId: actor.userId, metadata: {} }
    : { metadata: { actorAttendeeAccountId: actor.accountId, viaAreaCoordinator: true } };
}

/** Whether the module has a stored row for the event: on is a row, off is none (the data stays either way). */
export async function scopedModuleIsOn(eventId: string, moduleKey: EventModuleKey): Promise<boolean> {
  const row = await getPrisma().eventModule.findUnique({ where: { eventId_moduleKey: { eventId, moduleKey } }, select: { id: true } });
  return row !== null;
}

/**
 * Switches the module on or off inside the caller's transaction and audits each real change (a repeat changes nothing and
 * audits nothing). `enabled` undefined leaves the switch as it is.
 */
export async function writeScopedModuleSwitch(
  tx: Prisma.TransactionClient,
  input: { actor: ScopedToggleActor; eventId: string; moduleKey: EventModuleKey; enabled: boolean | undefined },
): Promise<void> {
  if (input.enabled === undefined) return;
  const { actor, eventId, moduleKey } = input;
  const who = scopedActorAudit(actor);
  const title = eventModuleDefinition(moduleKey).title;
  const audit = (action: string, summary: string) => ({
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType: "EventModule",
    entityId: moduleKey,
    summary,
    metadata: { ...who.metadata, eventId, moduleKey },
  });
  if (input.enabled) {
    const created = await tx.eventModule.createMany({ data: [{ eventId, moduleKey }], skipDuplicates: true });
    if (created.count > 0) await writeAuditLog(audit("EVENT_MODULE_ENABLED", `Turned on the ${title} module.`), tx);
  } else {
    const removed = await tx.eventModule.deleteMany({ where: { eventId, moduleKey } });
    if (removed.count > 0) await writeAuditLog(audit("EVENT_MODULE_DISABLED", `Turned off the ${title} module.`), tx);
  }
}
