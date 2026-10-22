import { z } from "zod";

/**
 * Meals (#210): pure rules for meal services, plans, prices, selections and the ledger. No database and no clock,
 * so the staff screens, the server and the tests price and validate meals the same way.
 *
 * Vocabulary
 * - A **service** is one meal occurrence (date, serving window, place, capacity).
 * - A **plan** groups services under a payer: ATTENDEE plans sell tickets at their prices, CONFERENCE plans entitle
 *   people to meals the conference pays for (staff, pastors, volunteers, #804).
 * - A **selection** is what was ordered or entitled. It is never a redemption (#211) or a preparation count (#212).
 * - The **ledger** is the append-only list of charges and credits a selection's changes produced.
 */

export const mealTypes = ["BREAKFAST", "LUNCH", "SUPPER", "SNACK", "OTHER"] as const;
export type MealTypeValue = (typeof mealTypes)[number];
export const mealTypeLabels: Record<MealTypeValue, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  SUPPER: "Supper",
  SNACK: "Snack",
  OTHER: "Other meal",
};

export const mealAgeGroups = ["ADULT", "CHILD"] as const;
export type MealAgeGroupValue = (typeof mealAgeGroups)[number];
export const mealAgeGroupLabels: Record<MealAgeGroupValue, string> = { ADULT: "Adult", CHILD: "Child" };

export const mealPayers = ["ATTENDEE", "CONFERENCE"] as const;
export type MealPayerValue = (typeof mealPayers)[number];
export const mealPayerLabels: Record<MealPayerValue, string> = { ATTENDEE: "Attendee pays", CONFERENCE: "Conference pays" };

export const mealTicketings = ["TICKETED", "DONATION_ONLY"] as const;
export type MealTicketingValue = (typeof mealTicketings)[number];
export const mealEntitlements = ["PAID", "INCLUDED"] as const;
export type MealEntitlementValue = (typeof mealEntitlements)[number];

export const MAX_MEAL_PRICE_CENTS = 1_000_000;
export const MAX_MEAL_QUANTITY = 1000;

/**
 * The configured, non-medical dietary categories a selection may carry. Allergies, intolerances and accommodation
 * notes are protected detail and never enter this module: a value outside this list is refused, so free text cannot
 * slip in.
 */
export const mealDietaryCategories = ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"] as const;
export type MealDietaryCategory = (typeof mealDietaryCategories)[number];
export const mealDietaryCategoryLabels: Record<MealDietaryCategory, string> = {
  VEGETARIAN: "Vegetarian",
  VEGAN: "Vegan",
  GLUTEN_FREE: "Gluten-free",
};

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Input schemas (staff configuration)
// ---------------------------------------------------------------------------

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-14.").refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a real calendar date.");
const timeText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 17:30.");

export const mealServiceInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  mealType: z.enum(mealTypes),
  serviceDate: dateText,
  startTime: timeText,
  endTime: timeText.nullable().default(null),
  location: z.string().trim().max(120).nullable().default(null),
  ticketing: z.enum(mealTicketings).default("TICKETED"),
  capacity: z.number().int().min(1).max(100_000).nullable().default(null),
}).strict().superRefine((input, context) => {
  if (input.endTime !== null && input.endTime <= input.startTime) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "The serving window must end after it starts." });
  }
});
export type MealServiceInput = z.infer<typeof mealServiceInputSchema>;

export const mealPlanInputSchema = z.object({
  code: z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."),
  name: z.string().trim().min(1, "Enter a name.").max(80),
  description: z.string().trim().max(500).default(""),
  payer: z.enum(mealPayers).default("ATTENDEE"),
  isDefaultTicketPlan: z.boolean().default(false),
  includesAllServices: z.boolean().default(false),
  defaultEntitlement: z.enum(mealEntitlements).default("PAID"),
  isActive: z.boolean().default(true),
}).strict().superRefine((input, context) => {
  if (input.payer === "CONFERENCE" && input.defaultEntitlement !== "INCLUDED") {
    context.addIssue({ code: "custom", path: ["defaultEntitlement"], message: "A conference-paid plan includes its meals; the attendee is never charged." });
  }
  if (input.isDefaultTicketPlan && (input.payer !== "ATTENDEE" || !input.isActive)) {
    context.addIssue({ code: "custom", path: ["isDefaultTicketPlan"], message: "The ticket plan must be an active attendee-paid plan." });
  }
});
export type MealPlanInput = z.infer<typeof mealPlanInputSchema>;

export const mealPlanServiceInputSchema = z.object({
  serviceId: z.string().trim().min(1).max(64),
  entitlement: z.enum(mealEntitlements),
}).strict();

export const mealPriceInputSchema = z.object({
  mealType: z.enum(mealTypes),
  ageGroup: z.enum(mealAgeGroups).nullable().default(null),
  attendeeTypeId: z.string().trim().min(1).max(64).nullable().default(null),
  amountCents: z.number().int().min(0).max(MAX_MEAL_PRICE_CENTS),
}).strict().superRefine((input, context) => {
  if ((input.ageGroup === null) === (input.attendeeTypeId === null)) {
    context.addIssue({ code: "custom", path: ["ageGroup"], message: "Price an age group or an attendee type, not both." });
  }
});
export type MealPriceInput = z.infer<typeof mealPriceInputSchema>;

const reasonText = z.string().trim().min(3, "Enter a reason.").max(500);
const dietaryList = z.array(z.enum(mealDietaryCategories)).max(mealDietaryCategories.length).default([]);

/** A staff order: a late addition for a registration, or a walk-up order (no registration). */
export const mealOrderInputSchema = z.object({
  registrationId: z.string().trim().min(1).max(64).nullable().default(null),
  registrationAttendeeId: z.string().trim().min(1).max(64).nullable().default(null),
  planId: z.string().trim().min(1).max(64).optional(),
  mealType: z.enum(mealTypes),
  serviceId: z.string().trim().min(1).max(64).nullable().default(null),
  ageGroup: z.enum(mealAgeGroups),
  quantity: z.number().int().min(1).max(MAX_MEAL_QUANTITY),
  dietaryCategories: dietaryList,
  orderLabel: z.string().trim().max(60).nullable().default(null),
  clientRequestId: z.string().trim().min(8).max(80),
  reason: reasonText.optional(),
}).strict().superRefine((input, context) => {
  if (input.registrationId === null && input.registrationAttendeeId !== null) {
    context.addIssue({ code: "custom", path: ["registrationAttendeeId"], message: "An attendee needs a registration." });
  }
  if (input.registrationId === null && input.serviceId === null) {
    context.addIssue({ code: "custom", path: ["serviceId"], message: "A walk-up order is for one meal service." });
  }
});
export type MealOrderInput = z.infer<typeof mealOrderInputSchema>;

export const mealChangeQuantityInputSchema = z.object({ quantity: z.number().int().min(1).max(MAX_MEAL_QUANTITY), reason: reasonText }).strict();
export const mealCancelInputSchema = z.object({ reason: reasonText }).strict();
export const mealChangePlanInputSchema = z.object({ planId: z.string().trim().min(1).max(64), reason: reasonText }).strict();
export const mealSubstituteInputSchema = z.object({
  mealType: z.enum(mealTypes),
  serviceId: z.string().trim().min(1).max(64).nullable().default(null),
  reason: reasonText,
}).strict();
export const mealEntitleInputSchema = z.object({
  registrationAttendeeId: z.string().trim().min(1).max(64),
  planId: z.string().trim().min(1).max(64),
  ageGroup: z.enum(mealAgeGroups).default("ADULT"),
  reason: reasonText,
}).strict();

// ---------------------------------------------------------------------------
// Coverage and pricing
// ---------------------------------------------------------------------------

export type PlanShape = {
  id: string;
  payer: MealPayerValue;
  includesAllServices: boolean;
  defaultEntitlement: MealEntitlementValue;
  isActive: boolean;
};
export type ServiceShape = {
  id: string;
  mealType: MealTypeValue;
  ticketing: MealTicketingValue;
  status: "ACTIVE" | "CANCELLED";
};
export type PlanServiceRow = { serviceId: string; entitlement: MealEntitlementValue };

/**
 * How a plan treats one service: `null` when the plan does not cover it (or the service sells no ticket, is
 * cancelled, or the plan is inactive), else PAID or INCLUDED. A plan-service row wins over the plan's default.
 */
export function serviceCoverage(plan: PlanShape, rows: readonly PlanServiceRow[], service: ServiceShape): MealEntitlementValue | null {
  if (!plan.isActive || service.status !== "ACTIVE" || service.ticketing !== "TICKETED") return null;
  const row = rows.find((candidate) => candidate.serviceId === service.id);
  const entitlement = row ? row.entitlement : plan.includesAllServices ? plan.defaultEntitlement : null;
  if (entitlement === null) return null;
  return plan.payer === "CONFERENCE" ? "INCLUDED" : entitlement;
}

/** The coverage of a meal type: the plan covers it when it covers at least one active ticketed service of that type. */
export function mealTypeCoverage(plan: PlanShape, rows: readonly PlanServiceRow[], services: readonly ServiceShape[], mealType: MealTypeValue): MealEntitlementValue | null {
  const covered = services
    .filter((service) => service.mealType === mealType)
    .map((service) => serviceCoverage(plan, rows, service));
  if (covered.includes("PAID")) return "PAID";
  if (covered.includes("INCLUDED")) return "INCLUDED";
  return null;
}

export type PriceRow = {
  id: string;
  mealType: MealTypeValue;
  ageGroup: MealAgeGroupValue | null;
  attendeeTypeId: string | null;
  amountCents: number;
};

export type PriceRule = "ATTENDEE_TYPE" | "AGE_GROUP" | "INCLUDED" | "CONFERENCE_PAID" | "FORM_FIELD";

export type ResolvedPrice = {
  /** What the attendee is charged per meal. */
  unitPriceCents: number;
  /** What the conference is billed per meal used (conference-paid plans only; read by #212). */
  conferenceRateCents: number;
  rule: PriceRule;
  priceRowId: string | null;
};

/**
 * One meal's price. An attendee type's own price beats the age group's (zero makes that role complimentary). An
 * INCLUDED service is free to the attendee whatever the rows say. Under a CONFERENCE plan the attendee is never
 * charged; the matching row is the rate the conference is billed per meal used. Null when a PAID meal has no price:
 * it is refused, never guessed.
 */
export function resolveMealPrice(input: {
  plan: PlanShape;
  coverage: MealEntitlementValue;
  prices: readonly PriceRow[];
  mealType: MealTypeValue;
  ageGroup: MealAgeGroupValue;
  attendeeTypeId: string | null;
}): ResolvedPrice | null {
  const forType = input.attendeeTypeId
    ? input.prices.find((row) => row.mealType === input.mealType && row.attendeeTypeId === input.attendeeTypeId)
    : undefined;
  const forAge = input.prices.find((row) => row.mealType === input.mealType && row.ageGroup === input.ageGroup);
  const row = forType ?? forAge ?? null;
  if (input.plan.payer === "CONFERENCE") {
    return { unitPriceCents: 0, conferenceRateCents: row?.amountCents ?? 0, rule: "CONFERENCE_PAID", priceRowId: row?.id ?? null };
  }
  if (input.coverage === "INCLUDED") return { unitPriceCents: 0, conferenceRateCents: 0, rule: "INCLUDED", priceRowId: row?.id ?? null };
  if (!row) return null;
  return { unitPriceCents: row.amountCents, conferenceRateCents: 0, rule: forType ? "ATTENDEE_TYPE" : "AGE_GROUP", priceRowId: row.id };
}

// ---------------------------------------------------------------------------
// Selections and ledger entries
// ---------------------------------------------------------------------------

export type SelectionState = {
  quantity: number;
  unitPriceCents: number;
  payer: MealPayerValue;
};

export type LedgerDraft = {
  kind: "CHARGE" | "CREDIT";
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
};

/** A charge for `quantity` meals at `unitPriceCents`; none when it costs nothing. */
export function chargeEntry(quantity: number, unitPriceCents: number): LedgerDraft | null {
  if (quantity <= 0 || unitPriceCents <= 0) return null;
  return { kind: "CHARGE", quantity, unitPriceCents, amountCents: quantity * unitPriceCents };
}

/** A credit for `quantity` meals at the price they were charged at. */
export function creditEntry(quantity: number, unitPriceCents: number): LedgerDraft | null {
  if (quantity <= 0 || unitPriceCents <= 0) return null;
  return { kind: "CREDIT", quantity, unitPriceCents, amountCents: -(quantity * unitPriceCents) };
}

/**
 * Ledger entries for changing a selection's quantity. Extra meals are charged and removed meals are credited at the
 * selection's own copied price, so what someone agreed to pay never shifts under them. A conference-paid selection
 * never produces an entry.
 */
export function quantityChangeEntries(before: SelectionState, nextQuantity: number): LedgerDraft[] {
  if (before.payer === "CONFERENCE") return [];
  const delta = nextQuantity - before.quantity;
  const entry = delta > 0 ? chargeEntry(delta, before.unitPriceCents) : creditEntry(-delta, before.unitPriceCents);
  return entry ? [entry] : [];
}

/** A cancellation credits everything that was charged. */
export function cancellationEntries(before: SelectionState): LedgerDraft[] {
  if (before.payer === "CONFERENCE") return [];
  const entry = creditEntry(before.quantity, before.unitPriceCents);
  return entry ? [entry] : [];
}

export function sumCents(entries: readonly { amountCents: number }[]) {
  return entries.reduce((total, entry) => total + entry.amountCents, 0);
}

/** A walk-up order is for one service, takes no registration, and is settled at the counter. */
export function isWalkUp(input: { registrationId: string | null }) {
  return input.registrationId === null;
}

// ---------------------------------------------------------------------------
// Registration form tickets (the Camp Meeting template)
// ---------------------------------------------------------------------------

/**
 * The registration form collects tickets as quantities per meal type and age group in six NUMBER fields. Those keys
 * are a long-standing contract of the Camp Meeting template and the "Meal ticket quantities" builder module, so they
 * bind a field to the meal model without changing any stored form. A selection made from one is a ticket good for
 * any service of that meal type (it is not pinned to a day).
 */
export const mealTicketFieldKeys = [
  ["breakfast_adult_qty", "BREAKFAST", "ADULT"],
  ["breakfast_child_qty", "BREAKFAST", "CHILD"],
  ["lunch_adult_qty", "LUNCH", "ADULT"],
  ["lunch_child_qty", "LUNCH", "CHILD"],
  ["supper_adult_qty", "SUPPER", "ADULT"],
  ["supper_child_qty", "SUPPER", "CHILD"],
] as const satisfies ReadonlyArray<readonly [string, MealTypeValue, MealAgeGroupValue]>;

export type MealTicketBinding = { mealType: MealTypeValue; ageGroup: MealAgeGroupValue };

export function mealTicketBinding(fieldKey: string): MealTicketBinding | null {
  const found = mealTicketFieldKeys.find(([key]) => key === fieldKey);
  return found ? { mealType: found[1], ageGroup: found[2] } : null;
}

type FormFieldLike = {
  key: string;
  type: string;
  scope: string;
  label: string;
  priceCents?: number;
  latePricing?: { startsOn: string; priceCents?: number } | undefined;
};
type FormDefinitionLike<F extends FormFieldLike> = { sections: Array<{ fields: F[] }> };

const LABEL_PRICE = /\s—\s\$[\d,]+(?:\.\d{2})?\seach$/;

/** The meal-bound ticket fields of a form: registration-level NUMBER fields with one of the six keys. */
export function mealTicketFields<F extends FormFieldLike>(definition: FormDefinitionLike<F>) {
  return definition.sections.flatMap((section) => section.fields).filter((field) => field.type === "NUMBER" && field.scope === "REGISTRATION" && mealTicketBinding(field.key) !== null);
}

/**
 * The form with each bound ticket field's price taken from the meal plan, so the plan is the one place a ticket price
 * is set. A field whose plan has no price keeps what it had. The label's "— $7 each" follows the price. A late price is dropped
 * from a bound field: the plan has one price per meal, so a form cannot carry a second, different one.
 */
export function applyMealPricesToDefinition<F extends FormFieldLike, D extends FormDefinitionLike<F>>(definition: D, prices: ReadonlyMap<string, number>): D {
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const binding = field.type === "NUMBER" && field.scope === "REGISTRATION" ? mealTicketBinding(field.key) : null;
        const cents = binding ? prices.get(`${binding.mealType}:${binding.ageGroup}`) : undefined;
        if (!binding || cents === undefined) return field;
        const label = LABEL_PRICE.test(field.label) ? field.label.replace(LABEL_PRICE, ` — ${money(cents).replace(/\.00$/, "")} each`) : field.label;
        return { ...field, priceCents: cents, label, latePricing: undefined };
      }),
    })),
  } as D;
}

/**
 * The form with every bound ticket field's price removed: no price, no late price, and no "— $7 each" label suffix. Used when a
 * form becomes a template (#1065), so one event's meal prices never travel into another event; the plan sets them again on creation.
 */
export function stripMealPricesFromDefinition<F extends FormFieldLike, D extends FormDefinitionLike<F>>(definition: D): D {
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (!(field.type === "NUMBER" && field.scope === "REGISTRATION" && mealTicketBinding(field.key))) return field;
        const rest: typeof field = { ...field, label: field.label.replace(LABEL_PRICE, "") };
        delete rest.priceCents;
        delete rest.latePricing;
        return rest;
      }),
    })),
  } as D;
}

/** Fields whose price differs from the plan's: the draft was saved before the plan's price changed. */
export function mealPriceDrift<F extends FormFieldLike>(definition: FormDefinitionLike<F>, prices: ReadonlyMap<string, number>) {
  return mealTicketFields(definition).filter((field) => {
    const binding = mealTicketBinding(field.key)!;
    const cents = prices.get(`${binding.mealType}:${binding.ageGroup}`);
    return cents !== undefined && (field.priceCents !== cents || field.latePricing !== undefined);
  }).map((field) => field.key);
}

export type TicketQuantity = { mealType: MealTypeValue; ageGroup: MealAgeGroupValue; quantity: number; fieldKey: string };

/** The ticket quantities a registration's answers hold. Hidden or blank fields are zero. */
export function ticketQuantitiesFromAnswers(responses: Record<string, unknown>): TicketQuantity[] {
  const result: TicketQuantity[] = [];
  for (const [fieldKey, mealType, ageGroup] of mealTicketFieldKeys) {
    const raw = Number(responses[fieldKey]);
    const quantity = Number.isFinite(raw) ? Math.min(MAX_MEAL_QUANTITY, Math.max(0, Math.trunc(raw))) : 0;
    if (quantity > 0) result.push({ mealType, ageGroup, quantity, fieldKey });
  }
  return result;
}

export type FormSyncAction =
  | { action: "CREATE"; mealType: MealTypeValue; ageGroup: MealAgeGroupValue; quantity: number; fieldKey: string }
  | { action: "SET_QUANTITY"; selectionId: string; quantity: number }
  | { action: "CANCEL"; selectionId: string };

/** What it takes to make the active form-sourced tickets match the answers. */
export function diffFormTickets(
  desired: readonly TicketQuantity[],
  existing: ReadonlyArray<{ id: string; mealType: MealTypeValue; ageGroup: MealAgeGroupValue; quantity: number }>,
): FormSyncAction[] {
  const actions: FormSyncAction[] = [];
  for (const want of desired) {
    const have = existing.find((row) => row.mealType === want.mealType && row.ageGroup === want.ageGroup);
    if (!have) actions.push({ action: "CREATE", ...want });
    else if (have.quantity !== want.quantity) actions.push({ action: "SET_QUANTITY", selectionId: have.id, quantity: want.quantity });
  }
  for (const have of existing) {
    if (!desired.some((want) => want.mealType === have.mealType && want.ageGroup === have.ageGroup)) actions.push({ action: "CANCEL", selectionId: have.id });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Ticket rows for the café export
// ---------------------------------------------------------------------------

export type MealTicketRow = {
  confirmationCode: string;
  attendeeName: string;
  attendeeType: string;
  ageGroup: MealAgeGroupValue | null;
  mealType: MealTypeValue;
  /** The service date for a ticket pinned to a service; empty for a ticket good for any service of the meal type. */
  serviceDate: string;
  serviceName: string;
  quantity: number;
  payer: MealPayerValue;
  source: string;
  selectionId: string;
};

export const mealTicketCsvHeader = [
  "Confirmation code", "Attendee", "Attendee type", "Age group", "Meal", "Service date", "Service", "Quantity", "Payer", "Source", "Ticket id",
] as const;

export function mealTicketCsvRow(row: MealTicketRow): string[] {
  return [
    row.confirmationCode,
    row.attendeeName,
    row.attendeeType,
    row.ageGroup ? mealAgeGroupLabels[row.ageGroup] : "",
    mealTypeLabels[row.mealType],
    row.serviceDate,
    row.serviceName,
    String(row.quantity),
    row.payer === "CONFERENCE" ? "Conference" : "Attendee",
    row.source,
    row.selectionId,
  ];
}

// ---------------------------------------------------------------------------
// The café scanner's import file (#916): one row per ticket, stable ticket ids
// ---------------------------------------------------------------------------

/** The scanner's columns, in its order. The scanner fills redeemed_at and redeemed_by; notes is always empty. */
export const scannerTicketCsvHeader = [
  "ticket_id", "reg_id", "guest_name", "meal_type", "meal_day", "meal_date", "ticket_type", "price", "redeemed", "redeemed_at", "redeemed_by", "notes",
] as const;

/** The meal types the scanner knows, in service order. Snacks and other services are not scanner tickets. */
export const scannerMealTypes = ["BREAKFAST", "LUNCH", "SUPPER"] as const satisfies readonly MealTypeValue[];

export type ScannerTicket = {
  /** The event-unique number kept in EventMealTicket. */
  number: number;
  confirmationCode: string;
  guestName: string;
  mealType: MealTypeValue;
  /** The event-local service date (YYYY-MM-DD); empty for a ticket good for any service of the meal type. */
  serviceDate: string;
  ageGroup: MealAgeGroupValue | null;
  unitPriceCents: number;
  payer: MealPayerValue;
};

/** `MT-` and the number, at least five digits: `MT-01234`. The number is stored, so the id never changes; more digits once it passes 99999. */
export function mealTicketId(number: number): string {
  return `MT-${String(number).padStart(5, "0")}`;
}

const dayCodes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * The three-letter lowercase weekday of an event-local calendar date. The service date is already a calendar date in
 * the event's time zone, so the weekday is read from the date itself (never from an instant converted in the server's zone).
 */
export function scannerMealDay(serviceDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return "";
  const day = new Date(`${serviceDate}T12:00:00Z`);
  return Number.isNaN(day.getTime()) ? "" : dayCodes[day.getUTCDay()]!;
}

/** Whole dollars when the cents are 0 (`8`), otherwise a decimal (`7.50`). Zero when the conference pays. */
export function scannerPrice(unitPriceCents: number, payer: MealPayerValue): string {
  const cents = payer === "CONFERENCE" ? 0 : Math.max(0, Math.round(unitPriceCents));
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Rows sorted by meal date (undated last), meal, registration, guest, then ticket number. */
export function scannerTicketCsvRows(tickets: readonly ScannerTicket[]): string[][] {
  const mealOrder = (mealType: MealTypeValue) => scannerMealTypes.indexOf(mealType as (typeof scannerMealTypes)[number]);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...tickets].sort((a, b) =>
    compare(a.serviceDate || "9999-99-99", b.serviceDate || "9999-99-99")
    || mealOrder(a.mealType) - mealOrder(b.mealType)
    || compare(a.confirmationCode, b.confirmationCode)
    || compare(a.guestName, b.guestName)
    || a.number - b.number);
  return sorted.map((ticket) => [
    mealTicketId(ticket.number),
    ticket.confirmationCode,
    ticket.guestName,
    ticket.mealType.toLowerCase(),
    scannerMealDay(ticket.serviceDate),
    ticket.serviceDate,
    ticket.ageGroup === "CHILD" ? "child" : "adult",
    scannerPrice(ticket.unitPriceCents, ticket.payer),
    "no",
    "",
    "",
    "",
  ]);
}

const liveStatuses = ["SUBMITTED", "CONFIRMED"];
/** A registration still counts for meals (capacity, the café CSV, totals) while it is submitted or confirmed. */
export const isLiveRegistrationStatus = (status: string) => liveStatuses.includes(status);

/** Selections that count toward a service's capacity: walk-up orders and those of a submitted or confirmed registration. */
export const countsTowardCapacity = {
  status: "ACTIVE" as const,
  OR: [{ registrationId: null }, { registration: { status: { in: ["SUBMITTED", "CONFIRMED"] as Array<"SUBMITTED" | "CONFIRMED"> } } }],
};
