/**
 * Proves staff-started registration drafts (#1510) against a real PostgreSQL database, through the real public submission and
 * the real draft routines: a draft keeps only what the browser-draft rule allows; a staff check runs the public submit and
 * keeps nothing (no registration, submission, message, person or payment row) and still returns an estimated total when a
 * required answer only the registrant can give is missing; the real submit still needs that answer; a submit from the private
 * link links the draft to the registration, marks it submitted and clears its answers; the same key replays; a new key is
 * refused; an expired link and a link for another form are refused; and no payment row is ever made.
 * Part two: staff finish a registration themselves (paper evidence with a location, staff-entered for a phone call, never online;
 * no signature or payment rows; replay and already-sent; a closed, not-yet-open or full event is refused and then overridden with a
 * reason, the same total and a separate audit row; an ended event never; the last seat goes to exactly one of a staff and a public submit).
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:staff-registration-drafts
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { hashOpaqueToken } from "../modules/access/tokens";
import { registrationFormDefinitionSchema } from "../modules/forms/definition";
import { submitPublicRegistration, type StaffSubmitContext } from "../modules/forms/public-repository";
import { STAFF_DRAFT_LINK_TEMPLATE_KEY } from "../modules/staff-registration-drafts/link-email";
import { checkStaffDraft, createStaffDraft, getStaffFinishView, submitStaffDraft } from "../modules/staff-registration-drafts/repository";

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
  // The product can never delete evidence; the superuser bypass lets this check clear its own rows.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM "SignatureEvidence" WHERE "eventId" LIKE ${`${P}_%`}`;
    await tx.$executeRaw`DELETE FROM "AcknowledgmentEvidence" WHERE "eventId" LIKE ${`${P}_%`}`;
  });
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

const ACK_TEXT = "Synthetic staff-entered acknowledgment wording.";
const consentDefinition = registrationFormDefinitionSchema.parse({
  title: "Staff submit check", description: "Temporary fictitious form.", confirmationMessage: "Received.",
  payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Credit / debit card", percentageBasisPoints: 290, fixedFeeCents: 30, passFeeToRegistrant: true },
  sections: [{
    id: `${P}_consent_main`, title: "Details", description: "", fields: [
      field("c_first", "first_name", "First name", "TEXT", "ATTENDEE", { required: true }),
      field("c_last", "last_name", "Last name", "TEXT", "ATTENDEE", { required: true }),
      field("c_email", "email", "Email", "EMAIL", "REGISTRATION", { required: true }),
      field("c_ack", "reg_ack", "Acknowledgment", "ACKNOWLEDGMENT", "REGISTRATION", { required: true, acknowledgment: { source: "TEXT", text: ACK_TEXT } }),
      field("c_sig", "reg_sig", "Signature", "SIGNATURE", "REGISTRATION", { required: true, signature: { text: "Synthetic signature statement." } }),
      field("c_fee", "registration_fee", "Registration fee", "CALCULATED", "REGISTRATION", { priceCents: 7_500 }),
      field("c_pay", "payment_method", "Payment method", "RADIO", "REGISTRATION", { required: true, options: ["Pay later", "Credit / debit card"] }),
    ],
  }],
});

const dateOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function makeEvent(name: string, extra: Record<string, unknown> = {}, forms: Array<"consent" | "plain"> = ["consent"]) {
  const id = `${P}_ev_${name}`;
  const eventSlug = `${P}-ev-${name}`;
  const day = 86_400_000;
  await prisma.event.create({
    data: { id, slug: eventSlug, name: `Staff submit ${name}`, startsAt: new Date(Date.now() + 7 * day), endsAt: new Date(Date.now() + 8 * day), isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY", ...extra },
  });
  for (const kind of forms) {
    await prisma.registrationForm.create({
      data: {
        id: `${id}_${kind}`, eventId: id, createdByUserId: staffUserId, name: `Staff submit ${kind}`, slug: `${eventSlug}-${kind}`, status: RegistrationFormStatus.PUBLISHED,
        versions: { create: { id: `${id}_${kind}_v`, createdByUserId: staffUserId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition: kind === "consent" ? consentDefinition : definition } },
      },
    });
  }
  return { id, slug: eventSlug };
}

type Ev = { id: string; slug: string };
async function staffDraft(ev: Ev, source: "PHONE" | "PAPER" | "WALK_IN", name: string, kind: "consent" | "plain" = "consent") {
  const created = await createStaffDraft(ev.id, staffUserId, { formId: `${ev.id}_${kind}`, source, responses: answers(name) });
  return created.id;
}
function staffInput(ev: Ev, name: string, extra: Record<string, unknown> = {}, key: string = randomUUID()) {
  return {
    versionId: `${ev.id}_consent_v`, idempotencyKey: key,
    responses: { ...answers(name), reg_ack: true, reg_sig: `Sdc${name} Sample`, payment_method: "Pay later", ...extra },
  };
}
function staffContext(draftId: string, extra: Partial<StaffSubmitContext> = {}): StaffSubmitContext {
  return { draftId, actorUserId: staffUserId, paperLocation: null, override: null, overrideAllowed: false, ...extra };
}
async function staffSubmit(ev: Ev, draftId: string, name: string, context: Partial<StaffSubmitContext> = {}, extra: Record<string, unknown> = {}, key?: string) {
  return submitPublicRegistration(ev.slug, `${ev.slug}-consent`, staffInput(ev, name, extra, key), undefined, undefined, undefined, staffContext(draftId, context));
}
const overrideAudits = (registrationId: string) => prisma.auditLog.findMany({ where: { entityId: registrationId, action: "REGISTRATION_RULE_OVERRIDDEN" } });

async function staffSubmitChecks() {
  const reason = "Caller phoned after the deadline; approved by the director.";

  // --- Open event: evidence channels, no signature or payment rows, replay, already sent.
  const open = await makeEvent("open");
  const paperDraft = await staffDraft(open, "PAPER", "Paper");
  // A hand-off email that has not gone out yet is cancelled when staff send the registration.
  const pending = await prisma.messageOutbox.create({
    data: {
      eventId: null, templateKey: STAFF_DRAFT_LINK_TEMPLATE_KEY, recipientKind: "ACCOUNT", recipientEmail: `${P}-paper@example.test`, senderNameSnapshot: "Synthetic", senderEmailSnapshot: "noreply@example.test",
      subjectSnapshot: "Synthetic link", bodyTextSnapshot: "Synthetic body.", metadata: {}, idempotencyKey: `${P}-pending-${randomUUID()}`, correlationId: randomUUID(), status: "PENDING",
    },
  });
  await prisma.staffRegistrationDraft.update({ where: { id: paperDraft }, data: { status: "HANDED_OFF", handOffExpiresAt: new Date(Date.now() + 86_400_000), handOffMessageId: pending.id } });

  const missingLocation = await rejection(staffSubmit(open, paperDraft, "Paper"));
  assert(missingLocation?.code === "INVALID_SUBMISSION" && missingLocation.issues?.some((issue) => issue.key === "paperLocation"), "a paper source needs the paper's location");
  const card = await rejection(staffSubmit(open, paperDraft, "Paper", { paperLocation: "Binder A" }, { payment_method: "Credit / debit card" }));
  assert(card?.code === "INVALID_SUBMISSION" && card.issues?.some((issue) => issue.key === "payment_method") && /Staff can't choose card payment/.test(card.message ?? ""), "staff cannot choose card payment");
  const noAck = await rejection(staffSubmit(open, paperDraft, "Paper", { paperLocation: "Binder A" }, { reg_ack: undefined }));
  assert(noAck?.code === "INVALID_SUBMISSION" && noAck.issues?.some((issue) => issue.key === "reg_ack"), "a required acknowledgment is still required");
  assert(await prisma.registration.count({ where: { eventId: open.id } }) === 0, "refusals created nothing");

  const paperKey = randomUUID();
  const sent = await staffSubmit(open, paperDraft, "Paper", { paperLocation: "Binder A" }, {}, paperKey);
  const paperRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: open.id, confirmationCode: sent.confirmationCode } });
  const paperEvidence = await prisma.acknowledgmentEvidence.findMany({ where: { registrationId: paperRegistration.id } });
  assert(paperEvidence.length === 1 && paperEvidence[0]!.channel === "PAPER" && paperEvidence[0]!.paperLocation === "Binder A" && paperEvidence[0]!.recordedByUserId === staffUserId, "a paper source records PAPER evidence with its location, by the staff user");
  assert(paperEvidence[0]!.actedByPersonId === paperRegistration.accountHolderPersonId, "the evidence is about the account holder");
  assert((paperEvidence[0]!.requestMetadata as { userAgentHash?: string | null } | null)?.userAgentHash == null && !JSON.stringify(paperEvidence[0]!.requestMetadata).toLowerCase().includes("ip"), "no user agent and no IP are recorded");
  assert(await prisma.signatureEvidence.count({ where: { registrationId: paperRegistration.id } }) === 0, "no signature row is written");
  assert(await prisma.payment.count({ where: { registrationId: paperRegistration.id } }) === 0 && await prisma.paymentAttempt.count({ where: { registrationId: paperRegistration.id } }) === 0, "no payment rows are made");
  const linkedDraft = await prisma.staffRegistrationDraft.findUniqueOrThrow({ where: { id: paperDraft } });
  assert(linkedDraft.status === "SUBMITTED" && linkedDraft.registrationId === paperRegistration.id && linkedDraft.source === "PAPER" && JSON.stringify(linkedDraft.responses) === "{}", "the draft links to the registration with its paper source");
  assert(linkedDraft.submittedByUserId === staffUserId, "a staff submit records the staff user who sent it");
  assert((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: pending.id } })).status === "CANCELLED", "the pending hand-off email is cancelled");
  const byStaff = await prisma.auditLog.findMany({ where: { entityId: paperDraft, action: "STAFF_REGISTRATION_DRAFT_SUBMITTED_BY_STAFF" } });
  const byStaffMetadata = byStaff[0]?.metadata as Record<string, unknown> | undefined;
  assert(byStaff.length === 1 && byStaff[0]!.actorUserId === staffUserId && byStaffMetadata?.registrationId === paperRegistration.id && byStaffMetadata.acknowledgmentChannel === "PAPER" && byStaffMetadata.paymentCollected === false, "the staff submit is audited by the staff user");
  assert(!JSON.stringify(byStaffMetadata).includes("Sdc"), "the audit row holds no answer value");
  assert((await overrideAudits(paperRegistration.id)).length === 0, "no override audit when nothing was overridden");

  const registrationsNow = await prisma.registration.count({ where: { eventId: open.id } });
  const replay = await staffSubmit(open, paperDraft, "Paper", { paperLocation: "Binder A" }, {}, paperKey);
  assert(replay.confirmationCode === sent.confirmationCode && await prisma.registration.count({ where: { eventId: open.id } }) === registrationsNow, "a replay with the same key returns the same registration");
  const sentAgain = await rejection(staffSubmit(open, paperDraft, "Paper", { paperLocation: "Binder A" }));
  assert(sentAgain?.code === "STAFF_DRAFT_ALREADY_SUBMITTED", `a second key is refused (got ${String(sentAgain?.code)})`);

  const phoneDraft = await staffDraft(open, "PHONE", "Phone");
  const stray = await rejection(staffSubmit(open, phoneDraft, "Phone", { paperLocation: "Binder A" }));
  assert(stray?.code === "INVALID_SUBMISSION" && stray.issues?.some((issue) => issue.key === "paperLocation"), "a paper location is refused for a phone source");
  const phoneSent = await staffSubmit(open, phoneDraft, "Phone");
  const phoneRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: open.id, confirmationCode: phoneSent.confirmationCode } });
  const phoneEvidence = await prisma.acknowledgmentEvidence.findMany({ where: { registrationId: phoneRegistration.id } });
  assert(phoneEvidence.length === 1 && phoneEvidence[0]!.channel === "STAFF_ENTERED" && phoneEvidence[0]!.paperLocation === null, "a phone source records STAFF_ENTERED evidence");
  assert(await prisma.acknowledgmentEvidence.count({ where: { eventId: open.id, channel: "ONLINE" } }) === 0, "no staff submit records ONLINE evidence");
  const openTotal = phoneSent.totalCents;
  assert(openTotal === 7_500, `the open-event total is the form's price (got ${String(openTotal)})`);

  // A draft from another event is refused.
  const foreign = await staffDraft(await makeEvent("foreign"), "PHONE", "Foreign");
  const foreignTry = await rejection(staffSubmit(open, foreign, "Foreign"));
  assert(foreignTry?.code === "STAFF_DRAFT_UNAVAILABLE", `a draft from another event is refused (got ${String(foreignTry?.code)})`);

  // An override sent where no rule needed it writes no override audit.
  const unneeded = await staffDraft(open, "WALK_IN", "Unneeded");
  const unneededSent = await staffSubmit(open, unneeded, "Unneeded", { override: { reason }, overrideAllowed: true });
  const unneededRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: open.id, confirmationCode: unneededSent.confirmationCode } });
  assert((await overrideAudits(unneededRegistration.id)).length === 0, "an override nothing needed writes no override audit");

  // --- Closed event: refused, then overridden.
  const closed = await makeEvent("closed", { registrationClosesOn: dateOffset(-2) });
  const closedDraft = await staffDraft(closed, "PHONE", "Closed");
  const closedRefusal = await rejection(staffSubmit(closed, closedDraft, "Closed"));
  assert(closedRefusal?.code === "REGISTRATION_CLOSED" && (closedRefusal as { overridable?: boolean }).overridable === true, "a closed event is refused and says it can be overridden");
  const publicClosed = await rejection(submitPublicRegistration(closed.slug, `${closed.slug}-consent`, { ...staffInput(closed, "Closed"), website: "" as const }));
  assert(publicClosed?.code === "REGISTRATION_CLOSED" && (publicClosed as { overridable?: boolean }).overridable === false, "the public path is never overridable");
  const noPermission = await rejection(staffSubmit(closed, closedDraft, "Closed", { override: { reason }, overrideAllowed: false }));
  assert(noPermission?.code === "REGISTRATION_CLOSED", "an override without permission is not honored");
  const viaModule = await rejection(submitStaffDraft(closed.id, closedDraft, { userId: staffUserId, canOverride: false }, { input: staffInput(closed, "Closed"), paperLocation: null, override: { reason } }));
  assert(viaModule?.code === "OVERRIDE_NOT_ALLOWED", "the submit routine refuses an override without permission");
  assert(await prisma.registration.count({ where: { eventId: closed.id } }) === 0, "nothing was written without the permission");
  const checkedClosed = await checkStaffDraft(closed.id, closedDraft, staffUserId);
  assert(!checkedClosed.ok && checkedClosed.kind === "UNAVAILABLE" && checkedClosed.overridable && checkedClosed.code === "REGISTRATION_CLOSED", "a check reports the overridable rule");
  const closedSent = await staffSubmit(closed, closedDraft, "Closed", { override: { reason }, overrideAllowed: true });
  const closedRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: closed.id, confirmationCode: closedSent.confirmationCode } });
  const closedAudits = await overrideAudits(closedRegistration.id);
  const closedMetadata = closedAudits[0]?.metadata as Record<string, unknown> | undefined;
  assert(closedAudits.length === 1 && closedAudits[0]!.actorUserId === staffUserId && closedAudits[0]!.entityType === "Registration", "the override has its own audit row");
  assert(JSON.stringify(closedMetadata?.rules) === JSON.stringify(["REGISTRATION_CLOSED"]) && closedMetadata?.reason === reason && closedMetadata?.draftId === closedDraft && closedMetadata?.source === "PHONE" && closedMetadata?.paymentCollected === false, "the override row names the rule, the reason, the draft and the source");
  assert(!closedAudits[0]!.summary.includes(reason) && /registration closed/.test(closedAudits[0]!.summary), "its summary names the rule, not the reason");
  assert(closedSent.totalCents === openTotal, "an override never changes the price");

  // The finish page: the form for an open event, a message for someone who cannot override, the form with the rule for someone who can.
  const finishOpen = await getStaffFinishView(open.id, await staffDraft(open, "PHONE", "Finish"), false);
  assert(finishOpen.kind === "READY" && finishOpen.overrideRule === null, "an open event shows the form with no rule");
  const finishClosedDraft = await staffDraft(closed, "PHONE", "FinishClosed");
  const finishDenied = await getStaffFinishView(closed.id, finishClosedDraft, false);
  assert(finishDenied.kind === "MESSAGE" && /closed for this event\. Someone with Registration overrides can send it\./.test(finishDenied.message), "closed without the permission is a message only");
  const finishAllowed = await getStaffFinishView(closed.id, finishClosedDraft, true);
  assert(finishAllowed.kind === "READY" && finishAllowed.overrideRule === "Registration is closed for this event.", "closed with the permission shows the form and names the rule");
  assert(finishAllowed.kind === "READY" && !finishAllowed.experience.form.definition.sections.some((section) => section.fields.some((candidate) => candidate.options.includes("Credit / debit card"))), "the finish form leaves off the card choice");
  const closedSentDraft = await getStaffFinishView(closed.id, closedDraft, true);
  assert(closedSentDraft.kind === "MESSAGE" && /already sent/.test(closedSentDraft.message), "a draft already sent is a message only");
  const sentRow = await prisma.staffRegistrationDraft.findUniqueOrThrow({ where: { id: closedDraft } });
  assert(sentRow.submittedByUserId === staffUserId, "the override submit records who sent it");

  // --- Not open yet.
  const upcoming = await makeEvent("upcoming", { registrationOpensOn: dateOffset(3) });
  const upcomingDraft = await staffDraft(upcoming, "PHONE", "Upcoming");
  const upcomingRefusal = await rejection(staffSubmit(upcoming, upcomingDraft, "Upcoming"));
  assert(upcomingRefusal?.code === "REGISTRATION_NOT_OPEN" && (upcomingRefusal as { overridable?: boolean }).overridable === true, "an event not open yet is refused and overridable");
  const upcomingSent = await staffSubmit(upcoming, upcomingDraft, "Upcoming", { override: { reason }, overrideAllowed: true });
  const upcomingRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: upcoming.id, confirmationCode: upcomingSent.confirmationCode } });
  assert(JSON.stringify(((await overrideAudits(upcomingRegistration.id))[0]?.metadata as Record<string, unknown>)?.rules) === JSON.stringify(["REGISTRATION_NOT_OPEN"]), "the not-open rule is recorded");

  // --- Full, no waitlist: refused, then overridden. With a waitlist: waitlisted as normal.
  const full = await makeEvent("full", { capacity: 1 });
  const firstSeat = await staffDraft(full, "PHONE", "Seat");
  await staffSubmit(full, firstSeat, "Seat");
  const fullDraft = await staffDraft(full, "PHONE", "Over");
  const fullRefusal = await rejection(staffSubmit(full, fullDraft, "Over"));
  assert(fullRefusal?.code === "EVENT_FULL" && (fullRefusal as { overridable?: boolean }).overridable === true, "a full event without a waitlist is refused and overridable");
  const fullSent = await staffSubmit(full, fullDraft, "Over", { override: { reason }, overrideAllowed: true });
  const fullRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: full.id, confirmationCode: fullSent.confirmationCode } });
  assert(fullRegistration.status === "SUBMITTED" && JSON.stringify(((await overrideAudits(fullRegistration.id))[0]?.metadata as Record<string, unknown>)?.rules) === JSON.stringify(["EVENT_FULL"]), "the full event takes the registration and records the rule");
  const closedFull = await makeEvent("closedfull", { capacity: 1, registrationClosesOn: dateOffset(-2) });
  const closedFullSeat = await staffDraft(closedFull, "PHONE", "Seat");
  await staffSubmit(closedFull, closedFullSeat, "Seat", { override: { reason }, overrideAllowed: true });
  const bothDraft = await staffDraft(closedFull, "PHONE", "Both");
  const bothSent = await staffSubmit(closedFull, bothDraft, "Both", { override: { reason }, overrideAllowed: true });
  const bothRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: closedFull.id, confirmationCode: bothSent.confirmationCode } });
  assert(JSON.stringify(((await overrideAudits(bothRegistration.id))[0]?.metadata as Record<string, unknown>)?.rules) === JSON.stringify(["REGISTRATION_CLOSED", "EVENT_FULL"]), "a closed and full event records both rules");

  const waitlist = await makeEvent("waitlist", { capacity: 1, waitlistEnabled: true });
  await staffSubmit(waitlist, await staffDraft(waitlist, "PHONE", "Seat"), "Seat");
  const waitDraft = await staffDraft(waitlist, "PHONE", "Wait");
  const waitSent = await staffSubmit(waitlist, waitDraft, "Wait", { override: { reason }, overrideAllowed: true });
  const waitRegistration = await prisma.registration.findFirstOrThrow({ where: { eventId: waitlist.id, confirmationCode: waitSent.confirmationCode } });
  assert(waitRegistration.status === "WAITLISTED" && (await overrideAudits(waitRegistration.id)).length === 0, "a full event with a waitlist waitlists the person with no override");

  // --- An ended event is never overridable.
  const ended = await makeEvent("ended", { startsAt: new Date(Date.now() - 5 * 86_400_000), endsAt: new Date(Date.now() - 3 * 86_400_000) });
  const endedDraft = await staffDraft(ended, "PHONE", "Ended");
  const endedRefusal = await rejection(staffSubmit(ended, endedDraft, "Ended", { override: { reason }, overrideAllowed: true }));
  const finishEnded = await getStaffFinishView(ended.id, endedDraft, true);
  assert(finishEnded.kind === "MESSAGE" && /ended or been closed out/.test(finishEnded.message), "an ended event is a message only, even with the permission");
  assert(endedRefusal?.code === "REGISTRATION_CLOSED" && (endedRefusal as { overridable?: boolean }).overridable === false, "an ended event is never overridable");
  assert(await prisma.registration.count({ where: { eventId: ended.id } }) === 0, "nothing was written for an ended event");

  // --- The last seat: a staff submit and a public submit at once. Exactly one gets in; the other is told the event is full.
  const race = await makeEvent("race", { capacity: 1 }, ["plain"]);
  const raceDraft = await staffDraft(race, "PHONE", "RaceStaff", "plain");
  const racers = await Promise.allSettled([
    submitPublicRegistration(race.slug, `${race.slug}-plain`, { versionId: `${race.id}_plain_v`, idempotencyKey: randomUUID(), responses: { ...answers("RaceStaff"), birth_date: "2010-01-01" } }, undefined, undefined, undefined, staffContext(raceDraft)),
    submitPublicRegistration(race.slug, `${race.slug}-plain`, { versionId: `${race.id}_plain_v`, idempotencyKey: randomUUID(), responses: { ...answers("RacePublic"), birth_date: "2010-01-01" }, website: "" }),
  ]);
  const winners = racers.filter((result) => result.status === "fulfilled");
  const losers = racers.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(winners.length === 1 && losers.length === 1 && (losers[0]!.reason as { code?: string }).code === "EVENT_FULL", `exactly one of a staff and a public submit gets the last seat (got ${racers.map((result) => result.status === "fulfilled" ? "ok" : String((result.reason as { code?: string }).code)).join(", ")})`);
  assert(await prisma.registration.count({ where: { eventId: race.id } }) === 1, "only one registration holds the last seat");
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
  assert(linked.submittedByUserId === null, "a registrant's own submit leaves submittedByUserId empty");
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

  await staffSubmitChecks();

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
