import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { onlineCancellationApplies } from "@/modules/cancellation-policy/online-cancellation";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { cancellableComponents, type CancellationResult, type CancellationSelection } from "@/modules/cancellation-policy/calculator";
import {
  appendCalculationRecord,
  loadRegistrationFacts,
  policyInEffect,
  previewCancellation,
  type PreviewRequest,
} from "@/modules/cancellation-policy/repository";
import { formatCentsPlain } from "@/modules/payments/format-cents";
import { type CancellationScope } from "@/modules/cancellation-policy/rules";
import { stateFingerprint } from "@/modules/cancellation-requests/fingerprint";
import { enqueueCancellationRequestMessage } from "@/modules/communications/transactional-messages";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import {
  canTransition,
  diffRegistrationState,
  hasChangeConflict,
  isOpenStatus,
  openStatuses,
  registrantProposal,
  registrationStateOf,
  requestStatusDetails,
  requestStatusLabels,
  requestStatuses,
  scopeKeyOf,
  scopesOverlap,
  type ActorKind,
  type RegistrantProposal,
  type RegistrationStateSnapshot,
  type RequestConflict,
  type RequestScope,
  type RequestStatus,
  type StaffAction,
  type StatusFilter,
  type SubmitInput,
} from "@/modules/cancellation-requests/domain";
import type {
  CapacityEffects,
  RegistrantRequestSummary,
  RegistrantRequestView,
  StaffQueueRow,
  StaffRequestDetail,
} from "@/modules/cancellation-requests/views";

/**
 * The cancellation request workflow (#170): a registrant asks, staff review.
 *
 * Everything here reads, or writes only CancellationRequest, CancellationRequestEvent, a calculation row, audit
 * entries and queued emails. Nothing writes to payments, refunds, registrations, attendees, capacity or any ledger,
 * and nothing calls a payment provider. Approving records a decision by a named person with a reason; carrying it out
 * is #171, and a human.
 */

export type RequestErrorCode =
  | "NOT_AVAILABLE"
  | "CALCULATION_UNAVAILABLE"
  | "OUTCOME_CHANGED"
  | "OVERLAPPING_OPEN_REQUEST"
  | "REQUEST_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CHANGES_NOT_ACKNOWLEDGED"
  | "ACTOR_REQUIRED";

export class CancellationRequestError extends Error {
  constructor(
    public readonly code: RequestErrorCode,
    message: string,
    /** Safe detail for the response: the new proposal, the overlapping requests or the conflicts. */
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CancellationRequestError";
  }
}

type Client = Prisma.TransactionClient;

/** The registration a caller has already authorized (a private link, or a signed-in account that owns it). */
export type RequestTarget = { registrationId: string; eventId: string };

export type RegistrantActor = { via: "MANAGE_LINK" | "ATTENDEE_PORTAL"; accountId?: string | null };

const ACTIVE_REGISTRATION_STATUSES: readonly string[] = ["SUBMITTED", "CONFIRMED", "WAITLISTED"];

function isScope(value: string): value is CancellationScope {
  return value === "FULL_REGISTRATION" || value === "ATTENDEE" || value === "COMPONENT";
}

function asStatus(value: string): RequestStatus {
  return (requestStatuses as readonly string[]).includes(value) ? value as RequestStatus : "REQUESTED";
}

function toSelection(row: { scope: string; attendeeIds: string[]; chargeIds: string[] }): CancellationSelection {
  const scope = isScope(row.scope) ? row.scope : "FULL_REGISTRATION";
  return { scope, ...(scope === "ATTENDEE" ? { attendeeIds: row.attendeeIds } : {}), ...(scope === "COMPONENT" ? { chargeIds: row.chargeIds } : {}) };
}

function selectionRequest(registrationId: string, selection: CancellationSelection): Omit<PreviewRequest, "asOf"> {
  return {
    input: { kind: "REGISTRATION", registration: registrationId, noShowFirstNight: false },
    selection: {
      scope: selection.scope,
      ...(selection.attendeeIds ? { attendeeIds: [...selection.attendeeIds] } : {}),
      ...(selection.chargeIds ? { chargeIds: [...selection.chargeIds] } : {}),
    },
  };
}

/** Serializes everything that touches one registration's requests, so two taps or two tabs cannot both pass a check. */
async function lockRegistration(tx: Client, registrationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cancellation-request:${registrationId}`}))`;
}

async function deliverAfterCommit(messageIds: string[]) {
  if (messageIds.length === 0) return;
  try {
    await processQueuedMessageIdsAfterCommit(messageIds);
  } catch (error) {
    // The request is saved and the messages are queued; the outbox retries. Never undo a saved request.
    logError("Cancellation request message processing failed after commit", error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Online requests are offered for an active registration the contact pays for. A registration billed to a church or a
 * group contact is handled by the event team, who bill and refund through the organization, so no refund is shown to
 * its registrant.
 */
async function loadEligibility(db: Pick<Client, "registration">, target: RequestTarget) {
  const registration = await db.registration.findFirst({
    where: { id: target.registrationId, eventId: target.eventId },
    select: {
      id: true,
      status: true,
      groupRegistration: { select: { id: true } },
      clubRegistration: { select: { id: true } },
      event: { select: { billingMode: true } },
    },
  });
  if (!registration) return { registration: null, reason: "This registration could not be found." };
  if (!ACTIVE_REGISTRATION_STATUSES.includes(registration.status)) {
    return { registration, reason: "Only an active registration can be cancelled. Contact the event team if you need help." };
  }
  if (!onlineCancellationApplies({ billingMode: registration.event.billingMode }) || registration.groupRegistration || registration.clubRegistration) {
    return { registration, reason: "This registration is billed through a church or group, so cancellations go through the event team. Contact them to cancel." };
  }
  return { registration, reason: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The registrant's side
// ---------------------------------------------------------------------------------------------------------------------

const requestSelect = {
  id: true,
  eventId: true,
  registrationId: true,
  calculationId: true,
  policyVersion: true,
  scope: true,
  attendeeIds: true,
  chargeIds: true,
  scopeKey: true,
  status: true,
  reason: true,
  contactMethod: true,
  proposedRefundCents: true,
  proposedRetainedCents: true,
  registrationState: true,
  requestedVia: true,
  registrantNote: true,
  decidedByNameSnapshot: true,
  decisionReason: true,
  decidedAt: true,
  decidedWithChanges: true,
  createdAt: true,
  updatedAt: true,
  timeline: { orderBy: { createdAt: "asc" as const }, select: { toStatus: true, actorKind: true, actorNameSnapshot: true, note: true, createdAt: true } },
} satisfies Prisma.CancellationRequestSelect;

type RequestRow = Prisma.CancellationRequestGetPayload<{ select: typeof requestSelect }>;

function registrantSummary(row: RequestRow, names: Map<string, string>, charges: Map<string, string>): RegistrantRequestSummary {
  const status = asStatus(row.status);
  return {
    id: row.id,
    status,
    statusLabel: requestStatusLabels[status],
    statusDetail: requestStatusDetails[status],
    scope: isScope(row.scope) ? row.scope : "FULL_REGISTRATION",
    attendeeNames: row.attendeeIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
    chargeLabels: row.chargeIds.map((id) => charges.get(id)).filter((label): label is string => Boolean(label)),
    proposedRefundCents: row.proposedRefundCents,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    registrantNote: status === "INFORMATION_NEEDED" ? row.registrantNote : null,
    canWithdraw: canTransition(status, "WITHDRAWN", "REGISTRANT"),
    // Statuses and times only: a staff name or a note never reaches the registrant.
    timeline: row.timeline.map((step) => ({ status: asStatus(step.toStatus), label: requestStatusLabels[asStatus(step.toStatus)], at: step.createdAt.toISOString() })),
  };
}

/**
 * What the request panel needs for one authorized registration: whether requests are offered, the scopes the policy in
 * effect allows, the people and components that can be chosen, and the registrant's earlier requests. Read-only.
 */
export async function getRegistrantRequestView(target: RequestTarget, now = new Date()): Promise<RegistrantRequestView> {
  const db = getPrisma();
  const eligibility = await loadEligibility(db, target);
  const rows = await db.cancellationRequest.findMany({
    where: { registrationId: target.registrationId, eventId: target.eventId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: requestSelect,
  });
  const empty = (reason: string | null, noPolicy = false): RegistrantRequestView => ({
    noPolicy,
    available: false,
    unavailableReason: reason,
    allowedScopes: [],
    attendees: [],
    components: [],
    requests: rows.map((row) => registrantSummary(row, new Map(), new Map())),
    hasOpenRequest: rows.some((row) => isOpenStatus(row.status)),
  });
  if (!eligibility.registration) return empty(eligibility.reason);
  // A registrant with an open request can still see and withdraw it when the registration stops being eligible.
  if (eligibility.reason) return empty(eligibility.reason);
  const policy = await policyInEffect(target.eventId, now);
  if (!policy) return empty("Online cancellation requests are not available for this event yet. Contact the event team to cancel.", true);
  const { facts, summary } = await loadRegistrationFacts(target.eventId, target.registrationId, now);
  const names = new Map((summary?.attendees ?? []).map((attendee) => [attendee.id, attendee.name]));
  const components = cancellableComponents(facts.charges, policy.rules).map((charge) => ({ id: charge.id, label: charge.label, amountCents: charge.amountCents }));
  const charges = new Map((summary?.charges ?? []).map((charge) => [charge.id, charge.label]));
  const allowedScopes = policy.rules.allowedScopes.filter((scope) => scope !== "COMPONENT" || components.length > 0);
  return {
    available: allowedScopes.length > 0,
    unavailableReason: allowedScopes.length > 0 ? null : "This event's policy does not allow online cancellation requests. Contact the event team.",
    allowedScopes,
    attendees: (summary?.attendees ?? []).map((attendee) => ({ id: attendee.id, name: attendee.name })),
    components,
    requests: rows.map((row) => registrantSummary(row, names, charges)),
    hasOpenRequest: rows.some((row) => isOpenStatus(row.status)),
  };
}

/**
 * The same view for a registration the caller has already authorized by id alone (the portal page lists only the signed-in
 * account's own registrations). The event comes from the registration, never from a caller.
 */
export async function getRegistrantRequestViewById(registrationId: string, now = new Date()): Promise<RegistrantRequestView | null> {
  const registration = await getPrisma().registration.findUnique({ where: { id: registrationId }, select: { id: true, eventId: true } });
  return registration ? getRegistrantRequestView({ registrationId: registration.id, eventId: registration.eventId }, now) : null;
}

/**
 * The proposed outcome for a chosen scope, shown before anything is submitted. Read-only: the registrant cannot set a
 * clock or a first-night no-show; the server's time and the calculator decide.
 */
export async function previewRegistrantRequest(target: RequestTarget, selection: CancellationSelection, now = new Date()): Promise<RegistrantProposal> {
  const eligibility = await loadEligibility(getPrisma(), target);
  if (!eligibility.registration || eligibility.reason) throw new CancellationRequestError("NOT_AVAILABLE", eligibility.reason ?? "This registration could not be found.");
  const { result } = await previewCancellation(target.eventId, selectionRequest(target.registrationId, selection) as PreviewRequest, now);
  return registrantProposal(result);
}

export type SubmitOutcome = {
  request: RegistrantRequestSummary;
  /** True when this call returned a request that already existed (a retry, or the same scope already open). */
  duplicate: boolean;
  superseded: string[];
};

async function findExisting(db: Pick<Client, "cancellationRequest">, target: RequestTarget, input: { idempotencyKey?: string; scopeKey?: string }) {
  if (input.idempotencyKey) {
    const byKey = await db.cancellationRequest.findFirst({
      where: { registrationId: target.registrationId, eventId: target.eventId, idempotencyKey: input.idempotencyKey },
      select: requestSelect,
    });
    if (byKey) return byKey;
  }
  if (input.scopeKey) {
    return db.cancellationRequest.findFirst({
      where: { registrationId: target.registrationId, eventId: target.eventId, scopeKey: input.scopeKey, status: { in: [...openStatuses] } },
      select: requestSelect,
    });
  }
  return null;
}

async function summaryFor(row: RequestRow, target: RequestTarget, now: Date) {
  const view = await getRegistrantRequestView(target, now).catch(() => null);
  return view?.requests.find((request) => request.id === row.id) ?? registrantSummary(row, new Map(), new Map());
}

type TransitionInput = {
  tx: Client;
  request: { id: string; eventId: string; registrationId: string; calculationId: string; policyVersion: number | null; scope: string };
  from: RequestStatus | null;
  to: RequestStatus;
  actorKind: ActorKind;
  actorUserId?: string | null;
  actorName?: string | null;
  note?: string | null;
  auditAction: string;
  auditSummary: string;
  extraAudit?: Record<string, string | number | boolean | null>;
  /** The registrant is told of every step except the first submit, which has its own message. */
  email: "RECEIVED" | "UPDATED" | null;
};

/** Appends the timeline step, the audit entry (ids only) and the status email for one change. */
async function recordStep(input: TransitionInput) {
  const { tx, request } = input;
  const step = await tx.cancellationRequestEvent.create({
    select: { id: true },
    data: {
      eventId: request.eventId,
      requestId: request.id,
      fromStatus: input.from,
      toStatus: input.to,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorNameSnapshot: input.actorName ?? null,
      note: input.note ?? null,
    },
  });
  await writeAuditLog({
    eventId: request.eventId,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: input.auditAction,
    entityType: "CancellationRequest",
    entityId: request.id,
    summary: input.auditSummary,
    // Ids and states only: never the reason, a note, a name, an amount or contact details.
    metadata: {
      requestId: request.id,
      registrationId: request.registrationId,
      calculationId: request.calculationId,
      policyVersion: request.policyVersion,
      scope: request.scope,
      fromStatus: input.from,
      toStatus: input.to,
      actorKind: input.actorKind,
      sideEffects: "NONE",
      ...(input.extraAudit ?? {}),
    },
  }, tx);
  if (!input.email) return [] as string[];
  const queued = await enqueueCancellationRequestMessage(tx, {
    eventId: request.eventId,
    registrationId: request.registrationId,
    requestId: request.id,
    stepId: step.id,
    kind: input.email,
    status: input.to,
    statusLabel: requestStatusLabels[input.to],
    statusDetail: requestStatusDetails[input.to],
  });
  return queued.pendingMessageIds;
}

/**
 * Saves a registrant's request. Idempotent: the same `idempotencyKey`, or the same scope while one is already open,
 * returns the existing request and changes nothing. A request that overlaps a different open one is refused unless the
 * registrant chose to replace it (`supersedeRequestIds`), in which case the older one becomes SUPERSEDED, visibly.
 *
 * The calculation is run again on the server, here, and saved with the request in one transaction. If it no longer
 * matches the refund the registrant was shown (`expectedRefundCents`), nothing is saved and the new proposal is
 * returned for them to see.
 */
export async function submitCancellationRequest(
  target: RequestTarget,
  actor: RegistrantActor,
  input: SubmitInput,
  now = new Date(),
): Promise<SubmitOutcome> {
  const db = getPrisma();
  const prior = await findExisting(db, target, { idempotencyKey: input.idempotencyKey });
  if (prior) return { request: await summaryFor(prior, target, now), duplicate: true, superseded: [] };

  const eligibility = await loadEligibility(db, target);
  if (!eligibility.registration || eligibility.reason) throw new CancellationRequestError("NOT_AVAILABLE", eligibility.reason ?? "This registration could not be found.");

  const selection: CancellationSelection = { scope: input.selection.scope, attendeeIds: input.selection.attendeeIds, chargeIds: input.selection.chargeIds };
  const calcRequest = selectionRequest(target.registrationId, selection);
  const { result } = await previewCancellation(target.eventId, calcRequest as PreviewRequest, now);
  if (result.status !== "CALCULATED" || !result.scope) {
    throw new CancellationRequestError("CALCULATION_UNAVAILABLE", result.message ?? "A proposed outcome could not be calculated for that choice.", { status: result.status });
  }
  if (result.money.refundCents !== input.expectedRefundCents) {
    throw new CancellationRequestError(
      "OUTCOME_CHANGED",
      "The proposed outcome changed since you last looked at it. Review the new outcome and send your request again.",
      { proposal: registrantProposal(result) },
    );
  }
  const requestScope: RequestScope = { scope: result.scope.effective, attendeeIds: result.scope.attendeeIds, chargeIds: result.scope.chargeIds };
  const scopeKey = scopeKeyOf(requestScope);
  const state = registrationStateOf(result.facts);

  let pending: string[] = [];
  try {
    const outcome = await db.$transaction(async (tx) => {
      await lockRegistration(tx, target.registrationId);
      const again = await findExisting(tx, target, { idempotencyKey: input.idempotencyKey, scopeKey });
      if (again) return { existing: again, created: null, superseded: [] as string[] };

      const open = await tx.cancellationRequest.findMany({
        where: { registrationId: target.registrationId, eventId: target.eventId, status: { in: [...openStatuses] } },
        select: { id: true, status: true, scope: true, attendeeIds: true, chargeIds: true },
      });
      const overlapping = open.filter((row) => scopesOverlap(requestScope, { scope: isScope(row.scope) ? row.scope : "FULL_REGISTRATION", attendeeIds: row.attendeeIds, chargeIds: row.chargeIds }));
      const chosen = new Set(input.supersedeRequestIds ?? []);
      const unreplaced = overlapping.filter((row) => !chosen.has(row.id));
      if (unreplaced.length > 0) {
        throw new CancellationRequestError(
          "OVERLAPPING_OPEN_REQUEST",
          "You already have an open request that overlaps this one. Withdraw it, or choose to replace it with this one.",
          { open: unreplaced.map((row) => ({ id: row.id, status: row.status, scope: row.scope })) },
        );
      }

      const calculation = await appendCalculationRecord(tx, target.eventId, null, calcRequest, result, "REGISTRANT");
      const created = await tx.cancellationRequest.create({
        data: {
          eventId: target.eventId,
          registrationId: target.registrationId,
          calculationId: calculation.id,
          policyVersionId: result.policy?.versionId ?? null,
          policyVersion: result.policy?.version ?? null,
          scope: result.scope?.effective ?? input.selection.scope,
          attendeeIds: requestScope.scope === "ATTENDEE" ? [...new Set(requestScope.attendeeIds)].sort() : [],
          chargeIds: requestScope.scope === "COMPONENT" ? [...new Set(requestScope.chargeIds)].sort() : [],
          scopeKey,
          status: "REQUESTED",
          reason: input.reason,
          contactMethod: input.contactMethod,
          proposedRefundCents: result.money.refundCents,
          proposedRetainedCents: result.money.retainedCents,
          stateFingerprint: stateFingerprint(state),
          registrationState: state as unknown as Prisma.InputJsonValue,
          requestedVia: actor.via,
          requestedByAccountId: actor.accountId ?? null,
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true, eventId: true, registrationId: true, calculationId: true, policyVersion: true, scope: true },
      });
      const ids: string[] = [];
      ids.push(...await recordStep({
        tx, request: created, from: null, to: "REQUESTED", actorKind: "REGISTRANT",
        auditAction: "CANCELLATION_REQUEST_SUBMITTED",
        auditSummary: "A registrant asked to cancel; the proposed outcome was recorded. Nothing was cancelled, refunded or credited.",
        extraAudit: { requestedVia: actor.via, afterDeadline: result.timing ? result.timing.kind !== "WINDOW" : false },
        email: "RECEIVED",
      }));
      const superseded: string[] = [];
      for (const older of overlapping) {
        const moved = await tx.cancellationRequest.updateMany({
          where: { id: older.id, status: { in: [...openStatuses] } },
          data: { status: "SUPERSEDED", supersededById: created.id },
        });
        if (moved.count === 0) continue;
        superseded.push(older.id);
        const olderRow = await tx.cancellationRequest.findUnique({ where: { id: older.id }, select: { id: true, eventId: true, registrationId: true, calculationId: true, policyVersion: true, scope: true } });
        if (!olderRow) continue;
        ids.push(...await recordStep({
          tx, request: olderRow, from: asStatus(older.status), to: "SUPERSEDED", actorKind: "SYSTEM",
          auditAction: "CANCELLATION_REQUEST_SUPERSEDED",
          auditSummary: "An open request was replaced by a newer request the registrant chose.",
          extraAudit: { supersededById: created.id },
          email: "UPDATED",
        }));
      }
      const row = await tx.cancellationRequest.findUniqueOrThrow({ where: { id: created.id }, select: requestSelect });
      return { existing: null, created: row, superseded, pending: ids };
    });
    if (outcome.existing) return { request: await summaryFor(outcome.existing, target, now), duplicate: true, superseded: [] };
    pending = outcome.pending ?? [];
    await deliverAfterCommit(pending);
    return { request: await summaryFor(outcome.created as RequestRow, target, now), duplicate: false, superseded: outcome.superseded };
  } catch (error) {
    // Two submits raced past the lock's reads: the database's unique indexes settled it. Return the winner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findExisting(db, target, { idempotencyKey: input.idempotencyKey, scopeKey });
      if (winner) return { request: await summaryFor(winner, target, now), duplicate: true, superseded: [] };
    }
    throw error;
  }
}

/**
 * The registrant withdraws their own open request. Only a request on this registration can be named, so a request id
 * from another registration is "not found", not "forbidden". Withdrawing twice returns the withdrawn request.
 */
export async function withdrawCancellationRequest(target: RequestTarget, requestId: string, now = new Date()): Promise<RegistrantRequestSummary> {
  const db = getPrisma();
  const result = await db.$transaction(async (tx) => {
    await lockRegistration(tx, target.registrationId);
    const request = await tx.cancellationRequest.findFirst({
      where: { id: requestId, registrationId: target.registrationId, eventId: target.eventId },
      select: { id: true, eventId: true, registrationId: true, calculationId: true, policyVersion: true, scope: true, status: true },
    });
    if (!request) throw new CancellationRequestError("REQUEST_NOT_FOUND", "That request could not be found on this registration.");
    const from = asStatus(request.status);
    if (from === "WITHDRAWN") return { pending: [] as string[], changed: false };
    if (!canTransition(from, "WITHDRAWN", "REGISTRANT")) {
      throw new CancellationRequestError("INVALID_TRANSITION", `A request that is ${requestStatusLabels[from].toLowerCase()} can no longer be withdrawn. Contact the event team.`);
    }
    const moved = await tx.cancellationRequest.updateMany({ where: { id: request.id, status: request.status }, data: { status: "WITHDRAWN" } });
    if (moved.count === 0) throw new CancellationRequestError("INVALID_TRANSITION", "That request just changed. Reload and try again.");
    const pending = await recordStep({
      tx, request, from, to: "WITHDRAWN", actorKind: "REGISTRANT",
      auditAction: "CANCELLATION_REQUEST_WITHDRAWN",
      auditSummary: "A registrant withdrew a cancellation request. Nothing was cancelled, refunded or credited.",
      email: "UPDATED",
    });
    return { pending, changed: true };
  });
  await deliverAfterCommit(result.pending);
  const view = await getRegistrantRequestView(target, now);
  const summary = view.requests.find((entry) => entry.id === requestId);
  if (!summary) throw new CancellationRequestError("REQUEST_NOT_FOUND", "That request could not be found on this registration.");
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------------------------------------------------

function contactName(contact: unknown) {
  const record = contact && typeof contact === "object" && !Array.isArray(contact) ? contact as Record<string, unknown> : {};
  const first = typeof record.firstName === "string" ? record.firstName : "";
  const last = typeof record.lastName === "string" ? record.lastName : "";
  return `${first} ${last}`.trim() || "Registrant";
}

function proposalOfCalculation(row: { result: unknown }): RegistrantProposal {
  return registrantProposal(row.result as CancellationResult);
}

/** The staff queue for one event: open requests by default, oldest first so the longest wait is on top. */
export async function listCancellationRequests(eventId: string, filter: StatusFilter = "OPEN"): Promise<StaffQueueRow[]> {
  const db = getPrisma();
  const rows = await db.cancellationRequest.findMany({
    where: { eventId, ...(filter === "OPEN" ? { status: { in: [...openStatuses] } } : { status: filter }) },
    orderBy: { createdAt: filter === "OPEN" ? "asc" : "desc" },
    take: 200,
    select: { id: true, registrationId: true, status: true, scope: true, proposedRefundCents: true, createdAt: true, updatedAt: true, calculation: { select: { result: true } } },
  });
  const registrations = await db.registration.findMany({
    where: { eventId, id: { in: [...new Set(rows.map((row) => row.registrationId))] } },
    select: { id: true, confirmationCode: true, contactSnapshot: true },
  });
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));
  return rows.map((row) => {
    const registration = byId.get(row.registrationId);
    const status = asStatus(row.status);
    return {
      id: row.id,
      registrationId: row.registrationId,
      confirmationCode: registration?.confirmationCode ?? "Removed",
      registrantName: registration ? contactName(registration.contactSnapshot) : "Registration removed",
      status,
      statusLabel: requestStatusLabels[status],
      scope: isScope(row.scope) ? row.scope : "FULL_REGISTRATION",
      proposedRefundCents: row.proposedRefundCents,
      afterDeadline: proposalOfCalculation(row.calculation).afterDeadline,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

const staffActionsFor = (status: RequestStatus): StaffRequestDetail["actions"] => {
  const actions: StaffRequestDetail["actions"] = [];
  if (canTransition(status, "UNDER_REVIEW", "STAFF")) actions.push("START_REVIEW");
  if (canTransition(status, "INFORMATION_NEEDED", "STAFF")) actions.push("REQUEST_INFORMATION");
  if (canTransition(status, "APPROVED", "STAFF")) actions.push("APPROVE");
  if (canTransition(status, "DECLINED", "STAFF")) actions.push("DECLINE");
  return actions;
};

/**
 * What changed since the registrant asked, and what else is open: the registration's current state against the state
 * recorded with the request, today's outcome against the proposal they were shown, and overlapping open requests.
 */
async function conflictsFor(
  client: Client | null,
  request: { id: string; eventId: string; registrationId: string; scope: string; attendeeIds: string[]; chargeIds: string[]; policyVersion: number | null; proposedRefundCents: number; registrationState: unknown },
  now: Date,
): Promise<{ conflicts: RequestConflict[]; registrationStatus: string; fingerprint: string | null }> {
  const conflicts: RequestConflict[] = [];
  let registrationStatus = "UNKNOWN";
  let fingerprint: string | null = null;
  const recorded = request.registrationState as RegistrationStateSnapshot;
  try {
    const { facts } = await loadRegistrationFacts(request.eventId, request.registrationId, now, client ?? undefined);
    registrationStatus = facts.registration?.status ?? "UNKNOWN";
    const currentState = registrationStateOf(facts);
    fingerprint = stateFingerprint(currentState);
    const stateDiff = diffRegistrationState(recorded, currentState);
    conflicts.push(...stateDiff);
    // The registration itself is as it was when the request was made: any difference in outcome is only time passing.
    const registrationUnchanged = stateFingerprint(recorded) === stateFingerprint(currentState);
    const current = await previewCancellation(request.eventId, selectionRequest(request.registrationId, toSelection(request)) as PreviewRequest, now, client ?? undefined);
    if (current.result.status !== "CALCULATED") {
      conflicts.push({
        code: current.result.status === "NOT_CANCELLABLE" ? "REGISTRATION_NOT_CANCELLABLE" : "SCOPE_NO_LONGER_VALID",
        severity: "CHANGE",
        message: current.result.message ?? "The request can no longer be calculated against the registration as it is now.",
      });
    } else {
      const newerPolicy = request.policyVersion !== null && current.result.policy !== null && current.result.policy.version !== request.policyVersion;
      if (current.result.money.refundCents !== request.proposedRefundCents) {
        conflicts.push({
          code: "OUTCOME_CHANGED",
          severity: registrationUnchanged ? "NOTE" : "CHANGE",
          message: registrationUnchanged
            ? (newerPolicy
              ? `A newer refund policy is in effect. The registration is unchanged, but today the policy would propose a ${formatCentsPlain(current.result.money.refundCents)} refund; the registrant was shown ${formatCentsPlain(request.proposedRefundCents)}.`
              : `Time has passed since the request. The registration is unchanged, but today the policy would propose a ${formatCentsPlain(current.result.money.refundCents)} refund; the registrant was shown ${formatCentsPlain(request.proposedRefundCents)}.`)
            : `Today the policy would propose a ${formatCentsPlain(current.result.money.refundCents)} refund; the registrant was shown ${formatCentsPlain(request.proposedRefundCents)}.`,
        });
      }
      if (request.policyVersion !== null && current.result.policy && current.result.policy.version !== request.policyVersion) {
        conflicts.push({
          code: "POLICY_VERSION_CHANGED",
          severity: "NOTE",
          message: `A newer refund policy is in effect (version ${current.result.policy.version}); the request used version ${request.policyVersion}.`,
        });
      }
    }
  } catch {
    conflicts.push({ code: "REGISTRATION_NOT_CANCELLABLE", severity: "CHANGE", message: "The registration could not be loaded; it may have been removed." });
  }
  return { conflicts, registrationStatus, fingerprint };
}

function capacityEffects(result: CancellationResult, waitlistedInEvent: number): CapacityEffects {
  return {
    registrationWouldBeCancelled: result.capacity.registrationCancelled,
    seatsReleased: result.capacity.attendeesReleased.length,
    componentsReleased: result.capacity.componentsReleased.length,
    waitlistPlaceReleased: result.capacity.waitlistPlaceReleased,
    waitlistedInEvent,
    note: "Deciding a request releases no seat and promotes no one from the waitlist. Those effects only happen if the cancellation is carried out later, by the event team.",
  };
}

/** One request with everything staff need to decide. The event id is part of the lookup, so another event's id is "not found". */
export async function getCancellationRequestDetail(eventId: string, requestId: string, now = new Date()): Promise<StaffRequestDetail | null> {
  const db = getPrisma();
  const row = await db.cancellationRequest.findFirst({
    where: { id: requestId, eventId },
    select: { ...requestSelect, calculation: { select: { result: true } } },
  });
  if (!row) return null;
  const status = asStatus(row.status);
  const [{ conflicts, registrationStatus }, registration, others, waitlistedInEvent] = await Promise.all([
    conflictsFor(null, row, now),
    db.registration.findFirst({ where: { id: row.registrationId, eventId }, select: { confirmationCode: true, contactSnapshot: true } }),
    db.cancellationRequest.findMany({
      where: { eventId, registrationId: row.registrationId, status: { in: [...openStatuses] }, NOT: { id: row.id } },
      select: { id: true, status: true, scope: true, createdAt: true },
    }),
    db.registration.count({ where: { eventId, status: "WAITLISTED" } }),
  ]);
  const proposal = proposalOfCalculation(row.calculation);
  const result = row.calculation.result as CancellationResult;
  const names = new Map(result.facts.attendees.map((attendee) => [attendee.id, `Attendee ${attendee.position + 1}`]));
  const allConflicts: RequestConflict[] = [...conflicts];
  if (others.length > 0 && isOpenStatus(row.status)) {
    allConflicts.push({ code: "OVERLAPPING_OPEN_REQUEST", severity: "NOTE", message: `This registration has ${others.length} other open request${others.length === 1 ? "" : "s"}.` });
  }
  const labels = new Map(result.facts.charges.map((charge) => [charge.id, charge.label]));
  return {
    id: row.id,
    eventId,
    registrationId: row.registrationId,
    confirmationCode: registration?.confirmationCode ?? "Removed",
    registrationStatus,
    registrantName: registration ? contactName(registration.contactSnapshot) : "Registration removed",
    status,
    statusLabel: requestStatusLabels[status],
    scope: isScope(row.scope) ? row.scope : "FULL_REGISTRATION",
    attendeeNames: row.attendeeIds.map((id) => names.get(id) ?? "Attendee"),
    chargeLabels: row.chargeIds.map((id) => labels.get(id) ?? "Charge"),
    requestedVia: row.requestedVia,
    contactMethod: row.contactMethod,
    reason: row.reason,
    registrantNote: row.registrantNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    calculationId: row.calculationId,
    policyVersion: row.policyVersion,
    proposal,
    conflicts: allConflicts,
    capacity: capacityEffects(result, waitlistedInEvent),
    otherOpenRequests: others.map((other) => ({ id: other.id, status: asStatus(other.status), scope: isScope(other.scope) ? other.scope : "FULL_REGISTRATION", createdAt: other.createdAt.toISOString() })),
    decision: row.decidedAt && row.decidedByNameSnapshot && row.decisionReason
      ? { byName: row.decidedByNameSnapshot, reason: row.decisionReason, at: row.decidedAt.toISOString(), withChanges: row.decidedWithChanges }
      : null,
    timeline: row.timeline.map((step) => ({
      status: asStatus(step.toStatus),
      label: requestStatusLabels[asStatus(step.toStatus)],
      actorKind: (step.actorKind === "STAFF" || step.actorKind === "SYSTEM" ? step.actorKind : "REGISTRANT") as ActorKind,
      actorName: step.actorNameSnapshot,
      note: step.note,
      at: step.createdAt.toISOString(),
    })),
    actions: staffActionsFor(status),
  };
}

export type StaffActor = { userId: string };

/**
 * One staff action on one request, by one named person. APPROVE and DECLINE need a reason (the database also refuses a
 * decided row without a named person and a reason). When the registration changed since the request, an approval needs
 * the decider to acknowledge it. No automated caller exists: there is no system actor type here.
 *
 * Approving records the decision only. It does not cancel the registration, create or change a Payment or Refund,
 * issue credit, release capacity or promote anyone; that is #171, done by a human.
 */
export async function reviewCancellationRequest(eventId: string, requestId: string, actor: StaffActor, action: StaffAction, now = new Date()) {
  if (!actor.userId?.trim()) throw new CancellationRequestError("ACTOR_REQUIRED", "A named staff member is required to review a request.");
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, displayName: true } });
  if (!user || !user.displayName.trim()) throw new CancellationRequestError("ACTOR_REQUIRED", "A named staff member is required to review a request.");

  const target = action.action === "START_REVIEW" ? "UNDER_REVIEW"
    : action.action === "REQUEST_INFORMATION" ? "INFORMATION_NEEDED"
      : action.action === "APPROVE" ? "APPROVED" : "DECLINED";
  const isDecision = action.action === "APPROVE" || action.action === "DECLINE";

  const pending = await db.$transaction(async (tx) => {
    const request = await tx.cancellationRequest.findFirst({
      where: { id: requestId, eventId },
      select: { id: true, eventId: true, registrationId: true, calculationId: true, policyVersion: true, scope: true, status: true, attendeeIds: true, chargeIds: true, proposedRefundCents: true, registrationState: true },
    });
    if (!request) throw new CancellationRequestError("REQUEST_NOT_FOUND", "That request could not be found for this event.");
    await lockRegistration(tx, request.registrationId);
    const from = asStatus(request.status);
    if (!canTransition(from, target, "STAFF")) {
      throw new CancellationRequestError("INVALID_TRANSITION", `A request that is ${requestStatusLabels[from].toLowerCase()} cannot be moved to ${requestStatusLabels[target].toLowerCase()}.`);
    }
    // What changed, read after the lock and just before deciding, so the acknowledgement and `decidedWithChanges` describe
    // the registration at the moment of the decision. An approval over a changed registration must be acknowledged.
    let changed = false;
    // The registration's state at this moment, recorded with the approval (#171): carrying the request out later applies only
    // to a registration that still matches it.
    let approvedFingerprint: string | null = null;
    if (action.action === "APPROVE") {
      const { conflicts, fingerprint } = await conflictsFor(tx, request, now);
      approvedFingerprint = fingerprint;
      changed = hasChangeConflict(conflicts);
      if (changed && !action.acknowledgeChanges) {
        throw new CancellationRequestError(
          "CHANGES_NOT_ACKNOWLEDGED",
          "The registration changed since this request was made. Review the changes and confirm you have, then approve.",
          { conflicts },
        );
      }
    }
    const moved = await tx.cancellationRequest.updateMany({
      // Compare-and-set on the status read above, so two reviewers cannot both decide.
      where: { id: request.id, eventId, status: request.status },
      data: {
        status: target,
        ...(action.action === "REQUEST_INFORMATION" ? { registrantNote: action.registrantNote } : {}),
        ...(isDecision
          ? {
            decidedByUserId: user.id,
            decidedByNameSnapshot: user.displayName,
            decisionReason: action.action === "APPROVE" || action.action === "DECLINE" ? action.reason : null,
            decidedAt: now,
            decidedWithChanges: changed,
            ...(action.action === "APPROVE" ? { approvedStateFingerprint: approvedFingerprint } : {}),
          }
          : {}),
      },
    });
    if (moved.count === 0) throw new CancellationRequestError("INVALID_TRANSITION", "Another reviewer just changed this request. Reload and look again.");
    return recordStep({
      tx, request, from, to: target, actorKind: "STAFF", actorUserId: user.id, actorName: user.displayName,
      note: action.action === "REQUEST_INFORMATION" ? action.registrantNote : isDecision ? (action.action === "APPROVE" || action.action === "DECLINE" ? action.reason : null) : null,
      auditAction: action.action === "APPROVE" ? "CANCELLATION_REQUEST_APPROVED"
        : action.action === "DECLINE" ? "CANCELLATION_REQUEST_DECLINED"
          : "CANCELLATION_REQUEST_STATUS_CHANGED",
      auditSummary: action.action === "APPROVE" ? "Staff approved a cancellation request. The decision is recorded only; nothing was cancelled, refunded or credited."
        : action.action === "DECLINE" ? "Staff declined a cancellation request. Nothing was changed on the registration."
          : "Staff changed a cancellation request's status.",
      extraAudit: isDecision ? { decidedWithChanges: changed } : undefined,
      email: "UPDATED",
    });
  }, { timeout: 20_000 });
  await deliverAfterCommit(pending);
  return { requestId, status: target };
}
