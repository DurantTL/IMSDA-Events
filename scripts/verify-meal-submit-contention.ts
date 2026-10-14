/**
 * Proves, against a real PostgreSQL database, that simultaneous registration form submissions that order tickets for the
 * same meal queue instead of aborting (#920):
 *
 * - 20 submissions at once, through the production public path (`submitPublicRegistration`, its own 4 attempts and no
 *   extra retry wrapper), all succeed, 20 runs in a row;
 * - none of them even loses a serialization conflict on its first try (they queue at the submission gate rather than
 *   being saved by a retry);
 * - what is written is exactly what one submission at a time would write: one active form selection per registration, its
 *   tickets numbered uniquely, a ledger that adds up to the prices the form charged, one submission record and one
 *   registration per request;
 * - staff meal orders and a form-answer change (an amendment's meal sync) racing the submissions neither deadlock nor
 *   fail, and the staff order is not lost;
 * - a submission that waits longer than the gate's lock timeout (lowered here) gets SUBMISSION_CONFLICT with the "many people
 *   are registering" message, writes nothing, and the same idempotency key succeeds once the gate is free and replays after.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:meal-submit-contention
 */
import { randomUUID } from "node:crypto";
import { isSerializationFailure, pauseBeforeRetry } from "@/lib/prisma-errors";
import { createContentionHarness, prisma } from "./support/meal-submit-contention";

const runs = 20;
const simultaneous = 20;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function main() {
  const harness = await createContentionHarness();
  const { createMealOrder, syncFormMealSelections } = await import("@/modules/meals/selection-repository");
  await harness.setup();
  try {
    // Registrations the staff order and the form-answer change act on while the submissions race.
    const person = await prisma.person.create({ data: { firstName: "Staff", lastName: `Contend${harness.P}`, normalizedEmail: `${harness.P}.staff@meals.example.test` } });
    const registration = await prisma.registration.create({
      data: { eventId: harness.eventId, accountHolderPersonId: person.id, confirmationCode: `MCT-${harness.P.slice(-6).toUpperCase()}S`, status: "CONFIRMED", totalAmount: 0, submittedAt: new Date("2027-06-01T12:00:00Z"), contactSnapshot: { firstName: "Staff", lastName: person.lastName } },
    });
    const attendee = await prisma.registrationAttendee.create({
      data: { eventId: harness.eventId, registrationId: registration.id, personId: person.id, attendeeType: "adult", position: 0, profileSnapshot: { firstName: "Staff", lastName: person.lastName } },
    });
    // One ticketed service per staff order (an order for a service already ordered by the same attendee is refused as a duplicate).
    const services = await prisma.eventMealService.findMany({ where: { eventId: harness.eventId, ticketing: "TICKETED", status: "ACTIVE" }, orderBy: { serviceDate: "asc" }, take: runs / 2 });
    assert(services.length === runs / 2, "the preset has enough ticketed services for one staff order per racing run");
    const formVersionId = (await prisma.registrationFormVersion.findFirstOrThrow({ where: { form: { eventId: harness.eventId } } })).id;

    // An amendment's own transaction is SERIALIZABLE and retried when it loses a conflict; it does not use the gate.
    const amendAnswers = async (quantity: number, previousResponses: Record<string, unknown> | null) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await prisma.$transaction((tx) => syncFormMealSelections(tx, {
            eventId: harness.eventId, registrationId: registration.id, formVersionId, responses: { supper_adult_qty: quantity },
            lineItems: [{ key: "supper_adult_qty", amountCents: quantity * 800 }], previousResponses,
          }), { isolationLevel: "Serializable" });
        } catch (error) {
          if (isSerializationFailure(error) && attempt < 7) { await pauseBeforeRetry(attempt); continue; }
          throw error;
        }
      }
    };

    let submitted = 0;
    let quietSubmitted = 0;
    let quietAttempts = 0;
    for (let run = 1; run <= runs; run += 1) {
      const extra = run % 2 === 0;
      const racing = extra
        ? Promise.allSettled([
          createMealOrder(harness.eventId, harness.userId, {
            registrationId: registration.id, registrationAttendeeId: attendee.id, mealType: services[run / 2 - 1]!.mealType, serviceId: services[run / 2 - 1]!.id, ageGroup: "ADULT",
            quantity: 1, clientRequestId: randomUUID(),
          }),
          // An amendment-style change to the staff registration's own form answers, in a SERIALIZABLE transaction as an amendment's is.
          amendAnswers(run, run === 2 ? null : { supper_adult_qty: run - 2 }),
        ])
        : null;
      const round = await harness.submitSimultaneously(simultaneous);
      submitted += round.submissions;
      if (!racing) { quietSubmitted += round.submissions; quietAttempts += round.attempts; }
      const failed = round.outcomes.filter((outcome) => !outcome.ok);
      assert(failed.length === 0, `run ${run}: ${simultaneous} simultaneous same-meal submissions all succeed (${failed.map((outcome) => outcome.error).join("; ")})`);
      // Submissions queue at the gate, so with nothing else running none loses a conflict even once. A transaction that does not
      // use the gate (the staff order and amendment racing in the even runs) can still conflict with one; the retry absorbs that.
      if (!racing) assert(round.firstTryFailures === 0, `run ${run}: no submission lost a serialization conflict, even on its first try (${round.firstTryFailures} did: ${round.outcomes.flatMap((o) => o.failures).slice(0, 2).join(" | ")})`);
      if (racing) {
        const settled = await racing;
        assert(settled.every((result) => result.status === "fulfilled"), `run ${run}: the racing staff order and form-answer change both succeed (${settled.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason)).join("; ")})`);
      }
    }
    assert(quietAttempts === quietSubmitted, `every submission that raced only other submissions took exactly one attempt (${quietAttempts} attempts for ${quietSubmitted})`);

    // ---- What was written is what one submission at a time writes ----------------------------------------------------------
    const eventId = harness.eventId;
    const expected = runs * simultaneous;
    assert(await prisma.publicRegistrationSubmission.count({ where: { eventId } }) === expected, `one submission record per request (${expected})`);
    const selections = await prisma.eventMealSelection.findMany({ where: { eventId, source: "REGISTRATION_FORM", status: "ACTIVE", registrationId: { not: registration.id } } });
    assert(selections.length === expected, `one active form selection per submitted registration (${selections.length} of ${expected})`);
    assert(new Set(selections.map((row) => row.registrationId)).size === expected, "no registration has two active selections for the meal");
    assert(selections.every((row) => row.mealType === "SUPPER" && row.ageGroup === "ADULT" && row.quantity === 2 && row.unitPriceCents === 800), "each selection is two adult suppers at the form's price");
    const tickets = await prisma.eventMealTicket.findMany({ where: { eventId, cancelledAt: null } });
    assert(new Set(tickets.map((row) => row.number)).size === tickets.length, "every ticket number is unique within the event");
    for (const selection of selections) {
      assert(tickets.filter((ticket) => ticket.selectionId === selection.id).length === 2, "each selection has its two tickets");
    }
    const ledger = await prisma.eventMealLedgerEntry.aggregate({ where: { eventId, registrationId: { in: selections.map((row) => row.registrationId!) } }, _sum: { amountCents: true }, _count: true });
    assert(ledger._count === expected && ledger._sum.amountCents === expected * 1600, `the ledger holds one charge per selection and adds up to what the form charged (${ledger._count} entries, ${ledger._sum.amountCents} cents)`);
    assert(await prisma.registration.count({ where: { eventId, id: { not: registration.id } } }) === expected, "one registration per request");
    // The staff order and the amended form answers survived the race: the last amendment's quantity is the active one.
    const staffOrders = await prisma.eventMealSelection.count({ where: { eventId, registrationId: registration.id, source: "STAFF", status: "ACTIVE" } });
    assert(staffOrders === runs / 2, `every staff order that raced the submissions was recorded (${staffOrders} of ${runs / 2})`);
    const amended = await prisma.eventMealSelection.findFirstOrThrow({ where: { eventId, registrationId: registration.id, source: "REGISTRATION_FORM", status: "ACTIVE" } });
    assert(amended.quantity === runs, `the form-answer change left its last quantity (${amended.quantity})`);

    // ---- A gate wait that runs out is a clear, safe "submit again" ---------------------------------------------------------------
    const savedTimeout = process.env.PUBLIC_SUBMISSION_GATE_LOCK_TIMEOUT_MS;
    process.env.PUBLIC_SUBMISSION_GATE_LOCK_TIMEOUT_MS = "400";
    try {
      const key = randomUUID();
      let releaseGate!: () => void;
      const released = new Promise<void>((resolve) => { releaseGate = resolve; });
      let gateHeld!: () => void;
      const held = new Promise<void>((resolve) => { gateHeld = resolve; });
      const holder = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`LOCK TABLE "PublicSubmissionGate" IN EXCLUSIVE MODE`;
        gateHeld();
        await released;
      }, { timeout: 60_000 });
      await held;
      const before = await prisma.publicRegistrationSubmission.count({ where: { eventId } });
      const started = Date.now();
      const blocked = await harness.submitOnce(key);
      const waited = Date.now() - started;
      assert(!blocked.ok && blocked.code === "SUBMISSION_CONFLICT", `a submission stuck behind the gate gets SUBMISSION_CONFLICT (${blocked.code}: ${blocked.message})`);
      assert(/Many people are registering right now\. Please submit again\./.test(blocked.message ?? ""), "the family is told to submit again");
      assert(waited >= 300 && waited < 10_000, `it gave up at the lowered lock timeout, not the production one (${waited} ms)`);
      assert(await prisma.publicRegistrationSubmission.count({ where: { eventId } }) === before, "the timed-out submission wrote nothing");
      releaseGate();
      await holder;
      const retried = await harness.submitOnce(key);
      assert(retried.ok, `submitting again with the same idempotency key succeeds once the gate is free (${retried.code}: ${retried.message})`);
      const replayed = await harness.submitOnce(key);
      assert(replayed.ok && replayed.confirmationCode === retried.confirmationCode, "submitting the same key again replays the same registration");
      assert(await prisma.publicRegistrationSubmission.count({ where: { eventId } }) === before + 1, "exactly one submission record for the key");
    } finally {
      if (savedTimeout === undefined) delete process.env.PUBLIC_SUBMISSION_GATE_LOCK_TIMEOUT_MS;
      else process.env.PUBLIC_SUBMISSION_GATE_LOCK_TIMEOUT_MS = savedTimeout;
    }

    console.log(`Meal submission contention verification passed (${runs} runs of ${simultaneous} simultaneous submissions, ${submitted} in all, each queued at the gate).`);
  } finally {
    await harness.cleanup().catch((error) => console.error("Cleanup failed", error));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
