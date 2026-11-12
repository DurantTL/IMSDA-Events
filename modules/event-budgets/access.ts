import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  AccessDeniedError,
  effectivePermissions,
  requireEventMembership,
  type MembershipLookup,
  type Session,
} from "@/modules/access/authorization";
import { BUDGET_MODULE_KEY } from "@/modules/event-budgets/domain";
import { loadScopedToolEvent, ScopedToggleError, scopedModuleIsOn } from "@/modules/event-modules/scoped-toggle";
import { currentAreaCoordinator, isAreaCoordinator } from "@/modules/organizations/area-coordinators";

/**
 * Who may open and change an event's Budget sheet (#1682). One place, checked on the server for every page, API call and the
 * CSV, so nothing depends on what a page chose to show.
 *
 *  - Read: a system administrator, or event staff holding MANAGE_FINANCE or VIEW_REPORTS on the event (Event Admins, the
 *    Clubs Administrator on club events, Finance Managers, Registration Managers), and the event's Area Coordinators: the
 *    same set the Event debrief asks (`resolveDebriefRecipients`): every active Area Coordinator, with the second sign-in
 *    step passed. A grant carries no area, so there is no narrower list to use. Nobody else.
 *  - Change cost lines: those Area Coordinators, and staff holding MANAGE_FINANCE. Report-only staff read only.
 *  - Staff acting as an Area Coordinator (#442) are not a coordinator here: `currentAreaCoordinator` answers for a real
 *    account only.
 *  - The Budget sheet must be switched on for the event. Switched off, it is hidden from everyone and the data is kept.
 */

export type BudgetActor =
  | { kind: "staff"; userId: string; canWrite: boolean }
  | { kind: "area-coordinator"; accountId: string; canWrite: true };

export class BudgetError extends Error {
  constructor(public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND" | "NOT_PERMITTED" | "MODULE_OFF" | "TOO_MANY_LINES" | "LINE_NOT_FOUND", message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

/** Staff: MANAGE_FINANCE or VIEW_REPORTS on the event, or a system administrator. Write needs MANAGE_FINANCE. */
export async function requireStaffBudgetReader(session: Session, eventId: string, lookup: MembershipLookup): Promise<BudgetActor & { kind: "staff" }> {
  const access = await requireEventMembership(session, eventId, lookup);
  const permissions = effectivePermissions(access.user, access.membership);
  const canWrite = permissions.includes("MANAGE_FINANCE");
  if (!canWrite && !permissions.includes("VIEW_REPORTS")) {
    throw new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");
  }
  return { kind: "staff", userId: access.user.id, canWrite };
}

/** Staff who may change cost lines. */
export async function requireStaffBudgetWriter(session: Session, eventId: string, lookup: MembershipLookup): Promise<BudgetActor & { kind: "staff" }> {
  const actor = await requireStaffBudgetReader(session, eventId, lookup);
  if (!actor.canWrite) throw new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");
  return actor;
}

/** The signed-in Area Coordinator (grant active, second step passed), or a refusal that tells anyone else nothing. */
export async function requireAreaCoordinatorBudgetActor(): Promise<BudgetActor & { kind: "area-coordinator" }> {
  const account = await currentAreaCoordinator();
  if (!account) throw new BudgetError("NOT_AVAILABLE", "That could not be found.");
  return { kind: "area-coordinator", accountId: account.id, canWrite: true };
}

/** The club event the sheet is for, as this actor may see it. Staff also see an unpublished one; a coordinator only a published one. */
export async function loadBudgetEvent(eventId: string, scope: BudgetActor["kind"]) {
  try {
    return await loadScopedToolEvent(eventId, scope, "That club event could not be found. It may be archived or not a club event.");
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new BudgetError(error.code, error.message);
    throw error;
  }
}

/**
 * The gate a read or a cost line change passes: a coordinator's grant is read again here (the route checked it, and this keeps
 * the service safe when called from anywhere else), the event must be a club event this actor can see, and the module must be on.
 */
export async function assertBudgetAccess(actor: BudgetActor, eventId: string, need: "read" | "write"): Promise<{ id: string; name: string }> {
  if (actor.kind === "area-coordinator" && !(await isAreaCoordinator(actor.accountId))) {
    throw new BudgetError("NOT_AVAILABLE", "That could not be found.");
  }
  if (need === "write" && !actor.canWrite) throw new BudgetError("NOT_PERMITTED", "Your event role can read the budget sheet but not change it.");
  const event = await loadBudgetEvent(eventId, actor.kind);
  if (!(await scopedModuleIsOn(eventId, BUDGET_MODULE_KEY))) throw new BudgetError("MODULE_OFF", "The budget sheet is off for this event.");
  return event;
}

/**
 * May this actor also read the SOURCE event's sheet, for last year's comparison? Checked against that event, not this one: staff
 * need the same permissions there, and a coordinator is let in the same way. The source may be archived by now.
 */
export async function canReadSourceBudget(actor: BudgetActor, sourceEventId: string, context: { session?: Session; lookup?: MembershipLookup }): Promise<boolean> {
  const source = await getPrisma().event.findFirst({ where: { id: sourceEventId, audience: "CLUB" }, select: { id: true } });
  if (!source) return false;
  if (actor.kind === "area-coordinator") return isAreaCoordinator(actor.accountId);
  if (!context.session || !context.lookup) return false;
  try {
    await requireStaffBudgetReader(context.session, sourceEventId, context.lookup);
    return true;
  } catch {
    return false;
  }
}
