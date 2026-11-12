/**
 * Proves the optional Event debrief (#1679) against a real PostgreSQL database:
 *
 * - off by default; an active Area Coordinator, the Clubs Administrator's role (Event Admin) and a system administrator can
 *   switch it on; a coordinator with no grant or a revoked one, an unpublished event, a general event and a Registration
 *   Manager are refused; each switch is audited (a coordinator by account);
 * - switching on makes the debrief form (signed-in only, marked with its purpose, the three starter questions) and two approved
 *   scheduled emails at 8:00 a.m. Central the day after the last day and three days later; twice makes nothing twice;
 * - the audience is the event's active staff (with a linked account) and the active Area Coordinators; one invitation each,
 *   queued once however often the batch is run; the reminder goes only to those who have not answered;
 * - a person who is not on the list cannot answer, a person answers once, and the debrief form is not in the forms hub;
 * - switching off cancels what is unsent and keeps the form and the answers; a changed end date moves the unsent emails;
 * - copying the event for next year carries the source event and the evaluation switch, and builds the copy's form from the
 *   source's published questions.
 *
 * Uses fictitious rows it creates and removes itself. Nothing is sent: messages are only queued.
 *
 *   npm run test:event-debrief
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { runScheduledEmailBatch } from "@/modules/communications/scheduled-email-repository";
import { debriefBatchId } from "@/modules/event-debriefs/domain";
import { copyDebriefSetup, reprojectDebriefBatches } from "@/modules/event-debriefs/lifecycle";
import { canReadDebriefAnswers } from "@/modules/event-debriefs/results";
import { applyDebriefSettings, requireStaffDebriefAccess } from "@/modules/event-debriefs/settings";
import { listInformationFormsForHub } from "@/modules/information-forms/hub";
import { storeInformationFormResponse } from "@/modules/information-forms/responses";
import { findActiveMembership } from "@/modules/events/repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-event-debrief-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@example.test");

const prisma = new PrismaClient();
const P = `db1679_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_event`, copy: `${P}_copy`, unpublished: `${P}_unpub`, general: `${P}_gen`,
  admin: `${P}_admin`, eventAdmin: `${P}_eadmin`, manager: `${P}_mgr`, staffLinked: `${P}_staff`, staffUnlinked: `${P}_nolink`,
  acStaff: `${P}_acstaff`, ac: `${P}_ac`, revoked: `${P}_revoked`, plain: `${P}_plain`,
};
const userIds = [ids.admin, ids.eventAdmin, ids.manager, ids.staffLinked, ids.staffUnlinked];
const accountIds = [ids.acStaff, ids.ac, ids.revoked, ids.plain];
const eventIds = [ids.event, ids.copy, ids.unpublished, ids.general];
const admin = { id: ids.admin, email: `${P}-admin@example.test`, displayName: "Debrief Admin", globalRole: "SYSTEM_ADMIN" } as AuthenticatedUser;
const manager = { id: ids.manager, email: `${P}-mgr@example.test`, displayName: "Debrief Manager", globalRole: null } as AuthenticatedUser;
const eventAdmin = { id: ids.eventAdmin, email: `${P}-eadmin@example.test`, displayName: "Debrief Event Admin", globalRole: null } as AuthenticatedUser;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function refused(run: () => Promise<unknown>, message: string, code?: string) {
  try {
    await run();
  } catch (error) {
    const found = (error as { code?: string }).code;
    if (code && found !== code) throw new Error(`FAILED: ${message} (got ${String(found)})`);
    return;
  }
  throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.informationFormResponse.deleteMany({ where: { form: { eventId: { in: eventIds } } } });
  await prisma.messageOutbox.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.scheduledEmailBatch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.informationFormVersion.deleteMany({ where: { form: { eventId: { in: eventIds } } } });
  await prisma.informationForm.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventDebrief.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: accountIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: accountIds } } });
}

async function main() {
  await cleanup();
  await prisma.attendeeAccount.createMany({ data: [
    { id: ids.acStaff, email: `${P}-staff@example.test`, displayName: "Sample Staff Member", status: "ACTIVE" },
    { id: ids.ac, email: `${P}-ac@example.test`, displayName: "Sample Coordinator", status: "ACTIVE" },
    { id: ids.revoked, email: `${P}-revoked@example.test`, displayName: "Former Coordinator", status: "ACTIVE" },
    { id: ids.plain, email: `${P}-plain@example.test`, displayName: "Sample Attendee", status: "ACTIVE" },
  ] });
  await prisma.user.createMany({ data: [
    { id: ids.admin, email: admin.email, displayName: admin.displayName, globalRole: "SYSTEM_ADMIN" },
    { id: ids.eventAdmin, email: eventAdmin.email, displayName: eventAdmin.displayName },
    { id: ids.manager, email: manager.email, displayName: manager.displayName },
    { id: ids.staffLinked, email: `${P}-staff-user@example.test`, displayName: "Sample Staff Member", attendeeAccountId: ids.acStaff },
    { id: ids.staffUnlinked, email: `${P}-nolink@example.test`, displayName: "Unlinked Staff" },
  ] });
  await prisma.areaCoordinatorGrant.createMany({ data: [
    { attendeeAccountId: ids.ac, grantedByUserId: ids.admin },
    { attendeeAccountId: ids.revoked, grantedByUserId: ids.admin, revokedAt: new Date(), revokedByUserId: ids.admin },
  ] });
  const base = { audience: "CLUB" as const, timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const };
  const dates = { startsAt: new Date("2027-05-07T14:00:00Z"), endsAt: new Date("2027-05-08T22:00:00Z") };
  await prisma.event.create({ data: { id: ids.event, slug: `${P}-event`, name: "Sample Spring Camporee 2027", ...base, ...dates } });
  await prisma.event.create({ data: { id: ids.unpublished, slug: `${P}-unpub`, name: "Sample Unpublished", ...base, ...dates, isPublished: false } });
  await prisma.event.create({ data: { id: ids.general, slug: `${P}-gen`, name: "Sample General", ...base, ...dates, audience: "GENERAL" } });
  await prisma.eventMembership.createMany({ data: [
    { eventId: ids.event, userId: ids.eventAdmin, role: "EVENT_ADMIN" },
    { eventId: ids.event, userId: ids.manager, role: "REGISTRATION_MANAGER" },
    { eventId: ids.event, userId: ids.staffLinked, role: "READ_ONLY_STAFF" },
    { eventId: ids.event, userId: ids.staffUnlinked, role: "READ_ONLY_STAFF" },
  ] });
  const now = new Date("2027-05-01T15:00:00Z");
  const ac = { kind: "area-coordinator" as const, accountId: ids.ac };
  const staff = { kind: "staff" as const, userId: ids.eventAdmin };

  // Off by default.
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "debrief" } }) === 0, "off by default");

  // Who may switch it.
  await refused(() => applyDebriefSettings({ kind: "area-coordinator", accountId: ids.plain }, ids.event, { enabled: true }, now), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => applyDebriefSettings({ kind: "area-coordinator", accountId: ids.revoked }, ids.event, { enabled: true }, now), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => applyDebriefSettings(ac, ids.unpublished, { enabled: true }, now), "a coordinator cannot reach an unpublished event", "EVENT_NOT_FOUND");
  await refused(() => applyDebriefSettings(ac, ids.general, { enabled: true }, now), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => requireStaffDebriefAccess({ user: manager }, ids.event, findActiveMembership), "a Registration Manager is refused", "PERMISSION_DENIED");
  await refused(() => applyDebriefSettings(ac, ids.event, { evaluationEnabled: true }, now), "a coordinator cannot choose the evaluation", "NOT_PERMITTED");
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "debrief" } }) === 0, "nothing was switched on by a refusal");

  // A coordinator switches it on.
  const state = await applyDebriefSettings(ac, ids.event, { enabled: true }, now);
  assert(state.enabled && !state.evaluationEnabled && state.fillPath === `/events/${P}-event/forms/debrief`, "switched on, evaluation off, with the form's address");
  const audited = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED", entityId: "debrief" } });
  assert(audited && !audited.actorUserId && (audited.metadata as { actorAttendeeAccountId?: string }).actorAttendeeAccountId === ids.ac, "the switch is audited with the coordinator's account");
  const form = await prisma.informationForm.findFirstOrThrow({ where: { eventId: ids.event, purpose: "DEBRIEF" }, include: { versions: true } });
  assert(form.fillAccess === "SIGNED_IN" && form.status === "OPEN" && form.versions.length === 1 && form.versions[0]!.status === "PUBLISHED", "a published, open, signed-in-only form");
  const questions = JSON.stringify(form.versions[0]!.definition);
  assert(questions.includes("What went well?") && questions.includes("What should we do better?") && questions.includes("Ideas for next year?"), "the three starter questions");
  const batches = await prisma.scheduledEmailBatch.findMany({ where: { eventId: ids.event }, orderBy: { sendAt: "asc" } });
  assert(batches.length === 2 && batches.every((batch) => batch.status === "ACTIVE" && batch.trigger === "AFTER_EVENT_END" && batch.createdByUserId === null && batch.createdByAttendeeAccountId === ids.ac), "two approved batches made by the coordinator's switch");
  assert(batches[0]!.sendAt.toISOString() === "2027-05-09T13:00:00.000Z" && batches[1]!.sendAt.toISOString() === "2027-05-12T13:00:00.000Z", "8:00 a.m. Central the day after, and three days later");
  await applyDebriefSettings(staff, ids.event, { enabled: true }, now);
  assert(await prisma.scheduledEmailBatch.count({ where: { eventId: ids.event } }) === 2 && await prisma.informationForm.count({ where: { eventId: ids.event, purpose: "DEBRIEF" } }) === 1, "switching on twice makes nothing twice");
  const hub = await listInformationFormsForHub();
  assert(!hub.some((row) => row.id === `information:${form.id}`), "the debrief form is not in the forms hub");

  // Sending the invitation.
  const inviteId = debriefBatchId(ids.event, "INVITE");
  const inviteTime = new Date("2027-05-09T13:00:30Z");
  const first = await runScheduledEmailBatch(inviteId, { now: inviteTime });
  // The audience holds every active Area Coordinator in the database, so only this script's own people are counted.
  assert(first.outcome === "completed" && first.queued >= 2, `the invitation is queued (${JSON.stringify(first)})`);
  const queued = await prisma.messageOutbox.findMany({ where: { eventId: ids.event, templateKey: "EVENT_DEBRIEF_INVITE" }, select: { recipientEmail: true, bodyTextSnapshot: true, status: true } });
  const emails = queued.map((row) => row.recipientEmail).sort();
  assert(emails.includes(`${P}-staff@example.test`) && emails.includes(`${P}-ac@example.test`), "staff with a linked account and the active coordinator are asked");
  assert(!emails.includes(`${P}-revoked@example.test`) && !emails.includes(`${P}-plain@example.test`) && !emails.includes(`${P}-nolink@example.test`), "a revoked coordinator, a plain attendee and staff with no linked account are not");
  assert(queued.every((row) => row.status === "PENDING" && row.bodyTextSnapshot.includes(`/events/${P}-event/forms/debrief`) && !row.bodyTextSnapshot.includes("What went well?")), "each links to the form and carries no question");
  const again = await runScheduledEmailBatch(inviteId, { now: inviteTime });
  assert(again.outcome === "skipped" && await prisma.messageOutbox.count({ where: { eventId: ids.event, templateKey: "EVENT_DEBRIEF_INVITE" } }) === queued.length, "running it again queues nothing twice");

  // Answering: only the list, once each.
  await refused(() => storeInformationFormResponse({ formId: form.id, idempotencyKey: `${P}-k1-plain`, answers: { went_well: "x" }, attendeeAccountId: ids.plain, now: inviteTime }), "an account that is not on the list cannot answer", "NOT_ALLOWED");
  await refused(() => storeInformationFormResponse({ formId: form.id, idempotencyKey: `${P}-k1-anon`, answers: {}, attendeeAccountId: null, now: inviteTime }), "an anonymous answer is refused", "SIGN_IN_REQUIRED");
  await refused(() => storeInformationFormResponse({ formId: form.id, idempotencyKey: `${P}-k1-empty`, answers: { went_well: " " }, attendeeAccountId: ids.ac, now: inviteTime }), "an empty send is refused and does not use the one answer", "ANSWERS_INVALID");
  await storeInformationFormResponse({ formId: form.id, idempotencyKey: `${P}-k2-ac`, answers: { went_well: "The schedule worked." }, attendeeAccountId: ids.ac, now: inviteTime });
  await refused(() => storeInformationFormResponse({ formId: form.id, idempotencyKey: `${P}-k3-ac`, answers: { went_well: "Again" }, attendeeAccountId: ids.ac, now: inviteTime }), "a person answers once", "ALREADY_ANSWERED");

  // The reminder goes only to people who have not answered.
  const reminder = await runScheduledEmailBatch(debriefBatchId(ids.event, "REMINDER"), { now: new Date("2027-05-12T13:00:30Z") });
  assert(reminder.outcome === "completed" && reminder.excluded >= 1, `the reminder skips the person who answered (${JSON.stringify(reminder)})`);
  const reminded = await prisma.messageOutbox.findMany({ where: { eventId: ids.event, templateKey: "EVENT_DEBRIEF_REMINDER" }, select: { recipientEmail: true } });
  assert(!reminded.some((row) => row.recipientEmail === `${P}-ac@example.test`) && reminded.some((row) => row.recipientEmail === `${P}-staff@example.test`), "the coordinator who answered is not reminded, the staff member who did not is");

  // Who reads the answers.
  assert(await canReadDebriefAnswers({ user: admin }, ids.event) && await canReadDebriefAnswers({ user: eventAdmin }, ids.event), "a system administrator and an Event Admin can read");
  assert(!(await canReadDebriefAnswers({ user: { id: ids.staffLinked, email: "x@example.test", displayName: "S", globalRole: null } }, ids.event)), "read-only staff cannot read the answers");

  // Switching off, and the dates moving.
  await prisma.scheduledEmailBatch.updateMany({ where: { eventId: ids.event }, data: { status: "ACTIVE", claimToken: null, completedAt: null } });
  await prisma.event.update({ where: { id: ids.event }, data: { endsAt: new Date("2027-05-15T22:00:00Z") } });
  assert(await prisma.$transaction((tx) => reprojectDebriefBatches(tx, ids.event)) === 2, "a changed end date moves the unsent batches");
  const moved = await prisma.scheduledEmailBatch.findUniqueOrThrow({ where: { id: inviteId } });
  assert(moved.sendAt.toISOString() === "2027-05-16T13:00:00.000Z", "the invitation follows the new end date");
  await applyDebriefSettings(staff, ids.event, { evaluationEnabled: true }, now);
  assert((await prisma.eventDebrief.findUniqueOrThrow({ where: { eventId: ids.event } })).evaluationEnabled && await prisma.informationForm.count({ where: { eventId: ids.event, purpose: "DIRECTOR_EVALUATION" } }) === 1, "the evaluation has its own switch and form");
  await applyDebriefSettings(staff, ids.event, { enabled: false }, now);
  assert((await prisma.scheduledEmailBatch.findMany({ where: { eventId: ids.event } })).every((batch) => batch.status === "CANCELLED"), "switching off cancels the unsent batches");
  assert(await prisma.informationFormResponse.count({ where: { formId: form.id } }) === 1 && await prisma.informationForm.count({ where: { eventId: ids.event, purpose: "DEBRIEF" } }) === 1, "the form and the answer are kept");
  await refused(() => storeInformationFormResponse({ formId: form.id, idempotencyKey: `${P}-k4`, answers: {}, attendeeAccountId: ids.acStaff, now: inviteTime }), "no one can answer while it is off", "NOT_ALLOWED");

  // Copying for next year.
  await prisma.event.create({ data: { id: ids.copy, slug: `${P}-copy`, name: "Sample Spring Camporee 2028", ...base, startsAt: new Date("2028-05-05T14:00:00Z"), endsAt: new Date("2028-05-06T22:00:00Z") } });
  await prisma.eventModule.create({ data: { eventId: ids.copy, moduleKey: "debrief" } });
  await prisma.$transaction((tx) => copyDebriefSetup(tx, { sourceEventId: ids.event, targetEventId: ids.copy, actorUserId: ids.admin, now }));
  const copied = await prisma.eventDebrief.findUniqueOrThrow({ where: { eventId: ids.copy } });
  assert(copied.carriedFromEventId === ids.event && copied.evaluationEnabled, "the copy remembers its source and keeps the evaluation switch");
  assert(await prisma.scheduledEmailBatch.count({ where: { eventId: ids.copy, status: "ACTIVE" } }) === 2, "the copy has its own schedule from its own dates");
  assert(await prisma.informationFormResponse.count({ where: { form: { eventId: ids.copy } } }) === 0, "no answer is copied");

  console.log("Event debrief verified.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
