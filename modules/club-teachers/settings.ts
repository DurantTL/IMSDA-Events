import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { type MembershipLookup, type Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ClubTeacherError, getTeacherRule, ruleFromRow, type TeacherActor } from "@/modules/club-teachers/repository";
import type { TeacherRule, TeacherSettingsInput } from "@/modules/club-teachers/domain";
import { dispatchUnsuppressedAlert } from "@/modules/operations/alerting";
import { eventModuleDefinition } from "@/modules/event-modules/catalog";
import {
  ScopedToggleError,
  assertScopedToggleAllowed,
  loadScopedToolEvent,
  requireAreaCoordinatorToggleActor,
  requireStaffToggleAccess,
  scopedActorAudit,
  scopedModuleIsOn,
  writeScopedModuleSwitch,
  type ScopedToggleActor,
} from "@/modules/event-modules/scoped-toggle";

/**
 * Who may switch the optional Club teachers tool on or off and set its rule (#1681). The switching itself (who may flip
 * the module, the audited on/off row) is the shared helper `modules/event-modules/scoped-toggle.ts`, which Camporee
 * scoring uses too; this file keeps only the teacher rule. It is a separate, narrow path beside the
 * system-administrator-only module service (`modules/event-modules/service.ts`), which is left exactly as it was:
 *   - staff: a system administrator, an Event Admin of the event, or an active Clubs Administrator, the same people
 *     `resolveClubOversight` admits. A Registration Manager cannot;
 *   - an active Area Coordinator, on any published club event they can see in Club events, after the second sign-in
 *     step. They may not choose to block registrations ("require"): that stays with staff.
 * An Area Coordinator gains no other write: not module requests, not events, not club records.
 */

const moduleKey = "club-teachers" as const;

export type TeacherSettingsActor = ScopedToggleActor;

/** The shared helper's refusals keep the teacher tool's own error type, so its routes answer exactly as before. */
async function asTeacherError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new ClubTeacherError(error.code, error.message);
    throw error;
  }
}

export function teacherToolActor(actor: TeacherSettingsActor): TeacherActor {
  return actor.kind === "staff" ? { userId: actor.userId } : { accountId: actor.accountId };
}

/** Staff access: a system administrator or an Event Admin (the Clubs Administrator is one on club events). Returns the actor. */
export function requireStaffTeacherToolAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<TeacherSettingsActor> {
  return requireStaffToggleAccess(session, eventId, lookup);
}

/** The signed-in Area Coordinator (grant active, second step passed), or a 404-shaped refusal that tells a non-coordinator nothing. */
export function requireAreaCoordinatorTeacherActor(): Promise<TeacherSettingsActor> {
  return asTeacherError(() => requireAreaCoordinatorToggleActor());
}

export type TeacherToolState = { enabled: boolean; rule: TeacherRule | null; eventName: string };

const toolEvent = (eventId: string, scope: TeacherSettingsActor["kind"]) =>
  asTeacherError(() => loadScopedToolEvent(eventId, scope, "That club event could not be found. It may be archived or not a club event."));

/** The state shown to whoever may change it. */
export async function loadTeacherToolState(eventId: string, scope: TeacherSettingsActor["kind"]): Promise<TeacherToolState> {
  const event = await toolEvent(eventId, scope);
  const [enabled, rule] = await Promise.all([scopedModuleIsOn(eventId, moduleKey), getTeacherRule(eventId)]);
  return { enabled, rule, eventName: event.name };
}

/**
 * Switches the tool on or off and/or saves its rule, in one transaction with an audit entry for each change. Off hides
 * the tool and keeps the rule and every teacher a club named. On with no rule saved changes nothing for clubs.
 */
export async function applyTeacherSettings(actor: TeacherSettingsActor, eventId: string, input: TeacherSettingsInput): Promise<TeacherToolState> {
  await asTeacherError(() => assertScopedToggleAllowed(moduleKey, actor));
  const prisma = getPrisma();
  await toolEvent(eventId, actor.kind);
  // Blocking registrations is staff's choice (#1681): a coordinator can neither turn it on nor change it.
  if (actor.kind === "area-coordinator" && input.rule?.requireTeachers === true) {
    throw new ClubTeacherError("NOT_PERMITTED", "Only the Clubs Administrator or event staff can require teachers before a club registers.");
  }
  const who = scopedActorAudit(actor);
  const title = eventModuleDefinition(moduleKey).title;
  const wasOn = await scopedModuleIsOn(eventId, moduleKey);
  await prisma.$transaction(async (tx) => {
    if (input.rule) {
      // A coordinator saves the numbers only; "require" keeps whatever staff set.
      const { requireTeachers, ...numbers } = input.rule;
      const data = actor.kind === "staff" ? { ...numbers, requireTeachers } : numbers;
      const saved = await tx.clubTeacherRule.upsert({
        where: { eventId },
        create: { eventId, ...data, ...(actor.kind === "staff" ? { updatedByUserId: actor.userId } : { updatedByAccountId: actor.accountId }) },
        update: { ...data, updatedByUserId: actor.kind === "staff" ? actor.userId : null, updatedByAccountId: actor.kind === "area-coordinator" ? actor.accountId : null },
      });
      const rule = ruleFromRow(saved);
      await writeAuditLog({
        eventId,
        ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
        action: "CLUB_TEACHER_RULE_SET",
        entityType: "ClubTeacherRule",
        entityId: eventId,
        summary: `Set the ${title} rule.`,
        metadata: { ...who.metadata, eventId, moduleKey, ...rule },
      }, tx);
    }
    await writeScopedModuleSwitch(tx, { actor, eventId, moduleKey, enabled: input.enabled });
  });
  // A coordinator turning the tool back on while staff's "require" is still stored on is a conflict staff should hear about (#1727).
  if (actor.kind === "area-coordinator" && input.enabled === true && !wasOn) {
    await notifyRequireBackOn(actor.accountId, eventId);
  }
  return loadTeacherToolState(eventId, actor.kind);
}

/**
 * Tells staff that "require teachers" is back on for an event because an Area Coordinator turned the tool on (#1727),
 * through the alert webhook the problem reports use (#1483). The stored value is never changed: staff keep it or turn it
 * off. Audited whether or not the webhook answered; a webhook that is down never fails the switch.
 */
async function notifyRequireBackOn(accountId: string, eventId: string): Promise<void> {
  const rule = await getTeacherRule(eventId);
  if (!rule?.requireTeachers) return;
  const prisma = getPrisma();
  const [event, account] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { name: true } }),
    prisma.attendeeAccount.findUnique({ where: { id: accountId }, select: { displayName: true } }),
  ]);
  const title = eventModuleDefinition(moduleKey).title;
  const eventName = event?.name ?? "a club event";
  const who = account?.displayName?.trim() || "An Area Coordinator";
  let delivered = false;
  try {
    const result = await dispatchUnsuppressedAlert({
      key: `club-teachers.require-back-on.${eventId}`,
      severity: "WATCH",
      summary: `Require teachers is back on for ${eventName}. ${who} (Area Coordinator) turned the ${title} tool on, and staff had set it to block registrations below the teacher number. Open Club teachers to keep it or turn it off.`,
    });
    delivered = result.delivered;
  } catch (error) {
    logError("The require-teachers notice could not be sent to staff", error, { eventId });
  }
  try {
    await writeAuditLog({
      eventId,
      action: "CLUB_TEACHER_REQUIRE_NOTICE_SENT",
      entityType: "ClubTeacherRule",
      entityId: eventId,
      summary: delivered
        ? `Told staff that require teachers is back on: an Area Coordinator turned the ${title} tool on.`
        : `Tried to tell staff that require teachers is back on: an Area Coordinator turned the ${title} tool on. The alert was not delivered.`,
      metadata: { actorAttendeeAccountId: accountId, viaAreaCoordinator: true, eventId, moduleKey, requireTeachers: true, delivered },
    });
  } catch (error) {
    logError("The require-teachers notice could not be audited", error, { eventId });
  }
}
