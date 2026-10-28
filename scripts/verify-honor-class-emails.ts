/**
 * Proves Honors Weekend instructor class emails (#1098) against a real PostgreSQL database, with the real write paths: a
 * director's pick save, a system administrator's removal, and a registration cancelled and brought back. Every enrollment
 * change leaves a change row in its own transaction; a daily instructor gets one summary that nets a join and a leave of
 * the same youth, none on a quiet day, and none twice (sequential sweeps and several sweeps at once); a right-away
 * instructor gets one email per change after the commit; OFF, revoked and not-yet-accepted instructors get nothing; the
 * staff switch stops everything and nothing is lost; a paused event's email is recorded as suppressed; and no birth
 * date reaches an email. Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:honor-class-emails
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
// Fictitious values so account email counts as set up (nothing is ever delivered: messages stay queued or captured locally).
process.env.ACCOUNT_EMAIL_SENDER_ADDRESS ||= "events@ci.example.test";
process.env.RESEND_API_KEY ||= "ci-placeholder-never-sent";

const prisma = new PrismaClient();
const P = "hce";
const eventId = `${P}_event`;
const adminId = `${P}_admin`;
const orgId = `${P}_org`;
const regId = `${P}_reg`;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const birthSecret = "2013-02-03";
const key = "HONOR_INSTRUCTOR_CLASS_EMAILS";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.notificationSetting.deleteMany({ where: { key } });
  await prisma.messageOutbox.deleteMany({ where: { eventId } });
  await prisma.honorClassChange.deleteMany({ where: { eventId } });
  await prisma.honorClassWaitlistEntry.deleteMany({ where: { eventId } });
  await prisma.honorEnrollment.deleteMany({ where: { eventId } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId }, { actorUserId: adminId }] } });
  await prisma.honorInstructor.deleteMany({ where: { eventId } });
  await prisma.registrationAttendee.deleteMany({ where: { eventId } });
  await prisma.clubEventRegistration.deleteMany({ where: { eventId } });
  await prisma.registrationCapacityReservation.deleteMany({ where: { registration: { eventId } } });
  await prisma.registration.deleteMany({ where: { eventId } });
  await prisma.honorOffering.deleteMany({ where: { eventId } });
  await prisma.honorSession.deleteMany({ where: { eventId } });
  await prisma.eventMessageSettings.deleteMany({ where: { eventId } });
  await prisma.event.deleteMany({ where: { id: eventId } });
  await prisma.honor.deleteMany({ where: { id: { startsWith: `${P}_honor_` } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);

async function main() {
  const { setClassSelections } = await import("../modules/honors/enrollment-repository");
  const { removePickAsAdministrator } = await import("../modules/honors/admin-placement");
  const { cancelRegistration } = await import("../modules/registrations/lifecycle-repository");
  const { sendDueClassChangeEmails } = await import("../modules/honors/class-change-emails");
  const { setInstructorClassChangeEmails } = await import("../modules/honors/instructor-repository");
  const { classSummaryWindow } = await import("../modules/honors/class-change-domain");
  const { centralDateKey, centralInstant } = await import("../modules/event-locations/waitlist-digest-domain");
  const { resetNotificationSettingsCache } = await import("../modules/notifications/settings");

  await cleanup();
  const real = new Date();
  await prisma.user.create({ data: { id: adminId, email: `${P}-admin@example.test`, displayName: "Class Email Admin", globalRole: "SYSTEM_ADMIN" } });
  await prisma.event.create({
    data: {
      id: eventId, slug: `${P}-event`, name: "Class email verification", startsAt: new Date(real.getTime() + 10 * DAY), endsAt: new Date(real.getTime() + 12 * DAY),
      isPublished: true, registrationOpensOn: ymd(new Date(real.getTime() - 30 * DAY)), registrationClosesOn: ymd(new Date(real.getTime() + 8 * DAY)),
      billingMode: "DEFERRED_ORGANIZATION_INVOICE", audience: "CLUB", waitlistEnabled: false,
    },
  });
  await prisma.organization.create({ data: { id: orgId, type: "CLUB", name: "Synthetic Pathfinders", normalizedName: "synthetic pathfinders" } });
  const session = await prisma.honorSession.create({ data: { eventId, name: "Sabbath afternoon", normalizedName: "sabbath afternoon" } });
  const makeClass = async (n: number, capacity: number) => {
    const honorId = `${P}_honor_${n}`;
    await prisma.honor.create({ data: { id: honorId, code: `HCE-${n}`, name: `Class email honor ${n}`, normalizedName: `class email honor ${n}` } });
    return (await prisma.honorOffering.create({ data: { eventId, honorId, sessionId: session.id, span: "SINGLE_SESSION", capacity, location: "Room 1" }, select: { id: true } })).id;
  };
  const knots = await makeClass(1, 5);
  const birds = await makeClass(2, 5);
  const holder = await prisma.person.create({ data: { id: `${P}_holder`, firstName: "Holder", lastName: "Sample" } });
  await prisma.registration.create({ data: { id: regId, eventId, accountHolderPersonId: holder.id, confirmationCode: `REG-${P}`, status: "SUBMITTED", totalAmount: 0, submittedAt: real } });
  await prisma.clubEventRegistration.create({ data: { eventId, organizationId: orgId, registrationId: regId } });
  const attendee: Record<string, string> = {};
  for (const [name, age] of [["y1", 12], ["y2", 13], ["y3", 11]] as const) {
    const person = await prisma.person.create({ data: { id: `${P}_p_${name}`, firstName: "Kid", lastName: name } });
    attendee[name] = (await prisma.registrationAttendee.create({
      data: {
        eventId, registrationId: regId, personId: person.id, attendeeType: "YOUTH", position: Number(name.slice(1)),
        profileSnapshot: { firstName: "Kid", lastName: name, ageOnEventDate: age, birthDate: birthSecret, temporaryAttendeeType: "YOUTH" },
      },
      select: { id: true },
    })).id;
  }

  // Instructors of the Knots class, one of each kind (and one of the Birds class to prove the others aren't told).
  const makeInstructor = async (name: string, options: { mode?: "DAILY" | "IMMEDIATE" | "OFF"; accepted?: boolean; revoked?: boolean; classes?: string[] } = {}) => {
    const email = `${P}-${name}@example.test`;
    const person = await prisma.person.create({ data: { id: `${P}_i_${name}`, firstName: name, lastName: "Instructor", normalizedEmail: email } });
    const row = await prisma.honorInstructor.create({
      data: {
        eventId, personId: person.id, email, name: `${name} Instructor`, classChangeEmails: options.mode ?? "DAILY",
        acceptedAt: options.accepted === false ? null : new Date(real.getTime() - 5 * DAY), revokedAt: options.revoked ? new Date(real.getTime() - DAY) : null,
        classes: { create: (options.classes ?? [knots]).map((offeringId) => ({ offeringId })) },
      },
      select: { id: true },
    });
    return { id: row.id, email };
  };
  const daily = await makeInstructor("daily");
  const immediate = await makeInstructor("immediate", { mode: "IMMEDIATE" });
  const off = await makeInstructor("off", { mode: "OFF" });
  const revoked = await makeInstructor("revoked", { revoked: true });
  const pending = await makeInstructor("pending", { accepted: false });
  const birdsOnly = await makeInstructor("birds", { classes: [birds] });
  const mail = (templateKey: string, email: string) => prisma.messageOutbox.findMany({ where: { eventId, templateKey: templateKey as never, recipientEmail: email }, orderBy: { createdAt: "asc" } });
  const allMail = () => prisma.messageOutbox.count({ where: { eventId, templateKey: { in: ["HONOR_INSTRUCTOR_CLASS_SUMMARY", "HONOR_INSTRUCTOR_CLASS_CHANGE"] } } });
  const director = { accountId: `${P}-director` };
  const pick = (name: string, classIds: string[], at: Date) => setClassSelections(orgId, eventId, director, { [attendee[name]!]: classIds }, at);

  // Each morning is 6:05 AM Central on a Central calendar day, never a fixed 24-hour step: a daylight saving change (1 Nov)
  // would otherwise land a morning at 5:05, before the summary window opens. The first is the morning after now.
  const noonToday = centralInstant(centralDateKey(real), 12);
  const morningOn = (days: number) => new Date(centralInstant(centralDateKey(new Date(noonToday.getTime() + days * DAY)), 6).getTime() + 5 * 60 * 1000);
  const [morning1, morning2, morning3, morning4] = [1, 2, 3, 4].map(morningOn) as [Date, Date, Date, Date];
  const tomorrowKey = centralDateKey(morning1);
  assert(classSummaryWindow(morning1).due && !classSummaryWindow(new Date(morning1.getTime() - 10 * 60 * 1000)).due, "the window opens at 6:00 AM Central plus a short grace");

  // ---------------------------------------------------------------- each real path writes its change rows
  await pick("y1", [knots], real);
  await pick("y2", [knots], new Date(real.getTime() + 1000));
  await pick("y1", [], new Date(real.getTime() + 2000)); // y1 joins then leaves: nets out of the summary
  await pick("y3", [knots, ], new Date(real.getTime() + 3000));
  await pick("y3", [knots], new Date(real.getTime() + 4000)); // unchanged: no row
  const rows = await prisma.honorClassChange.findMany({ where: { eventId }, orderBy: { at: "asc" } });
  assert(rows.map((row) => row.kind).join(",") === "JOINED,JOINED,LEFT,JOINED", `a pick save logs each join and leave, once (got ${rows.map((row) => row.kind).join(",")})`);
  assert(rows.every((row) => row.offeringId === knots && row.clubName === "Synthetic Pathfinders" && row.enrollmentId), "each row names the class, the club and the enrollment");
  assert(rows[0]!.youthName === "Kid y1" && rows[0]!.ageOnEventDate === 12, "and the youth's name and age");
  assert(!JSON.stringify(rows).includes(birthSecret), "and never a birth date");
  console.log("ok  a director's pick save writes a change row for every join and leave, in its own transaction");

  // ---------------------------------------------------------------- right away
  const immediateMail = await mail("HONOR_INSTRUCTOR_CLASS_CHANGE", immediate.email);
  assert(immediateMail.length === 4, `the right-away instructor got one email per change after each commit (got ${immediateMail.length})`);
  assert(immediateMail.some((message) => message.subjectSnapshot === "Kid y1 left Class email honor 1"), "one says who left");
  assert(immediateMail.every((message) => !message.bodyTextSnapshot.includes(birthSecret) && !/birth/i.test(message.bodyTextSnapshot)), "none carries a birth date");
  assert(immediateMail.every((message) => message.bodyTextSnapshot.includes("/account/instructor/")), "each links to the class list");
  const stamped = await prisma.honorClassChange.count({ where: { eventId, immediateHandledAt: { not: null } } });
  assert(stamped === 4, "every change is stamped once its right-away emails were queued");
  for (const other of [daily, off, revoked, pending, birdsOnly]) {
    assert((await mail("HONOR_INSTRUCTOR_CLASS_CHANGE", other.email)).length === 0, `${other.email} gets no right-away email`);
  }
  console.log("ok  a right-away instructor gets one email per change; daily, OFF, revoked, not-accepted and other-class instructors get none");

  // ---------------------------------------------------------------- the daily summary
  const sweepBeforeDue = await sendDueClassChangeEmails(new Date(morning1.getTime() - 20 * 60 * 1000));
  assert(!sweepBeforeDue.summaries.due && (await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email)).length === 0, "nothing goes before 6:00 AM Central");
  // Switch off: nothing is queued or stamped, and nothing is lost.
  await prisma.notificationSetting.create({ data: { key, enabled: false } });
  resetNotificationSettingsCache();
  const switchedOff = await sendDueClassChangeEmails(morning1);
  assert(switchedOff.status === "SWITCHED_OFF" && (await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email)).length === 0, "the staff switch stops the summary");
  assert((await prisma.honorInstructor.findUniqueOrThrow({ where: { id: daily.id } })).classChangeSummaryAt === null, "and stamps nothing, so the changes wait");
  await prisma.notificationSetting.deleteMany({ where: { key } });
  resetNotificationSettingsCache();

  // Several sweeps at once, then again: exactly one summary.
  await Promise.all([sendDueClassChangeEmails(morning1), sendDueClassChangeEmails(morning1), sendDueClassChangeEmails(morning1)]);
  await sendDueClassChangeEmails(morning1);
  await sendDueClassChangeEmails(new Date(morning1.getTime() + 5 * HOUR));
  const summaries = await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email);
  assert(summaries.length === 1, `one summary however many sweeps run (got ${summaries.length})`);
  const text = summaries[0]!.bodyTextSnapshot;
  assert(text.includes("Joined: Kid y2 (Synthetic Pathfinders, age 13)") && text.includes("Joined: Kid y3 (Synthetic Pathfinders, age 11)"), "it names who joined, with club and age");
  assert(!text.includes("Kid y1"), "a youth who joined and left the same day isn't in it");
  assert(text.includes("Now 2 of 5 seats.") && text.includes("/account/instructor/"), "it has the count against the class limit and a link");
  assert(!text.includes(birthSecret) && !/birth/i.test(text), "and no birth date");
  assert(summaries[0]!.idempotencyKey === `honor-class-change-summary:${daily.id}:${tomorrowKey}`, "keyed by instructor and Central date");
  for (const other of [immediate, off, revoked, pending, birdsOnly]) {
    assert((await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", other.email)).length === 0, `${other.email} gets no summary`);
  }
  console.log("ok  one daily summary nets a join and a leave, with count and link, however many sweeps run at once; the staff switch holds it");

  // A quiet day sends nothing.
  await sendDueClassChangeEmails(morning2);
  assert((await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email)).length === 1, "no email when nothing changed");

  // ---------------------------------------------------------------- a removal by a system administrator
  const y2Pick = await prisma.honorEnrollment.findFirstOrThrow({ where: { registrationAttendeeId: attendee.y2, offeringId: knots }, select: { id: true } });
  await removePickAsAdministrator(eventId, adminId, { enrollmentId: y2Pick.id, reason: "Synthetic: family request" }, new Date(morning2.getTime() + HOUR));
  const leaveRow = await prisma.honorClassChange.findFirstOrThrow({ where: { eventId, enrollmentId: y2Pick.id, kind: "LEFT" } });
  assert(leaveRow.youthName === "Kid y2" && leaveRow.ageOnEventDate === 13, "an administrator's removal writes a leave row");
  assert((await mail("HONOR_INSTRUCTOR_CLASS_CHANGE", immediate.email)).length === 5, "and the right-away instructor hears at once");
  await sendDueClassChangeEmails(morning3);
  const second = await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email);
  assert(second.length === 2 && second[1]!.bodyTextSnapshot.includes("Left: Kid y2") && !second[1]!.bodyTextSnapshot.includes("Joined:"), "the next summary has only what happened since");
  console.log("ok  an administrator's removal is logged, mailed right away, and summarized once the next morning");

  // ---------------------------------------------------------------- a cancelled registration leaves every class list
  await cancelRegistration(eventId, regId, adminId, "Synthetic cancellation", new Date(morning3.getTime() + HOUR));
  const cancelRows = await prisma.honorClassChange.findMany({ where: { eventId, kind: "LEFT", at: { gte: new Date(morning3.getTime() + HOUR) } } });
  assert(cancelRows.length === 1 && cancelRows[0]!.youthName === "Kid y3", "cancelling the registration logs the leave of the pick still on the class list");
  await sendDueClassChangeEmails(morning4);
  const third = await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email);
  assert(third.length === 3 && third[2]!.bodyTextSnapshot.includes("Left: Kid y3") && third[2]!.bodyTextSnapshot.includes("Now 0 of 5 seats."), "the daily summary reports it");
  console.log("ok  a cancelled registration's picks leave the class list and are reported");

  // ---------------------------------------------------------------- choosing, and a paused event
  await setInstructorClassChangeEmails(`${P}_none`, daily.id, "OFF").then(() => assert(false, "only the instructor's own account can choose"), (error: { code?: string }) => assert(error.code === "NOT_ASSIGNED", "another account is refused"));
  await prisma.honorInstructor.update({ where: { id: daily.id }, data: { attendeeAccountId: null } });
  const account = await prisma.attendeeAccount.create({ data: { id: `${P}_acct`, email: `${P}-daily@example.test`, displayName: "Daily Instructor", status: "ACTIVE", emailVerifiedAt: new Date() }, select: { id: true } });
  await prisma.honorInstructor.update({ where: { id: daily.id }, data: { attendeeAccountId: account.id } });
  await setInstructorClassChangeEmails(account.id, daily.id, "OFF");
  assert((await prisma.honorInstructor.findUniqueOrThrow({ where: { id: daily.id } })).classChangeEmails === "OFF", "the instructor turns the emails off");
  await setInstructorClassChangeEmails(account.id, daily.id, "DAILY", new Date(morning4.getTime() + HOUR));
  assert((await prisma.honorInstructor.findUniqueOrThrow({ where: { id: daily.id } })).classChangeSummaryAt!.getTime() === morning4.getTime() + HOUR, "coming back to the daily summary starts it from then");

  await prisma.eventMessageSettings.create({ data: { eventId, senderName: "IMSDA Events", deliveryPaused: true, deliveryPausedAt: new Date() } });
  await prisma.registration.update({ where: { id: regId }, data: { status: "SUBMITTED", cancelledAt: null } });
  await prisma.honorEnrollment.deleteMany({ where: { eventId } });
  await prisma.honorClassChange.create({
    data: { eventId, offeringId: knots, enrollmentId: `${P}_e`, registrationAttendeeId: attendee.y1!, kind: "JOINED", youthName: "Kid y1", clubName: null, ageOnEventDate: 12, at: new Date(morning4.getTime() + 2 * HOUR) },
  });
  const before = await allMail();
  await sendDueClassChangeEmails(new Date(morning4.getTime() + DAY));
  const suppressed = await prisma.messageOutbox.findMany({ where: { eventId, status: "SUPPRESSED", templateKey: { in: ["HONOR_INSTRUCTOR_CLASS_SUMMARY", "HONOR_INSTRUCTOR_CLASS_CHANGE"] } } });
  assert(suppressed.length >= 1 && (await allMail()) > before, "a paused event's instructor emails are recorded as suppressed, never queued to send");
  console.log("ok  an instructor's choice is theirs alone; a paused event's emails are suppressed");

  // ---------------------------------------------------------------- leaving the daily summary, and retention
  await prisma.eventMessageSettings.deleteMany({ where: { eventId } });
  const later = new Date(morning4.getTime() + 2 * DAY);
  await prisma.honorClassChange.create({
    data: { eventId, offeringId: knots, enrollmentId: `${P}_e2`, registrationAttendeeId: attendee.y3!, kind: "LEFT", youthName: "Kid y9", clubName: null, ageOnEventDate: 10, at: new Date(morning4.getTime() + DAY + HOUR) },
  });
  const stale = await prisma.honorClassChange.create({
    data: { eventId, offeringId: knots, enrollmentId: `${P}_e3`, registrationAttendeeId: attendee.y3!, kind: "JOINED", youthName: "Kid old", clubName: null, ageOnEventDate: 10, at: new Date(real.getTime() - 9 * DAY), immediateHandledAt: real },
    select: { id: true },
  });
  const summariesBefore = (await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email)).length;
  await setInstructorClassChangeEmails(account.id, daily.id, "IMMEDIATE", later);
  const afterSwitch = await mail("HONOR_INSTRUCTOR_CLASS_SUMMARY", daily.email);
  assert(afterSwitch.length === summariesBefore + 1 && afterSwitch[afterSwitch.length - 1]!.bodyTextSnapshot.includes("Kid y9"), "leaving the daily summary sends one last summary of what changed since the previous one");
  assert((await prisma.honorInstructor.findUniqueOrThrow({ where: { id: daily.id } })).classChangeSummaryAt!.getTime() === later.getTime(), "and moves the summary point");
  await sendDueClassChangeEmails(later);
  assert((await prisma.honorClassChange.count({ where: { id: stale.id } })) === 0, "the sweep deletes change rows older than eight days");
  assert((await prisma.honorClassChange.count({ where: { eventId } })) > 0, "and keeps the recent ones");
  await prisma.event.update({ where: { id: eventId }, data: { endsAt: new Date(later.getTime() - 20 * DAY), startsAt: new Date(later.getTime() - 22 * DAY) } });
  const pruned = await sendDueClassChangeEmails(later);
  assert(pruned.pruned > 0 && (await prisma.honorClassChange.count({ where: { eventId } })) === 0, "and every row of an event whose roster has closed");
  console.log("ok  leaving the daily summary sends a final one; the sweep deletes old rows and those of a closed roster");

  await cleanup();
  console.log("honor class emails verified");
}

main()
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
