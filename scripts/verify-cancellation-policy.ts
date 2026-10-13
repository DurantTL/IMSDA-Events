/**
 * Proves cancellation policy slice 1 (#169) against a real PostgreSQL database. No network, no credentials, no money:
 * every row is fictitious, created here and removed here.
 *
 * - Versioned rules per event: sequential versions, parallel saves each get their own number, a version cannot take
 *   effect in the past, and the database itself rejects any UPDATE or DELETE of a version or a recorded calculation.
 * - The version in effect is chosen by time: a calculation before a revision's effective date uses the old version, one
 *   after it uses the new one, and a calculation recorded earlier keeps its original policy, rules and facts.
 * - Camp Meeting rule against a real registration (priced lines, card fee, a staff discount, a reservation deposit
 *   payment, a partial refund and a paid merchandise order): the exact deadline boundary in the event's time zone, the
 *   refund minus the $10 fee before it, the forfeited deposit after it or on a first-night no-show, and one attendee
 *   removed with the deposit left on the registration.
 * - A preview reads only a registration of its own event, and a zero-dollar registration calculates without error.
 * - No calculation changes anything: registrations, attendees, payments, refunds, adjustments and merchandise orders
 *   are byte-identical before and after every preview and recorded calculation.
 * - Deleting an event removes its versions and calculations despite the immutability triggers.
 *
 *   npm run test:cancellation-policy
 */
import { loadEnvConfig } from "@next/env";
import { isDeepStrictEqual } from "node:util";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-cancellation-policy-synthetic-key-not-a-secret");
delete process.env.ALERT_WEBHOOK_URL;

const P = "cpl";
const adminId = `${P}_admin`;
const eventId = `${P}_event`;
const otherEventId = `${P}_other_event`;
const versionsEventId = `${P}_versions_event`;
const parallelEventId = `${P}_parallel_event`;
const startsWithP = { startsWith: `${P}_` };

const base = new PrismaClient();
// The policy modules reach the database through the global client, so this is the one they use.
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
  for (const id of [eventId, otherEventId, versionsEventId, parallelEventId, `${P}_delete_event`]) await removeEvent(id);
  await base.person.deleteMany({ where: { id: startsWithP } });
  await base.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await base.user.deleteMany({ where: { id: adminId } });
}

function formDefinition() {
  return {
    title: "Cancellation policy check",
    description: "",
    confirmationMessage: "Received.",
    payment: {
      enabled: true,
      currency: "USD",
      paymentMethodFieldKey: "payment_method",
      cardOptionValue: "Credit / debit card",
      percentageBasisPoints: 290,
      fixedFeeCents: 30,
      passFeeToRegistrant: true,
      deposit: { enabled: true, amountCents: 6500, optionValue: "Pay a deposit now by card" },
    },
    sections: [{
      id: "payment-section",
      title: "Payment",
      description: "",
      fields: [{
        id: "payment-method", key: "payment_method", label: "Payment method", helpText: "", type: "RADIO", scope: "REGISTRATION",
        required: true, options: ["Pay later", "Pay a deposit now by card", "Credit / debit card"],
      }],
    }],
  };
}

let counter = 0;
let formVersionId = "";

type Fixture = { registrationId: string; code: string; attendeeIds: string[] };

/**
 * A registration of two attendees: each pays $200 to register, the first also has a $50 meal plan; there is a $12.00
 * card fee and a $20.00 staff discount (total $442.00). Payments: a $65.00 reservation deposit and a $300.00 payment
 * with $5.00 of it refunded, so $360.00 is net paid. A $25.00 merchandise order was paid separately.
 */
async function createFixture(options: { zeroDollar?: boolean } = {}): Promise<Fixture> {
  counter += 1;
  const code = `CPL${String(counter).padStart(4, "0")}`;
  const holder = await base.person.create({ data: { id: `${P}_holder_${counter}`, firstName: "Policy", lastName: `Holder${counter}`, normalizedEmail: `${P}-holder-${counter}@example.test` } });
  const registration = await base.registration.create({
    data: {
      eventId,
      accountHolderPersonId: holder.id,
      confirmationCode: code,
      totalAmount: options.zeroDollar ? 0 : 442,
      status: "CONFIRMED",
      submittedAt: new Date("2028-03-01T15:00:00Z"),
      contactSnapshot: { firstName: "Policy", lastName: `Holder${counter}`, email: `${P}-holder-${counter}@example.test`, phone: "" },
    },
  });
  const attendeeIds: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const person = await base.person.create({ data: { id: `${P}_att_${counter}_${index}`, firstName: `Attendee${index + 1}`, lastName: `Check${counter}`, normalizedEmail: `${P}-att-${counter}-${index}@example.test` } });
    const attendee = await base.registrationAttendee.create({
      data: { eventId, registrationId: registration.id, personId: person.id, attendeeType: "ADULT", position: index, profileSnapshot: { firstName: `Attendee${index + 1}`, lastName: `Check${counter}` } },
    });
    attendeeIds.push(attendee.id);
  }
  const lineItems = options.zeroDollar
    ? [{ key: "attendees.0.registration_fee", label: "Registration, Attendee1", amountCents: 0, attendeeIndex: 0 }]
    : [
        { key: "attendees.0.registration_fee", label: "Registration, Attendee1", amountCents: 20_000, attendeeIndex: 0 },
        { key: "attendees.0.meal_plan", label: "Meal plan, Attendee1", amountCents: 5000, attendeeIndex: 0 },
        { key: "attendees.1.registration_fee", label: "Registration, Attendee2", amountCents: 20_000, attendeeIndex: 1 },
      ];
  await base.publicRegistrationSubmission.create({
    data: {
      eventId, formVersionId, registrationId: registration.id, idempotencyKey: `${P}_idem_${counter}`, requestHash: "hash",
      responses: { payment_method: "Pay later" },
      pricingSnapshot: options.zeroDollar
        ? { currency: "USD", lineItems, subtotalCents: 0, processingFeeCents: 0, totalCents: 0 }
        : { currency: "USD", lineItems, subtotalCents: 45_000, processingFeeCents: 1200, totalCents: 46_200 },
    },
  });
  if (options.zeroDollar) return { registrationId: registration.id, code, attendeeIds };
  await base.registrationAdjustment.create({
    data: { eventId, registrationId: registration.id, kind: "DISCOUNT", amountCents: -2000, reason: "Synthetic discount", createdByNameSnapshot: "Check" },
  });
  await base.payment.create({ data: { eventId, registrationId: registration.id, amount: 65, status: "SUCCEEDED", method: "CHECK", isDeposit: true, receivedAt: new Date("2028-03-02T15:00:00Z") } });
  const second = await base.payment.create({ data: { eventId, registrationId: registration.id, amount: 300, status: "SUCCEEDED", method: "CHECK", receivedAt: new Date("2028-03-10T15:00:00Z") } });
  await base.refund.create({ data: { eventId, paymentId: second.id, amount: 5, status: "SUCCEEDED", reason: "Synthetic" } });
  const order = await base.merchandiseOrder.create({
    data: {
      eventId, registrationId: registration.id, purchaserSnapshot: {}, clientRequestId: `${P}_order_${counter}`, requestFingerprint: "fp",
      status: "PAID", subtotalCents: 2500, totalCents: 2500,
    },
  });
  await base.merchandiseOrderLine.create({
    data: {
      orderId: order.id, eventId, productNameSnapshot: "Synthetic shirt", variantLabelSnapshot: "M", unitPriceCentsSnapshot: 2500, quantity: 1,
      taxTreatmentSnapshot: "TAX_EXEMPT", feePolicySnapshot: "ABSORBED_BY_EVENT", lineTotalCents: 2500,
    },
  });
  return { registrationId: registration.id, code, attendeeIds };
}

/**
 * A $300.00 registration whose reservation deposit was paid by card, created the way the Square webhook does it: one
 * attempt for the deposit plus its card fee ($65.00 + $2.26 = $67.26), one payment of that amount marked as the deposit,
 * and the fee added to the registration total ($302.26).
 */
async function createCardDepositFixture(): Promise<Fixture> {
  counter += 1;
  const code = `CPL${String(counter).padStart(4, "0")}`;
  const holder = await base.person.create({ data: { id: `${P}_holder_${counter}`, firstName: "Card", lastName: `Deposit${counter}`, normalizedEmail: `${P}-card-${counter}@example.test` } });
  const registration = await base.registration.create({
    data: { eventId, accountHolderPersonId: holder.id, confirmationCode: code, totalAmount: 302.26, status: "CONFIRMED", submittedAt: new Date("2028-03-01T15:00:00Z"), contactSnapshot: {} },
  });
  const person = await base.person.create({ data: { id: `${P}_att_${counter}_0`, firstName: "Card", lastName: `Attendee${counter}`, normalizedEmail: `${P}-cardatt-${counter}@example.test` } });
  const attendee = await base.registrationAttendee.create({
    data: { eventId, registrationId: registration.id, personId: person.id, attendeeType: "ADULT", position: 0, profileSnapshot: { firstName: "Card", lastName: `Attendee${counter}` } },
  });
  await base.publicRegistrationSubmission.create({
    data: {
      eventId, formVersionId, registrationId: registration.id, idempotencyKey: `${P}_idem_${counter}`, requestHash: "hash", responses: { payment_method: "Pay a deposit now by card" },
      pricingSnapshot: { currency: "USD", lineItems: [{ key: "attendees.0.registration_fee", label: "Registration, Card", amountCents: 30_000, attendeeIndex: 0 }], subtotalCents: 30_000, processingFeeCents: 0, totalCents: 30_000 },
    },
  });
  const payment = await base.payment.create({
    data: { eventId, registrationId: registration.id, amount: 67.26, status: "SUCCEEDED", method: "CARD_REFERENCE", isDeposit: true, externalReference: `${P}_sq_${counter}`, receivedAt: new Date("2028-03-02T15:00:00Z") },
  });
  await base.paymentAttempt.create({
    data: {
      eventId, registrationId: registration.id, paymentId: payment.id, provider: "SQUARE", environment: "sandbox", clientIdempotencyKey: `${P}_client_${counter}`,
      providerIdempotencyKey: `${P}_provider_${counter}`, isDeposit: true, amountCents: 6726, surchargeCents: 226, status: "SUCCEEDED", completedAt: new Date("2028-03-02T15:00:00Z"),
    },
  });
  return { registrationId: registration.id, code, attendeeIds: [attendee.id] };
}

/** Everything a cancellation could change, so "nothing changed" is checked by content, not by count. */
async function moneyAndRegistrationState(registrationId: string) {
  const [registration, attendees, payments, refunds, adjustments, orders, reservations] = await Promise.all([
    base.registration.findUniqueOrThrow({ where: { id: registrationId } }),
    base.registrationAttendee.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
    base.payment.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
    base.refund.findMany({ where: { payment: { registrationId } }, orderBy: { id: "asc" } }),
    base.registrationAdjustment.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
    base.merchandiseOrder.findMany({ where: { registrationId }, orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }),
    base.registrationCapacityReservation.findMany({ where: { registrationId }, orderBy: { id: "asc" } }),
  ]);
  return stable({ registration, attendees, payments, refunds, adjustments, orders, reservations });
}

function campMeetingRules(deadline: string) {
  return {
    windows: [{
      id: "before-deadline", label: "Before the deadline", endsOn: deadline,
      terms: { refund: { kind: "FULL" }, flatWithholdCents: 1000, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: false },
    }],
    afterWindows: { label: "After the deadline", terms: { refund: { kind: "FULL" }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "FORFEIT", creditAllowed: false } },
    noShow: { label: "No-show on the first night", terms: { refund: { kind: "FULL" }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "FORFEIT", creditAllowed: false } },
    allowedScopes: ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"],
    supportedComponents: { categories: ["MEAL"], fieldKeys: [] },
    classifications: [{ category: "MEAL", fieldKeys: ["meal_plan"] }],
    nonrefundable: { categories: [], fieldKeys: [] },
    cardFeeTreatment: "REFUNDABLE",
  };
}

async function main() {
  const repo = await import("../modules/cancellation-policy/repository");
  const { windowClosesAt } = await import("../modules/cancellation-policy/event-time");

  await cleanup();
  await base.user.create({ data: { id: adminId, email: `${P}-admin@example.test`, displayName: "Cancellation Policy Check Admin", globalRole: "SYSTEM_ADMIN" } });
  for (const [id, slug] of [[eventId, "cpl-event-slug"], [otherEventId, "cpl-other-event-slug"], [versionsEventId, "cpl-versions-event-slug"], [parallelEventId, "cpl-parallel-event-slug"]] as const) {
    await base.event.create({
      data: {
        id, slug, name: `Cancellation policy check ${slug}`, timezone: "America/Chicago",
        startsAt: new Date("2028-07-13T15:00:00Z"), endsAt: new Date("2028-07-16T18:00:00Z"), isPublished: true, billingMode: "ATTENDEE_PAY",
      },
    });
  }
  const form = await base.registrationForm.create({ data: { eventId, createdByUserId: adminId, name: "Form", slug: "cpl-event-form" } });
  formVersionId = (await base.registrationFormVersion.create({
    data: { formId: form.id, createdByUserId: adminId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: formDefinition() },
  })).id;

  const now = new Date("2028-01-10T12:00:00.000Z");
  const request = (registration: string, scope: "FULL_REGISTRATION" | "ATTENDEE" | "COMPONENT" = "FULL_REGISTRATION", extra: { attendeeIds?: string[]; chargeIds?: string[]; noShowFirstNight?: boolean } = {}) => ({
    input: { kind: "REGISTRATION" as const, registration, noShowFirstNight: extra.noShowFirstNight ?? false },
    selection: { scope, ...(extra.attendeeIds ? { attendeeIds: extra.attendeeIds } : {}), ...(extra.chargeIds ? { chargeIds: extra.chargeIds } : {}) },
  });

  // ---- No policy yet: a calculation proposes nothing. ----
  const fixture = await createFixture();
  {
    const preview = await repo.previewCancellation(eventId, request(fixture.code), now);
    assert(preview.result.status === "NO_POLICY", "no policy version means no proposed outcome");
    assert(preview.result.money.refundCents === 0, "no policy proposes no refund");
  }
  console.log("ok: an event with no policy proposes nothing");

  // ---- Versions: sequential, parallel-safe, never in the past, immutable in the database. ----
  const v1 = await repo.createPolicyVersion(eventId, adminId, { rules: campMeetingRules("2028-05-25"), effectiveFrom: "2028-01-10T12:00:00.000Z", note: "Camp Meeting rule" }, now);
  assert(v1.version === 1, "the first version is 1");
  let pastRejected = false;
  try {
    await repo.createPolicyVersion(eventId, adminId, { rules: campMeetingRules("2028-05-25"), effectiveFrom: "2028-01-09T00:00:00.000Z" }, now);
  } catch (error) {
    pastRejected = (error as { code?: string }).code === "EFFECTIVE_DATE_IN_PAST";
  }
  assert(pastRejected, "a version cannot take effect in the past");
  let invalidRejected = false;
  try {
    await repo.createPolicyVersion(eventId, adminId, { rules: { windows: [] } }, now);
  } catch {
    invalidRejected = true;
  }
  assert(invalidRejected, "rules that do not parse are refused");
  const parallelRules = campMeetingRules("2028-06-01");
  const parallel = await Promise.all([
    repo.createPolicyVersion(parallelEventId, adminId, { rules: parallelRules, effectiveFrom: "2028-03-31T20:00:00.000Z", note: "parallel a" }, now),
    repo.createPolicyVersion(parallelEventId, adminId, { rules: parallelRules, effectiveFrom: "2028-03-31T20:00:00.000Z", note: "parallel b" }, now),
  ]);
  const numbers = parallel.map((version) => version.version).sort();
  assert(numbers[0] === 1 && numbers[1] === 2, `parallel saves get distinct versions, got ${numbers.join(",")}`);
  const listed = await repo.listPolicyVersions(eventId, now);
  assert(listed.versions.length === 1 && listed.inEffectVersionId === v1.id, "listing shows version 1 in effect");
  console.log("ok: versions are sequential, parallel-safe and never reach into the past");

  for (const [table, run] of [
    ["EventCancellationPolicyVersion update", () => base.eventCancellationPolicyVersion.updateMany({ where: { eventId }, data: { note: "tampered" } })],
    ["EventCancellationPolicyVersion delete", () => base.eventCancellationPolicyVersion.deleteMany({ where: { eventId } })],
  ] as const) {
    let rejected = false;
    try { await run(); } catch (error) { rejected = String(error).includes("immutable"); }
    assert(rejected, `${table} is rejected by the database`);
  }
  console.log("ok: the database rejects changing or deleting a policy version");

  // ---- Facts: the charge entries add up to the registration, and the deposit is read from the payment. ----
  const before = await moneyAndRegistrationState(fixture.registrationId);
  const beforeEvent = await repo.previewCancellation(eventId, request(fixture.code), new Date("2028-05-01T15:00:00.000Z"));
  {
    const { facts, lines } = beforeEvent.result;
    const registrationCharges = facts.charges.filter((entry) => entry.source !== "MERCHANDISE_ORDER");
    assert(registrationCharges.reduce((total, entry) => total + entry.amountCents, 0) === 44_200, "the charge entries add up to the registration total");
    assert(facts.depositCents === 6500 && facts.depositSource === "RECORDED_DEPOSIT", "the recorded deposit is read from the payment");
    assert(facts.registrationPaidCents === 36_000, "net paid is payments less refunds");
    assert(facts.charges.some((entry) => entry.source === "MERCHANDISE_ORDER" && entry.amountCents === 2500 && entry.settledSeparately), "the paid merchandise order is a charge entry");
    assert(lines.find((line) => line.label.startsWith("Meal plan"))?.category === "MEAL", "the meal plan field is classified as a meal");
    assert(beforeEvent.registration?.attendees.length === 2, "the preview lists the registration's own attendees");
  }

  // ---- Camp Meeting: before the deadline. ----
  {
    const { result } = beforeEvent;
    assert(result.status === "CALCULATED" && result.policy?.version === 1, "version 1 applies in May");
    assert(result.timing?.kind === "WINDOW", "May 1 is inside the window");
    assert(result.flatFee?.cents === 1000, "the $10 processing fee is withheld");
    // Paid 36,000 + 2,500 merchandise = 38,500; nothing stays charged; less the $10.00 fee.
    assert(result.money.paidCents === 38_500 && result.money.refundCents === 37_500, `refund is paid less the fee, got ${result.money.refundCents}`);
    assert(result.deposit.outcome === "REFUNDED", "the deposit is refunded before the deadline");
    assert(result.capacity.registrationCancelled && result.capacity.attendeesReleased.length === 2, "both seats would be released");
    assert(result.sideEffects.cancelled === false && result.sideEffects.refunded === false && result.sideEffects.creditCreated === false, "the result says nothing was done");
  }
  console.log("ok: before the deadline, a full refund minus the $10 fee");

  // ---- The exact boundary, in the event's own time zone. ----
  {
    const closes = windowClosesAt("2028-05-25", "America/Chicago");
    assert(closes.toISOString() === "2028-05-26T05:00:00.000Z", "May 25 closes at midnight Central (05:00Z)");
    const justBefore = await repo.previewCancellation(eventId, request(fixture.code), new Date(closes.getTime() - 1));
    const atBoundary = await repo.previewCancellation(eventId, request(fixture.code), closes);
    assert(justBefore.result.timing?.kind === "WINDOW" && justBefore.result.deposit.outcome === "REFUNDED", "1 ms before the boundary is still before the deadline");
    assert(atBoundary.result.timing?.kind === "AFTER_WINDOWS", "the boundary instant is after the deadline");
    // After the deadline: the deposit is forfeited and the reservation is cancelled.
    assert(atBoundary.result.deposit.outcome === "FORFEITED" && atBoundary.result.deposit.forfeitedCents === 6500, "the $65.00 deposit is forfeited");
    assert(atBoundary.result.money.refundCents === 32_000 && atBoundary.result.capacity.registrationCancelled, "paid money beyond the deposit stays refundable and the reservation is cancelled");
  }
  console.log("ok: the deadline boundary is exact in the event time zone, and the deposit is forfeited after it");

  // ---- First-night no-show. ----
  {
    const noShow = await repo.previewCancellation(eventId, request(fixture.code, "FULL_REGISTRATION", { noShowFirstNight: true }), new Date("2028-05-01T15:00:00.000Z"));
    assert(noShow.result.timing?.kind === "NO_SHOW" && noShow.result.deposit.outcome === "FORFEITED", "a first-night no-show forfeits the deposit");
  }

  // ---- One attendee removed, and one component. ----
  {
    const removed = await repo.previewCancellation(eventId, request(fixture.code, "ATTENDEE", { attendeeIds: [fixture.attendeeIds[1]!] }), new Date("2028-05-01T15:00:00.000Z"));
    const result = removed.result;
    assert(result.status === "CALCULATED" && result.scope?.effective === "ATTENDEE", "one attendee is calculated on its own");
    assert(result.deposit.outcome === "STAYS_WITH_REGISTRATION" && result.deposit.forfeitedCents === 0, "the deposit stays with the registration");
    assert(!result.capacity.registrationCancelled && result.capacity.attendeesReleased.length === 1, "one seat is released");
    assert(result.lines.filter((line) => line.treatment === "KEPT").length >= 2, "the other attendee's charges stay");
    assert(result.totals.inScopeCents + result.totals.keptChargesCents === result.totals.chargedCents, "cancelled plus kept equals charged");
    const all = await repo.previewCancellation(eventId, request(fixture.code, "ATTENDEE", { attendeeIds: [...fixture.attendeeIds].reverse() }), new Date("2028-05-01T15:00:00.000Z"));
    assert(all.result.scope?.effective === "FULL_REGISTRATION", "removing every attendee is cancelling the registration");
    const mealId = beforeEvent.registration?.charges.find((charge) => charge.label.startsWith("Meal plan"))?.id;
    assert(mealId, "the meal plan has a charge id");
    const meal = await repo.previewCancellation(eventId, request(fixture.code, "COMPONENT", { chargeIds: [mealId] }), new Date("2028-05-01T15:00:00.000Z"));
    assert(meal.result.status === "CALCULATED" && meal.result.capacity.componentsReleased.length === 1 && !meal.result.capacity.registrationCancelled, "a supported component is cancelled on its own");
    const feeId = beforeEvent.registration?.charges.find((charge) => charge.category === "REGISTRATION")?.id;
    const unsupported = await repo.previewCancellation(eventId, request(fixture.code, "COMPONENT", { chargeIds: [feeId as string] }), new Date("2028-05-01T15:00:00.000Z"));
    assert(unsupported.result.status === "COMPONENT_NOT_SUPPORTED", "a component the policy does not support is refused");
  }
  console.log("ok: attendee removal and component cancellation are distinct scopes");

  // ---- Revisions: the version in effect, and recorded calculations that never change. ----
  const recorded = await repo.recordCalculationAt(eventId, adminId, request(fixture.code), new Date("2028-03-15T15:00:00.000Z"));
  assert(recorded.result.policy?.version === 1, "the recorded calculation used version 1");
  const storedBefore = await base.cancellationCalculation.findUniqueOrThrow({ where: { id: recorded.id } });
  assert(storedBefore.policyVersion === 1 && storedBefore.registrationId === fixture.registrationId, "the record carries the version and registration");
  const v2r = await repo.createPolicyVersion(eventId, adminId, {
    rules: {
      ...campMeetingRules("2028-05-25"),
      windows: [{ id: "half", label: "Half refund", endsOn: "2028-05-25", terms: { refund: { kind: "PERCENT", percent: 50 }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: true } }],
      nonrefundable: { categories: ["MERCHANDISE"], fieldKeys: [] },
    },
    effectiveFrom: "2028-04-01T05:00:00.000Z",
    note: "Revision",
  }, new Date("2028-03-20T12:00:00.000Z"));
  assert(v2r.version === 2, "the revision is the next version");
  const early = await repo.previewCancellation(eventId, request(fixture.code), new Date("2028-03-31T12:00:00.000Z"));
  const late = await repo.previewCancellation(eventId, request(fixture.code), new Date("2028-04-02T12:00:00.000Z"));
  assert(early.result.policy?.version === 1 && early.result.money.refundCents === 37_500, "before the revision's effective date, version 1 still applies");
    assert(late.result.policy?.version === 2, `after the effective date, version 2 applies, got ${late.result.policy?.version}`);
  const merchandise = late.result.lines.find((line) => line.category === "MERCHANDISE");
  assert(merchandise?.treatment === "NONREFUNDABLE" && merchandise.withheldCents === 2500, "merchandise is nonrefundable under version 2");
  assert(late.result.creditOption.available, "version 2 allows future-event credit");
  const storedAfter = await base.cancellationCalculation.findUniqueOrThrow({ where: { id: recorded.id } });
  assert(stable(storedAfter) === stable(storedBefore), "the recorded calculation is unchanged by the revision");
  assert(isDeepStrictEqual((storedAfter.result as { policy: unknown }).policy, JSON.parse(stable(recorded.result.policy))), "it still holds the rules it was calculated with");
  for (const [name, run] of [
    ["update", () => base.cancellationCalculation.updateMany({ where: { id: recorded.id }, data: { status: "TAMPERED" } })],
    ["delete", () => base.cancellationCalculation.deleteMany({ where: { id: recorded.id } })],
  ] as const) {
    let rejected = false;
    try { await run(); } catch (error) { rejected = String(error).includes("immutable"); }
    assert(rejected, `the database rejects a ${name} of a recorded calculation`);
  }
  // A recorded calculation always uses server time, whatever a preview was asked.
  const asOf = await repo.recordCalculationAt(eventId, adminId, { ...request(fixture.code), asOf: "2028-04-02T00:00:00.000Z" } as Parameters<typeof repo.recordCalculationAt>[2], new Date("2028-03-16T12:00:00.000Z"));
  assert(asOf.result.clock === "SERVER" && asOf.result.evaluatedAt === "2028-03-16T12:00:00.000Z", "a recorded calculation ignores a preview 'as of' time");
  console.log("ok: revisions apply by effective date and never change a recorded calculation");

  // ---- Preview only reads its own event; zero-dollar registrations calculate. ----
  {
    const otherHolder = await base.person.create({ data: { id: `${P}_other_holder`, firstName: "Other", lastName: "Event", normalizedEmail: `${P}-other@example.test` } });
    const otherRegistration = await base.registration.create({
      data: { eventId: otherEventId, accountHolderPersonId: otherHolder.id, confirmationCode: "CPLOTHER1", totalAmount: 10, status: "CONFIRMED", contactSnapshot: {} },
    });
    for (const reference of [otherRegistration.id, "CPLOTHER1", "cplother1"]) {
      let notFound = false;
      try { await repo.previewCancellation(eventId, request(reference), now); } catch (error) { notFound = (error as { code?: string }).code === "REGISTRATION_NOT_FOUND"; }
      assert(notFound, `a registration of another event is not found (${reference})`);
    }
    const zero = await createFixture({ zeroDollar: true });
    const preview = await repo.previewCancellation(eventId, request(zero.code), new Date("2028-05-01T15:00:00.000Z"));
    assert(preview.result.status === "CALCULATED" && preview.result.money.refundCents === 0 && preview.result.money.retainedCents === 0, "a zero-dollar registration proposes $0");
    const synthetic = await repo.previewCancellation(eventId, {
      input: { kind: "SYNTHETIC", attendeeCount: 2, charges: [{ label: "Example", amountCents: 10_000, category: "REGISTRATION" }], paidCents: 10_000, depositCents: 0, noShowFirstNight: false },
      selection: { scope: "FULL_REGISTRATION" },
    }, new Date("2028-03-31T12:00:00.000Z"));
    assert(synthetic.registration === null && synthetic.result.facts.registration === null, "synthetic input has no registration behind it");
    assert(synthetic.result.status === "CALCULATED" && synthetic.result.money.refundCents === 9000, "synthetic input calculates ($100.00 paid, $10.00 fee withheld)");
  }
  console.log("ok: previews stay inside the event, and zero-dollar and synthetic input calculate");

  // ---- Staff meal orders: a charge then a credit is netted per selection, as the meal ledger posts them (#210). ----
  {
    const plan = await base.eventMealPlan.create({ data: { eventId, code: "cpl-plan", name: "Synthetic plan" } });
    let mealCounter = 0;
    /** A staff meal order the way the meal ledger records it: one selection, a MEAL adjustment per ledger entry. */
    async function staffMeal(fixture: Fixture, entries: number[]) {
      mealCounter += 1;
      const selection = await base.eventMealSelection.create({
        data: {
          eventId, planId: plan.id, mealType: "LUNCH", registrationId: fixture.registrationId, registrationAttendeeId: fixture.attendeeIds[0],
          ageGroup: "ADULT", quantity: 2, source: "STAFF", payer: "ATTENDEE", unitPriceCents: 1000, pricingSnapshot: {}, clientRequestId: `${P}_meal_${mealCounter}`,
        },
      });
      const change = await base.eventMealSelectionChange.create({ data: { eventId, selectionId: selection.id, type: "CREATED", actorName: "Check", after: {} } });
      let net = 0;
      for (const amountCents of entries) {
        const adjustment = await base.registrationAdjustment.create({
          data: { eventId, registrationId: fixture.registrationId, kind: "MEAL", amountCents, reason: "Synthetic staff meal order", registrationAttendeeId: fixture.attendeeIds[0], createdByNameSnapshot: "Check" },
        });
        const quantity = Math.abs(amountCents) / 1000;
        await base.eventMealLedgerEntry.create({
          data: {
            eventId, selectionId: selection.id, changeId: change.id, registrationId: fixture.registrationId, mealType: "LUNCH", ageGroup: "ADULT",
            kind: amountCents > 0 ? "CHARGE" : "CREDIT", quantity, unitPriceCents: 1000, amountCents, payer: "ATTENDEE", settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: adjustment.id,
          },
        });
        net += amountCents;
      }
      await base.registration.update({ where: { id: fixture.registrationId }, data: { totalAmount: 442 + net / 100 } });
      return selection.id;
    }

    const v3 = await repo.createPolicyVersion(eventId, adminId, {
      rules: { ...campMeetingRules("2028-05-25"), nonrefundable: { categories: ["MEAL"], fieldKeys: [] } },
      effectiveFrom: "2028-05-01T00:00:00.000Z",
      note: "Meals nonrefundable",
    }, new Date("2028-04-20T12:00:00.000Z"));
    assert(v3.version === 3, "meals policy is version 3");

    const baseline = await createFixture();
    const cancelled = await createFixture();
    await staffMeal(cancelled, [2000, -2000]);
    const reduced = await createFixture();
    const reducedSelection = await staffMeal(reduced, [2000, -1000]);

    // (a) meals nonrefundable (version 3, May) and (b) a 50% window (version 2, April): a meal charged and fully
    // credited leaves exactly the refund a registration with no meal has.
    for (const [name, at] of [["meals nonrefundable", "2028-05-02T12:00:00.000Z"], ["a 50% window", "2028-04-10T12:00:00.000Z"]] as const) {
      const none = (await repo.previewCancellation(eventId, request(baseline.code), new Date(at))).result;
      const netted = (await repo.previewCancellation(eventId, request(cancelled.code), new Date(at))).result;
      assert(!netted.lines.some((line) => line.category === "MEAL" && line.source === "ADJUSTMENT"), `a fully credited meal is not a charge (${name})`);
      assert(netted.money.refundCents === none.money.refundCents, `${name}: refund equals the registration with no meal (${netted.money.refundCents} vs ${none.money.refundCents})`);
      assert(!JSON.stringify(netted).includes("Synthetic staff meal order"), "the meal order's free text is not copied");
    }
    // A partial reduction is one meal charge for what is still ordered, attributed to the attendee.
    const at = new Date("2028-05-02T12:00:00.000Z");
    const partial = (await repo.previewCancellation(eventId, request(reduced.code), at)).result;
    const mealLine = partial.lines.find((line) => line.category === "MEAL" && line.source === "ADJUSTMENT");
    assert(mealLine?.chargeId === `meal:${reducedSelection}` && mealLine.amountCents === 1000 && mealLine.treatment === "NONREFUNDABLE" && mealLine.withheldCents === 1000 && mealLine.attendeeId === reduced.attendeeIds[0], "a partial reduction is one nonrefundable $10.00 meal charge for its attendee");
    // (c) COMPONENT scope: the netted meal can be chosen once; a meal netting to $0 is not a charge and cannot.
    const component = await repo.previewCancellation(eventId, request(reduced.code, "COMPONENT", { chargeIds: [`meal:${reducedSelection}`] }), at);
    assert(component.result.status === "CALCULATED" && component.result.lines.find((line) => line.chargeId === `meal:${reducedSelection}`)?.inScopeCents === 1000, "the netted meal is one component worth $10.00");
    const gone = await repo.previewCancellation(eventId, request(cancelled.code, "COMPONENT", { chargeIds: [`meal:${reducedSelection}`] }), at);
    assert(gone.result.status === "INVALID_SELECTION", "a meal that nets to $0 cannot be cancelled again");
    const others = await repo.previewCancellation(eventId, request(reduced.code, "ATTENDEE", { attendeeIds: [reduced.attendeeIds[1] as string] }), at);
    assert(others.result.lines.find((line) => line.category === "MEAL" && line.source === "ADJUSTMENT")?.treatment === "KEPT", "removing the other attendee keeps this attendee's meal charge");
  }
  console.log("ok: staff meal orders are netted per selection and follow the meal rules");

  // ---- A card deposit is forfeited without its card fee. ----
  {
    const card = await createCardDepositFixture();
    const afterDeadline = new Date("2028-06-10T15:00:00.000Z");
    const result = (await repo.previewCancellation(eventId, request(card.code), afterDeadline)).result;
    assert(result.facts.registrationPaidCents === 6726, "the card deposit payment is $67.26");
    assert(result.facts.depositCents === 6500 && result.facts.depositSource === "RECORDED_DEPOSIT", `the forfeitable deposit is $65.00, got ${result.facts.depositCents}`);
    assert(result.facts.charges.some((entry) => entry.source === "APPLIED_SURCHARGE" && entry.amountCents === 226), "the card fee on the deposit is its own charge entry");
    assert(result.deposit.forfeitedCents === 6500, "$65.00 is forfeited, not the $67.26 paid");
    assert(result.money.refundCents === 226, `the deposit's card fee follows the refundable card fee rule, got ${result.money.refundCents}`);
    assert(result.explanation.join(" ").includes("$65.00 reservation deposit is forfeited"), "the explanation shows the deposit amount");
    const beforeDeadline = (await repo.previewCancellation(eventId, request(card.code), new Date("2028-03-15T15:00:00.000Z"))).result;
    assert(beforeDeadline.money.refundCents === 5726, "before the deadline the whole $67.26 less the $10.00 fee comes back");
  }
  console.log("ok: a card deposit is forfeited without its card fee");

  // ---- Money by source, and nothing free-text in the record. ----
  {
    const sources = beforeEvent.result.money.bySource;
    assert(sources.length === 2 && sources[0]?.sourceId === "registration", "registration payments and the merchandise order are separate sources");
    assert(sources[0]?.refundCents === 35_000 && sources[1]?.refundCents === 2500, "the $10.00 fee comes out of registration money, never merchandise money");
    const text = JSON.stringify(beforeEvent.result);
    assert(!text.includes("Synthetic discount"), "an adjustment's free-text reason is not copied into the calculation");
    assert(beforeEvent.result.facts.charges.some((entry) => entry.id.startsWith("adjustment:") && entry.label === "Discount (adjustment)"), "an adjustment is stored by id and generic label");
  }
  console.log("ok: money is split by source and free text stays out of the record");

  // ---- A higher version supersedes lower ones; effective dates are clamped and ordered. ----
  {
    const t0 = new Date("2028-02-01T12:00:00.000Z");
    const rules = campMeetingRules("2028-05-25");
    const a = await repo.createPolicyVersion(versionsEventId, adminId, { rules }, t0);
    const b = await repo.createPolicyVersion(versionsEventId, adminId, { rules: campMeetingRules("2028-06-01"), effectiveFrom: "2029-06-01T00:00:00.000Z" }, t0);
    assert(a.version === 1 && b.version === 2, "versions 1 and 2 saved");
    let refused = false;
    try { await repo.createPolicyVersion(versionsEventId, adminId, { rules, effectiveFrom: "2029-01-01T00:00:00.000Z" }, t0); } catch (error) { refused = (error as { code?: string }).code === "EFFECTIVE_DATE_BEFORE_LATEST"; }
    assert(refused, "a future-dated version may not be earlier than the latest version's date");
    const c = await repo.createPolicyVersion(versionsEventId, adminId, { rules: campMeetingRules("2028-07-01") }, t0);
    assert(c.version === 3 && c.effectiveFrom === t0.toISOString(), "a correction taking effect now is allowed and stored as now");
    const slack = await repo.createPolicyVersion(versionsEventId, adminId, { rules, effectiveFrom: "2028-02-01T11:58:00.000Z" }, t0);
    assert(slack.effectiveFrom === t0.toISOString(), "an effective date within the slack is stored as now, never earlier");
    const request2 = { input: { kind: "SYNTHETIC" as const, attendeeCount: 1, charges: [{ label: "Example", amountCents: 100, category: "REGISTRATION" as const }], paidCents: 100, depositCents: 0, noShowFirstNight: false }, selection: { scope: "FULL_REGISTRATION" as const } };
    const during = await repo.previewCancellation(versionsEventId, request2, new Date("2028-03-01T12:00:00.000Z"));
    const later = await repo.previewCancellation(versionsEventId, request2, new Date("2030-01-01T12:00:00.000Z"));
    assert(during.result.policy?.version === 4 && later.result.policy?.version === 4, "the highest version in effect applies, and the old future-dated version 2 never retakes over");
  }
  console.log("ok: a higher version supersedes lower ones, and effective dates cannot reach back");

  // ---- Nothing was cancelled, refunded or credited by any of it. ----
  const after = await moneyAndRegistrationState(fixture.registrationId);
  assert(after === before, "no registration, attendee, payment, refund, adjustment, merchandise order or reservation changed");
  const calculations = await base.cancellationCalculation.count({ where: { eventId } });
  assert(calculations === 2, `only the two recorded calculations exist, found ${calculations}`);
  console.log("ok: no calculation changed a registration, a payment or any money record");

  // ---- Deleting an event removes its versions and calculations despite the triggers. ----
  {
    const deleteEventId = `${P}_delete_event`;
    await base.event.create({ data: { id: deleteEventId, slug: "cpl-delete-event", name: "Cancellation policy delete check", timezone: "America/Chicago", startsAt: new Date("2028-07-13T15:00:00Z"), endsAt: new Date("2028-07-16T18:00:00Z") } });
    await repo.createPolicyVersion(deleteEventId, adminId, { rules: campMeetingRules("2028-05-25"), effectiveFrom: "2028-01-10T12:00:00.000Z" }, now);
    await repo.recordCalculationAt(deleteEventId, adminId, {
      input: { kind: "SYNTHETIC", attendeeCount: 1, charges: [{ label: "Example", amountCents: 100, category: "REGISTRATION" }], paidCents: 100, depositCents: 0, noShowFirstNight: false },
      selection: { scope: "FULL_REGISTRATION" },
    }, new Date("2028-03-01T12:00:00.000Z"));
    await removeEvent(deleteEventId);
    assert((await base.eventCancellationPolicyVersion.count({ where: { eventId: deleteEventId } })) === 0, "the event's versions are removed with it");
    assert((await base.cancellationCalculation.count({ where: { eventId: deleteEventId } })) === 0, "the event's calculations are removed with it");
    assert(!(await base.event.findUnique({ where: { id: deleteEventId } })), "the event itself is gone");
  }
  console.log("ok: deleting an event removes its policy history");
}

main()
  .then(async () => {
    await cleanup();
    console.log("Cancellation policy verification passed.");
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => base.$disconnect());
