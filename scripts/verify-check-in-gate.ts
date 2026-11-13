/**
 * Gate mode on the check-in station (#1684), against a real PostgreSQL database. It runs the real name search
 * (`$queryRaw`), the real Sterling rules and the real arrival log:
 *
 *  - a youth is green with no Sterling answer; an adult at an event that checks backgrounds is green with a current
 *    check and yellow without one; an adult at an event that does not check gets no Sterling answer;
 *  - another event's person and a cancelled registration are not found, by name and by arrival;
 *  - gate mode off is refused on lookup and arrival (and turning it on and off is audited once per change);
 *  - a response carries only the minimal keys; the audit never holds the typed text or a name;
 *  - a repeated arrival key is one row and one audit entry, never a check-in, and arrivals survive switching off.
 *
 *   npm run test:check-in-gate   (local database only; fictitious rows it creates and removes)
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { gateLookup, recordGateArrival, setGateMode } from "../modules/checkin-stations/gate-service";
import type { ResolvedStation } from "../modules/checkin-stations/repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run the check-in gate check");

const prisma = new PrismaClient();
// Letters only: a name with a digit is treated as a confirmation code and never searched.
const tag = [...randomBytes(8)].map((byte) => String.fromCharCode(97 + (byte % 26))).join("");
const surname = `Gate${tag}`;
const eventA = `cigate_a_${tag}`;
const eventB = `cigate_b_${tag}`;
const eventC = `cigate_c_${tag}`;
const userId = `cigate_user_${tag}`;
const uploadId = `cigate_upload_${tag}`;
let stationId = "";

async function makeAttendee(eventId: string, first: string, attendeeType: string, options: { status?: "CONFIRMED" | "CANCELLED"; age?: number } = {}) {
  const person = await prisma.person.create({
    data: { firstName: first, lastName: surname, normalizedEmail: `${first.toLowerCase()}.${tag}@gate.example.test` },
  });
  const registration = await prisma.registration.create({
    data: {
      eventId, accountHolderPersonId: person.id, confirmationCode: `GT-${randomUUID().slice(0, 8)}`.toUpperCase(),
      status: options.status ?? "CONFIRMED", totalAmount: 0, submittedAt: new Date(),
    },
  });
  const attendee = await prisma.registrationAttendee.create({
    data: {
      eventId, registrationId: registration.id, personId: person.id, attendeeType, position: 0,
      profileSnapshot: { firstName: first, lastName: surname, ...(options.age !== undefined ? { ageOnEventDate: options.age } : {}) },
      formResponses: {},
    },
  });
  return { personId: person.id, attendeeId: attendee.id };
}

async function addCheck(personId: string, label: string, expiresOn: string) {
  const entry = await prisma.backgroundCheckEntry.create({
    data: {
      uploadId, line: 1, firstName: label, lastName: surname, identityKey: `cigate:${tag}:${label}`, expiresOn, checkedOn: "2026-01-01",
    },
  });
  await prisma.backgroundCheckMatch.create({ data: { personId, entryId: entry.id, matchedBy: "MANUAL" } });
}

function stationFor(eventId: string): ResolvedStation {
  return {
    station: { id: stationId, eventId, label: "Gate check", expiresAt: new Date(Date.now() + 3_600_000) },
    eventName: "Gate check",
    starter: { id: userId, displayName: "Gate Tester" },
    permissions: ["MANAGE_CHECK_IN"],
    capabilities: { canCheckIn: true, canRecordPayments: false },
  };
}

const eventData = (id: string, checks: boolean) => ({
  id, slug: `${id}`.replaceAll("_", "-"), name: "Gate mode check", startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-17T15:00:00Z"),
  timezone: "America/Chicago", isPublished: false, checksAdultBackgrounds: checks,
});

async function main() {
  await prisma.user.create({ data: { id: userId, email: `gate.${tag}@gate.example.test`, displayName: "Gate Tester" } });
  await prisma.event.create({ data: eventData(eventA, true) });
  await prisma.event.create({ data: eventData(eventB, true) });
  await prisma.event.create({ data: eventData(eventC, false) });
  stationId = (await prisma.checkInStation.create({
    data: { eventId: eventA, startedByUserId: userId, label: "Gate check", tokenHash: `cigate_${tag}`, expiresAt: new Date(Date.now() + 3_600_000) },
  })).id;
  await prisma.backgroundCheckUpload.create({ data: { id: uploadId, format: "STERLING", rowCount: 2, added: 2, changed: 0, dropped: 0, uploadedByUserId: userId } });

  const youth = await makeAttendee(eventA, "Yara", "Pathfinder", { age: 12 });
  const current = await makeAttendee(eventA, "Cora", "Adult");
  const expired = await makeAttendee(eventA, "Edna", "Adult");
  await makeAttendee(eventA, "Mina", "Adult"); // no check on file
  const cancelled = await makeAttendee(eventA, "Cleo", "Adult", { status: "CANCELLED" });
  const other = await makeAttendee(eventB, "Olive", "Adult");
  const unchecked = await makeAttendee(eventC, "Ursa", "Adult");
  await addCheck(current.personId, "Cora", "2099-01-01");
  await addCheck(expired.personId, "Edna", "2000-01-01");
  const station = stationFor(eventA);

  // 1. Gate mode is off by default: refused on lookup and arrival, and nothing is searched or written.
  assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: eventA }, select: { checkInGateModeEnabled: true } })).checkInGateModeEnabled, false);
  await assert.rejects(gateLookup(station, { kind: "name", value: "Yara" }), (error: { code?: string }) => error.code === "GATE_MODE_OFF");
  await assert.rejects(recordGateArrival(station, { attendeeId: youth.attendeeId, idempotencyKey: randomUUID() }), (error: { code?: string }) => error.code === "GATE_MODE_OFF");
  assert.equal(await prisma.auditLog.count({ where: { eventId: eventA, action: "CHECK_IN_GATE_LOOKUP" } }), 0, "a refused lookup is not a lookup");

  // 2. Turning it on writes one audit entry; turning it on again writes none.
  assert.deepEqual(await setGateMode(eventA, userId, true), { enabled: true, changed: true });
  assert.deepEqual(await setGateMode(eventA, userId, true), { enabled: true, changed: false });
  assert.equal(await prisma.auditLog.count({ where: { eventId: eventA, action: "CHECK_IN_GATE_MODE_ENABLED" } }), 1);

  // 3. A youth: green, no Sterling answer, minimal keys only.
  const youthResponse = await gateLookup(station, { kind: "name", value: "yara" });
  assert.equal(youthResponse.outcome, "MATCHES");
  assert.equal(youthResponse.results.length, 1);
  assert.deepEqual(Object.keys(youthResponse.results[0]).sort(), ["arrivedAtLabel", "attendeeId", "clubName", "displayName", "state", "sterlingCurrent"]);
  assert.equal(youthResponse.results[0].displayName, `Yara ${surname}`);
  assert.equal(youthResponse.results[0].state, "REGISTERED");
  assert.equal(youthResponse.results[0].sterlingCurrent, null);
  assert.equal(youthResponse.results[0].arrivedAtLabel, null);
  assert.deepEqual(Object.keys(youthResponse).sort(), ["message", "moreAvailable", "outcome", "results"]);

  // 4. Adults at an event that checks backgrounds: current is green, expired and no record are yellow. A shared
  //    surname lists them by first name; a cancelled registration and another event's person are not in it.
  const all = await gateLookup(station, { kind: "name", value: surname.toLowerCase() });
  assert.deepEqual(all.results.map((row) => row.displayName), [
    `Cora ${surname}`, `Edna ${surname}`, `Mina ${surname}`, `Yara ${surname}`,
  ], "ordered by name, active registrations of this event only");
  const byName = new Map(all.results.map((row) => [row.displayName.split(" ")[0], row]));
  assert.equal(byName.get("Cora")!.sterlingCurrent, true);
  assert.equal(byName.get("Cora")!.state, "REGISTERED");
  assert.equal(byName.get("Edna")!.sterlingCurrent, false);
  assert.equal(byName.get("Edna")!.state, "STERLING_NOT_CURRENT");
  assert.equal(byName.get("Mina")!.sterlingCurrent, false);
  assert.equal(byName.get("Mina")!.state, "STERLING_NOT_CURRENT");
  assert.equal(byName.get("Yara")!.sterlingCurrent, null);

  // 5. Not found: a cancelled registration, another event's person, a name nobody has, a search wildcard.
  for (const value of ["Cleo", "Olive", "Nobodyhere", "%%", "_"]) {
    const response = await gateLookup(station, { kind: "name", value });
    assert.equal(response.outcome, "NOT_REGISTERED", `${value} is not registered`);
    assert.equal(response.results.length, 0);
  }
  await assert.rejects(recordGateArrival(station, { attendeeId: other.attendeeId, idempotencyKey: randomUUID() }), (error: { code?: string }) => error.code === "NOT_FOUND");
  await assert.rejects(recordGateArrival(station, { attendeeId: cancelled.attendeeId, idempotencyKey: randomUUID() }), (error: { code?: string }) => error.code === "NOT_FOUND");
  // A confirmation code is not a gate lookup.
  assert.equal((await gateLookup(station, { kind: "name", value: "GT-ABC123" })).outcome, "NAME_OR_PASS_ONLY");

  // 6. An adult at an event that does not check backgrounds gets no Sterling answer.
  const eventCStation = { ...stationFor(eventC) };
  await setGateMode(eventC, userId, true);
  const uncheckedResponse = await gateLookup(eventCStation, { kind: "name", value: "Ursa" });
  assert.equal(uncheckedResponse.results[0].sterlingCurrent, null);
  assert.equal(uncheckedResponse.results[0].state, "REGISTERED");
  assert.equal(unchecked.attendeeId, uncheckedResponse.results[0].attendeeId);

  // 7. Arrival: a repeated key is one row and one audit entry, and never a check-in.
  const arrivalKey = randomUUID();
  const first = await recordGateArrival(station, { attendeeId: current.attendeeId, idempotencyKey: arrivalKey });
  const replay = await recordGateArrival(station, { attendeeId: current.attendeeId, idempotencyKey: arrivalKey });
  assert.equal(first.arrivedAtLabel, replay.arrivedAtLabel);
  assert.match(first.arrivedAtLabel, /^\d{1,2}:\d{2} [AP]M C[SD]T$/);
  const raced = await Promise.allSettled([1, 2, 3].map(() => recordGateArrival(station, { attendeeId: current.attendeeId, idempotencyKey: arrivalKey })));
  assert.ok(raced.every((outcome) => outcome.status === "fulfilled"), "racing taps with one key never error");
  assert.equal(await prisma.checkInGateArrival.count({ where: { eventId: eventA, attendeeId: current.attendeeId } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { eventId: eventA, action: "CHECK_IN_GATE_ARRIVAL_RECORDED", entityId: current.attendeeId } }), 1);
  assert.equal(await prisma.checkIn.count({ where: { eventId: eventA } }), 0, "an arrival is never a check-in");
  const arrivalRow = await prisma.checkInGateArrival.findFirstOrThrow({ where: { eventId: eventA } });
  assert.equal(arrivalRow.stationId, stationId);
  assert.equal(arrivalRow.recordedByUserId, userId);
  // The key cannot be reused for another person.
  await assert.rejects(recordGateArrival(station, { attendeeId: youth.attendeeId, idempotencyKey: arrivalKey }), (error: { code?: string }) => error.code === "NOT_FOUND");
  // Today's arrival shows on the result.
  const shown = await gateLookup(station, { kind: "name", value: "Cora" });
  assert.equal(shown.results[0].arrivedAtLabel, first.arrivedAtLabel);
  // A second tap with a new key is a new arrival; the result shows the latest.
  await recordGateArrival(station, { attendeeId: current.attendeeId, idempotencyKey: randomUUID() });
  assert.equal(await prisma.checkInGateArrival.count({ where: { eventId: eventA, attendeeId: current.attendeeId } }), 2);

  // 8. Every lookup is audited with ids and counts, never the typed text or a name.
  const audits = await prisma.auditLog.findMany({ where: { eventId: eventA, action: "CHECK_IN_GATE_LOOKUP" } });
  assert.ok(audits.length >= 8, `lookups are audited (${audits.length})`);
  const text = JSON.stringify(audits);
  for (const word of ["Yara", "Cora", "Edna", "Mina", surname, surname.toLowerCase(), "Nobodyhere"]) {
    assert.ok(!text.includes(word), `the audit never holds "${word}"`);
  }
  const youthAudit = audits.find((row) => (row.metadata as { attendeeIds?: string[] }).attendeeIds?.includes(youth.attendeeId) && (row.metadata as { resultCount?: number }).resultCount === 1);
  assert.deepEqual(
    { channel: (youthAudit!.metadata as { channel: string }).channel, method: (youthAudit!.metadata as { method: string }).method },
    { channel: "CHECK_IN_STATION", method: "NAME" },
  );

  // 9. Switching it off refuses again, audited once, and keeps the arrivals.
  assert.deepEqual(await setGateMode(eventA, userId, false), { enabled: false, changed: true });
  assert.deepEqual(await setGateMode(eventA, userId, false), { enabled: false, changed: false });
  assert.equal(await prisma.auditLog.count({ where: { eventId: eventA, action: "CHECK_IN_GATE_MODE_DISABLED" } }), 1);
  await assert.rejects(gateLookup(station, { kind: "name", value: "Cora" }), (error: { code?: string }) => error.code === "GATE_MODE_OFF");
  await assert.rejects(recordGateArrival(station, { attendeeId: current.attendeeId, idempotencyKey: randomUUID() }), (error: { code?: string }) => error.code === "GATE_MODE_OFF");
  assert.equal(await prisma.checkInGateArrival.count({ where: { eventId: eventA } }), 2, "arrivals are kept");

  console.log("Check-in gate mode checks passed.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await prisma.backgroundCheckUpload.deleteMany({ where: { id: uploadId } });
    await prisma.event.deleteMany({ where: { id: { in: [eventA, eventB, eventC] } } });
    await prisma.person.deleteMany({ where: { lastName: surname } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { in: [eventA, eventB, eventC] } }] } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });
