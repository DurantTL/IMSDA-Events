/**
 * Proves that bringing a registration back never overfills an Honors Weekend class (#880), against a real PostgreSQL
 * database with fictitious rows it creates and removes itself. A cancelled or waitlisted registration keeps its class
 * picks but holds no seats, so the status flip back to active used to re-occupy every old seat:
 *
 *  - a seat given away between the cancel and the reinstate: that pick is dropped (the rest come back), audited with ids
 *    only, reported to staff with the reason, and the director is emailed through the outbox;
 *  - the same for a per-club limit that was reached meanwhile;
 *  - the same when a registration is promoted from the waitlist, by staff or automatically after a cancellation;
 *  - a dropped pick never jumps the class waitlist: a seat held for a live offer, or a lapsed offer's seat passed to the
 *    next youth, is not used by the restored pick;
 *  - picks that fit come back untouched with no notice; staff and adults (no seat) always come back;
 *  - two registrations reinstated at once, or a reinstatement racing a direct pick, for the last seat never overfill it.
 *
 *   npm run test:honor-reinstate-seats
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { ClassSelectionError, setClassSelections } from "../modules/honors/enrollment-repository";
import { createHonorOffering } from "../modules/honors/repository";
import { joinClassWaitlist } from "../modules/honors/waitlist-repository";
import {
  cancelRegistration,
  moveRegistrationToWaitlist,
  promoteRegistrationFromWaitlist,
  reactivateRegistration,
} from "../modules/registrations/lifecycle-repository";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "hrs";
const adminId = `${P}_admin`;
const eventId = `${P}_event`;
const clubKeys = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"] as const;
type ClubKey = (typeof clubKeys)[number];
const now = new Date("2026-10-15T15:00:00Z");
const hours = (base: Date, count: number) => new Date(base.getTime() + count * 60 * 60 * 1000);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const orgOf = (key: ClubKey) => `${P}_org_${key}`;
const regOf = (key: ClubKey) => `${P}_reg_${key}`;
const emailOf = (key: ClubKey) => `${P}-${key}@example.test`;

async function cleanup() {
  await prisma.messageOutbox.deleteMany({ where: { eventId } });
  await prisma.honorClassWaitlistEntry.deleteMany({ where: { eventId } });
  await prisma.honorEnrollment.deleteMany({ where: { eventId } });
  await prisma.registrationWaitlistEntry.deleteMany({ where: { eventId } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId }, { actorUserId: adminId }] } });
  await prisma.clubEventRegistration.deleteMany({ where: { eventId } });
  await prisma.registration.deleteMany({ where: { eventId } });
  await prisma.honorOffering.deleteMany({ where: { eventId } });
  await prisma.honorSession.deleteMany({ where: { eventId } });
  await prisma.honor.deleteMany({ where: { id: { startsWith: `${P}_honor_` } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { startsWith: `${P}_org_` } } });
  await prisma.event.deleteMany({ where: { id: eventId } });
  await prisma.organization.deleteMany({ where: { id: { startsWith: `${P}_org_` } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
}

const people = new Map<string, { attendeeId: string; club: ClubKey }>();

async function addPerson(club: ClubKey, key: string, type: "YOUTH" | "STAFF" = "YOUTH") {
  const person = await prisma.person.create({ data: { id: `${P}_p_${key}`, firstName: "Test", lastName: key } });
  const member = await prisma.clubRosterMember.create({
    data: { organizationId: orgOf(club), clubYear: "2026-27", personId: person.id, attendeeType: type, source: "DIRECTOR" },
  });
  const count = await prisma.registrationAttendee.count({ where: { registrationId: regOf(club) } });
  const attendee = await prisma.registrationAttendee.create({
    data: {
      eventId, registrationId: regOf(club), personId: person.id, attendeeType: type, position: count,
      profileSnapshot: { firstName: "Test", lastName: key, ageOnEventDate: 13, clubRosterMemberId: member.id },
    },
  });
  people.set(key, { attendeeId: attendee.id, club });
}

const attendeeOf = (key: string) => people.get(key)!.attendeeId;
const director = (club: ClubKey) => ({ accountId: `${P}-director-${club}` });
const pick = (key: string, classIds: string[], at = now) => setClassSelections(orgOf(people.get(key)!.club), eventId, director(people.get(key)!.club), { [attendeeOf(key)]: classIds }, at);
const seats = (classId: string) => prisma.honorEnrollment.count({ where: { offeringId: classId, consumesSeat: true, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } } });
const holds = async (key: string, classId: string) => (await prisma.honorEnrollment.count({ where: { registrationAttendeeId: attendeeOf(key), offeringId: classId } })) === 1;
const statusOfReg = async (club: ClubKey) => (await prisma.registration.findUniqueOrThrow({ where: { id: regOf(club) }, select: { status: true } })).status;
const notRestoredMail = (club: ClubKey) => prisma.messageOutbox.findMany({ where: { registrationId: regOf(club), templateKey: "HONOR_CLASS_PICKS_NOT_RESTORED" }, orderBy: { createdAt: "asc" } });
const notRestoredAudit = (club: ClubKey) => prisma.auditLog.findMany({ where: { entityId: regOf(club), action: "HONOR_CLASS_PICK_NOT_RESTORED" }, orderBy: { createdAt: "asc" } });
const cancel = (club: ClubKey, at = now) => cancelRegistration(eventId, regOf(club), adminId, "synthetic", at);
const reactivate = (club: ClubKey, at = now) => reactivateRegistration(eventId, regOf(club), adminId, "synthetic", at);

const rejected = (work: Promise<unknown>) => work.then(() => null, (error: unknown) => error);

async function expectCode(work: Promise<unknown>, code: ClassSelectionError["code"], what: string) {
  const error = await rejected(work);
  assert(error instanceof ClassSelectionError && error.code === code, `${what}: expected ${code}, got ${String(error)}`);
}

/** Whatever happened, no class holds more than its capacity in seats plus live offers, or more than its per-club limit for a club. */
async function assertNoOverfill(when: string, at = now) {
  const offerings = await prisma.honorOffering.findMany({ where: { eventId }, select: { id: true, capacity: true, perClubLimit: true } });
  for (const offering of offerings) {
    const rows = await prisma.honorEnrollment.findMany({
      where: { offeringId: offering.id, consumesSeat: true, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
      select: { organizationId: true },
    });
    const live = await prisma.honorClassWaitlistEntry.count({ where: { offeringId: offering.id, status: "OFFERED", offerExpiresAt: { gt: at } } });
    assert(rows.length + live <= offering.capacity, `${when}: class ${offering.id} holds ${rows.length} seats and ${live} offers for ${offering.capacity}`);
    if (offering.perClubLimit !== null) {
      const perClub = new Map<string | null, number>();
      for (const row of rows) perClub.set(row.organizationId, (perClub.get(row.organizationId) ?? 0) + 1);
      for (const [club, count] of perClub) assert(count <= offering.perClubLimit, `${when}: club ${club} holds ${count} seats in class ${offering.id} (limit ${offering.perClubLimit})`);
    }
  }
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: adminId, email: `${P}-admin@example.test`, displayName: "Reinstate Admin", globalRole: "SYSTEM_ADMIN" } });
  await prisma.event.create({
    data: {
      id: eventId, slug: `${P}-event`, name: "Reinstate verification", startsAt: new Date("2026-12-05T15:00:00Z"),
      endsAt: new Date("2026-12-06T20:00:00Z"), isPublished: true, registrationOpensOn: "2026-10-01",
      registrationClosesOn: "2026-11-30", billingMode: "DEFERRED_ORGANIZATION_INVOICE", audience: "CLUB",
      waitlistEnabled: true, autoPromoteWaitlist: false,
    },
  });
  const sessions = await Promise.all(["One", "Two", "Three"].map((name, sortOrder) => prisma.honorSession.create({ data: { eventId, name, normalizedName: name.toLowerCase(), sortOrder } })));
  const [s1, s2, s3] = sessions as [typeof sessions[number], typeof sessions[number], typeof sessions[number]];

  for (const key of clubKeys) {
    await prisma.organization.create({ data: { id: orgOf(key), type: "CLUB", name: `Reinstate Club ${key}`, normalizedName: `reinstate club ${key}` } });
    const holder = await prisma.person.create({ data: { id: `${P}_holder_${key}`, firstName: "Test", lastName: `Director ${key}`, normalizedEmail: emailOf(key) } });
    await prisma.registration.create({ data: { id: regOf(key), eventId, accountHolderPersonId: holder.id, confirmationCode: `REG-${P}-${key}`, status: "SUBMITTED", totalAmount: 0, submittedAt: now } });
    await prisma.clubEventRegistration.create({ data: { eventId, organizationId: orgOf(key), registrationId: regOf(key) } });
  }

  let honorCount = 0;
  const makeClass = async (sessionId: string, capacity: number, extra: Record<string, unknown> = {}) => {
    const honorId = `${P}_honor_${honorCount += 1}`;
    await prisma.honor.create({ data: { id: honorId, code: `HRS-${honorCount}`, name: `Reinstate honor ${honorCount}`, normalizedName: `reinstate honor ${honorCount}` } });
    const setup = await createHonorOffering(eventId, {
      honorIds: [honorId], span: "SINGLE_SESSION" as const, sessionId, locationId: null, capacity, minimumAge: null, perClubLimit: null,
      teacherName: "Synthetic Teacher", location: "Room 1", additionalCostCents: null, requirementNote: "", isActive: true, ...extra,
    }, adminId);
    return setup.offerings.find((offering) => offering.honorIds.includes(honorId))!.id;
  };

  // ---- 1. A seat given away between the cancel and the reinstate (class capacity)
  const classA = await makeClass(s1.id, 2); // the contested class
  const classB = await makeClass(s2.id, 3); // a roomy class the same youth also picked
  await addPerson("c1", "y1");
  await addPerson("c1", "staff1", "STAFF");
  await addPerson("c2", "y2");
  await addPerson("c3", "y3");
  await pick("y1", [classA, classB]);
  await pick("staff1", [classA]); // staff take no seat
  await pick("y2", [classA]);
  assert((await seats(classA)) === 2, "class A is full");
  await cancel("c1");
  assert((await seats(classA)) === 1, "cancelling gives the seat back");
  await pick("y3", [classA]); // the seat is given away
  assert((await seats(classA)) === 2, "another club took the freed seat");
  const reactivated = await reactivate("c1");
  assert((await statusOfReg("c1")) === "SUBMITTED", "the registration is reinstated");
  assert(!(await holds("y1", classA)), "the pick whose class filled up is not restored");
  assert(await holds("y1", classB), "the other pick comes back");
  assert(await holds("staff1", classA), "staff take no seat, so their pick always comes back");
  assert((await seats(classA)) === 2, "class A is exactly full, never over");
  assert(reactivated.classPicksNotRestored.length === 1 && /Test y1: Reinstate honor 1 \(One\) was not restored because the class filled up/.test(reactivated.classPicksNotRestored[0]!), "staff are told which pick was not restored and why");
  const audit1 = await notRestoredAudit("c1");
  assert(audit1.length === 1, "each dropped pick has one audit entry");
  const meta1 = audit1[0]!.metadata as Record<string, unknown>;
  assert(meta1.offeringId === classA && meta1.registrationAttendeeId === attendeeOf("y1") && meta1.reason === "CLASS_FULL" && meta1.trigger === "REGISTRATION_REACTIVATED", "the audit entry names the class, the youth and why, by id");
  assert(!/Test|Director|@example|firstName|lastName/.test(JSON.stringify(meta1) + audit1[0]!.summary), "the audit entry names no one");
  const reactivationAudit = await prisma.auditLog.findFirst({ where: { entityId: regOf("c1"), action: "REGISTRATION_REACTIVATED" }, orderBy: { createdAt: "desc" } });
  assert((reactivationAudit!.metadata as Record<string, unknown>).classPicksNotRestored === 1, "the reactivation's own audit entry counts the dropped picks");
  const mail1 = await notRestoredMail("c1");
  assert(mail1.length === 1 && mail1[0]!.recipientEmail === emailOf("c1") && mail1[0]!.recipientKind === "INTERNAL" && mail1[0]!.status === "PENDING", "one email is queued in the outbox for that club's director");
  assert(/Reinstate honor 1/.test(mail1[0]!.bodyTextSnapshot) && !/Reinstate honor 2/.test(mail1[0]!.bodyTextSnapshot) && mail1[0]!.bodyTextSnapshot.includes(`/account/clubs/${orgOf("c1")}/events/${eventId}`), "the email lists the dropped class only and links to the club's page");
  assert(reactivated.registration.status === "SUBMITTED", "the lifecycle result shows the registration active");
  await expectCode(pick("y1", [classA, classB]), "CLASS_FULL", "the director can't take the full class back");
  await assertNoOverfill("after the reinstate");
  console.log("ok  reinstating after a seat was given away drops that pick (audited by id, reported to staff, director emailed through the outbox) and keeps the rest");

  // ---- 2. Picks that fit come back untouched, with no notice
  const classC = await makeClass(s3.id, 2);
  await addPerson("c4", "y4");
  await pick("y4", [classC]);
  await cancel("c4");
  const quiet = await reactivate("c4");
  assert(await holds("y4", classC), "a pick whose class still has room comes back");
  assert(quiet.classPicksNotRestored.length === 0 && (await notRestoredMail("c4")).length === 0 && (await notRestoredAudit("c4")).length === 0, "and nothing is reported, emailed or audited");
  console.log("ok  picks that still fit come back with no report, email or audit entry");

  // ---- 3. A per-club limit reached meanwhile
  const classL = await makeClass(s1.id, 5, { perClubLimit: 2 });
  await addPerson("c5", "y5a");
  await addPerson("c5", "y5b");
  await pick("y5a", [classL]);
  await pick("y5b", [classL]);
  await cancel("c5");
  await prisma.honorOffering.update({ where: { id: classL }, data: { perClubLimit: 1 } }); // staff lowered the limit meanwhile
  const limited = await reactivate("c5");
  assert((await holds("y5a", classL)) && !(await holds("y5b", classL)), "the club keeps the pick that fits its limit and loses the other");
  assert(limited.classPicksNotRestored.length === 1 && /allows 1 youth per club and that limit was already reached/.test(limited.classPicksNotRestored[0]!), "staff are told it was the club's limit");
  const limitAudit = await notRestoredAudit("c5");
  assert(limitAudit.length === 1 && (limitAudit[0]!.metadata as Record<string, unknown>).reason === "CLUB_LIMIT_REACHED", "audited as a club limit");
  assert((await notRestoredMail("c5")).length === 1, "the director is emailed");
  await assertNoOverfill("after the limit reinstate");
  console.log("ok  a per-club limit reached while the registration was cancelled drops the pick that no longer fits");

  // ---- 4. Promotion from the registration waitlist, by staff
  const classP = await makeClass(s2.id, 1);
  const classPL = await makeClass(s3.id, 5, { perClubLimit: 2 });
  await addPerson("c6", "y6");
  await addPerson("c6", "y6b");
  await addPerson("c6", "y6c");
  await addPerson("c7", "y7");
  await pick("y6", [classP]);
  await pick("y6b", [classPL]);
  await pick("y6c", [classPL]);
  await moveRegistrationToWaitlist(eventId, regOf("c6"), adminId, "synthetic", now);
  assert((await statusOfReg("c6")) === "WAITLISTED" && (await seats(classP)) === 0, "a waitlisted registration holds no seats");
  await pick("y7", [classP]); // the seat is given away
  await prisma.honorOffering.update({ where: { id: classPL }, data: { perClubLimit: 1 } }); // staff lowered the limit meanwhile
  const promoted = await promoteRegistrationFromWaitlist(eventId, regOf("c6"), adminId, "synthetic", now);
  assert((await statusOfReg("c6")) === "SUBMITTED", "the registration is promoted");
  assert(!(await holds("y6", classP)) && (await seats(classP)) === 1, "promotion drops the pick whose class filled up and never overfills it");
  assert((await holds("y6b", classPL)) && !(await holds("y6c", classPL)), "promotion drops a pick over the club's limit too");
  assert(promoted.classPicksNotRestored.length === 2, "staff are told about both");
  assert((await notRestoredAudit("c6")).length === 2 && (await notRestoredMail("c6")).length === 1, "audited per pick, one email");
  assert(((await notRestoredAudit("c6"))[0]!.metadata as Record<string, unknown>).trigger === "REGISTRATION_PROMOTED_FROM_WAITLIST", "the audit entry says it was a promotion");
  await assertNoOverfill("after staff promotion");
  console.log("ok  promoting from the waitlist applies the same rule (class capacity and club limit)");

  // ---- 5. Automatic promotion after another registration is cancelled
  await prisma.event.update({ where: { id: eventId }, data: { autoPromoteWaitlist: true } });
  const classAuto = await makeClass(s1.id, 1);
  await addPerson("c8", "y8");
  await addPerson("c9", "y9");
  await addPerson("c2", "y2b"); // c2 holds an event seat to give back, with no class
  await pick("y8", [classAuto]);
  await moveRegistrationToWaitlist(eventId, regOf("c8"), adminId, "synthetic", now);
  await pick("y9", [classAuto]);
  const auto = await cancel("c2");
  assert((await statusOfReg("c8")) === "SUBMITTED" && auto.autoPromotedRegistration !== null, "the cancellation automatically promoted the waiting registration");
  assert(!(await holds("y8", classAuto)) && (await holds("y9", classAuto)) && (await seats(classAuto)) === 1, "the automatic promotion dropped the pick whose class was taken");
  assert(auto.autoPromotedClassPicksNotRestored.length === 1, "staff are told");
  const autoAudit = await notRestoredAudit("c8");
  assert(autoAudit.length === 1 && (autoAudit[0]!.metadata as Record<string, unknown>).trigger === "REGISTRATION_AUTO_PROMOTED_FROM_WAITLIST" && (await notRestoredMail("c8")).length === 1, "audited and emailed");
  await prisma.event.update({ where: { id: eventId }, data: { autoPromoteWaitlist: false } });
  await assertNoOverfill("after automatic promotion");
  console.log("ok  an automatic promotion after a cancellation applies the same rule");

  // ---- 6. A dropped pick never jumps the class waitlist (#831)
  const classW = await makeClass(s2.id, 1);
  await addPerson("c1", "w1");
  await addPerson("c3", "w3");
  await addPerson("c4", "w4");
  await pick("w1", [classW]);
  await joinClassWaitlist(orgOf("c3"), eventId, director("c3"), { attendeeId: attendeeOf("w3"), offeringId: classW }, now);
  await joinClassWaitlist(orgOf("c4"), eventId, director("c4"), { attendeeId: attendeeOf("w4"), offeringId: classW }, now);
  await cancel("c1"); // the freed seat is offered to w3
  const offer = await prisma.honorClassWaitlistEntry.findFirstOrThrow({ where: { registrationAttendeeId: attendeeOf("w3"), offeringId: classW } });
  assert(offer.status === "OFFERED", "the freed seat is offered to the first in line");
  const held = await reactivate("c1", hours(now, 1));
  assert(!(await holds("w1", classW)) && held.classPicksNotRestored.length === 1, "a seat held for a live offer is not given back to the reinstated pick");
  assert((await prisma.honorClassWaitlistEntry.findUniqueOrThrow({ where: { id: offer.id } })).status === "OFFERED", "and the offer still stands");
  await assertNoOverfill("after the held offer", hours(now, 1));

  // An offer that ran out unaccepted: reinstating first passes the seat to the next youth in line, not to the old pick.
  const classW2 = await makeClass(s1.id, 1);
  await addPerson("c1", "v1");
  await addPerson("c3", "v3");
  await addPerson("c4", "v4");
  await pick("v1", [classW2]);
  await joinClassWaitlist(orgOf("c3"), eventId, director("c3"), { attendeeId: attendeeOf("v3"), offeringId: classW2 }, now);
  await joinClassWaitlist(orgOf("c4"), eventId, director("c4"), { attendeeId: attendeeOf("v4"), offeringId: classW2 }, now);
  await cancel("c1");
  const firstOffer = await prisma.honorClassWaitlistEntry.findFirstOrThrow({ where: { registrationAttendeeId: attendeeOf("v3"), offeringId: classW2 } });
  assert(firstOffer.status === "OFFERED", "the seat was offered to the first in line");
  const lapsedAt = hours(now, 30);
  const afterLapse = await reactivate("c1", lapsedAt);
  assert(!(await holds("v1", classW2)) && afterLapse.classPicksNotRestored.length === 1, "the reinstated pick does not take the seat the lapsed offer frees");
  const stateV3 = (await prisma.honorClassWaitlistEntry.findUniqueOrThrow({ where: { id: firstOffer.id } })).status;
  const stateV4 = (await prisma.honorClassWaitlistEntry.findFirstOrThrow({ where: { registrationAttendeeId: attendeeOf("v4"), offeringId: classW2 } })).status;
  assert(stateV3 === "EXPIRED" && stateV4 === "OFFERED", "the lapsed offer passed the seat to the next youth in line");
  assert((await prisma.messageOutbox.count({ where: { registrationId: regOf("c4"), templateKey: "HONOR_CLASS_WAITLIST_OFFER" } })) >= 1, "whose director is emailed the offer once the reinstatement commits");
  await assertNoOverfill("after the lapsed offer", lapsedAt);
  console.log("ok  a restored pick never uses a seat held for a waitlist offer or passed to the next in line");

  // ---- 7. Two reinstatements racing for the last seat, and one racing a direct pick
  await reactivate("c2", hours(now, 31)); // cancelled in section 5
  const classR = await makeClass(s3.id, 1);
  const droppedBefore = await prisma.auditLog.count({ where: { eventId, action: "HONOR_CLASS_PICK_NOT_RESTORED" } });
  await addPerson("c1", "r1");
  await addPerson("c2", "r2");
  await addPerson("c3", "r3");
  await pick("r1", [classR]);
  await cancel("c1");
  await pick("r2", [classR]);
  await cancel("c2");
  assert((await seats(classR)) === 0, "the class is empty while both are cancelled");
  const settled = await Promise.allSettled([reactivate("c1"), reactivate("c2")]);
  assert(settled.every((outcome) => outcome.status === "fulfilled"), `both reinstatements finish: ${JSON.stringify(settled.filter((outcome) => outcome.status === "rejected"))}`);
  assert((await seats(classR)) === 1, "exactly one of them got the last seat");
  assert((await prisma.auditLog.count({ where: { eventId, action: "HONOR_CLASS_PICK_NOT_RESTORED" } })) === droppedBefore + 1, "and the other's pick was reported");
  const classR2 = await makeClass(s3.id, 1);
  await pick("r1", [classR2]);
  await cancel("c1");
  const racing = await Promise.allSettled([
    reactivate("c1"),
    pick("r3", [classR2]).catch((error) => { if (!(error instanceof ClassSelectionError)) throw error; }),
  ]);
  assert(racing.every((outcome) => outcome.status === "fulfilled"), `the reinstatement and the pick both finish: ${JSON.stringify(racing.filter((outcome) => outcome.status === "rejected"))}`);
  assert((await seats(classR2)) === 1, "a reinstatement racing a direct pick for the last seat never overfills the class");
  await assertNoOverfill("after the races");
  console.log("ok  reinstatements racing each other or a direct pick never overfill a class");

  // ---- 8. The audit trail names no one
  const entries = await prisma.auditLog.findMany({ where: { eventId, action: "HONOR_CLASS_PICK_NOT_RESTORED" }, select: { summary: true, metadata: true } });
  assert(entries.length >= 6 && entries.every((entry) => !/Test|Director/.test(entry.summary) && !/firstName|lastName|@example/.test(JSON.stringify(entry.metadata))), "every audit entry names no one");
  console.log("ok  every dropped pick is audited with ids and no names");

  console.log("honor reinstate seats: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    await prisma.$disconnect();
  });
