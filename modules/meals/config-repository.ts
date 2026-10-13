import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  countsTowardCapacity,
  mealPlanInputSchema,
  mealPlanServiceInputSchema,
  mealPriceInputSchema,
  mealServiceInputSchema,
  type MealAgeGroupValue,
  type MealPlanInput,
  type MealPriceInput,
  type MealServiceInput,
  type MealTypeValue,
} from "@/modules/meals/domain";
import { MealError } from "@/modules/meals/errors";
import { campMeetingMeals } from "@/modules/meals/camp-meeting";
import { createMealDefinitions } from "@/modules/meals/clone-repository";
import { mealDefinitionsFromTemplate } from "@/modules/meals/clone-domain";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { z } from "zod";

type Client = Prisma.TransactionClient | PrismaClient;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isDatabaseRefusal(error: unknown) {
  return error instanceof Error && error.message.includes("23001");
}

export function serviceSnapshot(service: {
  name: string; mealType: string; serviceDate: string; startTime: string; endTime: string | null; location: string | null;
  ticketing: string; capacity: number | null; status: string;
}) {
  return {
    name: service.name, mealType: service.mealType, serviceDate: service.serviceDate, startTime: service.startTime, endTime: service.endTime,
    location: service.location, ticketing: service.ticketing, capacity: service.capacity, status: service.status,
  };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function createMealService(eventId: string, actorUserId: string, rawInput: unknown) {
  const input = mealServiceInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new MealError("EVENT_NOT_FOUND", "That event does not exist.");
    try {
      const position = (await tx.eventMealService.aggregate({ where: { eventId }, _max: { position: true } }))._max.position ?? 0;
      const service = await tx.eventMealService.create({ data: { eventId, ...input, position: position + 1, createdByUserId: actorUserId } });
      await tx.eventMealServiceChange.create({ data: { eventId, serviceId: service.id, type: "CREATED", actorUserId, after: serviceSnapshot(service) } });
      await writeAuditLog({
        eventId, actorUserId, action: "MEAL_SERVICE_CREATED", entityType: "EventMealService", entityId: service.id,
        summary: `Added the meal service ${service.name} on ${service.serviceDate}.`, metadata: serviceSnapshot(service),
      }, tx);
      return service.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw new MealError("DUPLICATE", "A meal service with that name already exists on that date.");
      throw error;
    }
  });
}

export async function updateMealService(eventId: string, serviceId: string, actorUserId: string, rawInput: unknown) {
  const input: MealServiceInput = mealServiceInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "EventMealService" WHERE "id" = ${serviceId} AND "eventId" = ${eventId} FOR UPDATE`;
    const service = await tx.eventMealService.findFirst({ where: { id: serviceId, eventId } });
    if (!service) throw new MealError("SERVICE_NOT_FOUND", "That meal service does not exist.");
    if (service.status === "CANCELLED") throw new MealError("SERVICE_CANCELLED", "This meal service is cancelled. Reinstate it before editing it.");
    if (input.capacity !== null) {
      const taken = await tx.eventMealSelection.aggregate({ where: { serviceId, ...countsTowardCapacity }, _sum: { quantity: true } });
      if ((taken._sum.quantity ?? 0) > input.capacity) {
        throw new MealError("CAPACITY_FULL", `${taken._sum.quantity} meals are already selected for this service, more than the new capacity.`);
      }
    }
    if (input.ticketing === "DONATION_ONLY") {
      const selections = await tx.eventMealSelection.count({ where: { serviceId, status: "ACTIVE" } });
      if (selections > 0) throw new MealError("INVALID", "This service has selections, so it cannot become donation-only.");
    }
    try {
      const updated = await tx.eventMealService.update({ where: { id: serviceId }, data: input });
      await tx.eventMealServiceChange.create({ data: { eventId, serviceId, type: "UPDATED", actorUserId, before: serviceSnapshot(service), after: serviceSnapshot(updated) } });
      await writeAuditLog({
        eventId, actorUserId, action: "MEAL_SERVICE_UPDATED", entityType: "EventMealService", entityId: serviceId,
        summary: `Changed the meal service ${updated.name}.`, metadata: { before: serviceSnapshot(service), after: serviceSnapshot(updated) },
      }, tx);
    } catch (error) {
      if (isUniqueViolation(error)) throw new MealError("DUPLICATE", "A meal service with that name already exists on that date.");
      throw error;
    }
  });
}

/** Brings a cancelled service back. Selections cancelled with it stay cancelled; people order again. */
export async function reinstateMealService(eventId: string, serviceId: string, actorUserId: string, reason: string) {
  const text = z.string().trim().min(3, "Enter a reason.").max(500).parse(reason);
  return getPrisma().$transaction(async (tx) => {
    const service = await tx.eventMealService.findFirst({ where: { id: serviceId, eventId } });
    if (!service) throw new MealError("SERVICE_NOT_FOUND", "That meal service does not exist.");
    if (service.status !== "CANCELLED") throw new MealError("CONFLICT", "That meal service is not cancelled.");
    const updated = await tx.eventMealService.update({ where: { id: serviceId }, data: { status: "ACTIVE", cancelledAt: null, cancelReason: null } });
    await tx.eventMealServiceChange.create({ data: { eventId, serviceId, type: "REINSTATED", actorUserId, reason: text, before: serviceSnapshot(service), after: serviceSnapshot(updated) } });
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_SERVICE_REINSTATED", entityType: "EventMealService", entityId: serviceId,
      summary: `Reinstated the meal service ${service.name}.`, metadata: { serviceId },
    }, tx);
  });
}

// ---------------------------------------------------------------------------
// Plans, plan services and prices
// ---------------------------------------------------------------------------

export function planSnapshot(plan: {
  code: string; name: string; payer: string; isDefaultTicketPlan: boolean; includesAllServices: boolean; defaultEntitlement: string; isActive: boolean;
}) {
  return {
    code: plan.code, name: plan.name, payer: plan.payer, isDefaultTicketPlan: plan.isDefaultTicketPlan,
    includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, isActive: plan.isActive,
  };
}

async function clearOtherDefaultPlans(tx: Client, eventId: string, exceptPlanId: string | null) {
  await tx.eventMealPlan.updateMany({ where: { eventId, isDefaultTicketPlan: true, ...(exceptPlanId ? { id: { not: exceptPlanId } } : {}) }, data: { isDefaultTicketPlan: false } });
}

export async function createMealPlan(eventId: string, actorUserId: string, rawInput: unknown) {
  const input: MealPlanInput = mealPlanInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new MealError("EVENT_NOT_FOUND", "That event does not exist.");
    try {
      if (input.isDefaultTicketPlan) await clearOtherDefaultPlans(tx, eventId, null);
      const position = (await tx.eventMealPlan.aggregate({ where: { eventId }, _max: { position: true } }))._max.position ?? 0;
      const plan = await tx.eventMealPlan.create({ data: { eventId, ...input, position: position + 1, createdByUserId: actorUserId } });
      await writeAuditLog({
        eventId, actorUserId, action: "MEAL_PLAN_CREATED", entityType: "EventMealPlan", entityId: plan.id,
        summary: `Added the meal plan ${plan.name} (${plan.payer === "CONFERENCE" ? "conference pays" : "attendee pays"}).`, metadata: planSnapshot(plan),
      }, tx);
      return plan.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw new MealError("DUPLICATE", "A meal plan with that code already exists.");
      throw error;
    }
  });
}

export async function updateMealPlan(eventId: string, planId: string, actorUserId: string, rawInput: unknown) {
  const input: MealPlanInput = mealPlanInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    const plan = await tx.eventMealPlan.findFirst({ where: { id: planId, eventId } });
    if (!plan) throw new MealError("PLAN_NOT_FOUND", "That meal plan does not exist.");
    if (plan.payer !== input.payer) {
      const used = await tx.eventMealSelection.count({ where: { planId, status: "ACTIVE" } });
      if (used > 0) throw new MealError("INVALID", "This plan has active selections, so who pays cannot change. Move them to another plan first.");
    }
    if (plan.payer === "CONFERENCE" && input.payer === "ATTENDEE") {
      const included = await tx.eventMealPlanService.count({ where: { planId, entitlement: "INCLUDED" } });
      if (included > 0) throw new MealError("INVALID", "Set this plan's services to paid before making it attendee-paid.");
    }
    try {
      if (input.isDefaultTicketPlan) await clearOtherDefaultPlans(tx, eventId, planId);
      const updated = await tx.eventMealPlan.update({ where: { id: planId }, data: input });
      await writeAuditLog({
        eventId, actorUserId, action: "MEAL_PLAN_UPDATED", entityType: "EventMealPlan", entityId: planId,
        summary: `Changed the meal plan ${updated.name}.`, metadata: { before: planSnapshot(plan), after: planSnapshot(updated) },
      }, tx);
    } catch (error) {
      if (isUniqueViolation(error)) throw new MealError("DUPLICATE", "A meal plan with that code already exists.");
      throw error;
    }
  });
}

/** Replaces which services a plan lists and whether each is paid or included. */
export async function setMealPlanServices(eventId: string, planId: string, actorUserId: string, rawRows: unknown) {
  const rows = z.array(mealPlanServiceInputSchema).max(200).parse(rawRows);
  if (new Set(rows.map((row) => row.serviceId)).size !== rows.length) throw new MealError("INVALID", "A service is listed twice.");
  return getPrisma().$transaction(async (tx) => {
    const plan = await tx.eventMealPlan.findFirst({ where: { id: planId, eventId } });
    if (!plan) throw new MealError("PLAN_NOT_FOUND", "That meal plan does not exist.");
    if (plan.payer === "CONFERENCE" && rows.some((row) => row.entitlement !== "INCLUDED")) {
      throw new MealError("INVALID", "A conference-paid plan includes every meal it lists.");
    }
    const services = await tx.eventMealService.findMany({ where: { eventId, id: { in: rows.map((row) => row.serviceId) } }, select: { id: true } });
    if (services.length !== rows.length) throw new MealError("SERVICE_NOT_FOUND", "A listed meal service is not part of this event.");
    await tx.eventMealPlanService.deleteMany({ where: { planId, serviceId: { notIn: rows.map((row) => row.serviceId) } } });
    for (const row of rows) {
      await tx.eventMealPlanService.upsert({
        where: { planId_serviceId: { planId, serviceId: row.serviceId } },
        create: { eventId, planId, serviceId: row.serviceId, entitlement: row.entitlement },
        update: { entitlement: row.entitlement },
      });
    }
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_PLAN_SERVICES_SET", entityType: "EventMealPlan", entityId: planId,
      summary: `Set the services on the meal plan ${plan.name}.`, metadata: { serviceCount: rows.length, included: rows.filter((row) => row.entitlement === "INCLUDED").length },
    }, tx);
  });
}

export async function setMealPrice(eventId: string, planId: string, actorUserId: string, rawInput: unknown) {
  const input: MealPriceInput = mealPriceInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    const plan = await tx.eventMealPlan.findFirst({ where: { id: planId, eventId } });
    if (!plan) throw new MealError("PLAN_NOT_FOUND", "That meal plan does not exist.");
    if (input.attendeeTypeId) {
      const type = await tx.eventAttendeeType.findFirst({ where: { id: input.attendeeTypeId, eventId }, select: { id: true } });
      if (!type) throw new MealError("ATTENDEE_TYPE_NOT_FOUND", "That attendee type is not part of this event.");
    }
    const where = { planId, mealType: input.mealType, ageGroup: input.ageGroup, attendeeTypeId: input.attendeeTypeId };
    const existing = await tx.eventMealPrice.findFirst({ where });
    const saved = existing
      ? await tx.eventMealPrice.update({ where: { id: existing.id }, data: { amountCents: input.amountCents, updatedByUserId: actorUserId } })
      : await tx.eventMealPrice.create({ data: { eventId, ...where, amountCents: input.amountCents, updatedByUserId: actorUserId } });
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_PRICE_SET", entityType: "EventMealPrice", entityId: saved.id,
      summary: `Set a ${input.mealType.toLowerCase()} price on the meal plan ${plan.name}.`,
      metadata: { planId, mealType: input.mealType, ageGroup: input.ageGroup, attendeeTypeId: input.attendeeTypeId, beforeCents: existing?.amountCents ?? null, afterCents: input.amountCents },
    }, tx);
    return saved.id;
  });
}

export async function removeMealPrice(eventId: string, priceId: string, actorUserId: string) {
  return getPrisma().$transaction(async (tx) => {
    const price = await tx.eventMealPrice.findFirst({ where: { id: priceId, eventId } });
    if (!price) throw new MealError("PRICE_NOT_FOUND", "That price does not exist.");
    await tx.eventMealPrice.delete({ where: { id: priceId } });
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_PRICE_REMOVED", entityType: "EventMealPrice", entityId: priceId,
      summary: "Removed a meal price.", metadata: { planId: price.planId, mealType: price.mealType, ageGroup: price.ageGroup, attendeeTypeId: price.attendeeTypeId, beforeCents: price.amountCents },
    }, tx);
  });
}

// ---------------------------------------------------------------------------
// Prices for the registration form's ticket fields
// ---------------------------------------------------------------------------

/**
 * The default ticket plan's age-group prices, keyed "BREAKFAST:ADULT" and so on, for the registration form's ticket
 * fields. Empty when the event has no ticket plan, so an event without meal setup is untouched.
 */
export async function loadTicketPrices(client: Client, eventId: string): Promise<Map<string, number>> {
  const plan = await client.eventMealPlan.findFirst({
    where: { eventId, isDefaultTicketPlan: true, isActive: true },
    select: { prices: { where: { ageGroup: { not: null } }, select: { mealType: true, ageGroup: true, amountCents: true } } },
  });
  const prices = new Map<string, number>();
  for (const row of plan?.prices ?? []) prices.set(`${row.mealType satisfies MealTypeValue}:${row.ageGroup as MealAgeGroupValue}`, row.amountCents);
  return prices;
}

export { isDatabaseRefusal };

// ---------------------------------------------------------------------------
// Preset: the Camp Meeting 2026 meals, applied by a person
// ---------------------------------------------------------------------------

/**
 * Adds the Camp Meeting 2026 services and plans (`modules/meals/camp-meeting.ts`) to an event that has no meal services
 * or plans yet, dated from the event's first day (a Tuesday). A person with finance access chooses it; nothing seeds or
 * applies it by itself, because a price is a human decision. The 2026 prices are the ones the form template already
 * charges, so applying it moves no registration total; staff review them on the Meals screen before publishing.
 */
export async function applyCampMeetingMealPreset(eventId: string, actorUserId: string) {
  return getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { startsAt: true, timezone: true } });
    if (!event) throw new MealError("EVENT_NOT_FOUND", "That event does not exist.");
    if ((await tx.eventMealService.count({ where: { eventId } })) > 0 || (await tx.eventMealPlan.count({ where: { eventId } })) > 0) {
      throw new MealError("CONFLICT", "This event already has meal services or plans. The Camp Meeting meals can only be added to an event that has none.");
    }
    const firstDay = calendarDateInEventTimeZone(event.startsAt, event.timezone);
    const created = await createMealDefinitions(tx, eventId, mealDefinitionsFromTemplate(campMeetingMeals, firstDay), actorUserId);
    await writeAuditLog({
      eventId, actorUserId, action: "MEAL_PRESET_APPLIED", entityType: "Event", entityId: eventId,
      summary: "Added the Camp Meeting meal services and plans.", metadata: { preset: "camp-meeting-2026", firstDay, ...created },
    }, tx);
    return created;
  });
}
