/**
 * Proves the optional baptism follow-up notice (#1680) against a real PostgreSQL database:
 *
 * - module off: nothing is queued or remembered; module on with no event lead: nothing is queued or remembered;
 * - a name on a club's registration gives one outbox row per recipient (each event lead address and the church pastor) and one ledger row;
 * - the same names again, in any case or spacing, add nothing;
 * - one new name queues only that name; a removed name does nothing and putting it back is not announced again;
 * - two notifies racing on the same new name leave one ledger row and no duplicate outbox row;
 * - no pastor on file: the event lead only;
 * - the email holds only the names, club, event, dates and the request; the audit entry holds counts and roles, never a name or an address;
 * - followed-up status and note: mark (with who), unmark (keeps the note), note only, a repeat writes nothing, a note over 500 characters and a row of
 *   another event are refused, module off is refused, and each real change is one audit entry with no name or note;
 * - an Area Coordinator (active grant) may do the same and is recorded as the account; a revoked grant and an unpublished event are refused; opening the list is audited by count.
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
import { recordBaptismListViewed, updateBaptismFollowUp } from "@/modules/baptism-follow-up/follow-up";
import { applyBaptismFollowUpSwitch, loadBaptismFollowUpPage, saveBaptismLeadEmails } from "@/modules/baptism-follow-up/settings";
import { previewBaptismFollowUpNotice, queueBaptismFollowUpNotices } from "@/modules/baptism-follow-up/notice";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-baptism-follow-up-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@example.test");

const prisma = new PrismaClient();
const P = `bf1680_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_event`, church: `${P}_church`, churchNoPastor: `${P}_church2`, club: `${P}_club`, clubNoPastor: `${P}_club2`,
  holder: `${P}_holder`, user: `${P}_user`, ac: `${P}_ac`, revoked: `${P}_revoked`, event2: `${P}_event2`, form: `${P}_form`, version: `${P}_form_v1`,
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
  await prisma.auditLog.deleteMany({ where: { eventId: { in: [ids.event, ids.event2] } } });
  await prisma.event.deleteMany({ where: { id: { in: [ids.event, ids.event2] } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: [ids.ac, ids.revoked] } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: [ids.ac, ids.revoked] } } });
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
  await prisma.attendeeAccount.createMany({ data: [
    { id: ids.ac, email: `${P}-ac@example.test`, displayName: "Sample Coordinator", status: "ACTIVE" },
    { id: ids.revoked, email: `${P}-revoked@example.test`, displayName: "Former Coordinator", status: "ACTIVE" },
  ] });
  await prisma.areaCoordinatorGrant.createMany({ data: [
    { attendeeAccountId: ids.ac, grantedByUserId: ids.user },
    { attendeeAccountId: ids.revoked, grantedByUserId: ids.user, revokedAt: new Date(), revokedByUserId: ids.user },
  ] });
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

  // A staff edit's preview (#1680): offered only for a new name, with roles and no address; the club comes from the registration.
  const staffEdit = (names: string) => previewBaptismFollowUpNotice({ eventId: ids.event, registrationId: registration, responses: { baptism_names: names } });
  const offer = await staffEdit("Ava Sample, Ben Sample, Cleo Sample, Fay Sample");
  assert(offer !== null && offer.names === 1 && offer.recipients.join() === "lead,pastor" && !JSON.stringify(offer).includes("@"), "a staff edit adding one new name is offered, by role");
  assert(await staffEdit("Ava Sample, Ben Sample, Cleo Sample") === null, "a staff edit with no new name is not offered");
  assert((await ledger(ids.club)).length === 3 && (await outbox()).length === 9, "offering sends and remembers nothing");

  // No pastor on file: the event lead only.
  const other = await register(ids.clubNoPastor, "Dan Sample");
  const solo = await notify(ids.clubNoPastor, other);
  assert(solo.result.queued === 2 && solo.result.recipients.join() === "lead", "no pastor: the leads only");
  const soloRows = (await outbox()).filter((row) => row.bodyTextSnapshot.includes("Dan Sample"));
  assert(soloRows.map((row) => row.recipientEmail).sort().join() === [lead, second].sort().join(), "the rows go to the leads only");
  assert((await ledger(ids.clubNoPastor))[0]!.pastorNotified === false, "the ledger says the pastor was not told");

  // Followed-up status and note (#1680); the module is still on here.
  const staff = { kind: "staff" as const, userId: ids.user };
  const coordinator = { kind: "area-coordinator" as const, accountId: ids.ac };
  const target = (await ledger(ids.club)).find((row) => row.normalizedName === "ava sample")!;
  const statusAudits = () => prisma.auditLog.findMany({ where: { eventId: ids.event, action: "BAPTISM_FOLLOW_UP_STATUS_CHANGED" } });
  const note = "Called the family on Sunday";
  const marked = await updateBaptismFollowUp(staff, ids.event, target.id, { followedUp: true, note: `  ${note}  ` });
  assert(marked.followedUpAt !== null && marked.note === note, "marking sets the time and keeps the trimmed note");
  let row = await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } });
  assert(row.followedUpByUserId === ids.user && row.followedUpByAttendeeAccountId === null, "a staff mark records the staff user only");
  assert((await statusAudits()).length === 1, "one audit entry for the mark");
  await updateBaptismFollowUp(staff, ids.event, target.id, { followedUp: true, note });
  assert((await statusAudits()).length === 1, "a repeat that changes nothing writes no audit entry");
  await updateBaptismFollowUp(staff, ids.event, target.id, { followedUp: false });
  row = await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } });
  assert(row.followedUpAt === null && row.followedUpByUserId === null && row.followUpNote === note, "unmarking clears when and who and keeps the note");
  await updateBaptismFollowUp(staff, ids.event, target.id, { note: "Visited" });
  assert((await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } })).followUpNote === "Visited", "a note-only change is saved");
  await updateBaptismFollowUp(staff, ids.event, target.id, { note: "" });
  assert((await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } })).followUpNote === null, "an emptied note is cleared");
  const refused = async (run: () => Promise<unknown>, code: string, label: string) => {
    let thrown: unknown;
    await run().catch((error) => { thrown = error; });
    assert((thrown as { code?: string } | undefined)?.code === code, label);
  };
  await refused(() => updateBaptismFollowUp(staff, ids.event, target.id, { note: "x".repeat(501) }), "INVALID_NOTE", "a note over 500 characters is refused");
  await prisma.event.create({ data: { id: ids.event2, slug: `${P}-event2`, name: "Sample Other Camporee 2027", audience: "CLUB", timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE", startsAt: new Date("2027-11-05T14:00:00Z"), endsAt: new Date("2027-11-07T17:00:00Z") } });
  await prisma.eventModule.create({ data: { eventId: ids.event2, moduleKey: "baptism-follow-up" } });
  await refused(() => updateBaptismFollowUp(staff, ids.event2, target.id, { followedUp: true }), "FOLLOW_UP_NOT_FOUND", "a row of another event is not found");
  assert((await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } })).followedUpAt === null, "the other event's call changed nothing");

  // An Area Coordinator: the same actions, recorded as the account; a revoked grant and an unpublished event are refused.
  await updateBaptismFollowUp(coordinator, ids.event, target.id, { followedUp: true, note: "Coordinator note" });
  row = await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } });
  assert(row.followedUpByAttendeeAccountId === ids.ac && row.followedUpByUserId === null && row.followedUpAt !== null, "a coordinator mark records the account only");
  const viaCoordinator = (await statusAudits()).filter((entry) => entry.actorUserId === null);
  assert(viaCoordinator.length === 1 && (viaCoordinator[0]!.metadata as { actorAttendeeAccountId?: string }).actorAttendeeAccountId === ids.ac, "the coordinator's change is audited under the account");
  assert(!/Ava|Coordinator note|Called the family|Visited/.test(JSON.stringify(await statusAudits())), "no audit entry holds a name or a note");
  await refused(() => updateBaptismFollowUp({ kind: "area-coordinator", accountId: ids.revoked }, ids.event, target.id, { followedUp: false }), "NOT_AVAILABLE", "a revoked grant is refused");
  await saveBaptismLeadEmails(coordinator, ids.event, `${P}-lead3@example.test`);
  assert((await prisma.baptismFollowUpSetting.findUniqueOrThrow({ where: { eventId: ids.event } })).leadEmails.join() === `${P}-lead3@example.test`, "a coordinator saves the lead addresses");
  await prisma.baptismFollowUpSetting.update({ where: { eventId: ids.event }, data: { leadEmails: [lead, second] } });
  const page = await loadBaptismFollowUpPage(ids.event, "area-coordinator");
  const listed = page.clubs.flatMap((club) => club.names).find((name) => name.id === target.id);
  assert(listed?.followedUpAt !== null && listed?.note === "Coordinator note", "the page carries the status and note");
  await recordBaptismListViewed(coordinator, ids.event, page.clubs.reduce((sum, club) => sum + club.names.length, 0));
  const viewed = await prisma.auditLog.findMany({ where: { eventId: ids.event, action: "BAPTISM_FOLLOW_UP_LIST_VIEWED" } });
  assert(viewed.length === 1 && !/Ava|Sample Club|Coordinator note/.test(JSON.stringify(viewed)), "opening the list is audited by count, with no name or note");
  await prisma.event.update({ where: { id: ids.event2 }, data: { isPublished: false } });
  await refused(() => loadBaptismFollowUpPage(ids.event2, "area-coordinator"), "EVENT_NOT_FOUND", "an unpublished event is not found for a coordinator");
  await refused(() => applyBaptismFollowUpSwitch(coordinator, ids.event2, false), "EVENT_NOT_FOUND", "a coordinator cannot switch an unpublished event");
  assert((await applyBaptismFollowUpSwitch(staff, ids.event2, false)).enabled === false, "staff may switch an unpublished event off");

  // Switched off: the status and note are refused, and kept.
  assert((await applyBaptismFollowUpSwitch(coordinator, ids.event, false)).enabled === false, "a coordinator switches it off");
  await refused(() => updateBaptismFollowUp(staff, ids.event, target.id, { followedUp: false }), "MODULE_OFF", "module off: a status change is refused");
  assert((await prisma.baptismFollowUp.findUniqueOrThrow({ where: { id: target.id } })).followUpNote === "Coordinator note", "off keeps the note");
  assert((await applyBaptismFollowUpSwitch(staff, ids.event, true)).enabled === true, "staff switch it back on");

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
