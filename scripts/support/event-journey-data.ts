/**
 * Synthetic data for the event journeys (#1439 round 2): `scripts/verify-event-journeys.ts`.
 *
 * Every id starts with "journeyevt_<stamp>_", where the stamp is unique per run (and the shard is part of it), so runs
 * and shards on one database never collide and cleanup only touches this run's rows. Nothing here is real: names, emails
 * (@example.test) and phones ("(515) 555-0100") are invented, and so is the Square configuration the app runs with.
 *
 * What it seeds: one open, published, attendee-paid event with a registration form that has a phone, a birth date, a
 * priced ticket, priced shirts, a promo code field and the "Payment method" choice; one promo code; one cancellation
 * policy (a full refund before the event). What it does NOT seed: any account or registration. The journeys create those
 * through the site, the way a person would.
 *
 * LOCAL USE ONLY: `guardLocal()` in browser-journeys.ts must have passed before anything here runs.
 */
import type { PrismaClient } from "@prisma/client";
import { newStamp } from "./journey-data";

export const EVENT_PREFIX = "journeyevt";
/** The seeded staff member who decides cancellation requests (an event finance manager). */
export const FINANCE_EMAIL = "finance@imsda-events.test";

export type EventWorld = {
  stamp: string;
  prefix: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
  formId: string;
  formVersionId: string;
  formSlug: string;
  promoCode: string;
  /** The seeded accounts' ids (cleanup also removes the accounts the journeys create by their email). */
  accountIds: string[];
  /** The emails this run uses all start with this, so cleanup finds what the site created. */
  emailMarker: string;
  /** Staff journeys (phase B): stamped synthetic staff users (ids), by role, and the events they work on. */
  staff: Record<StaffRole, { id: string; email: string }>;
  /** Events the journeys create through the site (from a template), removed with the others. */
  extraEventIds: string[];
  /** The event with many stamped attendees (lists, CSV, check-in). */
  list: { eventId: string; slug: string; name: string; attendees: number; lastNameMarker: string };
  /** A small event whose three registrations have stamped contact emails (the scheduled email). */
  mail: { eventId: string; slug: string; name: string; recipients: string[] };
};

export type StaffRole = "sysadmin" | "eventadmin" | "checkin" | "comms";

/** The numbers the form below makes on the server (cents). The journeys never read them from a page; they recompute them with the app's own functions. */
export const PRICES = { standard: 6000, shirt: 1500, shirts: 2, promoBasisPoints: 1500 } as const;
/** The card fee rate of the form (2.9% + 30 cents, passed on to the person). */
export const CARD_FEE = { percentageBasisPoints: 290, fixedFeeCents: 30 } as const;

export const emailFor = (world: EventWorld, role: string) => `${world.emailMarker}${role}@example.test`;

/** The form the registration journeys fill in. Exported so the journeys can recompute prices with the app's own functions. */
export function eventFormDefinition(world: Pick<EventWorld, "prefix">) {
  const field = (id: string, key: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
    id: `${world.prefix}_${id}`, key, label, helpText: "", type, scope: "REGISTRATION", required: false, options: [], ...extra,
  });
  return {
    title: "Journey weekend registration",
    description: "A synthetic form used only by the browser journey checks.",
    confirmationMessage: "Thank you. Your registration is received.",
    payment: {
      enabled: true,
      currency: "USD",
      paymentMethodFieldKey: "payment_method",
      cardOptionValue: "Credit / debit card",
      percentageBasisPoints: CARD_FEE.percentageBasisPoints,
      fixedFeeCents: CARD_FEE.fixedFeeCents,
      passFeeToRegistrant: true,
    },
    sections: [
      { id: `${world.prefix}_s_contact`, title: "About you", description: "", fields: [
        field("f_first", "first_name", "First name", "TEXT", { required: true }),
        field("f_last", "last_name", "Last name", "TEXT", { required: true }),
        field("f_email", "email", "Email", "EMAIL", { required: true }),
        field("f_phone", "phone", "Mobile phone", "PHONE"),
        field("f_dob", "date_of_birth", "Date of birth", "DATE"),
      ] },
      { id: `${world.prefix}_s_pay`, title: "Choices and payment", description: "", fields: [
        field("f_ticket", "ticket", "Ticket", "RADIO", { required: true, options: ["Standard", "Premium"], choicePricesCents: { Standard: PRICES.standard, Premium: 9000 } }),
        field("f_shirts", "shirts", "Shirts", "NUMBER", { priceCents: PRICES.shirt }),
        field("f_promo", "promo_code", "Promo code", "TEXT"),
        field("f_method", "payment_method", "Payment method", "RADIO", { required: true, options: ["Pay later", "Credit / debit card"] }),
      ] },
    ],
  };
}

/** A full refund until a date far in the future, so a cancellation request always has a plain, calculable outcome. */
export function cancellationRules() {
  const terms = { refund: { kind: "FULL" }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: false };
  return {
    schema: 1,
    windows: [{ id: "before-event", label: "Before the event", endsOn: "2099-12-31", terms }],
    afterWindows: { label: "After the last window", terms: { ...terms, refund: { kind: "NONE" } } },
    noShow: null,
    allowedScopes: ["FULL_REGISTRATION"],
    supportedComponents: { categories: [], fieldKeys: [] },
    classifications: [],
    nonrefundable: { categories: [], fieldKeys: [] },
    cardFeeTreatment: "REFUNDABLE",
  };
}

export async function seedEventWorld(prisma: PrismaClient, shard: string): Promise<EventWorld> {
  const { registrationFormDefinitionSchema } = await import("../../modules/forms/definition");
  const { parseCancellationRules } = await import("../../modules/cancellation-policy/rules");
  const stamp = newStamp(shard);
  const prefix = `${EVENT_PREFIX}_${stamp}`;
  const world: EventWorld = {
    stamp, prefix, eventId: `${prefix}_event`, eventName: `Journey Retreat Weekend ${stamp}`, eventSlug: `${EVENT_PREFIX}-${stamp}-retreat`,
    formId: `${prefix}_form`, formVersionId: `${prefix}_formver`, formSlug: "register", promoCode: `JRNY${stamp.toUpperCase()}`,
    accountIds: [], emailMarker: `${EVENT_PREFIX}.${stamp}.`,
    staff: {} as EventWorld["staff"], extraEventIds: [],
    list: { eventId: `${prefix}_list`, slug: `${EVENT_PREFIX}-${stamp}-list`, name: `Journey Lists Weekend ${stamp}`, attendees: LIST_ATTENDEES, lastNameMarker: `Lister${stamp}` },
    mail: { eventId: `${prefix}_mail`, slug: `${EVENT_PREFIX}-${stamp}-mail`, name: `Journey Mail Weekend ${stamp}`, recipients: [] },
  };
  const staff = await prisma.user.findUnique({ where: { email: "admin@imsda-events.test" }, select: { id: true } });
  if (!staff) throw new Error("This is not a seeded dev database (admin@imsda-events.test is missing). Run `npm run db:seed` first.");
  const day = 86_400_000;
  const now = Date.now();
  await prisma.event.create({
    data: {
      id: world.eventId, slug: world.eventSlug, name: world.eventName, startsAt: new Date(now + 60 * day), endsAt: new Date(now + 62 * day),
      timezone: "America/Chicago", location: "Fictitious verification retreat center", isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY",
      registrationOpensOn: new Date(now - 10 * day).toISOString().slice(0, 10), registrationClosesOn: "2099-01-01", supportContact: "registration@journey.example.test",
    },
  });
  const definition = registrationFormDefinitionSchema.parse(eventFormDefinition(world));
  await prisma.registrationForm.create({
    data: {
      id: world.formId, eventId: world.eventId, createdByUserId: staff.id, name: definition.title, slug: world.formSlug, status: "PUBLISHED",
      versions: { create: { id: world.formVersionId, createdByUserId: staff.id, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition } },
    },
  });
  await prisma.promoCode.create({
    data: { eventId: world.eventId, code: world.promoCode, normalizedCode: world.promoCode, discountType: "PERCENT_BPS", discountValue: PRICES.promoBasisPoints, isActive: true },
  });
  await prisma.eventCancellationPolicyVersion.create({
    data: {
      eventId: world.eventId, version: 1, effectiveFrom: new Date(now - day), rulesSchema: 1, rules: parseCancellationRules(cancellationRules()),
      note: "Synthetic browser journey check", createdByUserId: staff.id, createdByNameSnapshot: "Journey check",
    },
  });
  // The finance manager who will decide the cancellation request is assigned to this event, as a person is in real life.
  const finance = await prisma.user.findUnique({ where: { email: FINANCE_EMAIL }, select: { id: true } });
  if (!finance) throw new Error(`The seeded finance manager ${FINANCE_EMAIL} is missing. Run \`npm run db:seed\` first.`);
  await prisma.eventMembership.create({ data: { eventId: world.eventId, userId: finance.id, role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] } });
  await seedStaffWorld(prisma, world, finance.id);
  return world;
}

/** More than one page of the attendee list (it pages at 50). */
export const LIST_ATTENDEES = 55;

const STAFF_NAMES: Record<StaffRole, string> = { sysadmin: "Sam SysAdmin", eventadmin: "Eve EventAdmin", checkin: "Chip CheckIn", comms: "Cora Comms" };

/** Registrations with stamped people: `count` of them, each one attendee, with a stamped contact email. */
async function seedRegistrations(prisma: PrismaClient, world: EventWorld, eventId: string, count: number, label: string, lastName: string, typeDefinitionId?: string) {
  const emails: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const n = String(index + 1).padStart(2, "0");
    const email = `${world.emailMarker}${label}${n}@example.test`;
    emails.push(email);
    // Names that sort the same way in any locale: A to Z, then B0 to B9.
    const firstName = `Pat${String.fromCharCode(65 + (index % 26))}${Math.floor(index / 26)}`;
    const person = await prisma.person.create({ data: { id: `${world.prefix}_${label}_p${n}`, firstName, lastName, normalizedEmail: email, phone: "(515) 555-0100" } });
    const registration = await prisma.registration.create({
      data: {
        eventId, accountHolderPersonId: person.id, confirmationCode: `JRN-${world.stamp.slice(-4).toUpperCase()}-${label.slice(0, 1).toUpperCase()}${n}`.slice(0, 20),
        status: "CONFIRMED", totalAmount: 0, submittedAt: new Date(Date.now() - (index + 1) * 60_000),
        contactSnapshot: { firstName, lastName, email, phone: "(515) 555-0100" },
      },
    });
    await prisma.registrationAttendee.create({
      data: { eventId, registrationId: registration.id, personId: person.id, attendeeType: typeDefinitionId ? "ATTENDEE" : ["ATTENDEE", "TEEN", "WORKER"][index % 3]!, ...(typeDefinitionId ? { attendeeTypeDefinitionId: typeDefinitionId } : {}), profileSnapshot: { firstName, lastName } },
    });
  }
  return emails;
}

/** Staff users (stamped, synthetic) with the roles the staff journeys work as, and the two events they work on. */
async function seedStaffWorld(prisma: PrismaClient, world: EventWorld, financeUserId: string) {
  const { hashPassword } = await import("../../modules/access/passwords");
  for (const role of Object.keys(STAFF_NAMES) as StaffRole[]) {
    const id = `${world.prefix}_staff_${role}`;
    const email = emailFor(world, `staff-${role}`);
    await prisma.user.create({ data: { id, email, displayName: `${STAFF_NAMES[role]} Journey${world.stamp}`, accountStatus: "ACTIVE", globalRole: role === "sysadmin" ? "SYSTEM_ADMIN" : null } });
    // A staff session only counts for a user that has a sign-in credential (never used: the journeys mint the session).
    await prisma.authCredential.create({ data: { userId: id, passwordHash: await hashPassword(`Quartz-Meadow-${world.stamp}-${role}-Lantern-47`) } });
    world.staff[role] = { id, email };
  }
  const day = 86_400_000;
  const now = Date.now();
  const open = (id: string, slug: string, name: string) => prisma.event.create({
    data: {
      id, slug, name, startsAt: new Date(now + 45 * day), endsAt: new Date(now + 47 * day), timezone: "America/Chicago", location: "Fictitious verification retreat center",
      isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY", registrationOpensOn: new Date(now - 10 * day).toISOString().slice(0, 10), registrationClosesOn: "2099-01-01", supportContact: "registration@journey.example.test",
    },
  });
  await open(world.list.eventId, world.list.slug, world.list.name);
  await open(world.mail.eventId, world.mail.slug, world.mail.name);
  const memberships: Array<[string, StaffRole, "EVENT_ADMIN" | "CHECK_IN_STAFF" | "COMMUNICATIONS_MANAGER"]> = [
    [world.list.eventId, "eventadmin", "EVENT_ADMIN"], [world.list.eventId, "checkin", "CHECK_IN_STAFF"],
    [world.mail.eventId, "comms", "COMMUNICATIONS_MANAGER"], [world.mail.eventId, "eventadmin", "EVENT_ADMIN"],
  ];
  for (const [eventId, role, eventRole] of memberships) await prisma.eventMembership.create({ data: { eventId, userId: world.staff[role].id, role: eventRole, status: "ACTIVE", permissions: [] } });
  void financeUserId;
  // The scheduled email only goes to adults, and it knows who is one from the event's attendee types.
  const adult = await prisma.eventAttendeeType.create({ data: { eventId: world.mail.eventId, code: "ATTENDEE", label: "Adult", sortOrder: 1, minimumAge: 18 } });
  await seedRegistrations(prisma, world, world.list.eventId, LIST_ATTENDEES, "lister", world.list.lastNameMarker);
  world.mail.recipients = await seedRegistrations(prisma, world, world.mail.eventId, 3, "mailer", `Mailer${world.stamp}`, adult.id);
}

/** An account that already exists (known password, verified email), for the "same words for an address that has an account" check. */
export async function seedExistingAccount(prisma: PrismaClient, world: EventWorld) {
  const { hashPassword } = await import("../../modules/access/passwords");
  const id = `${world.prefix}_existing`;
  const email = emailFor(world, "existing");
  const password = `Quartz-Meadow-${world.stamp}-existing-Lantern-47`;
  await prisma.attendeeAccount.create({
    data: {
      id, email, displayName: "Casey Existing", firstName: "Casey", lastName: `Journey${world.stamp}-Existing`, status: "ACTIVE", emailVerifiedAt: new Date(),
      credential: { create: { passwordHash: await hashPassword(password) } },
    },
  });
  world.accountIds.push(id);
  return { id, email, password };
}

/**
 * The public budgets these journeys use (account sign-up and its codes, the Security check codes, the public registration
 * and promo calls, payment pages, manage links) would stop repeated local runs, so on the local database only they are
 * forgotten before a run. A real person is never affected.
 */
export async function resetEventBudgets(prisma: PrismaClient) {
  const policies = ["attendee.", "security-check.", "public.", "registration."];
  await prisma.rateLimitBucket.deleteMany({ where: { OR: policies.map((policy) => ({ policy: { startsWith: policy } })) } });
  // Messages an earlier run's dev outbox "sent" keep their provider id; none may be left to clash with this run's.
  await prisma.messageOutbox.deleteMany({ where: { providerMessageId: { startsWith: "journey-mail-" } } });
}

/** Best effort: every step is tried, none stops the others. Only this run's rows (by id and by email marker) are removed. */
export async function cleanupEventWorld(prisma: PrismaClient, world: EventWorld) {
  const run = async (name: string, step: () => Promise<unknown>) => {
    await step().catch((error: Error) => console.error(`cleanup (${name}): ${error.message.split("\n").slice(-2).join(" ").slice(0, 160)}`));
  };
  const accounts = (await prisma.attendeeAccount.findMany({ where: { OR: [{ id: { in: world.accountIds } }, { email: { startsWith: world.emailMarker } }] }, select: { id: true } }).catch(() => [])).map((row) => row.id);
  const registrations = (await prisma.registration.findMany({ where: { eventId: world.eventId }, select: { id: true } }).catch(() => [])).map((row) => row.id);
  // Events made through the site (from a template) carry the stamp in their name.
  const made = (await prisma.event.findMany({ where: { name: { contains: world.stamp } }, select: { id: true } }).catch(() => [])).map((row) => row.id);
  const eventIds = [...new Set([world.eventId, world.list.eventId, world.mail.eventId, ...world.extraEventIds, ...made])];
  const users = Object.values(world.staff).map((entry) => entry.id);
  await run("event rows", async () => {
    const { removeEventOwnedRows } = await import("../../modules/events/deletion-repository");
    for (const eventId of eventIds) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
        if (await tx.event.findUnique({ where: { id: eventId }, select: { id: true } })) {
          await tx.eventTemplateApplication.deleteMany({ where: { eventId } });
          await removeEventOwnedRows(tx, eventId);
        }
      }, { timeout: 30_000 });
    }
  });
  await run("messages", () => prisma.messageOutbox.deleteMany({ where: { recipientEmail: { startsWith: world.emailMarker } } }));
  await run("audit", () => prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { actorUserId: { in: users } }, { entityId: { in: [...registrations, ...accounts] } }] } }));
  await run("sessions", () => prisma.attendeeSession.deleteMany({ where: { accountId: { in: accounts } } }));
  await run("account rows", async () => {
    await prisma.attendeeStepUpCode.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.attendeeCredential.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.attendeeMfaEnrollment.deleteMany({ where: { accountId: { in: accounts } } });
  });
  await run("accounts", () => prisma.attendeeAccount.deleteMany({ where: { id: { in: accounts } } }));
  await run("staff sessions", () => prisma.userSession.deleteMany({ where: { userId: { in: users } } }));
  await run("staff credentials", () => prisma.authCredential.deleteMany({ where: { userId: { in: users } } }));
  await run("staff users", () => prisma.user.deleteMany({ where: { id: { in: users } } }));
  await run("people", () => prisma.person.deleteMany({ where: { OR: [{ normalizedEmail: { startsWith: world.emailMarker } }, { id: { startsWith: `${world.prefix}_` } }] } }));
}
