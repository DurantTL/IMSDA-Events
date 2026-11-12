/**
 * Proves the optional baptism follow-up notice (#1680) against a real PostgreSQL database:
 *
 * - module off: nothing is queued or remembered; module on with no event lead: nothing is queued or remembered;
 * - a name on a club's registration gives one outbox row per recipient (each event lead address and the church pastor) and one ledger row;
 * - the same names again, in any case or spacing, add nothing;
 * - one new name queues only that name; a removed name does nothing and putting it back is not announced again;
 * - two notifies racing on the same new name leave one ledger row and no duplicate outbox row;
 * - no pastor on file: the event lead only;
 * - the email holds only the names, club, event, dates and the request; the audit entry holds counts and roles, never a name or an address.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:baptism-follow-up
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { queueBaptismFollowUpNotices } from "@/modules/baptism-follow-up/notice";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-baptism-follow-up-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@example.test");

const prisma = new PrismaClient();
const P = `bf1680_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_event`, church: `${P}_church`, churchNoPastor: `${P}_church2`, club: `${P}_club`, clubNoPastor: `${P}_club2`,
  holder: `${P}_holder`, user: `${P}_user`, form: `${P}_form`, version: `${P}_form_v1`,
};
const lead = `${P}-lead@example.test`;
const second = `${P}-second@example.test`;
const pastor = `${P}-pastor@example.test`;
const keyPrefix = `baptism-follow-up:${ids.event}:`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.messageOutbox.deleteMany({ where: { idempotencyKey: { startsWith: keyPrefix } } });
  await prisma.auditLog.deleteMany({ where: { eventId: ids.event } });
  await prisma.event.deleteMany({ where: { id: ids.event } });
  // A pastor contact is never deleted by the product (a trigger refuses it); the superuser setting lets this check clear its own rows.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM "OrganizationContact" WHERE "organizationId" IN (${Prisma.join([ids.church, ids.churchNoPastor])})`;
  });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.club, ids.clubNoPastor] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.church, ids.churchNoPastor] } } });
  await prisma.person.deleteMany({ where: { id: ids.holder } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

let counter = 0;
/** A club registration whose stored answers hold the baptism names; returns the registration id. */
async function register(organizationId: string, baptismNames: string): Promise<string> {
  counter += 1;
  const created = await prisma.registration.create({
    data: { eventId: ids.event, accountHolderPersonId: ids.holder, confirmationCode: `${P}-${counter}`, status: "CONFIRMED", totalAmount: "0.00", submittedAt: new Date("2027-03-01T10:00:00Z") },
    select: { id: true },
  });
  await prisma.clubEventRegistration.create({ data: { eventId: ids.event, organizationId, registrationId: created.id, teamKey: "" } });
  await prisma.publicRegistrationSubmission.create({
    data: { eventId: ids.event, formVersionId: ids.version, registrationId: created.id, idempotencyKey: `${P}-${counter}`, requestHash: `hash-${counter}`, responses: { baptism_names: baptismNames, phone: "(515) 555-0100" }, pricingSnapshot: { lineItems: [] } },
  });
  return created.id;
}

const setNames = (registrationId: string, baptismNames: string) =>
  prisma.publicRegistrationSubmission.update({ where: { registrationId }, data: { responses: { baptism_names: baptismNames, phone: "(515) 555-0100" } } });
const notify = (organizationId: string, registrationId: string) => queueBaptismFollowUpNotices({ eventId: ids.event, organizationId, registrationId });
const outbox = () => prisma.messageOutbox.findMany({ where: { idempotencyKey: { startsWith: keyPrefix } }, orderBy: { createdAt: "asc" } });
const ledger = (organizationId: string) => prisma.baptismFollowUp.findMany({ where: { eventId: ids.event, organizationId } });

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: ids.user, email: `${P}-admin@example.test`, displayName: "Baptism Admin", globalRole: "SYSTEM_ADMIN" } });
  await prisma.person.create({ data: { id: ids.holder, firstName: "Pat", lastName: "Holder" } });
  await prisma.organization.createMany({ data: [
    { id: ids.church, type: "CHURCH", name: `Sample Church ${P}`, normalizedName: `sample church ${P}` },
    { id: ids.churchNoPastor, type: "CHURCH", name: `Sample Church Two ${P}`, normalizedName: `sample church two ${P}` },
  ] });
  await prisma.organization.createMany({ data: [
    { id: ids.club, type: "CLUB", name: `Sample Club ${P}`, normalizedName: `sample club ${P}`, parentOrganizationId: ids.church },
    { id: ids.clubNoPastor, type: "CLUB", name: `Sample Club Two ${P}`, normalizedName: `sample club two ${P}`, parentOrganizationId: ids.churchNoPastor },
  ] });
  await prisma.organizationContact.create({ data: { organizationId: ids.church, kind: "PASTOR", name: "Pastor Sample", email: pastor } });
  await prisma.event.create({ data: { id: ids.event, slug: `${P}-event`, name: "Sample Fall Camporee 2027", audience: "CLUB", timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE", startsAt: new Date("2027-10-08T14:00:00Z"), endsAt: new Date("2027-10-10T17:00:00Z") } });
  await prisma.registrationForm.create({ data: { id: ids.form, eventId: ids.event, createdByUserId: ids.user, name: "Synthetic form", slug: `${P}-form` } });
  await prisma.registrationFormVersion.create({ data: { id: ids.version, formId: ids.form, createdByUserId: ids.user, versionNumber: 1, definition: { sections: [] } } });
  const registration = await register(ids.club, "Ava Sample");

  // Off by default: no module row, nothing queued or remembered, even with a lead set.
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "baptism-follow-up" } }) === 0, "off by default");
  await prisma.baptismFollowUpSetting.create({ data: { eventId: ids.event, leadEmails: [lead, second] } });
  assert((await notify(ids.club, registration)).result.queued === 0, "module off: nothing queued");
  assert((await outbox()).length === 0 && (await ledger(ids.club)).length === 0, "module off: nothing queued or remembered");

  // On with no lead: nothing.
  await prisma.eventModule.create({ data: { eventId: ids.event, moduleKey: "baptism-follow-up" } });
  await prisma.baptismFollowUpSetting.update({ where: { eventId: ids.event }, data: { leadEmails: [] } });
  assert((await notify(ids.club, registration)).result.queued === 0 && (await ledger(ids.club)).length === 0, "no lead: nothing queued or remembered");

  // On with leads and a pastor: one row per recipient.
  await prisma.baptismFollowUpSetting.update({ where: { eventId: ids.event }, data: { leadEmails: [lead, second] } });
  const first = await notify(ids.club, registration);
  assert(first.result.queued === 3 && first.result.names === 1 && first.messageIds.length === 3, "two leads and the pastor each get one row");
  let rows = await outbox();
  assert(rows.map((row) => row.recipientEmail).sort().join() === [lead, pastor, second].sort().join(), "the rows go to the leads and the pastor");
  assert(rows.every((row) => row.templateKey === "BAPTISM_FOLLOW_UP" && row.recipientKind === "INTERNAL" && row.status === "PENDING"), "internal, pending, own template");
  for (const row of rows) {
    const body = row.bodyTextSnapshot;
    assert(body.includes("Ava Sample") && body.includes(`Sample Club ${P}`) && body.includes("Sample Fall Camporee 2027") && body.includes("October") && body.includes("follow up"), "the email names the person, club, event, date and asks to follow up");
    assert(!body.includes("555") && !/@/.test(body), "no phone or address in the body");
  }
  const ledgerRows = await ledger(ids.club);
  assert(ledgerRows.length === 1 && ledgerRows[0]!.normalizedName === "ava sample" && ledgerRows[0]!.pastorNotified && ledgerRows[0]!.leadNotified, "one ledger row recording who was told");
  const audits = await prisma.auditLog.findMany({ where: { eventId: ids.event, action: "BAPTISM_FOLLOW_UP_NOTICE_QUEUED" } });
  assert(audits.length === 1 && !/Ava|@example/.test(JSON.stringify(audits)), "one audit entry, with no name or address");

  // The same names again, in any case or spacing: nothing new.
  await setNames(registration, "  AVA   sample ");
  assert((await notify(ids.club, registration)).result.queued === 0 && (await outbox()).length === 3, "the same name again adds nothing");

  // One new name: only that name.
  await setNames(registration, "Ava Sample, Ben Sample");
  const added = await notify(ids.club, registration);
  assert(added.result.queued === 3 && added.result.names === 1, "one new name, three rows");
  rows = await outbox();
  const newest = rows.filter((row) => row.bodyTextSnapshot.includes("Ben Sample"));
  assert(newest.length === 3 && newest.every((row) => !row.bodyTextSnapshot.includes("Ava Sample")), "only the new name is in the new emails");

  // A removed name does nothing, and putting it back is not announced again.
  await setNames(registration, "Ben Sample");
  assert((await notify(ids.club, registration)).result.queued === 0, "a removed name does nothing");
  await setNames(registration, "Ava Sample, Ben Sample");
  assert((await notify(ids.club, registration)).result.queued === 0 && (await outbox()).length === 6, "a returned name is not announced again");

  // Two notifies racing on the same new name: one ledger row, no duplicate outbox rows.
  await setNames(registration, "Ava Sample, Ben Sample, Cleo Sample");
  const before = (await outbox()).length;
  const raced = await Promise.all([notify(ids.club, registration), notify(ids.club, registration)]);
  assert(raced.reduce((sum, run) => sum + run.result.names, 0) === 1, "exactly one of the racing notifies recorded the name");
  assert((await prisma.baptismFollowUp.count({ where: { eventId: ids.event, organizationId: ids.club, normalizedName: "cleo sample" } })) === 1, "one ledger row for the raced name");
  assert((await outbox()).length === before + 3, "no duplicate outbox rows for the raced name");
  const keys = (await outbox()).map((row) => row.idempotencyKey);
  assert(new Set(keys).size === keys.length, "every outbox key is unique");

  // No pastor on file: the event lead only.
  const other = await register(ids.clubNoPastor, "Dan Sample");
  const solo = await notify(ids.clubNoPastor, other);
  assert(solo.result.queued === 2 && solo.result.recipients.join() === "lead", "no pastor: the leads only");
  const soloRows = (await outbox()).filter((row) => row.bodyTextSnapshot.includes("Dan Sample"));
  assert(soloRows.map((row) => row.recipientEmail).sort().join() === [lead, second].sort().join(), "the rows go to the leads only");
  assert((await ledger(ids.clubNoPastor))[0]!.pastorNotified === false, "the ledger says the pastor was not told");

  // Turned off again: nothing more.
  await prisma.eventModule.deleteMany({ where: { eventId: ids.event, moduleKey: "baptism-follow-up" } });
  await setNames(registration, "Ava Sample, Ben Sample, Cleo Sample, Eli Sample");
  assert((await notify(ids.club, registration)).result.queued === 0, "module off again: nothing queued");
  assert((await prisma.baptismFollowUp.count({ where: { eventId: ids.event, normalizedName: "eli sample" } })) === 0, "and nothing remembered");

  console.log("baptism follow-up: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // A failed cleanup fails the run: leftovers must never be hidden.
    await cleanup().catch((error) => {
      console.error("cleanup failed", error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
