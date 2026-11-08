import "server-only";

import { getPrisma } from "@/lib/prisma";
import { requirePermission, type MembershipLookup, type Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { currentAreaCoordinator, isAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { ClubTeacherError, auditActor, getTeacherRule, ruleFromRow, type TeacherActor } from "@/modules/club-teachers/repository";
import type { TeacherRule, TeacherSettingsInput } from "@/modules/club-teachers/domain";
import { eventModuleDefinition, scopedToggleModuleKeys } from "@/modules/event-modules/catalog";

/**
 * Who may switch the optional Club teachers tool on or off and set its rule (#1681). This is a separate, narrow path
 * beside the system-administrator-only module service (`modules/event-modules/service.ts`), which is left exactly as
 * it was. It acts on ONE module key (`scopedToggleModuleKeys`) and on club events only:
 *   - staff: an Event Admin of the event, an active Clubs Administrator (who holds that role on every club event) or a
 *     system administrator, through the same MANAGE_REGISTRATION check the club tools use;
 *   - an active Area Coordinator, on any club event they can see in Club events, after the second sign-in step.
 * An Area Coordinator gains no other write: not module requests, not events, not club records.
 */

const moduleKey = "club-teachers" as const;

export type TeacherSettingsActor =
  | { kind: "staff"; userId: string }
  | { kind: "area-coordinator"; accountId: string };

export function teacherToolActor(actor: TeacherSettingsActor): TeacherActor {
  return actor.kind === "staff" ? { userId: actor.userId } : { accountId: actor.accountId };
}

/** Staff access, decided by the shared event permission check. Returns the actor for the change. */
export async function requireStaffTeacherToolAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<TeacherSettingsActor> {
  const access = await requirePermission(session, eventId, "MANAGE_REGISTRATION", lookup);
  return { kind: "staff", userId: access.user.id };
}

/** The signed-in Area Coordinator (grant active, second step passed), or a 404-shaped refusal that tells a non-coordinator nothing. */
export async function requireAreaCoordinatorTeacherActor(): Promise<TeacherSettingsActor> {
  const account = await currentAreaCoordinator();
  if (!account) throw new ClubTeacherError("NOT_AVAILABLE", "That could not be found.");
  return { kind: "area-coordinator", accountId: account.id };
}

export type TeacherToolState = { enabled: boolean; rule: TeacherRule | null; eventName: string };

/** The state shown to whoever may change it. The event must be a club event a coordinator would see in Club events. */
export async function loadTeacherToolState(eventId: string): Promise<TeacherToolState> {
  const prisma = getPrisma();
  const event = await prisma.event.findFirst({ where: { id: eventId, isPublished: true, archivedAt: null, audience: "CLUB" }, select: { id: true, name: true } });
  if (!event) throw new ClubTeacherError("EVENT_NOT_FOUND", "That club event could not be found.");
  const [row, rule] = await Promise.all([
    prisma.eventModule.findUnique({ where: { eventId_moduleKey: { eventId, moduleKey } }, select: { id: true } }),
    getTeacherRule(eventId),
  ]);
  return { enabled: row !== null, rule, eventName: event.name };
}

/**
 * Switches the tool on or off and/or saves its rule, in one transaction with an audit entry for each change. Off hides
 * the tool and keeps the rule and every teacher a club named. On with no rule saved changes nothing for clubs.
 */
export async function applyTeacherSettings(actor: TeacherSettingsActor, eventId: string, input: TeacherSettingsInput): Promise<TeacherToolState> {
  if (!scopedToggleModuleKeys.includes(moduleKey)) throw new ClubTeacherError("NOT_AVAILABLE", "That module cannot be changed here.");
  // Re-read the grant: the route checked it, and this keeps the service safe when called from anywhere else.
  if (actor.kind === "area-coordinator" && !(await isAreaCoordinator(actor.accountId))) {
    throw new ClubTeacherError("NOT_AVAILABLE", "That could not be found.");
  }
  const prisma = getPrisma();
  const event = await prisma.event.findFirst({ where: { id: eventId, isPublished: true, archivedAt: null, audience: "CLUB" }, select: { id: true } });
  if (!event) throw new ClubTeacherError("EVENT_NOT_FOUND", "That club event could not be found.");
  const who = auditActor(teacherToolActor(actor));
  const title = eventModuleDefinition(moduleKey).title;
  const audit = (action: string, summary: string, extra: Record<string, string | number | boolean | null>) => ({
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType: action.startsWith("EVENT_MODULE") ? "EventModule" : "ClubTeacherRule",
    entityId: action.startsWith("EVENT_MODULE") ? moduleKey : eventId,
    summary,
    metadata: { ...who.metadata, eventId, moduleKey, ...(actor.kind === "area-coordinator" ? { viaAreaCoordinator: true } : {}), ...extra },
  });
  await prisma.$transaction(async (tx) => {
    if (input.rule) {
      const saved = await tx.clubTeacherRule.upsert({
        where: { eventId },
        create: { eventId, ...input.rule, ...(actor.kind === "staff" ? { updatedByUserId: actor.userId } : { updatedByAccountId: actor.accountId }) },
        update: { ...input.rule, updatedByUserId: actor.kind === "staff" ? actor.userId : null, updatedByAccountId: actor.kind === "area-coordinator" ? actor.accountId : null },
      });
      const rule = ruleFromRow(saved);
      await writeAuditLog(audit("CLUB_TEACHER_RULE_SET", `Set the ${title} rule.`, { ...rule }), tx);
    }
    if (input.enabled === true) {
      const created = await tx.eventModule.createMany({ data: [{ eventId, moduleKey }], skipDuplicates: true });
      if (created.count > 0) await writeAuditLog(audit("EVENT_MODULE_ENABLED", `Turned on the ${title} module.`, {}), tx);
    } else if (input.enabled === false) {
      const removed = await tx.eventModule.deleteMany({ where: { eventId, moduleKey } });
      if (removed.count > 0) await writeAuditLog(audit("EVENT_MODULE_DISABLED", `Turned off the ${title} module.`, {}), tx);
    }
  });
  return loadTeacherToolState(eventId);
}
