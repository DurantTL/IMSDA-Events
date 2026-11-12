/**
 * Proves promo codes restricted to attendee types (#102) against a real PostgreSQL database, through the real public
 * submission and the real staff routines: staff save and edit the restriction (unknown or inactive types are refused, the
 * list is deduplicated, an edit that omits it leaves it alone, a church sponsor cannot be combined with it); a
 * registration-level restricted code on a real submission discounts only the allowed attendees' lines (the redemption keeps
 * the eligible subtotal and the restriction that was promised) and is refused when nobody on the registration is of an
 * allowed type, taking no use; a per-person restricted code is valid for the allowed person and stops the submission for
 * anyone else; a restricted code staff apply after submission works for the allowed person only and never on the whole
 * registration; an unrestricted code behaves as it always did; a deactivated type matches nobody; the last use of a
 * restricted code goes to exactly one of two simultaneous submissions.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:promo-attendee-types
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { registrationFormDefinitionSchema } from "../modules/forms/definition";
import { submitPublicRegistration } from "../modules/forms/public-repository";
import { createRegistrationAdjustment } from "../modules/registrations/adjustments";
import { createPromoCode, listPromoCodes, updatePromoCode } from "../modules/promo-codes/repository";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "pat";
const staffUserId = `${P}_staff`;
const eventId = `${P}_event`;
const slug = `${P}-event-slug`;
const registrationFormSlug = `${P}-registration`;
const personFormSlug = `${P}-person-registration`;
const startsWithP = { startsWith: `${P}_` };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(() => null, (caught: unknown) => caught as { code?: string; message?: string; issues?: Array<{ message: string }> });
}

const field = (id: string, key: string, label: string, type: string, scope: string, extra: Record<string, unknown> = {}) => (
  { id: `${P}_${id}`, key, label, type, scope, required: false, helpText: "", options: [], ...extra }
);
const contact = {
  id: `${P}_contact`, title: "Contact", description: "", fields: [
    field("c_first", "primary_contact_first_name", "First name", "TEXT", "REGISTRATION", { required: true }),
    field("c_last", "primary_contact_last_name", "Last name", "TEXT", "REGISTRATION", { required: true }),
    field("c_email", "email", "Email", "EMAIL", "REGISTRATION", { required: true }),
  ],
};
const attendeeBase = [
  field("a_first", "first_name", "First name", "TEXT", "ATTENDEE", { required: true }),
  field("a_last", "last_name", "Last name", "TEXT", "ATTENDEE", { required: true }),
  field("a_type", "attendee_type", "Attendee type", "RADIO", "ATTENDEE", { required: true, optionSource: "ATTENDEE_TYPES" }),
  field("a_fee", "registration_fee", "Registration fee", "CALCULATED", "ATTENDEE", { priceCents: 10_000 }),
];
const roster = { enabled: true, minAttendees: 1, maxAttendees: 5, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" };
const registrationLevelDefinition = registrationFormDefinitionSchema.parse({
  title: "Promo attendee type check", description: "Temporary fictitious form.", confirmationMessage: "Received.", attendeeRoster: roster,
  sections: [contact, { id: `${P}_attendees`, title: "Attendees", description: "", fields: attendeeBase }, {
    id: `${P}_promo`, title: "Promo", description: "", fields: [field("r_promo", "promo_code", "Promo code", "TEXT", "REGISTRATION")],
  }],
});
const personDefinition = registrationFormDefinitionSchema.parse({
  title: "Promo attendee type person check", description: "Temporary fictitious form.", confirmationMessage: "Received.", attendeeRoster: roster,
  sections: [contact, { id: `${P}_attendees`, title: "Attendees", description: "", fields: [...attendeeBase, field("p_promo", "promo_code", "Promo code", "TEXT", "ATTENDEE")] }],
});

const baseInput = {
  isActive: true, discountType: "PERCENT_BPS" as const, discountValue: 1_000, startsOn: null, endsOn: null,
  minimumSubtotalCents: null, maximumUses: null, maximumDiscountCents: null,
};

let counter = 0;
async function submit(formSlug: string, attendeeTypes: string[], options: { registrationCode?: string; personCodes?: string[] } = {}) {
  counter += 1;
  const result = await submitPublicRegistration(slug, formSlug, {
    versionId: formSlug === registrationFormSlug ? `${P}_ver_registration` : `${P}_ver_person`,
    idempotencyKey: randomUUID(),
    responses: {
      primary_contact_first_name: "Pat", primary_contact_last_name: `Sample${counter}`, email: `${P}-registrant-${counter}@example.test`,
      ...(options.registrationCode ? { promo_code: options.registrationCode } : {}),
    },
    attendees: attendeeTypes.map((type, index) => ({
      clientId: `attendee-${index}`,
      responses: {
        first_name: `Pat${counter}x${index}`, last_name: "Sample", attendee_type: type,
        ...(options.personCodes?.[index] ? { promo_code: options.personCodes[index] } : {}),
      },
    })),
    website: "",
  });
  return prisma.registration.findFirstOrThrow({ where: { confirmationCode: result.confirmationCode, eventId }, select: { id: true, confirmationCode: true, totalAmount: true } });
}

async function cleanup() {
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: startsWithP }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: staffUserId }, { eventId: startsWithP }, { entityId: { in: registrationIds } }] } });
  await prisma.event.deleteMany({ where: { id: startsWithP } });
  await prisma.registration.deleteMany({ where: { eventId: startsWithP } });
  await prisma.person.deleteMany({ where: { firstName: { startsWith: "Pat" }, lastName: { startsWith: "Sample" } } });
  await prisma.organization.deleteMany({ where: { id: startsWithP } });
  await prisma.user.deleteMany({ where: { id: staffUserId } });
}

async function promoOf(code: string) {
  return prisma.promoCode.findUniqueOrThrow({ where: { eventId_normalizedCode: { eventId, normalizedCode: code } } });
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: staffUserId, email: `${P}-staff@example.test`, displayName: "Promo Type Check Staff", globalRole: "SYSTEM_ADMIN" } });
  const day = 86_400_000;
  await prisma.event.create({
    data: { id: eventId, slug, name: "Promo Type Check Event", startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + 2 * day), isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY" },
  });
  await prisma.eventAttendeeType.createMany({
    data: [
      { eventId, code: "ADULT", label: "Adult", sortOrder: 0 },
      { eventId, code: "TEEN", label: "Teen", sortOrder: 1 },
      { eventId, code: "OLDTYPE", label: "Retired type", sortOrder: 2 },
    ],
  });
  for (const [id, name, formSlug, definition] of [
    [`${P}_form_registration`, "registration", registrationFormSlug, registrationLevelDefinition],
    [`${P}_form_person`, "person", personFormSlug, personDefinition],
  ] as const) {
    await prisma.registrationForm.create({
      data: {
        id, eventId, createdByUserId: staffUserId, name: `Promo type check ${name}`, slug: formSlug, status: RegistrationFormStatus.PUBLISHED,
        versions: { create: { id: `${P}_ver_${name}`, createdByUserId: staffUserId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition } },
      },
    });
  }
  await prisma.organization.create({ data: { id: `${P}_church`, type: "CHURCH", name: "Promo Type Check Church", normalizedName: "promo type check church" } });

  // Staff: validation, dedupe, leave-as-is on an omitted field, no combination with a sponsor.
  const unknown = await rejection(createPromoCode(eventId, { ...baseInput, code: "BADTYPE", attendeeTypeCodes: ["TEEN", "NOPE"] }, staffUserId));
  assert(unknown?.code === "PROMO_CODE_ATTENDEE_TYPE_INVALID", `an unknown type is refused (got ${String(unknown?.code)})`);
  assert(await prisma.promoCode.count({ where: { eventId, normalizedCode: "BADTYPE" } }) === 0, "a refused create leaves no code");
  await createPromoCode(eventId, { ...baseInput, code: "TEENS10", attendeeTypeCodes: ["TEEN", "TEEN"] }, staffUserId);
  assert((await promoOf("TEENS10")).attendeeTypeCodes.join() === "TEEN", "the restriction is saved once");
  const listed = (await listPromoCodes(eventId)).find((promo) => promo.code === "TEENS10");
  assert(listed?.attendeeTypeLabels.join() === "Teen", "the list shows the restriction by label");
  let teens = await promoOf("TEENS10");
  await updatePromoCode(eventId, teens.id, { ...baseInput, code: "TEENS10", expectedUpdatedAt: teens.updatedAt.toISOString() }, staffUserId);
  assert((await promoOf("TEENS10")).attendeeTypeCodes.join() === "TEEN", "an edit that omits the restriction leaves it as it is");
  teens = await promoOf("TEENS10");
  const sponsored = await rejection(updatePromoCode(eventId, teens.id, { ...baseInput, code: "TEENS10", sponsoringOrganizationId: `${P}_church`, expectedUpdatedAt: teens.updatedAt.toISOString() }, staffUserId));
  assert(sponsored?.code === "PROMO_CODE_ATTENDEE_TYPE_INVALID" || sponsored?.code === "PROMO_CODE_SPONSOR_INVALID", `a restricted code cannot take a church sponsor (got ${String(sponsored?.code)})`);
  await createPromoCode(eventId, { ...baseInput, code: "EVERYONE10" }, staffUserId);
  assert((await promoOf("EVERYONE10")).attendeeTypeCodes.length === 0, "a code made without a restriction applies to every type");

  // Registration level on a real submission: two adults and one teen; only the teen's line is discounted.
  const teenReg = await submit(registrationFormSlug, ["ADULT", "TEEN", "ADULT"], { registrationCode: "TEENS10" });
  const redemption = await prisma.promoCodeRedemption.findUniqueOrThrow({ where: { registrationId: teenReg.id } });
  assert(redemption.eligibleSubtotalCents === 10_000 && redemption.discountAmountCents === 1_000, `only the teen's line is eligible (got ${redemption.eligibleSubtotalCents}/${redemption.discountAmountCents})`);
  assert(redemption.attendeeTypeCodesSnapshot.join() === "TEEN", "the redemption keeps the restriction that was promised");
  assert(Number(teenReg.totalAmount) === 290, `total is 3 x $100 less $10 (got ${String(teenReg.totalAmount)})`);
  assert((await promoOf("TEENS10")).redeemedCount === 1, "one use taken");

  // Nobody of an allowed type: refused with a clear message, no use taken, no registration left behind.
  const before = await prisma.registration.count({ where: { eventId } });
  const refused = await rejection(submit(registrationFormSlug, ["ADULT", "ADULT"], { registrationCode: "TEENS10" }));
  assert(refused !== null, "a registration with no teen cannot use the teen code");
  assert(JSON.stringify(refused).includes("doesn't apply to anyone on this registration"), `the refusal says why (got ${JSON.stringify(refused).slice(0, 300)})`);
  assert((await promoOf("TEENS10")).redeemedCount === 1, "a refused use takes none");
  assert(await prisma.registration.count({ where: { eventId } }) === before, "no registration is left behind");

  // An unrestricted code is unchanged: the whole subtotal.
  const everyone = await submit(registrationFormSlug, ["ADULT", "TEEN"], { registrationCode: "EVERYONE10" });
  const everyoneRedemption = await prisma.promoCodeRedemption.findUniqueOrThrow({ where: { registrationId: everyone.id } });
  assert(everyoneRedemption.eligibleSubtotalCents === 20_000 && everyoneRedemption.discountAmountCents === 2_000 && everyoneRedemption.attendeeTypeCodesSnapshot.length === 0, "an unrestricted code discounts the whole subtotal with no snapshot");

  // Per person: the teen's code works, the adult's stops the submission.
  const personRegistration = await submit(personFormSlug, ["ADULT", "TEEN"], { personCodes: ["", "TEENS10"] });
  const personAdjustments = await prisma.registrationAdjustment.findMany({ where: { registrationId: personRegistration.id, kind: "PROMO_CODE" } });
  assert(personAdjustments.length === 1 && personAdjustments[0]!.amountCents === -1_000, "the teen's own code takes 10% off their own line");
  const personRefused = await rejection(submit(personFormSlug, ["ADULT", "TEEN"], { personCodes: ["TEENS10", ""] }));
  assert(personRefused !== null && JSON.stringify(personRefused).includes("doesn't apply to this attendee type"), "an adult cannot use the teen code");
  assert((await promoOf("TEENS10")).redeemedCount === 2, "only the allowed person's use was taken");

  // Staff apply a restricted code after submission: allowed person only, never the whole registration.
  const adults = await submit(registrationFormSlug, ["ADULT", "TEEN"]);
  const attendees = await prisma.registrationAttendee.findMany({ where: { registrationId: adults.id }, include: { attendeeTypeDefinition: { select: { code: true } } } });
  const adultRow = attendees.find((row) => row.attendeeTypeDefinition?.code === "ADULT")!;
  const teenRow = attendees.find((row) => row.attendeeTypeDefinition?.code === "TEEN")!;
  const adjustAdult = await rejection(createRegistrationAdjustment(eventId, adults.id, staffUserId, { kind: "PROMO_CODE", code: "TEENS10", reason: "Check", attendeeId: adultRow.id }));
  assert(adjustAdult?.code === "PROMO_INVALID", `staff cannot apply the teen code to an adult (got ${String(adjustAdult?.code)})`);
  const adjustWhole = await rejection(createRegistrationAdjustment(eventId, adults.id, staffUserId, { kind: "PROMO_CODE", code: "TEENS10", reason: "Check" }));
  assert(adjustWhole?.code === "PROMO_INVALID", "staff cannot apply a restricted code to the whole registration");
  await createRegistrationAdjustment(eventId, adults.id, staffUserId, { kind: "PROMO_CODE", code: "TEENS10", reason: "Check", attendeeId: teenRow.id });
  assert((await promoOf("TEENS10")).redeemedCount === 3, "only the allowed person's staff use was taken");

  // A deactivated type matches nobody: the code stays restricted, it never widens to everyone.
  await createPromoCode(eventId, { ...baseInput, code: "OLDONLY10", attendeeTypeCodes: ["OLDTYPE"] }, staffUserId);
  await prisma.eventAttendeeType.update({ where: { eventId_code: { eventId, code: "OLDTYPE" } }, data: { isActive: false } });
  const oldRefused = await rejection(submit(registrationFormSlug, ["ADULT", "TEEN"], { registrationCode: "OLDONLY10" }));
  assert(oldRefused !== null, "a code for a deactivated type applies to nobody");
  const inactiveChoice = await rejection(createPromoCode(eventId, { ...baseInput, code: "NEWOLD10", attendeeTypeCodes: ["OLDTYPE"] }, staffUserId));
  assert(inactiveChoice?.code === "PROMO_CODE_ATTENDEE_TYPE_INVALID", "an inactive type cannot be newly chosen");

  // The last use of a restricted code goes to exactly one of two simultaneous submissions.
  await createPromoCode(eventId, { ...baseInput, code: "LASTTEEN", attendeeTypeCodes: ["TEEN"], maximumUses: 1 }, staffUserId);
  const race = await Promise.allSettled([
    submit(registrationFormSlug, ["TEEN"], { registrationCode: "LASTTEEN" }),
    submit(registrationFormSlug, ["TEEN"], { registrationCode: "LASTTEEN" }),
  ]);
  assert(race.filter((result) => result.status === "fulfilled").length === 1, "exactly one submission gets the last use");
  assert((await promoOf("LASTTEEN")).redeemedCount === 1, "the use count is one");

  console.log("promo attendee-type restrictions: all checks passed");
}

main()
  .then(async () => { await cleanup(); await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
