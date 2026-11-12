import "server-only";

import type { MembershipLookup, Session } from "@/modules/access/authorization";
import { getPrisma } from "@/lib/prisma";
import { StaffingError, loadStaffingEvent } from "@/modules/event-staffing/access";
import { STAFFING_MODULE_KEY, type StaffingSettingsInput } from "@/modules/event-staffing/domain";
import {
  ScopedToggleError,
  assertScopedToggleAllowed,
  requireAreaCoordinatorToggleActor,
  requireStaffToggleAccess,
  scopedModuleIsOn,
  writeScopedModuleSwitch,
  type ScopedToggleActor,
} from "@/modules/event-modules/scoped-toggle";

/**
 * Who may switch the optional Event staffing sheet on or off (#1678). The switching is the shared scoped helper
 * (`modules/event-modules/scoped-toggle.ts`), the same people and the same audit as the Budget sheet and the Event debrief:
 *   - staff: a system administrator, an Event Admin of the event, or the Clubs Administrator. A Registration Manager cannot;
 *   - an active Area Coordinator, on a published club event they can see, after the second sign-in step.
 * Switching it off hides the sheet and keeps every activity and assignment. Switching it on changes nothing for clubs. Who may
 * then read or change the sheet is `access.ts`, which is separate from who may switch it.
 */

async function asStaffingError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new StaffingError(error.code, error.message);
    throw error;
  }
}

export type StaffingToggleActor = ScopedToggleActor;

export function requireStaffStaffingToggleAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<StaffingToggleActor> {
  return requireStaffToggleAccess(session, eventId, lookup);
}

export function requireAreaCoordinatorStaffingToggleActor(): Promise<StaffingToggleActor> {
  return asStaffingError(() => requireAreaCoordinatorToggleActor());
}

export type StaffingToolState = { enabled: boolean; eventName: string };

export async function loadStaffingToolState(eventId: string, scope: StaffingToggleActor["kind"]): Promise<StaffingToolState> {
  const event = await loadStaffingEvent(eventId, scope);
  return { enabled: await scopedModuleIsOn(eventId, STAFFING_MODULE_KEY), eventName: event.name };
}

/** Switches Event staffing in one transaction, with an audit entry for a real change. Repeating a switch changes nothing and audits nothing. */
export async function applyStaffingSettings(actor: StaffingToggleActor, eventId: string, input: StaffingSettingsInput): Promise<StaffingToolState> {
  await asStaffingError(() => assertScopedToggleAllowed(STAFFING_MODULE_KEY, actor));
  await loadStaffingEvent(eventId, actor.kind);
  await getPrisma().$transaction(async (tx) => {
    await writeScopedModuleSwitch(tx, { actor, eventId, moduleKey: STAFFING_MODULE_KEY, enabled: input.enabled });
  });
  return loadStaffingToolState(eventId, actor.kind);
}
