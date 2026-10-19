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
 * - Carrying out an approved request (#171) is a named staff action that applies exactly the approved snapshot: it stops
 *   when the registration changed since approval; cancels through the existing path and offers freed seats to the waitlist
 *   once; refunds through a mocked Square (one idempotency key per leg, a retry never pays twice, never more than approved)
 *   or records the refund through the existing manual path; keeps every payment and registration row; survives two parallel
 *   presses with one refund; and sends status emails from committed facts only. No real Square call is ever made.
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
const capEventId = `${P}_cap_event`;
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
  await base.auditLog.deleteMany({ where: { OR: [{ eventId: { in: [eventId, otherEventId, deleteEventId, capEventId] } }, { actorUserId: { in: [staffId, staffTwoId] } }] } });
  // Events whose registrations cite another event's form version go first.
  for (const id of [capEventId, deleteEventId, otherEventId, eventId]) await removeEvent(id);
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
async function createRegistration(options: { eventId?: string; card?: boolean; waitlisted?: boolean } = {}) {
  counter += 1;
  const event = options.eventId ?? eventId;
  const code = `CRQ${String(counter).padStart(4, "0")}`;
  const holder = await base.person.create({ data: { id: `${P}_holder_${counter}`, firstName: "Request", lastName: `Holder${counter}`, normalizedEmail: `${P}-holder-${counter}@example.test` } });
  const registration = await base.registration.create({
    data: {
      eventId: event, accountHolderPersonId: holder.id, confirmationCode: code, totalAmount: 400, status: options.waitlisted ? "WAITLISTED" : "CONFIRMED", submittedAt: new Date("2028-03-01T15:00:00Z"),
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
  if (options.waitlisted) {
    await base.registrationWaitlistEntry.create({ data: { eventId: event, registrationId: registration.id, position: 1, attendeeCount: 2, status: "WAITING" } });
  } else if (options.card) {
    const payment = await base.payment.create({ data: { eventId: event, registrationId: registration.id, amount: 400, status: "SUCCEEDED", method: "CARD_REFERENCE", externalReference: `${P}_sqpay_${counter}`, receivedAt: new Date("2028-03-02T15:00:00Z") } });
    await base.paymentAttempt.create({
      data: {
        eventId: event, registrationId: registration.id, paymentId: payment.id, provider: "SQUARE", environment: "sandbox", clientIdempotencyKey: `${P}_client_${counter}`, providerIdempotencyKey: `${P}_provider_${counter}`,
        amountCents: 40_000, status: "SUCCEEDED", providerPaymentId: `${P}_sqpay_${counter}`,
      },
    });
  } else {
    await base.payment.create({ data: { eventId: event, registrationId: registration.id, amount: 100, status: "SUCCEEDED", method: "CHECK", receivedAt: new Date("2028-03-02T15:00:00Z") } });
    await base.payment.create({ data: { eventId: event, registrationId: registration.id, amount: 300, status: "SUCCEEDED", method: "CHECK", receivedAt: new Date("2028-03-10T15:00:00Z") } });
  }
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

/** Every registration, waitlist entry, operation and capacity reservation of the whole event, so "nothing else changed" covers other registrations too. */
async function eventWideState() {
  const [registrations, waitlist, operations, reservations] = await Promise.all([
    base.registration.findMany({ where: { eventId }, orderBy: { id: "asc" } }),
    base.registrationWaitlistEntry.findMany({ where: { eventId }, orderBy: { id: "asc" } }),
    base.registrationOperation.findMany({ where: { eventId }, orderBy: { id: "asc" } }),
    base.registrationCapacityReservation.findMany({ where: { eventId }, orderBy: { id: "asc" } }),
  ]);
  return stable({ registrations, waitlist, operations, reservations });
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
  for (const [id, slug] of [[eventId, "crq-event-slug"], [otherEventId, "crq-other-event-slug"], [deleteEventId, "crq-delete-event-slug"], [capEventId, "crq-cap-event-slug"]] as const) {
    await base.event.create({
      data: {
        id, slug, name: `Cancellation request check ${slug}`, timezone: "America/Chicago",
        startsAt: new Date("2028-07-13T15:00:00Z"), endsAt: new Date("2028-07-16T18:00:00Z"), isPublished: true, billingMode: "ATTENDEE_PAY",
        ...(id === capEventId ? { capacity: 2, waitlistEnabled: true, autoPromoteWaitlist: true } : {}),
      },
    });
  }
  const form = await base.registrationForm.create({ data: { eventId, createdByUserId: staffId, name: "Form", slug: "crq-event-form" } });
  formVersionId = (await base.registrationFormVersion.create({
    data: { formId: form.id, createdByUserId: staffId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: { title: "Check", description: "", confirmationMessage: "Received.", sections: [{ id: `${P}_contact`, title: "Contact", description: "", fields: [{ id: `${P}_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: false, options: [] }] }] } },
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
    const eventStateBeforeDecision = await eventWideState();
    await requests.reviewCancellationRequest(eventId, current.id, { userId: staffId }, { action: "APPROVE", reason: "Within the policy.", acknowledgeChanges: true }, now);
    const approved = await base.cancellationRequest.findUniqueOrThrow({ where: { id: current.id } });
    assert(approved.status === "APPROVED" && approved.decidedByUserId === staffId && approved.decidedByNameSnapshot === "Request Check Finance" && approved.decisionReason === "Within the policy." && approved.decidedWithChanges, "the approval records the named person, the reason and the acknowledgement");
    assert((await moneyAndRegistrationState(registration.registrationId)) === stateBeforeDecision, "approving changed no registration, attendee, payment, refund, adjustment or capacity record");
    assert((await eventWideState()) === eventStateBeforeDecision, "approving changed no registration, waitlist entry, registration operation or capacity reservation anywhere in the event");

    // A decided request is final in the database, and so is what the timeline says about the decision.
    const rewrite = await rejects(() => base.cancellationRequest.updateMany({ where: { id: current.id }, data: { decisionReason: "Rewritten." } }));
    assert(rewrite && /final and cannot be changed/.test(String(rewrite.message)), "the database refuses any change to an approved request");
    const reopen = await rejects(() => base.$executeRaw`UPDATE "CancellationRequest" SET "status" = 'REQUESTED' WHERE "id" = ${current.id}`);
    assert(reopen && /final and cannot be changed/.test(String(reopen.message)), "the database refuses to reopen a decided request");
    const decisionStep = (overrides: Record<string, unknown>) => base.cancellationRequestEvent.create({
      data: { eventId, requestId: current.id, toStatus: "APPROVED", actorKind: "STAFF", actorUserId: staffId, actorNameSnapshot: "Named", note: "A reason.", ...overrides } as never,
    });
    for (const [label, overrides] of [
      ["by the registrant", { actorKind: "REGISTRANT" }],
      ["by the system", { actorKind: "SYSTEM" }],
      ["with no named person", { actorUserId: null }],
      ["with no reason", { note: "  " }],
      ["with a null reason", { note: null }],
    ] as const) {
      const refused = await rejects(() => decisionStep(overrides));
      assert(refused && /decision_by_named_staff/.test(String(refused.message)), `the timeline refuses an approval ${label}`);
    }
    const refusedDecline = await rejects(() => decisionStep({ toStatus: "DECLINED", actorKind: "SYSTEM" }));
    assert(refusedDecline && /decision_by_named_staff/.test(String(refusedDecline.message)), "the timeline refuses a denial by the system");
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

  // ---- A status that repeats is emailed again. ----
  {
    const repeat = await createRegistration();
    const repeatTarget = { registrationId: repeat.registrationId, eventId };
    const asked = await requests.submitCancellationRequest(repeatTarget, { via: "MANAGE_LINK" }, input(), now);
    const act = (action: Record<string, unknown>) => requests.reviewCancellationRequest(eventId, asked.request.id, { userId: staffId }, action as never, now);
    await act({ action: "REQUEST_INFORMATION", registrantNote: "First question." });
    await act({ action: "START_REVIEW" });
    await act({ action: "REQUEST_INFORMATION", registrantNote: "Second question." });
    const updates = await base.messageOutbox.findMany({ where: { registrationId: repeat.registrationId, templateKey: "CANCELLATION_REQUEST_UPDATED" } });
    const labels = updates.map((message) => (message.metadata as { status?: string }).status).sort();
    assert(labels.join() === "INFORMATION_NEEDED,INFORMATION_NEEDED,UNDER_REVIEW", `each step is emailed, including the repeated status, got ${labels.join()}`);
  }
  console.log("ok: a repeated status is emailed each time");

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

  // ---- Carrying out an approved request (#171). ----
  {
    const execution = await import("../modules/cancellation-execution/repository");
    const squareConfiguration = {
      environment: "sandbox" as const, applicationId: "sandbox-sq0idb-synthetic", locationId: "SYNTHLOC", accessToken: "synthetic-token-not-a-secret",
      apiUrl: "https://connect.squareupsandbox.com", apiVersion: "2026-07-15", scriptUrl: "", webhookSignatureKey: "synthetic", webhookNotificationUrl: "https://example.test/hook",
      paymentConfigured: true, webhookConfigured: true, issue: null,
    };

    /** A stand-in for Square: it keeps refunds by idempotency key like the real one, so a repeated key returns the first refund. */
    function squareMock() {
      const refunds = new Map<string, { id: string; status: string; payment_id: string; amount_money: { amount: number; currency: string } }>();
      const calls: Array<{ url: string; key: string; paymentId: string; amount: number }> = [];
      const behavior = { loseResponseOnce: false, rejectOnce: false, serverErrorOnce: false, declineOnce: false };
      let serial = 0;
      const fetcher = (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { idempotency_key: string; payment_id: string; amount_money: { amount: number; currency: string } };
        calls.push({ url, key: body.idempotency_key, paymentId: body.payment_id, amount: body.amount_money.amount });
        if (behavior.rejectOnce) {
          behavior.rejectOnce = false;
          return new Response(JSON.stringify({ errors: [{ code: "REFUND_AMOUNT_INVALID", detail: "Synthetic: the amount is not allowed." }] }), { status: 400 });
        }
        if (behavior.serverErrorOnce) {
          behavior.serverErrorOnce = false;
          return new Response(JSON.stringify({ errors: [{ code: "INTERNAL_SERVER_ERROR", detail: "Synthetic." }] }), { status: 500 });
        }
        let refund = refunds.get(body.idempotency_key);
        if (!refund) {
          serial += 1;
          refund = { id: `${P}_sqrefund_${serial}_${Date.now()}`, status: behavior.declineOnce ? "REJECTED" : "PENDING", payment_id: body.payment_id, amount_money: body.amount_money };
          refunds.set(body.idempotency_key, refund);
        }
        if (behavior.declineOnce) behavior.declineOnce = false;
        if (behavior.loseResponseOnce) {
          behavior.loseResponseOnce = false;
          throw new TypeError("Synthetic network failure after Square accepted the refund");
        }
        return new Response(JSON.stringify({ refund }), { status: 200 });
      }) as unknown as typeof fetch;
      return { fetcher, calls, refunds, behavior };
    }

    const square = squareMock();
    const callCount = () => square.calls.length;
    const refundCount = () => square.refunds.size;
    const deps = { squareConfiguration, squareFetcher: square.fetcher, now };
    const stubPort = {
      check: async () => ({ code: null }),
      remove: async (input: { registrationId: string; attendeeIds: readonly string[] }) => {
        await base.registrationAttendee.deleteMany({ where: { id: { in: [...input.attendeeIds] }, registrationId: input.registrationId } });
        return { code: null, pendingMessageIds: [] as string[] };
      },
    };
    const carry = (event: string, requestId: string, method?: "SQUARE" | "OFFLINE", userId = staffId, extra: Record<string, unknown> = {}) =>
      execution.carryOutCancellation(event, requestId, { userId }, { confirm: true, ...(method ? { method } : {}) }, { ...deps, ...extra } as typeof deps);
    const ask = async (reg: { registrationId: string; eventId: string }, selection: Record<string, unknown>, refundCents: number) => {
      counter += 1;
      const asked = await requests.submitCancellationRequest(
        { registrationId: reg.registrationId, eventId: reg.eventId },
        { via: "MANAGE_LINK" },
        { action: "submit", selection: selection as never, reason: SECRET_REASON, contactMethod: "EMAIL", idempotencyKey: `${P}-exec-${String(counter).padStart(6, "0")}`, expectedRefundCents: refundCents },
        now,
      );
      return asked.request.id;
    };
    const approve = (event: string, requestId: string, acknowledgeChanges = false) =>
      requests.reviewCancellationRequest(event, requestId, { userId: staffId }, { action: "APPROVE", reason: "Approved to carry out.", acknowledgeChanges }, now);
    const paymentsState = async (registrationId: string) => stable(await base.payment.findMany({ where: { registrationId }, orderBy: { id: "asc" } }));
    const refundRows = (registrationId: string) => base.refund.findMany({ where: { payment: { registrationId } }, orderBy: { createdAt: "asc" } });
    const mailCount = (registrationId: string, templateKey: string) => base.messageOutbox.count({ where: { registrationId, templateKey: templateKey as never } });

    // -- Only an approved request, only a named person, only this event. --
    const open = await createRegistration();
    const openRequestId = await ask(open, { scope: "FULL_REGISTRATION" }, 39_000);
    assert((await rejects(() => carry(eventId, openRequestId, "OFFLINE")))?.code === "NOT_APPROVED", "a request that is not approved cannot be carried out");
    await approve(eventId, openRequestId);
    assert((await rejects(() => carry(eventId, openRequestId, "OFFLINE", `${P}_nobody`)))?.code === "ACTOR_REQUIRED", "carrying out needs a named person");
    assert((await rejects(() => carry(otherEventId, openRequestId, "OFFLINE")))?.code === "REQUEST_NOT_FOUND", "another event's staff cannot carry it out");
    assert((await rejects(() => carry(eventId, openRequestId)))?.code === "METHOD_REQUIRED", "money to refund needs a chosen method");
    assert((await rejects(() => carry(eventId, openRequestId, "SQUARE")))?.code === "REFUND_NOT_AVAILABLE", "check payments cannot be refunded through Square");
    assert((await rejects(() => carry(eventId, openRequestId, "SQUARE", staffId, { squareConfiguration: { ...squareConfiguration, paymentConfigured: false } })))?.code === "SQUARE_NOT_CONFIGURED", "Square must be configured");
    assert((await base.cancellationExecution.count({ where: { eventId } })) === 0 && callCount() === 0, "every refusal left nothing started and called no processor");
    const stillOpen = await base.registration.findUniqueOrThrow({ where: { id: open.registrationId } });
    assert(stillOpen.status === "CONFIRMED" && (await refundRows(open.registrationId)).length === 0, "every refusal left the registration and its money alone");
    const approvedRow = await base.cancellationRequest.findUniqueOrThrow({ where: { id: openRequestId } });
    assert(approvedRow.approvedStateFingerprint === approvedRow.stateFingerprint, "an approval records the state it was approved against");
    console.log("ok: carrying out needs an approved request, a named person, this event and a working method");

    // -- Whole registration, refund recorded outside Square (check payments). --
    {
      const paymentsBefore = await paymentsState(open.registrationId);
      const attendeesBefore = await base.registrationAttendee.count({ where: { registrationId: open.registrationId } });
      const done = await carry(eventId, openRequestId, "OFFLINE");
      assert(done.status === "COMPLETED" && done.cancelStatus === "DONE" && done.legs.length === 2 && done.legs.every((leg) => leg.status === "DONE"), `completed with two done refund legs, got ${done.status}`);
      assert(done.legs.reduce((total, leg) => total + leg.amountCents, 0) === 39_000, "the refund is exactly the approved $390.00");
      const cancelled = await base.registration.findUniqueOrThrow({ where: { id: open.registrationId } });
      assert(cancelled.status === "CANCELLED" && cancelled.cancelledAt !== null && Number(cancelled.totalAmount) === 400, "the registration is cancelled and keeps its total");
      assert((await base.registrationAttendee.count({ where: { registrationId: open.registrationId } })) === attendeesBefore, "attendee history is kept");
      assert((await paymentsState(open.registrationId)) === paymentsBefore, "the original payments are untouched");
      const refunds = await refundRows(open.registrationId);
      assert(refunds.length === 2 && refunds.every((refund) => refund.status === "SUCCEEDED" && refund.idempotencyKey?.startsWith("cxr-")), "each refund is a new row with its leg's key");
      const legs = await base.cancellationExecutionRefund.findMany({ where: { executionId: done.id }, orderBy: { amountCents: "desc" } });
      assert(legs.length === 2 && legs[0].amountCents === 30_000 && legs[1].amountCents === 9_000, "the newest payment is refunded first, then the rest");
      assert(legs.every((leg) => refunds.some((refund) => refund.id === leg.refundId && refund.idempotencyKey === leg.idempotencyKey)), "each leg points at its refund and key");
      assert(await mailCount(open.registrationId, "REFUND_NOTICE") === 2 && await mailCount(open.registrationId, "REGISTRATION_CANCELLED") === 1, "the refund notices and the cancellation email are queued once each");
      const mails = await base.messageOutbox.findMany({ where: { registrationId: open.registrationId, templateKey: { in: ["REFUND_NOTICE", "REGISTRATION_CANCELLED"] } } });
      assert(mails.every((mail) => !mail.bodyTextSnapshot.includes(SECRET_REASON) && !mail.bodyTextSnapshot.includes("Approved to carry out.")), "no email carries a reason");
      const cancelledMail = mails.find((mail) => mail.templateKey === "REGISTRATION_CANCELLED")!;
      assert(cancelledMail.bodyTextSnapshot.includes("Your registration has been cancelled at your request") && !cancelledMail.bodyTextSnapshot.includes("did not automatically refund") && !cancelledMail.bodyTextSnapshot.includes("you receive a separate refund notice"), "the one cancellation email is neutral about money: never that nothing was refunded, never a promise of a notice");
      const audits = await base.auditLog.findMany({ where: { OR: [{ entityType: { startsWith: "CancellationExecution" } }, { action: "REFUND_RECORDED", eventId }] } });
      assert(audits.length >= 5 && audits.every((entry) => !stable(entry).includes(SECRET_REASON) && !stable(entry).includes("Request Check Finance") && !stable(entry).includes("Approved to carry out.")), "audit entries hold ids and amounts only");
      const requestRow = await base.cancellationRequest.findUniqueOrThrow({ where: { id: openRequestId } });
      assert(requestRow.status === "APPROVED" && stable(requestRow) === stable(approvedRow), "the decided request row was not touched");

      // Pressing it again changes nothing.
      const mailBefore = await base.messageOutbox.count({ where: { eventId } });
      const again = await carry(eventId, openRequestId, "OFFLINE");
      assert(again.status === "COMPLETED" && again.attempts === done.attempts, "a completed execution is returned as it is");
      assert((await refundRows(open.registrationId)).length === 2 && (await base.messageOutbox.count({ where: { eventId } })) === mailBefore, "a repeat refunds nothing and sends nothing");

      // The database holds the line too.
      const execRow = await base.cancellationExecution.findUniqueOrThrow({ where: { id: done.id } });
      const overRefund = await rejects(() => base.cancellationExecutionRefund.create({ data: { eventId, executionId: execRow.id, paymentId: legs[0].paymentId, amountCents: 1, idempotencyKey: `${P}-over-${Date.now()}` } }));
      assert(overRefund && /cannot add up to more than the approved refund/.test(String(overRefund.message)), "the database refuses refund legs above the approved amount");
      const rewriteApproved = await rejects(() => base.$executeRaw`UPDATE "CancellationExecution" SET "approvedRefundCents" = 99999 WHERE "id" = ${execRow.id}`);
      assert(rewriteApproved && /approved snapshot of a cancellation execution cannot be changed/.test(String(rewriteApproved.message)), "the database refuses a change to the approved snapshot");
      const changeLeg = await rejects(() => base.$executeRaw`UPDATE "CancellationExecutionRefund" SET "amountCents" = 1 WHERE "id" = ${legs[0].id}`);
      assert(changeLeg && /cannot be changed/.test(String(changeLeg.message)), "the database refuses a change to a leg's amount");
      const reopenLeg = await rejects(() => base.$executeRaw`UPDATE "CancellationExecutionRefund" SET "status" = 'PENDING' WHERE "id" = ${legs[0].id}`);
      assert(reopenLeg && /cannot be reopened/.test(String(reopenLeg.message)), "the database refuses to reopen a completed leg");
      const second = await rejects(() => base.cancellationExecution.create({ data: { eventId, requestId: openRequestId, registrationId: open.registrationId, scope: "FULL_REGISTRATION", approvedRefundCents: 0, approvedStateFingerprint: "x", executedByUserId: staffId, executedByNameSnapshot: "Named" } }));
      assert(second?.code === "P2002", "the database refuses a second execution for one request");
      const unapprovedRequestId = await ask(await createRegistration(), { scope: "FULL_REGISTRATION" }, 39_000);
      const unapproved = await base.cancellationRequest.findUniqueOrThrow({ where: { id: unapprovedRequestId } });
      const noApproval = await rejects(() => base.cancellationExecution.create({ data: { eventId, requestId: unapproved.id, registrationId: unapproved.registrationId, scope: "FULL_REGISTRATION", approvedRefundCents: 0, approvedStateFingerprint: "x", executedByUserId: staffId, executedByNameSnapshot: "Named" } }));
      assert(noApproval && /only be carried out from an approved request/.test(String(noApproval.message)), "the database refuses an execution for a request that is not approved");
    }
    console.log("ok: a whole registration is cancelled and refunded outside Square exactly as approved, once, with history intact");

    // -- Two staff press "Carry out" at the same moment. --
    {
      const reg = await createRegistration();
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      const results = await Promise.allSettled([carry(eventId, requestId, "OFFLINE"), carry(eventId, requestId, "OFFLINE", staffTwoId)]);
      assert(results.every((result) => result.status === "fulfilled"), `both presses succeed, got ${results.map((result) => result.status === "rejected" ? String(result.reason) : result.status).join()}`);
      const refunds = await refundRows(reg.registrationId);
      assert(refunds.length === 2 && refunds.reduce((total, refund) => total + Math.round(Number(refund.amount) * 100), 0) === 39_000, "parallel presses make one set of refunds, $390.00 in all");
      assert((await base.cancellationExecution.count({ where: { requestId } })) === 1 && await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 1 && await mailCount(reg.registrationId, "REFUND_NOTICE") === 2, "one execution, one cancellation email, two refund notices");
    }
    console.log("ok: a double press makes one refund");

    // -- The registration changed after approval: stop. --
    {
      const reg = await createRegistration();
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      await base.payment.create({ data: { eventId, registrationId: reg.registrationId, amount: 25, status: "SUCCEEDED", method: "CASH", receivedAt: new Date("2028-03-20T15:00:00Z") } });
      const stale = await rejects(() => carry(eventId, requestId, "OFFLINE")) as { code?: string; detail?: { conflicts?: Array<{ code: string }> } } | null;
      assert(stale?.code === "RE_REVIEW_REQUIRED", `changed facts stop it for re-review, got ${stale?.code}`);
      assert((await base.cancellationExecution.count({ where: { requestId } })) === 0 && (await refundRows(reg.registrationId)).length === 0, "nothing was started or refunded");
      assert((await base.registration.findUniqueOrThrow({ where: { id: reg.registrationId } })).status === "CONFIRMED", "the registration was not cancelled");
    }
    // An approval made after acknowledging a change is carried out against the state it was approved against.
    {
      const reg = await createRegistration();
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      const payment = await base.payment.findFirstOrThrow({ where: { registrationId: reg.registrationId, amount: 100 } });
      await base.refund.create({ data: { eventId, paymentId: payment.id, amount: 10, status: "SUCCEEDED", reason: "Synthetic" } });
      await approve(eventId, requestId, true);
      const saved = await base.cancellationRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert(saved.decidedWithChanges && saved.approvedStateFingerprint && saved.approvedStateFingerprint !== saved.stateFingerprint, "the approval recorded the changed state it was approved against");
      const done = await carry(eventId, requestId, "OFFLINE");
      assert(done.status === "COMPLETED" && done.legs.reduce((total, leg) => total + leg.amountCents, 0) === 39_000, "it is carried out against the approved state, refunding what is left to refund");
      // An approval from before this step recorded a state cannot be proven unchanged when changes were acknowledged.
      const legacy = await createRegistration();
      const legacyRequestId = await ask(legacy, { scope: "FULL_REGISTRATION" }, 39_000);
      const legacyPayment = await base.payment.findFirstOrThrow({ where: { registrationId: legacy.registrationId, amount: 100 } });
      await base.refund.create({ data: { eventId, paymentId: legacyPayment.id, amount: 10, status: "SUCCEEDED", reason: "Synthetic" } });
      await approve(eventId, legacyRequestId, true);
      // No code path edits an approved row (the database refuses), so the "recorded before #171" state is built at creation.
      await base.$executeRaw`ALTER TABLE "CancellationRequest" DISABLE TRIGGER "CancellationRequest_final_once_decided"`;
      try {
        await base.$executeRaw`UPDATE "CancellationRequest" SET "approvedStateFingerprint" = NULL WHERE "id" = ${legacyRequestId}`;
      } finally {
        await base.$executeRaw`ALTER TABLE "CancellationRequest" ENABLE TRIGGER "CancellationRequest_final_once_decided"`;
      }
      assert((await rejects(() => carry(eventId, legacyRequestId, "OFFLINE")))?.code === "RE_REVIEW_REQUIRED", "an approval over changes with no recorded state is sent for re-review");
    }
    console.log("ok: changed facts force re-review; an acknowledged approval is carried out against its own state");

    // -- Through Square (mocked): pending, confirmed by the processor, never twice. --
    {
      const reg = await createRegistration({ card: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      const first = await carry(eventId, requestId, "SQUARE");
      assert(callCount() === 1 && square.calls[0].amount === 39_000 && square.calls[0].url.endsWith("/v2/refunds"), "one Square refund request for the approved amount");
      assert(square.calls[0].paymentId.startsWith(`${P}_sqpay_`), "it names the original Square payment");
      assert(first.status === "PROCESSOR_PENDING" && first.cancelStatus === "DONE" && first.legs[0].withProcessor, `waiting for Square after cancelling, got ${first.status}`);
      assert((await base.registration.findUniqueOrThrow({ where: { id: reg.registrationId } })).status === "CANCELLED", "the registration is cancelled");
      const [refund] = await refundRows(reg.registrationId);
      const leg = await base.cancellationExecutionRefund.findFirstOrThrow({ where: { executionId: first.id } });
      assert(refund.status === "PENDING" && refund.idempotencyKey === leg.idempotencyKey && refund.externalReference === leg.providerRefundId && square.calls[0].key === leg.idempotencyKey, "a pending refund row with the leg's key and Square's refund id");
      assert(await mailCount(reg.registrationId, "REFUND_NOTICE") === 0, "no refund notice until Square confirms");
      assert(await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 1, "the cancellation email goes with the cancellation, not with a later press");
      const checked = await carry(eventId, requestId);
      assert(callCount() === 1 && checked.status === "PROCESSOR_PENDING", "checking the status does not ask Square for another refund");
      // Square's own confirmation arrives through the existing refund webhook, which marks the refund done.
      await base.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED" } });
      const finished = await carry(eventId, requestId);
      assert(finished.status === "COMPLETED" && finished.legs[0].status === "DONE" && callCount() === 1, "once Square confirms, it is completed without another request");
      assert(await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 1, "and no second cancellation email follows when the refund settles");
      assert(!(await base.messageOutbox.findFirstOrThrow({ where: { registrationId: reg.registrationId, templateKey: "REGISTRATION_CANCELLED" } })).bodyTextSnapshot.includes("did not automatically refund"), "and it does not say nothing was refunded");
      assert((await rejects(() => carry(eventId, requestId, "OFFLINE")))?.code === "METHOD_FIXED", "the method cannot change once started");
      assert((await refundRows(reg.registrationId)).length === 1, "one refund in all");
    }
    // A response lost after Square accepted the refund: the retry reuses the key and Square returns the same refund.
    {
      const reg = await createRegistration({ card: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      const callsBefore = callCount();
      const refundsBefore = refundCount();
      square.behavior.loseResponseOnce = true;
      const failed = await carry(eventId, requestId, "SQUARE");
      assert(failed.status === "FAILED" && failed.cancelStatus === "DONE" && failed.legs[0].failureCode === "SQUARE_UNCERTAIN" && failed.legs[0].canResend, `a lost response fails the refund after cancelling, got ${failed.status}`);
      assert((await refundRows(reg.registrationId)).length === 0 && (await base.registration.findUniqueOrThrow({ where: { id: reg.registrationId } })).status === "CANCELLED", "the cancellation stands and no refund is recorded yet");
      const retried = await carry(eventId, requestId);
      assert(callCount() === callsBefore + 2 && square.calls[callsBefore].key === square.calls[callsBefore + 1].key, "the retry sends the same idempotency key");
      assert(refundCount() === refundsBefore + 1, "Square made one refund in all");
      assert(retried.status === "PROCESSOR_PENDING" && (await refundRows(reg.registrationId)).length === 1, "the retry recorded the one refund");
    }
    // A server error is uncertain and retried with the same key.
    {
      const reg = await createRegistration({ card: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      square.behavior.serverErrorOnce = true;
      const errored = await carry(eventId, requestId, "SQUARE");
      assert(errored.status === "FAILED" && errored.legs[0].failureCode === "SQUARE_UNCERTAIN" && errored.canContinue, "a server error is uncertain and retryable");
      const sent = await carry(eventId, requestId);
      assert(sent.status === "PROCESSOR_PENDING" && (await refundRows(reg.registrationId)).length === 1, "the second try is accepted once");
      assert(new Set(square.calls.slice(-2).map((call) => call.key)).size === 1, "both tries used the same key");
    }
    // Square rejects the request outright: stuck, never resent, (the reservation of its amount is released).
    {
      const reg = await createRegistration({ card: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      square.behavior.rejectOnce = true;
      const rejected = await carry(eventId, requestId, "SQUARE");
      assert(rejected.status === "FAILED" && rejected.legs[0].failureCode?.startsWith("SQUARE_REJECTED") === true, "a refusal is a failed refund");
      assert(!rejected.canContinue && rejected.canResolve && !rejected.legs[0].canResend, "a rejected refund is not resent: it waits for a person");
      const before = callCount();
      await carry(eventId, requestId);
      assert(callCount() === before, "pressing again does not send the rejected refund again");
      const resolved = await execution.resolveOutsideTool(eventId, requestId, { userId: staffId }, { confirm: true, note: "Refunded in the Square dashboard by hand." }, { now });
      assert(resolved.status === "COMPLETED" && resolved.legs[0].resolved && resolved.legs[0].resolvedByName === "Request Check Finance", "a named person's note completes it");
      assert(callCount() === before && (await refundRows(reg.registrationId)).length === 0, "resolving moved no money and wrote no refund");
    }
    // Square answers 200 but declined the refund, after the registration was cancelled.
    {
      const reg = await createRegistration({ card: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      square.behavior.declineOnce = true;
      const declined = await carry(eventId, requestId, "SQUARE");
      assert(declined.status === "FAILED" && declined.cancelStatus === "DONE" && declined.legs[0].failureCode === "PROVIDER_DECLINED", `a declined refund fails after cancelling, got ${declined.status}`);
      assert(!declined.canContinue && declined.canResolve && !declined.legs[0].canResend, "it cannot be resent, and a person can resolve it");
      assert((await base.registration.findUniqueOrThrow({ where: { id: reg.registrationId } })).status === "CANCELLED", "the cancellation stands");
      const [row] = await refundRows(reg.registrationId);
      assert(row.status === "FAILED", "the declined refund is recorded as failed");
      assert(await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 1 && await mailCount(reg.registrationId, "REFUND_NOTICE") === 0, "the cancellation email was sent once with the cancellation; no refund notice for a refund that did not happen");
      const before = callCount();
      await carry(eventId, requestId);
      assert(callCount() === before, "pressing again does not resend a declined refund");
      assert((await rejects(() => execution.resolveOutsideTool(eventId, requestId, { userId: `${P}_nobody` }, { confirm: true, note: "Settled by hand." })))?.code === "ACTOR_REQUIRED", "resolving needs a named person");
      const done = await execution.resolveOutsideTool(eventId, requestId, { userId: staffTwoId }, { confirm: true, note: "Customer was refunded by check from the office." }, { now });
      assert(done.status === "COMPLETED" && done.legs[0].resolved && done.legs[0].resolutionNote?.includes("by check"), "recording it completes the execution");
      assert((await refundRows(reg.registrationId)).length === 1 && callCount() === before, "resolving made no refund and called no processor");
      assert(await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 1 && await mailCount(reg.registrationId, "REFUND_NOTICE") === 0, "resolving sends nothing more: no second cancellation email, no refund notice for a refund that never happened");
      const audit = await base.auditLog.findFirstOrThrow({ where: { action: "CANCELLATION_REFUND_RESOLVED_OUTSIDE_TOOL", metadata: { path: ["requestId"], equals: requestId } } });
      assert(audit.actorUserId === staffTwoId && !stable(audit).includes("by check") && (audit.metadata as { moneyMoved?: boolean }).moneyMoved === false, "the audit entry names the person and holds ids and amounts only");
      assert((await rejects(() => execution.resolveOutsideTool(eventId, requestId, { userId: staffId }, { confirm: true, note: "Again by hand." })))?.code === "NOTHING_TO_RESOLVE", "there is nothing left to resolve");
      const legRow = await base.cancellationExecutionRefund.findFirstOrThrow({ where: { executionId: done.id } });
      const rewrite = await rejects(() => base.$executeRaw`UPDATE "CancellationExecutionRefund" SET "resolutionNote" = 'Edited' WHERE "id" = ${legRow.id}`);
      assert(rewrite && /resolved cancellation refund cannot be changed/.test(String(rewrite.message)), "a resolution cannot be rewritten");
      const renamed = await rejects(() => base.$executeRaw`UPDATE "CancellationExecutionRefund" SET "resolvedByNameSnapshot" = 'Someone Else' WHERE "id" = ${legRow.id}`);
      assert(renamed && /resolved cancellation refund cannot be changed/.test(String(renamed.message)), "the resolver's recorded name cannot be rewritten");
      const doneLeg = await base.cancellationExecutionRefund.findFirstOrThrow({ where: { execution: { requestId: openRequestId } } });
      const noNote = await rejects(() => base.$executeRaw`UPDATE "CancellationExecutionRefund" SET "resolvedAt" = now(), "resolvedByUserId" = ${staffId} WHERE "id" = ${doneLeg.id}`);
      assert(noNote && /resolution_is_named/.test(String(noNote.message)), "the database refuses a resolution with no note, name or failed refund");
    }
    // Square reports the refund failed (webhook) after the registration was cancelled.
    {
      const reg = await createRegistration({ card: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, requestId);
      const pending = await carry(eventId, requestId, "SQUARE");
      assert(pending.status === "PROCESSOR_PENDING", "waiting for Square");
      const [row] = await refundRows(reg.registrationId);
      await base.refund.update({ where: { id: row.id }, data: { status: "FAILED" } });
      const before = callCount();
      const failed = await carry(eventId, requestId);
      assert(failed.status === "FAILED" && failed.legs[0].failureCode === "PROVIDER_FAILED" && !failed.canContinue && failed.canResolve, "a failed refund after cancelling waits for a person");
      assert(callCount() === before, "it is not sent again");
      const done = await execution.resolveOutsideTool(eventId, requestId, { userId: staffId }, { confirm: true, note: "Handled in the Square dashboard." }, { now });
      assert(done.status === "COMPLETED" && await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 1, "recording it completes the execution without a second cancellation email");
    }
    // A waitlisted registration gets the waitlist notice only; no cancellation email.
    {
      const reg = await createRegistration({ waitlisted: true });
      const requestId = await ask(reg, { scope: "FULL_REGISTRATION" }, 0);
      await approve(eventId, requestId);
      const done = await carry(eventId, requestId);
      assert(done.status === "COMPLETED" && done.legs.length === 0, "a waitlisted registration with nothing to refund completes");
      assert(await mailCount(reg.registrationId, "WAITLIST_REMOVED") === 1 && await mailCount(reg.registrationId, "REGISTRATION_CANCELLED") === 0, "it gets the waitlist-removal notice only");
      await carry(eventId, requestId);
      assert(await mailCount(reg.registrationId, "WAITLIST_REMOVED") === 1, "repeating sends nothing more");
    }
    // Two approved requests on one registration, pressed at the same moment: one execution, one set of refunds.
    {
      const reg = await createRegistration();
      const first = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, first);
      const second = await ask(reg, { scope: "ATTENDEE", attendeeIds: [reg.attendeeIds[0]] }, 19_000);
      await approve(eventId, second);
      const results = await Promise.allSettled([
        carry(eventId, first, "OFFLINE"),
        carry(eventId, second, "OFFLINE", staffTwoId, { attendeeRemoval: stubPort }),
      ]);
      const ok = results.filter((result) => result.status === "fulfilled");
      const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      assert(ok.length === 1 && refused.length === 1, `exactly one runs, got ${results.map((result) => result.status).join()}`);
      assert(["RE_REVIEW_REQUIRED", "ANOTHER_EXECUTION_IN_PROGRESS"].includes((refused[0].reason as { code?: string }).code ?? ""), `the other is refused, got ${(refused[0].reason as { code?: string }).code}`);
      const total = (await refundRows(reg.registrationId)).reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
      assert(total === 39_000 || total === 19_000, `one request's refunds only, got ${total}`);
      assert((await base.cancellationExecution.count({ where: { registrationId: reg.registrationId } })) === 1, "one execution on the registration");
    }
    // An unfinished execution blocks another request on the same registration.
    {
      const reg = await createRegistration({ card: true });
      const first = await ask(reg, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(eventId, first);
      const second = await ask(reg, { scope: "ATTENDEE", attendeeIds: [reg.attendeeIds[0]] }, 19_000);
      await approve(eventId, second);
      const started = await carry(eventId, first, "SQUARE");
      assert(started.status === "PROCESSOR_PENDING", "the first is waiting for Square");
      const before = callCount();
      assert((await rejects(() => carry(eventId, second, "SQUARE", staffId, { attendeeRemoval: stubPort })))?.code === "ANOTHER_EXECUTION_IN_PROGRESS", "the second waits for the first to finish");
      assert(callCount() === before && (await base.cancellationExecution.count({ where: { requestId: second } })) === 0, "nothing was sent or started for it");
      const [row] = await refundRows(reg.registrationId);
      await base.refund.update({ where: { id: row.id }, data: { status: "SUCCEEDED" } });
      assert((await carry(eventId, first)).status === "COMPLETED", "the first completes");
      assert((await rejects(() => carry(eventId, second, "SQUARE", staffId, { attendeeRemoval: stubPort })))?.code === "RE_REVIEW_REQUIRED", "then the second is sent for re-review, because the registration changed");
    }
    console.log("ok: Square refunds use one key per leg, stay pending until confirmed, and a retry never pays twice");

    // -- Freed seats are offered to the waitlist, once. --
    {
      await policy.createPolicyVersion(capEventId, staffId, { rules: rules("2028-05-25"), effectiveFrom: "2028-01-10T12:00:00.000Z" }, now);
      const holder = await createRegistration({ eventId: capEventId });
      const waiting = await createRegistration({ eventId: capEventId, waitlisted: true });
      const requestId = await ask({ registrationId: holder.registrationId, eventId: capEventId }, { scope: "FULL_REGISTRATION" }, 39_000);
      await approve(capEventId, requestId);
      assert((await base.registration.findUniqueOrThrow({ where: { id: waiting.registrationId } })).status === "WAITLISTED", "the waitlisted registration is waiting");
      await carry(capEventId, requestId, "OFFLINE");
      const promoted = await base.registration.findUniqueOrThrow({ where: { id: waiting.registrationId }, include: { waitlistEntry: true } });
      assert(promoted.status !== "WAITLISTED" && promoted.waitlistEntry?.status === "PROMOTED", `the freed seats went to the waitlist, got ${promoted.status}`);
      await carry(capEventId, requestId, "OFFLINE");
      assert((await base.registrationWaitlistEntry.count({ where: { eventId: capEventId, status: "PROMOTED" } })) === 1, "repeating it promotes no one else");
    }
    console.log("ok: capacity and the waitlist are released through the existing cancellation, once");

    // -- Approved attendees only: the refund first, then the removal. --
    {
      const reg = await createRegistration();
      const [removed, kept] = reg.attendeeIds;
      const requestId = await ask(reg, { scope: "ATTENDEE", attendeeIds: [removed] }, 19_000);
      await approve(eventId, requestId);
      const blocked = await rejects(() => carry(eventId, requestId, "OFFLINE", staffId, { attendeeRemoval: { ...stubPort, check: async () => ({ code: "RETAINED_AMOUNT_NEEDS_ADJUSTMENT", message: "Synthetic." }) } }));
      assert(blocked?.code === "ATTENDEES_NOT_REMOVABLE" && (await refundRows(reg.registrationId)).length === 0, "attendees that cannot be removed stop it before any refund");
      const done = await carry(eventId, requestId, "OFFLINE", staffId, { attendeeRemoval: stubPort });
      assert(done.status === "COMPLETED" && done.legs.reduce((total, leg) => total + leg.amountCents, 0) === 19_000, "the approved attendee's $190.00 is refunded and they are removed");
      const left = await base.registrationAttendee.findMany({ where: { registrationId: reg.registrationId } });
      assert(left.length === 1 && left[0].id === kept, "only the approved attendee was removed");
      assert((await base.registration.findUniqueOrThrow({ where: { id: reg.registrationId } })).status === "CONFIRMED", "the registration itself stays");
    }
    // Through Square the removal waits for the refund to finish.
    {
      const reg = await createRegistration({ card: true });
      const [removed] = reg.attendeeIds;
      const requestId = await ask(reg, { scope: "ATTENDEE", attendeeIds: [removed] }, 19_000);
      await approve(eventId, requestId);
      const pending = await carry(eventId, requestId, "SQUARE", staffId, { attendeeRemoval: stubPort });
      assert(pending.status === "PROCESSOR_PENDING" && pending.cancelStatus === "PENDING", "the attendee is not removed while Square has the refund");
      assert((await base.registrationAttendee.count({ where: { registrationId: reg.registrationId } })) === 2, "both attendees are still there");
      const [refund] = await refundRows(reg.registrationId);
      await base.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED" } });
      const finished = await carry(eventId, requestId, undefined, staffId, { attendeeRemoval: stubPort });
      assert(finished.status === "COMPLETED" && (await base.registrationAttendee.count({ where: { registrationId: reg.registrationId } })) === 1, "after Square confirms, the attendee is removed");
      assert(refundCount() >= 1 && (await refundRows(reg.registrationId)).length === 1, "one refund");
    }
    // A single priced item is not carried out here.
    {
      const reg = await createRegistration();
      const calc = await base.cancellationRequest.findFirstOrThrow({ where: { eventId }, select: { calculationId: true } });
      const stamp = `${P}-component-${Date.now()}`;
      const state = (await base.cancellationRequest.findFirstOrThrow({ where: { id: openRequestId } }));
      const component = await base.cancellationRequest.create({
        data: {
          eventId, registrationId: reg.registrationId, calculationId: calc.calculationId, scope: "COMPONENT", chargeIds: ["x"], scopeKey: "COMPONENT:x", reason: "x", contactMethod: "EMAIL", proposedRefundCents: 1_000, proposedRetainedCents: 0,
          stateFingerprint: state.stateFingerprint, registrationState: {}, requestedVia: "MANAGE_LINK", idempotencyKey: stamp,
        },
      });
      await approve(eventId, component.id, true);
      assert((await rejects(() => carry(eventId, component.id, "OFFLINE")))?.code === "SCOPE_NOT_SUPPORTED", "a single item is left for the allocation work");
    }
    console.log("ok: approved attendees are refunded then removed; items wait for the allocation work");
  }

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
