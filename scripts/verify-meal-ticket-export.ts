/**
 * Proves the café scanner's meal ticket export (#916) against a real PostgreSQL database:
 *
 * - one row per ticket (a selection of 3 is three rows) in exactly the scanner's columns, `MT-` ids;
 * - ids are stable: exporting twice gives identical files; a quantity increase adds new ids and keeps the old ones;
 *   a decrease retires the highest ids; a cancelled id is never handed out again (not by a later increase, a new
 *   order or a repair), and ids are unique within the event even for concurrent orders;
 * - day and date come from the event's own time zone;
 * - cancelled selections, donation-only services, walk-up orders and non-live registrations are not exported;
 * - a selection written outside the repository is given tickets by the export without renumbering the others;
 * - the per-selection summary CSV is still available;
 * - event deletion removes the ticket rows.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:meal-ticket-export
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { createContentionHarness } from "./support/meal-submit-contention";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { applyCampMeetingMealPreset } from "@/modules/meals/config-repository";
import { cancelMealSelection, changeMealQuantity, createMealOrder, entitleAttendeeToPlan, syncFormMealSelections } from "@/modules/meals/selection-repository";
import { loadScannerTickets, mealTicketSummaryCsv, mealTicketsCsv } from "@/modules/meals/view-repository";
import { scannerTicketCsvHeader } from "@/modules/meals/domain";
import { removeEventOwnedRows } from "@/modules/events/deletion-repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-meal-ticket-export-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `mtx916_${randomUUID().slice(0, 8)}`;
const userId = `${P}_user`;
const eventId = `${P}_ev`;
const surname = `Ticket${P}`;
const before = new Date("2027-06-01T12:00:00Z");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  const events = (await prisma.event.findMany({ where: { id: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  for (const id of events) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
      await tx.eventMealLedgerEntry.deleteMany({ where: { eventId: id } });
      await tx.eventMealSelectionChange.deleteMany({ where: { eventId: id } });
      await tx.eventMealTicket.deleteMany({ where: { eventId: id } });
      await tx.eventMealSelection.deleteMany({ where: { eventId: id } });
      await tx.eventMealServiceChange.deleteMany({ where: { eventId: id } });
    });
  }
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: events } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  await prisma.person.deleteMany({ where: { OR: [{ lastName: surname }, { normalizedEmail: { startsWith: `${P}.` } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { in: events } }] } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

let counter = 0;
async function makeRegistration(tag: string, status: "CONFIRMED" | "SUBMITTED" | "CANCELLED" = "CONFIRMED") {
  counter += 1;
  const person = await prisma.person.create({ data: { firstName: `Alder${tag}`, lastName: surname, normalizedEmail: `${P}.${tag}.${counter}@meals.example.test` } });
  const code = `MTX-${P.slice(-6).toUpperCase()}${tag.toUpperCase()}`;
  const registration = await prisma.registration.create({
    data: { eventId, accountHolderPersonId: person.id, confirmationCode: code, status, totalAmount: 0, submittedAt: before, contactSnapshot: { firstName: person.firstName, lastName: person.lastName } },
  });
  const attendee = await prisma.registrationAttendee.create({
    data: { eventId, registrationId: registration.id, personId: person.id, attendeeType: "adult", position: 0, profileSnapshot: { firstName: person.firstName, lastName: person.lastName } },
  });
  return { id: registration.id, code, attendeeId: attendee.id };
}

let contention: Awaited<ReturnType<typeof createContentionHarness>> | undefined;
const everIssued = new Set<string>();
/** The export, parsed: one object per data row, keyed by the scanner's columns. Records every id ever seen. */
async function exportRows() {
  const csv = await mealTicketsCsv(eventId);
  const lines = csv.trimEnd().split("\r\n");
  // The synthetic names here never need quoting, so a plain split is a faithful parse.
  assert(lines[0] === scannerTicketCsvHeader.join(",") && csv.startsWith(`${scannerTicketCsvHeader.join(",")}\r\n`), "the header is exactly the scanner's columns, unquoted, CRLF");
  assert(!csv.includes('"') && !csv.replaceAll("\r\n", "").includes("\n") && csv.charCodeAt(0) !== 0xfeff, "unquoted rows, CRLF only, no byte-order mark");
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",");
    assert(values.length === scannerTicketCsvHeader.length, `a row has the scanner's ${scannerTicketCsvHeader.length} columns`);
    return Object.fromEntries(scannerTicketCsvHeader.map((name, index) => [name, values[index]!])) as Record<(typeof scannerTicketCsvHeader)[number], string>;
  });
  for (const row of rows) {
    assert(/^MT-\d{5,}$/.test(row.ticket_id), `ticket id format (${row.ticket_id})`);
    everIssued.add(row.ticket_id);
  }
  assert(new Set(rows.map((row) => row.ticket_id)).size === rows.length, "ticket ids are unique within the event");
  return { csv, rows };
}
const idsOf = (rows: Array<{ ticket_id: string; reg_id: string }>, code: string) => rows.filter((row) => row.reg_id === code).map((row) => row.ticket_id).sort();

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: userId, email: `${P}@meals.example.test`, displayName: "Ticket verifier" } });
  // 05:00 UTC on 2027-06-16 is 22:00 on Tuesday 2027-06-15 in Los Angeles: event time and UTC disagree on the date.
  await prisma.event.create({
    data: { id: eventId, slug: `${eventId}-slug`, name: `Ticket export ${P}`, startsAt: new Date("2027-06-16T05:00:00Z"), endsAt: new Date("2027-06-20T05:00:00Z"), timezone: "America/Los_Angeles", isPublished: true },
  });
  await applyCampMeetingMealPreset(eventId, userId);
  const services = await prisma.eventMealService.findMany({ where: { eventId } });
  const service = (name: string) => services.find((row) => row.name === name)!;
  const wedBreakfast = service("Wednesday breakfast");
  const tueSupper = service("Tuesday supper");
  assert(tueSupper.serviceDate === "2027-06-15" && wedBreakfast.serviceDate === "2027-06-16", "service dates follow the event's own calendar");
  const conferencePlan = await prisma.eventMealPlan.findFirstOrThrow({ where: { eventId, code: "conference-paid" } });

  // ---- one row per ticket, the scanner's format -------------------------------------------------------------------------
  const a = await makeRegistration("a");
  const b = await makeRegistration("b");
  const orderA = await createMealOrder(eventId, userId, { registrationId: a.id, registrationAttendeeId: a.attendeeId, mealType: "BREAKFAST", serviceId: wedBreakfast.id, ageGroup: "ADULT", quantity: 3, clientRequestId: randomUUID() });
  await createMealOrder(eventId, userId, { registrationId: b.id, registrationAttendeeId: b.attendeeId, mealType: "SUPPER", serviceId: tueSupper.id, ageGroup: "CHILD", quantity: 2, clientRequestId: randomUUID() });
  const first = await exportRows();
  const csv = first.csv;
  let rows = first.rows;
  const aRows = rows.filter((row) => row.reg_id === a.code);
  assert(aRows.length === 3 && rows.length === 5, `a selection of 3 is three rows (${rows.length} rows in all)`);
  assert(aRows.every((row) => row.meal_type === "breakfast" && row.meal_day === "wed" && row.meal_date === "2027-06-16" && row.ticket_type === "adult" && row.price === "7"
    && row.redeemed === "no" && row.redeemed_at === "" && row.redeemed_by === "" && row.notes === "" && row.guest_name === `Alder${"a"} ${surname}`), "values are in the scanner's formats (day and date in event time)");
  const bRows = rows.filter((row) => row.reg_id === b.code);
  assert(bRows.every((row) => row.meal_type === "supper" && row.meal_day === "tue" && row.meal_date === "2027-06-15" && row.ticket_type === "child" && row.price === "7"), "a child supper on the event's first day is a Tuesday");
  assert(rows[0]!.meal_date === "2027-06-15" && rows[rows.length - 1]!.meal_date === "2027-06-16", "rows are sorted by meal date");
  const second = await exportRows();
  assert(second.csv === csv, "re-exporting gives the identical file (stable ids)");

  // ---- quantity changes --------------------------------------------------------------------------------------------------
  const original = idsOf(rows, a.code);
  await changeMealQuantity(eventId, orderA, userId, { quantity: 5, reason: "Two more" });
  ({ rows } = await exportRows());
  const grown = idsOf(rows, a.code);
  assert(grown.length === 5 && original.every((id) => grown.includes(id)), "an increase keeps the existing ids and adds new ones");
  const added = grown.filter((id) => !original.includes(id));
  assert(added.length === 2 && added.every((id) => id > original[original.length - 1]!), "new tickets get new, higher ids");
  await changeMealQuantity(eventId, orderA, userId, { quantity: 2, reason: "Fewer" });
  ({ rows } = await exportRows());
  const shrunk = idsOf(rows, a.code);
  assert(shrunk.length === 2 && shrunk[0] === original[0] && shrunk[1] === original[1], "a decrease retires the highest ids and keeps the lowest");
  await changeMealQuantity(eventId, orderA, userId, { quantity: 4, reason: "Back up" });
  ({ rows } = await exportRows());
  const regrown = idsOf(rows, a.code);
  const retired = [original[2]!, ...added];
  assert(regrown.length === 4 && regrown[0] === original[0] && regrown[1] === original[1] && regrown.slice(2).every((id) => !retired.includes(id)), "a retired id is never reused");

  // ---- cancellation ------------------------------------------------------------------------------------------------------
  await cancelMealSelection(eventId, orderA, userId, { reason: "Cancelled for the check" });
  ({ rows } = await exportRows());
  assert(idsOf(rows, a.code).length === 0, "a cancelled selection is not exported");
  const c = await makeRegistration("c");
  await createMealOrder(eventId, userId, { registrationId: c.id, registrationAttendeeId: c.attendeeId, mealType: "BREAKFAST", serviceId: wedBreakfast.id, ageGroup: "ADULT", quantity: 1, clientRequestId: randomUUID() });
  ({ rows } = await exportRows());
  const maxBefore = Math.max(...regrown.map((id) => Number(id.slice(3))), ...retired.map((id) => Number(id.slice(3))));
  assert(idsOf(rows, c.code).length === 1 && Number(idsOf(rows, c.code)[0]!.slice(3)) > maxBefore, "a new order after a cancellation gets a new id, not a cancelled one");

  // ---- tickets bought on the registration form (good for any service) ----------------------------------------------------
  const f = await makeRegistration("f");
  await prisma.$transaction((tx) => syncFormMealSelections(tx, {
    eventId, registrationId: f.id, formVersionId: `${P}_fv`, responses: { supper_adult_qty: 2 }, lineItems: [{ key: "supper_adult_qty", amountCents: 1500 }], previousResponses: null,
  }));
  ({ rows } = await exportRows());
  const fRows = rows.filter((row) => row.reg_id === f.code);
  assert(fRows.length === 2 && fRows.every((row) => row.meal_type === "supper" && row.meal_day === "" && row.meal_date === "" && row.price === "7.50"), "a form ticket good for any service has no day or date and keeps a decimal price");
  assert(rows[rows.length - 1]!.reg_id === f.code, "undated tickets sort last");
  const fBefore = idsOf(rows, f.code);
  await prisma.$transaction((tx) => syncFormMealSelections(tx, {
    eventId, registrationId: f.id, formVersionId: `${P}_fv`, responses: { supper_adult_qty: 3 }, lineItems: [{ key: "supper_adult_qty", amountCents: 2250 }], previousResponses: { supper_adult_qty: 2 },
  }));
  ({ rows } = await exportRows());
  const fAfter = idsOf(rows, f.code);
  assert(fAfter.length === 3 && fBefore.every((id) => fAfter.includes(id)), "a form amendment keeps the existing ids");

  // ---- conference-paid, walk-up, donation-only and non-live registrations ------------------------------------------------
  const staff = await makeRegistration("s");
  await entitleAttendeeToPlan(eventId, userId, { registrationAttendeeId: staff.attendeeId, planId: conferencePlan.id, ageGroup: "ADULT", reason: "Staff" });
  await createMealOrder(eventId, userId, { registrationId: null, serviceId: wedBreakfast.id, mealType: "BREAKFAST", ageGroup: "ADULT", quantity: 2, orderLabel: "Day visitor", clientRequestId: randomUUID() });
  const gone = await makeRegistration("g", "CANCELLED");
  await prisma.eventMealSelection.create({
    data: { eventId, planId: (await prisma.eventMealPlan.findFirstOrThrow({ where: { eventId, code: "meal-tickets" } })).id, mealType: "LUNCH", registrationId: gone.id, ageGroup: "ADULT", quantity: 1, source: "STAFF", payer: "ATTENDEE", unitPriceCents: 800, pricingSnapshot: {} },
  });
  ({ rows } = await exportRows());
  const staffRows = rows.filter((row) => row.reg_id === staff.code);
  assert(staffRows.length === 12 && staffRows.every((row) => row.price === "0"), "a conference-paid ticket has price 0 (12 ticketed services)");
  assert(rows.every((row) => !(row.meal_date === "2027-06-19" && row.meal_type === "lunch")), "the donation-only Saturday lunch is not a ticket");
  assert(idsOf(rows, gone.code).length === 0 && rows.every((row) => row.reg_id !== ""), "walk-up orders and cancelled registrations are not exported");

  // ---- a selection written outside the repository ----------------------------------------------------------------------
  const outside = await makeRegistration("o");
  const ticketPlan = await prisma.eventMealPlan.findFirstOrThrow({ where: { eventId, code: "meal-tickets" } });
  const outsideSelection = await prisma.eventMealSelection.create({
    data: { eventId, planId: ticketPlan.id, mealType: "LUNCH", serviceId: service("Thursday lunch").id, registrationId: outside.id, ageGroup: "ADULT", quantity: 2, source: "STAFF", payer: "ATTENDEE", unitPriceCents: 800, pricingSnapshot: {} },
  });
  const beforeRepair = new Set(rows.map((row) => row.ticket_id));
  ({ rows } = await exportRows());
  assert(idsOf(rows, outside.code).length === 2 && [...beforeRepair].every((id) => rows.some((row) => row.ticket_id === id)), "a selection without tickets is given them, and no other id changes");
  assert(await prisma.eventMealTicket.count({ where: { selectionId: outsideSelection.id } }) === 2, "the repaired tickets are stored");
  const afterRepair = await exportRows();
  assert(JSON.stringify(afterRepair.rows) === JSON.stringify(rows), "the repaired ids are stable too");

  // ---- concurrency -------------------------------------------------------------------------------------------------------
  // Eight orders at once, each for its own service (orders for one service queue on that service's row lock by design).
  const raceServices = services.filter((row) => row.ticketing === "TICKETED" && row.status === "ACTIVE" && ["BREAKFAST", "LUNCH", "SUPPER"].includes(row.mealType)).slice(0, 8);
  assert(raceServices.length === 8, "the preset has eight ticketed services to race on");
  const racers = await Promise.all(raceServices.map((_, index) => makeRegistration(`k${index + 1}`)));
  // `createMealOrder` is the production staff order path: SERIALIZABLE, retried 8 times on a serialization failure. No extra retry here.
  const results = await Promise.allSettled(racers.map((racer, index) => createMealOrder(eventId, userId, {
    registrationId: racer.id, registrationAttendeeId: racer.attendeeId, mealType: raceServices[index]!.mealType, serviceId: raceServices[index]!.id, ageGroup: "ADULT", quantity: 2, clientRequestId: randomUUID(),
  })));
  assert(results.every((result) => result.status === "fulfilled"), `${racers.length} concurrent orders all succeed (${results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason)).join("; ")})`);
  ({ rows } = await exportRows());
  assert(racers.every((racer) => idsOf(rows, racer.code).length === 2), "each concurrent order got its two tickets, with unique ids");
  const stored = await prisma.eventMealTicket.findMany({ where: { eventId }, select: { number: true } });
  assert(new Set(stored.map((row) => row.number)).size === stored.length, "every stored ticket number is unique within the event (gaps are allowed)");
  assert(new Set(rows.map((row) => row.ticket_id)).size === rows.length, "every exported id is unique");
  assert((await loadScannerTickets(eventId)).length === rows.length, "the loader and the file agree");

  // ---- concurrent meal-bearing form submissions: no write to any event-wide row ----------------------------------------------
  // Through the production public path (`submitPublicRegistration`: SERIALIZABLE, its own 4 attempts, no extra retry), on an event of
  // their own: simultaneous submissions queue at the submission gate rather than abort (#920).
  contention = await createContentionHarness();
  await contention.setup();
  const formEventId = contention.eventId;
  const eventBefore = await prisma.$queryRaw<Array<{ xmin: string }>>`SELECT xmin::text AS xmin FROM "Event" WHERE "id" = ${formEventId}`;
  const round = await contention.submitSimultaneously(10);
  assert(round.outcomes.every((outcome) => outcome.ok), `ten concurrent form submissions with meals all succeed (${round.outcomes.filter((o) => !o.ok).map((o) => o.error).join("; ")})`);
  const formCsv = (await mealTicketsCsv(formEventId)).trimEnd().split("\r\n").slice(1).map((line) => line.split(","));
  const formIdColumn = scannerTicketCsvHeader.indexOf("ticket_id");
  const formRegColumn = scannerTicketCsvHeader.indexOf("reg_id");
  assert(formCsv.length === 20 && new Set(formCsv.map((row) => row[formIdColumn])).size === 20 && new Set(formCsv.map((row) => row[formRegColumn])).size === 10, "the form submissions each got two tickets, all ids unique");
  const eventAfter = await prisma.$queryRaw<Array<{ xmin: string }>>`SELECT xmin::text AS xmin FROM "Event" WHERE "id" = ${formEventId}`;
  assert(eventBefore[0]!.xmin === eventAfter[0]!.xmin, "meal-bearing writes never touch the event row");

  // ---- the export-time repair under concurrency ---------------------------------------------------------------------------------
  const repair = await Promise.all(["e1", "e2"].map((tag) => makeRegistration(tag)));
  const repairSelections = await Promise.all(repair.map((reg) => prisma.eventMealSelection.create({
    data: { eventId, planId: ticketPlan.id, mealType: "LUNCH", serviceId: service("Thursday lunch").id, registrationId: reg.id, ageGroup: "ADULT", quantity: 3, source: "STAFF", payer: "ATTENDEE", unitPriceCents: 800, pricingSnapshot: {} },
  })));
  const writesBefore = await prisma.eventMealTicket.count({ where: { eventId } });
  await Promise.all([mealTicketsCsv(eventId), mealTicketsCsv(eventId), mealTicketsCsv(eventId)]);
  for (const selection of repairSelections) {
    assert(await prisma.eventMealTicket.count({ where: { selectionId: selection.id, cancelledAt: null } }) === 3, "concurrent exports give a selection exactly its quantity of active tickets");
  }
  assert(await prisma.eventMealTicket.count({ where: { eventId } }) === writesBefore + 6, "concurrent exports inserted no extra tickets");
  const countBeforeGet = await prisma.eventMealTicket.count({ where: { eventId } });
  const csvOne = await mealTicketsCsv(eventId);
  assert(csvOne === await mealTicketsCsv(eventId) && await prisma.eventMealTicket.count({ where: { eventId } }) === countBeforeGet, "a normal export writes nothing");

  // An export racing a quantity increase keeps every existing id.
  const raceReg = await makeRegistration("rc");
  const raceSelection = await prisma.eventMealSelection.create({
    data: { eventId, planId: ticketPlan.id, mealType: "LUNCH", serviceId: service("Thursday lunch").id, registrationId: raceReg.id, ageGroup: "ADULT", quantity: 2, source: "STAFF", payer: "ATTENDEE", unitPriceCents: 800, pricingSnapshot: {} },
  });
  await mealTicketsCsv(eventId);
  const idsBefore = (await prisma.eventMealTicket.findMany({ where: { selectionId: raceSelection.id, cancelledAt: null }, select: { id: true } })).map((row) => row.id).sort();
  assert(idsBefore.length === 2, "the raced selection starts with two tickets");
  await prisma.eventMealTicket.deleteMany({ where: { id: idsBefore[1]! } });
  const raced = await Promise.allSettled([mealTicketsCsv(eventId), changeMealQuantity(eventId, raceSelection.id, userId, { quantity: 4, reason: "Racing the export" }), mealTicketsCsv(eventId)]);
  assert(raced.every((result) => result.status === "fulfilled"), `the export and the quantity change both succeed (${raced.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason)).join("; ")})`);
  const racedActive = await prisma.eventMealTicket.findMany({ where: { selectionId: raceSelection.id, cancelledAt: null }, select: { id: true } });
  assert(racedActive.length === 4 && racedActive.some((row) => row.id === idsBefore[0]), "after the race the selection has its new quantity of tickets and the surviving id is kept");
  ({ rows } = await exportRows());
  assert((await loadScannerTickets(eventId)).length === rows.length, "the loader and the file agree");

  // ---- the summary export is kept ------------------------------------------------------------------------------------------
  const summary = await mealTicketSummaryCsv(eventId);
  assert(summary.startsWith('"Confirmation code","Attendee"') && summary.includes('"Quantity"'), "the per-selection summary CSV is still available");
  assert(summary.trimEnd().split("\r\n").length - 1 < rows.length, "the summary has one row per selection, fewer than one per ticket");

  // ---- event deletion ---------------------------------------------------------------------------------------------------------
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await removeEventOwnedRows(tx, eventId);
  }, { timeout: 60_000 });
  assert((await prisma.eventMealTicket.count({ where: { eventId } })) === 0 && (await prisma.eventMealSelection.count({ where: { eventId } })) === 0, "event deletion removes the ticket rows");

  console.log("Meal ticket export verification passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("Cleanup failed", error));
    await contention?.cleanup().catch((error) => console.error("Cleanup failed", error));
    await prisma.$disconnect();
  });
