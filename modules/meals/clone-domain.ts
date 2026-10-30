import { z } from "zod";
import {
  mealAgeGroups,
  mealEntitlements,
  mealPayers,
  mealPlanInputSchema,
  mealTicketings,
  mealTypes,
  type MealAgeGroupValue,
  type MealEntitlementValue,
  type MealPayerValue,
  type MealTicketingValue,
  type MealTypeValue,
  mealServiceInputSchema,
} from "@/modules/meals/domain";

/**
 * Meal definitions as a clone or a template carries them (#210): services, plans, which services a plan lists and the
 * prices. Never a selection, an order, a ledger entry or a redemption: those belong to the event they happened in.
 */
export type MealDefinitionService = {
  name: string;
  mealType: MealTypeValue;
  serviceDate: string;
  startTime: string;
  endTime: string | null;
  location: string | null;
  ticketing: MealTicketingValue;
  capacity: number | null;
  position: number;
};

export type MealDefinitionPlan = {
  code: string;
  name: string;
  description: string;
  payer: MealPayerValue;
  isDefaultTicketPlan: boolean;
  includesAllServices: boolean;
  defaultEntitlement: MealEntitlementValue;
  position: number;
  services: Array<{ serviceName: string; serviceDate: string; entitlement: MealEntitlementValue }>;
  /** A price names an age group, or an attendee type by its code (matched in the new event; skipped when it has none). */
  prices: Array<{ mealType: MealTypeValue; ageGroup: MealAgeGroupValue | null; attendeeTypeCode: string | null; amountCents: number }>;
};

export type MealDefinitions = { services: MealDefinitionService[]; plans: MealDefinitionPlan[] };

export const emptyMealDefinitions: MealDefinitions = { services: [], plans: [] };

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The definitions with every service date moved by the same number of days as the event's start date. */
export function shiftMealDefinitions(definitions: MealDefinitions, days: number): MealDefinitions {
  return {
    services: definitions.services.map((service) => ({ ...service, serviceDate: addDays(service.serviceDate, days) })),
    plans: definitions.plans.map((plan) => ({
      ...plan,
      services: plan.services.map((row) => ({ ...row, serviceDate: addDays(row.serviceDate, days) })),
    })),
  };
}

export function mealPriceCount(definitions: MealDefinitions) {
  return definitions.plans.reduce((total, plan) => total + plan.prices.length, 0);
}

// ---------------------------------------------------------------------------
// Templates: dates are day offsets from the new event's first day
// ---------------------------------------------------------------------------

const timeText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const templateMealServiceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mealType: z.enum(mealTypes),
  dayOffset: z.number().int().min(0).max(365),
  startTime: timeText,
  endTime: timeText.nullable().default(null),
  location: z.string().trim().max(120).nullable().default(null),
  ticketing: z.enum(mealTicketings).default("TICKETED"),
  capacity: z.number().int().min(1).max(100_000).nullable().default(null),
}).strict();

export const templateMealPlanSchema = z.object({
  code: mealPlanInputSchema.shape.code,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  payer: z.enum(mealPayers).default("ATTENDEE"),
  isDefaultTicketPlan: z.boolean().default(false),
  includesAllServices: z.boolean().default(false),
  defaultEntitlement: z.enum(mealEntitlements).default("PAID"),
  services: z.array(z.object({ serviceName: z.string().trim().min(1).max(80), dayOffset: z.number().int().min(0).max(365), entitlement: z.enum(mealEntitlements) }).strict()).max(200).default([]),
  prices: z.array(z.object({
    mealType: z.enum(mealTypes),
    ageGroup: z.enum(mealAgeGroups).nullable().default(null),
    attendeeTypeCode: z.string().trim().min(2).max(40).nullable().default(null),
    amountCents: z.number().int().min(0).max(1_000_000),
  }).strict()).max(200).default([]),
}).strict();

export const templateMealsSchema = z.object({
  services: z.array(templateMealServiceSchema).max(100).default([]),
  plans: z.array(templateMealPlanSchema).max(20).default([]),
}).strict().superRefine((meals, context) => {
  const seen = new Set<string>();
  meals.services.forEach((service, index) => {
    const { dayOffset: _dayOffset, ...rest } = service;
    void _dayOffset;
    const parsed = mealServiceInputSchema.safeParse({ ...rest, serviceDate: "2026-01-01" });
    if (!parsed.success) context.addIssue({ code: "custom", path: ["services", index], message: parsed.error.issues[0]?.message ?? "Check the meal service." });
    const key = `${service.dayOffset}|${service.name.toLocaleLowerCase("en-US")}`;
    if (seen.has(key)) context.addIssue({ code: "custom", path: ["services", index, "name"], message: `Meal service ${service.name} is repeated on the same day.` });
    seen.add(key);
  });
  const codes = new Set<string>();
  meals.plans.forEach((plan, index) => {
    if (codes.has(plan.code)) context.addIssue({ code: "custom", path: ["plans", index, "code"], message: `Meal plan ${plan.code} is repeated.` });
    codes.add(plan.code);
    const { services: _services, prices: _prices, ...planFields } = plan;
    void _services;
    void _prices;
    const parsed = mealPlanInputSchema.safeParse(planFields);
    if (!parsed.success) context.addIssue({ code: "custom", path: ["plans", index], message: parsed.error.issues[0]?.message ?? "Check the meal plan." });
    plan.services.forEach((row, rowIndex) => {
      if (!meals.services.some((service) => service.name === row.serviceName && service.dayOffset === row.dayOffset)) {
        context.addIssue({ code: "custom", path: ["plans", index, "services", rowIndex], message: "A plan lists a meal service the template does not have." });
      }
    });
    plan.prices.forEach((price, priceIndex) => {
      if ((price.ageGroup === null) === (price.attendeeTypeCode === null)) {
        context.addIssue({ code: "custom", path: ["plans", index, "prices", priceIndex], message: "Price an age group or an attendee type, not both." });
      }
    });
  });
  if (meals.plans.filter((plan) => plan.isDefaultTicketPlan).length > 1) {
    context.addIssue({ code: "custom", path: ["plans"], message: "Only one plan can be the ticket plan." });
  }
});

export type TemplateMeals = z.infer<typeof templateMealsSchema>;

/** A template's meals as dated definitions for an event whose first day is `firstDay`. */
export function mealDefinitionsFromTemplate(meals: TemplateMeals, firstDay: string): MealDefinitions {
  return {
    services: meals.services.map((service, index) => ({
      name: service.name, mealType: service.mealType, serviceDate: addDays(firstDay, service.dayOffset), startTime: service.startTime,
      endTime: service.endTime, location: service.location, ticketing: service.ticketing, capacity: service.capacity, position: index + 1,
    })),
    plans: meals.plans.map((plan, index) => ({
      code: plan.code, name: plan.name, description: plan.description, payer: plan.payer, isDefaultTicketPlan: plan.isDefaultTicketPlan,
      includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, position: index + 1,
      services: plan.services.map((row) => ({ serviceName: row.serviceName, serviceDate: addDays(firstDay, row.dayOffset), entitlement: row.entitlement })),
      prices: plan.prices.map((price) => ({ ...price })),
    })),
  };
}

/** Whole days from one calendar date to another. */
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/**
 * The inverse of `mealDefinitionsFromTemplate` (#154): a source event's meal definitions as template meals, each date
 * a day offset from the event's first day. Built field by field, never by spreading a row. A service dated before the
 * first day or more than a year after it has no valid offset, so it is left out, together with every plan row that
 * names it; the counts say what was left out. The result is checked against `templateMealsSchema`, and `null` (with the
 * first problem) is returned when the definitions cannot be a template.
 */
export function templateMealsFromDefinitions(definitions: MealDefinitions, firstDay: string): {
  meals: TemplateMeals | null;
  issue: string | null;
  skippedServices: number;
  skippedPlanServices: number;
} {
  const offsetOf = (date: string) => {
    const offset = daysBetween(firstDay, date);
    return offset >= 0 && offset <= 365 ? offset : null;
  };
  const services: TemplateMeals["services"] = [];
  let skippedServices = 0;
  for (const service of definitions.services) {
    const dayOffset = offsetOf(service.serviceDate);
    if (dayOffset === null) {
      skippedServices += 1;
      continue;
    }
    services.push({
      name: service.name, mealType: service.mealType, dayOffset, startTime: service.startTime, endTime: service.endTime,
      location: service.location, ticketing: service.ticketing, capacity: service.capacity,
    });
  }
  let skippedPlanServices = 0;
  const plans: TemplateMeals["plans"] = definitions.plans.map((plan) => ({
    code: plan.code, name: plan.name, description: plan.description, payer: plan.payer, isDefaultTicketPlan: plan.isDefaultTicketPlan,
    includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement,
    services: plan.services.flatMap((row) => {
      const dayOffset = offsetOf(row.serviceDate);
      if (dayOffset === null || !services.some((service) => service.name === row.serviceName && service.dayOffset === dayOffset)) {
        skippedPlanServices += 1;
        return [];
      }
      return [{ serviceName: row.serviceName, dayOffset, entitlement: row.entitlement }];
    }),
    prices: plan.prices.map((price) => ({
      mealType: price.mealType, ageGroup: price.ageGroup, attendeeTypeCode: price.attendeeTypeCode, amountCents: price.amountCents,
    })),
  }));
  if (services.length === 0 && plans.length === 0) return { meals: null, issue: null, skippedServices, skippedPlanServices };
  const parsed = templateMealsSchema.safeParse({ services, plans });
  if (!parsed.success) {
    return { meals: null, issue: parsed.error.issues[0]?.message ?? "The meal definitions cannot be saved in a template.", skippedServices, skippedPlanServices };
  }
  return { meals: parsed.data, issue: null, skippedServices, skippedPlanServices };
}
