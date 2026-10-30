/**
 * Event lifecycle states and the transitions between them (#156). Pure rules,
 * no database: `lifecycle-repository.ts` gathers the facts and performs the
 * change. See `docs/EVENT-LIFECYCLE.md`.
 *
 * `Event.isPublished` stays the public-visibility column that the public pages
 * read; every transition sets it from `isPublicState`, so the two never
 * diverge. A null stored state is a legacy event and is derived.
 */
import type { EventPermission } from "@/modules/access/permissions";

export const eventLifecycleStates = [
  "DRAFT",
  "TEST",
  "PUBLISHED",
  "REGISTRATION_CLOSED",
  "IN_PROGRESS",
  "COMPLETE",
  "FINANCIAL_RECONCILIATION",
  "CLOSED",
  "ARCHIVED",
] as const;

export type EventLifecycleStateName = (typeof eventLifecycleStates)[number];

/** The states that can be stored on an event. ARCHIVED is only ever the `archivedAt` overlay. */
export type StoredEventLifecycleState = Exclude<EventLifecycleStateName, "ARCHIVED">;

export const eventLifecycleStateLabels: Record<EventLifecycleStateName, string> = {
  DRAFT: "Draft",
  TEST: "Test",
  PUBLISHED: "Published",
  REGISTRATION_CLOSED: "Registration closed",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  FINANCIAL_RECONCILIATION: "Financial reconciliation",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

export function eventLifecycleStateLabel(state: EventLifecycleStateName) {
  return eventLifecycleStateLabels[state];
}

export type EventLifecycleFacts = {
  lifecycleState: EventLifecycleStateName | null;
  isPublished: boolean;
  archivedAt: Date | null;
};

const publicStates: readonly EventLifecycleStateName[] = [
  "PUBLISHED",
  "REGISTRATION_CLOSED",
  "IN_PROGRESS",
  "COMPLETE",
  "FINANCIAL_RECONCILIATION",
  "CLOSED",
];

/**
 * Whether the public site shows an event in this state. DRAFT and TEST are not public: TEST is a staff
 * preview and behaves exactly like DRAFT for public visibility and registration (whether test
 * registrations are accepted is a later decision). ARCHIVED is hidden everywhere public.
 */
export function isPublicState(state: EventLifecycleStateName) {
  return publicStates.includes(state);
}

const registrationClosingStates: readonly EventLifecycleStateName[] = [
  "REGISTRATION_CLOSED",
  "COMPLETE",
  "FINANCIAL_RECONCILIATION",
  "CLOSED",
];

/**
 * True when the state itself closes registration. PUBLISHED and IN_PROGRESS leave registration to the
 * dates, exactly as before. Draft, test and archived events are not open anyway (not public / archived).
 */
export function closesRegistration(state: EventLifecycleStateName) {
  return registrationClosingStates.includes(state);
}

/**
 * The state an event is in now, reconciling the stored state with the columns old code still writes:
 * - archived wins (the archive overlay, #635);
 * - a legacy null reads from `isPublished`;
 * - a stored DRAFT/TEST that old code published (isPublished true) reads as PUBLISHED;
 * - a stored public state that old code unpublished (isPublished false) reads as DRAFT;
 * - anything else is the stored state.
 */
export function effectiveLifecycleState(event: EventLifecycleFacts): EventLifecycleStateName {
  if (event.archivedAt) return "ARCHIVED";
  const stored = event.lifecycleState;
  if (stored === null || stored === undefined || stored === "ARCHIVED") return event.isPublished ? "PUBLISHED" : "DRAFT";
  const storedPublic = isPublicState(stored);
  if (!storedPublic && event.isPublished) return "PUBLISHED";
  if (storedPublic && !event.isPublished) return "DRAFT";
  return stored;
}

export type LifecycleCondition = "STARTED" | "ENDED";

export type LifecycleTransitionRule = {
  from: EventLifecycleStateName;
  to: EventLifecycleStateName;
  permission: EventPermission;
  /** Event-time conditions that must hold. */
  condition?: LifecycleCondition;
  /** Moving to PUBLISHED needs the publish readiness checklist complete. */
  requiresReadiness?: boolean;
};

/** Every allowed transition. Nothing else is allowed; ARCHIVED is reached only through archive/unarchive. */
export const eventLifecycleTransitions: readonly LifecycleTransitionRule[] = [
  { from: "DRAFT", to: "TEST", permission: "CONFIGURE_EVENT" },
  { from: "DRAFT", to: "PUBLISHED", permission: "CONFIGURE_EVENT", requiresReadiness: true },
  { from: "TEST", to: "DRAFT", permission: "CONFIGURE_EVENT" },
  { from: "TEST", to: "PUBLISHED", permission: "CONFIGURE_EVENT", requiresReadiness: true },
  { from: "PUBLISHED", to: "DRAFT", permission: "CONFIGURE_EVENT" },
  { from: "PUBLISHED", to: "REGISTRATION_CLOSED", permission: "CONFIGURE_EVENT" },
  { from: "PUBLISHED", to: "IN_PROGRESS", permission: "CONFIGURE_EVENT", condition: "STARTED" },
  { from: "PUBLISHED", to: "COMPLETE", permission: "CONFIGURE_EVENT", condition: "ENDED" },
  { from: "REGISTRATION_CLOSED", to: "PUBLISHED", permission: "CONFIGURE_EVENT" },
  { from: "REGISTRATION_CLOSED", to: "DRAFT", permission: "CONFIGURE_EVENT" },
  { from: "REGISTRATION_CLOSED", to: "IN_PROGRESS", permission: "CONFIGURE_EVENT", condition: "STARTED" },
  { from: "REGISTRATION_CLOSED", to: "COMPLETE", permission: "CONFIGURE_EVENT", condition: "ENDED" },
  { from: "IN_PROGRESS", to: "COMPLETE", permission: "CONFIGURE_EVENT", condition: "ENDED" },
  { from: "COMPLETE", to: "FINANCIAL_RECONCILIATION", permission: "MANAGE_FINANCE" },
  { from: "FINANCIAL_RECONCILIATION", to: "CLOSED", permission: "MANAGE_FINANCE" },
];

export function findLifecycleTransition(from: EventLifecycleStateName, to: EventLifecycleStateName) {
  return eventLifecycleTransitions.find((rule) => rule.from === from && rule.to === to) ?? null;
}

/**
 * Whether the event's time conditions hold right now. The caller works them out with `hasEventEnded` and
 * `calendarDateInEventTimeZone` (`lifecycle.ts`): started means the first calendar day has been reached in
 * the event's own time zone; ended means the last calendar day has passed.
 */
export type LifecycleTimeFacts = { started: boolean; ended: boolean };

export type LifecycleRefusal =
  | { code: "UNKNOWN_TRANSITION"; message: string }
  | { code: "PERMISSION_DENIED"; message: string; permission: EventPermission }
  | { code: "CONDITION_UNMET"; message: string; condition: LifecycleCondition }
  | { code: "READINESS_INCOMPLETE"; message: string };

export type LifecycleDecision =
  | { allowed: true; rule: LifecycleTransitionRule }
  | { allowed: false; refusal: LifecycleRefusal };

function unknownTransitionMessage(from: EventLifecycleStateName, to: EventLifecycleStateName) {
  const fromLabel = eventLifecycleStateLabel(from);
  const toLabel = eventLifecycleStateLabel(to);
  if (to === "ARCHIVED" || from === "ARCHIVED") return "Archiving and unarchiving are separate actions.";
  if (from === "COMPLETE" || from === "FINANCIAL_RECONCILIATION" || from === "CLOSED") {
    if (to === "DRAFT") return `A ${fromLabel.toLowerCase()} event cannot be unpublished.`;
  }
  return `An event cannot move from ${fromLabel} to ${toLabel}.`;
}

/**
 * Decides one transition. `readinessComplete` matters only for transitions that require it; pass
 * undefined to leave readiness out of the decision (the service checks it separately, after the
 * row is locked).
 */
export function decideLifecycleTransition(input: {
  from: EventLifecycleStateName;
  to: EventLifecycleStateName;
  permissions: readonly EventPermission[];
  time: LifecycleTimeFacts;
  readinessComplete?: boolean;
}): LifecycleDecision {
  const rule = findLifecycleTransition(input.from, input.to);
  if (!rule) {
    return { allowed: false, refusal: { code: "UNKNOWN_TRANSITION", message: unknownTransitionMessage(input.from, input.to) } };
  }
  if (!input.permissions.includes(rule.permission)) {
    return {
      allowed: false,
      refusal: { code: "PERMISSION_DENIED", permission: rule.permission, message: `The ${rule.permission} permission is required for this change.` },
    };
  }
  if (rule.condition === "STARTED" && !input.time.started) {
    return { allowed: false, refusal: { code: "CONDITION_UNMET", condition: "STARTED", message: "The event has not started yet." } };
  }
  if (rule.condition === "ENDED" && !input.time.ended) {
    return { allowed: false, refusal: { code: "CONDITION_UNMET", condition: "ENDED", message: "The event has not ended yet." } };
  }
  if (rule.requiresReadiness && input.readinessComplete === false) {
    return { allowed: false, refusal: { code: "READINESS_INCOMPLETE", message: "Finish the publish checklist first." } };
  }
  return { allowed: true, rule };
}

/** The states reachable from `from` that this actor may move to right now (readiness is not evaluated). */
export function allowedNextStates(input: {
  from: EventLifecycleStateName;
  permissions: readonly EventPermission[];
  time: LifecycleTimeFacts;
}) {
  return eventLifecycleTransitions
    .filter((rule) => rule.from === input.from)
    .filter((rule) => decideLifecycleTransition({ from: input.from, to: rule.to, permissions: input.permissions, time: input.time }).allowed)
    .map((rule) => rule.to);
}

/** Reason text: optional, trimmed, at most 500 characters. Blank becomes null. */
export const LIFECYCLE_REASON_MAX_LENGTH = 500;
export function normalizeLifecycleReason(reason: string | null | undefined) {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The state a legacy event (stored state null) is given by the backfill (#156): exactly what
 * `effectiveLifecycleState` already reads it as, ignoring the archive overlay, which stays `archivedAt`.
 * An archived event maps from `isPublished` like any other. No transition history is invented.
 */
export function legacyLifecycleState(event: { isPublished: boolean }): StoredEventLifecycleState {
  return event.isPublished ? "PUBLISHED" : "DRAFT";
}
