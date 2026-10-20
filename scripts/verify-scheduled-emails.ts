/**
 * Proves scheduled email batches (#177) against a real PostgreSQL database and a stand-in email provider.
 *
 * - a schedule is written and reviewed first and sends nothing; only a person's explicit approval (with the review
 *   fingerprint they were shown) makes it ACTIVE; a stale fingerprint is refused; create and approve replay safely;
 * - times are event-local: a one-time schedule on the spring-forward day goes out at the first moment after the jump,
 *   and the review says so; a relative schedule counts calendar days in the event's zone;
 * - at send time every approved recipient is re-evaluated: payment before a balance reminder, a cancelled registration,
 *   a transferred contact and a bounced address are dropped with a code, and the rest are queued;
 * - duplicate workers and retries cannot duplicate a batch or a recipient (three concurrent runs, a re-run, and a run
 *   that crashed after queueing a message but before recording it);
 * - a recipient who pays after the message was queued but before it is sent is cancelled by the pre-send check, and
 *   nobody else is affected;
 * - pause works only before a send has begun; cancel before the send leaves nothing queued, and cancel after partial
 *   delivery keeps every sent row and cancels only the rest;
 * - youth never receive these: a minor's own address (even one collected later) is excluded at review, a recipient who
 *   became a minor after approval is dropped at send time, and a forged approved-recipient row for a minor is dropped;
 * - edits send a schedule back to approval; a changed event time zone, a republished template, an approver who lost
 *   permission pause the schedule; a schedule that missed its window fails instead of sending late.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:scheduled-emails
 */
import { configureSyntheticEmailEnvironment, setSyntheticCentralSender, clearSyntheticCentralSender } from "./support/central-email";
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
configureSyntheticEmailEnvironment();
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-scheduled-emails-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("MANAGE_LINK_DERIVATION_SECRET", "verify-scheduled-emails-synthetic-derivation-secret-01");
fillBlankSyntheticEnv("ATTENDEE_PASS_SIGNING_SECRET", "verify-scheduled-emails-synthetic-pass-signing-secret-01");
process.env.APP_BASE_URL = "https://events.example.test";

const prisma = new PrismaClient();
const P = `sch177_${randomUUID().slice(0, 8)}`;
const ids = { admin: `${P}_admin`, comms: `${P}_comms`, event: `${P}_event`, other: `${P}_other` };
const email = (name: string) => `${P}.${name}@example.test`;
const allPermissions = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS", "VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN", "MANAGE_REGISTRATION", "MANAGE_FINANCE", "CONFIGURE_EVENT"];
const commsPermissions = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

type ProviderPayload = { to: string[]; subject: string };

function startProviderStub() {
  const received: ProviderPayload[] = [];
  const server: Server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/emails" && request.method === "POST") received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderPayload);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `stub_email_${received.length}_${randomUUID()}` }));
    });
  });
  return new Promise<{ url: string; received: ProviderPayload[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, received, close: () => new Promise((done) => { server.close(() => done()); }) });
    });
  });
}

async function cleanup() {
  await clearSyntheticCentralSender(prisma);
  const eventIds = [ids.event, ids.other];
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { actorUserId: { in: [ids.admin, ids.comms] } }] } });
  await prisma.scheduledEmailBatch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.messageOutbox.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { recipientEmail: { startsWith: `${P}.` } }] } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_p_` } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.comms] } } });
}

async function main() {
  const stub = await startProviderStub();
  process.env.RESEND_API_KEY = "re_synthetic_stub_key";
  process.env.RESEND_API_URL = stub.url;
  try {
    await runChecks(stub);
  } finally {
    await stub.close();
  }
}

async function runChecks(stub: Awaited<ReturnType<typeof startProviderStub>>) {
  const schedules = await import("@/modules/communications/scheduled-email-repository");
  const { processExternalEmailQueue, prepareEmailBodyForDelivery } = await import("@/modules/communications/email-delivery");
  const { MessagingError } = await import("@/modules/communications/messaging-error");
  const { ensureEventMessagingDefaults, publishMessageTemplateVersion } = await import("@/modules/communications/messaging-repository");
  const eventTimezoneForTest = "America/Chicago";

  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ids.admin, email: `${P}.admin@example.test`, displayName: "Synthetic Admin" },
      { id: ids.comms, email: `${P}.comms@example.test`, displayName: "Synthetic Comms" },
    ],
  });
  for (const [eventId, slug] of [[ids.event, "event"], [ids.other, "other"]] as const) {
    await prisma.event.create({
      data: {
        id: eventId, slug: `${P}-${slug}`, name: `Scheduled Email Verification ${slug}`, timezone: eventTimezoneForTest,
        startsAt: new Date("2027-06-10T14:00:00Z"), endsAt: new Date("2027-06-12T17:00:00Z"), location: "Synthetic Camp",
        registrationClosesOn: "2027-06-01",
      },
    });
  }
  await prisma.eventMembership.createMany({
    data: [
      { eventId: ids.event, userId: ids.admin, role: "EVENT_ADMIN" },
      { eventId: ids.event, userId: ids.comms, role: "COMMUNICATIONS_MANAGER" },
    ],
  });
  await ensureEventMessagingDefaults(ids.event);
  await setSyntheticCentralSender(prisma);
  await prisma.eventMessageSettings.update({
    where: { eventId: ids.event },
    data: { deliveryPaused: false, senderName: "Synthetic Events" },
  });
  const typeIds = { ADULT: `${P}_type_adult`, YOUTH: `${P}_type_youth` };
  await prisma.eventAttendeeType.createMany({
    data: [
      { id: typeIds.ADULT, eventId: ids.event, code: "ADULT", label: "Adult", minimumAge: 18 },
      { id: typeIds.YOUTH, eventId: ids.event, code: "YOUTH", label: "Youth", minimumAge: 0, maximumAge: 17 },
    ],
  });

  async function person(name: string, mail: string | null) {
    const id = `${P}_p_${name}`;
    await prisma.person.create({ data: { id, firstName: name, lastName: "Synthetic", normalizedEmail: mail } });
    return id;
  }
  async function register(code: string, holder: string, contactEmail: string, total: string, attendees: Array<{ person: string; type?: "ADULT" | "YOUTH" }>) {
    const registration = await prisma.registration.create({
      data: {
        eventId: ids.event, accountHolderPersonId: holder, confirmationCode: `${P}-${code}`.toUpperCase(), status: "CONFIRMED",
        totalAmount: total, submittedAt: new Date("2027-01-10T10:00:00Z"),
        contactSnapshot: { firstName: "Contact", lastName: code, email: contactEmail },
      },
      select: { id: true },
    });
    const attendeeIds: string[] = [];
    let position = 0;
    for (const item of attendees) {
      const type = item.type ?? "ADULT";
      const attendee = await prisma.registrationAttendee.create({
        data: {
          eventId: ids.event, registrationId: registration.id, personId: item.person, attendeeType: type, attendeeTypeDefinitionId: typeIds[type],
          position: position++, profileSnapshot: { firstName: "Snapshot", lastName: "Hidden" }, formResponses: {},
        },
        select: { id: true },
      });
      attendeeIds.push(attendee.id);
    }
    return { id: registration.id, attendeeIds };
  }
  const pay = (registrationId: string, amount: string) => prisma.payment.create({
    data: { eventId: ids.event, registrationId, amount, status: "SUCCEEDED", method: "CASH", receivedAt: new Date() },
  });

  // Registrations a..h owe money (h owes nothing). Each contact is an adult with their own address.
  const people: Record<string, string> = {};
  for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) people[name] = await person(`Reg${name.toUpperCase()}`, email(name));
  const reg: Record<string, { id: string; attendeeIds: string[] }> = {};
  const totals: Record<string, string> = { a: "100.00", b: "80.00", c: "60.00", d: "40.00", e: "30.00", f: "20.00", g: "10.00", h: "50.00" };
  for (const name of Object.keys(people)) reg[name] = await register(name, people[name]!, email(name), totals[name]!, [{ person: people[name]! }]);
  await pay(reg.h!.id, "50.00");
  // y: an adult contact and a youth attendee who has an address of their own (collected later). z: an adult attendee with an address.
  const yContact = await person("YContact", email("y.contact"));
  const youth = await person("Youth", email("youth"));
  const y = await register("y", yContact, email("y.contact"), "0.00", [{ person: yContact }, { person: youth, type: "YOUTH" }]);
  const zContact = await person("ZContact", email("z.contact"));
  const zAdult = await person("ZAdult", email("z.adult"));
  const z = await register("z", zContact, email("z.contact"), "0.00", [{ person: zContact }, { person: zAdult, type: "ADULT" }]);
  // f's address bounced on an earlier message (another event's row, since a bounce follows the address everywhere).
  await prisma.messageOutbox.create({
    data: {
      eventId: ids.other, templateKey: "EVENT_ANNOUNCEMENT", recipientKind: "REGISTRANT", recipientEmail: email("f"),
      senderNameSnapshot: "Synthetic", subjectSnapshot: "x", bodyTextSnapshot: "x", idempotencyKey: `${P}-bounce`, correlationId: randomUUID(),
      status: "SENT", providerDeliveryStatus: "BOUNCED", providerStatusAt: new Date(),
    },
  });
  void y; void z;

  const gapRule = { trigger: "ONE_TIME", localDate: "2027-03-14", localTime: "02:30" } as const;
  const gapSendAt = new Date("2027-03-14T08:30:00Z");
  const after = (sendAt: Date, ms = 60_000) => new Date(sendAt.getTime() + ms);
  const content = (overrides: Record<string, unknown> = {}) => ({
    name: "Balance reminder", templateKey: "BALANCE_REMINDER", rule: gapRule, query: { roles: ["REGISTRATION_CONTACT"] }, ...overrides,
  });
  const stateOf = async (id: string) => prisma.scheduledEmailBatch.findUniqueOrThrow({ where: { id } });
  const recipientsOf = (id: string) => prisma.scheduledEmailRecipient.findMany({ where: { batchId: id }, orderBy: { recipientEmail: "asc" } });
  const outboxOf = (id: string) => prisma.messageOutbox.findMany({ where: { scheduledEmailRecipient: { batchId: id } }, orderBy: { recipientEmail: "asc" } });
  const refusal = async (run: () => Promise<unknown>, code: string, what: string) => {
    try {
      await run();
    } catch (error) {
      assert(error instanceof MessagingError && error.code === code, `${what}: expected ${code}, got ${String(error)}`);
      return error;
    }
    throw new Error(`FAILED: ${what}: expected ${code}, but it succeeded`);
  };
  async function createAndActivate(overrides: Record<string, unknown> = {}, actor = ids.admin, permissions = allPermissions) {
    const input = content(overrides);
    const review = await schedules.previewScheduledEmail(ids.event, permissions, input);
    const scheduleId = randomUUID();
    const created = await schedules.createScheduledEmail(ids.event, actor, permissions, { scheduleId, previewFingerprint: review.reviewFingerprint, ...input });
    const stored = await schedules.reviewStoredScheduledEmail(ids.event, permissions, scheduleId);
    const activated = await schedules.activateScheduledEmail(ids.event, actor, permissions, scheduleId, { expectedRevision: created.schedule.revision, previewFingerprint: stored.reviewFingerprint });
    return { scheduleId, created: created.schedule, activated: activated.schedule, review };
  }

  // 1. Review in event time, with the DST outcome, the eligible count and the exclusions, before anything is saved.
  const outboxBefore = await prisma.messageOutbox.count({ where: { eventId: ids.event } });
  const review = await schedules.previewScheduledEmail(ids.event, allPermissions, content());
  assert(review.projection.dstBehavior === "GAP_SHIFTED" && review.projection.sendAt === gapSendAt.toISOString(), `the spring-forward gap is shifted to the first moment after it: ${JSON.stringify(review.projection)}`);
  assert(review.projection.eventTimezone === eventTimezoneForTest && /does not exist/.test(review.projection.dstNote) && /CDT/.test(review.projection.sendAtLabel), "the review states the event time zone, the DST note and the local label");
  assert(review.eligibleCount === 6, `a, b, c, d, e, g owe a balance and have a valid address (f bounced; h, y and z owe nothing): ${review.eligibleCount}`);
  const exclusionCodes = Object.fromEntries(review.exclusions.map((entry) => [entry.code, entry.count]));
  assert(exclusionCodes.NO_BALANCE_DUE === 3 && exclusionCodes.PROVIDER_BOUNCED === 1, `known exclusions are listed with counts: ${JSON.stringify(exclusionCodes)}`);
  assert(!JSON.stringify(review).includes("@example.test"), "the review carries no address");
  assert(review.template.versionNumber !== null && review.deliveryMode === "EXTERNAL_EMAIL", "the review names the template version and delivery mode");
  assert((await prisma.messageOutbox.count({ where: { eventId: ids.event } })) === outboxBefore, "a preview queues nothing");
  // A time that has passed, a missing close date and a time after the anchor are refused.
  await refusal(() => schedules.previewScheduledEmail(ids.event, allPermissions, content({ rule: { trigger: "ONE_TIME", localDate: "2020-01-01", localTime: "09:00" } })), "SCHEDULE_INVALID", "a time in the past");
  await refusal(() => schedules.previewScheduledEmail(ids.event, allPermissions, content({ rule: { trigger: "BEFORE_EVENT_START", daysBefore: 0, localTime: "23:00" } })), "SCHEDULE_INVALID", "a time after the event starts");
  // The same wording that reaches a different relative rule: seven days before the event, at 09:00 local, is Jun 3 09:00 CDT.
  const relative = await schedules.previewScheduledEmail(ids.event, allPermissions, content({ rule: { trigger: "BEFORE_EVENT_START", daysBefore: 7, localTime: "09:00" } }));
  assert(relative.projection.sendAt === "2027-06-03T14:00:00.000Z" && relative.projection.dstBehavior === "NONE", `relative to the event start, in event time: ${relative.projection.sendAt}`);
  const closing = await schedules.previewScheduledEmail(ids.event, allPermissions, content({ rule: { trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 3, localTime: "09:00" } }));
  assert(closing.projection.sendAt === "2027-05-29T14:00:00.000Z", `relative to registration close: ${closing.projection.sendAt}`);

  // 2. Create sends nothing and needs the fingerprint that was shown; it replays by UUID.
  const scheduleId = randomUUID();
  await refusal(() => schedules.createScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId, previewFingerprint: "0".repeat(64), ...content() }), "PREVIEW_CHANGED", "a stale review");
  assert((await prisma.scheduledEmailBatch.count({ where: { id: scheduleId } })) === 0, "nothing is saved for a stale review");
  const created = await schedules.createScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId, previewFingerprint: review.reviewFingerprint, ...content() });
  assert(!created.replayed && created.schedule.status === "SCHEDULED" && created.schedule.revision === 1, "the schedule is saved as SCHEDULED");
  const replay = await schedules.createScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId, previewFingerprint: review.reviewFingerprint, ...content() });
  assert(replay.replayed && replay.schedule.id === scheduleId && (await prisma.scheduledEmailBatch.count({ where: { eventId: ids.event } })) === 1, "a lost-response replay returns the original");
  await refusal(() => schedules.createScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId, previewFingerprint: review.reviewFingerprint, ...content({ name: "Another name" }) }), "IDEMPOTENCY_KEY_REUSED", "a reused id");
  assert((await recipientsOf(scheduleId)).length === 0, "no recipient list exists before approval");

  // 3. Human gate: a SCHEDULED batch never sends, however late it is; the sweep runs only approved batches.
  assert((await schedules.dispatchDueScheduledEmails({ now: after(gapSendAt, 3_600_000) })).length === 0, "an unapproved schedule is never run");
  assert((await prisma.messageOutbox.count({ where: { eventId: ids.event } })) === outboxBefore, "an unapproved schedule queued nothing");
  const stored = await schedules.reviewStoredScheduledEmail(ids.event, allPermissions, scheduleId);
  await refusal(() => schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, scheduleId, { expectedRevision: 1, previewFingerprint: "1".repeat(64) }), "PREVIEW_CHANGED", "approval without the shown review");
  await refusal(() => schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, scheduleId, { expectedRevision: 9, previewFingerprint: stored.reviewFingerprint }), "SCHEDULE_STATE", "approval of another revision");
  const activated = await schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, scheduleId, { expectedRevision: 1, previewFingerprint: stored.reviewFingerprint });
  assert(!activated.replayed && activated.schedule.status === "ACTIVE", "an explicit approval makes it ACTIVE");
  const activeRow = await stateOf(scheduleId);
  assert(activeRow.activatedByUserId === ids.admin && activeRow.activatedAt !== null, "the approver and time are recorded");
  assert((await recipientsOf(scheduleId)).length === 6 && (await recipientsOf(scheduleId)).every((row) => row.status === "PLANNED"), "the approved list is frozen: six planned recipients");
  assert((await schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, scheduleId, { expectedRevision: 1, previewFingerprint: stored.reviewFingerprint })).replayed, "approval replays");
  const activationAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: ids.event, action: "SCHEDULED_EMAIL_ACTIVATED", entityId: scheduleId } });
  assert(activationAudit.actorUserId === ids.admin && !JSON.stringify(activationAudit).includes("@example.test"), "approval is audited with the actor and no address");

  // 4. Not before its time.
  assert((await schedules.dispatchDueScheduledEmails({ now: new Date(gapSendAt.getTime() - 60_000) })).length === 0, "nothing runs a minute early");

  // 5. Between approval and the send: c pays in full, d is cancelled, e's registration is transferred to a new contact,
  //    and f's bounce was already on file. a, b and g are unchanged.
  await pay(reg.c!.id, "60.00");
  await prisma.registration.update({ where: { id: reg.d!.id }, data: { status: "CANCELLED" } });
  await prisma.registration.update({ where: { id: reg.e!.id }, data: { contactSnapshot: { firstName: "New", lastName: "Owner", email: email("e.new") } } });

  // 6. Three workers at once, then a retry: exactly one runs the batch, nobody is queued twice.
  const dueNow = after(gapSendAt);
  const runs = await Promise.all([1, 2, 3].map(() => schedules.runScheduledEmailBatch(scheduleId, { now: dueNow })));
  assert(runs.filter((run) => run.outcome !== "skipped").length === 1, `exactly one worker ran the batch: ${runs.map((run) => run.outcome)}`);
  const queuedRows = await outboxOf(scheduleId);
  assert(queuedRows.map((row) => row.recipientEmail).join() === [email("a"), email("b"), email("g")].sort().join(), `only a, b and g were queued: ${queuedRows.map((row) => row.recipientEmail)}`);
  assert(queuedRows.every((row) => row.status === "PENDING" && row.templateKey === "BALANCE_REMINDER"), "queued as ordinary pending outbox rows");
  const dropped = Object.fromEntries((await recipientsOf(scheduleId)).filter((row) => row.status === "EXCLUDED").map((row) => [row.recipientEmail, row.exclusionCode]));
  assert(dropped[email("c")] === "NO_BALANCE_DUE", `payment before the reminder drops c: ${JSON.stringify(dropped)}`);
  assert(dropped[email("d")] === "REGISTRATION_NOT_ACTIVE", "a cancelled registration is dropped");
  assert(dropped[email("e")] === "ADDRESS_CHANGED", "a transferred contact's old address is dropped");
  assert(!(email("e.new") in dropped) && (await outboxOf(scheduleId)).every((row) => row.recipientEmail !== email("e.new")), "the new contact was never approved, so is not added");
  assert(Object.keys(dropped).length === 3, `three were dropped: ${JSON.stringify(dropped)}`);
  assert((await prisma.messageOutbox.count({ where: { eventId: ids.event, recipientEmail: { in: [email("c"), email("d"), email("e")] } } })) === 0, "no message exists for a dropped recipient");
  const dropAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: ids.event, action: "SCHEDULED_EMAIL_RECIPIENTS_DROPPED", entityId: scheduleId } });
  assert(!JSON.stringify(dropAudit).includes("@example.test"), "the drop audit holds counts by code, no address");
  assert((await stateOf(scheduleId)).status === "ACTIVE", "the batch stays ACTIVE (sending) while its messages are waiting");
  assert((await schedules.dispatchDueScheduledEmails({ now: dueNow })).length === 0 && (await outboxOf(scheduleId)).length === 3, "a retry of the sweep queues nothing more");
  // A worker that died after queueing a message but before recording it: the re-run finds the same message, no duplicate.
  const crashed = (await recipientsOf(scheduleId)).find((row) => row.recipientEmail === email("a"))!;
  await prisma.scheduledEmailRecipient.update({ where: { id: crashed.id }, data: { status: "PLANNED", outboxMessageId: null } });
  await prisma.scheduledEmailBatch.update({ where: { id: scheduleId }, data: { claimedAt: new Date(dueNow.getTime() - 3_600_000) } });
  const rerun = await schedules.dispatchDueScheduledEmails({ now: dueNow });
  assert(rerun.length === 1, "a stale claim with a recipient still to queue is taken over");
  assert((await outboxOf(scheduleId)).length === 3 && (await prisma.messageOutbox.count({ where: { eventId: ids.event, recipientEmail: email("a") } })) === 1, "the re-run reuses the queued message instead of duplicating it");
  assert((await recipientsOf(scheduleId)).find((row) => row.id === crashed.id)!.status === "QUEUED", "and records it");

  // 7. A recipient who pays after queueing but before sending is cancelled by the pre-send check; the rest are sent once.
  await pay(reg.g!.id, "10.00");
  const sent = await processExternalEmailQueue(ids.event);
  assert(sent.sentIds.length === 2, `two were sent: ${JSON.stringify(sent)}`);
  assert(stub.received.map((payload) => payload.to[0]).sort().join() === [email("a"), email("b")].sort().join(), `the provider got a and b only: ${stub.received.map((payload) => payload.to[0])}`);
  const gRow = (await outboxOf(scheduleId)).find((row) => row.recipientEmail === email("g"))!;
  assert(gRow.status === "CANCELLED" && /no balance|paid|balance/i.test(gRow.lastError ?? ""), `g's message was cancelled before it was sent: ${gRow.status} ${gRow.lastError}`);
  assert((await recipientsOf(scheduleId)).find((row) => row.recipientEmail === email("g"))!.exclusionCode === "NO_BALANCE_DUE", "and the recipient records why");
  assert((await processExternalEmailQueue(ids.event)).sentIds.length === 0 && stub.received.length === 2, "processing again sends nobody twice");
  await schedules.finalizeFinishedScheduledEmails(new Date());
  assert((await stateOf(scheduleId)).status === "COMPLETED" && (await stateOf(scheduleId)).completedAt !== null, "once every message has left the queue the batch is COMPLETED");
  await refusal(() => schedules.cancelScheduledEmail(ids.event, ids.admin, scheduleId), "SCHEDULE_STATE", "cancelling a completed batch");

  // 8. Pause and cancel before a send begins.
  const early = { rule: { trigger: "ONE_TIME", localDate: "2027-04-20", localTime: "09:00" }, templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic news", announcementBody: "Synthetic body.", name: "Announcement" };
  const two = await createAndActivate(early);
  const twoDue = new Date("2027-04-20T14:01:00Z");
  const paused = await schedules.pauseScheduledEmail(ids.event, ids.admin, two.scheduleId);
  assert(paused.status === "PAUSED" && paused.pauseReason, "an unclaimed schedule can be paused");
  assert((await schedules.dispatchDueScheduledEmails({ now: twoDue })).length === 0, "a paused schedule is not run");
  assert((await schedules.pauseScheduledEmail(ids.event, ids.admin, two.scheduleId)).status === "PAUSED", "pausing again is harmless");
  await refusal(() => schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, two.scheduleId, { expectedRevision: 1, previewFingerprint: "2".repeat(64) }), "PREVIEW_CHANGED", "resuming without a fresh review");
  const reviewAgain = await schedules.reviewStoredScheduledEmail(ids.event, allPermissions, two.scheduleId);
  assert((await schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, two.scheduleId, { expectedRevision: 1, previewFingerprint: reviewAgain.reviewFingerprint })).schedule.status === "ACTIVE", "a paused schedule is approved again with a fresh review");
  const cancelled = await schedules.cancelScheduledEmail(ids.event, ids.admin, two.scheduleId);
  assert(cancelled.status === "CANCELLED" && (await recipientsOf(two.scheduleId)).every((row) => row.status === "CANCELLED"), "cancel before the send cancels the whole list");
  assert((await outboxOf(two.scheduleId)).length === 0 && (await schedules.dispatchDueScheduledEmails({ now: twoDue })).length === 0, "and nothing was queued");
  assert((await schedules.cancelScheduledEmail(ids.event, ids.admin, two.scheduleId)).status === "CANCELLED", "cancelling again is harmless");
  await refusal(() => schedules.pauseScheduledEmail(ids.event, ids.admin, two.scheduleId), "SCHEDULE_STATE", "pausing a cancelled schedule");

  // 9. Cancel after partial delivery keeps what was sent and cancels only the rest. The announcement reaches contacts who
  //    have not opted out: a, b, c, e (new address), g, and the contacts of y and z.
  const three = await createAndActivate({ ...early, name: "Partial", rule: { trigger: "ONE_TIME", localDate: "2027-04-21", localTime: "09:00" } });
  const threeDue = new Date("2027-04-21T14:01:00Z");
  const threeRun = await schedules.runScheduledEmailBatch(three.scheduleId, { now: threeDue });
  const threeRows = await outboxOf(three.scheduleId);
  assert(threeRun.queued === threeRows.length && threeRows.length >= 6 && threeRows.every((row) => row.status === "PENDING"), `queued ${threeRows.length} pending announcements`);
  assert(!threeRows.some((row) => row.recipientEmail === email("d") || row.recipientEmail === email("f")), "a cancelled registration and a bounced address were never approved");
  const firstTwo = threeRows.slice(0, 2).map((row) => row.id);
  const receivedBefore = stub.received.length;
  await processExternalEmailQueue(ids.event, { messageIds: firstTwo });
  assert(stub.received.length === receivedBefore + 2, "two announcements were delivered");
  const sentRowsBefore = (await outboxOf(three.scheduleId)).filter((row) => row.status === "SENT").map((row) => row.id).sort();
  await refusal(() => schedules.pauseScheduledEmail(ids.event, ids.admin, three.scheduleId), "SCHEDULE_STATE", "pausing a batch that has started sending");
  const partial = await schedules.cancelScheduledEmail(ids.event, ids.admin, three.scheduleId);
  const afterCancel = await outboxOf(three.scheduleId);
  assert(partial.status === "CANCELLED", "a sending batch can be cancelled");
  assert(afterCancel.filter((row) => row.status === "SENT").map((row) => row.id).sort().join() === sentRowsBefore.join() && sentRowsBefore.length === 2, "the two sent rows are preserved as SENT");
  assert(afterCancel.filter((row) => row.status === "CANCELLED").length === threeRows.length - 2, "only the unsent rows are cancelled");
  const cancelledRecipients = await recipientsOf(three.scheduleId);
  assert(cancelledRecipients.filter((row) => row.status === "QUEUED").length === 2 && cancelledRecipients.filter((row) => row.status === "CANCELLED").length === threeRows.length - 2, "recipient rows agree: two stay QUEUED (sent), the rest are CANCELLED");
  const receivedAfterCancel = stub.received.length;
  await processExternalEmailQueue(ids.event);
  assert(stub.received.length === receivedAfterCancel, "a cancelled message is never sent afterwards");
  const cancelAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: ids.event, action: "SCHEDULED_EMAIL_CANCELLED", entityId: three.scheduleId } });
  assert((cancelAudit.metadata as { keptMessages: number }).keptMessages === 2, "the cancel audit says how many sent messages were kept");

  // Owner decision (Oct 17): a youth's own address is written to only when an adult also uses it in that send.
  //  s: the parent is the registration contact and typed the very address the youth attendee has on their own record.
  //  t: the youth is their own registration contact (account holder, no typed contact address): only a minor is behind it.
  //  (A person's address is unique, so an adult and a youth share an address only through the typed contact address; an adult
  //  attendee or a group leader sharing one is covered by the pure rule's tests.)
  const sParent = await person("SParent", email("share.parent"));
  const sYouth = await person("SYouth", email("share.family"));
  const sReg = await register("s", sParent, email("share.family"), "0.00", [{ person: sParent }, { person: sYouth, type: "YOUTH" }]);
  const tYouth = await person("TYouth", email("youth.own"));
  const tReg = await register("t", tYouth, "", "0.00", [{ person: tYouth, type: "YOUTH" }]);
  //  v: a youth (the older sibling) is the account holder and types the younger sibling's own address as the contact.
  //  v2: the same youth is also the account holder of a second registration whose only attendee is an adult: judged across the
  //      whole event the holder is a minor, so the contact address they typed there is youth-only too.
  //  w: a parent who attends nothing is the account holder (the normal case); the youth is the attendee. The parent is not blocked.
  const vOlder = await person("VOlder", email("sib.older"));
  const vYounger = await person("VYounger", email("sib.younger"));
  const vReg = await register("v", vOlder, email("sib.younger"), "0.00", [{ person: vOlder, type: "YOUTH" }, { person: vYounger, type: "YOUTH" }]);
  const v2Adult = await person("V2Adult", email("v2.adult"));
  const v2Reg = await register("v2", vOlder, email("typed.v2"), "0.00", [{ person: v2Adult, type: "ADULT" }]);
  const wParent = await person("WParent", email("w.parent"));
  const wYouth = await person("WYouth", email("w.youth"));
  const wReg = await register("w", wParent, email("w.parent"), "0.00", [{ person: wYouth, type: "YOUTH" }]);
  void sReg; void tReg; void vReg; void v2Reg; void wReg;

  // 10. Youth never receive these. The youth attendee's own address is excluded at review, at approval and at send time.
  const youthContent = { name: "Everyone", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic news", announcementBody: "Synthetic body.", rule: { trigger: "ONE_TIME", localDate: "2027-04-22", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT", "ATTENDEE"], search: "status=CONFIRMED" } };
  const youthReview = await schedules.previewScheduledEmail(ids.event, allPermissions, youthContent);
  const youthCodes = Object.fromEntries(youthReview.exclusions.map((entry) => [entry.code, entry.count]));
  assert((youthCodes.MINOR_RECIPIENT ?? 0) >= 1, `the youth attendee is excluded and counted: ${JSON.stringify(youthCodes)}`);
  const four = await createAndActivate(youthContent);
  const fourRecipients = await recipientsOf(four.scheduleId);
  assert(!fourRecipients.some((row) => row.recipientEmail === email("youth")), "the youth's own address is not on the approved list");
  assert(fourRecipients.some((row) => row.recipientEmail === email("y.contact")) && fourRecipients.some((row) => row.recipientEmail === email("z.adult")), "the adult contact and the adult attendee are on it");
  // Send time, case 1: the adult attendee z.adult is re-classified as a youth type after approval.
  await prisma.registrationAttendee.update({ where: { id: z.attendeeIds[1]! }, data: { attendeeType: "YOUTH", attendeeTypeDefinitionId: typeIds.YOUTH } });
  // Send time, case 2: a forged approved row for the youth's own address, as if some other rule had let it through.
  await prisma.scheduledEmailRecipient.create({
    data: { batchId: four.scheduleId, eventId: ids.event, registrationId: y.id, recipientEmail: email("youth"), recipientName: "Youth Synthetic", roles: ["ATTENDEE"] },
  });
  const fourRun = await schedules.runScheduledEmailBatch(four.scheduleId, { now: new Date("2027-04-22T14:01:00Z") });
  assert(fourRun.excluded >= 2, `both youth recipients were dropped at send time: ${JSON.stringify(fourRun)}`);
  const fourAfter = await recipientsOf(four.scheduleId);
  const codeFor = (mail: string) => fourAfter.find((row) => row.recipientEmail === mail)?.exclusionCode;
  assert(codeFor(email("z.adult")) === "MINOR_RECIPIENT", `an attendee who became a minor is dropped: ${codeFor(email("z.adult"))}`);
  assert(codeFor(email("youth")) === "MINOR_RECIPIENT", `a forged row for a minor's address is dropped: ${codeFor(email("youth"))}`);
  assert((await prisma.messageOutbox.count({ where: { recipientEmail: { in: [email("youth"), email("z.adult")] } } })) === 0, "no message was ever queued to a minor's address");
  const fourAddresses = fourAfter.map((row) => row.recipientEmail);
  assert(fourAddresses.filter((mail) => mail === email("share.family")).length === 1 && fourAfter.find((row) => row.recipientEmail === email("share.family"))!.status === "QUEUED", "a parent who shares the youth's address is approved and queued once");
  assert(!fourAddresses.includes(email("youth.own")) && (await prisma.messageOutbox.count({ where: { recipientEmail: email("youth.own") } })) === 0, "a youth who is their own registration contact is never emailed");
  assert((youthCodes.MINOR_RECIPIENT ?? 0) >= 4, `the youth contacts are counted as excluded in the review: ${JSON.stringify(youthCodes)}`);
  for (const blocked of ["sib.younger", "sib.older", "typed.v2"]) {
    assert(!fourAddresses.includes(email(blocked)) && (await prisma.messageOutbox.count({ where: { recipientEmail: email(blocked) } })) === 0, `${blocked}: a minor account holder's contact address is youth-only and is never emailed`);
  }
  assert(fourAddresses.includes(email("w.parent")) && fourAfter.find((row) => row.recipientEmail === email("w.parent"))!.status === "QUEUED", "a parent who attends nothing is an adult holder and is emailed");
  assert(!fourAddresses.includes(email("w.youth")), "the youth in that family is not");
  assert((await prisma.messageOutbox.count({ where: { recipientEmail: email("share.family") } })) === 1, "the shared parent and youth address has exactly one message");
  // The pre-send check also refuses a youth address that reached the queue some other way.
  const forged = await prisma.messageOutbox.create({
    data: {
      eventId: ids.event, registrationId: y.id, templateKey: "EVENT_ANNOUNCEMENT", recipientKind: "REGISTRANT", recipientEmail: email("youth"),
      senderNameSnapshot: "Synthetic", senderEmailSnapshot: "events@example.test", subjectSnapshot: "x", bodyTextSnapshot: "x",
      idempotencyKey: `${P}-forged`, correlationId: randomUUID(), status: "PENDING", metadata: { scheduledEmailBatchId: four.scheduleId },
    },
  });
  const forgedRecipient = await prisma.scheduledEmailRecipient.findFirstOrThrow({ where: { batchId: four.scheduleId, recipientEmail: email("youth") } });
  await prisma.scheduledEmailRecipient.update({ where: { id: forgedRecipient.id }, data: { status: "QUEUED", exclusionCode: null, outboxMessageId: forged.id } });
  await processExternalEmailQueue(ids.event);
  assert(stub.received.every((payload) => payload.to[0] !== email("youth") && payload.to[0] !== email("z.adult")), "the provider never received a minor's address");
  const forgedAfter = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: forged.id } });
  assert(forgedAfter.status === "CANCELLED", "a queued message to a minor is cancelled right before the send");
  const youthAudit = await prisma.auditLog.findMany({ where: { eventId: ids.event, action: { in: ["SCHEDULED_EMAIL_RECIPIENTS_DROPPED"] } } });
  assert(!JSON.stringify(youthAudit).includes("youth@"), "the audit trail holds no youth address");

  // 11. A schedule edit sends it back to approval and rewrites the projection; the older revision cannot overwrite it.
  const five = await createAndActivate({ rule: { trigger: "BEFORE_EVENT_START", daysBefore: 7, localTime: "09:00" } });
  assert(five.activated.sendAt === "2027-06-03T14:00:00.000Z", "approved for seven days before the start, 09:00 local");
  const editedContent = content({ rule: { trigger: "BEFORE_EVENT_START", daysBefore: 3, localTime: "10:00" } });
  const editedReview = await schedules.previewScheduledEmail(ids.event, allPermissions, editedContent);
  const edited = await schedules.updateScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId: five.scheduleId, expectedRevision: 1, previewFingerprint: editedReview.reviewFingerprint, ...editedContent });
  assert(edited.status === "SCHEDULED" && edited.revision === 2 && edited.sendAt === "2027-06-07T15:00:00.000Z", `an edit withdraws approval and moves the time: ${edited.status} ${edited.sendAt}`);
  assert((await recipientsOf(five.scheduleId)).length === 0 && (await stateOf(five.scheduleId)).activatedByUserId === null, "the approved list and the approval are gone");
  await refusal(() => schedules.updateScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId: five.scheduleId, expectedRevision: 1, previewFingerprint: editedReview.reviewFingerprint, ...editedContent }), "SCHEDULE_STATE", "an edit of an old revision");
  await refusal(() => schedules.updateScheduledEmail(ids.event, ids.admin, allPermissions, { scheduleId: three.scheduleId, expectedRevision: 1, previewFingerprint: editedReview.reviewFingerprint, ...editedContent }), "SCHEDULE_STATE", "an edit of a cancelled schedule");
  assert((await schedules.dispatchDueScheduledEmails({ now: new Date("2027-06-08T00:00:00Z") })).length === 0, "an edited schedule awaiting approval is not run");

  // 12. Gates at send time: a changed event time zone, a republished template, an approver who lost permission, a missed window.
  const six = await createAndActivate({ rule: { trigger: "ONE_TIME", localDate: "2027-05-10", localTime: "09:00" }, name: "Zone change" });
  await prisma.event.update({ where: { id: ids.event }, data: { timezone: "America/Denver" } });
  assert((await schedules.getScheduledEmail(ids.event, six.scheduleId)).timingStale === true, "a one-time time is a wall time in the event's zone, so a changed zone moves it and flags it");
  await prisma.event.update({ where: { id: ids.event }, data: { timezone: eventTimezoneForTest } });
  const relativeSchedule = await createAndActivate({ rule: { trigger: "BEFORE_EVENT_START", daysBefore: 20, localTime: "09:00" }, name: "Relative" });
  await prisma.event.update({ where: { id: ids.event }, data: { timezone: "America/New_York" } });
  assert((await schedules.getScheduledEmail(ids.event, relativeSchedule.scheduleId)).timingStale === true, "the list flags a schedule whose event time zone changed");
  const relativeRun = await schedules.runScheduledEmailBatch(relativeSchedule.scheduleId, { now: after(new Date((await stateOf(relativeSchedule.scheduleId)).sendAt)) });
  assert(relativeRun.outcome === "paused" && relativeRun.reason === "EVENT_TIMING_CHANGED", `a changed event time zone pauses the schedule: ${JSON.stringify(relativeRun)}`);
  assert((await stateOf(relativeSchedule.scheduleId)).status === "PAUSED" && (await outboxOf(relativeSchedule.scheduleId)).length === 0, "paused with nothing queued");
  await prisma.event.update({ where: { id: ids.event }, data: { timezone: eventTimezoneForTest } });

  const template = await prisma.eventMessageTemplate.findFirstOrThrow({ where: { eventId: ids.event, key: "BALANCE_REMINDER" }, include: { versions: { where: { status: "PUBLISHED" }, take: 1 } } });
  const seven = await createAndActivate({ rule: { trigger: "ONE_TIME", localDate: "2027-05-11", localTime: "09:00" }, name: "Template change" });
  await publishMessageTemplateVersion(ids.event, template.id, { subjectTemplate: "Synthetic balance reminder", bodyTemplate: "Hello {{recipient_name}}, a synthetic balance of {{balance_amount}} is due.", isEnabled: true }, ids.admin);
  const sevenRun = await schedules.runScheduledEmailBatch(seven.scheduleId, { now: after(new Date((await stateOf(seven.scheduleId)).sendAt)) });
  assert(sevenRun.outcome === "paused" && sevenRun.reason === "TEMPLATE_CHANGED" && (await outboxOf(seven.scheduleId)).length === 0, `a republished template pauses the schedule: ${JSON.stringify(sevenRun)}`);

  // A second person approves with only the communications permission, then loses their membership.
  const eight = await createAndActivate({ rule: { trigger: "ONE_TIME", localDate: "2027-05-12", localTime: "09:00" }, name: "Approver", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.", query: { roles: ["REGISTRATION_CONTACT"] } }, ids.comms, commsPermissions);
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.comms } }, data: { status: "INACTIVE" } });
  const eightRun = await schedules.runScheduledEmailBatch(eight.scheduleId, { now: after(new Date((await stateOf(eight.scheduleId)).sendAt)) });
  assert(eightRun.outcome === "paused" && eightRun.reason === "APPROVER_NOT_PERMITTED" && (await outboxOf(eight.scheduleId)).length === 0, `an approver who lost permission pauses it: ${JSON.stringify(eightRun)}`);
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.comms } }, data: { status: "ACTIVE" } });

  const nine = await createAndActivate({ rule: { trigger: "ONE_TIME", localDate: "2027-05-13", localTime: "09:00" }, name: "Missed", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.", query: { roles: ["REGISTRATION_CONTACT"] } });
  const nineRun = await schedules.runScheduledEmailBatch(nine.scheduleId, { now: new Date(new Date((await stateOf(nine.scheduleId)).sendAt).getTime() + 7 * 3_600_000) });
  assert(nineRun.outcome === "failed" && (await stateOf(nine.scheduleId)).status === "FAILED" && (await outboxOf(nine.scheduleId)).length === 0, `a schedule seven hours late fails instead of sending: ${JSON.stringify(nineRun)}`);
  assert((await recipientsOf(nine.scheduleId)).every((row) => row.status === "CANCELLED"), "and its recipients are cancelled");

  // 12b. A payment-filtered audience is checked against its filters again right before the send: the registrant pays after
  //      the message was queued, so they no longer match "unpaid", and it is cancelled.
  const filtered = await createAndActivate({
    name: "Unpaid only", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic news", announcementBody: "Synthetic body.",
    rule: { trigger: "ONE_TIME", localDate: "2027-04-23", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"], search: "payment=UNPAID,PARTIAL" },
  });
  const filteredRecipients = (await recipientsOf(filtered.scheduleId)).map((row) => row.recipientEmail);
  assert(filteredRecipients.includes(email("a")) && filteredRecipients.includes(email("b")) && !filteredRecipients.includes(email("c")), `only unpaid registrations are approved: ${filteredRecipients.length}`);
  await schedules.runScheduledEmailBatch(filtered.scheduleId, { now: new Date("2027-04-23T14:01:00Z") });
  const filteredQueued = await outboxOf(filtered.scheduleId);
  assert(filteredQueued.some((row) => row.recipientEmail === email("b") && row.status === "PENDING"), "b's announcement is queued");
  await pay(reg.b!.id, "80.00");
  const receivedBeforeFiltered = stub.received.length;
  await processExternalEmailQueue(ids.event);
  const sentToFiltered = stub.received.slice(receivedBeforeFiltered).map((payload) => payload.to[0]);
  assert(!sentToFiltered.includes(email("b")) && sentToFiltered.includes(email("a")), `b paid after queueing and is not sent; a is: ${sentToFiltered}`);
  const bFiltered = (await outboxOf(filtered.scheduleId)).find((row) => row.recipientEmail === email("b"))!;
  assert(bFiltered.status === "CANCELLED", "b's message was cancelled by the pre-send check");
  assert((await recipientsOf(filtered.scheduleId)).find((row) => row.recipientEmail === email("b"))!.exclusionCode === "NO_LONGER_MATCHES", "recorded as no longer matching the approved audience");

  // 12c. A message that waited past its window, or past the moment it counts back from, is dropped, not sent late.
  const closing0 = await createAndActivate({
    name: "Late", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.",
    rule: { trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 0, localTime: "23:30" }, query: { roles: ["REGISTRATION_CONTACT"] },
  });
  const closingRow = await stateOf(closing0.scheduleId);
  await schedules.runScheduledEmailBatch(closing0.scheduleId, { now: new Date(closingRow.sendAt.getTime() + 60_000) });
  const closingMessage = (await outboxOf(closing0.scheduleId))[0]!;
  assert((await schedules.scheduledEmailObsoleteReason(closingMessage.id, new Date(closingRow.sendAt.getTime() + 60_000))) === null, "on time, it is wanted");
  const anchorPassed = await schedules.scheduledEmailObsoleteReason(closingMessage.id, new Date(closingRow.anchorAt!.getTime() + 60_000));
  assert(anchorPassed?.code === "ANCHOR_PASSED", `after registration closed it is dropped: ${anchorPassed?.code}`);
  const tooLate = await schedules.scheduledEmailObsoleteReason(closingMessage.id, new Date(closingRow.sendAt.getTime() + 7 * 3_600_000));
  assert(tooLate?.code === "SCHEDULE_TOO_LATE", `seven hours after its time it is dropped: ${tooLate?.code}`);

  // 12d. A scheduled message cannot be copied by a retry (a copy would escape its schedule's checks and its cancel).
  const { createMessageRetryCopy } = await import("@/modules/communications/messaging-repository");
  const copySource = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: closingMessage.id } });
  await prisma.$transaction(async (tx) => {
    await createMessageRetryCopy(tx, {
      eventId: ids.event, source: copySource, settings: { deliveryMode: "EXTERNAL_EMAIL", senderName: "x", senderEmail: "events@example.test", replyToEmail: null },
      repairMissingSenderSnapshot: false, idempotencyKey: `${P}-copy`, correlationId: randomUUID(), requestFingerprint: "f".repeat(64),
    });
  }).then(
    () => { throw new Error("FAILED: a scheduled message was copied by a retry"); },
    (error) => assert(error instanceof MessagingError && error.code === "MESSAGE_NOT_RETRYABLE", `a retry of a scheduled message is refused: ${String(error)}`),
  );
  assert((await prisma.messageOutbox.count({ where: { retryOfMessageId: closingMessage.id } })) === 0, "no copy exists");

  // 12e. A worker that queued some messages and stopped is taken over; if a gate then fails, the batch fails instead of
  //      pausing (a paused batch could be edited and approved again under messages already in the queue).
  const takeover = await createAndActivate({
    name: "Takeover", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.",
    rule: { trigger: "ONE_TIME", localDate: "2027-05-14", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"] },
  });
  const takeoverNow = new Date("2027-05-14T14:01:00Z");
  await schedules.runScheduledEmailBatch(takeover.scheduleId, { now: takeoverNow });
  const takeoverRows = await recipientsOf(takeover.scheduleId);
  const queuedBefore = takeoverRows.filter((row) => row.status === "QUEUED");
  assert(queuedBefore.length >= 2, "some recipients were queued");
  await prisma.scheduledEmailRecipient.update({ where: { id: queuedBefore[0]!.id }, data: { status: "PLANNED", outboxMessageId: null } });
  await prisma.scheduledEmailBatch.update({ where: { id: takeover.scheduleId }, data: { claimedAt: new Date(takeoverNow.getTime() - 3_600_000) } });
  const announcementTemplate = await prisma.eventMessageTemplate.findFirstOrThrow({ where: { eventId: ids.event, key: "EVENT_ANNOUNCEMENT" } });
  await publishMessageTemplateVersion(ids.event, announcementTemplate.id, { subjectTemplate: "{{event_name}}: {{announcement_title}}", bodyTemplate: "{{announcement_body}} (synthetic, republished)", isEnabled: true }, ids.admin);
  // Other approved batches that were never run (schedules 6 and 9 above) are due by now and fail as late; only this one is judged.
  const takeoverRun = (await schedules.dispatchDueScheduledEmails({ now: takeoverNow })).filter((run) => run.batchId === takeover.scheduleId);
  assert(takeoverRun.length === 1 && takeoverRun[0]!.outcome === "failed", `a gate after a takeover with queued messages fails the batch: ${JSON.stringify(takeoverRun)}`);
  assert((await stateOf(takeover.scheduleId)).status === "FAILED", "it is FAILED, not PAUSED");
  const takeoverMessages = await prisma.messageOutbox.findMany({ where: { metadata: { path: ["scheduledEmailBatchId"], equals: takeover.scheduleId } } });
  assert(takeoverMessages.length >= 2 && takeoverMessages.every((row) => row.status === "CANCELLED"), "and every message of the batch that was still queued was cancelled, even one a crash left unlinked");
  await refusal(() => schedules.activateScheduledEmail(ids.event, ids.admin, allPermissions, takeover.scheduleId, { expectedRevision: 1, previewFingerprint: "3".repeat(64) }), "SCHEDULE_STATE", "approving a failed batch");

  // 12f. A scheduled message cancelled after its body was prepared withdraws the private link it minted.
  const reminder = await createAndActivate({ name: "Reminder revoke", rule: { trigger: "ONE_TIME", localDate: "2027-05-20", localTime: "09:00" } });
  await schedules.runScheduledEmailBatch(reminder.scheduleId, { now: new Date("2027-05-20T14:01:00Z") });
  const reminderRows = await outboxOf(reminder.scheduleId);
  assert(reminderRows.map((row) => row.recipientEmail).join() === [email("a"), email("e.new")].sort().join(), `a and e.new owe a balance: ${reminderRows.map((row) => row.recipientEmail)}`);
  await pay(reg.a!.id, "100.00");
  const revoked: string[] = [];
  const receivedBeforeRevoke = stub.received.length;
  await processExternalEmailQueue(ids.event, {
    dependencies: {
      // The real preparation (it mints the private link), with the withdrawal of that link recorded.
      prepareBodyText: async (input) => {
        const real = await prepareEmailBodyForDelivery(input);
        return {
          ...real,
          revokeOnDefinitiveFailure: async () => {
            revoked.push(input.messageId);
            await real.revokeOnDefinitiveFailure?.();
          },
        };
      },
    },
  });
  const aReminder = reminderRows.find((row) => row.recipientEmail === email("a"))!;
  assert(revoked.join() === aReminder.id, `only the cancelled message's link was withdrawn: ${revoked}`);
  // (The same pass also delivers announcements other batches had queued, so the provider's list is judged by row, not by count.)
  const afterRevoke = await outboxOf(reminder.scheduleId);
  assert(afterRevoke.find((row) => row.recipientEmail === email("a"))!.status === "CANCELLED" && afterRevoke.find((row) => row.recipientEmail === email("e.new"))!.status === "SENT", "a's reminder was cancelled and e.new's was sent");
  void receivedBeforeRevoke;

  // 12g. A message that names a schedule but is linked to no approved recipient is never sent.
  const unlinked = await prisma.messageOutbox.create({
    data: {
      eventId: ids.event, templateKey: "EVENT_ANNOUNCEMENT", recipientKind: "REGISTRANT", recipientEmail: email("unlinked"),
      senderNameSnapshot: "Synthetic", senderEmailSnapshot: "events@example.test", subjectSnapshot: "x", bodyTextSnapshot: "x",
      idempotencyKey: `${P}-unlinked`, correlationId: randomUUID(), status: "PENDING", metadata: { scheduledEmailBatchId: reminder.scheduleId },
    },
  });
  const receivedBeforeUnlinked = stub.received.length;
  await processExternalEmailQueue(ids.event);
  assert((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: unlinked.id } })).status === "CANCELLED" && stub.received.length === receivedBeforeUnlinked, "an unlinked scheduled message is cancelled, not sent");

  // 12h. A filter that can no longer be applied (the approver lost the permission to use it) stops the batch with a reason, and
  //      cancels the queued message, instead of throwing and retrying silently.
  const filterSchedule = (name: string, day: string) => createAndActivate({
    name, templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.",
    rule: { trigger: "ONE_TIME", localDate: day, localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"], search: "payment=UNPAID,PARTIAL" },
  });
  const gateA = await filterSchedule("Filter queued", "2027-05-21");
  await schedules.runScheduledEmailBatch(gateA.scheduleId, { now: new Date("2027-05-21T14:01:00Z") });
  const gateB = await filterSchedule("Filter at run", "2027-05-22");
  const gateAMessages = await outboxOf(gateA.scheduleId);
  assert(gateAMessages.length >= 1 && gateAMessages.every((row) => row.status === "PENDING"), "the first schedule has queued messages");
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.admin } }, data: { role: "COMMUNICATIONS_MANAGER" } });
  const filterReason = await schedules.scheduledEmailObsoleteReason(gateAMessages[0]!.id);
  assert(filterReason?.code === "FILTER_UNAVAILABLE", `the pre-send check returns a code instead of throwing: ${filterReason?.code}`);
  const receivedBeforeFilter = stub.received.length;
  await processExternalEmailQueue(ids.event);
  assert(stub.received.length === receivedBeforeFilter && (await outboxOf(gateA.scheduleId)).every((row) => row.status === "CANCELLED"), "the queued messages are cancelled, not sent");
  const gateRun = await schedules.runScheduledEmailBatch(gateB.scheduleId, { now: new Date("2027-05-22T14:01:00Z") });
  assert(gateRun.outcome === "paused" && gateRun.reason === "FILTER_UNAVAILABLE", `the runner pauses with a reason: ${JSON.stringify(gateRun)}`);
  const gateBRow = await stateOf(gateB.scheduleId);
  assert(gateBRow.status === "PAUSED" && gateBRow.claimToken === null && /no longer available/.test(gateBRow.pauseReason ?? ""), "paused with a readable reason, and the claim released");
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.admin } }, data: { role: "EVENT_ADMIN" } });

  // 12i. Local capture: a scheduled message is checked right before it is captured. A failing check leaves it PENDING, an
  //      obsolete one is cancelled, and a captured one is never captured twice. Past the time budget the rest stay queued.
  await prisma.eventMessageSettings.update({ where: { eventId: ids.event }, data: { deliveryPaused: true } });
  const { captureMessageIdsLocally } = await import("@/modules/communications/messaging-repository");
  const capture = await createAndActivate({
    name: "Capture", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.",
    rule: { trigger: "ONE_TIME", localDate: "2027-05-23", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"] },
  });
  const captureRun = await schedules.runScheduledEmailBatch(capture.scheduleId, { now: new Date("2027-05-23T14:01:00Z"), deadline: Date.now() - 1 });
  const captureIds = (await outboxOf(capture.scheduleId)).map((row) => row.id);
  assert(captureRun.queued === captureIds.length && captureIds.length >= 3 && (await outboxOf(capture.scheduleId)).every((row) => row.status === "PENDING"), "past its time budget nothing is captured; the messages wait for the next queue pass");
  assert((await stateOf(capture.scheduleId)).status === "ACTIVE", "and the batch stays ACTIVE (sending)");
  const goodQuery = (await stateOf(capture.scheduleId)).audienceQuery;
  await prisma.scheduledEmailBatch.update({ where: { id: capture.scheduleId }, data: { audienceQuery: { roles: "not a list" } } });
  assert((await captureMessageIdsLocally(captureIds)).length === 0 && (await outboxOf(capture.scheduleId)).every((row) => row.status === "PENDING"), "a check that cannot be made leaves every message PENDING");
  await prisma.scheduledEmailBatch.update({ where: { id: capture.scheduleId }, data: { audienceQuery: goodQuery as object } });
  assert((await captureMessageIdsLocally(captureIds)).length === captureIds.length, "with the check working, each is captured");
  assert((await captureMessageIdsLocally(captureIds)).length === 0, "and none is captured twice");
  assert((await prisma.messageDeliveryAttempt.count({ where: { messageOutboxId: { in: captureIds } } })) === captureIds.length, "exactly one attempt row each");
  const obsoleteBatch = await createAndActivate({
    name: "Capture obsolete", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.",
    rule: { trigger: "ONE_TIME", localDate: "2027-05-24", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"] },
  }, ids.comms, commsPermissions);
  await schedules.runScheduledEmailBatch(obsoleteBatch.scheduleId, { now: new Date("2027-05-24T14:01:00Z"), deadline: Date.now() - 1 });
  const obsoleteIds = (await outboxOf(obsoleteBatch.scheduleId)).map((row) => row.id);
  assert(obsoleteIds.length >= 3, "the second batch has queued messages");
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.comms } }, data: { status: "INACTIVE" } });
  assert((await captureMessageIdsLocally(obsoleteIds)).length === 0, "nothing is captured for an approver who lost permission");
  assert((await outboxOf(obsoleteBatch.scheduleId)).every((row) => row.status === "CANCELLED") && (await recipientsOf(obsoleteBatch.scheduleId)).filter((row) => row.status === "EXCLUDED").every((row) => row.exclusionCode === "APPROVER_NOT_PERMITTED"), "they are cancelled with the reason recorded");
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.comms } }, data: { status: "ACTIVE" } });
  const unlinkedLocal = await prisma.messageOutbox.create({
    data: {
      eventId: ids.event, templateKey: "EVENT_ANNOUNCEMENT", recipientKind: "REGISTRANT", recipientEmail: email("unlinked"),
      senderNameSnapshot: "Synthetic", senderEmailSnapshot: "events@example.test", subjectSnapshot: "x", bodyTextSnapshot: "x",
      idempotencyKey: `${P}-unlinked-local`, correlationId: randomUUID(), status: "PENDING", metadata: { scheduledEmailBatchId: capture.scheduleId },
    },
  });
  assert((await captureMessageIdsLocally([unlinkedLocal.id])).length === 0 && (await prisma.messageOutbox.findUniqueOrThrow({ where: { id: unlinkedLocal.id } })).status === "CANCELLED", "an unlinked scheduled message is cancelled, not captured");
  await prisma.eventMessageSettings.update({ where: { eventId: ids.event }, data: { deliveryPaused: false } });

  // 12j. The sweep's dispatch honours its batch limit and its time budget; what it leaves stays due.
  const dueOne = await createAndActivate({ name: "Due one", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.", rule: { trigger: "ONE_TIME", localDate: "2027-07-01", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"] } });
  const dueTwo = await createAndActivate({ name: "Due two", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Synthetic", announcementBody: "Synthetic.", rule: { trigger: "ONE_TIME", localDate: "2027-07-02", localTime: "09:00" }, query: { roles: ["REGISTRATION_CONTACT"] } });
  const dispatchNow = new Date("2027-07-02T14:01:00Z");
  assert((await schedules.dispatchDueScheduledEmails({ now: dispatchNow, budgetMs: 0 })).length === 0, "a spent time budget starts no batch");
  const limited = await schedules.dispatchDueScheduledEmails({ now: dispatchNow, limit: 1 });
  assert(limited.length === 1 && limited[0]!.batchId === dueOne.scheduleId, "the limit runs one batch, the oldest first");
  const rest = await schedules.dispatchDueScheduledEmails({ now: dispatchNow });
  assert(rest.length === 1 && rest[0]!.batchId === dueTwo.scheduleId, "the other stayed due and runs next");

  // 13. Another event's schedule is not reachable by id.
  await refusal(() => schedules.getScheduledEmail(ids.other, scheduleId), "MESSAGE_NOT_FOUND", "reading another event's schedule");
  await refusal(() => schedules.cancelScheduledEmail(ids.other, ids.admin, scheduleId), "MESSAGE_NOT_FOUND", "cancelling another event's schedule");
  await refusal(() => schedules.pauseScheduledEmail(ids.other, ids.admin, two.scheduleId), "MESSAGE_NOT_FOUND", "pausing another event's schedule");
  await refusal(() => schedules.reviewStoredScheduledEmail(ids.other, allPermissions, five.scheduleId), "MESSAGE_NOT_FOUND", "reviewing another event's schedule");
  await refusal(() => schedules.activateScheduledEmail(ids.other, ids.admin, allPermissions, five.scheduleId, { expectedRevision: 2, previewFingerprint: "4".repeat(64) }), "MESSAGE_NOT_FOUND", "approving another event's schedule");
  await refusal(() => schedules.updateScheduledEmail(ids.other, ids.admin, allPermissions, { scheduleId: five.scheduleId, expectedRevision: 2, previewFingerprint: "4".repeat(64), ...content() }), "MESSAGE_NOT_FOUND", "editing another event's schedule");
  await refusal(() => schedules.createScheduledEmail(ids.other, ids.admin, allPermissions, { scheduleId, previewFingerprint: "4".repeat(64), ...content() }), "MESSAGE_NOT_FOUND", "reusing another event's schedule id");
  assert((await stateOf(five.scheduleId)).status === "SCHEDULED" && (await stateOf(two.scheduleId)).status === "CANCELLED", "none of those touched the schedules");

  // 14. The list reports counts and states, and no address.
  const listed = await schedules.listScheduledEmails(ids.event);
  assert(listed.length >= 9 && listed.some((entry) => entry.status === "COMPLETED") && listed.some((entry) => entry.status === "CANCELLED") && listed.some((entry) => entry.status === "PAUSED") && listed.some((entry) => entry.status === "FAILED"), "the list shows completed, cancelled, paused and failed schedules");
  assert(!JSON.stringify(listed).includes("@example.test"), "the list carries no address");
  const completed = listed.find((entry) => entry.id === scheduleId)!;
  assert(completed.recipientCounts.QUEUED === 2 && completed.recipientCounts.EXCLUDED === 4 && completed.deliveryCounts.SENT === 2 && completed.deliveryCounts.CANCELLED === 1, `counts: ${JSON.stringify(completed.recipientCounts)} ${JSON.stringify(completed.deliveryCounts)}`);

  console.log("Scheduled email verification passed.");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error("cleanup failed", cleanupError); }
    await prisma.$disconnect();
    process.exit(1);
  });
