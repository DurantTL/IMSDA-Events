import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { MealDefinitions } from "@/modules/meals/clone-domain";

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * The meal definitions of an event for a clone: active services and active plans with the services they list and
 * their prices. Selections, orders, the ledger and every change history are never read.
 */
export async function loadMealDefinitions(db: Client, eventId: string): Promise<MealDefinitions> {
  const [services, plans] = await Promise.all([
    db.eventMealService.findMany({ where: { eventId, status: "ACTIVE" }, orderBy: [{ serviceDate: "asc" }, { startTime: "asc" }, { name: "asc" }] }),
    db.eventMealPlan.findMany({
      where: { eventId, isActive: true }, orderBy: [{ position: "asc" }, { code: "asc" }],
      include: { services: true, prices: { include: { attendeeType: { select: { code: true } } }, orderBy: [{ mealType: "asc" }, { ageGroup: "asc" }] } },
    }),
  ]);
  const byId = new Map(services.map((service) => [service.id, service]));
  return {
    services: services.map((service, index) => ({
      name: service.name, mealType: service.mealType, serviceDate: service.serviceDate, startTime: service.startTime, endTime: service.endTime,
      location: service.location, ticketing: service.ticketing, capacity: service.capacity, position: index + 1,
    })),
    plans: plans.map((plan, index) => ({
      code: plan.code, name: plan.name, description: plan.description, payer: plan.payer, isDefaultTicketPlan: plan.isDefaultTicketPlan,
      includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, position: index + 1,
      services: plan.services.flatMap((row) => {
        const service = byId.get(row.serviceId);
        return service ? [{ serviceName: service.name, serviceDate: service.serviceDate, entitlement: row.entitlement }] : [];
      }),
      prices: plan.prices.map((price) => ({ mealType: price.mealType, ageGroup: price.ageGroup, attendeeTypeCode: price.attendeeType?.code ?? null, amountCents: price.amountCents })),
    })),
  };
}

/**
 * Creates definitions on an event inside the caller's transaction (a clone or a template). The event must have no
 * meal services yet. A price for an attendee type is made only when the new event has a type with that code.
 */
export async function createMealDefinitions(tx: Prisma.TransactionClient, eventId: string, definitions: MealDefinitions, actorUserId: string | null) {
  const result = { services: 0, plans: 0, prices: 0, skippedPrices: 0 };
  if (definitions.services.length === 0 && definitions.plans.length === 0) return result;
  const serviceIds = new Map<string, string>();
  for (const service of definitions.services) {
    const created = await tx.eventMealService.create({
      data: {
        eventId, name: service.name, mealType: service.mealType, serviceDate: service.serviceDate, startTime: service.startTime, endTime: service.endTime,
        location: service.location, ticketing: service.ticketing, capacity: service.capacity, position: service.position, createdByUserId: actorUserId,
      },
    });
    await tx.eventMealServiceChange.create({
      data: { eventId, serviceId: created.id, type: "CREATED", actorUserId, reason: "Copied from the event's meal definitions.", after: { name: created.name, serviceDate: created.serviceDate, mealType: created.mealType } },
    });
    serviceIds.set(`${service.serviceDate}|${service.name}`, created.id);
    result.services += 1;
  }
  const types = new Map((await tx.eventAttendeeType.findMany({ where: { eventId }, select: { id: true, code: true } })).map((type) => [type.code, type.id]));
  for (const plan of definitions.plans) {
    const created = await tx.eventMealPlan.create({
      data: {
        eventId, code: plan.code, name: plan.name, description: plan.description, payer: plan.payer, isDefaultTicketPlan: plan.isDefaultTicketPlan,
        includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, position: plan.position, createdByUserId: actorUserId,
      },
    });
    result.plans += 1;
    for (const row of plan.services) {
      const serviceId = serviceIds.get(`${row.serviceDate}|${row.serviceName}`);
      if (serviceId) await tx.eventMealPlanService.create({ data: { eventId, planId: created.id, serviceId, entitlement: row.entitlement } });
    }
    for (const price of plan.prices) {
      const attendeeTypeId = price.attendeeTypeCode ? types.get(price.attendeeTypeCode) ?? null : null;
      if (price.attendeeTypeCode && !attendeeTypeId) { result.skippedPrices += 1; continue; }
      await tx.eventMealPrice.create({
        data: { eventId, planId: created.id, mealType: price.mealType, ageGroup: price.ageGroup, attendeeTypeId, amountCents: price.amountCents, updatedByUserId: actorUserId },
      });
      result.prices += 1;
    }
  }
  return result;
}
