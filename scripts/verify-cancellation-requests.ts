/**
 * Proves cancellation requests (#170) against a real PostgreSQL database. No network, no credentials, no money: every
 * row is fictitious, created here and removed here.
 *
 * - A registrant's request saves the recorded calculation (policy version, rules, facts) with it, in one transaction.
 * - Duplicate, overlapping and parallel submissions leave one open request per registration and scope; the database's
 *   own unique index settles a race; a replacement supersedes the older request visibly.
 * - The database itself refuses a decided request without a named person, a time and a reason, and refuses any change to
 *   the timeline.
 * - Staff review is by a named person with a reason; approving records the decision only: the registration, attendees,
 *   payments, refunds, adjustments and capacity are byte-identical before and after.
 * - The registrant is emailed the status only, through the outbox, never the reason.
 * - Deleting an event removes its requests and their timeline despite the immutability trigger.
 *
 *   npm run test:cancellation-requests
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-cancellation-requests-synthetic-key-not-a-secret");
delete process.env.ALERT_WEBHOOK_URL;

const P = "crq";
const staffId = `${P}_staff`;
const staffTwoId = `${P}_staff_two`;
const eventId = `${P}_event`;
const otherEventId = `${P}_other_event`;
const deleteEventId = `${P}_delete_event`;
const startsWithP = { startsWith: `${P}_` };
const SECRET_REASON = "crq-secret-reason-words";

const base = new PrismaClient();
// The modules reach the database through the global client, so this is the one they use.
(globalThis as unknown as { prisma?: unknown }).prisma = base;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function stable(value: unknown) {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

async function removeEvent(id: string) {
  const { removeEventOwnedRows } = await import("../modules/events/deletion-repository");
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    if (await tx.event.findUnique({ where: { id }, select: { id: true } })) await removeEventOwnedRows(tx, id);
  }, { timeout: 30_000 });
}

async function cleanup() {
  // Audit rows only point at an event (set null on delete), so they go first, or they would outlive it.
  await base.auditLog.deleteMany({ where: { OR: [{ eventId: { in: [eventId, otherEventId, deleteEventId] } }, { actorUserId: { in: [staffId, staffTwoId] } }] } });
  for (const id of [eventId, otherEventId, deleteEventId]) await removeEvent(id);
  await base.person.deleteMany({ where: { id: startsWithP } });
  await base.user.deleteMany({ where: { id: { in: [staffId, staffTwoId] } } });
}

function rules(deadline: string) {
  return {
    windows: [{
      id: "before-deadline", label: "Before the deadline", endsOn: deadline,
      terms: { refund: { kind: "FULL" }, flatWithholdCents: 1000, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: false },
    }],
    afterWindows: { label: "After the deadline", terms: { refund: { kind: "FULL" }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "FORFEIT", creditAllowed: false } },
    noShow: null,
    allowedScopes: ["FULL_REGISTRATION", "ATTENDEE"],
    supportedComponents: { categories: [], fieldKeys: [] },
    classifications: [],
    nonrefundable: { categories: [], fieldKeys: [] },
    cardFeeTreatment: "REFUNDABLE",
  };
}

let formVersionId = "";
let counter = 0;

/** A $400.00 registration of two attendees ($200.00 each), paid in full by two check payments. */
async function createRegistration(options: { eventId?: string } = {}) {
  counter += 1;
  const event = options.eventId ?? eventId;
  const code = `CRQ${String(counter).padStart(4, "0")}`;
  const holder = await base.person.create({ data: { id: `${P}_holder_${counter}`, firstName: "Request", lastName: `Holder${counter}`, normalizedEmail: `${P}-holder-${counter}@example.test` } });
  const registration = await base.registration.create({
    data: {
      eventId: event, accountHolderPersonId: holder.id, confirmationCode: code, totalAmount: 400, status: "CONFIRMED", submittedAt: new Date("2028-03-01T15:00:00Z"),
      contactSnapshot: { firstName: "Request", lastName: `Holder${counter}`, email: `${P}-holder-${counter}@example.test`, phone: "" },
    },
  });
  const attendeeIds: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const person = await base.person.create({ data: { id: `${P}_att_${counter}_${index}`, firstName: `Attendee${index + 1}`, lastName: `Check${counter}`, normalizedEmail: `${P}-att-${counter}-${index}@example.test` } });
    const attendee = await base.registrationAttendee.create({
      data: { eventId: event, registrationId: registration.id, personId: person.id, attendeeType: "ADULT", position: index, profileSnapshot: { firstName: `Attendee${index + 1}`, lastName: `Check${counter}` } },
    });
    attendeeIds.push(attendee.id);
  }
  await base.publicRegistrationSubmission.create({
    data: {
      eventId: event, formVersionId, registrationId: registration.id, idempotencyKey: `${P}_idem_${counter}`, requestHash: "hash", responses: {},
      pricingSnapshot: {
        currency: "USD", subtotalCents: 40_000, processingFeeCents: 0, totalCents: 40_000,
        lineItems: [
          { key: "attendees.0.registration_fee", label: "Registration, Attendee1", amountCents: 20_000, attendeeIndex: 0 },
          { key: "attendees.1.registration_fee", label: "Registration, Attendee2", amountCents: 20_000, attendeeIndex: 1 },
        ],
      },
    },
  });
  await base.payment.create({ data: { eventId: event, registrationId: registration.id, amount: 100, status: "SUCCEEDED", method: "CHECK", receivedAt: new Date("2028-03-02T15:00:00Z") } });
  await base.payment.create({ data: { eventId: event, registrationId: registration.id, amount: 300, status: "SUCCEEDED", method: "CHECK", receivedAt: new Date("2028-03-10T15:00:00Z") } });
  return { registrationId: registration.id, code, attendeeIds, eventId: event };
}

/** Everything a cancellation could change, so "nothing changed" is checked by content, not by count. */
async function moneyAndRegistrationState(registrationId: string) {
  const [registration, attendees, payments, refunds, adjustments, reservations] = await Promise.all([
    base.registration.findUniqueOrThrow({ where: { id: registrationId } }),
    base.registrationAttendee.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
    base.payment.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
    base.refund.findMany({ where: { payment: { registrationId } }, orderBy: { id: "asc" } }),
    base.registrationAdjustment.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
    base.registrationCapacityReservation.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
  ]);
  return stable({ registration, attendees, payments, refunds, adjustments, reservations });
}

async function rejects(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
}

async function main() {
  const policy = await import("../modules/cancellation-policy/repository");
  const requests = await import("../modules/cancellation-requests/repository");

  await cleanup();
  await base.user.create({ data: { id: staffId, email: `${P}-staff@example.test`, displayName: "Request Check Finance", globalRole: "SYSTEM_ADMIN" } });
  await base.user.create({ data: { id: staffTwoId, email: `${P}-staff-two@example.test`, displayName: "Request Check Second Reviewer", globalRole: "SYSTEM_ADMIN" } });
  for (const [id, slug] of [[eventId, "crq-event-slug"], [otherEventId, "crq-other-event-slug"], [deleteEventId, "crq-delete-event-slug"]] as const) {
    await base.event.create({
      data: {
        id, slug, name: `Cancellation request check ${slug}`, timezone: "America/Chicago",
        startsAt: new Date("2028-07-13T15:00:00Z"), endsAt: new Date("2028-07-16T18:00:00Z"), isPublished: true, billingMode: "ATTENDEE_PAY",
      },
    });
  }
  const form = await base.registrationForm.create({ data: { eventId, createdByUserId: staffId, name: "Form", slug: "crq-event-form" } });
  formVersionId = (await base.registrationFormVersion.create({
    data: { formId: form.id, createdByUserId: staffId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: { title: "Check", description: "", confirmationMessage: "Received.", sections: [] } },
  })).id;

  const now = new Date("2028-01-10T12:00:00.000Z");
  const registration = await createRegistration();
  const target = { registrationId: registration.registrationId, eventId };
  const [attendeeOne, attendeeTwo] = registration.attendeeIds;

  // ---- No policy yet: requests are not offered. ----
  {
    const view = await requests.getRegistrantRequestView(target, now);
    assert(!view.available, "no policy in effect means no online request");
  }
  await policy.createPolicyVersion(eventId, staffId, { rules: rules("2028-05-25"), effectiveFrom: "2028-01-10T12:00:00.000Z" }, now);
  {
    const view = await requests.getRegistrantRequestView(target, now);
    assert(view.available && view.allowedScopes.join() === "FULL_REGISTRATION,ATTENDEE", "the policy's scopes are offered");
    assert(view.attendees.length === 2, "the registration's own attendees can be chosen");
  }
  console.log("ok: requests are offered only under a policy in effect");

  const input = (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    return {
      action: "submit" as const,
      selection: { scope: "FULL_REGISTRATION" as const },
      reason: SECRET_REASON,
      contactMethod: "EMAIL" as const,
      idempotencyKey: `${P}-key-${String(counter).padStart(6, "0")}`,
      expectedRefundCents: 39_000,
      ...overrides,
    };
  };

  // ---- The proposed outcome is shown before submitting. ----
  const proposal = await requests.previewRegistrantRequest(target, { scope: "FULL_REGISTRATION" }, now);
  assert(proposal.status === "CALCULATED" && proposal.refundCents === 39_000, `full refund minus the $10 fee is shown, got ${proposal.refundCents}`);
  assert((await base.cancellationRequest.count({ where: { eventId } })) === 0 && (await base.cancellationCalculation.count({ where: { eventId } })) === 0, "a preview saves nothing");
  console.log("ok: the proposed outcome is shown before anything is sent");

  // ---- Submit: calculation, request, timeline, audit and email in one go. ----
  const firstInput = input();
  const first = await requests.submitCancellationRequest(target, { via: "MANAGE_LINK" }, firstInput, now);
  assert(!first.duplicate && first.request.status === "REQUESTED", "the request is saved as REQUESTED");
  const saved = await base.cancellationRequest.findUniqueOrThrow({ where: { id: first.request.id }, include: { calculation: true, timeline: true } });
  assert(saved.policyVersion === 1 && saved.calculation.policyVersion === 1, "the policy version is saved with the request");
  assert(saved.calculation.createdByUserId === null && saved.calculation.registrationId === registration.registrationId, "the calculation is saved for this registration, by no staff user");
  assert(saved.proposedRefundCents === 39_000 && saved.reason === SECRET_REASON, "the proposed refund and the registrant's reason are saved");
  assert(saved.timeline.length === 1 && saved.timeline[0].toStatus === "REQUESTED", "one timeline step");
  const mail = await base.messageOutbox.findMany({ where: { eventId, templateKey: "CANCELLATION_REQUEST_RECEIVED" } });
  assert(mail.length === 1, "one received email is queued");
  assert(!mail[0].bodyTextSnapshot.includes(SECRET_REASON) && !/\$\s?\d/.test(mail[0].bodyTextSnapshot), "the email carries the status only: no reason, no amount");
  const submittedAudit = await base.auditLog.findFirstOrThrow({ where: { action: "CANCELLATION_REQUEST_SUBMITTED", entityId: first.request.id } });
  assert(!stable(submittedAudit).includes(SECRET_REASON), "the audit entry holds ids only");
  console.log("ok: a request saves the calculation, the timeline, an audit entry and a status email");

  // ---- Duplicates, overlaps and races. ----
  {
    const again = await requests.submitCancellationRequest(target, { via: "MANAGE_LINK" }, firstInput, now);
    assert(again.duplicate && again.request.id === first.request.id, "the same key returns the same request");
    const sameScope = await requests.submitCancellationRequest(target, { via: "MANAGE_LINK" }, input(), now);
    assert(sameScope.duplicate && sameScope.request.id === first.request.id, "the same scope while open returns the open request");
    const overlap = await rejects(() => requests.submitCancellationRequest(target, { via: "MANAGE_LINK" }, input({ selection: { scope: "ATTENDEE", attendeeIds: [attendeeOne] }, expectedRefundCents: 19_000 }), now));
    assert(overlap?.code === "OVERLAPPING_OPEN_REQUEST", "an overlapping request is refused unless replacement is chosen");
    assert((await base.cancellationRequest.count({ where: { eventId } })) === 1, "still one request");

    const racers = await Promise.allSettled([
      requests.submitCancellationRequest(target, { via: "MANAGE_LINK" }, input({ selection: { scope: "ATTENDEE", attendeeIds: [attendeeTwo] }, expectedRefundCents: 19_000, supersedeRequestIds: [first.request.id] }), now),
      requests.submitCancellationRequest(target, { via: "MANAGE_LINK" }, input({ selection: { scope: "ATTENDEE", attendeeIds: [attendeeTwo] }, expectedRefundCents: 19_000, supersedeRequestIds: [first.request.id] }), now),
    ]);
    assert(racers.every((result) => result.status === "fulfilled"), `parallel identical submits both succeed (one returns the other), got ${racers.map((r) => r.status).join()}`);
    const open = await base.cancellationRequest.findMany({ where: { eventId, status: { in: ["REQUESTED", "UNDER_REVIEW", "INFORMATION_NEEDED"] } } });
    assert(open.length === 1 && open[0].scopeKey.startsWith("ATTENDEE:"), `parallel submits leave one open request, found ${open.length}`);
    const older = await base.cancellationRequest.findUniqueOrThrow({ where: { id: first.request.id }, include: { timeline: { orderBy: { createdAt: "asc" } } } });
    assert(older.status === "SUPERSEDED" && older.supersededById === open[0].id, "the older request was superseded by the newer one");
    assert(older.timeline.map((step) => step.toStatus).join() === "REQUESTED,SUPERSEDED", "the supersede is in the older request's timeline");
  }
  console.log("ok: duplicate, overlapping and parallel requests leave one open request; a replacement is explicit");

  // ---- The database refuses a bad decision and any timeline change. ----
  const [current] = await base.cancellationRequest.findMany({ where: { eventId, status: "REQUESTED" } });
  {
    const noReason = await rejects(() => base.$executeRaw`UPDATE "CancellationRequest" SET "status" = 'APPROVED', "decidedByUserId" = ${staffId}, "decidedByNameSnapshot" = 'Named', "decidedAt" = now() WHERE "id" = ${current.id}`);
    assert(noReason && /decision_has_actor_and_reason/.test(String(noReason.message)), "the database refuses an approval with no reason");
    const noActor = await rejects(() => base.$executeRaw`UPDATE "CancellationRequest" SET "status" = 'DECLINED', "decisionReason" = 'No', "decidedAt" = now() WHERE "id" = ${current.id}`);
    assert(noActor && /decision_has_actor_and_reason/.test(String(noActor.message)), "the database refuses a decision with no named person");
    const timelineEdit = await rejects(() => base.cancellationRequestEvent.updateMany({ where: { requestId: current.id }, data: { note: "edited" } }));
    assert(timelineEdit && /immutable/.test(String(timelineEdit.message)), "the timeline cannot be edited");
    const timelineDelete = await rejects(() => base.cancellationRequestEvent.deleteMany({ where: { requestId: current.id } }));
    assert(timelineDelete && /immutable/.test(String(timelineDelete.message)), "the timeline cannot be deleted");
    const secondOpen = await rejects(() => base.cancellationRequest.create({
      data: {
        eventId, registrationId: registration.registrationId, calculationId: current.calculationId, scope: "ATTENDEE", attendeeIds: [attendeeTwo], scopeKey: current.scopeKey, reason: "x", contactMethod: "EMAIL",
        proposedRefundCents: 0, proposedRetainedCents: 0, stateFingerprint: "x", registrationState: {}, requestedVia: "MANAGE_LINK", idempotencyKey: `${P}-raw-duplicate-key`,
      },
    }));
    assert(secondOpen?.code === "P2002", "the database refuses a second open request for the same scope");
  }
  console.log("ok: the database refuses an undecided-by-name decision, a timeline change and a second open request");

  // ---- Staff review: named, with a reason; nothing else changes. ----
  {
    const noReason = await rejects(() => requests.reviewCancellationRequest(eventId, current.id, { userId: staffId }, { action: "DECLINE", reason: "" } as never, now));
    assert(noReason !== null, "a decision with no reason is refused");
    const noActor = await rejects(() => requests.reviewCancellationRequest(eventId, current.id, { userId: `${P}_nobody` }, { action: "DECLINE", reason: "No." }, now));
    assert(noActor?.code === "ACTOR_REQUIRED", "a decision needs a person who exists");
    const otherEvent = await rejects(() => requests.reviewCancellationRequest(otherEventId, current.id, { userId: staffId }, { action: "START_REVIEW" }, now));
    assert(otherEvent?.code === "REQUEST_NOT_FOUND", "another event's staff cannot reach the request");
    assert((await requests.getCancellationRequestDetail(otherEventId, current.id, now)) === null, "another event cannot read it");

    await requests.reviewCancellationRequest(eventId, current.id, { userId: staffId }, { action: "START_REVIEW" }, now);
    await requests.reviewCancellationRequest(eventId, current.id, { userId: staffId }, { action: "REQUEST_INFORMATION", registrantNote: "Please send the travel dates." }, now);
    const view = await requests.getRegistrantRequestView(target, now);
    assert(view.requests.some((entry) => entry.registrantNote === "Please send the travel dates."), "the registrant sees what staff asked for");

    // The registration changes after the request: a payment is refunded. An approval must acknowledge it.
    const payment = await base.payment.findFirstOrThrow({ where: { registrationId: registration.registrationId, amount: 100 } });
    await base.refund.create({ data: { eventId, paymentId: payment.id, amount: 10, status: "SUCCEEDED", reason: "Synthetic" } });
    const detail = await requests.getCancellationRequestDetail(eventId, current.id, now);
    assert(detail?.conflicts.some((conflict) => conflict.code === "PAYMENTS_CHANGED"), "staff are shown that paid money changed");
    assert(detail?.capacity.seatsReleased === 1 && detail.capacity.waitlistedInEvent === 0, "capacity and waitlist effects are shown");
    const unacknowledged = await rejects(() => requests.reviewCancellationRequest(eventId, current.id, { userId: staffId }, { action: "APPROVE", reason: "Within the policy." }, now));
    assert(unacknowledged?.code === "CHANGES_NOT_ACKNOWLEDGED", "an approval over a changed registration needs an acknowledgement");

    const stateBeforeDecision = await moneyAndRegistrationState(registration.registrationId);
    await requests.reviewCancellationRequest(eventId, current.id, { userId: staffId }, { action: "APPROVE", reason: "Within the policy.", acknowledgeChanges: true }, now);
    const approved = await base.cancellationRequest.findUniqueOrThrow({ where: { id: current.id } });
    assert(approved.status === "APPROVED" && approved.decidedByUserId === staffId && approved.decidedByNameSnapshot === "Request Check Finance" && approved.decisionReason === "Within the policy." && approved.decidedWithChanges, "the approval records the named person, the reason and the acknowledgement");
    assert((await moneyAndRegistrationState(registration.registrationId)) === stateBeforeDecision, "approving changed no registration, attendee, payment, refund, adjustment or capacity record");
    const second = await rejects(() => requests.reviewCancellationRequest(eventId, current.id, { userId: staffTwoId }, { action: "DECLINE", reason: "Too late." }, now));
    assert(second?.code === "INVALID_TRANSITION", "a decided request cannot be decided again");
    const withdrawn = await rejects(() => requests.withdrawCancellationRequest(target, current.id, now));
    assert(withdrawn?.code === "INVALID_TRANSITION", "a decided request cannot be withdrawn");

    const decidedMail = await base.messageOutbox.findMany({ where: { eventId, templateKey: "CANCELLATION_REQUEST_UPDATED" } });
    assert(decidedMail.length >= 3 && decidedMail.every((message) => !message.bodyTextSnapshot.includes("Within the policy.") && !message.bodyTextSnapshot.includes(SECRET_REASON)), "status emails never carry a reason or a staff note");
    const audits = await base.auditLog.findMany({ where: { eventId, action: { startsWith: "CANCELLATION_REQUEST" } } });
    assert(audits.length >= 6 && audits.every((entry) => !stable(entry).includes(SECRET_REASON) && !stable(entry).includes("Within the policy.")), "audit entries hold ids only");
  }
  console.log("ok: staff review is named and reasoned, shows conflicts and capacity, and approving changes nothing else");

  // ---- Decline, withdraw, and a request after the deadline. ----
  {
    const late = new Date("2028-06-10T15:00:00.000Z");
    const fresh = await createRegistration();
    const freshTarget = { registrationId: fresh.registrationId, eventId };
    const lateProposal = await requests.previewRegistrantRequest(freshTarget, { scope: "FULL_REGISTRATION" }, late);
    assert(lateProposal.afterDeadline && lateProposal.timingLabel === "After the deadline", "after the deadline the after-deadline terms are shown");
    const lateRequest = await requests.submitCancellationRequest(freshTarget, { via: "ATTENDEE_PORTAL", accountId: `${P}-account` }, input({ expectedRefundCents: lateProposal.refundCents }), late);
    assert(!lateRequest.duplicate, "a request after the deadline is accepted for review");
    await requests.reviewCancellationRequest(eventId, lateRequest.request.id, { userId: staffTwoId }, { action: "DECLINE", reason: "Outside the policy." }, late);
    const declined = await base.cancellationRequest.findUniqueOrThrow({ where: { id: lateRequest.request.id } });
    assert(declined.status === "DECLINED" && declined.requestedVia === "ATTENDEE_PORTAL" && declined.decidedByNameSnapshot === "Request Check Second Reviewer", "a denial is by a named person");

    const another = await createRegistration();
    const anotherTarget = { registrationId: another.registrationId, eventId };
    const toWithdraw = await requests.submitCancellationRequest(anotherTarget, { via: "MANAGE_LINK" }, input(), now);
    const stranger = await rejects(() => requests.withdrawCancellationRequest(target, toWithdraw.request.id, now));
    assert(stranger?.code === "REQUEST_NOT_FOUND", "another registration cannot withdraw this request");
    const withdrawn = await requests.withdrawCancellationRequest(anotherTarget, toWithdraw.request.id, now);
    assert(withdrawn.status === "WITHDRAWN", "the registrant withdraws");
    const again = await requests.withdrawCancellationRequest(anotherTarget, toWithdraw.request.id, now);
    assert(again.status === "WITHDRAWN", "withdrawing twice is harmless");
    const wrongAttendee = await rejects(() => requests.submitCancellationRequest(anotherTarget, { via: "MANAGE_LINK" }, input({ selection: { scope: "ATTENDEE", attendeeIds: [attendeeOne] } }), now));
    assert(wrongAttendee?.code === "CALCULATION_UNAVAILABLE", "an attendee from another registration cannot be chosen");
    const reopened = await requests.submitCancellationRequest(anotherTarget, { via: "MANAGE_LINK" }, input(), now);
    assert(!reopened.duplicate, "after withdrawing, the registrant can ask again");
  }
  console.log("ok: denial is named, withdrawal is the registrant's own, and a request after the deadline is reviewable");

  // ---- The queue. ----
  {
    const open = await requests.listCancellationRequests(eventId, "OPEN");
    assert(open.every((row) => ["REQUESTED", "UNDER_REVIEW", "INFORMATION_NEEDED"].includes(row.status)), "the default queue shows open requests only");
    const declined = await requests.listCancellationRequests(eventId, "DECLINED");
    assert(declined.length === 1 && declined[0].afterDeadline, "the declined filter shows the after-deadline denial");
    assert((await requests.listCancellationRequests(otherEventId, "OPEN")).length === 0, "another event's queue is empty");
  }
  console.log("ok: the queue is event-scoped");

  // ---- Deleting an event removes its requests despite the immutability trigger. ----
  {
    await policy.createPolicyVersion(deleteEventId, staffId, { rules: rules("2028-05-25"), effectiveFrom: "2028-01-10T12:00:00.000Z" }, now);
    const doomed = await createRegistration({ eventId: deleteEventId });
    await requests.submitCancellationRequest({ registrationId: doomed.registrationId, eventId: deleteEventId }, { via: "MANAGE_LINK" }, input(), now);
    assert((await base.cancellationRequest.count({ where: { eventId: deleteEventId } })) === 1, "a request exists before deleting");
    await removeEvent(deleteEventId);
    assert((await base.cancellationRequest.count({ where: { eventId: deleteEventId } })) === 0 && (await base.cancellationRequestEvent.count({ where: { eventId: deleteEventId } })) === 0, "the event's requests and timeline are removed with it");
    assert(!(await base.event.findUnique({ where: { id: deleteEventId } })), "the event itself is gone");
  }
  console.log("ok: deleting an event removes its request history");
}

main()
  .then(async () => {
    await cleanup();
    console.log("Cancellation request verification passed.");
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => base.$disconnect());
