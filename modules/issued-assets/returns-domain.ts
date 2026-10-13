import { z } from "zod";
import { entryMethods, type AssetCondition } from "@/modules/issued-assets/domain";
import { lodgingHoldKinds } from "@/modules/lodging/domain";

/**
 * Issued assets (#214, slice 2): the pure rules for returns, cash deposits, charges, waivers, facility issues and the
 * closeout reconciliation. Free of server-only imports so tests and client screens can use them.
 *
 * Money rule: this system records, it does not move money. A cash deposit taken or handed back at the desk is an
 * append-only ledger entry (who, why, when). A charge may be posted to the registration through the existing adjustment
 * path; a waiver of it is the reversing line. Nothing here calls a payment provider.
 */

export const returnOutcomes = ["RETURNED", "LOST", "DAMAGED"] as const;
export type ReturnOutcome = (typeof returnOutcomes)[number];

export const returnOutcomeLabels: Record<ReturnOutcome, string> = { RETURNED: "Returned", LOST: "Lost", DAMAGED: "Returned damaged" };

/** The most one deposit can be, in cents: a guard against a mistyped amount, not a pricing rule. */
export const MAX_DEPOSIT_CENTS = 50_000;
/** The most one charge can be, in cents. */
export const MAX_CHARGE_CENTS = 1_000_000;
export const MAX_RETURN_ITEMS = 50;

export const depositShortfalls = ["KEEP_ALL", "KEEP_FEES"] as const;
export type DepositShortfall = (typeof depositShortfalls)[number];
export const depositShortfallLabels: Record<DepositShortfall, string> = {
  KEEP_ALL: "Keep the whole deposit if anything is missing or damaged",
  KEEP_FEES: "Keep the replacement fee of each missing or damaged item; hand back the rest",
};

export const chargeCategories = ["REPLACEMENT", "DAMAGE", "OTHER"] as const;
export type ChargeCategory = (typeof chargeCategories)[number];
export const chargeCategoryLabels: Record<ChargeCategory, string> = { REPLACEMENT: "Replacement", DAMAGE: "Damage", OTHER: "Other" };

export const facilitySeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type FacilitySeverity = (typeof facilitySeverities)[number];
export const facilityStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"] as const;
export type FacilityStatus = (typeof facilityStatuses)[number];
export const facilityTargetKinds = ["UNIT", "ASSET", "OTHER"] as const;
export type FacilityTargetKind = (typeof facilityTargetKinds)[number];
export const facilitySources = ["REPORT", "CHECKOUT_INSPECTION"] as const;
export type FacilitySource = (typeof facilitySources)[number];

export const holdKindLabels: Record<(typeof lodgingHoldKinds)[number], string> = { STAFF: "Staff hold", MAINTENANCE: "Maintenance", SAFETY: "Safety", DAMAGE: "Damage" };

export function formatCents(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const idSchema = z.string().trim().min(1).max(64);
const textSchema = (max: number) => z.string().trim().max(max);
const reasonSchema = z.string().trim().min(3, "Give a reason.").max(500);
const isoSchema = z.string().datetime({ offset: true });
const keySchema = z.string().trim().min(8).max(100);
const nightSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-06-16.");

export const returnItemSchema = z.object({
  /** The open issue being returned. A serialized item may be named by `code` instead (a scan sheet knows only the key). */
  issuanceId: idSchema.optional(),
  code: z.string().trim().min(1).max(64).optional(),
  outcome: z.enum(returnOutcomes).default("RETURNED"),
  /** A lot: how many of the issue this outcome covers. The whole issue when left out. */
  quantity: z.number().int().min(1).max(100_000).optional(),
  /** The condition of a returned item. Damage beyond wear is the DAMAGED outcome, not a condition. */
  condition: z.enum(["NEW", "GOOD", "WORN"]).optional(),
  /** Why: required for a loss or damage. */
  note: textSchema(300).optional(),
  /** A reference to the evidence (a photo number, an incident or work-order number). Text only. */
  evidenceRef: textSchema(200).optional(),
  /** A numbered item can be swapped or replaced in the same step (a key that does not work, a lost key): the replacement is issued to the same holder and covered by the same deposit. */
  replacementCode: z.string().trim().min(1).max(64).optional(),
}).strict().superRefine((item, context) => {
  if (!item.issuanceId && !item.code) context.addIssue({ code: "custom", message: "Name the issue or the code being returned.", path: ["code"] });
  if (item.outcome !== "RETURNED" && !item.note) context.addIssue({ code: "custom", message: "Say what happened to a lost or damaged item.", path: ["note"] });
  if (item.outcome !== "RETURNED" && item.condition) context.addIssue({ code: "custom", message: "A condition is for a returned item.", path: ["condition"] });
});

export const returnRequestSchema = z.object({
  items: z.array(returnItemSchema).min(1, "Add at least one item.").max(MAX_RETURN_ITEMS),
  entryMethod: z.enum(entryMethods).default("MANUAL"),
  /** Offline entries: when it really happened on the device. */
  occurredAt: isoSchema.optional(),
  /** A client-saved key: a retry or an offline replay of the same sheet writes nothing twice. */
  idempotencyKey: keySchema.optional(),
}).strict().refine((value) => value.occurredAt === undefined || value.entryMethod === "OFFLINE", { message: "Only an offline entry can say when it happened.", path: ["occurredAt"] });
export type ReturnRequest = z.infer<typeof returnRequestSchema>;

export const depositActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
    /** The open issues the deposit covers: one holder's keys, all of one kind. */
    issuanceIds: z.array(idSchema).min(1, "Choose what the deposit covers.").max(MAX_RETURN_ITEMS),
    amountCents: z.number().int().min(1, "Enter the amount taken.").max(MAX_DEPOSIT_CENTS),
    reason: textSchema(300).default("Cash key deposit taken at check-in"),
    idempotencyKey: keySchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("settle"),
    depositEntryId: idSchema,
    note: textSchema(300).optional(),
    idempotencyKey: keySchema.optional(),
  }).strict(),
]);
export type DepositAction = z.infer<typeof depositActionSchema>;

export const chargeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("charge"),
    issuanceId: idSchema,
    category: z.enum(chargeCategories),
    amountCents: z.number().int().min(1, "Enter an amount.").max(MAX_CHARGE_CENTS),
    reason: reasonSchema,
    /** Post the charge to the registration (the existing adjustment path) so it shows in the balance. Off: recorded only. */
    post: z.boolean().default(true),
    /** A money manager's confirmation that a deposit already kept money for this loss: only the part above it is charged. */
    confirmKeptDeposit: z.boolean().default(false),
    idempotencyKey: keySchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("waive"),
    chargeEntryId: idSchema,
    reason: reasonSchema,
    idempotencyKey: keySchema.optional(),
  }).strict(),
]);
export type ChargeAction = z.infer<typeof chargeActionSchema>;

/** The closeout exceptions a person can mark reviewed. */
export const reviewableExceptionCodes = ["CORRECTION_NEEDS_REVIEW", "WAIVED_ON_INACTIVE_REGISTRATION", "WAIVED_AFTER_REFUND"] as const;
export type ReviewableExceptionCode = (typeof reviewableExceptionCodes)[number];

/**
 * How much of the money a deposit kept is still held: what it kept, less what was handed back late, less what posted and
 * unwaived charges already counted against it. Never below zero. The one definition: the charge offset, the late hand-back
 * cap, the desk, the closeout and the database guard (`AssetDeposit_held`) all mean exactly this.
 */
export function depositHeldCents(input: { keptCents: number; lateCents: number; offsetCents: number }) {
  return Math.max(0, input.keptCents - input.lateCents - input.offsetCents);
}

/** Corrections of a recorded outcome, and write-offs (#214): administrators and finance, with a reason. */
export const correctionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("correct"),
    issuanceId: idSchema,
    /** What really happened: a lost key found later is LOST to RETURNED. */
    fate: z.enum(returnOutcomes),
    reason: reasonSchema,
    idempotencyKey: keySchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("write_off"),
    issuanceId: idSchema,
    reason: reasonSchema,
    idempotencyKey: keySchema.optional(),
  }).strict(),
  /** Staff looked at a closeout exception on this issue (a correction after money was recorded, a waiver that left a line on a cancelled registration) and accept it. */
  z.object({
    action: z.literal("review"),
    issuanceId: idSchema,
    /** Which exception is being reviewed: a review clears only that one. */
    exceptionCode: z.enum(reviewableExceptionCodes),
    reason: reasonSchema,
    idempotencyKey: keySchema.optional(),
  }).strict(),
]);
export type CorrectionAction = z.infer<typeof correctionActionSchema>;

/** Cash handed back at the desk after a correction showed that what a kept deposit was kept for had come back. Recorded only; capped at what was kept. */
export const lateRefundSchema = z.object({
  action: z.literal("refund_after_correction"),
  depositEntryId: idSchema,
  amountCents: z.number().int().min(1, "Enter the amount handed back.").max(MAX_DEPOSIT_CENTS),
  reason: reasonSchema,
  idempotencyKey: keySchema.optional(),
}).strict();
export type LateRefund = z.infer<typeof lateRefundSchema>;

/** Keeping the replacement fee of a missing item needs a fee to keep. */
export function keepFeesNeedsFee(policy: string, replacementFeeCents: number) {
  return policy === "KEEP_FEES" && replacementFeeCents <= 0;
}

/** The fate an issuance has now: its recorded end, unless an administrator corrected it. A written-off replaced original is settled (neutral). */
export function effectiveEndReason(endReason: string | null, correctedFate: string | null, writtenOff: boolean) {
  const reason = correctedFate ?? endReason;
  return reason === "REPLACED" && writtenOff ? "TRANSFERRED" : reason;
}

const blockSchema = z.object({
  kind: z.enum(lodgingHoldKinds),
  reason: reasonSchema,
  firstNight: nightSchema,
  lastNight: nightSchema,
}).strict().refine((value) => value.lastNight >= value.firstNight, { message: "The last night cannot be before the first night.", path: ["lastNight"] });
export type FacilityBlockInput = z.infer<typeof blockSchema>;

export const facilityActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("report"),
    targetKind: z.enum(facilityTargetKinds),
    eventUnitId: idSchema.optional(),
    assetCode: z.string().trim().min(1).max(64).optional(),
    targetLabel: textSchema(120).optional(),
    title: z.string().trim().min(3, "Say what is wrong.").max(160),
    description: textSchema(1000).optional(),
    severity: z.enum(facilitySeverities).default("MEDIUM"),
    source: z.enum(facilitySources).default("REPORT"),
    sourceIssuanceId: idSchema.optional(),
    assigneeUserId: idSchema.optional(),
    /** Close the room or site for these nights (event administrators). It never changes an existing assignment. */
    block: blockSchema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.targetKind === "UNIT" && !value.eventUnitId) context.addIssue({ code: "custom", message: "Choose the room or site.", path: ["eventUnitId"] });
    if (value.targetKind === "ASSET" && !value.assetCode) context.addIssue({ code: "custom", message: "Give the item's code.", path: ["assetCode"] });
    if (value.targetKind === "OTHER" && !value.targetLabel) context.addIssue({ code: "custom", message: "Say what place or equipment it is.", path: ["targetLabel"] });
    if (value.block && value.targetKind !== "UNIT") context.addIssue({ code: "custom", message: "Only a room or site can be blocked.", path: ["block"] });
  }),
  z.object({
    action: z.literal("update"),
    issueId: idSchema,
    status: z.enum(facilityStatuses).optional(),
    severity: z.enum(facilitySeverities).optional(),
    /** An empty string clears the assignee. */
    assigneeUserId: z.string().trim().max(64).optional(),
    note: textSchema(500).optional(),
    /** Required to resolve or dismiss. */
    resolution: textSchema(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("block"),
    issueId: idSchema,
    block: blockSchema,
  }).strict(),
]);
export type FacilityAction = z.infer<typeof facilityActionSchema>;

// ---------------------------------------------------------------------------
// Deposit outcome
// ---------------------------------------------------------------------------

export type CoverState = "RETURNED" | "DAMAGED" | "LOST" | "OUTSTANDING" | "UNACCOUNTED" | "CORRECTED" | "CONTINUED";

/** How a deposit-covered issuance stands. A transfer continues into a covered successor; a replacement's original has no recorded fate. */
export function coverStateOf(row: { endedAt: Date | string | null; endReason: string | null }): CoverState {
  if (!row.endedAt) return "OUTSTANDING";
  switch (row.endReason) {
    case "RETURNED": return "RETURNED";
    case "DAMAGED": return "DAMAGED";
    case "LOST": return "LOST";
    case "CORRECTED": return "CORRECTED";
    case "TRANSFERRED": return "CONTINUED";
    case "REPLACED": return "UNACCOUNTED";
    default: return "UNACCOUNTED";
  }
}

export type DepositOutcomeInput = {
  depositCents: number;
  policy: DepositShortfall;
  replacementFeeCents: number;
  /** Every issuance the deposit covers, with the quantity its outcome applies to. */
  covers: ReadonlyArray<{ state: CoverState; quantity: number; /** A lost or damaged item that already has an unwaived charge: the deposit is not kept for it as well. */ charged?: boolean }>;
};

export type DepositOutcome =
  | { ok: false; code: "UNRESOLVED"; unresolved: number; message: string }
  | { ok: true; outcome: "FULL_REFUND" | "PARTIAL_REFUND" | "KEPT"; refundCents: number; keepCents: number; shortfallCents: number; missing: number; damaged: number; message: string };

/**
 * What happens to a cash deposit once every covered item is accounted for. The deposit is handed back in full only when
 * every covered item came back in good order. Otherwise the type's policy applies: keep it all, or keep the replacement
 * fee of each missing or damaged item (never more than the deposit) and hand back the rest. A fee above the deposit is
 * reported as a shortfall for staff to charge; it is never charged automatically. Items entered in error are not
 * counted either way (closeout lists them as an exception). While any covered item is still out or has no recorded
 * fate there is no outcome.
 */
export function decideDepositOutcome(input: DepositOutcomeInput): DepositOutcome {
  const unresolved = input.covers.filter((row) => row.state === "OUTSTANDING" || row.state === "UNACCOUNTED").reduce((sum, row) => sum + row.quantity, 0);
  if (unresolved > 0) {
    return { ok: false, code: "UNRESOLVED", unresolved, message: `${unresolved} covered item${unresolved === 1 ? " is" : "s are"} still out or without a recorded return, loss or damage.` };
  }
  const missing = input.covers.filter((row) => row.state === "LOST" && !row.charged).reduce((sum, row) => sum + row.quantity, 0);
  const damaged = input.covers.filter((row) => row.state === "DAMAGED" && !row.charged).reduce((sum, row) => sum + row.quantity, 0);
  const charged = input.covers.filter((row) => (row.state === "LOST" || row.state === "DAMAGED") && row.charged).reduce((sum, row) => sum + row.quantity, 0);
  if (missing + damaged === 0) {
    return {
      ok: true, outcome: "FULL_REFUND", refundCents: input.depositCents, keepCents: 0, shortfallCents: 0, missing, damaged,
      message: charged > 0
        ? `${charged} lost or damaged item${charged === 1 ? " is" : "s are"} already charged, so the deposit is not kept for ${charged === 1 ? "it" : "them"} as well: hand back the full deposit.`
        : "Every covered item came back in good order: hand back the full deposit.",
    };
  }
  const what = [missing > 0 ? `${missing} lost` : "", damaged > 0 ? `${damaged} damaged` : ""].filter(Boolean).join(" and ");
  if (input.policy === "KEEP_ALL") {
    return { ok: true, outcome: "KEPT", refundCents: 0, keepCents: input.depositCents, shortfallCents: 0, missing, damaged, message: `${what}: the deposit is kept in full.` };
  }
  const fees = (missing + damaged) * input.replacementFeeCents;
  const keep = Math.min(input.depositCents, fees);
  const refund = input.depositCents - keep;
  const shortfall = Math.max(0, fees - input.depositCents);
  return {
    ok: true,
    outcome: refund > 0 ? "PARTIAL_REFUND" : "KEPT",
    refundCents: refund, keepCents: keep, shortfallCents: shortfall, missing, damaged,
    message: `${what}: keep ${formatCents(keep)} toward replacement${refund > 0 ? ` and hand back ${formatCents(refund)}` : ""}.${shortfall > 0 ? ` The fee is ${formatCents(shortfall)} more than the deposit; charge it separately if it should be collected.` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Return decisions
// ---------------------------------------------------------------------------

export type ReturnItemErrorCode =
  | "ASSET_NOT_FOUND"
  | "ISSUANCE_NOT_FOUND"
  | "NOT_OUT"
  | "AMBIGUOUS_HOLDER"
  | "QUANTITY_INVALID"
  | "OCCURRED_AT_INVALID"
  | "DUPLICATE_IN_REQUEST"
  | "REPLACEMENT_INVALID"
  | "IDEMPOTENCY_KEY_REUSED";

/** A numbered item is returned whole; a lot may be returned in part (the rest stays out as a new issue). */
export function resolveReturnQuantity(issued: number, serialized: boolean, requested: number | undefined):
  | { ok: true; quantity: number; remainder: number }
  | { ok: false; message: string } {
  if (serialized) {
    if (requested !== undefined && requested !== 1) return { ok: false, message: "A numbered item is returned one at a time." };
    return { ok: true, quantity: 1, remainder: 0 };
  }
  const quantity = requested ?? issued;
  if (quantity > issued) return { ok: false, message: `Only ${issued} ${issued === 1 ? "is" : "are"} out for this holder.` };
  return { ok: true, quantity, remainder: issued - quantity };
}

/** What a returned condition does to the stock record. Lost and damaged numbered items are held out of stock. */
export function stockAfterReturn(outcome: ReturnOutcome, condition: AssetCondition | undefined): { condition?: AssetCondition; unavailable: boolean } {
  if (outcome === "LOST") return { unavailable: true };
  if (outcome === "DAMAGED") return { condition: "DAMAGED", unavailable: true };
  return condition ? { condition, unavailable: false } : { unavailable: false };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type UnitCounts = {
  /** New items put in someone's hands: ISSUED plus the REPLACED_IN of a replacement (a transfer or a remainder only continues one). */
  inflow: number;
  returned: number;
  lost: number;
  damaged: number;
  corrected: number;
  /** Originals of a replacement made without recording what became of them. */
  replacedUnaccounted: number;
  outstanding: number;
};

/** Every unit that went out is out, back, lost, damaged, withdrawn in error or an unaccounted original: nothing else. */
export function reconcileUnits(counts: UnitCounts) {
  const accounted = counts.returned + counts.lost + counts.damaged + counts.corrected + counts.replacedUnaccounted + counts.outstanding;
  return { accounted, difference: counts.inflow - accounted, balanced: counts.inflow === accounted };
}

/** The history types that count toward each side of the reconciliation. */
export function unitCountsFromHistory(rows: ReadonlyArray<{ type: string; quantity: number }>, outstanding: number): UnitCounts {
  const sum = (...types: string[]) => rows.filter((row) => types.includes(row.type)).reduce((total, row) => total + row.quantity, 0);
  return {
    inflow: sum("ISSUED", "REPLACED_IN"),
    returned: sum("RETURNED"),
    lost: sum("LOST"),
    damaged: sum("DAMAGED"),
    corrected: sum("CORRECTED"),
    replacedUnaccounted: sum("REPLACED_OUT"),
    outstanding,
  };
}

export type FateStep = { from: string; to: string; quantity: number };

/**
 * Moves units between buckets for each correction of a recorded outcome: what the ended issue first said, then what an
 * administrator corrected it to. Written-off originals of a replacement stay in the replaced bucket (the loss was written
 * off, not found).
 */
export function applyOutcomeCorrections(counts: UnitCounts, steps: ReadonlyArray<FateStep>): UnitCounts {
  const next = { ...counts };
  const bucket = (fate: string): keyof UnitCounts | null => (fate === "RETURNED" ? "returned" : fate === "LOST" ? "lost" : fate === "DAMAGED" ? "damaged" : fate === "REPLACED" ? "replacedUnaccounted" : null);
  for (const step of steps) {
    const from = bucket(step.from);
    const to = bucket(step.to);
    if (from) next[from] -= step.quantity;
    if (to) next[to] += step.quantity;
  }
  return next;
}
