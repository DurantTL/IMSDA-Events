/**
 * Proves staff-started registration drafts (#1510) against a real PostgreSQL database, through the real public submission and
 * the real draft routines: a draft keeps only what the browser-draft rule allows; a staff check runs the public submit and
 * keeps nothing (no registration, submission, message, person or payment row) and still returns an estimated total when a
 * required answer only the registrant can give is missing; the real submit still needs that answer; a submit from the private
 * link links the draft to the registration, marks it submitted and clears its answers; the same key replays; a new key is
 * refused; an expired link and a link for another form are refused; and no payment row is ever made.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:staff-registration-drafts
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { hashOpaqueToken } from "../modules/access/tokens";
import { registrationFormDefinitionSchema } from "../modules/forms/definition";
import { submitPublicRegistration } from "../modules/forms/public-repository";
import { checkStaffDraft, createStaffDraft } from "../modules/staff-registration-drafts/repository";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "sdc";
const staffUserId = `${P}_staff`;
const eventId = `${P}_event`;
const slug = `${P}-event-slug`;
const startsWithP = { startsWith: `${P}_` };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(() => null, (caught: unknown) => caught as { code?: string; message?: string; issues?: Array<{ key?: string }> });
}

const field = (id: string, key: string, label: string, type: string, scope: string, extra: Record<string, unknown> = {}) => (
  { id: `${P}_${id}`, key, label, type, scope, required: false, helpText: "", options: [], ...extra }
);
const definition = registrationFormDefinitionSchema.parse({
  title: "Staff draft check", description: "Temporary fictitious form.", confirmationMessage: "Received.",
  sections: [{
    id: `${P}_main`, title: "Details", description: "", fields: [
      field("first", "first_name", "First name", "TEXT", "ATTENDEE", { required: true }),
      field("last", "last_name", "Last name", "TEXT", "ATTENDEE", { required: true }),
      field("email", "email", "Email", "EMAIL", "REGISTRATION", { required: true }),
      field("birth", "birth_date", "Birth date", "DATE", "REGISTRATION", { required: true }),
      field("fee", "registration_fee", "Registration fee", "CALCULATED", "REGISTRATION", { priceCents: 7_500 }),
    ],
  }],
});

async function cleanup() {
  await prisma.staffRegistrationDraft.deleteMany({ where: { eventId: startsWithP } });
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: startsWithP }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: staffUserId }, { eventId: startsWithP }, { entityId: { in: registrationIds } }] } });
  await prisma.event.deleteMany({ where: { id: startsWithP } });
  await prisma.registration.deleteMany({ where: { eventId: startsWithP } });
  await prisma.person.deleteMany({ where: { firstName: { startsWith: "Sdc" } } });
  await prisma.user.deleteMany({ where: { id: staffUserId } });
}

const counts = async () => ({
  registration: await prisma.registration.count(),
  submission: await prisma.publicRegistrationSubmission.count(),
  outbox: await prisma.messageOutbox.count(),
  person: await prisma.person.count(),
  payment: await prisma.payment.count(),
  attempt: await prisma.paymentAttempt.count(),
  attendee: await prisma.registrationAttendee.count(),
});

function answers(name: string, extra: Record<string, unknown> = {}) {
  return { first_name: `Sdc${name}`, last_name: "Sample", email: `${P}-${name.toLowerCase()}@example.test`, ...extra };
}

async function handOff(draftId: string, token: string, expiresAt: Date) {
  await prisma.staffRegistrationDraft.update({
    where: { id: draftId },
    data: { status: "HANDED_OFF", handOffTokenHash: hashOpaqueToken(token), handOffExpiresAt: expiresAt, handedOffAt: new Date(), handedOffByUserId: staffUserId },
  });
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: staffUserId, email: `${P}-staff@example.test`, displayName: "Draft Check Staff", globalRole: "SYSTEM_ADMIN" } });
  const day = 86_400_000;
  await prisma.event.create({
    data: { id: eventId, slug, name: "Staff Draft Check Event", startsAt: new Date(Date.now() + 7 * day), endsAt: new Date(Date.now() + 8 * day), isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY" },
  });
  for (const name of ["one", "two"]) {
    await prisma.registrationForm.create({
      data: {
        id: `${P}_form_${name}`, eventId, createdByUserId: staffUserId, name: `Draft check ${name}`, slug: `${P}-form-${name}`, status: RegistrationFormStatus.PUBLISHED,
        versions: { create: { id: `${P}_ver_${name}`, createdByUserId: staffUserId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition } },
      },
    });
  }
  const formSlug = `${P}-form-one`;

  // A draft keeps only what the browser-draft rule allows.
  const created = await createStaffDraft(eventId, staffUserId, { formId: `${P}_form_one`, source: "PHONE", responses: answers("Alpha", { birth_date: "2010-01-01", made_up: "x" }) });
  const stored = await prisma.staffRegistrationDraft.findUniqueOrThrow({ where: { id: created.id } });
  assert(stored.source === "PHONE" && stored.formVersionId === `${P}_ver_one` && stored.createdByUserId === staffUserId, "source, pinned version and actor are stored");
  assert(!("birth_date" in (stored.responses as object)) && !("made_up" in (stored.responses as object)), "birth date and unknown keys are not kept");

  // Check: an estimate, with the required registrant-only birth date missing, and nothing written.
  const before = await counts();
  const checked = await checkStaffDraft(eventId, created.id, staffUserId);
  assert(checked.ok && checked.check.totalCents === 7_500, `the check returns a total without the birth date (got ${JSON.stringify(checked)})`);
  assert(checked.ok && checked.registrantFills.includes("Birth date"), "the check names what the registrant fills in");
  const after = await counts();
  assert(JSON.stringify(before) === JSON.stringify(after), `the check wrote nothing (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`);
  const unchanged = await prisma.staffRegistrationDraft.findUniqueOrThrow({ where: { id: created.id } });
  assert(unchanged.status === "OPEN" && unchanged.registrationId === null, "the check left the draft as it was");

  // The registrant's link: the real submit still needs the birth date.
  const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "").slice(0, 11);
  await handOff(created.id, token, new Date(Date.now() + 14 * day));
  const input = (key: string, extra: Record<string, unknown> = {}) => ({
    versionId: `${P}_ver_one`, idempotencyKey: key, responses: { ...answers("Alpha"), ...extra }, staffDraftToken: token, website: "" as const,
  });
  const needsBirth = await rejection(submitPublicRegistration(slug, formSlug, input(randomUUID())));
  assert(needsBirth?.code === "INVALID_SUBMISSION" && needsBirth.issues?.some((issue) => issue.key === "birth_date"), "a real submit still needs the birth date");
  assert((await prisma.staffRegistrationDraft.findUniqueOrThrow({ where: { id: created.id } })).status === "HANDED_OFF", "a refused submit leaves the draft handed off");

  const key = randomUUID();
  const sent = await submitPublicRegistration(slug, formSlug, input(key, { birth_date: "2010-01-01" }));
  const linked = await prisma.staffRegistrationDraft.findUniqueOrThrow({ where: { id: created.id } });
  const registration = await prisma.registration.findFirstOrThrow({ where: { eventId, confirmationCode: sent.confirmationCode } });
  assert(linked.status === "SUBMITTED" && linked.registrationId === registration.id && linked.submittedAt !== null, "the submit links the draft and marks it submitted");
  assert(JSON.stringify(linked.responses) === "{}", "the draft's answers are cleared");
  assert(await prisma.payment.count({ where: { registrationId: registration.id } }) === 0 && await prisma.paymentAttempt.count({ where: { registrationId: registration.id } }) === 0, "no payment rows were made");

  const registrationsNow = await prisma.registration.count({ where: { eventId } });
  const replay = await submitPublicRegistration(slug, formSlug, input(key, { birth_date: "2010-01-01" }));
  assert(replay.confirmationCode === sent.confirmationCode && await prisma.registration.count({ where: { eventId } }) === registrationsNow, "the same key replays");
  const again = await rejection(submitPublicRegistration(slug, formSlug, input(randomUUID(), { birth_date: "2010-01-01" })));
  assert(again?.code === "STAFF_DRAFT_ALREADY_SUBMITTED", `a new key is refused (got ${String(again?.code)})`);
  assert(await prisma.registration.count({ where: { eventId } }) === registrationsNow, "a refused repeat creates no second registration");

  // Expired link, and a link made for another form.
  const expired = await createStaffDraft(eventId, staffUserId, { formId: `${P}_form_one`, source: "PAPER", responses: answers("Beta") });
  const expiredToken = randomUUID().replaceAll("-", "") + "e".repeat(11);
  await handOff(expired.id, expiredToken, new Date(Date.now() - day));
  const late = await rejection(submitPublicRegistration(slug, formSlug, { ...input(randomUUID(), { ...answers("Beta"), birth_date: "2010-01-01" }), staffDraftToken: expiredToken }));
  assert(late?.code === "STAFF_DRAFT_LINK_UNAVAILABLE", `an expired link is refused (got ${String(late?.code)})`);
  const other = await createStaffDraft(eventId, staffUserId, { formId: `${P}_form_two`, source: "WALK_IN", responses: answers("Gamma") });
  const otherToken = randomUUID().replaceAll("-", "") + "o".repeat(11);
  await handOff(other.id, otherToken, new Date(Date.now() + day));
  const wrongForm = await rejection(submitPublicRegistration(slug, formSlug, { ...input(randomUUID(), { ...answers("Gamma"), birth_date: "2010-01-01" }), staffDraftToken: otherToken }));
  assert(wrongForm?.code === "STAFF_DRAFT_LINK_UNAVAILABLE", `a link for another form is refused (got ${String(wrongForm?.code)})`);
  assert(await prisma.registration.count({ where: { eventId } }) === registrationsNow, "refused links created no registration");
  assert(await prisma.payment.count({ where: { registration: { eventId } } }) === 0, "no payment rows exist for the event");

  console.log("staff registration drafts: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    await prisma.$disconnect();
  });
