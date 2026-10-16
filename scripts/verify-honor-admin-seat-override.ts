/**
 * Proves a system administrator can place a youth in a full Honors Weekend class by hand, and remove a pick, without ever
 * changing the class's seat limit (#962), against a real PostgreSQL database with fictitious rows it creates and removes itself:
 *
 *  - the placement works in a full class and after class changes closed; a normal pick still refuses both;
 *  - it needs a system administrator (checked against the database inside the transaction) and a reason;
 *  - the class's seat limit, every waitlist position and a live offer are exactly as they were, and the offer can still be accepted;
 *  - eligibility (level, a seatless person, the per-club limit, a repeat) still applies;
 *  - the audit entry holds ids and the reason only, and the staff roster shows the class over capacity with the reason;
 *  - a director's own roster never carries the reason;
 *  - removing a pick works after close; a pick the instructor marked is refused;
 *  - placements racing normal picks never overfill the normal seats and never fail.
 *
 *   npm run test:honor-admin-seat-override
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { ClassSelectionError, setClassSelections } from "../modules/honors/enrollment-repository";
import { createHonorOffering } from "../modules/honors/repository";
import { placeYouthInClass, removePickAsAdministrator, SeatOverrideError } from "../modules/honors/admin-placement";
import { buildClassRosters, classRostersCsv } from "../modules/honors/roster-domain";
import { getHonorRosterData } from "../modules/honors/roster-repository";
import { acceptClassWaitlistOffer, joinClassWaitlist } from "../modules/honors/waitlist-repository";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "hso";
const adminId = `${P}_admin`;
const staffId = `${P}_eventadmin`;
const eventId = `${P}_event`;
const now = new Date("2026-10-15T15:00:00Z");
const late = new Date("2026-12-01T15:00:00Z");
const clubKeys = ["c1", "c2", "c3"] as const;
type ClubKey = (typeof clubKeys)[number];
const orgOf = (key: ClubKey) => `${P}_org_${key}`;
const regOf = (key: ClubKey) => `${P}_reg_${key}`;
const director = (club: ClubKey) => ({ accountId: `${P}-director-${club}` });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}
const rejected = (work: Promise<unknown>) => work.then(() => null, (error: unknown) => error);

async function expectOverride(work: Promise<unknown>, code: SeatOverrideError["code"], what: string) {
  const error = await rejected(work);
  assert(error instanceof SeatOverrideError && error.code === code, `${what}: expected ${code}, got ${String(error)}`);
}
async function expectClass(work: Promise<unknown>, code: ClassSelectionError["code"], what: string) {
  const error = await rejected(work);
  assert(error instanceof ClassSelectionError && error.code === code, `${what}: expected ${code}, got ${String(error)}`);
}

async function cleanup() {
  await prisma.messageOutbox.deleteMany({ where: { eventId } });
  await prisma.honorClassWaitlistEntry.deleteMany({ where: { eventId } });
  await prisma.honorEnrollment.deleteMany({ where: { eventId } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId }, { actorUserId: { in: [adminId, staffId] } }] } });
  await prisma.clubEventRegistration.deleteMany({ where: { eventId } });
  await prisma.registration.deleteMany({ where: { eventId } });
  await prisma.honorOffering.deleteMany({ where: { eventId } });
  await prisma.honorSession.deleteMany({ where: { eventId } });
  await prisma.honor.deleteMany({ where: { id: { startsWith: `${P}_honor_` } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { startsWith: `${P}_org_` } } });
  await prisma.event.deleteMany({ where: { id: eventId } });
  await prisma.organization.deleteMany({ where: { id: { startsWith: `${P}_org_` } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId] } } });
}

type Level = "FRIEND" | "GUIDE" | null;
const people = new Map<string, { attendeeId: string; club: ClubKey }>();
async function addPerson(club: ClubKey, key: string, level: Level = "GUIDE", type: "YOUTH" | "STAFF" = "YOUTH") {
  const person = await prisma.person.create({ data: { id: `${P}_p_${key}`, firstName: "Synthetic", lastName: key } });
  const member = await prisma.clubRosterMember.create({
    data: { organizationId: orgOf(club), clubYear: "2026-27", personId: person.id, attendeeType: type, classLevel: level, source: "DIRECTOR" },
  });
  const count = await prisma.registrationAttendee.count({ where: { registrationId: regOf(club) } });
  const attendee = await prisma.registrationAttendee.create({
    data: {
      eventId, registrationId: regOf(club), personId: person.id, attendeeType: type, position: count,
      profileSnapshot: { firstName: "Synthetic", lastName: key, ageOnEventDate: 13, clubRosterMemberId: member.id },
    },
  });
  people.set(key, { attendeeId: attendee.id, club });
}
const attendeeOf = (key: string) => people.get(key)!.attendeeId;
const pick = (key: string, classIds: string[], at = now) =>
  setClassSelections(orgOf(people.get(key)!.club), eventId, director(people.get(key)!.club), { [attendeeOf(key)]: classIds }, at);
/** Adds one class to what the person already holds (a pick save replaces the person's whole list). */
async function pickAdd(key: string, classId: string, at = now) {
  const held = await prisma.honorEnrollment.findMany({ where: { registrationAttendeeId: attendeeOf(key) }, select: { offeringId: true } });
  return pick(key, [...held.map((row) => row.offeringId), classId], at);
}
async function drop(key: string, classId: string, at = now) {
  const held = await prisma.honorEnrollment.findMany({ where: { registrationAttendeeId: attendeeOf(key) }, select: { offeringId: true } });
  return pick(key, held.map((row) => row.offeringId).filter((id) => id !== classId), at);
}
const place = (key: string, offeringId: string, reason = "Synthetic placement reason", at = now, actor = adminId) =>
  placeYouthInClass(eventId, actor, { registrationAttendeeId: attendeeOf(key), offeringId, reason }, at);

async function settle(work: () => Promise<unknown>) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const error = await rejected(work());
    if (error === null) return;
    if (!(error instanceof ClassSelectionError && error.code === "SELECTION_CONFLICT")) throw error;
  }
  throw new Error("FAILED: a save kept conflicting");
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: adminId, email: `${P}-admin@example.test`, displayName: "Seat Admin", globalRole: "SYSTEM_ADMIN" } });
  await prisma.user.create({ data: { id: staffId, email: `${P}-eventadmin@example.test`, displayName: "Event Admin", globalRole: null } });
  await prisma.event.create({
    data: {
      id: eventId, slug: `${P}-event`, name: "Seat override verification", startsAt: new Date("2026-12-05T15:00:00Z"),
      endsAt: new Date("2026-12-06T20:00:00Z"), isPublished: true, registrationOpensOn: "2026-10-01",
      registrationClosesOn: "2026-11-30", billingMode: "DEFERRED_ORGANIZATION_INVOICE", audience: "CLUB",
    },
  });
  const sessions = await Promise.all(["One", "Two", "Three", "Four", "Five", "Six"].map((name, sortOrder) =>
    prisma.honorSession.create({ data: { eventId, name, normalizedName: name.toLowerCase(), sortOrder } })));
  for (const key of clubKeys) {
    await prisma.organization.create({ data: { id: orgOf(key), type: "CLUB", name: `Override Club ${key}`, normalizedName: `override club ${key}` } });
    const holder = await prisma.person.create({ data: { id: `${P}_holder_${key}`, firstName: "Synthetic", lastName: `Holder ${key}` } });
    await prisma.registration.create({ data: { id: regOf(key), eventId, accountHolderPersonId: holder.id, confirmationCode: `REG-${P}-${key}`, status: "SUBMITTED", totalAmount: 0, submittedAt: now } });
    await prisma.clubEventRegistration.create({ data: { eventId, organizationId: orgOf(key), registrationId: regOf(key) } });
  }
  let honorCount = 0;
  const makeClass = async (sessionIndex: number, capacity: number, extra: Record<string, unknown> = {}) => {
    const honorId = `${P}_honor_${honorCount += 1}`;
    await prisma.honor.create({ data: { id: honorId, code: `HSO-${honorCount}`, name: `Override honor ${honorCount}`, normalizedName: `override honor ${honorCount}` } });
    const setup = await createHonorOffering(eventId, {
      honorIds: [honorId], span: "SINGLE_SESSION" as const, sessionId: sessions[sessionIndex].id, locationId: null, capacity, minimumAge: null, perClubLimit: null,
      teacherName: "Synthetic Teacher", location: "Room 1", additionalCostCents: null, requirementNote: "", isActive: true, ...extra,
    }, adminId);
    return setup.offerings.find((offering) => offering.honorIds.includes(honorId))!.id;
  };
  const capacityOf = async (id: string) => (await prisma.honorOffering.findUniqueOrThrow({ where: { id }, select: { capacity: true } })).capacity;
  const seatCount = (id: string) => prisma.honorEnrollment.count({ where: { offeringId: id, consumesSeat: true } });

  for (const [club, keys] of [["c1", ["y1", "y4", "y6", "y7"]], ["c2", ["y2", "y5", "y8"]], ["c3", ["y3", "y9"]]] as const) {
    for (const key of keys) await addPerson(club, key);
  }
  await addPerson("c1", "staff1", null, "STAFF");
  await addPerson("c2", "novice", "FRIEND");

  // ---- 1. A full class: a normal pick is refused, the administrator's placement works, the limit never moves.
  const full = await makeClass(0, 1);
  await pickAdd("y1", full);
  await expectClass(pick("y2", [full]), "CLASS_FULL", "a normal pick for a full class");
  const placed = await place("y2", full, "Synthetic: family request");
  assert(placed.overCapacity, "the class is over capacity");
  assert((await seatCount(full)) === 2 && (await capacityOf(full)) === 1, "two youth hold seats and the limit is still 1");
  const placedRow = await prisma.honorEnrollment.findUniqueOrThrow({ where: { id: placed.enrollmentId } });
  assert(placedRow.adminPlacementReason === "Synthetic: family request" && placedRow.adminPlacedByUserId === adminId && placedRow.adminPlacedAt !== null, "the seat records the reason, the administrator and when");
  await expectClass(pick("y3", [full]), "CLASS_FULL", "the placement didn't open the class to a normal pick");
  console.log("ok  a full class refused a normal pick, took the placement, and kept its seat limit of 1");

  // ---- 2. Waitlist and live offers are untouched.
  const waitClass = await makeClass(1, 1);
  await pickAdd("y1", waitClass);
  const join = (key: string) => joinClassWaitlist(orgOf(people.get(key)!.club), eventId, director(people.get(key)!.club), { attendeeId: attendeeOf(key), offeringId: waitClass }, now);
  await join("y2");
  await join("y3");
  await join("y4");
  await drop("y1", waitClass); // frees the seat: y2 is offered it
  const line = () => prisma.honorClassWaitlistEntry.findMany({ where: { offeringId: waitClass }, orderBy: { joinOrder: "asc" }, select: { id: true, registrationAttendeeId: true, joinOrder: true, status: true, offerExpiresAt: true } });
  const before = await line();
  assert(before.map((entry) => entry.status).join() === "OFFERED,WAITING,WAITING", "the first in line holds the offer");
  await place("y5", waitClass, "Synthetic: pastoral request");
  const after = await line();
  assert(JSON.stringify(after) === JSON.stringify(before), "no waitlist position, status or offer changed");
  assert((await capacityOf(waitClass)) === 1, "the limit did not change");
  const offered = after[0];
  await acceptClassWaitlistOffer(orgOf("c2"), eventId, director("c2"), offered.id, now);
  assert((await prisma.honorEnrollment.count({ where: { offeringId: waitClass, registrationAttendeeId: attendeeOf("y2") } })) === 1, "the live offer was still valid and was accepted");
  const rest = (await line()).slice(1);
  assert(rest.every((entry) => entry.status === "WAITING"), "the rest of the line is still waiting");
  console.log("ok  the placement left every waitlist position and a live offer as they were; the offer was still accepted");

  // ---- 3. Who may do it, and what is required.
  const closedClass = await makeClass(2, 1);
  await expectOverride(place("y6", closedClass, "Synthetic reason", now, staffId), "NOT_AUTHORIZED", "an event admin / non-system administrator");
  await expectOverride(place("y6", closedClass, "Synthetic reason", now, `${P}_nobody`), "NOT_AUTHORIZED", "an unknown account");
  await expectOverride(place("y6", closedClass, "  ", now), "SELECTION_INVALID", "a blank reason");
  await expectOverride(place("y6", closedClass, "no", now), "SELECTION_INVALID", "a too-short reason");
  assert((await prisma.honorEnrollment.count({ where: { offeringId: closedClass } })) === 0, "nothing was placed by a refused request");
  console.log("ok  only a system administrator, with a reason, can place anyone");

  // ---- 4. After class changes closed: normal picks are refused for everyone, the placement and the removal work.
  await pick("y6", [closedClass]);
  await expectClass(pick("y7", [closedClass], late), "DEADLINE_PASSED", "a normal pick after close");
  await expectClass(pick("y6", [], late), "DEADLINE_PASSED", "a normal removal after close");
  const afterClose = await place("y7", closedClass, "Synthetic: after the deadline", late);
  assert(afterClose.overCapacity && (await capacityOf(closedClass)) === 1, "placed after close, limit unchanged");
  const normalRow = await prisma.honorEnrollment.findFirstOrThrow({ where: { offeringId: closedClass, registrationAttendeeId: attendeeOf("y6") } });
  await expectOverride(removePickAsAdministrator(eventId, staffId, { enrollmentId: normalRow.id, reason: "Synthetic reason" }, late), "NOT_AUTHORIZED", "a non-administrator removing a pick");
  await expectOverride(removePickAsAdministrator(eventId, adminId, { enrollmentId: normalRow.id, reason: "" }, late), "SELECTION_INVALID", "removing without a reason");
  await removePickAsAdministrator(eventId, adminId, { enrollmentId: normalRow.id, reason: "Synthetic: moved to another class" }, late);
  assert((await prisma.honorEnrollment.count({ where: { id: normalRow.id } })) === 0, "the pick was removed after close");
  await expectOverride(removePickAsAdministrator(eventId, adminId, { enrollmentId: normalRow.id, reason: "Synthetic reason" }, late), "PICK_NOT_FOUND", "removing twice");
  // A pick the instructor already marked stays.
  const marked = await prisma.honorEnrollment.findFirstOrThrow({ where: { offeringId: closedClass, registrationAttendeeId: attendeeOf("y7") } });
  await prisma.honorEnrollmentMark.create({ data: { enrollmentId: marked.id, attended: true, completed: false } });
  await expectOverride(removePickAsAdministrator(eventId, adminId, { enrollmentId: marked.id, reason: "Synthetic reason" }, late), "PICK_HAS_MARKS", "a pick the instructor marked");
  await prisma.honorEnrollmentMark.delete({ where: { enrollmentId: marked.id } });
  console.log("ok  after close: normal changes refused, placement and removal worked, an instructor-marked pick stayed");

  // ---- 5. Eligibility and the per-club limit still apply.
  const levelClass = await makeClass(3, 1, { minimumClassLevel: "GUIDE" });
  await pickAdd("y1", levelClass);
  await expectOverride(place("novice", levelClass), "SELECTION_INVALID", "a youth below the class level");
  await expectOverride(place("staff1", full), "SELECTION_INVALID", "a person who takes no seat");
  await expectOverride(place("y1", levelClass), "ALREADY_IN_CLASS", "a youth already in the class");
  const limited = await makeClass(4, 1, { perClubLimit: 1 });
  await pickAdd("y1", limited);
  await expectOverride(place("y4", limited), "CLUB_LIMIT_REACHED", "a second youth from a club at its limit");
  const clash = await makeClass(4, 5);
  await expectOverride(place("y1", clash), "SELECTION_INVALID", "a class that clashes with the youth's class in that session");
  console.log("ok  level, seatless, repeat, per-club limit and session clash rules still hold");

  // ---- 6. Audit holds ids and the reason only.
  const entries = await prisma.auditLog.findMany({ where: { eventId, action: "HONOR_CLASS_ADMIN_PLACED" }, orderBy: { createdAt: "asc" } });
  assert(entries.length === 3, `three placements were audited, found ${entries.length}`);
  for (const entry of entries) {
    assert(entry.actorUserId === adminId, "the audit names the administrator");
    const metadata = entry.metadata as Record<string, unknown>;
    assert(typeof metadata.reason === "string" && typeof metadata.offeringId === "string" && typeof metadata.registrationAttendeeId === "string", "ids and reason are there");
    assert(!/Synthetic y\d|Holder|Override Club/.test(JSON.stringify(entry)), "no names in the audit entry");
  }
  assert((entries[0].metadata as Record<string, unknown>).overCapacity === true && (entries[0].metadata as Record<string, unknown>).classWasFull === true, "the audit says the class was full and ended over capacity");
  assert((entries[2].metadata as Record<string, unknown>).classChangesClosed === true, "the audit says class changes had closed");
  assert((await prisma.auditLog.count({ where: { eventId, action: "HONOR_CLASS_ADMIN_PICK_REMOVED" } })) === 1, "the removal was audited");
  console.log("ok  placements and the removal are audited with ids and the reason only");

  // ---- 7. Reports show the class over capacity, with the reason.
  const data = await getHonorRosterData(eventId, { includeDietary: false });
  assert(data, "roster data");
  const rosters = buildClassRosters(data.sessions, data.offerings, data.enrollments, data.attendees, data.locations);
  const fullRoster = rosters.find((roster) => roster.offering.id === full)!;
  assert(fullRoster.overCapacity && fullRoster.youthSeats === 2 && fullRoster.offering.capacity === 1 && fullRoster.adminPlacements === 1, "the staff roster shows the class over capacity");
  assert(fullRoster.picks.some((entry) => entry.adminPlacementReason === "Synthetic: family request"), "the roster carries the reason");
  assert(classRostersCsv(rosters).includes("Synthetic: family request"), "the CSV carries the reason");
  const scoped = await getHonorRosterData(eventId, { includeDietary: false, organizationId: orgOf("c2") });
  assert(scoped && scoped.enrollments.every((entry) => !entry.adminPlacementReason), "a director's own roster never carries the reason");
  console.log("ok  the staff roster and CSV show the class over capacity with the reason; a director's roster doesn't");

  // ---- 8. Races: placements and normal picks for the same class.
  for (let round = 0; round < 6; round += 1) {
    const raced = await makeClass(5, 1);
    const key = (name: string) => name + round;
    for (const [club, name] of [["c1", "ra"], ["c2", "rb"], ["c3", "rc"]] as const) {
      // Fresh people each round, so earlier rounds' picks can't clash in session six.
      await addPerson(club, key(name));
    }
    const results = await Promise.allSettled([
      settle(() => pick(key("ra"), [raced])),
      settle(() => pick(key("rb"), [raced])),
      place(key("rc"), raced, `Synthetic race ${round}`),
    ]);
    const normal = results.slice(0, 2);
    const wonNormal = normal.filter((result) => result.status === "fulfilled").length;
    assert(results[2].status === "fulfilled", `round ${round}: the placement always succeeds, got ${String((results[2] as PromiseRejectedResult).reason)}`);
    assert(wonNormal === 1, `round ${round}: exactly one normal pick wins the one seat, got ${wonNormal}`);
    const loser = normal.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert(loser.reason instanceof ClassSelectionError && loser.reason.code === "CLASS_FULL", `round ${round}: the loser is told the class is full`);
    const normalSeats = await prisma.honorEnrollment.count({ where: { offeringId: raced, consumesSeat: true, adminPlacementReason: null } });
    assert(normalSeats === 1 && (await seatCount(raced)) === 2 && (await capacityOf(raced)) === 1, `round ${round}: one normal seat, one placement, limit still 1`);
  }
  console.log("ok  six rounds of two normal picks racing a placement: one normal winner, the placement never failed, no normal overfill");

  // ---- 9. Directors and event admins never cross the line through the pick save.
  const guard = await makeClass(0 + 1, 1);
  await pick("y8", [guard]);
  await expectClass(pick("y9", [guard]), "CLASS_FULL", "a director cannot place past a full class");
  assert((await capacityOf(guard)) === 1, "the limit is unchanged");
}

main()
  .then(() => console.log("Honor admin seat override verification passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
