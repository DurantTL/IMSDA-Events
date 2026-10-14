/**
 * Proves deadline reminders (#910) against a real PostgreSQL database, with
 * fictitious rows it creates and removes itself and no real email (the delivery
 * adapter is a stand-in that only records addresses):
 *
 * - auto-marking: imported items that say they are due become Deadlines, the
 *   rest do not; an unchanged refresh writes nothing; an item imported before
 *   deadlines existed is marked by the next refresh; a type staff set (single
 *   or bulk) survives refreshes, including title changes; "reset to source"
 *   re-reads the rule;
 * - Deadlines are left off the public calendar data and the .ics feed;
 * - the "Upcoming deadlines" list: published, visible, uncancelled Deadlines,
 *   7 days back as overdue to 90 days ahead, in conference dates;
 * - reminder timing in the conference time zone: nothing before the 14-day
 *   point, one batch when it arrives (incl. the November and March daylight-
 *   saving boundaries), the 2-day batch replacing an unsent 14-day one, and
 *   nothing after the due date;
 * - never twice: repeated and concurrent runs prepare one batch, the unique
 *   key and the 14/2 check constraint hold in the database;
 * - the approval gate: preparing, previewing and sweeping queue nothing; a send
 *   needs the previewed fingerprint; one send queues one email per person, once
 *   (two racing clicks send once), and only then does delivery run;
 * - recipients: active club roles and lasting Area Coordinators, one email per
 *   person, never revoked, ended, future, disabled, unverified, inactive-club,
 *   or temporary-coordinator accounts; a person who opted out of all
 *   announcements is still included (deadlines are essential, #915);
 * - repeating deadlines (#915): each occurrence gets its own batch, only the
 *   next occurrence is prepared, a passed one is withdrawn, none is duplicated;
 * - a deadline that changes date, is cancelled, hidden or un-marked before
 *   approval updates or withdraws its batch (and an approval attempt on a
 *   withdrawn one sends nothing); a restored deadline revives the same batch.
 *
 *   npm run test:deadline-reminders
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
// Synthetic values for this run only; nothing here reaches a real provider.
process.env.SECRET_ENCRYPTION_KEY ||= "verify-deadline-reminders-synthetic-key-not-a-secret";
process.env.ACCOUNT_EMAIL_SENDER_ADDRESS = "events@example.test";
process.env.RESEND_API_KEY = "synthetic-key-not-a-secret";
process.env.APP_BASE_URL = "https://events.example.test";

const prisma = new PrismaClient();
const P = "dlr";
const adminId = `${P}_admin`;
const domain = "dlr.example.test";
const feedUrl = "https://calendar.example.test/ical/dlr-synthetic/basic.ics";
const clubA = `${P}_club_a`;
const clubB = `${P}_club_b`;
const clubInactive = `${P}_club_inactive`;
const accountOf = (key: string) => `${P}_acct_${key}`;
const emailOf = (key: string) => `${key}@${domain}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  const batchIds = (await prisma.deadlineReminderBatch.findMany({ where: { title: { startsWith: "DLR " } }, select: { id: true } })).map((batch) => batch.id);
  for (const id of batchIds) await prisma.messageOutbox.deleteMany({ where: { idempotencyKey: { startsWith: `deadline-reminder:${id}:` } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: adminId }, { entityType: "DeadlineReminderBatch", entityId: { in: batchIds } }] } });
  await prisma.deadlineReminderBatch.deleteMany({ where: { title: { startsWith: "DLR " } } });
  await prisma.calendarEntry.deleteMany({ where: { OR: [{ createdByUserId: adminId }, { title: { startsWith: "DLR " } }] } });
  await prisma.calendarFeed.deleteMany({ where: { createdByUserId: adminId } });
  await prisma.emailAnnouncementOptOut.deleteMany({ where: { normalizedEmail: { endsWith: `@${domain}` } } });
  await prisma.clubDirectorGrant.deleteMany({ where: { attendeeAccountId: { startsWith: `${P}_acct_` } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { startsWith: `${P}_acct_` } } });
  await prisma.organization.deleteMany({ where: { id: { startsWith: `${P}_club_` } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
}

const ics = (events: Array<{ uid: string; title: string; day: string }>) => [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//Deadline Reminders//EN",
  ...events.flatMap(({ uid, title, day: date }) => [
    "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20261001T000000Z", `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${date}`, `SUMMARY:${title}`, "END:VEVENT",
  ]),
  "END:VCALENDAR",
].join("\r\n");

async function main() {
  const { calendarDateIn, addDays, buildCalendarIcs } = await import("../modules/calendar/domain");
  const { createCalendarFeed, syncCalendarFeed, resetCalendarEntryToSource } = await import("../modules/calendar/feeds");
  const { bulkUpdateCalendarEntries, updateCalendarEntry, listPublicCalendarItems } = await import("../modules/calendar/repository");
  const { calendarBulkSchema, calendarEntryUpdateSchema } = await import("../modules/calendar/schemas");
  const { listUpcomingDeadlines } = await import("../modules/calendar/deadline-list");
  const {
    reconcileDeadlineReminders, listPendingReminderBatches, sendReminderBatch, dismissReminderBatch, loadReminderRecipients, DeadlineReminderError,
  } = await import("../modules/calendar/deadline-reminders");
  const { processAccountEmailQueue } = await import("../modules/communications/email-delivery");

  await cleanup();
  await prisma.user.create({ data: { id: adminId, email: `admin@${domain}`, displayName: "Deadline Check Admin", globalRole: "SYSTEM_ADMIN" } });

  const realNow = new Date();
  const today = calendarDateIn(realNow);
  const create = (title: string, startsOn: string, patch: Record<string, unknown> = {}) =>
    prisma.calendarEntry.create({
      data: { title: `DLR ${title}`, startsOn, endsOn: startsOn, entryType: "DEADLINE", isPublished: true, createdByUserId: adminId, updatedByUserId: adminId, ...patch },
    });
  const batchesOf = (entryId: string) => prisma.deadlineReminderBatch.findMany({ where: { calendarEntryId: entryId }, orderBy: { daysBefore: "desc" } });
  const outboxOf = (batchId: string) => prisma.messageOutbox.findMany({ where: { idempotencyKey: { startsWith: `deadline-reminder:${batchId}:` } } });
  const caught = async (promise: Promise<unknown>) => {
    try { await promise; return null; } catch (error) { return error; }
  };

  // ---- 1. Auto-marking, staff overrides, and a refresh --------------------------------------------------
  let feedBody = ics([
    { uid: "a@dlr.test", title: "DLR Spring Camporee Registration Due", day: "20261201" },
    { uid: "b@dlr.test", title: "DLR All points and Investiture Reports are Due", day: "20261202" },
    { uid: "c@dlr.test", title: "DLR Pathfinder and TLT of the Year Nominations Deadline", day: "20261203" },
    { uid: "d@dlr.test", title: "DLR Fall Camporee", day: "20261204" },
    { uid: "e@dlr.test", title: "DLR Office closed due to weather", day: "20261205" },
  ]);
  const resolve = async () => ["93.184.216.34"];
  const transport = async () => ({ status: 200, location: null, body: feedBody });
  await createCalendarFeed({ name: "Deadline check feed", url: feedUrl, defaultCategory: "", defaultEntryType: "STANDARD", publishNewItems: false, isEnabled: true, refreshMinutes: 60 }, adminId);
  const feed = await prisma.calendarFeed.findFirstOrThrow({ where: { createdByUserId: adminId } });
  const sync = () => syncCalendarFeed(feed.id, { actorUserId: adminId, transport, resolve });
  await sync();
  const imported = async () => Object.fromEntries((await prisma.calendarEntry.findMany({ where: { sourceFeedId: feed.id } })).map((row) => [row.sourceUid!.split("@")[0], row]));
  let rows = await imported();
  assert(["a", "b", "c"].every((key) => rows[key].entryType === "DEADLINE"), "items saying due or deadline import as Deadlines");
  assert(rows.d.entryType === "STANDARD" && rows.e.entryType === "STANDARD", "an ordinary item and a 'due to weather' item import as Standard");
  const quiet = await sync();
  assert(quiet.create === 0 && quiet.update === 0 && quiet.remove === 0, `an unchanged refresh changes nothing, got ${JSON.stringify(quiet)}`);
  console.log("ok  imported 'due' items become Deadlines, and an unchanged refresh writes nothing");

  // An item already on the calendar before deadlines existed (Standard, no staff mark) is NOT silently re-typed by a
  // refresh; it is typed when its title changes in the feed, and the refresh reports what it marked.
  await prisma.calendarEntry.update({ where: { id: rows.a.id }, data: { entryType: "STANDARD" } });
  const untouched = await sync();
  assert(untouched.update === 0 && untouched.markedDeadline === 0, `a refresh leaves an existing item's type alone, got ${JSON.stringify(untouched)}`);
  assert((await imported()).a.entryType === "STANDARD", "the existing item stays Standard");
  feedBody = ics([
    { uid: "a@dlr.test", title: "DLR Spring Camporee Registration Due (extended)", day: "20261201" },
    { uid: "b@dlr.test", title: "DLR All points and Investiture Reports are Due", day: "20261202" },
    { uid: "c@dlr.test", title: "DLR Pathfinder and TLT of the Year Nominations Deadline", day: "20261203" },
    { uid: "d@dlr.test", title: "DLR Fall Camporee", day: "20261204" },
    { uid: "e@dlr.test", title: "DLR Office closed due to weather", day: "20261205" },
  ]);
  const retitled = await sync();
  assert(retitled.markedDeadline === 1, `a changed title that says due is marked and counted, got ${JSON.stringify(retitled)}`);
  assert((await imported()).a.entryType === "DEADLINE", "the retitled item is now a Deadline");
  console.log("ok  an existing item is not silently re-typed; a changed title is, and the refresh counts it");

  // Staff clear Deadline on b, and make d a Deadline; neither is undone by a refresh, even when titles change.
  await updateCalendarEntry(rows.b.id, calendarEntryUpdateSchema.parse({ entryType: "STANDARD" }), adminId);
  await updateCalendarEntry(rows.d.id, calendarEntryUpdateSchema.parse({ entryType: "DEADLINE" }), adminId);
  rows = await imported();
  assert(rows.b.entryType === "STANDARD" && rows.b.locallyEditedFields.includes("entryType"), "staff clearing Deadline is recorded as their choice");
  assert(rows.d.entryType === "DEADLINE" && rows.d.locallyEditedFields.includes("entryType"), "staff making a Deadline is recorded as their choice");
  // A save that leaves the type alone does not freeze it.
  await updateCalendarEntry(rows.c.id, calendarEntryUpdateSchema.parse({ entryType: "DEADLINE", location: "Somewhere" }), adminId);
  assert(!(await imported()).c.locallyEditedFields.includes("entryType"), "saving without changing the type does not mark it");
  feedBody = ics([
    { uid: "a@dlr.test", title: "DLR Spring Camporee Registration Due (extended)", day: "20261201" },
    { uid: "b@dlr.test", title: "DLR All points and Investiture Reports are Due (new date)", day: "20261202" },
    { uid: "c@dlr.test", title: "DLR Pathfinder and TLT of the Year Nominations", day: "20261203" },
    { uid: "d@dlr.test", title: "DLR Fall Camporee Registration Due", day: "20261204" },
    { uid: "e@dlr.test", title: "DLR Office closed due to weather", day: "20261205" },
  ]);
  await sync();
  rows = await imported();
  assert(rows.b.entryType === "STANDARD" && rows.b.title.endsWith("(new date)"), "a refresh keeps the type staff cleared while taking the new title");
  assert(rows.d.entryType === "DEADLINE", "a refresh keeps the Deadline staff made");
  assert(rows.c.entryType === "STANDARD", "an untouched item follows its title back to Standard");
  console.log("ok  a refresh never overrides a type staff chose, and follows the title otherwise");

  // Bulk set and clear.
  const markBulk = await bulkUpdateCalendarEntries(calendarBulkSchema.parse({ ids: [rows.e.id, rows.d.id], change: { action: "markDeadline" } }), adminId);
  assert(markBulk.result.changed === 1 && markBulk.result.skipped.length === 1, `bulk Mark skips the one that already is, got ${JSON.stringify(markBulk.result)}`);
  rows = await imported();
  assert(rows.e.entryType === "DEADLINE" && rows.e.locallyEditedFields.includes("entryType"), "bulk Mark makes a Deadline and records staff's choice");
  await sync();
  assert((await imported()).e.entryType === "DEADLINE", "a refresh keeps the bulk-marked Deadline");
  await bulkUpdateCalendarEntries(calendarBulkSchema.parse({ ids: [rows.e.id], change: { action: "clearDeadline" } }), adminId);
  await sync();
  assert((await imported()).e.entryType === "STANDARD", "bulk Clear sticks across a refresh");
  // Reset to source forgets the choice and reads the rule again.
  await resetCalendarEntryToSource(rows.b.id, adminId, { transport, resolve });
  assert((await imported()).b.entryType === "STANDARD" && (await imported()).b.locallyEditedFields.includes("entryType"), "reset to source keeps the Deadline/Standard type staff chose, and its mark");
  console.log("ok  bulk Mark and Clear deadline, and reset to source");

  // ---- 2. Public exclusion ------------------------------------------------------------------------------
  const publicDay = addDays(today, 20);
  const publicDeadline = await create("Public check deadline", publicDay);
  const publicOrdinary = await create("Public check ordinary", publicDay, { entryType: "STANDARD" });
  const items = await listPublicCalendarItems(addDays(today, 10), addDays(today, 40), realNow);
  const titles = items.map((item) => item.title);
  assert(titles.includes(publicOrdinary.title) && !titles.includes(publicDeadline.title), "the public calendar data lists the ordinary entry and never the Deadline");
  const feedItems = await listPublicCalendarItems(addDays(today, -60), addDays(today, 548), realNow, { expandRepeats: false });
  const feedText = buildCalendarIcs(feedItems, { baseUrl: "https://events.example.test", now: realNow });
  assert(feedText.includes(publicOrdinary.title) && !feedText.includes(publicDeadline.title), "the .ics feed lists the ordinary entry and never the Deadline");
  assert(!feedText.includes("DLR Spring Camporee Registration Due"), "no imported Deadline reaches the feed either");
  await prisma.calendarEntry.updateMany({ where: { sourceFeedId: feed.id }, data: { isPublished: true } });
  const withImports = await listPublicCalendarItems("2026-11-01", "2026-12-31", realNow);
  const importedTitles = Object.values(await imported()).map((row) => ({ title: row.title, type: row.entryType }));
  const publicTitles = withImports.map((item) => item.title);
  assert(importedTitles.filter((row) => row.type === "DEADLINE").length >= 2 && importedTitles.filter((row) => row.type === "DEADLINE").every((row) => !publicTitles.includes(row.title)), "published imported Deadlines stay off the public calendar");
  assert(importedTitles.filter((row) => row.type !== "DEADLINE").every((row) => publicTitles.includes(row.title)), "while the published imported items that are not Deadlines (even one that says Due, if staff cleared it) are listed");
  console.log("ok  Deadlines never reach the public calendar data or the .ics feed");

  // ---- 3. The Upcoming deadlines list ---------------------------------------------------------------------
  await prisma.calendarEntry.deleteMany({ where: { sourceFeedId: feed.id } });
  const soon = await create("List soon", addDays(today, 5), { linkUrl: "https://example.test/soon" });
  const overdue = await create("List overdue", addDays(today, -3));
  await create("List long ago", addDays(today, -10));
  await create("List far", addDays(today, 100));
  await create("List cancelled", addDays(today, 6), { status: "CANCELLED" });
  await create("List hidden", addDays(today, 7), { isHiddenLocally: true });
  await create("List draft", addDays(today, 8), { isPublished: false });
  await create("List ordinary due", addDays(today, 9), { entryType: "STANDARD" });
  const listed = (await listUpcomingDeadlines(realNow)).filter((item) => item.title.startsWith("DLR List"));
  assert(JSON.stringify(listed.map((item) => item.title)) === JSON.stringify([overdue.title, soon.title]), `the list holds the overdue and the upcoming Deadline, in date order, got ${JSON.stringify(listed.map((item) => item.title))}`);
  assert(listed[0].overdue && listed[0].label === "3 days overdue", `a recent miss is overdue, got ${listed[0].label}`);
  assert(!listed[1].overdue && listed[1].label === "Due in 5 days" && listed[1].href === "https://example.test/soon", `an upcoming one says how soon and links, got ${JSON.stringify(listed[1])}`);
  console.log("ok  the upcoming deadlines list: window, order, overdue, links, and exclusions");
  await prisma.calendarEntry.deleteMany({ where: { title: { startsWith: "DLR List" } } });
  await prisma.calendarEntry.deleteMany({ where: { title: { startsWith: "DLR Public check" } } });

  // ---- 4. People ------------------------------------------------------------------------------------------
  await prisma.organization.createMany({
    data: [
      { id: clubA, type: "CLUB", name: "Dlr Club A", normalizedName: "dlr club a" },
      { id: clubB, type: "CLUB", name: "Dlr Club B", normalizedName: "dlr club b" },
      { id: clubInactive, type: "CLUB", name: "Dlr Club Inactive", normalizedName: "dlr club inactive", isActive: false },
    ],
  });
  const accountKeys = ["dira", "depa", "regb", "repb", "late", "both", "area", "revoked", "ended", "future", "inactiveclub", "disabled", "pending", "areatemp", "arearevoked", "optedout"];
  await prisma.attendeeAccount.createMany({
    data: accountKeys.map((key) => ({
      id: accountOf(key), email: emailOf(key), displayName: `Dlr ${key}`,
      status: key === "pending" ? "PENDING_VERIFICATION" as const : "ACTIVE" as const,
      disabledAt: key === "disabled" ? new Date("2026-01-01") : null,
    })),
  });
  const grant = (key: string, organizationId: string, role: "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER", patch: Record<string, unknown> = {}) =>
    prisma.clubDirectorGrant.create({ data: { organizationId, attendeeAccountId: accountOf(key), role, reason: "Synthetic check", effectiveFrom: new Date("2026-01-01"), ...patch } });
  await grant("dira", clubA, "DIRECTOR");
  await grant("depa", clubA, "DEPUTY");
  await grant("regb", clubB, "REGISTRAR");
  await grant("repb", clubB, "REPORTER");
  await grant("both", clubA, "DIRECTOR");
  await grant("late", clubB, "DIRECTOR");
  await grant("revoked", clubA, "DIRECTOR", { revokedAt: new Date("2026-02-01") });
  await grant("ended", clubA, "DIRECTOR", { effectiveTo: new Date("2026-03-01") });
  await grant("future", clubA, "DIRECTOR", { effectiveFrom: new Date("2027-06-01") });
  await grant("inactiveclub", clubInactive, "DIRECTOR");
  await grant("disabled", clubA, "DIRECTOR");
  await grant("pending", clubA, "DIRECTOR");
  await grant("optedout", clubB, "DIRECTOR");
  await prisma.areaCoordinatorGrant.createMany({
    data: [
      { attendeeAccountId: accountOf("both"), grantedByUserId: adminId },
      { attendeeAccountId: accountOf("area"), grantedByUserId: adminId },
      { attendeeAccountId: accountOf("areatemp"), grantedByUserId: adminId, expiresAt: new Date("2027-06-01") },
      { attendeeAccountId: accountOf("arearevoked"), grantedByUserId: adminId, revokedAt: new Date("2026-02-01") },
    ],
  });
  await prisma.emailAnnouncementOptOut.create({ data: { normalizedEmail: emailOf("optedout"), scope: "ALL", scopeKey: "ALL", source: "verify" } });
  const included = ["dira", "depa", "regb", "repb", "late", "both", "area", "optedout"].map(emailOf).sort();
  const excluded = ["revoked", "ended", "future", "inactiveclub", "disabled", "pending", "areatemp", "arearevoked"].map(emailOf);

  const baseline = await loadReminderRecipients(prisma, realNow);
  const mine = baseline.recipients.filter((recipient) => recipient.email.endsWith(`@${domain}`));
  assert(JSON.stringify(mine.map((recipient) => recipient.email)) === JSON.stringify(included), `recipients are the active role holders and lasting coordinators, one each, got ${JSON.stringify(mine.map((recipient) => recipient.email))}`);
  assert(excluded.every((email) => !baseline.recipients.some((recipient) => recipient.email === email)), "revoked, ended, future, inactive-club, disabled, unverified and temporary-coordinator accounts are left out");
  assert(mine.some((recipient) => recipient.email === emailOf("optedout")) && !("optedOut" in baseline), "the person who opted out of all announcements is included and not counted out");
  assert(mine.find((recipient) => recipient.email === emailOf("both"))?.audience === "CLUB" && mine.find((recipient) => recipient.email === emailOf("area"))?.audience === "AREA", "a person in both roles gets the club wording; a coordinator the area wording");
  console.log("ok  recipients: active roles and lasting coordinators only, one each, opt-outs included");

  // ---- 5. Timing (fixed dates, explicit clocks in the conference time zone) --------------------------------
  const due = await create("Timing camporee due", "2026-12-05");
  const dst = await create("Timing DST due", "2026-11-15");
  const spring = await create("Timing spring due", "2027-03-16");
  const mineOf = async (entryId: string) => (await batchesOf(entryId)).map((batch) => `${batch.daysBefore}:${batch.status}`);
  await reconcileDeadlineReminders(new Date("2026-11-21T05:59:00Z")); // Nov 20, 11:59 PM CST
  assert((await mineOf(due.id)).length === 0, "nothing is prepared before the 14-day point");
  await reconcileDeadlineReminders(new Date("2026-11-21T06:00:00Z")); // Nov 21, midnight CST
  assert(JSON.stringify(await mineOf(due.id)) === JSON.stringify(["14:PENDING"]), "the 14-day batch is prepared at Chicago midnight");
  // DST: Nov 15's 14-day point is Nov 1, the day the clocks go back.
  const beforeDst = await reconcileDeadlineReminders(new Date("2026-11-01T04:59:00Z"));
  assert((await mineOf(dst.id)).length === 0 && beforeDst.prepared === 0, "Oct 31, 11:59 PM CDT is not yet the point");
  await reconcileDeadlineReminders(new Date("2026-11-01T05:00:00Z"));
  assert(JSON.stringify(await mineOf(dst.id)) === JSON.stringify(["14:PENDING"]), "midnight CDT on Nov 1 prepares the 14-day batch");
  await reconcileDeadlineReminders(new Date("2026-11-13T05:59:00Z")); // Nov 12, 11:59 PM CST
  assert(JSON.stringify(await mineOf(dst.id)) === JSON.stringify(["14:PENDING"]), "still the 14-day point at 11:59 PM CST before the 2-day point");
  await reconcileDeadlineReminders(new Date("2026-11-13T06:00:00Z")); // Nov 13, midnight CST
  assert(JSON.stringify(await mineOf(dst.id)) === JSON.stringify(["14:WITHDRAWN", "2:PENDING"]), `the 2-day point replaces the unsent 14-day batch, got ${JSON.stringify(await mineOf(dst.id))}`);
  // Spring forward: Mar 16's 2-day point is Mar 14.
  await reconcileDeadlineReminders(new Date("2027-03-14T05:59:00Z"));
  assert(JSON.stringify(await mineOf(spring.id)) === JSON.stringify(["14:PENDING"]), "before the spring change the 14-day batch is the current one");
  await reconcileDeadlineReminders(new Date("2027-03-14T06:00:00Z"));
  assert(JSON.stringify(await mineOf(spring.id)) === JSON.stringify(["14:WITHDRAWN", "2:PENDING"]), "the 2-day batch arrives at midnight CST on the day the clocks go forward");
  // After the due date nothing is left waiting.
  await reconcileDeadlineReminders(new Date("2027-03-17T12:00:00Z"));
  assert(JSON.stringify(await mineOf(spring.id)) === JSON.stringify(["14:WITHDRAWN", "2:WITHDRAWN"]), "once the due date has passed the waiting batch is withdrawn");
  console.log("ok  reminder points arrive at Chicago midnight, across both daylight-saving changes");

  // ---- 6. Never twice -------------------------------------------------------------------------------------
  const sameClock = new Date("2026-11-25T18:00:00Z");
  const raceEntry = await create("Timing race due", "2026-12-06"); // its 14-day point (Nov 22) has come
  const racers = await Promise.all(Array.from({ length: 8 }, () => reconcileDeadlineReminders(sameClock)));
  const raced = await batchesOf(raceEntry.id);
  assert(raced.length === 1 && raced[0].daysBefore === 14 && raced[0].status === "PENDING", `eight concurrent runs leave one pending 14-day batch, got ${JSON.stringify(raced.map((batch) => batch.daysBefore))}`);
  // (The first deadline's withdrawn batch is revived by these same runs, so the total is the race entry's one plus that one.)
  assert(racers.filter((result) => result.prepared > 0).length === 1, `exactly one of the racing runs did the preparing, got ${JSON.stringify(racers)}`);
  await reconcileDeadlineReminders(sameClock);
  assert((await batchesOf(raceEntry.id)).length === 1, "and a ninth run adds nothing");
  const preparedAudits = await prisma.auditLog.count({ where: { entityType: "DeadlineReminderBatch", entityId: raced[0].id, action: "DEADLINE_REMINDER_PREPARED" } });
  assert(preparedAudits === 1, `one 'prepared' audit row, got ${preparedAudits}`);
  const duplicate = await caught(prisma.deadlineReminderBatch.create({ data: { calendarEntryId: raceEntry.id, daysBefore: 14, title: raceEntry.title, dueOn: raceEntry.endsOn } }));
  assert((duplicate as { code?: string } | null)?.code === "P2002", `the database refuses a second batch for the same deadline and point, got ${String(duplicate)}`);
  const badPoint = await caught(prisma.deadlineReminderBatch.create({ data: { calendarEntryId: raceEntry.id, daysBefore: 7, title: raceEntry.title, dueOn: raceEntry.endsOn } }));
  assert(badPoint !== null, "the database refuses a reminder point other than 14 or 2");
  console.log("ok  repeated and concurrent runs prepare one batch; the database enforces the key and the points");

  // ---- 7. The approval gate -------------------------------------------------------------------------------
  const delivered: string[] = [];
  const configuration = { apiKey: "synthetic-key-not-a-secret", apiUrl: "https://email.invalid" };
  const okSend = async (input: { toEmail: string }) => { delivered.push(input.toEmail); return { providerMessageId: `synthetic-${randomUUID()}` }; };
  const deliver = (ids: string[]) => processAccountEmailQueue({ messageIds: ids, dependencies: { sendEmail: okSend as never, configuration } });
  const second = await create("Timing second due", "2026-12-08"); // its 14-day point is Nov 24
  await reconcileDeadlineReminders(sameClock);
  const secondBatch = (await batchesOf(second.id))[0];
  assert(secondBatch?.status === "PENDING", "a second deadline has its own pending batch");
  const dueBatch = (await batchesOf(due.id))[0];
  assert(dueBatch?.status === "PENDING" && dueBatch.daysBefore === 14, "the first deadline still has its 14-day batch waiting");

  const listing = await listPendingReminderBatches(sameClock);
  const view = listing.batches.find((batch) => batch.id === dueBatch.id)!;
  assert(view && view.subject.includes("DLR Timing camporee due") && view.bodyText.includes("https://events.example.test/account/clubs"), "the preview shows the subject, the text and the portal link");
  const myRecipients = view.recipientCount;
  assert(myRecipients >= included.length && !("optedOutCount" in view), "the preview counts the recipients and no longer counts opt-outs");
  assert(await prisma.messageOutbox.count({ where: { idempotencyKey: { startsWith: "deadline-reminder:" }, recipientEmail: { endsWith: `@${domain}` } } }) === 0, "preparing and previewing queued nothing");
  assert(delivered.length === 0, "and nothing was delivered");

  const stale = await caught(sendReminderBatch(dueBatch.id, { fingerprint: "0".repeat(64) }, adminId, sameClock));
  assert(stale instanceof DeadlineReminderError && stale.code === "BATCH_CHANGED", `a send without the previewed fingerprint is refused, got ${String(stale)}`);
  assert((await outboxOf(dueBatch.id)).length === 0, "the refused send queued nothing");

  const sent = await sendReminderBatch(dueBatch.id, { fingerprint: view.fingerprint }, adminId, sameClock);
  const rowsSent = await outboxOf(dueBatch.id);
  assert(sent.sent === myRecipients && rowsSent.length === myRecipients, `one email per recipient, got ${rowsSent.length} of ${myRecipients}`);
  const sentTo = rowsSent.map((row) => row.recipientEmail);
  assert(included.every((email) => sentTo.includes(email)), "every included person is queued");
  assert(excluded.every((email) => !sentTo.includes(email)), "no excluded person is queued");
  assert(new Set(sentTo).size === sentTo.length, "nobody is queued twice");
  assert(rowsSent.every((row) => row.eventId === null && row.templateKey === "DEADLINE_REMINDER" && row.status === "PENDING"), "event-less account email, still pending delivery");
  assert(delivered.length === 0, "queued is not delivered: delivery runs after the commit");
  const areaRow = rowsSent.find((row) => row.recipientEmail === emailOf("area"))!;
  assert(areaRow.bodyTextSnapshot.includes("/account/area-clubs/overview") && rowsSent.find((row) => row.recipientEmail === emailOf("dira"))!.bodyTextSnapshot.includes("/account/clubs"), "each audience gets its own portal link");
  assert(areaRow.subjectSnapshot.startsWith("Deadline reminder: DLR Timing camporee due"), "the subject names the deadline");
  const decided = await prisma.deadlineReminderBatch.findUniqueOrThrow({ where: { id: dueBatch.id } });
  assert(decided.status === "SENT" && decided.decidedByUserId === adminId && decided.recipientCount === myRecipients, "the batch records who sent it and how many");
  const sendAudit = await prisma.auditLog.findMany({ where: { entityType: "DeadlineReminderBatch", entityId: dueBatch.id, action: "DEADLINE_REMINDER_SENT" } });
  assert(sendAudit.length === 1 && sendAudit[0].actorUserId === adminId && !JSON.stringify(sendAudit[0]).includes(domain), "one audit row names the approver and holds no addresses");
  const mineIds = rowsSent.filter((row) => row.recipientEmail.endsWith(`@${domain}`)).map((row) => row.id);
  // Someone opts out of all announcements after staff clicked Send, while the reminder waits in the queue: deadlines are
  // essential (#915), so it is still delivered, along with everyone else.
  await prisma.emailAnnouncementOptOut.create({ data: { normalizedEmail: emailOf("late"), scope: "ALL", scopeKey: "ALL", source: "verify" } });
  await deliver(mineIds);
  assert(included.every((email) => delivered.includes(email)) && excluded.every((email) => !delivered.includes(email)), "delivery reaches every included address, opted-out ones too, and no excluded one");
  assert((await prisma.messageOutbox.findMany({ where: { id: { in: mineIds } } })).every((row) => row.status === "SENT"), "every row, including the opted-out people's, is recorded as sent");
  console.log("ok  nothing is queued before approval; one send queues one email per eligible person and is audited");

  const again = await caught(sendReminderBatch(dueBatch.id, { fingerprint: view.fingerprint }, adminId, sameClock));
  assert(again instanceof DeadlineReminderError && again.code === "BATCH_NOT_PENDING", "a sent batch cannot be sent again");
  await reconcileDeadlineReminders(sameClock);
  assert((await batchesOf(due.id)).length === 1 && (await outboxOf(dueBatch.id)).length === myRecipients, "a later run never prepares or sends it again");
  // Two administrators click Send on the same batch at once.
  const listing2 = await listPendingReminderBatches(sameClock);
  const view2 = listing2.batches.find((batch) => batch.id === secondBatch.id)!;
  const clicks = await Promise.allSettled([
    sendReminderBatch(secondBatch.id, { fingerprint: view2.fingerprint }, adminId, sameClock),
    sendReminderBatch(secondBatch.id, { fingerprint: view2.fingerprint }, adminId, sameClock),
  ]);
  assert(clicks.filter((result) => result.status === "fulfilled").length === 1, "two racing clicks send exactly once");
  assert((await outboxOf(secondBatch.id)).length === view2.recipientCount, "and queue one email per person");
  // A dismissed batch is never sent or prepared again.
  const dismissEntry = await create("Timing dismiss due", "2026-12-09"); // 14-day point Nov 25
  await reconcileDeadlineReminders(sameClock);
  const dismissed = (await batchesOf(dismissEntry.id))[0];
  assert(dismissed?.status === "PENDING", "a third deadline has a waiting batch");
  await dismissReminderBatch(dismissed.id, adminId, sameClock);
  await reconcileDeadlineReminders(sameClock);
  assert(JSON.stringify(await mineOf(dismissEntry.id)) === JSON.stringify(["14:DISMISSED"]) && (await outboxOf(dismissed.id)).length === 0, "a dismissed batch stays dismissed and sends nothing");
  // The deadline's date moves after the 14-day batch was sent: that point is prepared again for the new date; and the
  // database key is per due date. A dismissed point is prepared again when the entry moves to next year.
  await prisma.calendarEntry.update({ where: { id: second.id }, data: { startsOn: "2026-12-15", endsOn: "2026-12-15" } });
  await reconcileDeadlineReminders(new Date("2026-12-02T18:00:00Z")); // the new 14-day point (Dec 1) has come
  assert(JSON.stringify((await batchesOf(second.id)).map((batch) => `${batch.dueOn}:${batch.daysBefore}:${batch.status}`).sort()) === JSON.stringify(["2026-12-08:14:SENT", "2026-12-15:14:PENDING"]), `a moved deadline gets its point again after a sent batch, got ${JSON.stringify((await batchesOf(second.id)).map((batch) => `${batch.dueOn}:${batch.status}`))}`);
  await prisma.calendarEntry.update({ where: { id: dismissEntry.id }, data: { startsOn: "2027-12-09", endsOn: "2027-12-09" } });
  await reconcileDeadlineReminders(new Date("2027-11-26T18:00:00Z"));
  assert(JSON.stringify((await batchesOf(dismissEntry.id)).map((batch) => `${batch.dueOn}:${batch.status}`).sort()) === JSON.stringify(["2026-12-09:DISMISSED", "2027-12-09:PENDING"]), "an entry moved to next year gets its dismissed point again");
  const sameDate = await caught(prisma.deadlineReminderBatch.create({ data: { calendarEntryId: second.id, daysBefore: 14, title: second.title, dueOn: "2026-12-15" } }));
  assert((sameDate as { code?: string } | null)?.code === "P2002", "the key is still per deadline, point and due date");
  // At the 2-day point the sent 14-day batch stays; a 2-day batch is prepared.
  await reconcileDeadlineReminders(new Date("2026-12-03T06:00:00Z"));
  assert(JSON.stringify(await mineOf(due.id)) === JSON.stringify(["14:SENT", "2:PENDING"]), `the 2-day batch follows a sent 14-day one, got ${JSON.stringify(await mineOf(due.id))}`);
  console.log("ok  a sent batch is final, racing clicks send once, a dismissed batch stays dismissed, the 2-day batch follows a sent 14-day one");

  // The email-not-configured and re-validation guards.
  const lateEntry = await create("Timing late due", "2026-12-12"); // 14-day point Nov 28
  const lateClock = new Date("2026-11-29T18:00:00Z");
  await reconcileDeadlineReminders(lateClock);
  const lateBatch = (await batchesOf(lateEntry.id))[0];
  const lateView = (await listPendingReminderBatches(lateClock)).batches.find((batch) => batch.id === lateBatch.id)!;
  await prisma.calendarEntry.update({ where: { id: lateEntry.id }, data: { status: "CANCELLED" } });
  const withdrawnSend = await caught(sendReminderBatch(lateBatch.id, { fingerprint: lateView.fingerprint }, adminId, lateClock));
  assert(withdrawnSend instanceof DeadlineReminderError && withdrawnSend.code === "BATCH_WITHDRAWN", `a send for a deadline cancelled after the preview is withdrawn, got ${String(withdrawnSend)}`);
  assert((await outboxOf(lateBatch.id)).length === 0 && (await batchesOf(lateEntry.id))[0].status === "WITHDRAWN", "nothing was sent and the batch is withdrawn");
  console.log("ok  an approval attempt on a deadline cancelled after the preview sends nothing");

  // ---- 7b. Repeating deadlines: a batch per occurrence (#915) ----------------------------------------------
  const weekly = await create("Repeat weekly due", "2026-10-02", { repeatRule: "FREQ=WEEKLY;BYDAY=FR;WKST=SU" });
  const monthly = await create("Repeat monthly due", "2026-10-15", { repeatRule: "FREQ=MONTHLY" });
  const shape = async (entryId: string) => (await batchesOf(entryId)).map((batch) => `${batch.dueOn}:${batch.daysBefore}:${batch.status}`).sort();
  await reconcileDeadlineReminders(new Date("2026-11-25T18:00:00Z")); // Wed: next Friday is Nov 27, next 15th is Dec 15
  assert(JSON.stringify(await shape(weekly.id)) === JSON.stringify(["2026-11-27:2:PENDING"]), `a weekly deadline's next occurrence is prepared, got ${JSON.stringify(await shape(weekly.id))}`);
  assert((await shape(monthly.id)).length === 0, "a monthly deadline whose next occurrence is out of reach has nothing yet");
  await reconcileDeadlineReminders(new Date("2026-11-25T18:00:00Z"));
  await reconcileDeadlineReminders(new Date("2026-11-25T18:00:00Z"));
  assert((await shape(weekly.id)).length === 1, "no duplicate batch for the same occurrence");
  await reconcileDeadlineReminders(new Date("2026-11-28T18:00:00Z")); // Sat: Nov 27 has passed
  assert(JSON.stringify(await shape(weekly.id)) === JSON.stringify(["2026-11-27:2:WITHDRAWN", "2026-12-04:14:PENDING"]), `the passed occurrence is withdrawn and the next prepared, got ${JSON.stringify(await shape(weekly.id))}`);
  await reconcileDeadlineReminders(new Date("2026-12-02T18:00:00Z")); // Dec 15 minus 14 days is Dec 1
  assert(JSON.stringify(await shape(monthly.id)) === JSON.stringify(["2026-12-15:14:PENDING"]), `a monthly deadline gets its own batch for its occurrence, got ${JSON.stringify(await shape(monthly.id))}`);
  const monthlyBatch = (await batchesOf(monthly.id))[0];
  const monthlyView = (await listPendingReminderBatches(new Date("2026-12-02T18:00:00Z"))).batches.find((batch) => batch.id === monthlyBatch.id)!;
  assert(monthlyView && monthlyView.dueOn === "2026-12-15", "the preview lists the occurrence's due date");
  // Across the November daylight-saving change: Saturday Oct 31 is still due at 11:59 PM CDT and has passed at midnight.
  const saturdays = await create("Repeat saturday due", "2026-10-24", { repeatRule: "FREQ=WEEKLY;BYDAY=SA;WKST=SU" });
  await reconcileDeadlineReminders(new Date("2026-11-01T04:59:00Z"));
  assert(JSON.stringify(await shape(saturdays.id)) === JSON.stringify(["2026-10-31:2:PENDING"]), `Oct 31 11:59 PM CDT is still the Oct 31 occurrence, got ${JSON.stringify(await shape(saturdays.id))}`);
  await reconcileDeadlineReminders(new Date("2026-11-01T05:00:00Z"));
  assert(JSON.stringify(await shape(saturdays.id)) === JSON.stringify(["2026-10-31:2:WITHDRAWN", "2026-11-07:14:PENDING"]), `midnight CDT on Nov 1 moves to Nov 7, got ${JSON.stringify(await shape(saturdays.id))}`);
  console.log("ok  repeating deadlines: a batch per occurrence, the passed one withdrawn, no duplicates, across daylight saving");
  await prisma.deadlineReminderBatch.deleteMany({ where: { title: { startsWith: "DLR Repeat" } } });
  await prisma.calendarEntry.deleteMany({ where: { title: { startsWith: "DLR Repeat" } } });

  // ---- 8. A deadline changes before approval (real clock, through the calendar's own edit path) -------------
  await prisma.calendarEntry.deleteMany({ where: { title: { startsWith: "DLR Timing" } } });
  const live = await create("Live change due", addDays(today, 12));
  await reconcileDeadlineReminders();
  const liveBatchId = (await batchesOf(live.id))[0]?.id;
  assert(liveBatchId && (await batchesOf(live.id))[0].daysBefore === 14 && (await batchesOf(live.id))[0].status === "PENDING", "a deadline 12 days out has its 14-day batch");
  const edit = (patch: Record<string, unknown>) => updateCalendarEntry(live.id, calendarEntryUpdateSchema.parse(patch), adminId);
  await edit({ startsOn: addDays(today, 9), endsOn: addDays(today, 9) });
  let current = (await batchesOf(live.id))[0];
  assert(current.status === "PENDING" && current.dueOn === addDays(today, 9), "a new date updates the waiting batch (and the calendar edit did it at once)");
  await edit({ startsOn: addDays(today, 60), endsOn: addDays(today, 60) });
  current = (await batchesOf(live.id))[0];
  assert(current.status === "WITHDRAWN", "a date moved far out withdraws it: its point is not reached");
  const newest = async () => (await prisma.deadlineReminderBatch.findMany({ where: { calendarEntryId: live.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }))[0];
  await edit({ startsOn: addDays(today, 12), endsOn: addDays(today, 12) });
  const moved = await batchesOf(live.id);
  assert(moved.length === 2 && (await newest()).status === "PENDING" && (await newest()).dueOn === addDays(today, 12), "moving it back prepares the point for that date (a batch is per due date); the old date's stays withdrawn");
  await edit({ status: "CANCELLED" });
  assert((await newest()).status === "WITHDRAWN", "cancelling withdraws it");
  await edit({ status: "SCHEDULED" });
  assert((await newest()).status === "PENDING", "restoring it brings it back");
  await prisma.calendarEntry.update({ where: { id: live.id }, data: { isHiddenLocally: true } });
  await reconcileDeadlineReminders();
  assert((await newest()).status === "WITHDRAWN", "hiding withdraws it");
  await prisma.calendarEntry.update({ where: { id: live.id }, data: { isHiddenLocally: false } });
  await reconcileDeadlineReminders();
  await edit({ entryType: "STANDARD" });
  assert((await newest()).status === "WITHDRAWN", "clearing the Deadline type withdraws it");
  await edit({ entryType: "DEADLINE" });
  const finalBatches = await batchesOf(live.id);
  assert(finalBatches.length === 2 && (await newest()).status === "PENDING" && finalBatches.filter((batch) => batch.status === "PENDING").length === 1, "and marking it again brings back the one waiting batch");
  const queuedForLive = (await Promise.all(finalBatches.map((batch) => prisma.messageOutbox.count({ where: { templateKey: "DEADLINE_REMINDER", metadata: { path: ["deadlineReminderBatchId"], equals: batch.id } } })))).reduce((sum, count) => sum + count, 0);
  assert(queuedForLive === 0, `through all of it nothing was queued for any of this entry's batches, got ${queuedForLive}`);
  const edited = await prisma.auditLog.count({ where: { entityType: "DeadlineReminderBatch", action: { in: ["DEADLINE_REMINDER_UPDATED", "DEADLINE_REMINDER_WITHDRAWN", "DEADLINE_REMINDER_PREPARED"] }, entityId: { in: finalBatches.map((batch) => batch.id) } } });
  assert(edited >= 6, `every change to the batches was audited, got ${edited}`);
  console.log("ok  a changed, cancelled, hidden or un-marked deadline updates or withdraws its waiting batch");

  console.log("PASS deadline reminders verified against PostgreSQL");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
