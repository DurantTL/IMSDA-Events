import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { EventPermission } from "@/modules/access/permissions";
import { calendarDateInEventTimeZone, hasEventEnded } from "@/modules/events/lifecycle";
import {
  allowedNextStates,
  decideLifecycleTransition,
  eventLifecycleTransitions,
  effectiveLifecycleState,
  eventLifecycleStateLabel,
  isPublicState,
  LIFECYCLE_REASON_MAX_LENGTH,
  normalizeLifecycleReason,
  type EventLifecycleStateName,
} from "@/modules/events/lifecycle-state";
import { EventOperationError } from "@/modules/events/operation-error";
import { CLUB_EVENT_BILLING_MESSAGE, getEventPublishReadiness } from "@/modules/events/readiness";

/**
 * The typed refusals of a lifecycle transition (#156). A missing event and an incomplete publish
 * checklist are `EventOperationError`s (EVENT_NOT_FOUND, EVENT_NOT_READY), exactly as publishing always
 * reported them; everything else is this error.
 */
export class EventLifecycleError extends Error {
  constructor(
    public readonly code: "UNKNOWN_TRANSITION" | "PERMISSION_DENIED" | "CONDITION_UNMET" | "CONFLICT" | "ARCHIVED" | "REASON_TOO_LONG",
    message: string,
    public readonly currentState?: EventLifecycleStateName,
  ) {
    super(message);
    this.name = "EventLifecycleError";
  }
}

type Tx = Prisma.TransactionClient;

export type LifecycleActor = {
  userId: string;
  /** What the actor holds for this event (`effectivePermissions`); decides the declared permission per transition. */
  permissions: readonly EventPermission[];
};

export type TransitionEventLifecycleInput = {
  eventId: string;
  toState: EventLifecycleStateName;
  /** The state the caller saw. When set and the event has moved on, the transition is refused (409) rather than applied blindly. */
  expectedFromState?: EventLifecycleStateName | null;
  actor: LifecycleActor;
  reason?: string | null;
  now?: Date;
  /**
   * For the long-standing publish and unpublish actions only, which behave as before:
   * - an archived event is judged by the state under the archive overlay (archive never blocked them);
   * - `alreadyDone` says when the request is already satisfied (any public state counts as published).
   */
  legacy?: { alreadyDone: (state: EventLifecycleStateName) => boolean };
};

export type TransitionEventLifecycleResult = {
  changed: boolean;
  fromState: EventLifecycleStateName;
  toState: EventLifecycleStateName;
  lifecycleVersion: number;
};

type PublishReadinessItem = { id: string; complete: boolean };

/**
 * The saved event checked against the publish checklist (#467), shared by publishing and the lifecycle
 * transition to PUBLISHED. Throws EVENT_NOT_READY naming what is missing; returns the checklist flags as
 * the transition's evidence (ids and flags only).
 */
export async function assertEventReadyToPublish(tx: Tx, eventId: string, event: {
  name: string;
  slug: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  publicInfoUrl: string | null;
  supportContact: string | null;
  audience: "GENERAL" | "CLUB";
  billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE";
}): Promise<PublishReadinessItem[]> {
  const publishedFormCount = await tx.registrationFormVersion.count({
    where: { status: "PUBLISHED", form: { eventId } },
  });
  const readiness = getEventPublishReadiness(
    {
      name: event.name,
      slug: event.slug,
      startsOn: calendarDateInEventTimeZone(event.startsAt, event.timezone),
      endsOn: calendarDateInEventTimeZone(event.endsAt, event.timezone),
      timezone: event.timezone,
      location: event.location,
      publicInfoUrl: event.publicInfoUrl,
      supportContact: event.supportContact,
      audience: event.audience,
      billingMode: event.billingMode,
    },
    publishedFormCount,
  );
  if (!readiness.ready) {
    const incomplete = readiness.items.filter((item) => !item.complete);
    if (incomplete.length === 1 && incomplete[0]!.id === "club-billing") {
      throw new EventOperationError("EVENT_NOT_READY", CLUB_EVENT_BILLING_MESSAGE);
    }
    const missing = incomplete.map((item) => item.label.toLowerCase());
    throw new EventOperationError("EVENT_NOT_READY", `Finish the publish checklist first: ${missing.join(", ")}.`);
  }
  return readiness.items.map((item) => ({ id: item.id, complete: item.complete }));
}

function auditFor(fromState: EventLifecycleStateName, toState: EventLifecycleStateName, name: string) {
  // Publishing and unpublishing keep the audit actions they have always had.
  if (toState === "PUBLISHED" && !isPublicState(fromState)) {
    return { action: "EVENT_PUBLISHED", summary: `Published event: ${name}.`, metadata: { name } };
  }
  if (toState === "DRAFT" && isPublicState(fromState)) {
    return { action: "EVENT_UNPUBLISHED", summary: `Unpublished event: ${name}.`, metadata: { name } };
  }
  return {
    action: "EVENT_LIFECYCLE_CHANGED",
    summary: `Changed event state from ${eventLifecycleStateLabel(fromState)} to ${eventLifecycleStateLabel(toState)}: ${name}.`,
    metadata: { name, fromState, toState },
  };
}

/**
 * Moves one event to another lifecycle state (#156), in one transaction:
 * 1. lock the event row (`FOR UPDATE`), so two transitions, and a settings save, take turns;
 * 2. work out the effective state; already at `toState` is an idempotent no-op (no history row);
 * 3. a state other than `expectedFromState` is a CONFLICT; an undeclared move, a missing permission or an
 *    unmet condition is refused; moving to PUBLISHED needs the publish checklist;
 * 4. a conditional update on the lifecycle version sets the state AND `isPublished` (the column the public
 *    pages read) together, so they never diverge; a count other than one is a CONFLICT;
 * 5. the history row (immutable) and the audit entry are written in the same transaction.
 */
export async function transitionEventLifecycle(input: TransitionEventLifecycleInput): Promise<TransitionEventLifecycleResult> {
  const reason = normalizeLifecycleReason(input.reason);
  if (reason && reason.length > LIFECYCLE_REASON_MAX_LENGTH) {
    throw new EventLifecycleError("REASON_TOO_LONG", `The reason can be at most ${LIFECYCLE_REASON_MAX_LENGTH} characters.`);
  }
  const now = input.now ?? new Date();
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${input.eventId} FOR UPDATE`;
    const current = await tx.event.findUnique({
      where: { id: input.eventId },
      select: {
        name: true,
        slug: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        location: true,
        publicInfoUrl: true,
        supportContact: true,
        isPublished: true,
        audience: true,
        billingMode: true,
        archivedAt: true,
        lifecycleState: true,
        lifecycleVersion: true,
      },
    });
    if (!current) throw new EventOperationError("EVENT_NOT_FOUND", "That event no longer exists.");

    const effective = effectiveLifecycleState({
      lifecycleState: current.lifecycleState,
      isPublished: current.isPublished,
      archivedAt: input.legacy ? null : current.archivedAt,
    });
    const alreadyDone = input.legacy ? input.legacy.alreadyDone(effective) : effective === input.toState;
    if (alreadyDone) {
      // Even a no-op needs the permission that moving into this state needs, so a member without it learns nothing.
      // A state no rule enters (Archived) needs CONFIGURE_EVENT.
      const entering = eventLifecycleTransitions.filter((rule) => rule.to === input.toState).map((rule) => rule.permission);
      const required = entering.length > 0 ? entering : ["CONFIGURE_EVENT" as const];
      if (!required.some((permission) => input.actor.permissions.includes(permission))) {
        throw new EventLifecycleError("PERMISSION_DENIED", `The ${required[0]!} permission is required for this change.`, effective);
      }
      return { changed: false, fromState: effective, toState: effective, lifecycleVersion: current.lifecycleVersion };
    }
    if (effective === "ARCHIVED") {
      throw new EventLifecycleError("ARCHIVED", "This event is archived. Unarchive it before changing its state.", effective);
    }
    if (input.expectedFromState && input.expectedFromState !== effective) {
      throw new EventLifecycleError(
        "CONFLICT",
        `This event is now ${eventLifecycleStateLabel(effective).toLowerCase()}, not ${eventLifecycleStateLabel(input.expectedFromState).toLowerCase()}. Nothing was changed; review it and try again.`,
        effective,
      );
    }

    const decision = decideLifecycleTransition({
      from: effective,
      to: input.toState,
      permissions: input.actor.permissions,
      time: {
        started: calendarDateInEventTimeZone(now, current.timezone) >= calendarDateInEventTimeZone(current.startsAt, current.timezone),
        ended: hasEventEnded({ timezone: current.timezone, endsAt: current.endsAt, lastDay: null }, now),
      },
    });
    if (!decision.allowed) {
      const { refusal } = decision;
      throw new EventLifecycleError(
        refusal.code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : refusal.code === "CONDITION_UNMET" ? "CONDITION_UNMET" : "UNKNOWN_TRANSITION",
        refusal.message,
        effective,
      );
    }

    const evidence = decision.rule.requiresReadiness
      ? { publishReadiness: await assertEventReadyToPublish(tx, input.eventId, current) }
      : undefined;

    const { count } = await tx.event.updateMany({
      where: { id: input.eventId, lifecycleVersion: current.lifecycleVersion },
      data: {
        lifecycleState: input.toState as Exclude<EventLifecycleStateName, "ARCHIVED">,
        isPublished: isPublicState(input.toState),
        lifecycleVersion: { increment: 1 },
      },
    });
    if (count !== 1) {
      // Publish and unpublish have always treated "someone else got there first" as done, not as an error.
      if (input.legacy) return { changed: false, fromState: effective, toState: effective, lifecycleVersion: current.lifecycleVersion };
      throw new EventLifecycleError("CONFLICT", "This event was changed by someone else at the same moment. Nothing was changed; try again.", effective);
    }

    await tx.eventLifecycleTransition.create({
      data: {
        eventId: input.eventId,
        fromState: effective,
        toState: input.toState,
        actorUserId: input.actor.userId,
        reason,
        ...(evidence ? { evidence: evidence as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    const audit = auditFor(effective, input.toState, current.name);
    await tx.auditLog.create({
      data: {
        eventId: input.eventId,
        actorUserId: input.actor.userId,
        action: audit.action,
        entityType: "Event",
        entityId: input.eventId,
        correlationId: crypto.randomUUID(),
        summary: audit.summary,
        metadata: audit.metadata,
      },
    });
    return { changed: true, fromState: effective, toState: input.toState, lifecycleVersion: current.lifecycleVersion + 1 };
  });
}

/** The event's current effective state, its history (newest first) and the moves this actor may make now. */
export async function getEventLifecycle(input: { eventId: string; permissions: readonly EventPermission[]; now?: Date; historyLimit?: number }) {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({
    where: { id: input.eventId },
    select: {
      isPublished: true,
      archivedAt: true,
      lifecycleState: true,
      lifecycleVersion: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
    },
  });
  if (!event) return null;
  const now = input.now ?? new Date();
  const state = effectiveLifecycleState(event);
  const history = await prisma.eventLifecycleTransition.findMany({
    where: { eventId: input.eventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.historyLimit ?? 50,
    select: { id: true, fromState: true, toState: true, actorUserId: true, reason: true, createdAt: true },
  });
  return {
    state,
    stateLabel: eventLifecycleStateLabel(state),
    isPublic: isPublicState(state),
    lifecycleVersion: event.lifecycleVersion,
    allowedNext: state === "ARCHIVED" ? [] : allowedNextStates({
      from: state,
      permissions: input.permissions,
      time: {
        started: calendarDateInEventTimeZone(now, event.timezone) >= calendarDateInEventTimeZone(event.startsAt, event.timezone),
        ended: hasEventEnded({ timezone: event.timezone, endsAt: event.endsAt, lastDay: null }, now),
      },
    }).map((to) => ({ state: to, label: eventLifecycleStateLabel(to) })),
    // The history carries actor ids and free-text reasons: only those who can change the state may read it.
    history: !(input.permissions.includes("CONFIGURE_EVENT") || input.permissions.includes("MANAGE_FINANCE")) ? [] : history.map((row) => ({
      id: row.id,
      fromState: row.fromState,
      toState: row.toState,
      actorUserId: row.actorUserId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
