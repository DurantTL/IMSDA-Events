import "server-only";

import {
  AccessDeniedError,
  effectivePermissions,
  requireEventMembership,
  type MembershipLookup,
  type Session,
} from "@/modules/access/authorization";
import { STAFFING_MODULE_KEY } from "@/modules/event-staffing/domain";
import { loadScopedToolEvent, ScopedToggleError, scopedModuleIsOn } from "@/modules/event-modules/scoped-toggle";
import { currentAreaCoordinator, isAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { accountIsTltDirector, currentTltDirector } from "@/modules/tlt-directory/access";

/**
 * Who may open and change an event's staffing sheet (#1678). One place, checked on the server for every page, API call and the
 * CSV, so nothing depends on what a page chose to show. The sheet holds the names of people on the event, minors included, so
 * the list of who can see it is short.
 *
 *  - Read: a system administrator, and event staff holding VIEW_EVENT on the event (every role but Kitchen staff; they can
 *    already search the same registrations). The event's Area Coordinators: every active Area Coordinator with the second
 *    sign-in step passed (the same definition as the Budget sheet and the Event debrief; a grant carries no area).
 *  - Change activities and assignments: those Area Coordinators, and staff holding CONFIGURE_EVENT (Event Admins and the Clubs
 *    Administrator on club events). It is event setup, so it follows that permission.
 *  - The TLT director (the TLT director setting on an Area Coordinator grant, second step passed) reads the sheet of the same
 *    club events and has one narrow write: put a registered, current TLT on an activity as a TLT, and take a TLT off. She cannot
 *    change activities, leads, helpers, lifeguards or the switch. Everyone else, including staff acting as a coordinator, gets
 *    "not found" from her pages and routes.
 *  - Staff acting as an Area Coordinator (#442) are not a coordinator here: `currentAreaCoordinator` answers for a real account only.
 *  - Each assigned person sees their own assignment and nothing else: `own-assignments.ts`, which has no other reader.
 *  - The staffing sheet must be switched on for the event. Switched off, it is hidden from everyone and the data is kept.
 */

export type StaffingActor =
  | { kind: "staff"; userId: string; canWrite: boolean }
  | { kind: "area-coordinator"; accountId: string; canWrite: true }
  /** `canWrite` is false on purpose: the only change she may make is a TLT assignment, asked for as `assign-tlt`. */
  | { kind: "tlt-director"; accountId: string; canWrite: false };

export class StaffingError extends Error {
  constructor(public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND" | "NOT_PERMITTED" | "MODULE_OFF" | "ACTIVITY_NOT_FOUND" | "ASSIGNMENT_NOT_FOUND" | "NOT_ON_EVENT" | "CONFLICT" | "TOO_MANY", message: string) {
    super(message);
    this.name = "StaffingError";
  }
}

const refusal = () => new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");

/** Staff: VIEW_EVENT on the event, or a system administrator. Write needs CONFIGURE_EVENT. */
export async function requireStaffStaffingReader(session: Session, eventId: string, lookup: MembershipLookup): Promise<StaffingActor & { kind: "staff" }> {
  const access = await requireEventMembership(session, eventId, lookup);
  const permissions = effectivePermissions(access.user, access.membership);
  if (!permissions.includes("VIEW_EVENT")) throw refusal();
  return { kind: "staff", userId: access.user.id, canWrite: permissions.includes("CONFIGURE_EVENT") };
}

/** Staff who may change activities and assignments. */
export async function requireStaffStaffingWriter(session: Session, eventId: string, lookup: MembershipLookup): Promise<StaffingActor & { kind: "staff" }> {
  const actor = await requireStaffStaffingReader(session, eventId, lookup);
  if (!actor.canWrite) throw refusal();
  return actor;
}

/** The signed-in Area Coordinator (grant active, second step passed), or a refusal that tells anyone else nothing. */
export async function requireAreaCoordinatorStaffingActor(): Promise<StaffingActor & { kind: "area-coordinator" }> {
  const account = await currentAreaCoordinator();
  if (!account) throw new StaffingError("NOT_AVAILABLE", "That could not be found.");
  return { kind: "area-coordinator", accountId: account.id, canWrite: true };
}

/** The signed-in TLT director, or a refusal that tells anyone else nothing. */
export async function requireTltDirectorStaffingActor(): Promise<StaffingActor & { kind: "tlt-director" }> {
  const director = await currentTltDirector();
  if (!director) throw new StaffingError("NOT_AVAILABLE", "That could not be found.");
  return { kind: "tlt-director", accountId: director.accountId, canWrite: false };
}

/** The club event the sheet is for, as this actor may see it. Staff also see an unpublished one; a coordinator (and the TLT director) only a published one. */
export async function loadStaffingEvent(eventId: string, scope: StaffingActor["kind"]) {
  try {
    return await loadScopedToolEvent(eventId, scope === "staff" ? "staff" : "area-coordinator", "That club event could not be found. It may be archived or not a club event.");
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new StaffingError(error.code, error.message);
    throw error;
  }
}

/**
 * The gate a read or a change passes: a coordinator's grant is read again here (the route checked it, and this keeps the
 * service safe when called from anywhere else), the event must be a club event this actor can see, and the module must be on.
 */
export async function assertStaffingAccess(actor: StaffingActor, eventId: string, need: "read" | "write" | "assign-tlt"): Promise<{ id: string; name: string }> {
  if (actor.kind === "area-coordinator" && !(await isAreaCoordinator(actor.accountId))) {
    throw new StaffingError("NOT_AVAILABLE", "That could not be found.");
  }
  // The TLT director's setting and grant are read again on every call, so a removed setting stops her at once.
  if (actor.kind === "tlt-director" && !(await accountIsTltDirector(actor.accountId))) {
    throw new StaffingError("NOT_AVAILABLE", "That could not be found.");
  }
  if (need === "write" && !actor.canWrite) throw new StaffingError("NOT_PERMITTED", "Your event role can read the staffing sheet but not change it.");
  // Taking a TLT off is open to anyone who may change the sheet and to the TLT director; adding one is the TLT director's own path.
  if (need === "assign-tlt" && !actor.canWrite && actor.kind !== "tlt-director") throw new StaffingError("NOT_PERMITTED", "Your event role can read the staffing sheet but not change it.");
  const event = await loadStaffingEvent(eventId, actor.kind);
  if (!(await scopedModuleIsOn(eventId, STAFFING_MODULE_KEY))) throw new StaffingError("MODULE_OFF", "Event staffing is off for this event.");
  return event;
}

