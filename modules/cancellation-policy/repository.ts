import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { currentPricingSnapshot } from "@/modules/club-registrations/per-person-price";
import {
  calculateCancellation,
  selectPolicyVersion,
  type CalculationFacts,
  type CancellationResult,
  type CancellationSelection,
  type ChargeEntry,
  type PolicyVersionRecord,
} from "@/modules/cancellation-policy/calculator";
import {
  cancellationRulesSchema,
  cancellationScopes,
  chargeCategories,
  parseCancellationRules,
  RULES_SCHEMA_VERSION,
  type CancellationRules,
} from "@/modules/cancellation-policy/rules";
import { isValidTimeZone } from "@/modules/cancellation-policy/event-time";
import { appliedCardSurchargeCents } from "@/modules/payments/applied-surcharge";
import { depositConfigurationFromValue, netPaidCents } from "@/modules/payments/deposit-domain";
import { forfeitableDeposit } from "@/modules/cancellation-policy/deposit-facts";

/**
 * Storage and fact-gathering for cancellation policy (#169).
 *
 * Everything here either reads, or appends an immutable row to `EventCancellationPolicyVersion` /
 * `CancellationCalculation`. Nothing writes to payments, refunds, registrations, attendees, capacity or any ledger,
 * and nothing calls a payment provider. Cancelling, refunding and issuing credit are later slices (#170, #171).
 */

export class CancellationPolicyError extends Error {
  constructor(
    public readonly code:
      | "EVENT_NOT_FOUND"
      | "REGISTRATION_NOT_FOUND"
      | "EFFECTIVE_DATE_IN_PAST"
      | "EFFECTIVE_DATE_BEFORE_LATEST"
      | "TIMEZONE_INVALID"
      | "VERSION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "CancellationPolicyError";
  }
}

type Client = Prisma.TransactionClient;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cents(value: { toString(): string } | number) {
  return Math.round(Number(value) * 100);
}

// ---------------------------------------------------------------------------------------------------------------------
// Policy versions
// ---------------------------------------------------------------------------------------------------------------------

/** How far back an effective date may reach. A little slack covers a form submitted at the moment of the click. */
export const EFFECTIVE_FROM_SLACK_MS = 5 * 60 * 1000;

export const createPolicyVersionSchema = z.object({
  rules: z.unknown(),
  /** ISO timestamp; defaults to now. May not be earlier than now, so a new version never reaches back over past days. */
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();
export type CreatePolicyVersionInput = z.infer<typeof createPolicyVersionSchema>;

export type PolicyVersionView = {
  id: string;
  version: number;
  effectiveFrom: string;
  createdAt: string;
  createdByName: string;
  note: string | null;
  rules: CancellationRules | null;
  /** True when the stored rules no longer parse under the current schema; the version is then ignored by calculations. */
  unreadable: boolean;
};

function toRecord(row: { id: string; version: number; effectiveFrom: Date; rules: unknown }): PolicyVersionRecord | null {
  const parsed = cancellationRulesSchema.safeParse(row.rules);
  if (!parsed.success) return null;
  return { id: row.id, version: row.version, effectiveFrom: row.effectiveFrom, rules: parsed.data };
}

async function loadEvent(client: Pick<Client, "event">, eventId: string) {
  const event = await client.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, timezone: true, startsAt: true } });
  if (!event) throw new CancellationPolicyError("EVENT_NOT_FOUND", "That event could not be found.");
  return event;
}

export async function listPolicyVersions(eventId: string, now = new Date()) {
  const rows = await getPrisma().eventCancellationPolicyVersion.findMany({
    where: { eventId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, effectiveFrom: true, rules: true, note: true, createdAt: true, createdByNameSnapshot: true },
  });
  const views: PolicyVersionView[] = rows.map((row) => {
    const parsed = toRecord(row);
    return {
      id: row.id,
      version: row.version,
      effectiveFrom: row.effectiveFrom.toISOString(),
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdByNameSnapshot,
      note: row.note,
      rules: parsed?.rules ?? null,
      unreadable: !parsed,
    };
  });
  const usable = rows.flatMap((row) => { const parsed = toRecord(row); return parsed ? [parsed] : []; });
  const inEffect = selectPolicyVersion(usable, now);
  return { versions: views, inEffectVersionId: inEffect?.id ?? null };
}

async function usablePolicyVersions(client: Pick<Client, "eventCancellationPolicyVersion">, eventId: string) {
  const rows = await client.eventCancellationPolicyVersion.findMany({
    where: { eventId },
    select: { id: true, version: true, effectiveFrom: true, rules: true },
  });
  return rows.flatMap((row) => { const parsed = toRecord(row); return parsed ? [parsed] : []; });
}

/**
 * Appends the next version of an event's rules. Versions are never edited: to change a rule, save another. It does not
 * touch any registration, payment or earlier calculation.
 */
export async function createPolicyVersion(
  eventId: string,
  actorUserId: string,
  input: CreatePolicyVersionInput,
  now = new Date(),
) {
  const rules = parseCancellationRules(input.rules);
  const requested = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
  if (requested.getTime() < now.getTime() - EFFECTIVE_FROM_SLACK_MS) {
    throw new CancellationPolicyError(
      "EFFECTIVE_DATE_IN_PAST",
      "A new version cannot take effect in the past. Choose now or a later time; earlier cancellations keep the version they were calculated with.",
    );
  }
  // Never earlier than the server's now, so a version cannot reach back over a moment already calculated against.
  const effectiveFrom = requested.getTime() < now.getTime() ? now : requested;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await getPrisma().$transaction(async (tx) => {
        await loadEvent(tx, eventId);
        const latest = await tx.eventCancellationPolicyVersion.findFirst({ where: { eventId }, orderBy: { version: "desc" }, select: { version: true, effectiveFrom: true } });
        // A higher version supersedes every lower one once it takes effect, so a future-dated version must not be
        // earlier than the latest one's date (that would silently cut it short). Taking effect now is always allowed:
        // that is how a correction replaces a future-dated mistake immediately and permanently.
        if (latest && effectiveFrom.getTime() > now.getTime() && effectiveFrom.getTime() < latest.effectiveFrom.getTime()) {
          throw new CancellationPolicyError(
            "EFFECTIVE_DATE_BEFORE_LATEST",
            "A new version cannot take effect earlier than the latest saved version (a higher version always replaces the lower ones). Choose a date on or after it, or save it to take effect now.",
          );
        }
        const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { displayName: true } });
        const created = await tx.eventCancellationPolicyVersion.create({
          data: {
            eventId,
            version: (latest?.version ?? 0) + 1,
            effectiveFrom,
            rulesSchema: RULES_SCHEMA_VERSION,
            rules: rules as unknown as Prisma.InputJsonValue,
            note: input.note || null,
            createdByUserId: actorUserId,
            createdByNameSnapshot: actor?.displayName ?? "Staff",
          },
          select: { id: true, version: true, effectiveFrom: true },
        });
        await writeAuditLog({
          eventId,
          actorUserId,
          action: "CANCELLATION_POLICY_VERSION_ADDED",
          entityType: "EventCancellationPolicyVersion",
          entityId: created.id,
          summary: `Saved cancellation policy version ${created.version}.`,
          metadata: { version: created.version, effectiveFrom: created.effectiveFrom.toISOString(), windows: rules.windows.length },
        }, tx);
        return { id: created.id, version: created.version, effectiveFrom: created.effectiveFrom.toISOString() };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
      if (!retryable) throw error;
      if (attempt === 2) throw new CancellationPolicyError("VERSION_CONFLICT", "Another version was saved at the same moment. Try again.");
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------------------------------

export const syntheticInputSchema = z.object({
  kind: z.literal("SYNTHETIC"),
  attendeeCount: z.number().int().min(0).max(30),
  charges: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    amountCents: z.number().int().min(-100_000_000).max(100_000_000),
    category: z.enum(chargeCategories).default("REGISTRATION"),
    fieldKey: z.string().trim().min(1).max(80).optional(),
    /** 1-based; the charge belongs to that synthetic attendee. */
    attendeeNumber: z.number().int().min(1).max(30).optional(),
    settledSeparately: z.boolean().optional(),
  }).strict()).max(60),
  paidCents: z.number().int().min(0).max(1_000_000_000),
  depositCents: z.number().int().min(0).max(1_000_000_000).default(0),
  noShowFirstNight: z.boolean().default(false),
}).strict();

export const registrationInputSchema = z.object({
  kind: z.literal("REGISTRATION"),
  /** The registration's id or its confirmation code, within this event. */
  registration: z.string().trim().min(1).max(64),
  noShowFirstNight: z.boolean().default(false),
}).strict();

export const previewRequestSchema = z.object({
  input: z.discriminatedUnion("kind", [registrationInputSchema, syntheticInputSchema]),
  selection: z.object({
    scope: z.enum(cancellationScopes),
    attendeeIds: z.array(z.string().trim().min(1).max(64)).max(60).optional(),
    chargeIds: z.array(z.string().trim().min(1).max(120)).max(120).optional(),
  }).strict(),
  /** Preview only: evaluate as of another moment (ISO timestamp) to see how the rules change over time. */
  asOf: z.string().datetime({ offset: true }).optional(),
}).strict();
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

function fieldKeyOf(key: string) {
  return key.replace(/^attendees\.\d+\./, "");
}

function personName(attendee: { profileSnapshot: unknown; person: { firstName: string; lastName: string } }) {
  const profile = record(attendee.profileSnapshot);
  const first = typeof profile.firstName === "string" ? profile.firstName : attendee.person.firstName;
  const last = typeof profile.lastName === "string" ? profile.lastName : attendee.person.lastName;
  return `${first} ${last}`.trim();
}

const adjustmentKindWords: Record<string, string> = {
  SCHOLARSHIP: "Scholarship",
  DISCOUNT: "Discount",
  PROMO_CODE: "Promo code",
  CORRECTION: "Correction",
};

async function loadRegistrationRows(client: Client, eventId: string, reference: string) {
  return client.registration.findFirst({
    where: { eventId, OR: [{ id: reference }, { confirmationCode: reference.toUpperCase() }] },
    select: {
      id: true,
      confirmationCode: true,
      status: true,
      totalAmount: true,
      attendees: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, position: true, profileSnapshot: true, person: { select: { firstName: true, lastName: true } } },
      },
      publicFormSubmission: { select: { pricingSnapshot: true, formVersion: { select: { definition: true } } } },
      operations: { where: { type: "AMENDMENT" }, orderBy: { createdAt: "desc" }, take: 1, select: { afterSnapshot: true } },
      paymentChoiceOperations: { orderBy: { sequence: "desc" }, take: 1, select: { processingFeeCents: true } },
      payments: {
        where: { status: "SUCCEEDED" },
        select: {
          amount: true,
          isDeposit: true,
          refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } },
          paymentAttempt: { select: { surchargeCents: true, duplicateReason: true } },
        },
      },
      adjustments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        // The free-text reason is deliberately not read: it can hold personal detail and does not belong in a calculation.
        select: { id: true, kind: true, amountCents: true, registrationAttendeeId: true },
      },
      merchandiseOrders: {
        where: { status: "PAID" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, feeCents: true, taxCents: true,
          lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, productNameSnapshot: true, variantLabelSnapshot: true, quantity: true, lineTotalCents: true } },
        },
      },
    },
  });
}

type RegistrationRows = NonNullable<Awaited<ReturnType<typeof loadRegistrationRows>>>;

/**
 * The original charge entries of a registration, in a fixed order, adding up to what the registration was charged:
 * the priced form lines (latest amendment's, else the submission's), the card processing fee, card fees applied when a
 * pay-later balance or deposit was paid by card, staff and promo adjustments, and merchandise orders paid for this
 * registration. Anything the itemization does not explain is one explicit line, never silently dropped.
 */
function buildCharges(registration: RegistrationRows, appliedSurchargeCents: number): ChargeEntry[] {
  const snapshot = currentPricingSnapshot(registration);
  const attendeeIds = registration.attendees.map((attendee) => attendee.id);
  const charges: ChargeEntry[] = [];
  const seen = new Map<string, number>();
  const rawLines = Array.isArray(snapshot.lineItems) ? snapshot.lineItems.map(record) : [];
  for (const line of rawLines) {
    if (typeof line.label !== "string" || typeof line.amountCents !== "number" || !Number.isFinite(line.amountCents)) continue;
    const key = typeof line.key === "string" ? line.key : line.label;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const attendeeIndex = typeof line.attendeeIndex === "number" ? line.attendeeIndex : null;
    charges.push({
      id: count === 1 ? `line:${key}` : `line:${key}#${count}`,
      source: "PRICING_LINE",
      label: line.label,
      amountCents: Math.round(line.amountCents),
      category: "REGISTRATION",
      fieldKey: fieldKeyOf(key),
      attendeeId: attendeeIndex !== null ? attendeeIds[attendeeIndex] ?? null : null,
    });
  }
  const choiceFee = registration.paymentChoiceOperations[0]?.processingFeeCents;
  const feeCents = typeof choiceFee === "number" ? choiceFee : typeof snapshot.processingFeeCents === "number" ? Math.round(snapshot.processingFeeCents) : 0;
  if (feeCents > 0) {
    charges.push({ id: "fee:processing", source: "PRICING_FEE", label: "Card processing fee", amountCents: feeCents, category: "FEE", fieldKey: null, attendeeId: null });
  }
  if (appliedSurchargeCents > 0) {
    charges.push({ id: "fee:applied-surcharge", source: "APPLIED_SURCHARGE", label: "Card processing fee on a card payment", amountCents: appliedSurchargeCents, category: "FEE", fieldKey: null, attendeeId: null });
  }
  for (const adjustment of registration.adjustments) {
    charges.push({
      id: `adjustment:${adjustment.id}`,
      source: "ADJUSTMENT",
      label: `${adjustmentKindWords[adjustment.kind] ?? "Adjustment"} (adjustment)`,
      amountCents: adjustment.amountCents,
      category: "ADJUSTMENT",
      fieldKey: null,
      attendeeId: adjustment.registrationAttendeeId && attendeeIds.includes(adjustment.registrationAttendeeId) ? adjustment.registrationAttendeeId : null,
    });
  }
  // What the stored total holds that the lines above do not explain (a registration entered without itemized pricing,
  // or a discount applied to the whole registration at checkout). Shown, so the lines always add up to the total.
  const explained = charges.reduce((total, entry) => total + entry.amountCents, 0);
  const residual = cents(registration.totalAmount) - explained;
  if (residual !== 0) {
    charges.push({
      id: "other:unitemized",
      source: "UNRECONCILED",
      label: residual > 0 ? "Registration charges (not itemized)" : "Adjustments (not itemized)",
      amountCents: residual,
      category: residual > 0 ? (rawLines.length === 0 ? "REGISTRATION" : "OTHER") : "ADJUSTMENT",
      fieldKey: null,
      attendeeId: null,
    });
  }
  for (const order of registration.merchandiseOrders) {
    for (const line of order.lines) {
      charges.push({
        id: `merchandise:${line.id}`,
        source: "MERCHANDISE_ORDER",
        label: `${line.productNameSnapshot} (${line.variantLabelSnapshot}) x${line.quantity}`,
        amountCents: line.lineTotalCents,
        category: "MERCHANDISE",
        fieldKey: null,
        attendeeId: null,
        settledSeparately: true,
        moneySourceId: `merchandise-order:${order.id}`,
      });
    }
    if (order.feeCents > 0) charges.push({ id: `merchandise-fee:${order.id}`, source: "MERCHANDISE_ORDER", label: "Merchandise order fee", amountCents: order.feeCents, category: "MERCHANDISE", fieldKey: null, attendeeId: null, settledSeparately: true, moneySourceId: `merchandise-order:${order.id}` });
    if (order.taxCents > 0) charges.push({ id: `merchandise-tax:${order.id}`, source: "MERCHANDISE_ORDER", label: "Merchandise order tax", amountCents: order.taxCents, category: "MERCHANDISE", fieldKey: null, attendeeId: null, settledSeparately: true, moneySourceId: `merchandise-order:${order.id}` });
  }
  return charges;
}

function depositFacts(registration: RegistrationRows) {
  const config = depositConfigurationFromValue(registration.publicFormSubmission?.formVersion.definition);
  return forfeitableDeposit({
    configuredCents: config?.amountCents ?? null,
    totalCents: cents(registration.totalAmount),
    payments: registration.payments.map((payment) => ({
      isDeposit: payment.isDeposit,
      amountCents: Math.max(cents(payment.amount), 0),
      refundedCents: payment.refunds.reduce((sum, refund) => sum + Math.max(cents(refund.amount), 0), 0),
      surchargeCents: payment.paymentAttempt && !payment.paymentAttempt.duplicateReason ? payment.paymentAttempt.surchargeCents : 0,
    })),
  });
}

export type RegistrationSummary = {
  id: string;
  confirmationCode: string;
  status: string;
  attendees: Array<{ id: string; name: string }>;
  charges: Array<{ id: string; label: string; category: string; amountCents: number }>;
};

type PreparedInput = { facts: CalculationFacts; summary: RegistrationSummary | null };

async function prepareRegistrationFacts(
  client: Client,
  event: { id: string; timezone: string },
  input: z.infer<typeof registrationInputSchema>,
  evaluatedAt: Date,
  clock: CalculationFacts["clock"],
): Promise<PreparedInput> {
  const registration = await loadRegistrationRows(client, event.id, input.registration);
  if (!registration) throw new CancellationPolicyError("REGISTRATION_NOT_FOUND", "That registration could not be found in this event.");
  const appliedSurchargeCents = await appliedCardSurchargeCents(client, registration.id);
  const charges = buildCharges(registration, appliedSurchargeCents);
  const deposit = depositFacts(registration);
  const facts: CalculationFacts = {
    evaluatedAt: evaluatedAt.toISOString(),
    clock,
    eventTimezone: event.timezone,
    registration: { id: registration.id, confirmationCode: registration.confirmationCode, status: registration.status },
    attendees: registration.attendees.map((attendee) => ({ id: attendee.id, position: attendee.position })),
    charges,
    registrationPaidCents: netPaidCents(registration.payments),
    depositCents: deposit.cents,
    depositSource: deposit.source,
    noShowFirstNight: input.noShowFirstNight,
  };
  return {
    facts,
    summary: {
      id: registration.id,
      confirmationCode: registration.confirmationCode,
      status: registration.status,
      attendees: registration.attendees.map((attendee) => ({ id: attendee.id, name: personName(attendee) })),
      charges: charges.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category, amountCents: entry.amountCents })),
    },
  };
}

function prepareSyntheticFacts(
  event: { timezone: string },
  input: z.infer<typeof syntheticInputSchema>,
  evaluatedAt: Date,
  clock: CalculationFacts["clock"],
): PreparedInput {
  const attendees = Array.from({ length: input.attendeeCount }, (_, index) => ({ id: `synthetic-attendee-${index + 1}`, position: index }));
  const charges: ChargeEntry[] = input.charges.map((charge, index) => ({
    id: `synthetic:${index + 1}`,
    source: "SYNTHETIC",
    label: charge.label,
    amountCents: charge.amountCents,
    category: charge.category,
    fieldKey: charge.fieldKey ?? null,
    attendeeId: charge.attendeeNumber ? attendees[charge.attendeeNumber - 1]?.id ?? null : null,
    ...(charge.settledSeparately ? { settledSeparately: true } : {}),
  }));
  return {
    facts: {
      evaluatedAt: evaluatedAt.toISOString(),
      clock,
      eventTimezone: event.timezone,
      registration: null,
      attendees,
      charges,
      registrationPaidCents: input.paidCents,
      depositCents: input.depositCents,
      depositSource: input.depositCents > 0 ? "RECORDED_DEPOSIT" : "NONE",
      noShowFirstNight: input.noShowFirstNight,
    },
    summary: null,
  };
}

export type PreviewResponse = {
  result: CancellationResult;
  registration: RegistrationSummary | null;
  /** Echoes what the preview did not do, for the staff screen. */
  recorded: false;
};

/**
 * Staff preview (#169): runs the calculator against one authorized registration of this event, or synthetic input.
 * Read-only: it writes nothing, not even a calculation record. The only registration data returned is the chosen
 * registration's own attendees and charges, which the screen needs to pick a scope.
 */
export async function previewCancellation(eventId: string, request: PreviewRequest, now = new Date()): Promise<PreviewResponse> {
  const db = getPrisma();
  const event = await loadEvent(db, eventId);
  if (!isValidTimeZone(event.timezone)) throw new CancellationPolicyError("TIMEZONE_INVALID", "This event's time zone is not valid, so deadlines cannot be evaluated.");
  const evaluatedAt = request.asOf ? new Date(request.asOf) : now;
  const clock = request.asOf ? "STAFF_PREVIEW_OVERRIDE" : "SERVER";
  const prepared = request.input.kind === "REGISTRATION"
    ? await prepareRegistrationFacts(db, event, request.input, evaluatedAt, clock)
    : prepareSyntheticFacts(event, request.input, evaluatedAt, clock);
  const policyVersions = await usablePolicyVersions(db, eventId);
  const result = calculateCancellation({ facts: prepared.facts, selection: request.selection as CancellationSelection, policyVersions });
  return { result, registration: prepared.summary, recorded: false };
}

/**
 * Calculates on the server clock and appends the calculation to the record, exactly as calculated: the policy version,
 * the rules it copied and the facts it used. For the later request and review slices to cite; it cancels nothing,
 * refunds nothing and creates no credit. A preview-only "as of" time is ignored here: a recorded calculation always
 * uses server time. The caller supplies the request, never a result, so a stored outcome is always one the calculator
 * produced.
 */
export async function recordCancellationCalculation(eventId: string, actorUserId: string, request: Omit<PreviewRequest, "asOf">) {
  return recordCalculationAt(eventId, actorUserId, request, new Date());
}

/** Test seam for the real-database check, which needs fixed times. Callers in the app use `recordCancellationCalculation`. */
export async function recordCalculationAt(
  eventId: string,
  actorUserId: string,
  request: Omit<PreviewRequest, "asOf">,
  now: Date,
) {
  const { result } = await previewCancellation(eventId, { ...request, asOf: undefined }, now);
  const db = getPrisma();
  const row = await db.$transaction(async (tx) => {
    const created = await tx.cancellationCalculation.create({
      data: {
        eventId,
        registrationId: result.facts.registration?.id ?? null,
        policyVersionId: result.policy?.versionId ?? null,
        policyVersion: result.policy?.version ?? null,
        source: request.input.kind,
        status: result.status,
        scope: result.scope?.requested ?? request.selection.scope,
        evaluatedAt: new Date(result.evaluatedAt),
        facts: result.facts as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        createdByUserId: actorUserId,
      },
      select: { id: true, createdAt: true },
    });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "CANCELLATION_CALCULATION_RECORDED",
      entityType: "CancellationCalculation",
      entityId: created.id,
      summary: `Recorded a cancellation calculation (${result.status}).`,
      metadata: {
        registrationId: result.facts.registration?.id ?? null,
        policyVersion: result.policy?.version ?? null,
        refundCents: result.money.refundCents,
        sideEffects: "NONE",
      },
    }, tx);
    return created;
  });
  return { id: row.id, createdAt: row.createdAt.toISOString(), result };
}

export async function getRecordedCalculation(eventId: string, calculationId: string) {
  return getPrisma().cancellationCalculation.findFirst({ where: { id: calculationId, eventId } });
}

export type { PolicyVersionRecord };
export type { CancellationRules };
