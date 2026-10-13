/**
 * Proves meal services, plans, pricing, selections and the meal ledger (#210) against a real PostgreSQL database,
 * where unit tests cannot:
 *
 * - the Camp Meeting meal definitions create the 2026 services and prices; Saturday lunch is donation-only and sells
 *   no ticket;
 * - a registration form submission records the tickets it priced as selections and ledger entries without moving the
 *   registration's total, and an amendment's changed answers follow (history kept, nothing deleted);
 * - a staff order is priced at the plan's price (child and adult), posts a MEAL adjustment that moves the registration
 *   total, and a quantity change, a plan change, a substitution and a cancellation each append charges or credits at
 *   the price that was charged, keeping every prior selection;
 * - a price for an attendee type of $0 makes that role complimentary (no ledger entry, no adjustment);
 * - a conference-paid plan entitles an attendee to every ticketed meal without charging them, carrying the rate the
 *   conference is billed, and running it again adds only new services;
 * - walk-up orders have no registration, are settled at the counter, are retry-safe and respect capacity;
 * - cancelling a service credits what is pinned to it, refuses (and changes nothing) when a credit would take a
 *   registration below what it paid, and refuses new orders for it;
 * - editing a plan price never rewrites a past selection, and a draft form takes its ticket prices from the plan;
 * - the database refuses to rewrite or delete the ledger, the history and a selection;
 * - a clone copies definitions (dates moved) and never a selection, a ledger entry or a history row;
 * - event deletion removes every meal row.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:meals
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { cloneEvent, previewEventClone } from "@/modules/event-clones/repository";
import { cloneDomainKeys, type CloneDomainKey } from "@/modules/event-clones/domain";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { createRegistrationFormFromDefinitionInTransaction, getRegistrationForm, updateRegistrationForm } from "@/modules/forms/repository";
import { getPublicRegistrationExperience, submitPublicRegistration } from "@/modules/forms/public-repository";
import type { PublicRegistrationInput } from "@/modules/forms/public-domain";
import { campMeetingMeals } from "@/modules/meals/camp-meeting";
import { mealDefinitionsFromTemplate } from "@/modules/meals/clone-domain";
import { createMealDefinitions } from "@/modules/meals/clone-repository";
import { applyCampMeetingMealPreset, createMealPlan, createMealService, loadTicketPrices, removeMealPrice, setMealPrice, updateMealService } from "@/modules/meals/config-repository";
import { MealError } from "@/modules/meals/errors";
import {
  cancelMealSelection,
  cancelMealSelectionsForAttendees,
  plannedAttendeeMealCredit,
  cancelMealService,
  changeMealPlan,
  changeMealQuantity,
  createMealOrder,
  entitleAttendeeToPlan,
  substituteMealSelection,
  syncFormMealSelections,
} from "@/modules/meals/selection-repository";
import { loadMealTicketRows, loadRegistrationMeals, mealTicketsCsv } from "@/modules/meals/view-repository";
import { removeEventOwnedRows } from "@/modules/events/deletion-repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-meals-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `meals210_${randomUUID().slice(0, 8)}`;
const userId = `${P}_user`;
const eventId = `${P}_ev`;
const formSlug = `${P}-form`;
const formId = `${P}_form`;
const versionId = `${P}_form_v1`;
const surname = `Meal${P}`;
const before = new Date("2027-06-01T12:00:00Z");
const slugOf = (id: string) => `${id}-slug`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

async function expectMealError(promise: Promise<unknown>, code: string, message: string) {
  const error = await caught(promise);
  assert(error instanceof MealError && error.code === code, `${message}: expected ${code}, got ${String(error)}`);
}

async function expectDatabaseRefusal(promise: Promise<unknown>, message: string) {
  assert(await caught(promise), `${message}: the database accepted it`);
}

async function cleanup() {
  const events = (await prisma.event.findMany({ where: { id: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  const cloned = (await prisma.event.findMany({ where: { slug: { startsWith: `${P.replace(/_/g, "-")}-` } }, select: { id: true } })).map((row) => row.id);
  for (const id of [...events, ...cloned]) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
      await tx.eventMealLedgerEntry.deleteMany({ where: { eventId: id } });
      await tx.eventMealSelectionChange.deleteMany({ where: { eventId: id } });
      await tx.eventMealSelection.deleteMany({ where: { eventId: id } });
      await tx.eventMealServiceChange.deleteMany({ where: { eventId: id } });
    });
  }
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: [...events, ...cloned] } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.event.deleteMany({ where: { id: { in: [...events, ...cloned] } } });
  await prisma.person.deleteMany({ where: { OR: [{ lastName: surname }, { normalizedEmail: { startsWith: `${P}.` } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { in: [...events, ...cloned] } }] } });
  await prisma.eventCloneRecord.deleteMany({ where: { actorUserId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

const priceField = (key: string, label: string, cents: number) => ({
  id: `${P}_${key}`, key, label, helpText: "", type: "NUMBER", scope: "REGISTRATION", required: false, options: [], priceCents: cents,
});

const formDefinition = registrationFormDefinitionSchema.parse({
  title: "Meal verification",
  description: "Temporary fictitious form used only by the meal check.",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 8, attendeeLabel: "Guest", addButtonLabel: "Add another guest" },
  sections: [
    {
      id: `${P}_contact`, title: "Contact", description: "", fields: [
        { id: `${P}_f_first`, key: "primary_contact_first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
        { id: `${P}_f_last`, key: "primary_contact_last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
        { id: `${P}_f_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
      ],
    },
    {
      id: `${P}_guests`, title: "Guests", description: "", fields: [
        { id: `${P}_a_first`, key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: `${P}_a_last`, key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      ],
    },
    {
      id: `${P}_meals`, title: "Meal tickets", description: "", fields: [
        priceField("breakfast_adult_qty", "Adult breakfast tickets — $7 each", 700),
        priceField("breakfast_child_qty", "Child breakfast tickets — $6 each", 600),
        priceField("supper_adult_qty", "Adult supper tickets — $8 each", 800),
      ],
    },
  ],
});

let counter = 0;
async function makeRegistration(tag: string, options: { total?: number; status?: "CONFIRMED" | "SUBMITTED" | "WAITLISTED"; typeId?: string; forEvent?: string } = {}) {
  counter += 1;
  const person = await prisma.person.create({ data: { firstName: `Alder${tag}`, lastName: surname, normalizedEmail: `${P}.${tag}.${counter}@meals.example.test` } });
  const code = `MEAL-${P.slice(-8).toUpperCase()}${tag.toUpperCase()}`;
  const registration = await prisma.registration.create({
    data: { eventId: options.forEvent ?? eventId, accountHolderPersonId: person.id, confirmationCode: code, status: options.status ?? "CONFIRMED", totalAmount: options.total ?? 0, submittedAt: before, contactSnapshot: { firstName: person.firstName, lastName: person.lastName } },
  });
  const attendee = await prisma.registrationAttendee.create({
    data: {
      eventId: options.forEvent ?? eventId, registrationId: registration.id, personId: person.id, attendeeType: "adult", position: 0,
      attendeeTypeDefinitionId: options.typeId ?? null, profileSnapshot: { firstName: person.firstName, lastName: person.lastName },
    },
  });
  return { id: registration.id, code, attendeeId: attendee.id };
}

const totalOf = async (registrationId: string) => Math.round(Number((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).totalAmount) * 100);
const ledgerSum = async (registrationId: string) => (await prisma.eventMealLedgerEntry.aggregate({ where: { registrationId }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
const adjustmentSum = async (registrationId: string, kind = "MEAL" as const) => (await prisma.registrationAdjustment.aggregate({ where: { registrationId, kind }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: userId, email: `${P}@meals.example.test`, displayName: "Meal verifier" } });
  await prisma.event.create({
    data: {
      id: eventId, slug: slugOf(eventId), name: `Meal check ${P}`, startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-19T15:00:00Z"),
      timezone: "America/Chicago", registrationClosesOn: "2027-06-14", attendeeEditPolicy: "TIERED", isPublished: true,
    },
  });
  const staffType = await prisma.eventAttendeeType.create({ data: { eventId, code: "STAFF", label: "Staff" } });

  // ---- Definitions (the Camp Meeting meals) -------------------------------------------------------------------
  const created = await applyCampMeetingMealPreset(eventId, userId);
  assert(created.services === 13 && created.plans === 2 && created.prices === 12, `Camp Meeting meals created (${JSON.stringify(created)})`);
  await expectMealError(applyCampMeetingMealPreset(eventId, userId), "CONFLICT", "applying the preset twice");
  // A template payload carries the same definitions (dates as offsets): it creates them on an event that has none.
  const templateEvent = `${P}_ev_tpl`;
  await prisma.event.create({ data: { id: templateEvent, slug: slugOf(templateEvent), name: `Meal template ${P}`, startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-19T15:00:00Z"), timezone: "America/Chicago" } });
  const fromTemplate = await prisma.$transaction((tx) => createMealDefinitions(tx, templateEvent, mealDefinitionsFromTemplate(campMeetingMeals, "2027-06-15"), userId));
  assert(fromTemplate.services === 13 && fromTemplate.prices === 12, "a template creates the same definitions");
  assert((await prisma.eventMealSelection.count({ where: { eventId: templateEvent } })) === 0, "a template never creates an order");
  const services = await prisma.eventMealService.findMany({ where: { eventId }, orderBy: [{ serviceDate: "asc" }, { startTime: "asc" }] });
  const service = (name: string) => services.find((row) => row.name === name)!;
  assert(service("Wednesday breakfast").serviceDate === "2027-06-16" && service("Tuesday supper").serviceDate === "2027-06-15", "service dates follow the first day");
  assert(!services.some((row) => row.mealType === "BREAKFAST" && row.serviceDate === "2027-06-15"), "no Tuesday breakfast");
  assert(!services.some((row) => row.mealType === "LUNCH" && row.serviceDate === "2027-06-19" && row.ticketing === "TICKETED"), "Saturday lunch sells no ticket");
  const saturdayLunch = service("Saturday lunch (donation)");
  assert(saturdayLunch.ticketing === "DONATION_ONLY", "Saturday lunch is donation-only");
  const ticketPlan = await prisma.eventMealPlan.findFirstOrThrow({ where: { eventId, code: "meal-tickets" } });
  const conferencePlan = await prisma.eventMealPlan.findFirstOrThrow({ where: { eventId, code: "conference-paid" } });
  assert(ticketPlan.isDefaultTicketPlan && conferencePlan.payer === "CONFERENCE" && conferencePlan.defaultEntitlement === "INCLUDED", "plans carry their payer");
  assert((await loadTicketPrices(prisma, eventId)).get("BREAKFAST:CHILD") === 600, "the ticket plan's child breakfast price is $6");
  await expectDatabaseRefusal(prisma.eventMealPlan.create({ data: { eventId, code: "second-default", name: "Second", isDefaultTicketPlan: true } }), "a second default ticket plan");
  await expectMealError(createMealOrder(eventId, userId, { registrationId: null, serviceId: saturdayLunch.id, mealType: "LUNCH", ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() }), "DONATION_ONLY", "a ticket for the donation-only lunch");
  await prisma.eventMealPrice.create({ data: { eventId, planId: ticketPlan.id, mealType: "SUPPER", attendeeTypeId: staffType.id, amountCents: 0 } });

  // ---- A form draft takes its ticket prices from the plan ---------------------------------------------------------
  await prisma.registrationForm.create({
    data: {
      id: formId, eventId, createdByUserId: userId, name: formDefinition.title, slug: formSlug, status: RegistrationFormStatus.PUBLISHED,
      versions: { create: { id: versionId, createdByUserId: userId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition: formDefinition } },
    },
  });
  const draftForm = await prisma.$transaction((tx) => createRegistrationFormFromDefinitionInTransaction(tx, eventId, userId, {
    definition: { ...formDefinition, title: "Meal draft" }, summary: (name) => `Created ${name}.`, metadata: {},
  }));
  const draftDefinition = (await getRegistrationForm(eventId, draftForm.id))!;
  const draftFields = (definition: { sections: Array<{ fields: Array<{ key: string; priceCents?: number; label: string }> }> }, key: string) =>
    definition.sections.flatMap((section) => section.fields).find((field) => field.key === key)!;
  assert(draftFields(draftDefinition.activeVersion!.definition as never, "breakfast_adult_qty").priceCents === 700, "a new form takes the plan's adult breakfast price");
  await setMealPrice(eventId, ticketPlan.id, userId, { mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 750 });
  const saved = await updateRegistrationForm(eventId, draftForm.id, userId, { definition: draftDefinition.activeVersion!.definition as never, expectedUpdatedAt: draftDefinition.activeVersion!.updatedAt });
  const savedField = draftFields(saved.activeVersion!.definition as never, "breakfast_adult_qty");
  assert(savedField.priceCents === 750 && savedField.label.endsWith("$7.50 each"), `saving a draft re-prices ticket fields from the plan (${savedField.priceCents}, ${savedField.label})`);
  await setMealPrice(eventId, ticketPlan.id, userId, { mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 700 });

  // ---- Registration form tickets ---------------------------------------------------------------------------------
  const experience = await getPublicRegistrationExperience(slugOf(eventId), formSlug);
  assert(experience, "the verification form is public");
  const input: PublicRegistrationInput = {
    versionId, idempotencyKey: randomUUID(),
    responses: { primary_contact_first_name: "Mea", primary_contact_last_name: "Holder", email: `${P}.sub@meals.example.test`, breakfast_adult_qty: 2, breakfast_child_qty: 1, supper_adult_qty: 3 },
    attendees: [{ clientId: "p0", responses: { first_name: "Guest", last_name: surname } }],
    website: "",
  } as PublicRegistrationInput;
  const submitted = await submitPublicRegistration(slugOf(eventId), formSlug, input, before);
  const formRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId, confirmationCode: submitted.confirmationCode } });
  const formTotal = await totalOf(formRegistration.id);
  assert(formTotal === 1400 + 600 + 2400, `the form priced the tickets into the total ($${formTotal / 100})`);
  const formSelections = await prisma.eventMealSelection.findMany({ where: { registrationId: formRegistration.id }, orderBy: [{ mealType: "asc" }, { ageGroup: "asc" }] });
  assert(formSelections.length === 3 && formSelections.every((row) => row.source === "REGISTRATION_FORM" && row.serviceId === null && row.sourceFormVersionId === versionId), "three form tickets recorded with their form version");
  assert(formSelections.find((row) => row.mealType === "BREAKFAST" && row.ageGroup === "CHILD")!.unitPriceCents === 600, "the child ticket keeps the child price");
  assert(await ledgerSum(formRegistration.id) === formTotal, "the ledger adds up to what the form priced");
  assert((await prisma.eventMealLedgerEntry.count({ where: { registrationId: formRegistration.id, settlement: "IN_REGISTRATION_PRICING" } })) === 3, "form entries are already in the registration pricing");
  assert((await adjustmentSum(formRegistration.id)) === 0 && await totalOf(formRegistration.id) === formTotal, "recording form tickets does not move the registration total");
  // An amendment's answers follow: fewer adult breakfasts, supper removed, a new child ticket line.
  await prisma.$transaction((tx) => syncFormMealSelections(tx, {
    eventId, registrationId: formRegistration.id, formVersionId: versionId, responses: { breakfast_adult_qty: 1, breakfast_child_qty: 1 },
    previousResponses: { breakfast_adult_qty: 2, breakfast_child_qty: 1, supper_adult_qty: 3 },
    lineItems: [{ key: "breakfast_adult_qty", amountCents: 700 }, { key: "breakfast_child_qty", amountCents: 600 }],
  }));
  const afterAmend = await prisma.eventMealSelection.findMany({ where: { registrationId: formRegistration.id }, include: { changes: true } });
  assert(afterAmend.filter((row) => row.status === "ACTIVE").length === 2 && afterAmend.filter((row) => row.status === "CANCELLED").length === 1, "an amendment cancels the supper ticket and keeps its row");
  assert(await ledgerSum(formRegistration.id) === 700 + 600, "the ledger follows the amended form total");
  assert((await adjustmentSum(formRegistration.id)) === 0 && await totalOf(formRegistration.id) === formTotal, "following an amendment never posts an adjustment of its own (the form re-prices)");
  assert(afterAmend.every((row) => row.changes.length >= 1), "every selection keeps its history");

  // ---- Staff orders -------------------------------------------------------------------------------------------------
  const paying = await makeRegistration("pay", { total: 50 });
  const wednesdayLunch = service("Wednesday lunch");
  const childLunch = await createMealOrder(eventId, userId, { registrationId: paying.id, registrationAttendeeId: paying.attendeeId, mealType: "LUNCH", serviceId: wednesdayLunch.id, ageGroup: "CHILD", quantity: 2, clientRequestId: randomUUID() });
  let selection = await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: childLunch } });
  assert(selection.unitPriceCents === 700 && selection.source === "STAFF" && selection.payer === "ATTENDEE", "a child lunch is $7");
  assert(await totalOf(paying.id) === 5000 + 1400 && await adjustmentSum(paying.id) === 1400, "a staff order posts a MEAL adjustment that moves the total");
  await expectMealError(createMealOrder(eventId, userId, { registrationId: paying.id, registrationAttendeeId: paying.attendeeId, mealType: "LUNCH", serviceId: wednesdayLunch.id, ageGroup: "CHILD", quantity: 1, clientRequestId: randomUUID() }), "DUPLICATE", "the same meal twice");
  const adultLunch = await createMealOrder(eventId, userId, { registrationId: paying.id, registrationAttendeeId: paying.attendeeId, mealType: "LUNCH", serviceId: wednesdayLunch.id, ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() });
  assert((await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: adultLunch } })).unitPriceCents === 800 && await totalOf(paying.id) === 5000 + 1400 + 800, "an adult lunch is $8");

  await changeMealQuantity(eventId, childLunch, userId, { quantity: 1, reason: "One child is not coming" });
  assert(await totalOf(paying.id) === 5000 + 700 + 800, "a lower quantity credits at the price charged");
  await changeMealQuantity(eventId, childLunch, userId, { quantity: 3, reason: "Two more children" });
  assert(await totalOf(paying.id) === 5000 + 2100 + 800 && await ledgerSum(paying.id) === await adjustmentSum(paying.id), "a higher quantity charges again and the ledger matches the adjustments");
  await expectMealError(changeMealQuantity(eventId, formSelections[0]!.id, userId, { quantity: 5, reason: "Staff change" }), "FROM_FORM", "staff editing a form ticket");

  // Substitution: Wednesday lunch (child, 3) becomes Thursday supper at the child price.
  const thursdaySupper = service("Thursday supper");
  await substituteMealSelection(eventId, childLunch, userId, { mealType: "SUPPER", serviceId: thursdaySupper.id, reason: "Swapped for supper" });
  const afterSwap = await prisma.eventMealSelection.findMany({ where: { registrationId: paying.id, ageGroup: "CHILD" }, orderBy: { createdAt: "asc" } });
  assert(afterSwap.length === 2 && afterSwap[0]!.status === "CANCELLED" && afterSwap[1]!.status === "ACTIVE" && afterSwap[1]!.replacesSelectionId === childLunch, "a substitution keeps the old selection and links the new one");
  assert(afterSwap[1]!.unitPriceCents === 700 && await totalOf(paying.id) === 5000 + 2100 + 800, "the child supper is $7 and the net change is zero");

  // Plan change: the paid adult lunch moves to the conference-paid plan (credit only), then back (charge at today's price).
  await changeMealPlan(eventId, adultLunch, userId, { planId: conferencePlan.id, reason: "Now a volunteer" });
  selection = await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: adultLunch } });
  assert(selection.payer === "CONFERENCE" && selection.unitPriceCents === 0 && selection.conferenceRateCents === 800, "a conference-paid selection charges nothing and keeps the rate");
  assert(await totalOf(paying.id) === 5000 + 2100, "moving to a conference plan credits what was charged");
  await setMealPrice(eventId, ticketPlan.id, userId, { mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 900 });
  await changeMealPlan(eventId, adultLunch, userId, { planId: ticketPlan.id, reason: "Back to paying" });
  assert(await totalOf(paying.id) === 5000 + 2100 + 900, "moving back to a ticket plan charges that plan's current price");
  await setMealPrice(eventId, ticketPlan.id, userId, { mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 800 });
  const adultLunchRow = await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: adultLunch }, include: { changes: { orderBy: { createdAt: "asc" } } } });
  assert(adultLunchRow.unitPriceCents === 900 && adultLunchRow.changes.map((change) => change.type).join() === "CREATED,PLAN_CHANGED,PLAN_CHANGED", "a later price edit never rewrites the selection, and the plan changes are in its history");
  const firstChange = adultLunchRow.changes[0]!;
  assert((firstChange.after as { unitPriceCents: number }).unitPriceCents === 800, "the history still shows the price it was made at");

  // Cancelling a selection credits it.
  await cancelMealSelection(eventId, adultLunch, userId, { reason: "No longer needed" });
  assert(await totalOf(paying.id) === 5000 + 2100 && (await prisma.eventMealSelection.count({ where: { registrationId: paying.id, status: "ACTIVE" } })) === 1, "a cancellation credits the price charged");
  await expectMealError(cancelMealSelection(eventId, adultLunch, userId, { reason: "Again" }), "ALREADY_CANCELLED", "cancelling twice");

  // ---- Complimentary roles ------------------------------------------------------------------------------------------
  const staffRegistration = await makeRegistration("stf", { total: 0, typeId: staffType.id });
  const totalBefore = await totalOf(staffRegistration.id);
  const comp = await createMealOrder(eventId, userId, { registrationId: staffRegistration.id, registrationAttendeeId: staffRegistration.attendeeId, mealType: "SUPPER", serviceId: service("Friday supper").id, ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() });
  assert((await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: comp } })).unitPriceCents === 0, "a $0 price for the staff type makes supper complimentary");
  assert(await totalOf(staffRegistration.id) === totalBefore && (await prisma.eventMealLedgerEntry.count({ where: { selectionId: comp } })) === 0 && (await prisma.registrationAdjustment.count({ where: { registrationId: staffRegistration.id } })) === 0, "a complimentary meal writes no ledger entry and no adjustment");
  await expectMealError(createMealOrder(eventId, userId, { registrationId: staffRegistration.id, registrationAttendeeId: staffRegistration.attendeeId, mealType: "LUNCH", serviceId: service("Friday lunch").id, ageGroup: "ADULT", quantity: 1, planId: conferencePlan.id, clientRequestId: randomUUID() }), "INVALID", "ordering under a conference plan");
  await prisma.eventMealPrice.deleteMany({ where: { planId: ticketPlan.id, mealType: "BREAKFAST", ageGroup: "ADULT" } });
  await expectMealError(createMealOrder(eventId, userId, { registrationId: staffRegistration.id, mealType: "BREAKFAST", serviceId: service("Friday breakfast").id, ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() }), "PRICE_MISSING", "a paid meal with no price");
  await prisma.eventMealPrice.create({ data: { eventId, planId: ticketPlan.id, mealType: "BREAKFAST", ageGroup: "ADULT", amountCents: 700 } });

  // ---- Conference-paid entitlement ----------------------------------------------------------------------------------
  const entitled = await makeRegistration("ent", { total: 0 });
  const first = await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: entitled.attendeeId, planId: conferencePlan.id, ageGroup: "ADULT", reason: "Pastor registration" });
  assert(first.length === 12, `every ticketed service is entitled (${first.length}), the donation lunch is not`);
  const entitledRows = await prisma.eventMealSelection.findMany({ where: { registrationId: entitled.id } });
  assert(entitledRows.every((row) => row.payer === "CONFERENCE" && row.unitPriceCents === 0 && row.source === "PLAN_ASSIGNMENT" && row.serviceId !== null), "entitlements are conference-paid, per service");
  assert(entitledRows.find((row) => row.mealType === "BREAKFAST")!.conferenceRateCents === 700, "an entitlement carries the rate the conference is billed");
  assert(await totalOf(entitled.id) === 0 && (await prisma.eventMealLedgerEntry.count({ where: { registrationId: entitled.id } })) === 0, "the attendee is never charged");
  assert((await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: entitled.attendeeId, planId: conferencePlan.id, ageGroup: "ADULT", reason: "Again" })).length === 0, "entitling again adds nothing");
  await createMealService(eventId, userId, { name: "Sunday breakfast", mealType: "BREAKFAST", serviceDate: "2027-06-20", startTime: "07:30", endTime: "08:30", location: null, ticketing: "TICKETED", capacity: null });
  assert((await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: entitled.attendeeId, planId: conferencePlan.id, ageGroup: "ADULT", reason: "New meal" })).length === 1, "a service added later is entitled on the next run");
  await expectMealError(entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: entitled.attendeeId, planId: ticketPlan.id, ageGroup: "ADULT", reason: "Wrong plan" }), "INVALID", "entitling to a ticket plan");

  // ---- Substitution on a paid registration: charge first, so a net increase never trips the below-paid check ------------
  const subReg = await makeRegistration("sub", { total: 10 });
  const wedBreakfast = service("Wednesday breakfast");
  const subOrder = await createMealOrder(eventId, userId, { registrationId: subReg.id, registrationAttendeeId: subReg.attendeeId, mealType: "BREAKFAST", serviceId: wedBreakfast.id, ageGroup: "CHILD", quantity: 1, clientRequestId: randomUUID() });
  assert(await totalOf(subReg.id) === 1600, "a child breakfast is $6");
  await prisma.payment.create({ data: { eventId, registrationId: subReg.id, amount: 16, status: "SUCCEEDED", method: "CASH", receivedAt: before } });
  await substituteMealSelection(eventId, subOrder, userId, { mealType: "LUNCH", serviceId: service("Thursday lunch").id, reason: "Swapped for lunch" });
  assert(await totalOf(subReg.id) === 1700, "a paid registration swapping a $6 meal for a $7 meal ends at the new total, not refused");

  // ---- A cancelled registration: its selections do not count for capacity and a service cancellation still goes through -----
  const capacityService = await createMealService(eventId, userId, { name: "Capacity test", mealType: "SUPPER", serviceDate: "2027-06-21", startTime: "17:30", endTime: "18:30", location: null, ticketing: "TICKETED", capacity: 2 });
  const lateReg = await makeRegistration("late", { total: 0 });
  const lateOrder = await createMealOrder(eventId, userId, { registrationId: lateReg.id, registrationAttendeeId: lateReg.attendeeId, mealType: "SUPPER", serviceId: capacityService, ageGroup: "ADULT", quantity: 2, clientRequestId: randomUUID() });
  await prisma.registration.update({ where: { id: lateReg.id }, data: { status: "CANCELLED", cancelledAt: before } });
  const capacityWalkUp = await createMealOrder(eventId, userId, { registrationId: null, serviceId: capacityService, mealType: "SUPPER", ageGroup: "ADULT", quantity: 2, clientRequestId: randomUUID() });
  assert(Boolean(capacityWalkUp), "a cancelled registration's selections do not use up the service's capacity");
  const lateTotal = await totalOf(lateReg.id);
  const cancelOutcome = await cancelMealService(eventId, capacityService, userId, { reason: "Kitchen closed" });
  assert(cancelOutcome.cancelledSelections === 2 && await totalOf(lateReg.id) === lateTotal, "a service cancellation goes through with a cancelled registration among its orders and posts nothing to it");
  const notLive = await prisma.eventMealLedgerEntry.findFirstOrThrow({ where: { selectionId: lateOrder, kind: "CREDIT" } });
  assert(notLive.settlement === "REGISTRATION_NOT_LIVE" && notLive.registrationAdjustmentId === null, "the credit is on the ledger, not on the cancelled registration");

  // ---- A staff order does not collide with a form ticket (and an amendment never fails on it) ----------------------------
  await createMealOrder(eventId, userId, { registrationId: formRegistration.id, mealType: "BREAKFAST", serviceId: null, ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() }).catch((error: unknown) => {
    throw new Error(`FAILED: a staff order for the same meal as a form ticket: ${String(error)}`);
  });
  await prisma.$transaction((tx) => syncFormMealSelections(tx, {
    eventId, registrationId: formRegistration.id, formVersionId: versionId, responses: { breakfast_adult_qty: 2, breakfast_child_qty: 1 },
    previousResponses: { breakfast_adult_qty: 1, breakfast_child_qty: 1 },
    lineItems: [{ key: "breakfast_adult_qty", amountCents: 1400 }, { key: "breakfast_child_qty", amountCents: 600 }],
  }));
  const bothAdult = await prisma.eventMealSelection.findMany({ where: { registrationId: formRegistration.id, mealType: "BREAKFAST", ageGroup: "ADULT", status: "ACTIVE" } });
  assert(bothAdult.length === 2 && bothAdult.some((row) => row.source === "STAFF" && row.quantity === 1) && bothAdult.some((row) => row.source === "REGISTRATION_FORM" && row.quantity === 2), "the form ticket follows the answers and the staff order is left alone");

  // ---- Entitlement keeps paid extra meals ---------------------------------------------------------------------------------
  const keepReg = await makeRegistration("keep", { total: 0 });
  const paidThree = await createMealOrder(eventId, userId, { registrationId: keepReg.id, registrationAttendeeId: keepReg.attendeeId, mealType: "BREAKFAST", serviceId: wedBreakfast.id, ageGroup: "ADULT", quantity: 3, clientRequestId: randomUUID() });
  const paidOne = await createMealOrder(eventId, userId, { registrationId: keepReg.id, registrationAttendeeId: keepReg.attendeeId, mealType: "BREAKFAST", serviceId: service("Thursday breakfast").id, ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() });
  assert(await totalOf(keepReg.id) === 2800, "four paid breakfasts are $28");
  await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: keepReg.attendeeId, planId: conferencePlan.id, ageGroup: "ADULT", reason: "Now a volunteer" });
  const stillPaid0 = await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: paidThree } });
  assert(stillPaid0.quantity === 2, "(entitled once)");
  // Moving the entitlement to another conference plan replaces only the entitlement; the paid meals are left alone.
  const conferenceTwo = await createMealPlan(eventId, userId, { code: "conference-two", name: "Conference two", payer: "CONFERENCE", includesAllServices: true, defaultEntitlement: "INCLUDED" });
  await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: keepReg.attendeeId, planId: conferenceTwo, ageGroup: "ADULT", reason: "Moved to the other conference plan" });
  const wedSlot = await prisma.eventMealSelection.findMany({ where: { registrationId: keepReg.id, mealType: "BREAKFAST", serviceId: wedBreakfast.id, status: "ACTIVE" } });
  assert(wedSlot.length === 2 && wedSlot.some((row) => row.payer === "ATTENDEE" && row.quantity === 2) && wedSlot.some((row) => row.payer === "CONFERENCE" && row.planId === conferenceTwo), "re-entitling to another plan keeps the paid meals at two");
  assert(await totalOf(keepReg.id) === 1400, "and credits nothing more");
  // Moving the paid order onto a conference plan while an entitlement holds that slot is a clear conflict, not a 500.
  await expectMealError(changeMealPlan(eventId, paidThree, userId, { planId: conferencePlan.id, reason: "Try to move" }), "DUPLICATE", "a plan change into an occupied slot");
  const stillPaid = await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: paidThree } });
  assert(stillPaid.status === "ACTIVE" && stillPaid.quantity === 2 && stillPaid.payer === "ATTENDEE", "an order of three keeps two paid meals when one becomes the entitlement");
  assert((await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: paidOne } })).status === "CANCELLED", "an order of one is replaced by the entitlement");
  assert(await totalOf(keepReg.id) === 1400, "the attendee is credited only for the two entitled meals ($28 to $14)");
  assert((await prisma.eventMealSelection.count({ where: { registrationId: keepReg.id, mealType: "BREAKFAST", serviceId: wedBreakfast.id, status: "ACTIVE" } })) === 2, "the paid meals and the entitlement sit side by side");

  // ---- Cancelling or lowering an order on a cancelled registration is ledgered only ------------------------------------------
  const ghost = await makeRegistration("ghost", { total: 0 });
  const ghostOrder = await createMealOrder(eventId, userId, { registrationId: ghost.id, registrationAttendeeId: ghost.attendeeId, mealType: "SUPPER", serviceId: service("Thursday supper").id, ageGroup: "ADULT", quantity: 2, clientRequestId: randomUUID() });
  await prisma.registration.update({ where: { id: ghost.id }, data: { status: "CANCELLED", cancelledAt: before } });
  const ghostTotal = await totalOf(ghost.id);
  await changeMealQuantity(eventId, ghostOrder, userId, { quantity: 1, reason: "Fewer meals" });
  await cancelMealSelection(eventId, ghostOrder, userId, { reason: "Cancelled registration" });
  assert(await totalOf(ghost.id) === ghostTotal, "nothing is posted to a cancelled registration");
  assert((await prisma.eventMealLedgerEntry.count({ where: { selectionId: ghostOrder, kind: "CREDIT", settlement: "REGISTRATION_NOT_LIVE" } })) === 2, "both credits are on the ledger, marked not live");

  // ---- Removing an attendee (an amendment) cancels and credits their meals before the row goes ------------------------------
  const remReg = await makeRegistration("rem", { total: 0 });
  const secondPerson = await prisma.person.create({ data: { firstName: "Birch", lastName: surname, normalizedEmail: `${P}.birch@meals.example.test` } });
  const secondAttendee = await prisma.registrationAttendee.create({ data: { eventId, registrationId: remReg.id, personId: secondPerson.id, attendeeType: "adult", position: 1, profileSnapshot: { firstName: "Birch", lastName: surname } } });
  await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: secondAttendee.id, planId: conferencePlan.id, ageGroup: "ADULT", reason: "Pastor" });
  const removedPaid = await createMealOrder(eventId, userId, { registrationId: remReg.id, registrationAttendeeId: secondAttendee.id, mealType: "LUNCH", serviceId: service("Wednesday lunch").id, ageGroup: "ADULT", quantity: 2, clientRequestId: randomUUID() });
  const remBefore = await totalOf(remReg.id);
  assert(remBefore === 1600, "two adult lunches are $16");
  // The amendment prices the credit first, read-only; the cancellation must post exactly that or the whole amendment rolls back.
  const plannedCredit = await prisma.$transaction((tx) => plannedAttendeeMealCredit(tx, { registrationId: remReg.id, attendeeIds: [secondAttendee.id], registrationStatus: "CONFIRMED" }));
  assert(plannedCredit === -1600, "the planned credit is exactly the paid meals (the conference entitlements add nothing)");
  assert(await prisma.$transaction((tx) => plannedAttendeeMealCredit(tx, { registrationId: remReg.id, attendeeIds: [secondAttendee.id], registrationStatus: "CANCELLED" })) === 0, "nothing is planned for a registration that is not live");
  const wrongExpectation = await caught(prisma.$transaction((tx) => cancelMealSelectionsForAttendees(tx, { eventId, registrationId: remReg.id, attendeeIds: [secondAttendee.id], actorUserId: userId, expectedCreditCents: -1500 })));
  assert(wrongExpectation instanceof MealError && wrongExpectation.code === "CONFLICT", "a credit that differs from the quoted one refuses");
  assert(await totalOf(remReg.id) === 1600 && (await prisma.eventMealSelection.count({ where: { registrationId: remReg.id, status: "ACTIVE" } })) > 1, "and the refused cancellation changed nothing");
  const removalCredit = await prisma.$transaction(async (tx) => {
    const posted = await cancelMealSelectionsForAttendees(tx, { eventId, registrationId: remReg.id, attendeeIds: [secondAttendee.id], actorUserId: userId, expectedCreditCents: plannedCredit });
    await tx.registrationAttendee.deleteMany({ where: { id: secondAttendee.id } });
    return posted;
  });
  assert(removalCredit === -1600 && await totalOf(remReg.id) === 0, "the removed attendee's paid meals are credited and the total follows");
  const orphans = await prisma.eventMealSelection.findMany({ where: { registrationId: remReg.id } });
  assert(orphans.length > 1 && orphans.every((row) => row.status === "CANCELLED" && row.registrationAttendeeId === null), "nothing is left active for a removed attendee, and removing them does not fail");
  assert((await prisma.eventMealSelectionChange.count({ where: { selectionId: removedPaid, type: "CANCELLED" } })) === 1, "the removal is in the history");
  assert(!(await loadMealTicketRows(eventId)).some((row) => row.confirmationCode === remReg.code), "a removed attendee's meals are not in the café CSV");

  // ---- Ticket CSV ---------------------------------------------------------------------------------------------------------
  const ticketRows = await loadMealTicketRows(eventId);
  const csv = await mealTicketsCsv(eventId);
  assert(ticketRows.some((row) => row.confirmationCode === entitled.code && row.payer === "CONFERENCE" && row.serviceDate === "2027-06-16"), "the ticket rows name the registration, service date and payer");
  assert(ticketRows.some((row) => row.confirmationCode === formRegistration.confirmationCode && row.serviceDate === "" && row.attendeeName.length > 0), "a form ticket good for any service has no service date");
  assert(csv.startsWith('"Confirmation code","Attendee"') && !ticketRows.some((row) => row.source === "WALK_UP"), "the CSV has the café columns and no walk-up orders");

  // ---- Walk-up orders -----------------------------------------------------------------------------------------------------
  const thursdayLunch = service("Thursday lunch");
  await updateMealService(eventId, thursdayLunch.id, userId, { name: "Thursday lunch", mealType: "LUNCH", serviceDate: thursdayLunch.serviceDate, startTime: thursdayLunch.startTime, endTime: thursdayLunch.endTime, location: "Cafeteria", ticketing: "TICKETED", capacity: 6 });
  const requestId = randomUUID();
  const walkUp = await createMealOrder(eventId, userId, { registrationId: null, serviceId: thursdayLunch.id, mealType: "LUNCH", ageGroup: "ADULT", quantity: 2, orderLabel: "Day visitor", clientRequestId: requestId });
  const again = await createMealOrder(eventId, userId, { registrationId: null, serviceId: thursdayLunch.id, mealType: "LUNCH", ageGroup: "ADULT", quantity: 2, orderLabel: "Day visitor", clientRequestId: requestId });
  assert(walkUp === again && (await prisma.eventMealSelection.count({ where: { eventId, clientRequestId: requestId } })) === 1, "a retried walk-up order is the same order");
  await expectMealError(createMealOrder(eventId, userId, { registrationId: null, serviceId: thursdayLunch.id, mealType: "LUNCH", ageGroup: "ADULT", quantity: 1, clientRequestId: requestId }), "REQUEST_REUSED", "a request id reused for another order");
  const walkUpEntry = await prisma.eventMealLedgerEntry.findFirstOrThrow({ where: { selectionId: walkUp } });
  assert(walkUpEntry.settlement === "AT_COUNTER" && walkUpEntry.registrationId === null && walkUpEntry.amountCents === 1600, "a walk-up order is settled at the counter, not on a registration");
  await expectMealError(createMealOrder(eventId, userId, { registrationId: null, serviceId: thursdayLunch.id, mealType: "LUNCH", ageGroup: "CHILD", quantity: 2, clientRequestId: randomUUID() }), "CAPACITY_FULL", "a service at capacity");
  await expectMealError(updateMealService(eventId, thursdayLunch.id, userId, { name: "Thursday lunch", mealType: "LUNCH", serviceDate: thursdayLunch.serviceDate, startTime: thursdayLunch.startTime, endTime: thursdayLunch.endTime, location: "Cafeteria", ticketing: "TICKETED", capacity: 1 }), "CAPACITY_FULL", "lowering capacity below the orders");

  // ---- Cancelled services -------------------------------------------------------------------------------------------------
  const friday = service("Friday lunch");
  const fridayOrder = await createMealOrder(eventId, userId, { registrationId: paying.id, registrationAttendeeId: paying.attendeeId, mealType: "LUNCH", serviceId: friday.id, ageGroup: "ADULT", quantity: 2, clientRequestId: randomUUID() });
  const fridayWalkUp = await createMealOrder(eventId, userId, { registrationId: null, serviceId: friday.id, mealType: "LUNCH", ageGroup: "CHILD", quantity: 1, clientRequestId: randomUUID() });
  const payingTotal = await totalOf(paying.id);
  // A payment equal to the total means the credit would take it below what was paid: nothing may change.
  await prisma.payment.create({ data: { eventId, registrationId: paying.id, amount: payingTotal / 100, status: "SUCCEEDED", method: "CASH", receivedAt: before } });
  await expectMealError(cancelMealService(eventId, friday.id, userId, { reason: "Kitchen closed" }), "TOTAL_BELOW_PAID", "a credit below what was paid");
  assert((await prisma.eventMealService.findUniqueOrThrow({ where: { id: friday.id } })).status === "ACTIVE" && (await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: fridayWalkUp } })).status === "ACTIVE" && await totalOf(paying.id) === payingTotal, "a refused cancellation changes nothing");
  await prisma.payment.deleteMany({ where: { registrationId: paying.id } });
  const outcome = await cancelMealService(eventId, friday.id, userId, { reason: "Kitchen closed" });
  assert(outcome.cancelledSelections === 4, "the cancellation cancels every selection pinned to the service (two orders and two entitlements; a removed attendee's are already cancelled)");
  assert(await totalOf(paying.id) === payingTotal - 1600, "the registration is credited for the cancelled meal");
  assert((await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: fridayOrder } })).status === "CANCELLED" && (await prisma.eventMealSelection.findUniqueOrThrow({ where: { id: fridayWalkUp } })).status === "CANCELLED", "both orders are cancelled, not deleted");
  const credit = await prisma.eventMealLedgerEntry.findFirstOrThrow({ where: { selectionId: fridayWalkUp, kind: "CREDIT" } });
  assert(credit.settlement === "AT_COUNTER" && credit.amountCents === -700, "the walk-up order is credited at the counter");
  assert((await prisma.eventMealSelectionChange.count({ where: { selectionId: fridayOrder, type: "SERVICE_CANCELLED" } })) === 1, "the history says the service was cancelled");
  await expectMealError(createMealOrder(eventId, userId, { registrationId: null, serviceId: friday.id, mealType: "LUNCH", ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() }), "SERVICE_CANCELLED", "ordering a cancelled service");
  assert((await prisma.eventMealServiceChange.count({ where: { serviceId: friday.id, type: "CANCELLED" } })) === 1, "the service keeps its cancellation history");
  const cancelledForEntitled = (await prisma.eventMealSelection.findMany({ where: { registrationId: entitled.id, serviceId: friday.id } }));
  assert(cancelledForEntitled.every((row) => row.status === "CANCELLED"), "an entitlement for a cancelled service is cancelled too");
  assert((await prisma.eventMealLedgerEntry.count({ where: { selectionId: { in: cancelledForEntitled.map((row) => row.id) } } })) === 0, "and writes no credit (it was never charged)");

  // The registration's meal ledger and its MEAL adjustments agree.
  assert(await ledgerSum(paying.id) === await adjustmentSum(paying.id), "a registration's meal ledger equals its MEAL adjustments");

  // ---- Append-only guards ----------------------------------------------------------------------------------------------
  const entry = await prisma.eventMealLedgerEntry.findFirstOrThrow({ where: { registrationId: paying.id } });
  await expectDatabaseRefusal(prisma.eventMealLedgerEntry.update({ where: { id: entry.id }, data: { amountCents: 1 } }), "rewriting a ledger entry");
  await expectDatabaseRefusal(prisma.eventMealLedgerEntry.delete({ where: { id: entry.id } }), "deleting a ledger entry");
  const change = await prisma.eventMealSelectionChange.findFirstOrThrow({ where: { eventId } });
  await expectDatabaseRefusal(prisma.eventMealSelectionChange.update({ where: { id: change.id }, data: { reason: "edited" } }), "rewriting a change");
  await expectDatabaseRefusal(prisma.eventMealSelectionChange.delete({ where: { id: change.id } }), "deleting a change");
  await expectDatabaseRefusal(prisma.eventMealSelection.delete({ where: { id: childLunch } }), "deleting a selection");
  await expectDatabaseRefusal(prisma.eventMealSelection.update({ where: { id: childLunch }, data: { status: "ACTIVE", cancelledAt: null } }), "reviving a cancelled selection");
  await expectDatabaseRefusal(prisma.eventMealServiceChange.deleteMany({ where: { eventId } }), "deleting service history");
  await expectDatabaseRefusal(prisma.registrationAdjustment.findFirstOrThrow({ where: { registrationId: paying.id, kind: "MEAL" } }).then((row) => prisma.eventMealLedgerEntry.create({
    data: { eventId, selectionId: childLunch, changeId: change.id, registrationId: paying.id, mealType: "LUNCH", ageGroup: "CHILD", kind: "CHARGE", quantity: 1, unitPriceCents: 100, amountCents: 100, payer: "ATTENDEE", settlement: "AT_COUNTER", reason: row.reason },
  })), "a ledger entry that does not match its change and registration");
  const otherEvent = `${P}_ev_other`;
  await prisma.event.create({ data: { id: otherEvent, slug: slugOf(otherEvent), name: `Meal other ${P}`, startsAt: new Date("2027-07-15T15:00:00Z"), endsAt: new Date("2027-07-16T15:00:00Z"), timezone: "America/Chicago" } });
  // Another event's staff cannot reach this event's rows by id: every lookup is scoped to the event in the URL.
  const aPrice = await prisma.eventMealPrice.findFirstOrThrow({ where: { eventId } });
  await expectMealError(changeMealQuantity(otherEvent, childLunch, userId, { quantity: 2, reason: "Other event" }), "SELECTION_NOT_FOUND", "another event's selection");
  await expectMealError(cancelMealSelection(otherEvent, childLunch, userId, { reason: "Other event" }), "SELECTION_NOT_FOUND", "cancelling another event's selection");
  await expectMealError(updateMealService(otherEvent, wednesdayLunch.id, userId, { name: "X", mealType: "LUNCH", serviceDate: "2027-06-16", startTime: "12:00", endTime: null, location: null, ticketing: "TICKETED", capacity: null }), "SERVICE_NOT_FOUND", "another event's service");
  await expectMealError(cancelMealService(otherEvent, wednesdayLunch.id, userId, { reason: "Other event" }), "SERVICE_NOT_FOUND", "cancelling another event's service");
  await expectMealError(setMealPrice(otherEvent, ticketPlan.id, userId, { mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 1 }), "PLAN_NOT_FOUND", "pricing another event's plan");
  await expectMealError(removeMealPrice(otherEvent, aPrice.id, userId), "PRICE_NOT_FOUND", "removing another event's price");
  await expectMealError(loadRegistrationMeals(otherEvent, paying.id), "REGISTRATION_NOT_FOUND", "another event's registration");
  await expectDatabaseRefusal(prisma.eventMealPlanService.create({ data: { eventId: otherEvent, planId: ticketPlan.id, serviceId: wednesdayLunch.id } }), "a plan listing another event's service");

  // ---- Clone safety ---------------------------------------------------------------------------------------------------------
  const allIncluded = Object.fromEntries(cloneDomainKeys.map((key) => [key, false])) as Record<CloneDomainKey, boolean>;
  allIncluded.meals = true;
  const plan = await previewEventClone(userId, { sourceEventId: eventId });
  assert(plan.domains.find((domain) => domain.key === "meals")!.count > 0, "the clone preview lists the meal definitions");
  const cloneSlug = `${P.replace(/_/g, "-")}-clone`;
  const cloned = await cloneEvent(userId, {
    sourceEventId: eventId, expectedFingerprint: plan.fingerprint, requestKey: `${P}-key-clone`, name: `Meal clone ${P}`, slug: cloneSlug,
    startsOn: "2028-06-13", endsOn: "2028-06-17", capacity: { value: null, none: true }, registrationOpensOn: { value: null, none: true }, registrationClosesOn: { value: null, none: true },
    include: allIncluded, formLatePricingDates: [], formChoiceLimits: [], promoCodeWindows: [], honorOfferingCapacities: [],
  });
  const cloneEventId = (await prisma.event.findFirstOrThrow({ where: { slug: cloneSlug }, select: { id: true } })).id;
  void cloned;
  const clonedServices = await prisma.eventMealService.findMany({ where: { eventId: cloneEventId }, orderBy: [{ serviceDate: "asc" }] });
  assert(clonedServices.length === 13 && clonedServices[0]!.serviceDate === "2028-06-13", "the clone copies the services, dates moved with the event");
  assert(!clonedServices.some((row) => row.name === "Sunday breakfast" && row.status !== "ACTIVE") && clonedServices.every((row) => row.status === "ACTIVE"), "no cancelled service is copied");
  const clonedPlans = await prisma.eventMealPlan.findMany({ where: { eventId: cloneEventId }, include: { prices: true } });
  assert(clonedPlans.length === 3 && clonedPlans.find((row) => row.code === "meal-tickets")!.prices.length === 6 && clonedPlans.find((row) => row.code === "conference-paid")!.payer === "CONFERENCE", "the clone copies plans, payers and prices");
  assert((await prisma.eventMealSelection.count({ where: { eventId: cloneEventId } })) === 0, "a clone never copies a selection");
  assert((await prisma.eventMealLedgerEntry.count({ where: { eventId: cloneEventId } })) === 0 && (await prisma.eventMealSelectionChange.count({ where: { eventId: cloneEventId } })) === 0, "a clone never copies the ledger or a selection's history");
  const staleFive = await prisma.eventMealService.count({ where: { eventId: cloneEventId, id: { in: services.map((row) => row.id) } } });
  assert(staleFive === 0, "the clone's services are its own rows");
  const unchanged = await prisma.eventMealSelection.count({ where: { eventId } });
  assert(unchanged > 0, "the source keeps its selections");

  // ---- The backfill script: dry run by default, one audit row per registration applied, skips waitlisted ------------------
  const backfillReg = await makeRegistration("bf", { total: 14 });
  const waitlistedReg = await makeRegistration("bfw", { total: 14, status: "WAITLISTED" });
  for (const registration of [backfillReg, waitlistedReg]) {
    await prisma.publicRegistrationSubmission.create({
      data: {
        eventId, formVersionId: versionId, registrationId: registration.id, idempotencyKey: randomUUID(), requestHash: randomUUID(),
        responses: { breakfast_adult_qty: 2 }, pricingSnapshot: { lineItems: [{ key: "breakfast_adult_qty", amountCents: 1400 }] },
      },
    });
  }
  const runBackfill = (...extra: string[]) => {
    const output = execFileSync("npx", ["tsx", "--require", "./scripts/support/allow-server-only.cjs", "scripts/meals-backfill-form-tickets.ts", "--event", eventId, ...extra], { env: process.env, cwd: process.cwd(), encoding: "utf8" });
    return { output, summary: JSON.parse(output.slice(output.indexOf("{"))) as { wouldCreate: number; created: number; alreadyRecorded: number; failed: number } };
  };
  const dry = runBackfill();
  assert(/^Database: localhost:\d+\/\w+/m.test(dry.output) && dry.summary.wouldCreate === 1 && dry.summary.created === 0, "the backfill dry run names the database and writes nothing");
  assert((await prisma.eventMealSelection.count({ where: { registrationId: backfillReg.id } })) === 0, "a dry run records no selection");
  const applied = runBackfill("--apply");
  assert(applied.summary.created === 1 && applied.summary.failed === 0, "the backfill records the tickets");
  const backfilled = await prisma.eventMealSelection.findFirstOrThrow({ where: { registrationId: backfillReg.id } });
  assert(backfilled.unitPriceCents === 700 && await totalOf(backfillReg.id) === 1400 && (await prisma.eventMealSelection.count({ where: { registrationId: waitlistedReg.id } })) === 0, "unit price from the snapshot, no total moved, waitlisted skipped");
  assert((await prisma.auditLog.count({ where: { eventId, action: "MEAL_FORM_TICKETS_BACKFILLED", entityId: backfillReg.id } })) === 1, "one audit row per applied registration");
  assert(runBackfill("--apply").summary.created === 0, "a second run changes nothing");

  // ---- Event deletion ------------------------------------------------------------------------------------------------------
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await removeEventOwnedRows(tx, eventId);
  }, { timeout: 60_000 });
  assert((await prisma.eventMealService.count({ where: { eventId } })) === 0 && (await prisma.eventMealSelection.count({ where: { eventId } })) === 0 && (await prisma.eventMealLedgerEntry.count({ where: { eventId } })) === 0, "event deletion removes every meal row");

  console.log("Meal verification passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("Cleanup failed", error));
    await prisma.$disconnect();
  });
