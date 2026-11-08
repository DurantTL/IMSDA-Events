/**
 * Proves Attendance points (#1677) against a real PostgreSQL database:
 *
 * - off by default; an active Area Coordinator, the Clubs Administrator's role (Event Admin) and a system administrator can
 *   switch it on through the shared helper; a signed-in account with no grant, a revoked coordinator, an unpublished or a
 *   general event, and a Registration Manager are refused; each switch is audited with the coordinator's account;
 * - an Area Coordinator may set the points and read the review (counts and reasons, no names) but cannot mark, override,
 *   apply or undo; staff administrators can, and see the names;
 * - each voted rule against registered people: directors and staff count whatever other role they hold, TLTs count with a
 *   supervising adult if under 18, an Area Coordinator's child does not count, camporee points need Pathfinders present,
 *   and the count is from check-in when the event used it, otherwise from registration;
 * - an override with a reason replaces the rules for one club; apply and undo are audited with ids and numbers only, apply
 *   cannot run twice, settings are locked while applied, and an apply before the event starts is refused;
 * - applied points are on the club points board (Area summary total, Event points with the event as the reason, the
 *   director's own year) and Monthly Records points are unchanged; undo takes them off; switching the tool off keeps them.
 *
 * Uses fictitious rows it creates and removes itself. Nothing is sent.
 *
 *   npm run test:attendance-points
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { getClubReportYear } from "@/modules/club-reports/repository";
import { loadClubEventPoints } from "@/modules/event-points/awards";
import {
  AttendancePointsError,
  applyAttendancePointsAction,
  loadAttendancePointsView,
  requireStaffPointsAccess,
  type AttendancePointsActor,
} from "@/modules/event-points/service";
import { requireStaffToggleAccess } from "@/modules/event-modules/scoped-toggle";
import { findActiveMembership } from "@/modules/events/repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-attendance-points-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `ap1677_${randomUUID().slice(0, 8)}`;
const ids = {
  camporee: `${P}_camp`, leadership: `${P}_lead`, future: `${P}_future`, unpublished: `${P}_unpub`, general: `${P}_gen`,
  clubA: `${P}_clubA`, clubB: `${P}_clubB`, clubC: `${P}_clubC`, clubD: `${P}_clubD`, clubE: `${P}_clubE`,
  admin: `${P}_admin`, eventAdmin: `${P}_eadmin`, manager: `${P}_mgr`, nobody: `${P}_nobody`,
  ac: `${P}_ac`, plain: `${P}_plain`, revoked: `${P}_revoked`,
  holder: `${P}_holder`, form: `${P}_form`, formVersion: `${P}_form_v1`,
};
const clubIds = [ids.clubA, ids.clubB, ids.clubC, ids.clubD, ids.clubE];
const admin = { id: ids.admin, email: `${P}-admin@example.test`, displayName: "Points Admin", globalRole: "SYSTEM_ADMIN" } as AuthenticatedUser;
const eventAdmin = { id: ids.eventAdmin, email: `${P}-eadmin@example.test`, displayName: "Points Event Admin", globalRole: null } as AuthenticatedUser;
const manager = { id: ids.manager, email: `${P}-mgr@example.test`, displayName: "Points Manager", globalRole: null } as AuthenticatedUser;
const nobody = { id: ids.nobody, email: `${P}-nobody@example.test`, displayName: "Points Nobody", globalRole: null } as AuthenticatedUser;
const personNames = ["Ada", "Bea", "Cy", "Dot", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kit", "Lee", "Max"];
const personId = (name: string) => `${P}_person_${name}`;
const CLUB_YEAR = "2025-26";

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
  const eventIds = [ids.camporee, ids.leadership, ids.future, ids.unpublished, ids.general];
  await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.checkIn.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.publicRegistrationSubmission.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.clubMonthlyReport.deleteMany({ where: { organizationId: { in: clubIds } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: clubIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: clubIds } } });
  await prisma.person.deleteMany({ where: { id: { in: [ids.holder, ...personNames.map(personId)] } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: [ids.ac, ids.revoked] } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: [ids.ac, ids.plain, ids.revoked] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.eventAdmin, ids.manager, ids.nobody] } } });
}

type Spec = { name: string; type: string | null; age?: number; checkedIn?: boolean; rosterRole?: string };
let counter = 0;

/** One club registration with its people. `type` is the form's role answer; a roster row is made when `rosterRole` is given. */
async function register(eventId: string, club: string, people: Spec[]) {
  counter += 1;
  const created = await prisma.registration.create({
    data: { eventId, accountHolderPersonId: ids.holder, confirmationCode: `${P}-${counter}`, status: "CONFIRMED", totalAmount: "50.00", submittedAt: new Date("2026-03-01T10:00:00Z") },
    select: { id: true },
  });
  await prisma.clubEventRegistration.create({ data: { eventId, organizationId: club, registrationId: created.id } });
  const out: Record<string, string> = {};
  for (const [position, spec] of people.entries()) {
    let rosterId: string | undefined;
    if (spec.rosterRole !== undefined) {
      const member = await prisma.clubRosterMember.create({
        data: { organizationId: club, clubYear: CLUB_YEAR, personId: personId(spec.name), attendeeType: "ADULT", role: spec.rosterRole, source: "DIRECTOR" },
        select: { id: true },
      });
      rosterId = member.id;
    }
    const attendee = await prisma.registrationAttendee.create({
      data: {
        eventId, registrationId: created.id, personId: personId(spec.name), attendeeType: "YOUTH", position,
        profileSnapshot: { firstName: spec.name, lastName: "Pointsample", ...(rosterId ? { clubRosterMemberId: rosterId } : {}) },
        formResponses: { ...(spec.type ? { attendee_type: spec.type } : {}), ...(spec.age !== undefined ? { attendee_age: spec.age } : {}) },
      },
      select: { id: true },
    });
    out[spec.name] = attendee.id;
    if (spec.checkedIn) {
      await prisma.checkIn.create({ data: { eventId, registrationAttendeeId: attendee.id, idempotencyKey: `${P}-ci-${attendee.id}` } });
    }
  }
  await prisma.publicRegistrationSubmission.create({
    data: { eventId, formVersionId: ids.formVersion, registrationId: created.id, idempotencyKey: `${P}-${counter}`, requestHash: `hash-${counter}`, responses: {}, pricingSnapshot: { lineItems: [] } },
  });
  return out;
}

async function main() {
  await cleanup();
  await prisma.user.createMany({ data: [admin, eventAdmin, manager, nobody].map((user) => ({ id: user.id, email: user.email, displayName: user.displayName, ...(user.globalRole ? { globalRole: user.globalRole } : {}) })) });
  await prisma.attendeeAccount.createMany({ data: [
    { id: ids.ac, email: `${P}-ac@example.test`, displayName: "Sample Coordinator", status: "ACTIVE" },
    { id: ids.plain, email: `${P}-plain@example.test`, displayName: "Sample Attendee", status: "ACTIVE" },
    { id: ids.revoked, email: `${P}-revoked@example.test`, displayName: "Former Coordinator", status: "ACTIVE" },
  ] });
  await prisma.areaCoordinatorGrant.createMany({ data: [
    { attendeeAccountId: ids.ac, grantedByUserId: ids.admin },
    { attendeeAccountId: ids.revoked, grantedByUserId: ids.admin, revokedAt: new Date(), revokedByUserId: ids.admin },
  ] });
  await prisma.person.createMany({ data: [{ id: ids.holder, firstName: "Pat", lastName: "Holder" }, ...personNames.map((name) => ({ id: personId(name), firstName: name, lastName: "Pointsample" }))] });
  await prisma.organization.createMany({ data: ["A", "B", "C", "D", "E"].map((letter) => ({ id: ids[`club${letter}` as "clubA"], type: "CLUB" as const, name: `Points Club ${letter} ${P}`, normalizedName: `points club ${letter.toLowerCase()} ${P}` })) });
  const base = { audience: "CLUB" as const, timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const };
  const past = { startsAt: new Date("2026-03-06T00:00:00Z"), endsAt: new Date("2026-03-08T00:00:00Z") };
  await prisma.event.create({ data: { id: ids.camporee, slug: `${P}-camp`, name: "Points Spring Camporee", ...base, ...past } });
  await prisma.event.create({ data: { id: ids.leadership, slug: `${P}-lead`, name: "Points Leadership Weekend", ...base, startsAt: new Date("2025-11-07T00:00:00Z"), endsAt: new Date("2025-11-09T00:00:00Z") } });
  await prisma.event.create({ data: { id: ids.future, slug: `${P}-future`, name: "Points Future Event", ...base, startsAt: new Date("2027-05-01T00:00:00Z"), endsAt: new Date("2027-05-03T00:00:00Z") } });
  await prisma.event.create({ data: { id: ids.unpublished, slug: `${P}-unpub`, name: "Points Unpublished", ...base, ...past, isPublished: false } });
  await prisma.event.create({ data: { id: ids.general, slug: `${P}-gen`, name: "Points General", ...base, ...past, audience: "GENERAL" } });
  await prisma.registrationForm.create({ data: { id: ids.form, eventId: ids.camporee, createdByUserId: ids.admin, name: "Synthetic form", slug: `${P}-form` } });
  await prisma.registrationFormVersion.create({ data: { id: ids.formVersion, formId: ids.form, createdByUserId: ids.admin, versionNumber: 1, definition: { sections: [] } } });
  await prisma.eventMembership.createMany({ data: [
    { eventId: ids.camporee, userId: ids.eventAdmin, role: "EVENT_ADMIN" },
    { eventId: ids.camporee, userId: ids.manager, role: "REGISTRATION_MANAGER" },
    { eventId: ids.leadership, userId: ids.eventAdmin, role: "EVENT_ADMIN" },
  ] });

  // The camporee used check-in. A: staff and a Pathfinder came. B: only the leader came (the Pathfinder did not check in).
  // C: a Pathfinder came with no leader. D: the leader came with a Pathfinder who is an Area Coordinator's child.
  // E: registered, nobody checked in.
  await register(ids.camporee, ids.clubA, [{ name: "Ada", type: "Pathfinder", age: 12, checkedIn: true }, { name: "Dot", type: "Staff", age: 40, checkedIn: true }]);
  const b = await register(ids.camporee, ids.clubB, [{ name: "Bea", type: "Pathfinder", age: 12, checkedIn: false }, { name: "Eve", type: "Staff", age: 41, checkedIn: true }]);
  await register(ids.camporee, ids.clubC, [{ name: "Cy", type: "Pathfinder", age: 13, checkedIn: true }]);
  const d = await register(ids.camporee, ids.clubD, [{ name: "Fay", type: "Pathfinder", age: 11, checkedIn: true }, { name: "Gus", type: "Staff", age: 38, checkedIn: true }]);
  await register(ids.camporee, ids.clubE, [{ name: "Hal", type: "Pathfinder", age: 12, checkedIn: false }]);

  // The leadership weekend did not use check-in, so registration counts. A: a TLT of 16 alone. B: a TLT of 16 with a director
  // who is typed TLT on the form but is the club's director on the roster. C: an adult TLT alone. D: staff, who is also marked
  // a coordinator's child by mistake. E: a child and someone with no role.
  const la = await register(ids.leadership, ids.clubA, [{ name: "Ivy", type: "TLT", age: 16 }]);
  await register(ids.leadership, ids.clubB, [{ name: "Jon", type: "TLT", age: 16 }, { name: "Kit", type: "TLT", age: 30, rosterRole: "Director" }]);
  await register(ids.leadership, ids.clubC, [{ name: "Lee", type: "TLT", age: 19 }]);
  const ld = await register(ids.leadership, ids.clubD, [{ name: "Gus", type: "Staff", age: 38 }]);
  await register(ids.leadership, ids.clubE, [{ name: "Max", type: "Child", age: 6 }, { name: "Hal", type: null }]);

  const acActor: AttendancePointsActor = { kind: "area-coordinator", accountId: ids.ac };
  const adminActor: AttendancePointsActor = { kind: "staff", userId: ids.admin };
  const act = (actor: AttendancePointsActor, action: Parameters<typeof applyAttendancePointsAction>[2], eventId = ids.camporee) => applyAttendancePointsAction(actor, eventId, action);
  const view = (eventId = ids.camporee, actor: AttendancePointsActor = adminActor, now?: Date) => loadAttendancePointsView(eventId, actor, now);
  const club = (state: Awaited<ReturnType<typeof view>>, id: string) => state.clubs.find((entry) => entry.organizationId === id)!;

  // Off by default: nothing can be set, and nothing is on the board.
  assert(!(await view()).enabled && await prisma.eventModule.count({ where: { eventId: ids.camporee, moduleKey: "attendance-points" } }) === 0, "off by default");
  await refused(() => act(adminActor, { action: "saveSettings", points: 1500, requiresPathfinders: true }), "nothing can be set while off", "NOT_AVAILABLE");
  assert((await loadClubEventPoints(CLUB_YEAR, clubIds)).size === 0, "no event points while off");

  // Who may switch it.
  await refused(() => act({ kind: "area-coordinator", accountId: ids.plain }, { action: "switch", enabled: true }), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => act({ kind: "area-coordinator", accountId: ids.revoked }, { action: "switch", enabled: true }), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => act(acActor, { action: "switch", enabled: true }, ids.general), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => act(acActor, { action: "switch", enabled: true }, ids.unpublished), "a coordinator cannot reach an unpublished event", "EVENT_NOT_FOUND");
  await refused(() => requireStaffPointsAccess({ user: nobody }, ids.camporee, findActiveMembership), "staff with no role on the event are refused", "EVENT_ACCESS_DENIED");
  await refused(() => requireStaffPointsAccess({ user: manager }, ids.camporee, findActiveMembership), "a Registration Manager is refused", "PERMISSION_DENIED");
  await refused(() => requireStaffToggleAccess({ user: manager }, ids.camporee, findActiveMembership), "the shared staff check refuses a Registration Manager", "PERMISSION_DENIED");
  const eventAdminActor = await requireStaffPointsAccess({ user: eventAdmin }, ids.camporee, findActiveMembership);
  assert(eventAdminActor.kind === "staff", "an Event Admin (the Clubs Administrator's role) may use it");
  assert(await prisma.eventModule.count({ where: { eventId: { in: [ids.camporee, ids.general, ids.unpublished] } } }) === 0, "refused calls changed nothing");

  // A coordinator turns it on, audited with their own account; twice audits once.
  assert((await act(acActor, { action: "switch", enabled: true })).enabled, "a coordinator switched it on");
  await act(acActor, { action: "switch", enabled: true });
  const onAudit = await prisma.auditLog.findMany({ where: { eventId: ids.camporee, action: "EVENT_MODULE_ENABLED" } });
  assert(onAudit.length === 1 && (onAudit[0]!.metadata as { actorAttendeeAccountId?: string }).actorAttendeeAccountId === ids.ac, "the switch is audited with the coordinator's account");
  assert((onAudit[0]!.metadata as { moduleKey?: string }).moduleKey === "attendance-points", "the audit names the module");

  // The coordinator sets the points; before that there is nothing to review.
  assert((await view(ids.camporee, acActor)).clubs.length === 0, "no review until the points are set");
  await refused(() => act(acActor, { action: "saveSettings", points: 0, requiresPathfinders: true }), "zero points are refused", "INVALID");
  await refused(() => act(acActor, { action: "saveSettings", points: 1.5, requiresPathfinders: true }), "part points are refused", "INVALID");
  const set = await act(acActor, { action: "saveSettings", points: 1500, requiresPathfinders: true });
  assert(set.settings?.points === 1500 && set.settings.requiresPathfinders, "a coordinator set 1,500 points and the camporee rule");
  await act(acActor, { action: "saveSettings", points: 1500, requiresPathfinders: true });
  assert(await prisma.auditLog.count({ where: { eventId: ids.camporee, action: "ATTENDANCE_POINTS_SETTINGS_SAVED" } }) === 1, "an unchanged save audits nothing more");

  // A coordinator reads counts and reasons, never names, and cannot mark, override, apply or undo.
  const acView = await view(ids.camporee, acActor);
  assert(acView.clubs.every((entry) => entry.people === null), "a coordinator sees no people");
  assert(!JSON.stringify(acView).includes("Pointsample") && !JSON.stringify(acView).includes("Ada"), "no name reaches a coordinator's view");
  assert(acView.basis === "CHECK_IN" && acView.usesCheckIn, "the camporee is counted from check-in");
  await refused(() => act(acActor, { action: "markChild", attendeeId: d.Fay!, marked: true }), "a coordinator cannot mark", "NOT_PERMITTED");
  await refused(() => act(acActor, { action: "override", organizationId: ids.clubB, outcome: "AWARD", reason: "Late arrival" }), "a coordinator cannot override", "NOT_PERMITTED");
  await refused(() => act(acActor, { action: "apply" }), "a coordinator cannot apply", "NOT_PERMITTED");
  await refused(() => act(acActor, { action: "undo" }), "a coordinator cannot undo", "NOT_PERMITTED");

  // The rules, camporee (check-in, Pathfinders needed). Staff see the names.
  let state = await view();
  assert(state.clubs.every((entry) => entry.people !== null), "staff see the people");
  assert(club(state, ids.clubA).earns && club(state, ids.clubA).points === 1500, "A: a director and a Pathfinder checked in earn the points");
  assert(!club(state, ids.clubB).earns && club(state, ids.clubB).reason === "No points: this event needs Pathfinders present, and only leaders counted.", "B: a leader alone earns nothing at a camporee");
  assert(club(state, ids.clubB).people!.find((person) => person.name.startsWith("Bea"))!.reason === "Registered but not checked in.", "B: the Pathfinder who did not check in does not count");
  assert(club(state, ids.clubC).earns && club(state, ids.clubC).pathfinders === 1 && club(state, ids.clubC).leaders === 0, "C: a Pathfinder alone is a club represented, so the camporee points are paid");
  assert(club(state, ids.clubE).reason === "No points: 1 person registered, nobody checked in.", "E: nobody checked in");

  // Mark an Area Coordinator's child (staff only). Directors and staff cannot be marked.
  await refused(() => act(adminActor, { action: "markChild", attendeeId: b.Eve!, marked: true }), "a staff member cannot be marked", "INVALID");
  await refused(() => act(adminActor, { action: "markChild", attendeeId: la.Ivy!, marked: true }), "a person on another event cannot be marked here", "NOT_FOUND");
  await act(adminActor, { action: "markChild", attendeeId: d.Fay!, marked: true });
  await act(adminActor, { action: "markChild", attendeeId: d.Fay!, marked: true });
  state = await view();
  const dClub = club(state, ids.clubD);
  assert(dClub.pathfinders === 0 && dClub.leaders === 1 && !dClub.earns, "D: the marked child does not count, so the camporee needs a Pathfinder and none counted");
  assert(dClub.people!.find((person) => person.name.startsWith("Fay"))!.reason.includes("Area Coordinator's child"), "D: the reason names the rule");
  assert(await prisma.auditLog.count({ where: { eventId: ids.camporee, action: "ATTENDANCE_POINTS_CHILD_MARKED" } }) === 1, "marking audits once");

  // Override one club with a reason: A is withheld, B is awarded.
  await refused(() => act(adminActor, { action: "override", organizationId: ids.clubB, outcome: "AWARD", reason: "  " }), "an override needs a reason", "INVALID");
  await refused(() => act(adminActor, { action: "override", organizationId: ids.general, outcome: "AWARD", reason: "Not registered" }), "an unregistered club cannot be overridden", "INVALID");
  await act(adminActor, { action: "override", organizationId: ids.clubB, outcome: "AWARD", reason: "Pathfinders arrived after check-in closed." });
  state = await view();
  assert(club(state, ids.clubB).earns && club(state, ids.clubB).reason === "Staff awarded the points: Pathfinders arrived after check-in closed." && !club(state, ids.clubB).computedEarns, "B: the override replaces the rules and keeps the reason");
  await act(adminActor, { action: "override", organizationId: ids.clubA, outcome: "WITHHOLD", reason: "Left before the program." });
  await act(adminActor, { action: "override", organizationId: ids.clubA, outcome: null, reason: "" });
  assert(club(await view(), ids.clubA).earns && club(await view(), ids.clubA).override === null, "taking the override away lets the rules decide again");
  assert(await prisma.auditLog.count({ where: { eventId: ids.camporee, action: { in: ["ATTENDANCE_POINTS_OVERRIDE_SET", "ATTENDANCE_POINTS_OVERRIDE_REMOVED"] } } }) === 3, "each override change is audited");

  // Apply: before the event starts is refused; after, staff apply once.
  await act(adminActor, { action: "switch", enabled: true }, ids.future);
  await act(adminActor, { action: "saveSettings", points: 300, requiresPathfinders: false }, ids.future);
  await refused(() => act(adminActor, { action: "apply" }, ids.future), "nothing can be applied before the event starts", "INVALID");
  await act(adminActor, { action: "switch", enabled: false }, ids.future);
  const applied = await act(adminActor, { action: "apply" });
  assert(applied.appliedAt !== null, "an administrator applied the points");
  const awardRows = await prisma.clubEventPointAward.findMany({ where: { eventId: ids.camporee }, orderBy: { organizationId: "asc" } });
  assert(awardRows.map((row) => row.organizationId).join() === [ids.clubA, ids.clubB, ids.clubC].join() && awardRows.every((row) => row.points === 1500 && row.clubYear === CLUB_YEAR && row.eventName === "Points Spring Camporee" && row.basis === "CHECK_IN"), "A, B (override) and C earned 1,500 each for 2025-26, with the event as the reason");
  assert(awardRows.find((row) => row.organizationId === ids.clubB)!.overridden, "the overridden award is marked");
  await refused(() => act(adminActor, { action: "apply" }), "applying twice is refused", "NOT_PERMITTED");
  await refused(() => act(adminActor, { action: "saveSettings", points: 1000, requiresPathfinders: false }), "settings are locked while applied", "NOT_PERMITTED");
  await refused(() => act(adminActor, { action: "override", organizationId: ids.clubE, outcome: "AWARD", reason: "x" }), "overrides are locked while applied", "NOT_PERMITTED");
  await refused(() => act(adminActor, { action: "markChild", attendeeId: d.Fay!, marked: false }), "marks are locked while applied", "NOT_PERMITTED");
  const appliedAudit = await prisma.auditLog.findMany({ where: { eventId: ids.camporee, action: "ATTENDANCE_POINTS_APPLIED" } });
  const appliedMeta = appliedAudit[0]!.metadata as { clubs?: number; totalPoints?: number; organizationIds?: string[]; points?: number };
  assert(appliedAudit.length === 1 && appliedMeta.clubs === 3 && appliedMeta.totalPoints === 4500 && appliedMeta.points === 1500 && appliedMeta.organizationIds?.length === 3, "apply is audited once, with counts and ids");

  // The points board: totals, the reason, the director's year, and Monthly Records unchanged.
  await prisma.clubMonthlyReport.deleteMany({ where: { organizationId: ids.clubA } });
  const summary = (await getAreaClubsSummary(CLUB_YEAR, new Date("2026-11-08T12:00:00Z"), { backgroundChecks: false })).filter((entry) => clubIds.includes(entry.id));
  const summaryA = summary.find((entry) => entry.id === ids.clubA)!;
  const summaryD = summary.find((entry) => entry.id === ids.clubD)!;
  assert(summaryA.eventPoints === 1500 && summaryA.totalPoints === 1500 && summaryA.reportPoints === 0, "the Area summary adds the event points to A's total and leaves report points alone");
  assert(summaryA.eventAwards.length === 1 && summaryA.eventAwards[0]!.eventName === "Points Spring Camporee" && summaryA.eventAwards[0]!.points === 1500, "the points board shows the event as the reason");
  assert(summaryD.eventPoints === 0 && summaryD.totalPoints === 0, "a club that earned nothing has nothing added");
  const directorYear = await getClubReportYear(ids.clubA, CLUB_YEAR);
  assert(directorYear.eventPoints.total === 1500 && directorYear.eventPoints.awards[0]!.eventName === "Points Spring Camporee" && directorYear.reports.length === 0, "the director sees the event points for their own club only");
  assert((await getClubReportYear(ids.clubD, CLUB_YEAR)).eventPoints.total === 0, "another club's director sees none");
  assert(JSON.stringify(directorYear).includes("Pointsample") === false, "no person is named on the director's points");

  // A coordinator reading after apply still sees counts only, with the applied points.
  const acAfter = await view(ids.camporee, acActor);
  assert(club(acAfter, ids.clubA).appliedPoints === 1500 && club(acAfter, ids.clubD).appliedPoints === null && acAfter.clubs.every((entry) => entry.people === null), "a coordinator sees the applied points by club, no names");

  // Switching the tool off keeps the applied points on the board.
  await act(acActor, { action: "switch", enabled: false });
  assert((await loadClubEventPoints(CLUB_YEAR, [ids.clubA])).get(ids.clubA)?.total === 1500, "off: the applied points stay on the board");
  await refused(() => act(adminActor, { action: "undo" }), "off: nothing can be undone until it is turned on", "NOT_AVAILABLE");
  await act(adminActor, { action: "switch", enabled: true });

  // Undo takes them off, audited; settings and overrides are kept.
  await refused(() => act(acActor, { action: "undo" }), "a coordinator still cannot undo", "NOT_PERMITTED");
  const undone = await act(adminActor, { action: "undo" });
  assert(undone.appliedAt === null && await prisma.clubEventPointAward.count({ where: { eventId: ids.camporee } }) === 0, "undo removed every award");
  assert(undone.settings?.points === 1500 && club(undone, ids.clubB).override !== null, "undo keeps the settings and the overrides");
  assert((await loadClubEventPoints(CLUB_YEAR, clubIds)).size === 0, "the points board no longer has them");
  await refused(() => act(adminActor, { action: "undo" }), "undoing twice is refused", "INVALID");
  const undoAudit = await prisma.auditLog.findMany({ where: { eventId: ids.camporee, action: "ATTENDANCE_POINTS_UNDONE" } });
  assert(undoAudit.length === 1 && (undoAudit[0]!.metadata as { totalPoints?: number }).totalPoints === 4500, "undo is audited once with the total");
  await act(adminActor, { action: "apply" });
  assert(await prisma.clubEventPointAward.count({ where: { eventId: ids.camporee } }) === 3, "applying again after an undo works");
  await act(adminActor, { action: "undo" });

  // Leadership weekend: no check-in, so registration counts; TLT and director rules; no Pathfinder rule.
  await act(adminActor, { action: "switch", enabled: true }, ids.leadership);
  await act(adminActor, { action: "saveSettings", points: 1500, requiresPathfinders: false }, ids.leadership);
  state = await view(ids.leadership);
  assert(state.basis === "REGISTRATION" && !state.usesCheckIn, "no check-in rows, so the count is from registration");
  assert(!club(state, ids.clubA).earns && club(state, ids.clubA).people![0]!.reason === "TLT under 18 with no supervising adult present.", "A: a TLT of 16 alone does not count");
  const lb = club(state, ids.clubB);
  assert(lb.earns && lb.leaders === 1 && lb.tlts === 1 && lb.reason === "Represented by 1 director or staff member and 1 TLT.", "B: a director typed TLT counts as a director, and supervises the TLT of 16");
  assert(club(state, ids.clubC).earns && club(state, ids.clubC).tlts === 1, "C: an adult TLT counts alone");
  assert(club(state, ids.clubD).earns && club(state, ids.clubD).leaders === 1, "D: staff count");
  const lastE = club(state, ids.clubE);
  assert(!lastE.earns && lastE.reason === "No points: nobody counted as representing the club." && lastE.people!.map((person) => person.reason).sort().join("|") === "Child, not a Pathfinder.|No role on the registration.", "E: a child and a person with no role do not count");
  // Director rule beats the mark: marking a director is refused, so the rule needs no special case at apply time.
  await refused(() => act(adminActor, { action: "markChild", attendeeId: ld.Gus!, marked: true }, ids.leadership), "a director cannot be marked as a coordinator's child", "INVALID");

  // No name or override reason reached the audit log.
  const logs = await prisma.auditLog.findMany({ where: { eventId: { in: [ids.camporee, ids.leadership, ids.future] } } });
  assert(!logs.some((row) => /Pointsample|Ada|Bea|Fay|Points Club|Pathfinders arrived|Left before/.test(`${row.summary} ${JSON.stringify(row.metadata)}`)), "no name or override reason is written to the audit log");
  void AttendancePointsError;
  console.log("attendance points: all checks passed");
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
