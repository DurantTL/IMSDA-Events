/**
 * Proves the money lock on a Closed event against a real PostgreSQL database and a fake Square at the HTTP boundary (no
 * network, no credentials, no money), on a synthetic event that goes through the real closeout sign-off:
 *
 * - once the event is Closed, a manual payment, a refund and an attached Square payment are refused with EVENT_CLOSED and
 *   write nothing; a card attempt and a Pay on Square link are refused with the attendee message before Square is called
 *   and leave no attempt row;
 * - Square payments and refunds that arrive anyway (a payment webhook, a refund webhook) are recorded as usual and flagged
 *   once each (a replay under a new event id adds no payment, no refund and no second flag), the flag audit rows hold ids
 *   and cents only, and the closeout shows a blocking "Money recorded while closed" check and lists both;
 * - a flag can be marked reviewed while the event is Closed (a note is required and at most 500 characters, a second clear
 *   is refused, the database refuses a clear with no note) and is kept, never deleted;
 * - after a reopen, sign-off is refused while one flag is uncleared, and succeeds once both are marked reviewed; the lock
 *   is lifted while the event is open for reconciliation.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:closed-event-money
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { parseSquareWebhookEvent, squareWebhookPayloadHash } from "../modules/payments/square-domain";
import type { SquareRuntimeConfiguration } from "../modules/payments/square-config";
import { createAttendeeSquarePayment, processSquareWebhook, SquarePaymentOperationError } from "../modules/payments/square-repository";
import { createAttendeeSquarePaymentLink } from "../modules/payments/square-hosted-repository";
import { attachSquarePaymentToRegistration } from "../modules/payments/square-match-repository";
import { recordManualPayment, recordRefund } from "../modules/payments/repository";
import { getCloseoutView, reopenClosedEvent, signOffEvent, CloseoutError } from "../modules/events/closeout-repository";
import { clearClosedMoneyReview, ClosedMoneyReviewError } from "../modules/events/closed-event-money-reviews";
import { EVENT_CLOSED_ATTENDEE_MESSAGE, EVENT_CLOSED_STAFF_MESSAGE, EventClosedError } from "../modules/events/money-lock";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-closed-event-money-synthetic-key-not-a-secret");
delete process.env.ALERT_WEBHOOK_URL;
// Square is configured only through the explicit configuration below, so the closeout's own Square check is not called.
for (const name of Object.keys(process.env)) if (name.startsWith("SQUARE_")) delete process.env[name];

const prisma = new PrismaClient();
const P = `cem_${randomUUID().slice(0, 8)}`;
const eventId = `${P}_event`;
const finance = { userId: `${P}_finance`, permissions: ["MANAGE_FINANCE"] as const };
const LOCATION = `${P.toUpperCase()}-LOCATION`;
const configuration: SquareRuntimeConfiguration = {
  environment: "sandbox",
  applicationId: "sandbox-sq0idb-synthetic",
  locationId: LOCATION,
  accessToken: "synthetic-access-token",
  apiUrl: "https://connect.squareupsandbox.com",
  apiVersion: "2026-07-15",
  scriptUrl: "https://sandbox.web.squarecdn.com/v1/square.js",
  webhookSignatureKey: "synthetic-signature-key",
  webhookNotificationUrl: "https://events.imsda.test/api/webhooks/square",
  paymentConfigured: true,
  webhookConfigured: true,
  issue: null,
};
const appBaseUrl = "https://events.imsda.test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  try { await promise; return null; } catch (error) { return error; }
}

// ---------------------------------------------------------------------------------------------
// A fake Square at the HTTP boundary. Anything it does not know is refused. It counts the calls that could take money
// or hand out a link, so a refused attempt can be shown to have made none.
// ---------------------------------------------------------------------------------------------
const square = { linkCreates: 0, paymentCreates: 0, seq: 0, orders: new Map<string, string>() };
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";
  if (!url.startsWith("https://connect.squareupsandbox.com/")) throw new Error(`The fake Square refused a request to ${url}.`);
  const path = new URL(url).pathname;
  if (method === "POST" && path === "/v2/online-checkout/payment-links") {
    square.linkCreates += 1;
    square.seq += 1;
    return jsonResponse(200, { payment_link: { id: `${P}-LINK-${square.seq}`, version: 1, order_id: `${P}-ORDER-${square.seq}`, url: `https://sandbox.square.link/u/${P}-${square.seq}` } });
  }
  if (method === "POST" && path === "/v2/payments") {
    square.paymentCreates += 1;
    const body = JSON.parse(String(init?.body)) as { amount_money: { amount: number; currency: string }; reference_id: string };
    square.seq += 1;
    const now = new Date().toISOString();
    return jsonResponse(200, { payment: { id: `${P}-PAY-${square.seq}`, status: "COMPLETED", amount_money: body.amount_money, reference_id: body.reference_id, created_at: now, updated_at: now } });
  }
  if (method === "GET" && path.startsWith("/v2/payments/")) {
    const id = decodeURIComponent(path.split("/").pop()!);
    const now = new Date().toISOString();
    return jsonResponse(200, { payment: { id, status: "COMPLETED", amount_money: { amount: 4_000, currency: "USD" }, location_id: LOCATION, created_at: now, updated_at: now } });
  }
  if (method === "DELETE" && path.startsWith("/v2/online-checkout/payment-links/")) return jsonResponse(200, {});
  throw new Error(`The fake Square does not know ${method} ${path}.`);
}) as typeof fetch;

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
function formDefinition() {
  return {
    title: "Closed money check",
    description: "",
    confirmationMessage: "Received.",
    payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Credit / debit card", percentageBasisPoints: 290, fixedFeeCents: 30, passFeeToRegistrant: true },
    sections: [{
      id: "payment-section", title: "Payment", description: "",
      fields: [{ id: "payment-method", key: "payment_method", label: "Payment method", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Pay later", "Credit / debit card"] }],
    }],
  };
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { startsWith: P } }, { eventId: { startsWith: P } }] } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.registrationPaymentChoiceOperation.deleteMany({ where: { eventId: { startsWith: P } } });
    await tx.event.deleteMany({ where: { id: { startsWith: P } } });
  });
  await prisma.person.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.squareWebhookEvent.deleteMany({ where: { providerEventId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

let counter = 0;
let formVersionId = "";
async function createRegistration(totalCents: number, cashPaidCents = 0) {
  counter += 1;
  const person = await prisma.person.create({ data: { id: `${P}_person_${counter}`, firstName: "Sample", lastName: `Closed${counter}`, normalizedEmail: `${P}-${counter}@example.test` } });
  const registration = await prisma.registration.create({
    data: {
      eventId, accountHolderPersonId: person.id, confirmationCode: `CEM${String(counter).padStart(4, "0")}`, totalAmount: totalCents / 100, status: "CONFIRMED", submittedAt: new Date(),
      contactSnapshot: { firstName: "Sample", lastName: `Closed${counter}`, email: `${P}-${counter}@example.test`, phone: "" },
    },
  });
  await prisma.publicRegistrationSubmission.create({
    data: { eventId, formVersionId, registrationId: registration.id, idempotencyKey: randomUUID(), requestHash: "hash", responses: { payment_method: "Pay later" }, pricingSnapshot: { currency: "USD", subtotalCents: totalCents } },
  });
  const payment = cashPaidCents
    ? await prisma.payment.create({ data: { eventId, registrationId: registration.id, amount: cashPaidCents / 100, status: "SUCCEEDED", method: "CASH", receivedAt: new Date() }, select: { id: true } })
    : null;
  return { registrationId: registration.id, access: { registrationId: registration.id, eventId }, cashPaymentId: payment?.id ?? null };
}

let webhookCounter = 0;
async function sendWebhook(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  return processSquareWebhook(parseSquareWebhookEvent(JSON.parse(raw)), squareWebhookPayloadHash(raw), { configuration });
}
function paymentWebhook(orderId: string, paymentId: string, amountCents: number) {
  webhookCounter += 1;
  const at = new Date().toISOString();
  return {
    event_id: `${P}_evt_${webhookCounter}`, type: "payment.updated", created_at: at,
    data: { type: "payment", id: paymentId, object: { payment: { id: paymentId, status: "COMPLETED", order_id: orderId, location_id: LOCATION, amount_money: { amount: amountCents, currency: "USD" }, created_at: at, updated_at: at } } },
  };
}
function refundWebhook(paymentId: string, refundId: string, amountCents: number) {
  webhookCounter += 1;
  const at = new Date().toISOString();
  return {
    event_id: `${P}_evt_${webhookCounter}`, type: "refund.updated", created_at: at,
    data: { type: "refund", id: refundId, object: { refund: { id: refundId, status: "COMPLETED", payment_id: paymentId, location_id: LOCATION, amount_money: { amount: amountCents, currency: "USD" }, created_at: at, updated_at: at } } },
  };
}

const stateOf = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { lifecycleState: true } })).lifecycleState;
const counts = async () => ({
  payments: await prisma.payment.count({ where: { eventId } }),
  refunds: await prisma.refund.count({ where: { eventId } }),
  attempts: await prisma.paymentAttempt.count({ where: { eventId } }),
  audit: await prisma.auditLog.count({ where: { eventId, action: { in: ["MANUAL_PAYMENT_RECORDED", "REFUND_RECORDED", "SQUARE_PAYMENT_MANUALLY_MATCHED"] } } }),
});
const flags = () => prisma.closedEventMoneyReview.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });

async function signOff(acknowledgeWarnings = true) {
  const view = await getCloseoutView(eventId, { canReadText: true });
  assert(view, "the closeout view loads");
  return signOffEvent({ eventId, actor: finance, acknowledgeWarnings, expectedVersion: view.lifecycleVersion, seenOpenChecks: view.openChecks });
}

async function main() {
  await cleanup();
  try {
    await prisma.user.create({ data: { id: finance.userId, email: `${finance.userId}@example.test`, displayName: "Pat Finance", globalRole: "SYSTEM_ADMIN" } });
    const day = 86_400_000;
    await prisma.event.create({
      data: {
        id: eventId, slug: `${P.replace(/_/g, "-")}-slug`, name: "Closed Money Check Event", startsAt: new Date(Date.now() - 5 * day), endsAt: new Date(Date.now() - 4 * day),
        isPublished: true, lifecycleState: "FINANCIAL_RECONCILIATION", audience: "GENERAL", billingMode: "ATTENDEE_PAY", hostedPaymentLinkEnabled: true,
      },
    });
    const form = await prisma.registrationForm.create({ data: { eventId, createdByUserId: finance.userId, name: "Form", slug: `${P.replace(/_/g, "-")}-form` } });
    formVersionId = (await prisma.registrationFormVersion.create({
      data: { formId: form.id, createdByUserId: finance.userId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: formDefinition() },
    })).id;

    // Before the close: a card payment through the embedded form (refunded later), a Pay on Square link nobody has paid yet,
    // a cash payment, and two registrations that still owe.
    const cardPaid = await createRegistration(10_000);
    await createAttendeeSquarePayment(cardPaid.access, { sourceId: "cnon:synthetic-card-nonce", idempotencyKey: randomUUID() }, { configuration });
    const cardPayment = await prisma.payment.findFirstOrThrow({ where: { registrationId: cardPaid.registrationId, method: "CARD_REFERENCE" } });
    assert(cardPayment.status === "SUCCEEDED" && cardPayment.externalReference, "the card payment is recorded before the close");
    const linked = await createRegistration(10_000);
    await createAttendeeSquarePaymentLink(linked.access, { idempotencyKey: randomUUID(), returnId: "r".repeat(43) }, { configuration, appBaseUrl });
    const hosted = await prisma.squareHostedCheckout.findFirstOrThrow({ where: { registrationId: linked.registrationId, status: "ACTIVE" } });
    assert(hosted.providerOrderId, "the open link has Square's order id");
    const cashed = await createRegistration(5_000, 2_000);
    const owing = await createRegistration(4_000);

    // ---- The event is signed off and Closed. ----
    await signOff();
    assert(await stateOf() === "CLOSED", "the sign-off closes the event");
    const withdrawn = await prisma.squareHostedCheckout.findUniqueOrThrow({ where: { id: hosted.id } });
    assert(withdrawn.status === "INVALIDATED" && withdrawn.invalidationReason === "EVENT_CLOSED", "the sign-off withdraws the open Pay on Square link");

    // ---- 1. Staff, station and attendee paths refuse, and write nothing. ----
    const before = await counts();
    const linkCreatesBefore = square.linkCreates;
    const paymentCreatesBefore = square.paymentCreates;
    for (const [what, attempt] of [
      ["a manual payment", () => recordManualPayment(eventId, owing.registrationId, finance.userId, { amountCents: 1_000, method: "CASH", reference: "" })],
      ["a manual payment from a check-in station", () => recordManualPayment(eventId, owing.registrationId, finance.userId, { amountCents: 1_000, method: "CASH", reference: "", idempotencyKey: randomUUID() }, { station: { id: `${P}_station`, label: "Desk" } })],
      ["a refund", () => recordRefund(eventId, cashed.cashPaymentId!, finance.userId, { amountCents: 500, reason: "Synthetic", idempotencyKey: randomUUID() })],
      ["an attached Square payment", () => attachSquarePaymentToRegistration(eventId, owing.registrationId, finance.userId, { providerPaymentId: `${P}-EXTERNAL-1` }, { configuration })],
    ] as const) {
      const error = await caught(attempt());
      assert(error instanceof EventClosedError && error.code === "EVENT_CLOSED" && error.message === EVENT_CLOSED_STAFF_MESSAGE, `${what} is refused with EVENT_CLOSED and the staff message`);
    }
    const cardError = await caught(createAttendeeSquarePayment(owing.access, { sourceId: "cnon:synthetic-card-nonce", idempotencyKey: randomUUID() }, { configuration }));
    assert(cardError instanceof SquarePaymentOperationError && cardError.code === "EVENT_CLOSED" && cardError.message === EVENT_CLOSED_ATTENDEE_MESSAGE, "a card attempt is refused with the attendee message");
    const linkError = await caught(createAttendeeSquarePaymentLink(owing.access, { idempotencyKey: randomUUID(), returnId: "s".repeat(43) }, { configuration, appBaseUrl }));
    assert(linkError instanceof SquarePaymentOperationError && linkError.code === "EVENT_CLOSED" && linkError.message === EVENT_CLOSED_ATTENDEE_MESSAGE, "a Pay on Square link is refused with the attendee message");
    assert(square.paymentCreates === paymentCreatesBefore && square.linkCreates === linkCreatesBefore, "a refused card attempt and a refused link never reach Square");
    assert(JSON.stringify(await counts()) === JSON.stringify(before), "refused attempts write no payment, refund, attempt or audit row");
    assert((await flags()).length === 0, "refusing raises no flag");

    // ---- 2. Square money that arrives anyway is recorded and flagged once. ----
    const paymentEvent = paymentWebhook(hosted.providerOrderId, `${P}-PAY-HOSTED-1`, 10_330);
    const paid = await sendWebhook(paymentEvent);
    assert(paid.status === "PROCESSED" && "paymentStatus" in paid && paid.paymentStatus === "SUCCEEDED", "a payment webhook after the close is recorded, not refused");
    const hostedPayment = await prisma.payment.findFirstOrThrow({ where: { registrationId: linked.registrationId, method: "CARD_REFERENCE" } });
    assert(hostedPayment.status === "SUCCEEDED" && hostedPayment.externalReference === `${P}-PAY-HOSTED-1`, "the payment is recorded as succeeded with Square's reference");
    await sendWebhook(paymentWebhook(hosted.providerOrderId, `${P}-PAY-HOSTED-1`, 10_330));
    assert((await sendWebhook(paymentEvent)).duplicate === true, "the same webhook event is a recognised duplicate");
    assert(await prisma.payment.count({ where: { registrationId: linked.registrationId, method: "CARD_REFERENCE" } }) === 1, "a replay records no second payment");

    const refundId = `${P}-REFUND-1`;
    const refunded = await sendWebhook(refundWebhook(cardPayment.externalReference!, refundId, 2_000));
    assert(refunded.status === "PROCESSED", "a refund webhook after the close is recorded, not refused");
    const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: cardPayment.id, externalReference: refundId } });
    assert(refund.status === "SUCCEEDED" && Math.round(Number(refund.amount) * 100) === 2_000, "the refund is recorded as succeeded");
    await sendWebhook(refundWebhook(cardPayment.externalReference!, refundId, 2_000));
    assert(await prisma.refund.count({ where: { paymentId: cardPayment.id } }) === 1, "a replayed refund records no second refund");

    const raised = await flags();
    assert(raised.length === 2, "exactly one flag per payment and per refund, however often the webhooks replay");
    const paymentFlag = raised.find((flag) => flag.kind === "PAYMENT")!;
    const refundFlag = raised.find((flag) => flag.kind === "REFUND")!;
    assert(paymentFlag.paymentId === hostedPayment.id && paymentFlag.amountCents === 10_330 && paymentFlag.source === "SQUARE_WEBHOOK" && paymentFlag.clearedAt === null, "the payment flag names the payment and its cents");
    assert(refundFlag.refundId === refund.id && refundFlag.amountCents === 2_000 && refundFlag.source === "SQUARE_REFUND" && refundFlag.clearedAt === null, "the refund flag names the refund and its cents");
    const flagAudit = await prisma.auditLog.findMany({ where: { eventId, action: "CLOSED_EVENT_MONEY_RAISED" } });
    assert(flagAudit.length === 2, "one audit row per flag, none on replay");
    for (const row of flagAudit) {
      assert(Object.keys(row.metadata as Record<string, unknown>).sort().join() === "amountCents,kind,paymentId,refundId,reviewId,source", "the flag audit row holds ids, kind, source and cents only");
      assert(!/Sample|Closed\d|example\.test/.test(JSON.stringify(row)), "no attendee detail in the flag audit row");
    }
    const view = await getCloseoutView(eventId, { canReadText: false });
    assert(view, "the closeout view loads");
    const check = view.checks.find((entry) => entry.id === "closed-event-money");
    assert(check?.state === "blocking" && check.count === 2 && check.cents === 12_330, "the closeout check is blocking with the count and cents");
    assert(view.closedMoney.length === 2 && view.closedMoney.some((row) => row.reference === `${P}-PAY-HOSTED-1`), "the page lists both, with the Square reference");
    assert(!JSON.stringify(view.closedMoney).match(/Sample|Closed\d|example\.test/), "the list holds no attendee name or contact detail");

    // ---- 3. A flag is marked reviewed with a note, in any state, and is kept. ----
    const noNote = await caught(clearClosedMoneyReview({ eventId, reviewId: paymentFlag.id, actorUserId: finance.userId, note: "   " }));
    assert(noNote instanceof ClosedMoneyReviewError && noNote.code === "NOTE_REQUIRED", "a note is required");
    const longNote = await caught(clearClosedMoneyReview({ eventId, reviewId: paymentFlag.id, actorUserId: finance.userId, note: "x".repeat(501) }));
    assert(longNote instanceof ClosedMoneyReviewError && longNote.code === "NOTE_TOO_LONG", "a note over 500 characters is refused");
    const dbRefusal = await caught(prisma.closedEventMoneyReview.update({ where: { id: paymentFlag.id }, data: { clearedAt: new Date() } }));
    assert(dbRefusal !== null, "the database refuses a clear with no note");
    assert(await stateOf() === "CLOSED", "the event is still Closed");
    await clearClosedMoneyReview({ eventId, reviewId: paymentFlag.id, actorUserId: finance.userId, note: "Matches the Square dashboard." });
    const cleared = await prisma.closedEventMoneyReview.findUniqueOrThrow({ where: { id: paymentFlag.id } });
    assert(cleared.clearedAt && cleared.clearedByUserId === finance.userId && cleared.clearedByNameSnapshot === "Pat Finance" && cleared.clearNote === "Matches the Square dashboard.", "the clear records who, when and the note");
    const again = await caught(clearClosedMoneyReview({ eventId, reviewId: paymentFlag.id, actorUserId: finance.userId, note: "Again" }));
    assert(again instanceof ClosedMoneyReviewError && again.code === "ALREADY_CLEARED", "a second clear is refused");
    assert((await prisma.closedEventMoneyReview.findUniqueOrThrow({ where: { id: paymentFlag.id } })).clearNote === "Matches the Square dashboard.", "who cleared it is never overwritten");
    const clearAudit = await prisma.auditLog.findMany({ where: { eventId, action: "CLOSED_EVENT_MONEY_CLEARED" } });
    assert(clearAudit.length === 1 && !JSON.stringify(clearAudit[0]!.metadata).includes("Matches the Square"), "the clear is audited by ids and cents, without the note");

    // ---- 4. Reopen: sign-off waits for the last flag; the lock is lifted. ----
    const reopenView = await getCloseoutView(eventId, { canReadText: true });
    await reopenClosedEvent({ eventId, actor: finance, reason: "Synthetic check: review late Square money.", expectedVersion: reopenView!.lifecycleVersion });
    assert(await stateOf() === "FINANCIAL_RECONCILIATION", "the event is reopened");
    await recordManualPayment(eventId, owing.registrationId, finance.userId, { amountCents: 1_000, method: "CASH", reference: "" });
    assert(await prisma.payment.count({ where: { registrationId: owing.registrationId } }) === 1, "a payment can be recorded again once the event is reopened");
    const refused = await caught(signOff());
    assert(refused instanceof CloseoutError && refused.code === "BLOCKING_CHECKS", "sign-off is refused while a flag is not marked reviewed");
    assert(await stateOf() === "FINANCIAL_RECONCILIATION", "a refused sign-off leaves the event open");
    await clearClosedMoneyReview({ eventId, reviewId: refundFlag.id, actorUserId: finance.userId, note: "Refund confirmed in Square." });
    await signOff();
    assert(await stateOf() === "CLOSED", "sign-off succeeds once every flag is marked reviewed");
    const kept = await flags();
    assert(kept.length === 2 && kept.every((flag) => flag.clearedAt !== null), "both flags are kept, cleared and never deleted");
    assert(await prisma.payment.count({ where: { registrationId: linked.registrationId, status: "SUCCEEDED" } }) === 1 && await prisma.refund.count({ where: { id: refund.id } }) === 1, "the late payment and refund stay recorded");

    console.log("closed-event money lock: all checks passed");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
