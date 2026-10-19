import { z } from "zod";
import type { CalculationFacts, CancellationResult } from "@/modules/cancellation-policy/calculator";
import { formatCents, type CancellationScope } from "@/modules/cancellation-policy/rules";

/**
 * Cancellation requests (#170): the pure rules. No database, no clock, no email.
 *
 * A request asks staff to review a cancellation. Nothing here, or anywhere in this module, cancels a registration,
 * refunds money or issues credit: that is #171 and a human. Approving or declining records a decision by a named
 * person with a reason, and nothing else.
 */

export const requestStatuses = [
  "REQUESTED",
  "UNDER_REVIEW",
  "INFORMATION_NEEDED",
  "APPROVED",
  "DECLINED",
  "WITHDRAWN",
  "SUPERSEDED",
] as const;
export type RequestStatus = typeof requestStatuses[number];

/** A request is open until it is decided, withdrawn or superseded. */
export const openStatuses = ["REQUESTED", "UNDER_REVIEW", "INFORMATION_NEEDED"] as const satisfies readonly RequestStatus[];
export type OpenStatus = typeof openStatuses[number];

export function isOpenStatus(status: string): status is OpenStatus {
  return (openStatuses as readonly string[]).includes(status);
}

export const requestStatusLabels: Record<RequestStatus, string> = {
  REQUESTED: "Requested",
  UNDER_REVIEW: "Under review",
  INFORMATION_NEEDED: "Information needed",
  APPROVED: "Approved",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  SUPERSEDED: "Replaced by a newer request",
};

/**
 * What an email or the registrant's page may say about a status: the status and what happens next, nothing about the
 * reason, the amount or the outcome. Approved says the decision is recorded and that the event team will follow up,
 * because carrying it out is a separate step.
 */
export const requestStatusDetails: Record<RequestStatus, string> = {
  REQUESTED: "The event team has your request and will review it. Nothing has been cancelled, refunded or changed yet.",
  UNDER_REVIEW: "The event team is reviewing your request. Nothing has been cancelled, refunded or changed yet.",
  INFORMATION_NEEDED: "The event team needs a little more information from you before they can review your request.",
  APPROVED: "The event team approved your request. They will contact you about the next steps; nothing has changed on your registration yet.",
  DECLINED: "The event team reviewed your request and did not approve it. Contact the event team if you have questions.",
  WITHDRAWN: "You withdrew this request. Your registration was not changed.",
  SUPERSEDED: "A newer request you made replaced this one. Your registration was not changed by this request.",
};

/**
 * Who may move a request to which status. A registrant can only withdraw. Staff can start a review, ask for
 * information, approve or decline; only a named person can approve or decline (the repository requires a user id and
 * a reason, and the database refuses a decided row without them). SYSTEM can only supersede, when a newer request the
 * registrant explicitly chose replaces an older one; no automated path decides anything.
 */
export type ActorKind = "REGISTRANT" | "STAFF" | "SYSTEM";

const transitions: Record<RequestStatus, Partial<Record<RequestStatus, readonly ActorKind[]>>> = {
  REQUESTED: {
    UNDER_REVIEW: ["STAFF"],
    INFORMATION_NEEDED: ["STAFF"],
    APPROVED: ["STAFF"],
    DECLINED: ["STAFF"],
    WITHDRAWN: ["REGISTRANT"],
    SUPERSEDED: ["SYSTEM"],
  },
  UNDER_REVIEW: {
    INFORMATION_NEEDED: ["STAFF"],
    APPROVED: ["STAFF"],
    DECLINED: ["STAFF"],
    WITHDRAWN: ["REGISTRANT"],
    SUPERSEDED: ["SYSTEM"],
  },
  INFORMATION_NEEDED: {
    UNDER_REVIEW: ["STAFF"],
    APPROVED: ["STAFF"],
    DECLINED: ["STAFF"],
    WITHDRAWN: ["REGISTRANT"],
    SUPERSEDED: ["SYSTEM"],
  },
  APPROVED: {},
  DECLINED: {},
  WITHDRAWN: {},
  SUPERSEDED: {},
};

export function canTransition(from: RequestStatus, to: RequestStatus, actor: ActorKind) {
  return Boolean(transitions[from][to]?.includes(actor));
}

/** The statuses a request in `from` may move to, for whoever `actor` is. */
export function nextStatuses(from: RequestStatus, actor: ActorKind): RequestStatus[] {
  return requestStatuses.filter((status) => canTransition(from, status, actor));
}

/** Statuses whose change is emailed to the registrant. Every change is, except the registrant's own first submit. */
export const decisionStatuses = ["APPROVED", "DECLINED"] as const satisfies readonly RequestStatus[];

// ---------------------------------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------------------------------

export type RequestScope = {
  scope: CancellationScope;
  attendeeIds: readonly string[];
  chargeIds: readonly string[];
};

/**
 * One canonical string per scope and its ids, so a repeat of the same request is recognised whatever order the ids
 * came in. Built from the calculator's EFFECTIVE scope: choosing every attendee is the whole registration.
 */
export function scopeKeyOf(input: RequestScope) {
  if (input.scope === "FULL_REGISTRATION") return "FULL_REGISTRATION";
  const ids = [...new Set(input.scope === "ATTENDEE" ? input.attendeeIds : input.chargeIds)].sort();
  return `${input.scope}:${ids.join(",")}`;
}

/**
 * Whether two scopes on one registration touch the same thing. The whole registration overlaps everything. Attendees
 * overlap when they share one. Components overlap when they share a charge. An attendee and a component are treated as
 * overlapping, because a component may be that attendee's own charge and a duplicate refund request is the cost of
 * guessing wrong.
 */
export function scopesOverlap(a: RequestScope, b: RequestScope) {
  if (a.scope === "FULL_REGISTRATION" || b.scope === "FULL_REGISTRATION") return true;
  if (a.scope !== b.scope) return true;
  const ids = (scope: RequestScope) => new Set(scope.scope === "ATTENDEE" ? scope.attendeeIds : scope.chargeIds);
  const left = ids(a);
  return [...ids(b)].some((id) => left.has(id));
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration state, to see whether it changed after the request
// ---------------------------------------------------------------------------------------------------------------------

/** What the registration looked like when the request was made. Ids and amounts only; no names, no answers. */
export type RegistrationStateSnapshot = {
  registrationStatus: string;
  attendeeIds: string[];
  /** What each charge is and whose it is, so a charge moving to another attendee, or being reclassified, is a change. */
  charges: Array<{ id: string; amountCents: number; attendeeId: string | null; category: string; fieldKey: string | null }>;
  paidCents: number;
  depositCents: number;
};

export function registrationStateOf(facts: CalculationFacts): RegistrationStateSnapshot {
  return {
    registrationStatus: facts.registration?.status ?? "UNKNOWN",
    attendeeIds: facts.attendees.map((attendee) => attendee.id).sort(),
    charges: facts.charges.map((charge) => ({ id: charge.id, amountCents: charge.amountCents, attendeeId: charge.attendeeId, category: charge.category, fieldKey: charge.fieldKey })).sort((a, b) => a.id.localeCompare(b.id)),
    paidCents: facts.registrationPaidCents,
    depositCents: facts.depositCents,
  };
}

/** A stable, order-independent text for a state, which the server hashes into the request's fingerprint (`fingerprint.ts`). */
export function canonicalState(state: RegistrationStateSnapshot) {
  return JSON.stringify({
    registrationStatus: state.registrationStatus,
    attendeeIds: [...state.attendeeIds].sort(),
    charges: [...state.charges].map((charge) => ({ id: charge.id, amountCents: charge.amountCents, attendeeId: charge.attendeeId ?? null, category: charge.category ?? null, fieldKey: charge.fieldKey ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
    paidCents: state.paidCents,
    depositCents: state.depositCents,
  });
}

export type RequestConflict = {
  code:
    | "REGISTRATION_STATUS_CHANGED"
    | "REGISTRATION_NOT_CANCELLABLE"
    | "ATTENDEES_CHANGED"
    | "CHARGES_CHANGED"
    | "PAYMENTS_CHANGED"
    | "DEPOSIT_CHANGED"
    | "SCOPE_NO_LONGER_VALID"
    | "OUTCOME_CHANGED"
    | "POLICY_VERSION_CHANGED"
    | "OVERLAPPING_OPEN_REQUEST";
  /** A CHANGE means the registration is not what the registrant was shown; a NOTE is context. */
  severity: "CHANGE" | "NOTE";
  message: string;
};

/**
 * Differences between the registration when it was requested and now. Pure: the caller supplies both states.
 * A CHANGE needs the decider's explicit acknowledgement before an approval.
 */
export function diffRegistrationState(then: RegistrationStateSnapshot, now: RegistrationStateSnapshot): RequestConflict[] {
  const conflicts: RequestConflict[] = [];
  if (then.registrationStatus !== now.registrationStatus) {
    conflicts.push({
      code: "REGISTRATION_STATUS_CHANGED",
      severity: "CHANGE",
      message: `The registration was ${then.registrationStatus.toLowerCase()} when requested and is ${now.registrationStatus.toLowerCase()} now.`,
    });
  }
  const added = now.attendeeIds.filter((id) => !then.attendeeIds.includes(id)).length;
  const removed = then.attendeeIds.filter((id) => !now.attendeeIds.includes(id)).length;
  if (added > 0 || removed > 0) {
    conflicts.push({
      code: "ATTENDEES_CHANGED",
      severity: "CHANGE",
      message: `Attendees changed since the request (${added} added, ${removed} removed).`,
    });
  }
  const describe = (charge: RegistrationStateSnapshot["charges"][number]) => `${charge.amountCents}|${charge.attendeeId ?? ""}|${charge.category ?? ""}|${charge.fieldKey ?? ""}`;
  const before = new Map(then.charges.map((charge) => [charge.id, describe(charge)]));
  const after = new Map(now.charges.map((charge) => [charge.id, describe(charge)]));
  const chargesChanged = before.size !== after.size || [...before].some(([id, text]) => after.get(id) !== text);
  if (chargesChanged) {
    conflicts.push({ code: "CHARGES_CHANGED", severity: "CHANGE", message: "The registration's charges changed since the request." });
  }
  if (then.paidCents !== now.paidCents) {
    conflicts.push({
      code: "PAYMENTS_CHANGED",
      severity: "CHANGE",
      message: `Paid money changed since the request: ${formatCents(then.paidCents)} then, ${formatCents(now.paidCents)} now.`,
    });
  }
  if (then.depositCents !== now.depositCents) {
    conflicts.push({ code: "DEPOSIT_CHANGED", severity: "CHANGE", message: "The reservation deposit held changed since the request." });
  }
  return conflicts;
}

/** Any CHANGE among the conflicts: an approval must acknowledge it. */
export function hasChangeConflict(conflicts: readonly RequestConflict[]) {
  return conflicts.some((conflict) => conflict.severity === "CHANGE");
}

// ---------------------------------------------------------------------------------------------------------------------
// What the registrant sees
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The proposed outcome as the registrant sees it before and after submitting. Built from a calculation result and
 * nothing else; it leaves out the rules JSON, the raw facts, ids of other people and anything about the policy
 * internals beyond the version number.
 */
export type RegistrantProposal = {
  status: CancellationResult["status"];
  message: string | null;
  policyVersion: number | null;
  scope: CancellationScope | null;
  attendeeIds: string[];
  chargeIds: string[];
  timingLabel: string | null;
  termsText: string | null;
  /** True once every window has closed (or for a first-night no-show), so the registrant sees it is after a deadline. */
  afterDeadline: boolean;
  lines: Array<{ label: string; amountCents: number; inScopeCents: number; refundableCents: number; withheldCents: number; reason: string }>;
  flatFee: { label: string; cents: number } | null;
  chargedCents: number;
  paidCents: number;
  refundCents: number;
  retainedCents: number;
  depositOutcome: CancellationResult["deposit"]["outcome"];
  creditMayBeOffered: boolean;
  registrationWouldBeCancelled: boolean;
  explanation: string[];
  evaluatedAt: string;
  notice: string;
};

export const PROPOSAL_NOTICE =
  "This is a proposed outcome from the event's cancellation policy, not a decision. Nothing is cancelled, refunded or credited when you send a request. The event team reviews every request and decides.";

export function registrantProposal(result: CancellationResult): RegistrantProposal {
  const calculated = result.status === "CALCULATED";
  return {
    status: result.status,
    message: result.message,
    policyVersion: result.policy?.version ?? null,
    scope: result.scope?.effective ?? null,
    attendeeIds: result.scope?.attendeeIds ?? [],
    chargeIds: result.scope?.chargeIds ?? [],
    timingLabel: result.timing?.label ?? null,
    termsText: result.timing?.termsText ?? null,
    afterDeadline: result.timing ? result.timing.kind !== "WINDOW" : false,
    lines: calculated
      ? result.lines
        .filter((line) => line.inScopeCents !== 0 || line.amountCents === 0)
        .map((line) => ({
          label: line.label,
          amountCents: line.amountCents,
          inScopeCents: line.inScopeCents,
          refundableCents: line.eligibleCents,
          withheldCents: line.withheldCents,
          reason: line.reason,
        }))
      : [],
    flatFee: result.flatFee,
    chargedCents: result.totals.chargedCents,
    paidCents: result.money.paidCents,
    refundCents: result.money.refundCents,
    retainedCents: result.money.retainedCents,
    depositOutcome: result.deposit.outcome,
    creditMayBeOffered: result.creditOption.available,
    registrationWouldBeCancelled: result.capacity.registrationCancelled,
    explanation: calculated ? result.explanation : [],
    evaluatedAt: result.evaluatedAt,
    notice: PROPOSAL_NOTICE,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------------------------------

export const contactMethods = ["EMAIL", "PHONE"] as const;
export type ContactMethod = typeof contactMethods[number];

const idList = z.array(z.string().trim().min(1).max(120)).max(60).optional();

export const requestSelectionSchema = z.object({
  scope: z.enum(["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"]),
  attendeeIds: idList,
  chargeIds: idList,
}).strict();

export const previewInputSchema = z.object({
  action: z.literal("preview"),
  selection: requestSelectionSchema,
}).strict();

export const submitInputSchema = z.object({
  action: z.literal("submit"),
  selection: requestSelectionSchema,
  reason: z.string().trim().min(3, "Tell the event team why you are asking.").max(1000, "Keep the reason under 1,000 characters."),
  contactMethod: z.enum(contactMethods),
  /** One key per form load, so tapping send twice or retrying a slow request makes one request. */
  idempotencyKey: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, "The request key is not valid."),
  /** The refund the registrant was shown. If the recalculation differs, nothing is saved and the new outcome is shown. */
  expectedRefundCents: z.number().int().min(0).max(1_000_000_000),
  /** Open requests the registrant chose to replace with this one. Required when the new request overlaps them. */
  supersedeRequestIds: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
}).strict();

export const withdrawInputSchema = z.object({
  action: z.literal("withdraw"),
  requestId: z.string().trim().min(1).max(64),
}).strict();

export const registrantActionSchema = z.discriminatedUnion("action", [previewInputSchema, submitInputSchema, withdrawInputSchema]);
export type RegistrantAction = z.infer<typeof registrantActionSchema>;
export type SubmitInput = z.infer<typeof submitInputSchema>;

/** The staff actions. There is no automated or bulk action: each is one request, by one named person. */
export const staffActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START_REVIEW") }).strict(),
  z.object({
    action: z.literal("REQUEST_INFORMATION"),
    /** What the registrant should provide. Shown on their page; never emailed. */
    registrantNote: z.string().trim().min(3, "Say what information is needed.").max(1000),
  }).strict(),
  z.object({
    action: z.literal("APPROVE"),
    reason: z.string().trim().min(3, "Give the reason for approving.").max(1000),
    /** Required when the registration changed since the request. */
    acknowledgeChanges: z.boolean().optional(),
  }).strict(),
  z.object({
    action: z.literal("DECLINE"),
    reason: z.string().trim().min(3, "Give the reason for declining.").max(1000),
  }).strict(),
]);
export type StaffAction = z.infer<typeof staffActionSchema>;

export const statusFilterSchema = z.enum(["OPEN", ...requestStatuses]).default("OPEN");
export type StatusFilter = z.infer<typeof statusFilterSchema>;
