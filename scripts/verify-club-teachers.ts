/**
 * Proves the Club teachers tool (#1681) against a real PostgreSQL database:
 *
 * - an active Area Coordinator, staff and a system administrator can switch it on for a club event; a signed-in account
 *   with no grant, a revoked coordinator and a general event are refused; each switch is audited, with the coordinator's
 *   account in the metadata;
 * - on with no rule saved changes nothing for a club; with a rule the club sees the step, and a club below its number
 *   gets a warning but can still register;
 * - only adults and staff on the club's own roster can be named, and only this event's sites;
 * - "require" blocks submit below the number (more people, more teachers) and nothing else; an event without the tool,
 *   or with it off, is untouched;
 * - off hides the step and keeps the teachers; the summary groups teachers by site and club;
 * - teachers must be 18 or older (#1727): 16- and 17-year-old staff are refused, 18 is accepted, an unknown age is refused,
 *   a reported age counts, and a saved under-18 teacher stays stored, is flagged in the club card and the staff view, and
 *   does not count toward the number;
 * - an Area Coordinator turning the tool on while staff's "require" is stored on sends staff one alert and audits it, leaving
 *   the stored value alone; nothing is sent when require is off, when staff turn it on, or on a repeat.
 *
 * Uses fictitious rows it creates and removes itself. The alert webhook is a stand-in that records calls; nothing is sent.
 *
 *   npm run test:club-teachers
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { addRosterMember } from "@/modules/club-rosters/repository";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { assertTeachersMeetRule, activeTeacherRule, ClubTeacherError, loadClubTeacherStep, setClubTeachers } from "@/modules/club-teachers/repository";
import { applyTeacherSettings, requireStaffTeacherToolAccess } from "@/modules/club-teachers/settings";
import { loadTeacherSummary } from "@/modules/club-teachers/summary";
import { findActiveMembership } from "@/modules/events/repository";

loadEnvConfig(process.cwd());
// The staff notice (#1727) goes through the alert webhook; a recording stand-in keeps it local.
process.env.ALERT_WEBHOOK_URL = "https://alerts.example.test/hook";
const alertCalls: string[] = [];
const sentCount = () => alertCalls.length;
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  alertCalls.push(String(init?.body ?? ""));
  return new Response("ok", { status: 200 });
}) as typeof fetch;
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-club-teachers-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `ct1681_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_ev`, general: `${P}_gen`, other: `${P}_other`, clubA: `${P}_clubA`, clubB: `${P}_clubB`,
  admin: `${P}_admin`, staff: `${P}_staff`, ac: `${P}_ac`, plain: `${P}_plain`, revoked: `${P}_revoked`,
  siteOne: `${P}_site1`, siteTwo: `${P}_site2`,
};
const admin = { id: ids.admin, email: `${P}-admin@example.test`, displayName: "Teacher Admin", globalRole: "SYSTEM_ADMIN" } as AuthenticatedUser;
const staff = { id: ids.staff, email: `${P}-staff@example.test`, displayName: "Teacher Staff", globalRole: null } as AuthenticatedUser;
const rule = { baseTeachers: 1, largerClubOver: 3, largerClubTeachers: 2, requireTeachers: false };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function refused(run: () => Promise<unknown>, message: string, code?: string) {
  try {
    await run();
  } catch (error) {
    const found = (error as { code?: string }).code;
    if (code && found !== code) throw new Error(`FAILED: ${message} (got ${String(found)})`);
    return;
  }
  throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  const eventIds = [ids.event, ids.general, ids.other];
  await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.clubEventTeacher.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: [ids.clubA, ids.clubB] } } });
  await prisma.person.deleteMany({ where: { lastName: "Teachersample" } }).catch(() => undefined);
  await prisma.organization.deleteMany({ where: { id: { in: [ids.clubA, ids.clubB] } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: [ids.ac, ids.revoked] } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: [ids.ac, ids.plain, ids.revoked] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.staff] } } });
}

async function main() {
  await cleanup();
  await prisma.user.createMany({ data: [
    { id: ids.admin, email: admin.email, displayName: admin.displayName, globalRole: "SYSTEM_ADMIN" },
    { id: ids.staff, email: staff.email, displayName: staff.displayName },
  ] });
  await prisma.attendeeAccount.createMany({ data: [
    { id: ids.ac, email: `${P}-ac@example.test`, displayName: "Sample Coordinator", status: "ACTIVE" },
    { id: ids.plain, email: `${P}-plain@example.test`, displayName: "Sample Attendee", status: "ACTIVE" },
    { id: ids.revoked, email: `${P}-revoked@example.test`, displayName: "Former Coordinator", status: "ACTIVE" },
  ] });
  await prisma.areaCoordinatorGrant.createMany({ data: [
    { attendeeAccountId: ids.ac, grantedByUserId: ids.admin },
    { attendeeAccountId: ids.revoked, grantedByUserId: ids.admin, revokedAt: new Date(), revokedByUserId: ids.admin },
  ] });
  await prisma.organization.createMany({ data: [
    { id: ids.clubA, type: "CLUB", name: `Teacher Club A ${P}`, normalizedName: `teacher club a ${P}` },
    { id: ids.clubB, type: "CLUB", name: `Teacher Club B ${P}`, normalizedName: `teacher club b ${P}` },
  ] });
  const common = { startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T22:00:00Z"), timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const };
  await prisma.event.create({ data: { id: ids.event, slug: `${P}-honors`, name: "Teachers Honors Weekend", audience: "CLUB", ...common } });
  await prisma.event.create({ data: { id: ids.other, slug: `${P}-other`, name: "Teachers Other Club Event", audience: "CLUB", ...common } });
  await prisma.event.create({ data: { id: ids.general, slug: `${P}-general`, name: "Teachers General Event", audience: "GENERAL", ...common } });
  await prisma.eventLocation.createMany({ data: [
    { id: ids.siteOne, eventId: ids.event, name: "Weekend One", normalizedName: "weekend one", sortOrder: 1 },
    { id: ids.siteTwo, eventId: ids.event, name: "Weekend Two", normalizedName: "weekend two", sortOrder: 2 },
  ] });

  const year = "2026-27";
  const actor = { userId: ids.admin };
  const add = (organizationId: string, firstName: string, attendeeType: "ADULT" | "STAFF" | "YOUTH", birthDate: string) =>
    addRosterMember(organizationId, year, { firstName, lastName: "Teachersample", birthDate, attendeeType, role: attendeeType === "YOUTH" ? "Pathfinder" : "Counselor", classLevel: attendeeType === "YOUTH" ? "RANGER" : null, gender: "FEMALE", schoolGrade: attendeeType === "YOUTH" ? "GRADE_7" : null, schoolType: null, churchMember: null }, actor);
  const adultA = await add(ids.clubA, "Ada", "ADULT", "1980-04-02");
  const staffA = await add(ids.clubA, "Sam", "STAFF", "1985-06-12");
  const youthA = await add(ids.clubA, "Yoshi", "YOUTH", "2013-03-03");
  const adultB = await add(ids.clubB, "Bea", "ADULT", "1979-01-20");
  // Ages on the event's first day (2026-12-05): 16, 17 and 18.
  const staff16 = await add(ids.clubB, "Sixteen", "STAFF", "2010-06-01");
  const staff17 = await add(ids.clubB, "Seventeen", "STAFF", "2009-12-06");
  const staff18 = await add(ids.clubB, "Eighteen", "STAFF", "2008-12-05");
  // No birth date: one with no age at all, one with a reported age of 20, one with a reported age of 17.
  const noBirthDate = async (firstName: string, reportedAge: number | null) => {
    const person = await prisma.person.create({ data: { firstName, lastName: "Teachersample" } });
    return prisma.clubRosterMember.create({ data: { organizationId: ids.clubB, clubYear: year, personId: person.id, attendeeType: "STAFF", role: "Counselor", reportedAge, source: "IMPORT" } });
  };
  const noAge = await noBirthDate("Unknown", null);
  const reported20 = await noBirthDate("Reportedtwenty", 20);
  const reported17 = await noBirthDate("Reportedseventeen", 17);

  // Who may switch it.
  const acActor = { kind: "area-coordinator" as const, accountId: ids.ac };
  await refused(() => applyTeacherSettings({ kind: "area-coordinator", accountId: ids.plain }, ids.event, { enabled: true }), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => applyTeacherSettings({ kind: "area-coordinator", accountId: ids.revoked }, ids.event, { enabled: true }), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => applyTeacherSettings(acActor, ids.general, { enabled: true }), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => requireStaffTeacherToolAccess({ user: staff }, ids.event, findActiveMembership), "staff with no role on the event are refused", "EVENT_ACCESS_DENIED");
  await requireStaffTeacherToolAccess({ user: admin }, ids.event, findActiveMembership);
  // A Registration Manager cannot switch it; an Event Admin can.
  await prisma.eventMembership.create({ data: { eventId: ids.event, userId: ids.staff, role: "REGISTRATION_MANAGER" } });
  await refused(() => requireStaffTeacherToolAccess({ user: staff }, ids.event, findActiveMembership), "a Registration Manager is refused", "PERMISSION_DENIED");
  await prisma.eventMembership.update({ where: { eventId_userId: { eventId: ids.event, userId: ids.staff } }, data: { role: "EVENT_ADMIN" } });
  await requireStaffTeacherToolAccess({ user: staff }, ids.event, findActiveMembership);
  await prisma.eventMembership.delete({ where: { eventId_userId: { eventId: ids.event, userId: ids.staff } } });
  // An unpublished club event: staff can set it up, a coordinator cannot see it.
  await prisma.event.update({ where: { id: ids.other }, data: { isPublished: false } });
  await refused(() => applyTeacherSettings(acActor, ids.other, { enabled: true }), "a coordinator cannot reach an unpublished event", "EVENT_NOT_FOUND");
  assert((await applyTeacherSettings({ kind: "staff", userId: ids.admin }, ids.other, { enabled: true })).enabled, "staff can set up an unpublished club event");
  await prisma.eventModule.deleteMany({ where: { eventId: ids.other } });
  await prisma.event.update({ where: { id: ids.other }, data: { isPublished: true } });
  assert(await prisma.eventModule.count({ where: { eventId: { in: [ids.event, ids.general] } } }) === 0, "refused calls changed nothing");

  // An Area Coordinator turns it on: nothing changes for clubs until a rule is saved.
  const on = await applyTeacherSettings(acActor, ids.event, { enabled: true });
  assert(on.enabled && on.rule === null, "the coordinator turned it on with no rule");
  assert((await activeTeacherRule(ids.event)) === null && (await loadClubTeacherStep(ids.clubA, ids.event)) === null, "on with no rule: clubs see nothing");
  await refused(() => setClubTeachers(ids.clubA, ids.event, { accountId: ids.plain }, { teachers: [] }), "a club cannot name teachers before a rule exists", "NOT_AVAILABLE");
  const enabledAudit = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED" } });
  assert(enabledAudit && (enabledAudit.metadata as { actorAttendeeAccountId?: string }).actorAttendeeAccountId === ids.ac, "the switch is audited with the coordinator's account");
  assert((await applyTeacherSettings(acActor, ids.event, { enabled: true })).enabled && await prisma.auditLog.count({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED" } }) === 1, "turning it on twice audits once");

  // The rule makes the step appear. A club below its number is warned, not blocked.
  const withRule = await applyTeacherSettings(acActor, ids.event, { rule });
  assert(withRule.rule?.largerClubOver === 3, "the rule was saved");
  const step = await loadClubTeacherStep(ids.clubA, ids.event);
  assert(step && step.warning && !step.status.met && step.candidates.length === 2, "the club sees a warning and two adults to pick from (not the youth)");
  assert(step.locations.length === 2, "the event's sites are offered");
  await assertTeachersMeetRule(ids.event, ids.clubA, 2);

  // Naming teachers: adults and staff of this club, this event's sites.
  await refused(() => setClubTeachers(ids.clubA, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: youthA.memberId, honorName: null, locationId: null }] }), "a youth cannot be named", "MEMBER_INVALID");
  await refused(() => setClubTeachers(ids.clubA, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: adultB.memberId, honorName: null, locationId: null }] }), "another club's adult cannot be named", "MEMBER_INVALID");
  await refused(() => setClubTeachers(ids.clubA, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: adultA.memberId, honorName: null, locationId: "nope" }] }), "a site from elsewhere is refused", "LOCATION_INVALID");
  const named = await setClubTeachers(ids.clubA, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: adultA.memberId, honorName: "Knot Tying", locationId: ids.siteOne }] });
  assert(named && named.status.met && named.warning === null && named.teachers.length === 1, "one teacher meets the base number");
  await setClubTeachers(ids.clubB, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: adultB.memberId, honorName: null, locationId: null }] });

  // Teachers must be 18 or older (#1727), by birth date or reported age, on the event's first day.
  const nameOne = (memberId: string) => setClubTeachers(ids.clubB, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: memberId, honorName: null, locationId: null }] });
  await refused(() => nameOne(staff16.memberId), "a 16-year-old staff member cannot be named", "TEACHER_UNDER_18");
  await refused(() => nameOne(staff17.memberId), "a staff member who turns 18 the day after the event cannot be named", "TEACHER_UNDER_18");
  await refused(() => nameOne(reported17.id), "a reported age of 17 cannot be named", "TEACHER_UNDER_18");
  await refused(() => nameOne(noAge.id), "someone with no birth date or age cannot be named", "TEACHER_AGE_UNKNOWN");
  assert((await prisma.clubEventTeacher.count({ where: { eventId: ids.event, organizationId: ids.clubB } })) === 1, "the refused calls changed nothing (only the earlier adult is named)");
  const pickerB = await loadClubTeacherStep(ids.clubB, ids.event);
  const pickerNames = pickerB?.candidates.map((candidate) => candidate.memberId) ?? [];
  assert(pickerNames.includes(staff18.memberId) && pickerNames.includes(reported20.id) && pickerNames.includes(adultB.memberId), "the picker offers 18 and over, by birth date or reported age");
  assert(![staff16.memberId, staff17.memberId, reported17.id, noAge.id].some((id) => pickerNames.includes(id)), "the picker leaves out under 18 and unknown ages");
  assert(pickerB!.unavailable.some((person) => person.memberId === noAge.id && person.reason.includes("birth date")), "an unknown age is listed with a reason to add the birth date");
  assert(pickerB!.unavailable.some((person) => person.memberId === staff16.memberId && person.reason === "Under 18, can't teach"), "an under-18 is listed as unavailable");
  await nameOne(staff18.memberId);
  await nameOne(reported20.id);
  await nameOne(adultB.memberId);

  // Require is staff's choice: a coordinator cannot turn it on, and saving the numbers leaves the stored value alone.
  await refused(() => applyTeacherSettings(acActor, ids.event, { rule: { ...rule, requireTeachers: true } }), "a coordinator cannot require teachers", "NOT_PERMITTED");
  assert(!(await prisma.clubTeacherRule.findUniqueOrThrow({ where: { eventId: ids.event } })).requireTeachers, "the refused call changed nothing");
  await applyTeacherSettings({ kind: "staff", userId: ids.admin }, ids.event, { rule: { ...rule, requireTeachers: true } });
  await applyTeacherSettings(acActor, ids.event, { rule: { ...rule, baseTeachers: 1, requireTeachers: false } });
  assert((await prisma.clubTeacherRule.findUniqueOrThrow({ where: { eventId: ids.event } })).requireTeachers, "a coordinator saving the numbers keeps staff's require setting");

  // Require: below the number blocks at submit, and a bigger club needs more.
  await assertTeachersMeetRule(ids.event, ids.clubA, 3);
  await refused(() => assertTeachersMeetRule(ids.event, ids.clubA, 4), "a club of four needs two teachers when require is on", "TEACHERS_REQUIRED");
  await setClubTeachers(ids.clubA, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: adultA.memberId, honorName: "Knot Tying", locationId: ids.siteOne }, { rosterMemberId: staffA.memberId, honorName: null, locationId: ids.siteTwo }] });
  await assertTeachersMeetRule(ids.event, ids.clubA, 4);
  // An event without the tool is untouched, whatever its headcount.
  await assertTeachersMeetRule(ids.other, ids.clubA, 50);

  // The staff and coordinator view.
  const summary = await loadTeacherSummary(ids.event);
  assert(summary.totalTeachers === 3, "three teachers in all");
  assert(summary.sites.find((site) => site.locationId === ids.siteOne)?.teachers === 1 && summary.sites.find((site) => site.locationId === ids.siteTwo)?.teachers === 1, "teachers are counted per site");
  assert(summary.sites.find((site) => site.locationId === null)?.teachers === 1, "a teacher with no site and a club with no registration is listed under no site");
  const clubA = summary.clubs.find((club) => club.organizationId === ids.clubA);
  assert(clubA && clubA.teachers.length === 2 && clubA.teachers[0]!.name.includes("Teachersample"), "per club, adult names only");

  // A saved under-18 teacher stays stored, is flagged in the club's card and the staff view, and does not count.
  await prisma.clubEventTeacher.deleteMany({ where: { eventId: ids.event, organizationId: ids.clubB } });
  await prisma.clubEventTeacher.createMany({ data: [adultB, staff16].map((member) => ({ eventId: ids.event, organizationId: ids.clubB, rosterMemberId: member.memberId })) });
  const flaggedStep = await loadClubTeacherStep(ids.clubB, ids.event);
  const flaggedTeacher = flaggedStep?.teachers.find((teacher) => teacher.memberId === staff16.memberId);
  assert(flaggedTeacher?.flag === "Under 18, can't teach", "the club card flags a saved under-18 teacher");
  assert(flaggedStep!.teachers.length === 2 && flaggedStep!.status.named === 1, "the saved under-18 teacher stays stored but does not count");
  assert(flaggedStep!.teachers.find((teacher) => teacher.memberId === adultB.memberId)?.flag === null, "an adult is not flagged");
  const flaggedSummary = await loadTeacherSummary(ids.event);
  const flaggedClub = flaggedSummary.clubs.find((club) => club.organizationId === ids.clubB);
  assert(flaggedClub?.teachers.some((teacher) => teacher.flag === "Under 18, can't teach") && flaggedClub.status.named === 1, "the staff view flags a saved under-18 teacher and does not count them");
  assert(flaggedSummary.totalTeachers === 3, "the under-18 teacher is not in the teacher total");
  // Keeping them in a save is refused; replacing them works.
  await refused(() => setClubTeachers(ids.clubB, ids.event, { accountId: ids.ac }, { teachers: [{ rosterMemberId: adultB.memberId, honorName: null, locationId: null }, { rosterMemberId: staff16.memberId, honorName: null, locationId: null }] }), "saving the under-18 teacher again is refused", "TEACHER_UNDER_18");
  await nameOne(adultB.memberId);
  assert(await prisma.clubEventTeacher.count({ where: { eventId: ids.event, organizationId: ids.clubB } }) === 1, "the club replaced the under-18 teacher");

  // Staff can change it too; off hides it and keeps the data.
  const staffActor = await requireStaffTeacherToolAccess({ user: admin }, ids.event, findActiveMembership);
  const off = await applyTeacherSettings(staffActor, ids.event, { enabled: false });
  assert(!off.enabled && off.rule !== null, "off keeps the rule");
  assert((await loadClubTeacherStep(ids.clubA, ids.event)) === null, "off: clubs see nothing");
  await assertTeachersMeetRule(ids.event, ids.clubA, 50);
  assert(await prisma.clubEventTeacher.count({ where: { eventId: ids.event } }) === 3, "off keeps every teacher a club named");
  assert((await loadTeacherSummary(ids.event)).totalTeachers === 3, "the summary still reads them");
  const disabledAudit = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_MODULE_DISABLED" } });
  assert(disabledAudit?.actorUserId === ids.admin, "staff's switch is audited with the staff user");
  // Staff's require is still stored on. Staff turning it on sends nothing; an Area Coordinator turning it on tells staff once.
  const requireNotices = () => prisma.auditLog.count({ where: { eventId: ids.event, action: "CLUB_TEACHER_REQUIRE_NOTICE_SENT" } });
  assert(sentCount() === 0 && (await requireNotices()) === 0, "nothing was sent before this point (no rule on first turn-on, require off or staff doing it)");
  await applyTeacherSettings(staffActor, ids.event, { enabled: true });
  assert(sentCount() === 0 && (await requireNotices()) === 0, "staff turning it on sends no notice");
  await applyTeacherSettings(staffActor, ids.event, { enabled: false });
  await applyTeacherSettings(acActor, ids.event, { enabled: true });
  assert((await loadClubTeacherStep(ids.clubA, ids.event))?.teachers.length === 2, "back on: the teachers are still there");
  assert(sentCount() === 1, "an Area Coordinator turning it on with require stored on sends staff one alert");
  assert(alertCalls[0]!.includes("Require teachers is back on") && alertCalls[0]!.includes("Teachers Honors Weekend") && alertCalls[0]!.includes("Sample Coordinator"), "the alert names the event, says require is back on and who turned the tool on");
  const noticeAudit = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "CLUB_TEACHER_REQUIRE_NOTICE_SENT" } });
  const noticeMeta = noticeAudit?.metadata as { actorAttendeeAccountId?: string; delivered?: boolean } | undefined;
  assert(noticeMeta?.actorAttendeeAccountId === ids.ac && noticeMeta.delivered === true, "the notice is audited with the coordinator's account and that it was delivered");
  assert((await prisma.clubTeacherRule.findUniqueOrThrow({ where: { eventId: ids.event } })).requireTeachers, "the notice left the stored require value alone");
  await applyTeacherSettings(acActor, ids.event, { enabled: true });
  assert(sentCount() === 1 && (await requireNotices()) === 1, "turning it on again (already on) sends nothing more");
  await applyTeacherSettings(staffActor, ids.event, { rule: { ...rule, requireTeachers: false }, enabled: false });
  await applyTeacherSettings(acActor, ids.event, { enabled: true });
  assert(sentCount() === 1 && (await requireNotices()) === 1, "with require stored off, a coordinator turning it on sends nothing");
  assert(!(await prisma.auditLog.findMany({ where: { eventId: ids.event } })).some((row) => JSON.stringify(row.metadata).includes("Teachersample")), "no name is written to the audit log");
  void ClubTeacherError;
  console.log("club teachers: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
