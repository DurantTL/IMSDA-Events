import "server-only";

import { Prisma, type MealChangeType, type MealSettlement } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { AdjustmentError, postMealAdjustment } from "@/modules/registrations/adjustments";
import {
  cancellationEntries,
  countsTowardCapacity,
  isLiveRegistrationStatus,
  chargeEntry,
  creditEntry,
  diffFormTickets,
  mealCancelInputSchema,
  mealChangePlanInputSchema,
  mealChangeQuantityInputSchema,
  mealEntitleInputSchema,
  mealOrderInputSchema,
  mealSubstituteInputSchema,
  mealTypeCoverage,
  quantityChangeEntries,
  resolveMealPrice,
  serviceCoverage,
  ticketQuantitiesFromAnswers,
  type LedgerDraft,
  type MealAgeGroupValue,
  type MealEntitlementValue,
  type MealPayerValue,
  type MealTypeValue,
  type PlanServiceRow,
  type PlanShape,
  type PriceRow,
  type PriceRule,
  type ResolvedPrice,
  type ServiceShape,
} from "@/modules/meals/domain";
import { MealError, type MealErrorCode } from "@/modules/meals/errors";
import { serviceSnapshot } from "@/modules/meals/config-repository";

/**
 * Meal selections and the meal ledger (#210).
 *
 * A selection is what was ordered or entitled; it is never a redemption (#211) or a preparation count (#212). Every
 * change to one is a row in EventMealSelectionChange (before and after) and zero or more rows in the append-only
 * EventMealLedgerEntry. Price, plan and payer are copied onto the selection when it is made, so a later price edit
 * never rewrites it, and a cancellation credits what was charged. Where the money lands (`settlement`):
 * - a registration form ticket was priced by the form, so its entries are IN_REGISTRATION_PRICING;
 * - a staff order for a registration posts a MEAL adjustment line (the registration total moves, never below what was
 *   paid), so REGISTRATION_ADJUSTMENT;
 * - a walk-up order has no registration and is settled AT_COUNTER by staff. No payment is ever taken here.
 * A conference-paid selection never charges the attendee; it records the rate the conference is billed per meal used.
 */

type Tx = Prisma.TransactionClient;

async function mealTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await getPrisma().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000, maxWait: 10_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
}

type Actor = { userId: string | null; name: string };

async function actorFor(tx: Tx, userId: string | null, fallback = "Registration form"): Promise<Actor> {
  if (!userId) return { userId: null, name: fallback };
  const user = await tx.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return { userId, name: user?.displayName ?? "Staff" };
}

type SelectionRow = Prisma.EventMealSelectionGetPayload<{ include: { attendee: { select: { attendeeTypeDefinitionId: true } } } }>;

function view(selection: { status: string; quantity: number; unitPriceCents: number; planId: string; payer: string; mealType: string; serviceId: string | null; ageGroup: string; registrationId: string | null; registrationAttendeeId?: string | null }) {
  return {
    status: selection.status, quantity: selection.quantity, unitPriceCents: selection.unitPriceCents, planId: selection.planId, payer: selection.payer,
    mealType: selection.mealType, serviceId: selection.serviceId, ageGroup: selection.ageGroup, registrationId: selection.registrationId,
    registrationAttendeeId: selection.registrationAttendeeId ?? null,
  };
}



async function loadServices(tx: Tx, eventId: string) {
  return tx.eventMealService.findMany({ where: { eventId }, select: { id: true, mealType: true, ticketing: true, status: true, name: true, serviceDate: true, capacity: true } });
}

async function loadPlan(tx: Tx, eventId: string, planId: string) {
  const plan = await tx.eventMealPlan.findFirst({
    where: { id: planId, eventId },
    include: { services: { select: { serviceId: true, entitlement: true } }, prices: { select: { id: true, mealType: true, ageGroup: true, attendeeTypeId: true, amountCents: true } } },
  });
  if (!plan) throw new MealError("PLAN_NOT_FOUND", "That meal plan does not exist.");
  return plan;
}

type LoadedPlan = Awaited<ReturnType<typeof loadPlan>>;

function planShape(plan: LoadedPlan): PlanShape {
  return { id: plan.id, payer: plan.payer, includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, isActive: plan.isActive };
}
function planRows(plan: LoadedPlan): PlanServiceRow[] {
  return plan.services.map((row) => ({ serviceId: row.serviceId, entitlement: row.entitlement }));
}
function planPrices(plan: LoadedPlan): PriceRow[] {
  return plan.prices.map((row) => ({ id: row.id, mealType: row.mealType, ageGroup: row.ageGroup, attendeeTypeId: row.attendeeTypeId, amountCents: row.amountCents }));
}

async function lockRegistration(tx: Tx, eventId: string, registrationId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status"::text AS "status" FROM "Registration" WHERE "id" = ${registrationId} AND "eventId" = ${eventId} FOR UPDATE`;
  if (!rows[0]) throw new MealError("REGISTRATION_NOT_FOUND", "That registration does not exist.");
  return rows[0].status;
}

async function lockService(tx: Tx, eventId: string, serviceId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "EventMealService" WHERE "id" = ${serviceId} AND "eventId" = ${eventId} FOR UPDATE`;
  if (!rows[0]) throw new MealError("SERVICE_NOT_FOUND", "That meal service does not exist.");
}

async function assertCapacity(tx: Tx, service: { id: string; name: string; capacity: number | null }, addQuantity: number) {
  if (service.capacity === null || addQuantity <= 0) return;
  const taken = await tx.eventMealSelection.aggregate({ where: { serviceId: service.id, ...countsTowardCapacity }, _sum: { quantity: true } });
  const used = taken._sum.quantity ?? 0;
  if (used + addQuantity > service.capacity) {
    throw new MealError("CAPACITY_FULL", `${service.name} has ${Math.max(0, service.capacity - used)} of ${service.capacity} meals left.`);
  }
}

function adjustmentError(error: unknown): never {
  if (error instanceof AdjustmentError) throw new MealError(error.code as MealErrorCode, error.message);
  throw error;
}

type EntryInput = {
  draft: LedgerDraft;
  selection: { id: string; mealType: MealTypeValue; ageGroup: MealAgeGroupValue; serviceId: string | null; payer: MealPayerValue; registrationId: string | null; registrationAttendeeId: string | null };
  settlement: MealSettlement;
  reason: string;
};

/** Writes ledger entries for a change, charges first so a substitution never dips the registration below what it paid. */
async function postEntries(tx: Tx, eventId: string, changeId: string, actor: Actor, entries: EntryInput[], options: { skipBelowPaidCheck?: boolean } = {}) {
  const ordered = [...entries].sort((a, b) => b.draft.amountCents - a.draft.amountCents);
  for (const entry of ordered) {
    let adjustmentId: string | null = null;
    if (entry.settlement === "REGISTRATION_ADJUSTMENT" && entry.selection.registrationId) {
      try {
        adjustmentId = await postMealAdjustment(tx, {
          eventId, registrationId: entry.selection.registrationId, actorUserId: actor.userId, amountCents: entry.draft.amountCents,
          reason: entry.reason.length >= 3 ? entry.reason.slice(0, 500) : "Meal order change", attendeeId: entry.selection.registrationAttendeeId,
          skipBelowPaidCheck: options.skipBelowPaidCheck,
        });
      } catch (error) {
        adjustmentError(error);
      }
    }
    await tx.eventMealLedgerEntry.create({
      data: {
        eventId, selectionId: entry.selection.id, changeId, registrationId: entry.selection.registrationId, serviceId: entry.selection.serviceId,
        mealType: entry.selection.mealType, ageGroup: entry.selection.ageGroup, kind: entry.draft.kind, quantity: entry.draft.quantity,
        unitPriceCents: entry.draft.unitPriceCents, amountCents: entry.draft.amountCents, payer: entry.selection.payer, settlement: entry.settlement,
        registrationAdjustmentId: adjustmentId, reason: entry.reason.slice(0, 500),
      },
    });
  }
}

async function recordChange(tx: Tx, eventId: string, actor: Actor, input: {
  selectionId: string; type: MealChangeType; reason: string | null; before: object | null; after: object;
}) {
  return tx.eventMealSelectionChange.create({
    data: {
      eventId, selectionId: input.selectionId, type: input.type, actorUserId: actor.userId, actorName: actor.name, reason: input.reason,
      before: input.before ?? Prisma.JsonNull, after: input.after,
    },
  });
}

function pricingSnapshot(input: {
  plan: LoadedPlan; price: ResolvedPrice | { unitPriceCents: number; conferenceRateCents: 0; rule: PriceRule; priceRowId: null };
  mealType: MealTypeValue; ageGroup: MealAgeGroupValue; attendeeTypeCode: string | null; service: { id: string; name: string; serviceDate: string } | null;
  formVersionId?: string; fieldKey?: string;
}) {
  return {
    planId: input.plan.id, planCode: input.plan.code, planName: input.plan.name, payer: input.plan.payer, rule: input.price.rule,
    priceRowId: input.price.priceRowId, unitPriceCents: input.price.unitPriceCents, conferenceRateCents: input.price.conferenceRateCents,
    mealType: input.mealType, ageGroup: input.ageGroup, attendeeTypeCode: input.attendeeTypeCode,
    service: input.service ? { id: input.service.id, name: input.service.name, serviceDate: input.service.serviceDate } : null,
    ...(input.formVersionId ? { formVersionId: input.formVersionId } : {}), ...(input.fieldKey ? { fieldKey: input.fieldKey } : {}),
    pricedAt: new Date().toISOString(),
  };
}

type CreateParams = {
  eventId: string; actor: Actor; plan: LoadedPlan; registrationId: string | null; registrationAttendeeId: string | null;
  mealType: MealTypeValue; service: { id: string; name: string; serviceDate: string; capacity: number | null } | null; ageGroup: MealAgeGroupValue;
  attendeeTypeCode: string | null; quantity: number; price: ResolvedPrice | { unitPriceCents: number; conferenceRateCents: 0; rule: PriceRule; priceRowId: null };
  source: "REGISTRATION_FORM" | "STAFF" | "WALK_UP" | "PLAN_ASSIGNMENT";
  settlement: MealSettlement; reason: string; dietaryCategories?: string[]; orderLabel?: string | null; clientRequestId?: string | null;
  replacesSelectionId?: string | null; formVersionId?: string; fieldKey?: string; changeType?: MealChangeType;
};

async function createSelection(tx: Tx, p: CreateParams) {
  let selection;
  try {
    selection = await tx.eventMealSelection.create({
      data: {
        eventId: p.eventId, planId: p.plan.id, mealType: p.mealType, serviceId: p.service?.id ?? null, registrationId: p.registrationId,
        registrationAttendeeId: p.registrationAttendeeId, ageGroup: p.ageGroup, attendeeTypeCode: p.attendeeTypeCode, quantity: p.quantity,
        source: p.source, payer: p.plan.payer, unitPriceCents: p.price.unitPriceCents, conferenceRateCents: p.price.conferenceRateCents,
        pricingSnapshot: pricingSnapshot({ plan: p.plan, price: p.price, mealType: p.mealType, ageGroup: p.ageGroup, attendeeTypeCode: p.attendeeTypeCode, service: p.service, formVersionId: p.formVersionId, fieldKey: p.fieldKey }),
        sourceFormVersionId: p.formVersionId ?? null, sourceFieldKey: p.fieldKey ?? null, dietaryCategories: p.dietaryCategories ?? [],
        orderLabel: p.orderLabel ?? null, clientRequestId: p.clientRequestId ?? null, replacesSelectionId: p.replacesSelectionId ?? null,
        createdByUserId: p.actor.userId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new MealError("DUPLICATE", "That person already has this meal. Change the quantity of the existing selection instead.");
    }
    throw error;
  }
  const change = await recordChange(tx, p.eventId, p.actor, { selectionId: selection.id, type: p.changeType ?? "CREATED", reason: p.reason, before: null, after: view(selection) });
  const charge = p.plan.payer === "CONFERENCE" ? null : chargeEntry(p.quantity, p.price.unitPriceCents);
  if (charge) {
    await postEntries(tx, p.eventId, change.id, p.actor, [{
      draft: charge, selection: { ...selection, registrationAttendeeId: selection.registrationAttendeeId }, settlement: p.settlement, reason: p.reason,
    }]);
  }
  return selection;
}

async function loadSelection(tx: Tx, eventId: string, selectionId: string): Promise<SelectionRow> {
  await tx.$queryRaw`SELECT "id" FROM "EventMealSelection" WHERE "id" = ${selectionId} AND "eventId" = ${eventId} FOR UPDATE`;
  const selection = await tx.eventMealSelection.findFirst({ where: { id: selectionId, eventId }, include: { attendee: { select: { attendeeTypeDefinitionId: true } } } });
  if (!selection) throw new MealError("SELECTION_NOT_FOUND", "That meal selection does not exist.");
  return selection;
}

function assertManual(selection: SelectionRow) {
  if (selection.status !== "ACTIVE") throw new MealError("ALREADY_CANCELLED", "That meal selection is already cancelled.");
  if (selection.source === "REGISTRATION_FORM") {
    throw new MealError("FROM_FORM", "This ticket came from the registration form. Change the registration's answers instead, so the form's price stays the one record.");
  }
}

function settlementOf(selection: { registrationId: string | null; source: string }): MealSettlement {
  // A form ticket is priced by the form (an amendment re-prices it), so its entries never post an adjustment of their own.
  if (selection.source === "REGISTRATION_FORM") return "IN_REGISTRATION_PRICING";
  return selection.registrationId ? "REGISTRATION_ADJUSTMENT" : "AT_COUNTER";
}

async function attendeeContext(tx: Tx, eventId: string, registrationId: string, attendeeId: string | null) {
  if (!attendeeId) return { attendeeTypeId: null as string | null, attendeeTypeCode: null as string | null };
  const attendee = await tx.registrationAttendee.findFirst({
    where: { id: attendeeId, registrationId, eventId },
    select: { attendeeTypeDefinition: { select: { id: true, code: true } } },
  });
  if (!attendee) throw new MealError("ATTENDEE_NOT_FOUND", "That person is not on this registration.");
  return { attendeeTypeId: attendee.attendeeTypeDefinition?.id ?? null, attendeeTypeCode: attendee.attendeeTypeDefinition?.code ?? null };
}

/** Which service a selection is for and how its plan covers it; refuses a cancelled, donation-only or uncovered meal. */
async function coverageFor(tx: Tx, eventId: string, plan: LoadedPlan, mealType: MealTypeValue, serviceId: string | null) {
  if (!plan.isActive) throw new MealError("PLAN_INACTIVE", "That meal plan is turned off.");
  const services = await loadServices(tx, eventId);
  if (serviceId) {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) throw new MealError("SERVICE_NOT_FOUND", "That meal service does not exist.");
    if (service.mealType !== mealType) throw new MealError("INVALID", "That service is a different kind of meal.");
    if (service.status === "CANCELLED") throw new MealError("SERVICE_CANCELLED", `${service.name} is cancelled.`);
    if (service.ticketing === "DONATION_ONLY") throw new MealError("DONATION_ONLY", `${service.name} is donation-only; no ticket is sold for it.`);
    const coverage = serviceCoverage(planShape(plan), planRows(plan), service as ServiceShape);
    if (!coverage) throw new MealError("NOT_COVERED", `The ${plan.name} plan does not include ${service.name}.`);
    return { coverage, service };
  }
  const coverage = mealTypeCoverage(planShape(plan), planRows(plan), services as ServiceShape[], mealType);
  if (!coverage) throw new MealError("NOT_COVERED", `The ${plan.name} plan does not include ${mealType.toLowerCase()}.`);
  return { coverage, service: null };
}

function priceFor(plan: LoadedPlan, coverage: MealEntitlementValue, mealType: MealTypeValue, ageGroup: MealAgeGroupValue, attendeeTypeId: string | null) {
  const price = resolveMealPrice({ plan: planShape(plan), coverage, prices: planPrices(plan), mealType, ageGroup, attendeeTypeId });
  if (!price) throw new MealError("PRICE_MISSING", `The ${plan.name} plan has no ${mealType.toLowerCase()} price for this person. Set one before ordering.`);
  return price;
}

// ---------------------------------------------------------------------------
// Staff orders: late additions and walk-up orders
// ---------------------------------------------------------------------------

/**
 * A late addition for a registration or a walk-up order (no registration). Idempotent on `clientRequestId`: a retry
 * returns the same selection, and the same key with a different order is refused.
 */
export async function createMealOrder(eventId: string, actorUserId: string, rawInput: unknown) {
  const input = mealOrderInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId);
    const prior = await tx.eventMealSelection.findFirst({ where: { eventId, clientRequestId: input.clientRequestId } });
    if (prior) {
      const same = prior.registrationId === input.registrationId && prior.mealType === input.mealType && prior.serviceId === input.serviceId
        && prior.ageGroup === input.ageGroup && prior.quantity === input.quantity;
      if (!same) throw new MealError("REQUEST_REUSED", "That request id was already used for a different order.");
      return prior.id;
    }
    const plan = input.planId
      ? await loadPlan(tx, eventId, input.planId)
      : await tx.eventMealPlan.findFirst({ where: { eventId, isDefaultTicketPlan: true, isActive: true }, select: { id: true } }).then((found) => {
        if (!found) throw new MealError("NO_TICKET_PLAN", "This event has no meal ticket plan. Create one first.");
        return loadPlan(tx, eventId, found.id);
      });
    if (plan.payer === "CONFERENCE") throw new MealError("INVALID", "Conference-paid meals are entitled to a person, not ordered. Use the entitlement action.");
    let attendeeTypeId: string | null = null;
    let attendeeTypeCode: string | null = null;
    if (input.registrationId) {
      const status = await lockRegistration(tx, eventId, input.registrationId);
      if (status !== "SUBMITTED" && status !== "CONFIRMED") throw new MealError("REGISTRATION_NOT_ADJUSTABLE", "Meals can be added only to submitted or confirmed registrations.");
      ({ attendeeTypeId, attendeeTypeCode } = await attendeeContext(tx, eventId, input.registrationId, input.registrationAttendeeId));
    }
    if (input.serviceId) await lockService(tx, eventId, input.serviceId);
    const { coverage, service } = await coverageFor(tx, eventId, plan, input.mealType, input.serviceId);
    if (service) await assertCapacity(tx, service, input.quantity);
    const price = priceFor(plan, coverage, input.mealType, input.ageGroup, attendeeTypeId);
    const reason = input.reason ?? (input.registrationId ? "Meal added by staff." : "Walk-up meal order.");
    const selection = await createSelection(tx, {
      eventId, actor, plan, registrationId: input.registrationId, registrationAttendeeId: input.registrationAttendeeId, mealType: input.mealType,
      service, ageGroup: input.ageGroup, attendeeTypeCode, quantity: input.quantity, price, source: input.registrationId ? "STAFF" : "WALK_UP",
      settlement: input.registrationId ? "REGISTRATION_ADJUSTMENT" : "AT_COUNTER", reason, dietaryCategories: input.dietaryCategories,
      orderLabel: input.orderLabel, clientRequestId: input.clientRequestId,
    });
    await writeAuditLog({
      eventId, actorUserId, action: input.registrationId ? "MEAL_ORDER_ADDED" : "MEAL_WALK_UP_ORDER_ADDED", entityType: "EventMealSelection", entityId: selection.id,
      summary: `Added ${input.quantity} ${input.mealType.toLowerCase()} meal${input.quantity === 1 ? "" : "s"}${input.registrationId ? " to a registration" : " (walk-up)"}.`,
      metadata: { registrationId: input.registrationId, planId: plan.id, mealType: input.mealType, serviceId: input.serviceId, quantity: input.quantity, unitPriceCents: price.unitPriceCents },
    }, tx);
    return selection.id;
  });
}

export async function changeMealQuantity(eventId: string, selectionId: string, actorUserId: string, rawInput: unknown) {
  const input = mealChangeQuantityInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId);
    const selection = await loadSelection(tx, eventId, selectionId);
    assertManual(selection);
    const registrationStatus = selection.registrationId ? await lockRegistration(tx, eventId, selection.registrationId) : null;
    if (input.quantity === selection.quantity) return;
    if (selection.serviceId && input.quantity > selection.quantity) {
      await lockService(tx, eventId, selection.serviceId);
      const service = await tx.eventMealService.findUniqueOrThrow({ where: { id: selection.serviceId }, select: { id: true, name: true, capacity: true, status: true } });
      if (service.status === "CANCELLED") throw new MealError("SERVICE_CANCELLED", `${service.name} is cancelled.`);
      await assertCapacity(tx, service, input.quantity - selection.quantity);
    }
    const entries = quantityChangeEntries({ quantity: selection.quantity, unitPriceCents: selection.unitPriceCents, payer: selection.payer }, input.quantity);
    const updated = await tx.eventMealSelection.update({ where: { id: selectionId }, data: { quantity: input.quantity } });
    const change = await recordChange(tx, eventId, actor, { selectionId, type: "QUANTITY_CHANGED", reason: input.reason, before: view(selection), after: view(updated) });
    // A credit on a cancelled or waitlisted registration is ledgered only; a charge there is refused by the adjustment check.
    await postEntries(tx, eventId, change.id, actor, entries.map((draft) => ({ draft, selection, settlement: draft.kind === "CREDIT" ? settlementForStatus(selection, registrationStatus) : settlementOf(selection), reason: input.reason })));
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_QUANTITY_CHANGED", entityType: "EventMealSelection", entityId: selectionId,
      summary: `Changed a meal selection from ${selection.quantity} to ${input.quantity}.`, metadata: { beforeQuantity: selection.quantity, afterQuantity: input.quantity },
    }, tx);
  });
}

/** The settlement for a credit: a registration that is no longer live (cancelled or waitlisted) is not posted to. */
function settlementForStatus(selection: { registrationId: string | null; source: string }, registrationStatus: string | null): MealSettlement {
  const base = settlementOf(selection);
  return base === "REGISTRATION_ADJUSTMENT" && registrationStatus !== null && !isLiveRegistrationStatus(registrationStatus) ? "REGISTRATION_NOT_LIVE" : base;
}

async function cancelCore(tx: Tx, eventId: string, actor: Actor, selection: SelectionRow, type: MealChangeType, reason: string, settlement: MealSettlement = settlementOf(selection), options: { skipBelowPaidCheck?: boolean } = {}) {
  const updated = await tx.eventMealSelection.update({ where: { id: selection.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  const change = await recordChange(tx, eventId, actor, { selectionId: selection.id, type, reason, before: view(selection), after: view(updated) });
  await postEntries(tx, eventId, change.id, actor, cancellationEntries({ quantity: selection.quantity, unitPriceCents: selection.unitPriceCents, payer: selection.payer })
    .map((draft) => ({ draft, selection, settlement, reason })), options);
  return updated;
}

export async function cancelMealSelection(eventId: string, selectionId: string, actorUserId: string, rawInput: unknown) {
  const input = mealCancelInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId);
    const selection = await loadSelection(tx, eventId, selectionId);
    assertManual(selection);
    const registrationStatus = selection.registrationId ? await lockRegistration(tx, eventId, selection.registrationId) : null;
    await cancelCore(tx, eventId, actor, selection, "CANCELLED", input.reason, settlementForStatus(selection, registrationStatus));
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_SELECTION_CANCELLED", entityType: "EventMealSelection", entityId: selectionId,
      summary: "Cancelled a meal selection.", metadata: { quantity: selection.quantity, unitPriceCents: selection.unitPriceCents },
    }, tx);
  });
}

/**
 * Moves a selection to another plan: the old plan's charge is credited at the price it was made at and the new plan's
 * current price is charged. Moving to a conference-paid plan only credits.
 */
export async function changeMealPlan(eventId: string, selectionId: string, actorUserId: string, rawInput: unknown) {
  const input = mealChangePlanInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId);
    const selection = await loadSelection(tx, eventId, selectionId);
    assertManual(selection);
    if (selection.planId === input.planId) throw new MealError("INVALID", "That selection is already on this plan.");
    if (selection.registrationId) await lockRegistration(tx, eventId, selection.registrationId);
    const plan = await loadPlan(tx, eventId, input.planId);
    if (plan.payer === "CONFERENCE" && !selection.registrationId) throw new MealError("INVALID", "A walk-up order cannot be conference-paid.");
    const { coverage } = await coverageFor(tx, eventId, plan, selection.mealType, selection.serviceId);
    const attendeeTypeId = selection.attendee?.attendeeTypeDefinitionId ?? null;
    const price = priceFor(plan, coverage, selection.mealType, selection.ageGroup, attendeeTypeId);
    const service = selection.serviceId ? await tx.eventMealService.findUniqueOrThrow({ where: { id: selection.serviceId }, select: { id: true, name: true, serviceDate: true } }) : null;
    let updated;
    try {
      updated = await tx.eventMealSelection.update({
        where: { id: selectionId },
        data: {
          planId: plan.id, payer: plan.payer, unitPriceCents: price.unitPriceCents, conferenceRateCents: price.conferenceRateCents,
          pricingSnapshot: pricingSnapshot({ plan, price, mealType: selection.mealType, ageGroup: selection.ageGroup, attendeeTypeCode: selection.attendeeTypeCode, service }),
        },
      });
    } catch (error) {
      // The new payer's slot already holds an active selection for this person and meal (for example an entitlement).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new MealError("DUPLICATE", "That person already has this meal under the other plan. Cancel one of them instead.");
      }
      throw error;
    }
    const change = await recordChange(tx, eventId, actor, { selectionId, type: "PLAN_CHANGED", reason: input.reason, before: view(selection), after: view(updated) });
    const settlement = settlementOf(selection);
    const entries: EntryInput[] = [];
    for (const draft of cancellationEntries({ quantity: selection.quantity, unitPriceCents: selection.unitPriceCents, payer: selection.payer })) {
      entries.push({ draft, selection, settlement, reason: input.reason });
    }
    const charge = plan.payer === "CONFERENCE" ? null : chargeEntry(selection.quantity, price.unitPriceCents);
    if (charge) entries.push({ draft: charge, selection: { ...selection, payer: plan.payer }, settlement, reason: input.reason });
    await postEntries(tx, eventId, change.id, actor, entries);
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_PLAN_CHANGED", entityType: "EventMealSelection", entityId: selectionId,
      summary: "Moved a meal selection to another plan.", metadata: { fromPlanId: selection.planId, toPlanId: plan.id, fromUnitCents: selection.unitPriceCents, toUnitCents: price.unitPriceCents },
    }, tx);
  });
}

/** Swaps one meal for another: the old selection is cancelled and credited, and a new one is made and charged at current prices. */
export async function substituteMealSelection(eventId: string, selectionId: string, actorUserId: string, rawInput: unknown) {
  const input = mealSubstituteInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId);
    const selection = await loadSelection(tx, eventId, selectionId);
    assertManual(selection);
    if (selection.mealType === input.mealType && selection.serviceId === input.serviceId) throw new MealError("INVALID", "That is the same meal.");
    if (selection.registrationId) await lockRegistration(tx, eventId, selection.registrationId);
    const plan = await loadPlan(tx, eventId, selection.planId);
    if (input.serviceId) await lockService(tx, eventId, input.serviceId);
    const { coverage, service } = await coverageFor(tx, eventId, plan, input.mealType, input.serviceId);
    if (service) await assertCapacity(tx, service, selection.quantity);
    const attendeeTypeId = selection.attendee?.attendeeTypeDefinitionId ?? null;
    const price = priceFor(plan, coverage, input.mealType, selection.ageGroup, attendeeTypeId);
    // Charge first, then credit: a paid registration whose net change is upward must never trip the below-paid check.
    await createSelection(tx, {
      eventId, actor, plan, registrationId: selection.registrationId, registrationAttendeeId: selection.registrationAttendeeId, mealType: input.mealType,
      service, ageGroup: selection.ageGroup, attendeeTypeCode: selection.attendeeTypeCode, quantity: selection.quantity, price, source: selection.source,
      settlement: settlementOf(selection), reason: input.reason, dietaryCategories: selection.dietaryCategories, orderLabel: selection.orderLabel,
      replacesSelectionId: selection.id,
    });
    await cancelCore(tx, eventId, actor, selection, "SUBSTITUTED", input.reason);
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_SELECTION_SUBSTITUTED", entityType: "EventMealSelection", entityId: selectionId,
      summary: "Substituted a meal selection.", metadata: { toMealType: input.mealType, toServiceId: input.serviceId },
    }, tx);
  });
}

/**
 * Gives an attendee a conference-paid plan (#804 will call this for staff, pastor and volunteer registrations): one
 * selection per covered service, quantity 1, never charged to the attendee, carrying the rate the conference is billed
 * when the meal is used (#212). Running it again adds only services that are new. A meal the attendee already holds
 * under another plan moves to this one (credited at the price it was charged).
 */
export async function entitleAttendeeToPlan(eventId: string, actorUserId: string | null, rawInput: unknown) {
  const input = mealEntitleInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId, "Staff registration");
    const plan = await loadPlan(tx, eventId, input.planId);
    if (plan.payer !== "CONFERENCE") throw new MealError("INVALID", "Only a conference-paid plan entitles a person to meals. Ticket plans sell meals.");
    const attendee = await tx.registrationAttendee.findFirst({
      where: { id: input.registrationAttendeeId, eventId }, select: { id: true, registrationId: true, attendeeTypeDefinition: { select: { id: true, code: true } } },
    });
    if (!attendee) throw new MealError("ATTENDEE_NOT_FOUND", "That attendee does not exist.");
    const status = await lockRegistration(tx, eventId, attendee.registrationId);
    if (status !== "SUBMITTED" && status !== "CONFIRMED") throw new MealError("REGISTRATION_NOT_ADJUSTABLE", "Meals can be entitled only on submitted or confirmed registrations.");
    const services = await loadServices(tx, eventId);
    const created: string[] = [];
    for (const service of services) {
      const coverage = serviceCoverage(planShape(plan), planRows(plan), service as ServiceShape);
      if (!coverage) continue;
      await lockService(tx, eventId, service.id);
      const slot = { registrationId: attendee.registrationId, registrationAttendeeId: attendee.id, mealType: service.mealType, serviceId: service.id, ageGroup: input.ageGroup, status: "ACTIVE" as const };
      const include = { attendee: { select: { attendeeTypeDefinitionId: true } } };
      const entitled = await tx.eventMealSelection.findFirst({ where: { ...slot, payer: "CONFERENCE" }, include });
      if (entitled && entitled.planId === plan.id) continue;
      const paid = await tx.eventMealSelection.findFirst({ where: { ...slot, payer: "ATTENDEE" }, include });
      const price = priceFor(plan, coverage, service.mealType, input.ageGroup, attendee.attendeeTypeDefinition?.id ?? null);
      // Moving between conference plans replaces the old entitlement only; paid meals are touched just when there was none.
      if (entitled) await cancelCore(tx, eventId, actor, entitled, "PLAN_CHANGED", input.reason);
      else if (paid) {
        // The conference pays for one meal: a paid order of one is replaced by the entitlement (credited in full); a paid
        // order of several keeps the rest and is credited only for the one the entitlement now covers.
        if (paid.quantity === 1) {
          await cancelCore(tx, eventId, actor, paid, "PLAN_CHANGED", input.reason);
        } else {
          const reduced = await tx.eventMealSelection.update({ where: { id: paid.id }, data: { quantity: paid.quantity - 1 } });
          const change = await recordChange(tx, eventId, actor, { selectionId: paid.id, type: "QUANTITY_CHANGED", reason: input.reason, before: view(paid), after: view(reduced) });
          await postEntries(tx, eventId, change.id, actor, quantityChangeEntries({ quantity: paid.quantity, unitPriceCents: paid.unitPriceCents, payer: paid.payer }, paid.quantity - 1)
            .map((draft) => ({ draft, selection: paid, settlement: settlementOf(paid), reason: input.reason })));
        }
      } else {
        await assertCapacity(tx, service, 1);
      }
      const selection = await createSelection(tx, {
        eventId, actor, plan, registrationId: attendee.registrationId, registrationAttendeeId: attendee.id, mealType: service.mealType, service,
        ageGroup: input.ageGroup, attendeeTypeCode: attendee.attendeeTypeDefinition?.code ?? null, quantity: 1, price, source: "PLAN_ASSIGNMENT",
        settlement: "REGISTRATION_ADJUSTMENT", reason: input.reason, replacesSelectionId: entitled ? entitled.id : paid?.quantity === 1 ? paid.id : null,
      });
      created.push(selection.id);
    }
    await writeAuditLog({
      eventId, actorUserId: actorUserId ?? undefined, action: "MEAL_PLAN_ENTITLED", entityType: "EventMealPlan", entityId: plan.id,
      summary: `Entitled an attendee to the conference-paid plan ${plan.name}.`, metadata: { registrationAttendeeId: attendee.id, planId: plan.id, added: created.length },
    }, tx);
    return created;
  });
}

/**
 * Cancels a meal service. Every active selection pinned to it is cancelled and credited (a staff order posts a MEAL
 * credit to its registration; a walk-up order is credited at the counter). It either all happens or none does: if a
 * credit would take a registration below what it has paid, nothing changes and staff record the refund first.
 * Tickets that are good for any service of the meal type are not pinned and are left alone.
 */
export async function cancelMealService(eventId: string, serviceId: string, actorUserId: string, rawInput: unknown) {
  const input = mealCancelInputSchema.parse(rawInput);
  return mealTransaction(async (tx) => {
    const actor = await actorFor(tx, actorUserId);
    await lockService(tx, eventId, serviceId);
    const service = await tx.eventMealService.findFirstOrThrow({ where: { id: serviceId, eventId } });
    if (service.status === "CANCELLED") throw new MealError("ALREADY_CANCELLED", "That meal service is already cancelled.");
    const pinned = await tx.eventMealSelection.findMany({
      where: { serviceId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, include: { attendee: { select: { attendeeTypeDefinitionId: true } } },
    });
    for (const selection of pinned) {
      const registrationStatus = selection.registrationId ? await lockRegistration(tx, eventId, selection.registrationId) : null;
      await cancelCore(tx, eventId, actor, selection, "SERVICE_CANCELLED", input.reason, settlementForStatus(selection, registrationStatus));
    }
    const updated = await tx.eventMealService.update({ where: { id: serviceId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason } });
    await tx.eventMealServiceChange.create({ data: { eventId, serviceId, type: "CANCELLED", actorUserId, reason: input.reason, before: serviceSnapshot(service), after: serviceSnapshot(updated) } });
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_SERVICE_CANCELLED", entityType: "EventMealService", entityId: serviceId,
      summary: `Cancelled the meal service ${service.name}.`, metadata: { selectionsCancelled: pinned.length },
    }, tx);
    return { cancelledSelections: pinned.length };
  });
}

/**
 * Cancels, and credits at the price charged, every active selection of attendees an amendment is removing (#210), inside
 * the amendment's transaction and before the attendee row goes (their selections would otherwise be left charged with
 * no attendee). Returns the cents of credit posted to the registration as MEAL adjustment lines (zero or negative), so the
 * amendment can write the registration's final total with them in it. A credit that would take the registration below
 * what it paid throws a MealError (TOTAL_BELOW_PAID): refund first.
 */
export async function plannedAttendeeMealCredit(tx: Tx, input: {
  registrationId: string; attendeeIds: readonly string[]; registrationStatus: string;
}) {
  if (input.attendeeIds.length === 0 || !isLiveRegistrationStatus(input.registrationStatus)) return 0;
  const rows = await tx.eventMealSelection.findMany({
    where: { registrationId: input.registrationId, registrationAttendeeId: { in: [...input.attendeeIds] }, status: "ACTIVE" },
    select: { quantity: true, unitPriceCents: true, payer: true, source: true },
  });
  return rows.reduce((total, row) => (
    settlementOf({ registrationId: input.registrationId, source: row.source }) === "REGISTRATION_ADJUSTMENT"
      ? total + cancellationEntries({ quantity: row.quantity, unitPriceCents: row.unitPriceCents, payer: row.payer }).reduce((sum, entry) => sum + entry.amountCents, 0)
      : total
  ), 0);
}

/**
 * Cancels, and credits at the price charged, every active selection of attendees an amendment is removing (#210), inside
 * the amendment's transaction and before the attendee row goes (their selections would otherwise be left charged with
 * no attendee). The amendment priced this credit beforehand with `plannedAttendeeMealCredit`; the sum posted here must equal
 * `expectedCreditCents` or a MealError (CONFLICT) rolls the whole amendment back. Returns the cents posted.
 */
export async function cancelMealSelectionsForAttendees(tx: Tx, input: {
  eventId: string; registrationId: string; attendeeIds: readonly string[]; actorUserId: string | null; expectedCreditCents: number;
}) {
  if (input.attendeeIds.length === 0) return 0;
  const rows = await tx.eventMealSelection.findMany({
    where: { registrationId: input.registrationId, registrationAttendeeId: { in: [...input.attendeeIds] }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" }, include: { attendee: { select: { attendeeTypeDefinitionId: true } } },
  });
  if (rows.length === 0) {
    if (input.expectedCreditCents !== 0) throw new MealError("CONFLICT", "This registration's meal orders changed while the amendment was being saved. Review it and try again.");
    return 0;
  }
  const actor = await actorFor(tx, input.actorUserId, "Registration amendment");
  const registrationStatus = await lockRegistration(tx, input.eventId, input.registrationId);
  let postedCents = 0;
  for (const selection of rows) {
    const settlement = settlementForStatus(selection, registrationStatus);
    // The amendment priced the combined new total against what was paid (`prepareAmendment`), so only that comparison is skipped here.
    await cancelCore(tx, input.eventId, actor, selection, "CANCELLED", "The attendee was removed from the registration.", settlement, { skipBelowPaidCheck: true });
    if (settlement === "REGISTRATION_ADJUSTMENT") {
      postedCents += cancellationEntries({ quantity: selection.quantity, unitPriceCents: selection.unitPriceCents, payer: selection.payer }).reduce((total, entry) => total + entry.amountCents, 0);
    }
  }
  if (postedCents !== input.expectedCreditCents) {
    throw new MealError("CONFLICT", "This registration's meal orders changed while the amendment was being saved. Review it and try again.");
  }
  return postedCents;
}

// ---------------------------------------------------------------------------
// Registration form tickets
// ---------------------------------------------------------------------------

/**
 * Makes the registration's active form tickets match its answers, inside the submission's or the amendment's
 * transaction. The form already priced the tickets into the registration's total, so the entries are
 * IN_REGISTRATION_PRICING and nothing here touches the total. The price copied onto a ticket is what the form
 * charged (the priced line divided by the quantity, late pricing included). An event with no ticket plan, or a form
 * with no ticket fields, is left alone.
 */
export async function syncFormMealSelections(tx: Tx, input: {
  eventId: string; registrationId: string; formVersionId: string; responses: Record<string, unknown>;
  lineItems: ReadonlyArray<{ key: string; amountCents: number }>; actorUserId?: string | null;
  /** The registration's answers before this change, or null for a new registration. A form with no ticket answers before or after touches no meal table. */
  previousResponses: Record<string, unknown> | null;
}) {
  const desiredNow = ticketQuantitiesFromAnswers(input.responses);
  if (desiredNow.length === 0 && (input.previousResponses === null || ticketQuantitiesFromAnswers(input.previousResponses).length === 0)) {
    return { created: 0, changed: 0, cancelled: 0 };
  }
  const planRow = await tx.eventMealPlan.findFirst({ where: { eventId: input.eventId, isDefaultTicketPlan: true, isActive: true }, select: { id: true } });
  if (!planRow) return { created: 0, changed: 0, cancelled: 0 };
  const desired = desiredNow;
  const existing = await tx.eventMealSelection.findMany({
    where: { registrationId: input.registrationId, source: "REGISTRATION_FORM", status: "ACTIVE", registrationAttendeeId: null, serviceId: null },
    include: { attendee: { select: { attendeeTypeDefinitionId: true } } },
  });
  const actions = diffFormTickets(desired, existing);
  if (actions.length === 0) return { created: 0, changed: 0, cancelled: 0 };
  const actor = await actorFor(tx, input.actorUserId ?? null);
  const plan = await loadPlan(tx, input.eventId, planRow.id);
  const unitFor = (fieldKey: string, quantity: number) => {
    const line = input.lineItems.find((item) => item.key === fieldKey);
    return line && quantity > 0 ? Math.max(0, Math.round(line.amountCents / quantity)) : 0;
  };
  const result = { created: 0, changed: 0, cancelled: 0 };
  for (const action of actions) {
    if (action.action === "CREATE") {
      const unit = unitFor(action.fieldKey, action.quantity);
      await createSelection(tx, {
        eventId: input.eventId, actor, plan, registrationId: input.registrationId, registrationAttendeeId: null, mealType: action.mealType, service: null,
        ageGroup: action.ageGroup, attendeeTypeCode: null, quantity: action.quantity,
        price: { unitPriceCents: unit, conferenceRateCents: 0, rule: "FORM_FIELD", priceRowId: null }, source: "REGISTRATION_FORM",
        settlement: "IN_REGISTRATION_PRICING", reason: "Ordered on the registration form.", formVersionId: input.formVersionId, fieldKey: action.fieldKey,
      });
      result.created += 1;
      continue;
    }
    const selection = existing.find((row) => row.id === action.selectionId)!;
    if (action.action === "CANCEL") {
      await cancelCore(tx, input.eventId, actor, selection, "CANCELLED", "Removed from the registration form answers.");
      result.cancelled += 1;
      continue;
    }
    const fieldKey = selection.sourceFieldKey ?? "";
    const unit = unitFor(fieldKey, action.quantity);
    const reprice = unit !== selection.unitPriceCents && unit > 0;
    const updated = await tx.eventMealSelection.update({
      where: { id: selection.id },
      data: { quantity: action.quantity, ...(reprice ? { unitPriceCents: unit } : {}), sourceFormVersionId: input.formVersionId },
    });
    const change = await recordChange(tx, input.eventId, actor, { selectionId: selection.id, type: "QUANTITY_CHANGED", reason: "Changed on the registration form answers.", before: view(selection), after: view(updated) });
    const drafts: LedgerDraft[] = reprice
      ? [creditEntry(selection.quantity, selection.unitPriceCents), chargeEntry(action.quantity, unit)].filter((draft): draft is LedgerDraft => draft !== null)
      : quantityChangeEntries({ quantity: selection.quantity, unitPriceCents: selection.unitPriceCents, payer: selection.payer }, action.quantity);
    await postEntries(tx, input.eventId, change.id, actor, drafts.map((draft) => ({ draft, selection, settlement: "IN_REGISTRATION_PRICING" as const, reason: "Changed on the registration form answers." })));
    result.changed += 1;
  }
  return result;
}
