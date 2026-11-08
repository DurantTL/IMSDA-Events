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
 * - off hides the step and keeps the teachers; the summary groups teachers by site and club.
 *
 * Uses fictitious rows it creates and removes itself. Nothing is sent.
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

  // Who may switch it.
  const acActor = { kind: "area-coordinator" as const, accountId: ids.ac };
  await refused(() => applyTeacherSettings({ kind: "area-coordinator", accountId: ids.plain }, ids.event, { enabled: true }), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => applyTeacherSettings({ kind: "area-coordinator", accountId: ids.revoked }, ids.event, { enabled: true }), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => applyTeacherSettings(acActor, ids.general, { enabled: true }), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => requireStaffTeacherToolAccess({ user: staff }, ids.event, findActiveMembership), "staff with no role on the event are refused", "EVENT_ACCESS_DENIED");
  await requireStaffTeacherToolAccess({ user: admin }, ids.event, findActiveMembership);
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

  // Require: below the number blocks at submit, and a bigger club needs more.
  await applyTeacherSettings(acActor, ids.event, { rule: { ...rule, requireTeachers: true } });
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
  await applyTeacherSettings(acActor, ids.event, { enabled: true });
  assert((await loadClubTeacherStep(ids.clubA, ids.event))?.teachers.length === 2, "back on: the teachers are still there");
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
