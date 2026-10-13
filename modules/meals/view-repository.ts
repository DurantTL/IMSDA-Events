import "server-only";

import { getPrisma } from "@/lib/prisma";
import { mealTicketCsvHeader, mealTicketCsvRow, type MealTicketRow } from "@/modules/meals/domain";
import { toCsv } from "@/modules/reporting/csv";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const liveRegistration = { status: { in: ["SUBMITTED", "CONFIRMED"] as Array<"SUBMITTED" | "CONFIRMED"> } };

/** Everything the staff Meals screen shows, as plain serializable data. */
export async function loadMealView(eventId: string) {
  const prisma = getPrisma();
  const [services, plans, attendeeTypes, activeSelections, recent] = await Promise.all([
    prisma.eventMealService.findMany({ where: { eventId }, orderBy: [{ serviceDate: "asc" }, { startTime: "asc" }, { name: "asc" }] }),
    prisma.eventMealPlan.findMany({
      where: { eventId }, orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { services: true, prices: { orderBy: [{ mealType: "asc" }] } },
    }),
    prisma.eventAttendeeType.findMany({ where: { eventId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, code: true, label: true } }),
    prisma.eventMealSelection.findMany({
      where: { eventId, status: "ACTIVE", OR: [{ registrationId: null }, { registration: liveRegistration }] },
      select: { mealType: true, ageGroup: true, quantity: true, serviceId: true, payer: true },
    }),
    prisma.eventMealSelection.findMany({
      where: { eventId, source: { in: ["STAFF", "WALK_UP", "PLAN_ASSIGNMENT"] } }, orderBy: { createdAt: "desc" }, take: 25,
      select: {
        id: true, mealType: true, ageGroup: true, quantity: true, status: true, source: true, payer: true, unitPriceCents: true, createdAt: true,
        orderLabel: true, service: { select: { name: true, serviceDate: true } }, plan: { select: { name: true } },
        registration: { select: { confirmationCode: true } },
      },
    }),
  ]);
  const pinned = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const row of activeSelections) {
    if (row.serviceId) pinned.set(row.serviceId, (pinned.get(row.serviceId) ?? 0) + row.quantity);
    const key = `${row.mealType}:${row.ageGroup}:${row.payer}`;
    totals.set(key, (totals.get(key) ?? 0) + row.quantity);
  }
  return {
    services: services.map((service) => ({
      id: service.id, name: service.name, mealType: service.mealType, serviceDate: service.serviceDate, startTime: service.startTime,
      endTime: service.endTime, location: service.location, ticketing: service.ticketing, capacity: service.capacity, status: service.status,
      cancelReason: service.cancelReason, pinnedQuantity: pinned.get(service.id) ?? 0,
    })),
    plans: plans.map((plan) => ({
      id: plan.id, code: plan.code, name: plan.name, description: plan.description, payer: plan.payer, isDefaultTicketPlan: plan.isDefaultTicketPlan,
      includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, isActive: plan.isActive,
      services: plan.services.map((row) => ({ serviceId: row.serviceId, entitlement: row.entitlement })),
      prices: plan.prices.map((price) => ({ id: price.id, mealType: price.mealType, ageGroup: price.ageGroup, attendeeTypeId: price.attendeeTypeId, amountCents: price.amountCents })),
    })),
    attendeeTypes,
    totals: [...totals.entries()].map(([key, quantity]) => {
      const [mealType, ageGroup, payer] = key.split(":");
      return { mealType, ageGroup, payer, quantity };
    }),
    recentOrders: recent.map((row) => ({
      id: row.id, mealType: row.mealType, ageGroup: row.ageGroup, quantity: row.quantity, status: row.status, source: row.source, payer: row.payer,
      unitPriceCents: row.unitPriceCents, createdAt: row.createdAt.toISOString(), orderLabel: row.orderLabel, planName: row.plan.name,
      serviceName: row.service ? `${row.service.name} (${row.service.serviceDate})` : null, confirmationCode: row.registration?.confirmationCode ?? null,
    })),
  };
}

export type MealView = Awaited<ReturnType<typeof loadMealView>>;

/** One registration's meal selections with their full change and ledger history, for Finance and registration detail. */
export async function loadRegistrationMeals(eventId: string, registrationId: string) {
  const selections = await getPrisma().eventMealSelection.findMany({
    where: { eventId, registrationId }, orderBy: { createdAt: "asc" },
    include: {
      plan: { select: { name: true } }, service: { select: { name: true, serviceDate: true } },
      changes: { orderBy: { createdAt: "asc" } }, ledger: { orderBy: { createdAt: "asc" } },
    },
  });
  return selections.map((row) => ({
    id: row.id, mealType: row.mealType, ageGroup: row.ageGroup, quantity: row.quantity, status: row.status, source: row.source, payer: row.payer,
    unitPriceCents: row.unitPriceCents, planName: row.plan.name, service: row.service, pricingSnapshot: row.pricingSnapshot,
    sourceFormVersionId: row.sourceFormVersionId, dietaryCategories: row.dietaryCategories,
    changes: row.changes.map((change) => ({ id: change.id, type: change.type, actorName: change.actorName, reason: change.reason, before: change.before, after: change.after, createdAt: change.createdAt.toISOString() })),
    ledger: row.ledger.map((entry) => ({ id: entry.id, kind: entry.kind, quantity: entry.quantity, unitPriceCents: entry.unitPriceCents, amountCents: entry.amountCents, settlement: entry.settlement, createdAt: entry.createdAt.toISOString() })),
  }));
}

/**
 * The stable ticket rows behind the café scanner's CSV: one per active selection of a submitted or confirmed
 * registration, naming the registration, the person (the attendee, or the registration's contact for a ticket bought
 * as a quantity), age group and attendee type, the meal (and its service date when pinned), the quantity and who pays.
 * Walk-up orders are paid at the counter and are not tickets, so they are left out.
 */
export async function loadMealTicketRows(eventId: string): Promise<MealTicketRow[]> {
  const selections = await getPrisma().eventMealSelection.findMany({
    where: { eventId, status: "ACTIVE", registration: liveRegistration, OR: [{ serviceId: null }, { service: { is: { status: "ACTIVE" } } }] },
    orderBy: [{ registration: { confirmationCode: "asc" } }, { mealType: "asc" }, { createdAt: "asc" }],
    include: {
      registration: { select: { confirmationCode: true, contactSnapshot: true } },
      attendee: { select: { profileSnapshot: true, attendeeType: true, attendeeTypeDefinition: { select: { label: true } }, person: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true, serviceDate: true } },
    },
  });
  return selections.map((row) => {
    const contact = record(row.registration?.contactSnapshot);
    const profile = record(row.attendee?.profileSnapshot);
    const first = typeof profile.firstName === "string" ? profile.firstName : row.attendee?.person.firstName ?? (typeof contact.firstName === "string" ? contact.firstName : "");
    const last = typeof profile.lastName === "string" ? profile.lastName : row.attendee?.person.lastName ?? (typeof contact.lastName === "string" ? contact.lastName : "");
    return {
      confirmationCode: row.registration?.confirmationCode ?? "",
      attendeeName: `${first} ${last}`.trim(),
      attendeeType: row.attendee ? row.attendee.attendeeTypeDefinition?.label ?? row.attendee.attendeeType : "",
      ageGroup: row.ageGroup,
      mealType: row.mealType,
      serviceDate: row.service?.serviceDate ?? "",
      serviceName: row.service?.name ?? "",
      quantity: row.quantity,
      payer: row.payer,
      source: row.source,
      selectionId: row.id,
    } satisfies MealTicketRow;
  });
}

export async function mealTicketsCsv(eventId: string) {
  const rows = await loadMealTicketRows(eventId);
  return toCsv([[...mealTicketCsvHeader], ...rows.map(mealTicketCsvRow)]);
}
