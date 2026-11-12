import "server-only";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import type { MembershipLookup, Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
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
import { DEBRIEF_MODULE_KEY } from "@/modules/event-debriefs/domain";
import { ensureDebriefForm, onDebriefDisabled, onDebriefEnabled } from "@/modules/event-debriefs/lifecycle";

/**
 * Who may switch the optional Debrief on or off (#1679). The switching is the shared scoped helper
 * (`modules/event-modules/scoped-toggle.ts`), the same people and the same audit as Club teachers:
 *   - staff: a system administrator, an Event Admin of the event, or the Clubs Administrator. A Registration Manager cannot;
 *   - an active Area Coordinator, on a published club event they can see, after the second sign-in step.
 * Switching on makes the questions and schedules the invitation and reminder; switching off stops what is unsent and keeps
 * the questions and answers. The director evaluation has its own switch, which only staff may flip. An Area Coordinator
 * gains no other write, and reads no answers.
 */

export const debriefSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  evaluationEnabled: z.boolean().optional(),
}).strict().refine((input) => input.enabled !== undefined || input.evaluationEnabled !== undefined, "Send a switch.");
export type DebriefSettingsInput = z.infer<typeof debriefSettingsSchema>;

export class DebriefError extends Error {
  constructor(public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND" | "NOT_PERMITTED" | "TURN_ON_FIRST", message: string) {
    super(message);
    this.name = "DebriefError";
  }
}

async function asDebriefError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new DebriefError(error.code, error.message);
    throw error;
  }
}

export type DebriefActor = ScopedToggleActor;

export function requireStaffDebriefAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<DebriefActor> {
  return requireStaffToggleAccess(session, eventId, lookup);
}

export function requireAreaCoordinatorDebriefActor(): Promise<DebriefActor> {
  return asDebriefError(() => requireAreaCoordinatorToggleActor());
}

export type DebriefToolState = {
  enabled: boolean;
  evaluationEnabled: boolean;
  eventName: string;
  /** The public address of the debrief form, for the person's own answer. Null while the Debrief is off or has no form yet. */
  fillPath: string | null;
};

const toolEvent = (eventId: string, scope: DebriefActor["kind"]) =>
  asDebriefError(() => loadScopedToolEvent(eventId, scope, "That club event could not be found. It may be archived or not a club event."));

export async function loadDebriefToolState(eventId: string, scope: DebriefActor["kind"]): Promise<DebriefToolState> {
  const event = await toolEvent(eventId, scope);
  const prisma = getPrisma();
  const [enabled, settings, form, full] = await Promise.all([
    scopedModuleIsOn(eventId, DEBRIEF_MODULE_KEY),
    prisma.eventDebrief.findUnique({ where: { eventId }, select: { evaluationEnabled: true } }),
    prisma.informationForm.findFirst({ where: { eventId, purpose: "DEBRIEF" }, select: { slug: true } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { slug: true } }),
  ]);
  return {
    enabled,
    evaluationEnabled: settings?.evaluationEnabled ?? false,
    eventName: event.name,
    fillPath: enabled && form && full ? `/events/${encodeURIComponent(full.slug)}/forms/${encodeURIComponent(form.slug)}` : null,
  };
}

/**
 * Switches the Debrief and/or the director evaluation, in one transaction with an audit entry for each real change.
 * Repeating a switch changes nothing and audits nothing.
 */
export async function applyDebriefSettings(actor: DebriefActor, eventId: string, input: DebriefSettingsInput, now = new Date()): Promise<DebriefToolState> {
  await asDebriefError(() => assertScopedToggleAllowed(DEBRIEF_MODULE_KEY, actor));
  await toolEvent(eventId, actor.kind);
  // The evaluation goes to club directors: staff's choice, not a coordinator's.
  if (input.evaluationEnabled !== undefined && actor.kind !== "staff") {
    throw new DebriefError("NOT_PERMITTED", "Only the Clubs Administrator or event staff can turn the director evaluation on or off.");
  }
  const prisma = getPrisma();
  const wasOn = await scopedModuleIsOn(eventId, DEBRIEF_MODULE_KEY);
  const who = scopedActorAudit(actor);
  const title = eventModuleDefinition(DEBRIEF_MODULE_KEY).title;
  await prisma.$transaction(async (tx) => {
    await writeScopedModuleSwitch(tx, { actor, eventId, moduleKey: DEBRIEF_MODULE_KEY, enabled: input.enabled });
    if (input.enabled === true && !wasOn) await onDebriefEnabled(tx, { eventId, actor, now });
    if (input.enabled === false && wasOn) await onDebriefDisabled(tx, { eventId, actor, now });
    if (input.evaluationEnabled !== undefined) {
      const on = input.enabled === undefined ? wasOn : input.enabled;
      if (!on) throw new DebriefError("TURN_ON_FIRST", `Turn the ${title} on before choosing the director evaluation.`);
      const current = await tx.eventDebrief.upsert({ where: { eventId }, create: { eventId }, update: {}, select: { evaluationEnabled: true } });
      if (current.evaluationEnabled !== input.evaluationEnabled) {
        await tx.eventDebrief.update({ where: { eventId }, data: { evaluationEnabled: input.evaluationEnabled } });
        if (input.evaluationEnabled) await ensureDebriefForm(tx, { eventId, purpose: "DIRECTOR_EVALUATION", actor });
        await writeAuditLog({
          eventId,
          ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
          action: input.evaluationEnabled ? "EVENT_DEBRIEF_EVALUATION_ENABLED" : "EVENT_DEBRIEF_EVALUATION_DISABLED",
          entityType: "EventDebrief",
          entityId: eventId,
          summary: input.evaluationEnabled ? "Turned on the club director evaluation." : "Turned off the club director evaluation. The questions and answers are kept.",
          metadata: { ...who.metadata, eventId, moduleKey: DEBRIEF_MODULE_KEY },
        }, tx);
      }
    }
  });
  return loadDebriefToolState(eventId, actor.kind);
}
