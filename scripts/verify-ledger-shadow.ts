/**
 * Proves the registration ledger in shadow mode (#117, slice 1 of #74) against a real PostgreSQL database. No network,
 * no credentials, no money: every row is fictitious, created here and removed here.
 *
 * - The backfill over the seeded events writes entries, a second run writes nothing, and a dry run then reports nothing.
 * - For every SEEDED registration the ledger equals the stored total (shadow reconciliation).
 * - Through the real code paths: a public submission with a registration-level promo code (a fixed one and a capped
 *   percentage one), a waitlisted submission with a code, an amended registration (repriced up and down, and an
 *   amendment that leaves the total alone writes nothing), a cancelled registration, and a zero-total registration all
 *   reconcile, and the stored total stays exactly what the pricing computed.
 * - The backfill reconstructs a registration made before the ledger (promo code, two amendments) without flattening it
 *   and without a balancing entry, and a residual from a writer outside this slice is reported, not hidden.
 * - The append-only trigger refuses a direct UPDATE or DELETE, the sign check refuses a wrong-signed entry, and deleting
 *   a registration or an event still removes its entries.
 *
 *   npm run test:ledger-shadow
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-ledger-shadow-synthetic-key-not-a-secret");
delete process.env.ALERT_WEBHOOK_URL;

const P = `lgs_${randomUUID().slice(0, 8)}`;
const userId = `${P}_user`;
const eventId = `${P}_ev`;
const backfillEventId = `${P}_bf_ev`;
const deleteEventId = `${P}_del_ev`;
const formSlug = `${P}-form`;
const formId = `${P}_form`;
const versionId = `${P}_form_v1`;
const surname = `Ledger${P}`;
const now = new Date("2027-05-20T12:00:00Z");
const seededEventSlugs = ["womens-retreat-2026", "camp-meeting-2027", "mens-convention-2027"];

const prisma = new PrismaClient();
// The modules reach the database through the global client, so this is the one they use.
(globalThis as unknown as { prisma?: unknown }).prisma = prisma;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejects(promise: Promise<unknown>, fragment: string, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(error instanceof Error && error.message.includes(fragment), `${message}: expected "${fragment}", got ${String(error)}`);
}

async function removeEvent(id: string) {
  const { removeEventOwnedRows } = await import("../modules/events/deletion-repository");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    if (await tx.event.findUnique({ where: { id }, select: { id: true } })) await removeEventOwnedRows(tx, id);
  }, { timeout: 30_000 });
}

async function cleanup() {
  for (const id of [eventId, backfillEventId, deleteEventId]) await removeEvent(id);
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.person.deleteMany({ where: { lastName: surname } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.person.deleteMany({ where: { normalizedEmail: { startsWith: `${P}.` } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { startsWith: `${P}_` } }] } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

const formDefinition = {
  title: "Ledger shadow verification",
  description: "Temporary fictitious form used only by the ledger shadow check.",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 6, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" },
  sections: [
    {
      id: `${P}_contact`, title: "Contact", description: "", fields: [
        { id: `${P}_f_first`, key: "primary_contact_first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
        { id: `${P}_f_last`, key: "primary_contact_last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
        { id: `${P}_f_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
        { id: `${P}_f_promo`, key: "promo_code", label: "Promo code", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
      ],
    },
    {
      id: `${P}_attendees`, title: "Attendees", description: "", fields: [
        { id: `${P}_a_first`, key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: `${P}_a_last`, key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: `${P}_a_fee`, key: "registration_fee", label: "Registration fee", helpText: "", type: "CALCULATED", scope: "ATTENDEE", required: false, options: [], priceCents: 10_000 },
      ],
    },
  ],
};

let submissions = 0;
async function submit(people: number, code: string | null) {
  const { submitPublicRegistration } = await import("../modules/forms/public-repository");
  submissions += 1;
  const n = submissions;
  const result = await submitPublicRegistration(`${eventId}-slug`, formSlug, {
    versionId,
    idempotencyKey: randomUUID(),
    responses: { primary_contact_first_name: "Led", primary_contact_last_name: `Holder${n}`, email: `${P}.sub${n}@ledger.example.test`, ...(code ? { promo_code: code } : {}) },
    attendees: Array.from({ length: people }, (_, index) => ({ clientId: `p${index}`, responses: { first_name: `Guest${n}x${index}`, last_name: surname } })),
    website: "",
  } as never, now);
  return prisma.registration.findFirstOrThrow({
    where: { eventId, confirmationCode: result.confirmationCode },
    include: { attendees: { include: { person: true }, orderBy: { position: "asc" } } },
  });
}

async function amend(registration: Awaited<ReturnType<typeof submit>>, keep: number, extra: number, reason: string) {
  const amendments = await import("../modules/registrations/amendments-repository");
  const answers = await amendments.currentRegistrationAnswers(eventId, registration.id);
  assert(answers, "the answers load");
  const kept = registration.attendees.slice(0, keep).map((row, index) => ({
    attendeeId: row.id,
    clientId: `keep-${index}`,
    responses: { first_name: row.person.firstName, last_name: row.person.lastName },
  }));
  const added = Array.from({ length: extra }, (_, index) => ({
    clientId: `new-${index}-${randomUUID().slice(0, 4)}`,
    responses: { first_name: `Added${index}${randomUUID().slice(0, 4)}`, last_name: surname },
  }));
  const input = {
    clientRequestId: randomUUID(),
    expectedUpdatedAt: answers.updatedAt,
    reason,
    responses: answers.responses,
    previewOnly: true as boolean,
    attendees: [...kept, ...added],
  };
  const quote = await amendments.previewRegistrationAmendment(eventId, registration.id, input as never);
  return amendments.amendRegistration(
    eventId,
    registration.id,
    { ...input, previewOnly: false, quoteFingerprint: quote.quoteFingerprint } as never,
    { kind: "STAFF", id: userId, displayName: "Ledger verifier" },
    now,
  );
}

const cents = (value: { toString(): string }) => Math.round(Number(value) * 100);

async function ledgerOf(registrationId: string) {
  return prisma.registrationLedgerEntry.findMany({ where: { registrationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

async function reconciles(registrationIds: string[], scopeEventId = eventId) {
  const { reconcileRegistrationLedger } = await import("../modules/ledger/reconciliation");
  return reconcileRegistrationLedger(prisma, { eventId: scopeEventId, registrationIds });
}

async function assertSum(registrationId: string, expectedCents: number, message: string) {
  const row = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } });
  assert(cents(row.totalAmount) === expectedCents, `${message}: the stored total is ${expectedCents} (got ${cents(row.totalAmount)})`);
  const entries = await ledgerOf(registrationId);
  const { deriveRegistrationTotalCents } = await import("../modules/ledger/domain");
  assert(deriveRegistrationTotalCents(entries) === expectedCents, `${message}: the entries sum to ${expectedCents} (got ${deriveRegistrationTotalCents(entries)})`);
  const result = await reconciles([registrationId], row.eventId);
  assert(result.failing.length === 0, `${message}: reconciliation passes (${JSON.stringify(result.failing)})`);
  return entries;
}

async function main() {
  await cleanup();
  const { runLedgerBackfill } = await import("../modules/ledger/backfill");

  // ---- Seeded registrations: backfill, idempotency, dry run, shadow check -------------------------------------------------
  const seededEvents = await prisma.event.findMany({ where: { slug: { in: seededEventSlugs } }, select: { id: true } });
  assert(seededEvents.length > 0, "the seeded events exist (run npm run db:seed)");
  const seededRegistrations = await prisma.registration.findMany({
    where: { eventId: { in: seededEvents.map((event) => event.id) }, id: { startsWith: "reg_test_" } },
    select: { id: true, eventId: true, confirmationCode: true, totalAmount: true },
  });
  assert(seededRegistrations.length >= 3, `the seed's registrations exist (got ${seededRegistrations.length})`);

  let firstWrites = 0;
  for (const event of seededEvents) {
    const report = await runLedgerBackfill(prisma, { apply: true, eventId: event.id });
    assert(report.failures.length === 0, `the backfill has no failures: ${JSON.stringify(report.failures)}`);
    firstWrites += report.entriesWritten;
  }
  for (const event of seededEvents) {
    const second = await runLedgerBackfill(prisma, { apply: true, eventId: event.id });
    assert(second.entriesWritten === 0 && second.entriesPlanned === 0, "a second run writes nothing");
    const dry = await runLedgerBackfill(prisma, { apply: false, eventId: event.id });
    assert(dry.entriesPlanned === 0 && dry.entriesWritten === 0 && dry.registrationsWithMissingEntries === 0, "a dry run after the backfill reports nothing");
  }
  for (const event of seededEvents) {
    const ids = seededRegistrations.filter((row) => row.eventId === event.id).map((row) => row.id);
    if (ids.length === 0) continue;
    const result = await reconciles(ids, event.id);
    assert(result.checked === ids.length && result.failing.length === 0, `every seeded registration reconciles: ${JSON.stringify(result.failing)}`);
  }
  assert(firstWrites >= 0, "the first run completed");
  const zeroSeeded = seededRegistrations.find((row) => cents(row.totalAmount) === 0);
  if (zeroSeeded) {
    const entries = await ledgerOf(zeroSeeded.id);
    assert(entries.length === 1 && entries[0]!.kind === "CHARGE" && entries[0]!.amountCents === 0, "a zero-total seeded registration has one 0-cent charge");
  }
  assert(
    (await prisma.registrationLedgerEntry.count({ where: { registrationId: { in: seededRegistrations.map((row) => row.id) } } })) >= seededRegistrations.length,
    "every seeded registration has an entry",
  );

  // ---- Fixtures through the real code paths ----------------------------------------------------------------------------------
  await prisma.user.create({ data: { id: userId, email: `${P}@ledger.example.test`, displayName: "Ledger verifier" } });
  await prisma.event.create({
    data: {
      id: eventId, slug: `${eventId}-slug`, name: `Ledger shadow check ${eventId}`,
      startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-19T15:00:00Z"), timezone: "America/Chicago",
      registrationClosesOn: "2027-06-01", attendeeEditPolicy: "TIERED", isPublished: true,
      capacity: 5, waitlistEnabled: true,
    },
  });
  await prisma.registrationForm.create({
    data: {
      id: formId, eventId, createdByUserId: userId, name: formDefinition.title, slug: formSlug, status: RegistrationFormStatus.PUBLISHED,
      versions: { create: { id: versionId, createdByUserId: userId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition: formDefinition } },
    },
  });
  await prisma.promoCode.create({ data: { eventId, code: "FIXED25", normalizedCode: "FIXED25", discountType: "FIXED_CENTS", discountValue: 2_500 } });
  await prisma.promoCode.create({ data: { eventId, code: "HALFCAP", normalizedCode: "HALFCAP", discountType: "PERCENT_BPS", discountValue: 5_000, maximumDiscountCents: 3_000 } });

  // Plain submission: one charge of the stored total.
  const plain = await submit(2, null);
  const plainEntries = await assertSum(plain.id, 20_000, "a plain submission");
  assert(plainEntries.length === 1 && plainEntries[0]!.kind === "CHARGE" && plainEntries[0]!.sourceType === "REGISTRATION_SUBMISSION" && plainEntries[0]!.sourceId === plain.id && plainEntries[0]!.origin === "LIVE", "one live submission charge keyed to the registration");
  assert(plainEntries[0]!.pricingSnapshot && typeof plainEntries[0]!.pricingSnapshot === "object", "the entry carries its pricing snapshot");

  // Fixed promo: a charge of the pre-discount total and a discount, summing to what is stored.
  const fixed = await submit(2, "FIXED25");
  const fixedEntries = await assertSum(fixed.id, 17_500, "a fixed promo code");
  const redemption = await prisma.promoCodeRedemption.findUniqueOrThrow({ where: { registrationId: fixed.id } });
  assert(fixedEntries.length === 2, "a charge and a discount");
  assert(fixedEntries.find((entry) => entry.kind === "CHARGE")?.amountCents === 20_000, "the charge is the total before the code");
  const fixedDiscount = fixedEntries.find((entry) => entry.kind === "DISCOUNT");
  assert(fixedDiscount?.amountCents === -2_500 && fixedDiscount.sourceType === "PROMO_REDEMPTION" && fixedDiscount.sourceId === redemption.id, "the discount is keyed to the redemption");

  // Waitlisted with a capped percentage code (the event holds 5; 4 are taken): the split still sums to the stored total.
  const waitlisted = await submit(2, "HALFCAP");
  assert(waitlisted.status === "WAITLISTED", `the third submission waits for a spot (got ${waitlisted.status})`);
  const waitlistedEntries = await assertSum(waitlisted.id, 17_000, "a waitlisted registration with a capped code");
  assert(waitlistedEntries.find((entry) => entry.kind === "DISCOUNT")?.amountCents === -3_000, "the 50% code is capped at $30");

  // Amendment: repriced down (a CREDIT), up (a CHARGE) and unchanged (nothing written), each keyed to its operation.
  const down = await amend(plain, 1, 0, "Someone cannot come");
  await assertSum(plain.id, 10_000, "an amendment that lowers the total");
  const afterDown = await ledgerOf(plain.id);
  const downOperationId = down.amendment.id;
  const creditEntry = afterDown.find((entry) => entry.sourceType === "AMENDMENT");
  assert(afterDown.length === 2 && creditEntry?.kind === "CREDIT" && creditEntry.amountCents === -10_000 && creditEntry.sourceId === downOperationId, "a CREDIT keyed to the amendment");
  assert(creditEntry.actorType === "STAFF" && creditEntry.actorId === userId && creditEntry.actorNameSnapshot === "Ledger verifier", "the actor is a snapshot of the staff member");
  const plainNow = await prisma.registration.findUniqueOrThrow({ where: { id: plain.id }, include: { attendees: { include: { person: true }, orderBy: { position: "asc" } } } });
  await amend(plainNow, 1, 1, "Added a guest");
  await assertSum(plain.id, 20_000, "an amendment that raises the total");
  const afterUp = await ledgerOf(plain.id);
  assert(afterUp.length === 3 && afterUp.filter((entry) => entry.kind === "CHARGE" && entry.sourceType === "AMENDMENT").length === 1, "a CHARGE keyed to the second amendment");
  const plainAgain = await prisma.registration.findUniqueOrThrow({ where: { id: plain.id }, include: { attendees: { include: { person: true }, orderBy: { position: "asc" } } } });
  await amend(plainAgain, 2, 0, "Reason only");
  assert((await ledgerOf(plain.id)).length === 3, "an amendment that leaves the total alone writes nothing");
  await assertSum(plain.id, 20_000, "an unchanged amendment");

  // Amending a promo registration keeps the discount and moves the total by the difference.
  const fixedNow = await prisma.registration.findUniqueOrThrow({ where: { id: fixed.id }, include: { attendees: { include: { person: true }, orderBy: { position: "asc" } } } });
  await amend(fixedNow, 1, 0, "Smaller party");
  await assertSum(fixed.id, 7_500, "an amendment under a promo code");

  // Cancelled: totals are kept, so are the entries.
  const { cancelRegistration } = await import("../modules/registrations/lifecycle-repository");
  const beforeCancel = (await ledgerOf(fixed.id)).length;
  await cancelRegistration(eventId, fixed.id, userId, "Synthetic cancellation", now);
  const cancelled = await prisma.registration.findUniqueOrThrow({ where: { id: fixed.id } });
  assert(cancelled.status === "CANCELLED", "the registration is cancelled");
  assert((await ledgerOf(fixed.id)).length === beforeCancel, "cancelling keeps every entry and adds none");
  await assertSum(fixed.id, 7_500, "a cancelled registration");

  // Zero total, staff-created: a 0-cent charge so every registration has an entry. Stored through the real function.
  const { createRegistration } = await import("../modules/registrations/repository");
  const zero = await createRegistration(eventId, {
    firstName: "Zero", lastName: surname, email: `${P}.zero@ledger.example.test`, phone: "(515) 555-0100", attendeeType: "ATTENDEE", status: "CONFIRMED", totalAmountCents: 0,
  } as never, userId);
  assert(zero, "the staff-created registration exists");
  const zeroEntries = await assertSum(zero.id, 0, "a zero-total registration");
  assert(zeroEntries.length === 1 && zeroEntries[0]!.kind === "CHARGE" && zeroEntries[0]!.amountCents === 0, "one 0-cent charge");
  const staffPriced = await createRegistration(eventId, {
    firstName: "Priced", lastName: surname, email: `${P}.priced@ledger.example.test`, phone: "(515) 555-0100", attendeeType: "ATTENDEE", status: "CONFIRMED", totalAmountCents: 12_345,
  } as never, userId);
  assert(staffPriced, "the second staff-created registration exists");
  const pricedEntries = await assertSum(staffPriced.id, 12_345, "a staff-priced registration");
  assert(pricedEntries[0]!.actorType === "STAFF" && pricedEntries[0]!.actorId === userId, "a staff-created entry names the staff member");

  // Whole-event shadow check over the fixtures.
  const all = await reconciles([plain.id, fixed.id, waitlisted.id, zero.id, staffPriced.id]);
  assert(all.checked === 5 && all.failing.length === 0, `every fixture reconciles: ${JSON.stringify(all.failing)}`);

  // ---- A discrepancy from a writer outside this slice is reported ---------------------------------------------------
  await prisma.registration.update({ where: { id: staffPriced.id }, data: { totalAmount: 130 } });
  const failing = (await reconciles([staffPriced.id])).failing;
  assert(failing.length === 1 && failing[0]!.expectedCents === 13_000 && failing[0]!.ledgerCents === 12_345 && failing[0]!.differenceCents === 655 && failing[0]!.entryCount === 1 && !failing[0]!.hasNoEntries, `a moved total is reported with its difference: ${JSON.stringify(failing)}`);
  const afterDrift = await runLedgerBackfill(prisma, { apply: true, eventId });
  assert(afterDrift.entriesWritten === 0, "the backfill never writes a balancing entry");
  assert(afterDrift.residuals.some((residual) => residual.registrationId === staffPriced.id && residual.residualCents === 655), "the backfill reports the residual");
  await prisma.registration.update({ where: { id: staffPriced.id }, data: { totalAmount: 123.45 } });

  // ---- Backfill reconstructs history made before the ledger ------------------------------------------------------------------
  await prisma.event.create({
    data: { id: backfillEventId, slug: `${backfillEventId}-slug`, name: `Ledger backfill check ${backfillEventId}`, startsAt: new Date("2027-07-15T15:00:00Z"), endsAt: new Date("2027-07-19T15:00:00Z"), timezone: "America/Chicago", isPublished: true },
  });
  const holder = await prisma.person.create({ data: { id: `${P}_holder`, firstName: "Back", lastName: surname, normalizedEmail: `${P}.backfill@ledger.example.test`, phone: "(515) 555-0100" } });
  const promo = await prisma.promoCode.create({ data: { eventId: backfillEventId, code: "OLD20", normalizedCode: "OLD20", discountType: "FIXED_CENTS", discountValue: 2_000 } });
  const old = await prisma.registration.create({
    data: { eventId: backfillEventId, accountHolderPersonId: holder.id, confirmationCode: `${P.toUpperCase()}-OLD`, status: "CONFIRMED", totalAmount: 100, submittedAt: new Date("2027-01-10T10:00:00Z") },
  });
  await prisma.promoCodeRedemption.create({
    data: {
      eventId: backfillEventId, promoCodeId: promo.id, registrationId: old.id, codeSnapshot: "OLD20", discountTypeSnapshot: "FIXED_CENTS", discountValueSnapshot: 2_000,
      eligibleSubtotalCents: 12_000, discountAmountCents: 2_000, pricingDate: "2027-01-10", createdAt: new Date("2027-01-10T10:00:00Z"),
    },
  });
  const snapshot = (total: number, discount: number) => ({ registration: { id: old.id, totalAmountCents: total }, pricingSnapshot: { discountAmountCents: discount, totalCents: total } });
  const operation = (index: number, before: number, after: number, at: string) => prisma.registrationOperation.create({
    data: {
      id: `${P}_op${index}`, eventId: backfillEventId, registrationId: old.id, type: "AMENDMENT", clientRequestId: `${P}-op-${index}`, requestFingerprint: `${P}-fp-${index}`,
      actorUserId: userId, actorNameSnapshot: "Ledger verifier", beforeSnapshot: snapshot(before, 2_000), afterSnapshot: snapshot(after, 2_000), responseSnapshot: {}, createdAt: new Date(at),
    },
  });
  // Submitted at $100 after a $20 code ($120 before it), amended to $160, to $110, and left alone once.
  await operation(1, 10_000, 16_000, "2027-02-01T10:00:00Z");
  await operation(2, 16_000, 11_000, "2027-03-01T10:00:00Z");
  await operation(3, 11_000, 11_000, "2027-03-02T10:00:00Z");
  await prisma.registration.update({ where: { id: old.id }, data: { totalAmount: 110 } });
  const dry = await runLedgerBackfill(prisma, { apply: false, eventId: backfillEventId });
  assert(dry.entriesPlanned === 4 && dry.entriesWritten === 0 && (await ledgerOf(old.id)).length === 0, "a dry run plans four entries and writes none");
  assert(dry.residuals.length === 0, `the reconstruction equals the stored total: ${JSON.stringify(dry.residuals)}`);
  const applied = await runLedgerBackfill(prisma, { apply: true, eventId: backfillEventId });
  assert(applied.entriesWritten === 4 && applied.failures.length === 0, `four entries written: ${JSON.stringify(applied)}`);
  const rebuilt = await assertSum(old.id, 11_000, "a reconstructed registration");
  assert(rebuilt.every((entry) => entry.origin === "BACKFILL"), "backfilled entries are marked as such");
  assert(rebuilt.find((entry) => entry.kind === "CHARGE" && entry.sourceType === "REGISTRATION_SUBMISSION")?.amountCents === 12_000, "the submission charge is the total before the first amendment plus the code");
  assert(rebuilt.find((entry) => entry.kind === "DISCOUNT")?.amountCents === -2_000, "the code is its own discount");
  const amendmentEntries = rebuilt.filter((entry) => entry.sourceType === "AMENDMENT");
  assert(amendmentEntries.length === 2 && amendmentEntries[0]!.amountCents === 6_000 && amendmentEntries[0]!.kind === "CHARGE" && amendmentEntries[1]!.amountCents === -5_000 && amendmentEntries[1]!.kind === "CREDIT", "each amendment with a change is its own charge or credit, in order");
  assert(amendmentEntries[0]!.sourceId === `${P}_op1` && amendmentEntries[1]!.actorType === "STAFF" && amendmentEntries[1]!.actorNameSnapshot === "Ledger verifier", "keyed to the operation, with its actor");
  const repeat = await runLedgerBackfill(prisma, { apply: true, eventId: backfillEventId });
  assert(repeat.entriesWritten === 0 && repeat.entriesPlanned === 0, "re-running writes nothing");
  assert((await ledgerOf(old.id)).length === 4, "and nothing is duplicated");

  // ---- Append-only, by the database itself ---------------------------------------------------------------------------------------
  const target = plainEntries[0]!;
  await rejects(prisma.$executeRaw`UPDATE "RegistrationLedgerEntry" SET "amountCents" = 1 WHERE id = ${target.id}`, "append-only", "a direct UPDATE is refused");
  await rejects(prisma.$executeRaw`DELETE FROM "RegistrationLedgerEntry" WHERE id = ${target.id}`, "append-only", "a direct DELETE is refused");
  await rejects(prisma.$executeRaw`DELETE FROM "RegistrationLedgerEntry" WHERE "registrationId" = ${plain.id}`, "append-only", "a direct bulk DELETE is refused");
  assert((await prisma.registrationLedgerEntry.findUniqueOrThrow({ where: { id: target.id } })).amountCents === target.amountCents, "the entry is unchanged");
  await rejects(
    prisma.registrationLedgerEntry.create({ data: { eventId, registrationId: plain.id, kind: "CHARGE", amountCents: -1, pricingSnapshot: {}, sourceType: "AMENDMENT", sourceId: `${P}_neg` } }),
    "RegistrationLedgerEntry_amount_sign_check",
    "a negative charge is refused",
  );
  await rejects(
    prisma.registrationLedgerEntry.create({ data: { eventId, registrationId: plain.id, kind: "DISCOUNT", amountCents: 1, pricingSnapshot: {}, sourceType: "AMENDMENT", sourceId: `${P}_pos` } }),
    "RegistrationLedgerEntry_amount_sign_check",
    "a positive discount is refused",
  );
  await rejects(
    prisma.registrationLedgerEntry.create({ data: { eventId, registrationId: plain.id, kind: "CHARGE", amountCents: 0, pricingSnapshot: {}, sourceType: "REGISTRATION_SUBMISSION", sourceId: plain.id } }),
    "Unique constraint",
    "the same source and kind cannot be written twice",
  );

  // A cascade from a deleted registration or event still works.
  await prisma.event.create({ data: { id: deleteEventId, slug: `${deleteEventId}-slug`, name: `Ledger delete check ${deleteEventId}`, startsAt: new Date("2027-08-15T15:00:00Z"), endsAt: new Date("2027-08-19T15:00:00Z"), timezone: "America/Chicago", isPublished: true } });
  const delHolder = await prisma.person.create({ data: { id: `${P}_delholder`, firstName: "Del", lastName: surname } });
  const makeRegistration = (code: string) => prisma.registration.create({ data: { eventId: deleteEventId, accountHolderPersonId: delHolder.id, confirmationCode: `${P.toUpperCase()}-${code}`, status: "SUBMITTED", totalAmount: 10 } });
  const delOne = await makeRegistration("D1");
  const delTwo = await makeRegistration("D2");
  const { appendSubmissionCharge } = await import("../modules/ledger/entries");
  await appendSubmissionCharge(prisma, { eventId: deleteEventId, registrationId: delOne.id, totalCents: 1_000 });
  await appendSubmissionCharge(prisma, { eventId: deleteEventId, registrationId: delTwo.id, totalCents: 1_000 });
  await prisma.registration.delete({ where: { id: delOne.id } });
  assert(await prisma.registrationLedgerEntry.count({ where: { registrationId: delOne.id } }) === 0, "deleting a registration removes its entries");
  assert(await prisma.registrationLedgerEntry.count({ where: { registrationId: delTwo.id } }) === 1, "and only its own");
  await prisma.event.delete({ where: { id: deleteEventId } });
  assert(await prisma.registrationLedgerEntry.count({ where: { eventId: deleteEventId } }) === 0, "deleting an event removes its entries");

  // The real event-deletion service takes the ledger with the registrations.
  assert(await prisma.registrationLedgerEntry.count({ where: { eventId } }) > 0, "the fixture event has entries");
  await removeEvent(eventId);
  assert(await prisma.registrationLedgerEntry.count({ where: { eventId } }) === 0, "event deletion removes the ledger");

  console.log("Registration ledger (shadow mode) verification passed.");
}

main()
  .then(async () => {
    await cleanup();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
