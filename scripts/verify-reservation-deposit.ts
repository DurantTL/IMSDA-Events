/**
 * Proves the reservation deposit (#415) against a real PostgreSQL database. No network, no credentials, no money:
 * the card side is a Square webhook handed to `processSquareWebhook`, the staff side is `recordManualPayment`.
 *
 * - A staff check deposit that commits while a card deposit's transaction has already read the registration but
 *   not yet taken the row lock: exactly one deposit counts. The card payment is retried by SERIALIZABLE, sees the
 *   check, and is held as a duplicate charge (payment kept PENDING, no fee on the total, no receipt).
 * - The same, the other way round: a card deposit that commits first makes a later staff deposit refuse.
 * - Real simultaneous races (no pause) leave exactly one counted deposit every time.
 * - A repeated staff deposit is refused and writes one audit row.
 * - A card deposit with its fee leaves the balance at the subtotal minus the deposit, and an amendment-style
 *   re-read of the applied fees (`appliedCardSurchargeCents`) returns the fee.
 *
 * The pause is a Prisma query extension on the global client that holds the card transaction at its row-lock
 * statement, after its first read. Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:reservation-deposit
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-reservation-deposit-synthetic-key-not-a-secret");
delete process.env.ALERT_WEBHOOK_URL;
Object.assign(process.env, {
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_APPLICATION_ID: "sandbox-sq0idb-synthetic",
  SQUARE_LOCATION_ID: "RDP-LOCATION",
  SQUARE_ACCESS_TOKEN: "synthetic-access-token",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "synthetic-signature-key",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://events.imsda.test/api/webhooks/square",
});
delete process.env.SQUARE_API_URL;

const P = "rdp";
const adminId = `${P}_admin`;
const eventId = `${P}_event`;
const startsWithP = { startsWith: `${P}_` };
const depositOption = "Pay a deposit now by card";

const base = new PrismaClient();
// What the pause holds: the first statement that takes the registration row lock after `arm()`.
const pause = {
  armed: false,
  reached: null as null | (() => void),
  release: null as null | Promise<void>,
};
// Every payment module reaches the database through the global client, so this is the client they all use.
(globalThis as unknown as { prisma?: unknown }).prisma = base.$extends({
  query: {
    async $queryRaw({ args, query }) {
      if (pause.armed && JSON.stringify(args).includes("FOR NO KEY UPDATE")) {
        pause.armed = false;
        pause.reached?.();
        await pause.release;
      }
      return query(args);
    },
  },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function arm() {
  let release!: () => void;
  pause.release = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { pause.reached = resolve; });
  pause.armed = true;
  return { reached, release };
}

async function cleanup() {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.registrationPaymentChoiceOperation.deleteMany({ where: { eventId: startsWithP } });
    await tx.event.deleteMany({ where: { id: startsWithP } });
  });
  await base.person.deleteMany({ where: { id: startsWithP } });
  await base.squareWebhookEvent.deleteMany({ where: { providerEventId: startsWithP } });
  await base.alertNotification.deleteMany({ where: { key: { startsWith: "payments.duplicate-charge.rdp" } } });
  await base.user.deleteMany({ where: { id: adminId } });
}

function formDefinition() {
  return {
    title: "Reservation deposit check",
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
      deposit: { enabled: true, amountCents: 6500, optionValue: depositOption },
    },
    sections: [{
      id: "payment-section",
      title: "Payment",
      description: "",
      fields: [{
        id: "payment-method",
        key: "payment_method",
        label: "Payment method",
        helpText: "",
        type: "RADIO",
        scope: "REGISTRATION",
        required: true,
        options: ["Pay later", depositOption, "Credit / debit card"],
      }],
    }],
  };
}

let formVersionId = "";
let counter = 0;

type Fixture = { registrationId: string; attemptId: string };

/** A $300.00 registration that chose the deposit, with a card deposit attempt of $65.00 + $2.26 fee in flight. */
async function createFixture(): Promise<Fixture> {
  counter += 1;
  const person = await base.person.create({
    data: { id: `${P}_person_${counter}`, firstName: "Deposit", lastName: `Check${counter}`, normalizedEmail: `${P}-${counter}@example.test` },
  });
  const registration = await base.registration.create({
    data: {
      eventId,
      accountHolderPersonId: person.id,
      confirmationCode: `RDP${String(counter).padStart(4, "0")}`,
      totalAmount: 300,
      status: "SUBMITTED",
      submittedAt: new Date(),
      contactSnapshot: { firstName: "Deposit", lastName: `Check${counter}`, email: `${P}-${counter}@example.test`, phone: "" },
    },
  });
  await base.publicRegistrationSubmission.create({
    data: {
      eventId,
      formVersionId,
      registrationId: registration.id,
      idempotencyKey: randomUUID(),
      requestHash: "hash",
      responses: { payment_method: depositOption },
      pricingSnapshot: { currency: "USD", subtotalCents: 30_000 },
    },
  });
  const attempt = await base.paymentAttempt.create({
    data: {
      eventId,
      registrationId: registration.id,
      provider: "SQUARE",
      environment: "sandbox",
      clientIdempotencyKey: randomUUID(),
      providerIdempotencyKey: `${P}_provider_${randomUUID()}`,
      activeRegistrationKey: registration.id,
      isDeposit: true,
      amountCents: 6726,
      surchargeCents: 226,
      status: "PROCESSING",
    },
  });
  return { registrationId: registration.id, attemptId: attempt.id };
}

let webhookCounter = 0;
function completedPayment(fixture: Fixture) {
  webhookCounter += 1;
  const at = new Date(Date.UTC(2028, 9, 13, 16, 0, webhookCounter % 60, 0)).toISOString();
  const paymentId = `${P}_pay_${webhookCounter}_${randomUUID()}`;
  return {
    event_id: `${P}_evt_${webhookCounter}_${randomUUID()}`,
    type: "payment.updated",
    created_at: at,
    data: {
      type: "payment",
      id: paymentId,
      object: {
        payment: {
          id: paymentId,
          status: "COMPLETED",
          reference_id: fixture.attemptId,
          location_id: "RDP-LOCATION",
          amount_money: { amount: 6726, currency: "USD" },
          created_at: at,
          updated_at: at,
        },
      },
    },
  };
}

async function main() {
  // Imported after the global client is replaced, so no module has captured another one.
  const { parseSquareWebhookEvent, squareWebhookPayloadHash } = await import("../modules/payments/square-domain");
  const { processSquareWebhook } = await import("../modules/payments/square-repository");
  const { recordManualPayment, PaymentOperationError } = await import("../modules/payments/repository");
  const { appliedCardSurchargeCents } = await import("../modules/payments/applied-surcharge");
  const configuration = (await import("../modules/payments/square-config")).getSquareConfiguration();

  async function cardWebhook(fixture: Fixture) {
    const raw = JSON.stringify(completedPayment(fixture));
    return processSquareWebhook(parseSquareWebhookEvent(JSON.parse(raw)), squareWebhookPayloadHash(raw), { configuration });
  }
  const staffDeposit = (fixture: Fixture) => recordManualPayment(eventId, fixture.registrationId, adminId, {
    amountCents: 6500, method: "CHECK", reference: "SYNTHETIC-1001", isDeposit: true,
  });
  async function state(fixture: Fixture) {
    const [registration, payments, duplicates, audits] = await Promise.all([
      base.registration.findUniqueOrThrow({ where: { id: fixture.registrationId } }),
      base.payment.findMany({ where: { registrationId: fixture.registrationId }, orderBy: { createdAt: "asc" } }),
      base.squareDuplicateCharge.findMany({ where: { registrationId: fixture.registrationId } }),
      base.auditLog.findMany({ where: { action: "RESERVATION_DEPOSIT_RECORDED", entityId: { in: (await base.payment.findMany({ where: { registrationId: fixture.registrationId }, select: { id: true } })).map((payment) => payment.id) } } }),
    ]);
    const counted = payments.filter((payment) => payment.status === "SUCCEEDED" && payment.isDeposit);
    return { registration, payments, duplicates, audits, counted };
  }

  await cleanup();
  await base.user.create({ data: { id: adminId, email: `${P}-admin@example.test`, displayName: "Reservation Deposit Check Admin", globalRole: "SYSTEM_ADMIN" } });
  await base.event.create({
    data: {
      id: eventId,
      slug: "rdp-event-slug",
      name: "Reservation deposit check",
      startsAt: new Date("2028-10-13T15:00:00Z"),
      endsAt: new Date("2028-10-15T18:00:00Z"),
      isPublished: true,
      billingMode: "ATTENDEE_PAY",
    },
  });
  const form = await base.registrationForm.create({ data: { eventId, createdByUserId: adminId, name: "Form", slug: "rdp-event-form" } });
  formVersionId = (await base.registrationFormVersion.create({
    data: { formId: form.id, createdByUserId: adminId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: formDefinition() },
  })).id;

  // ---- Card read first, staff check commits while the card transaction waits for the lock. ----
  {
    const fixture = await createFixture();
    const gate = arm();
    const card = cardWebhook(fixture);
    await gate.reached; // the card transaction has read (its snapshot is taken) and is about to lock
    await staffDeposit(fixture); // staff lock, write the check deposit, commit
    gate.release();
    await card;
    const result = await state(fixture);
    assert(result.counted.length === 1, `exactly one deposit counts, found ${result.counted.length}`);
    assert(result.counted[0]!.method === "CHECK", "the check recorded first is the deposit that counts");
    const card_ = result.payments.find((payment) => payment.method === "CARD_REFERENCE");
    assert(card_?.status === "PENDING", "the card payment is held PENDING, not counted");
    assert(result.duplicates.length === 1 && result.duplicates[0]!.reason === "DEPOSIT_ALREADY_RECORDED", "held as a duplicate charge for review");
    assert(Number(result.registration.totalAmount) === 300, "no card fee joined the total");
    assert(result.audits.length === 1, "one audit row for the check deposit");
    console.log("ok: check committed first, the late card deposit is held as a duplicate");
  }

  // ---- Card commits first, a later staff deposit is refused. ----
  {
    const fixture = await createFixture();
    await cardWebhook(fixture);
    const refused = await staffDeposit(fixture).then(() => null, (error: unknown) => error);
    assert(refused instanceof PaymentOperationError && refused.code === "DEPOSIT_ALREADY_RECORDED", "a second deposit is refused after a card deposit");
    const result = await state(fixture);
    assert(result.counted.length === 1 && result.counted[0]!.method === "CARD_REFERENCE", "the card deposit is the one that counts");
    assert(Number(result.registration.totalAmount) === 302.26, "the card fee on the deposit joined the total");
    assert(result.audits.length === 0, "no deposit audit row for the refused check");
    const paidCents = result.counted.reduce((total, payment) => total + Math.round(Number(payment.amount) * 100), 0);
    assert(Math.round(Number(result.registration.totalAmount) * 100) - paidCents === 23_500, "the balance is the subtotal minus the deposit");
    assert(await appliedCardSurchargeCents(base, fixture.registrationId) === 226, "the applied fee is what an amendment keeps");
    console.log("ok: card committed first, the later check is refused; balance is $235.00");
  }

  // ---- A repeated staff deposit is refused and audited once. ----
  {
    const fixture = await createFixture();
    await staffDeposit(fixture);
    const repeated = await staffDeposit(fixture).then(() => null, (error: unknown) => error);
    assert(repeated instanceof PaymentOperationError && repeated.code === "DEPOSIT_ALREADY_RECORDED", "a repeated staff deposit is refused");
    const result = await state(fixture);
    assert(result.counted.length === 1 && result.audits.length === 1, "one deposit and one audit row");
    console.log("ok: repeated staff deposit refused");
  }

  // ---- Real simultaneous races, no pause. ----
  for (let round = 1; round <= 6; round += 1) {
    const fixture = await createFixture();
    const outcomes = await Promise.allSettled([cardWebhook(fixture), staffDeposit(fixture)]);
    const result = await state(fixture);
    assert(result.counted.length === 1, `race ${round}: exactly one deposit counts, found ${result.counted.length}`);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        const error = outcome.reason as { code?: string };
        assert(error.code === "DEPOSIT_ALREADY_RECORDED" || error.code === "PAYMENT_CONFLICT" || error.code === "PAYMENT_OPERATION_CONFLICT", `race ${round}: an acceptable refusal, got ${String(error.code ?? outcome.reason)}`);
      }
    }
    const cardCounts = result.counted.some((payment) => payment.method === "CARD_REFERENCE");
    assert(cardCounts ? Number(result.registration.totalAmount) === 302.26 : Number(result.registration.totalAmount) === 300, `race ${round}: the fee is on the total only when the card deposit counts`);
  }
  console.log("ok: 6 simultaneous races leave exactly one counted deposit");
}

main()
  .then(async () => {
    await cleanup();
    console.log("Reservation deposit verification passed.");
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => base.$disconnect());
