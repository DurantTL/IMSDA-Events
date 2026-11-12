import "server-only";

import type { MembershipLookup, Session } from "@/modules/access/authorization";
import { getPrisma } from "@/lib/prisma";
import { BudgetError, loadBudgetEvent } from "@/modules/event-budgets/access";
import { BUDGET_MODULE_KEY, type BudgetSettingsInput } from "@/modules/event-budgets/domain";
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
 * Who may switch the optional Budget sheet on or off (#1682). The switching is the shared scoped helper
 * (`modules/event-modules/scoped-toggle.ts`), the same people and the same audit as the Event debrief:
 *   - staff: a system administrator, an Event Admin of the event, or the Clubs Administrator. A Registration Manager cannot;
 *   - an active Area Coordinator, on a published club event they can see, after the second sign-in step.
 * Switching it off hides the sheet and keeps every cost line. Switching it on changes nothing for clubs. Who may then read or
 * change the sheet is `access.ts`, which is separate from who may switch it.
 */

async function asBudgetError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new BudgetError(error.code, error.message);
    throw error;
  }
}

export type BudgetToggleActor = ScopedToggleActor;

export function requireStaffBudgetToggleAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<BudgetToggleActor> {
  return requireStaffToggleAccess(session, eventId, lookup);
}

export function requireAreaCoordinatorBudgetToggleActor(): Promise<BudgetToggleActor> {
  return asBudgetError(() => requireAreaCoordinatorToggleActor());
}

export type BudgetToolState = { enabled: boolean; eventName: string };

export async function loadBudgetToolState(eventId: string, scope: BudgetToggleActor["kind"]): Promise<BudgetToolState> {
  const event = await loadBudgetEvent(eventId, scope);
  return { enabled: await scopedModuleIsOn(eventId, BUDGET_MODULE_KEY), eventName: event.name };
}

/** Switches the Budget sheet in one transaction, with an audit entry for a real change. Repeating a switch changes nothing and audits nothing. */
export async function applyBudgetSettings(actor: BudgetToggleActor, eventId: string, input: BudgetSettingsInput): Promise<BudgetToolState> {
  await asBudgetError(() => assertScopedToggleAllowed(BUDGET_MODULE_KEY, actor));
  await loadBudgetEvent(eventId, actor.kind);
  await getPrisma().$transaction(async (tx) => {
    await writeScopedModuleSwitch(tx, { actor, eventId, moduleKey: BUDGET_MODULE_KEY, enabled: input.enabled });
  });
  return loadBudgetToolState(eventId, actor.kind);
}
