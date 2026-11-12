/**
 * Proves the optional Event staffing sheet (#1678) against a real PostgreSQL database:
 *
 * - off by default; an active Area Coordinator, an Event Admin and a system administrator can switch it on; an account with no
 *   grant, a revoked coordinator, an unpublished event, a general event and a Registration Manager are refused;
 * - while it is off nobody reads or changes the sheet; switched on, the event's coordinator and staff with the event view read
 *   it, only coordinators and staff with Configure event change it, Kitchen staff and other accounts cannot read it;
 * - only a person registered (submitted or confirmed) for THIS event, or on its active staff, can be put on an activity; a
 *   cancelled, waitlisted or other-event registration, and a person who is neither, are refused and nothing is written;
 * - an Area Coordinator with an active grant can be an activity's lead and nothing else; revoked, expired and non-coordinator accounts are refused;
 * - one lead per activity (a new lead replaces the old), one row per person per activity, the database's own checks hold;
 * - activities and assignments are audited with ids and counts only; another event's rows are never touched;
 * - gaps are worked out on the rows (no lead, 2 of 4 lifeguards, 0 of 3 TLTs), and a cancelled person counts for nothing;
 * - the CSV holds names, activity and role and no contact detail, and is audited with counts;
 * - each assigned person's own list holds their assignments only, for a published event with the tool on;
 * - switching off hides the sheet and keeps the rows.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:event-staffing
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { assertStaffingAccess, requireStaffStaffingReader, requireStaffStaffingWriter } from "@/modules/event-staffing/access";
import { activityGaps, summarizeStaffing } from "@/modules/event-staffing/domain";
import { listOwnAssignments } from "@/modules/event-staffing/own-assignments";
import { addAssignment, buildStaffingExport, createActivity, deleteActivity, listPickerPeople, loadStaffingSheet, removeAssignment, updateActivity } from "@/modules/event-staffing/repository";
import { applyStaffingSettings, requireStaffStaffingToggleAccess } from "@/modules/event-staffing/settings";
import { findActiveMembership } from "@/modules/events/repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-event-staffing-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@example.test");

const prisma = new PrismaClient();
const P = `sf1678_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_event`, other: `${P}_other`, unpublished: `${P}_unpub`, general: `${P}_gen`,
  admin: `${P}_admin`, eventAdmin: `${P}_eadmin`, manager: `${P}_mgr`, readOnly: `${P}_ro`, kitchen: `${P}_kit`, stranger: `${P}_stranger`, helperStaff: `${P}_hstaff`,
  ac: `${P}_ac`, expired: `${P}_expired`, revoked: `${P}_revoked`, plain: `${P}_plain`, samAccount: `${P}_sam`,
  sam: `${P}_psam`, pat: `${P}_ppat`, lee: `${P}_plee`, gone: `${P}_pgone`, wait: `${P}_pwait`, away: `${P}_paway`, nobody: `${P}_pnobody`,
};
const userIds = [ids.admin, ids.eventAdmin, ids.manager, ids.readOnly, ids.kitchen, ids.stranger, ids.helperStaff];
const accountIds = [ids.ac, ids.expired, ids.revoked, ids.plain, ids.samAccount];
const personIds = [ids.sam, ids.pat, ids.lee, ids.gone, ids.wait, ids.away, ids.nobody];
const eventIds = [ids.event, ids.other, ids.unpublished, ids.general];
const asUser = (id: string, name: string, globalRole: "SYSTEM_ADMIN" | null = null) => ({ id, email: `${id}@example.test`, displayName: name, globalRole }) as AuthenticatedUser;
const admin = asUser(ids.admin, "Staffing Admin", "SYSTEM_ADMIN");
const eventAdmin = asUser(ids.eventAdmin, "Staffing Event Admin");
const manager = asUser(ids.manager, "Staffing Manager");
const readOnly = asUser(ids.readOnly, "Staffing Read Only");
const kitchen = asUser(ids.kitchen, "Staffing Kitchen");
const stranger = asUser(ids.stranger, "Staffing Stranger");

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
  await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaffingAssignment.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaffingActivity.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventModule.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.registrationAttendee.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.registration.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: accountIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
}

async function register(eventId: string, personId: string, status: "CONFIRMED" | "SUBMITTED" | "WAITLISTED" | "CANCELLED" | "DRAFT", tag: string) {
  const registration = await prisma.registration.create({ data: { eventId, accountHolderPersonId: personId, confirmationCode: `${P}-${tag}`, status, totalAmount: 0 } });
  await prisma.registrationAttendee.create({ data: { eventId, registrationId: registration.id, personId, attendeeType: "Adult", profileSnapshot: {} } });
  return registration;
}

async function main() {
  await cleanup();
  await prisma.attendeeAccount.createMany({ data: [
    { id: ids.ac, email: `${P}-ac@example.test`, displayName: "Sample Coordinator", status: "ACTIVE" },
    { id: ids.expired, email: `${P}-expired@example.test`, displayName: "Expired Coordinator", status: "ACTIVE" },
    { id: ids.revoked, email: `${P}-revoked@example.test`, displayName: "Former Coordinator", status: "ACTIVE" },
    { id: ids.plain, email: `${P}-plain@example.test`, displayName: "Sample Attendee", status: "ACTIVE" },
    { id: ids.samAccount, email: `${P}-sam@example.test`, displayName: "Sam Sample", status: "ACTIVE", emailVerifiedAt: new Date() },
  ] });
  await prisma.user.createMany({ data: [admin, eventAdmin, manager, readOnly, kitchen, stranger].map((user) => ({ id: user.id, email: user.email, displayName: user.displayName, ...(user.globalRole ? { globalRole: user.globalRole } : {}) })) });
  await prisma.user.create({ data: { id: ids.helperStaff, email: `${ids.helperStaff}@example.test`, displayName: "Hal Helper" } });
  await prisma.areaCoordinatorGrant.createMany({ data: [
    { attendeeAccountId: ids.ac, grantedByUserId: ids.admin },
    { attendeeAccountId: ids.revoked, grantedByUserId: ids.admin, revokedAt: new Date(), revokedByUserId: ids.admin },
  ] });
  await prisma.person.createMany({ data: [
    { id: ids.sam, firstName: "Sam", lastName: "Sample", normalizedEmail: `${P}-sam@example.test`, phone: "(515) 555-0100" },
    { id: ids.pat, firstName: "Pat", lastName: "Example" },
    { id: ids.lee, firstName: "Lee", lastName: "Sample" },
    { id: ids.gone, firstName: "Gone", lastName: "Cancelled" },
    { id: ids.wait, firstName: "Wanda", lastName: "Waitlisted" },
    { id: ids.away, firstName: "Otto", lastName: "Elsewhere" },
    { id: ids.nobody, firstName: "Nora", lastName: "Unregistered" },
  ] });
  const base = { audience: "CLUB" as const, timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const };
  const dates = { startsAt: new Date("2027-05-07T14:00:00Z"), endsAt: new Date("2027-05-08T22:00:00Z") };
  await prisma.event.create({ data: { id: ids.event, slug: `${P}-event`, name: "Sample Spring Camporee 2027", ...base, ...dates } });
  await prisma.event.create({ data: { id: ids.other, slug: `${P}-other`, name: "Sample Fall Camporee 2027", ...base, ...dates } });
  await prisma.event.create({ data: { id: ids.unpublished, slug: `${P}-unpub`, name: "Sample Unpublished", ...base, ...dates, isPublished: false } });
  await prisma.event.create({ data: { id: ids.general, slug: `${P}-gen`, name: "Sample General", ...base, ...dates, audience: "GENERAL" } });
  await prisma.eventMembership.createMany({ data: [
    { eventId: ids.event, userId: ids.eventAdmin, role: "EVENT_ADMIN" },
    { eventId: ids.event, userId: ids.manager, role: "REGISTRATION_MANAGER" },
    { eventId: ids.event, userId: ids.readOnly, role: "READ_ONLY_STAFF" },
    { eventId: ids.event, userId: ids.kitchen, role: "KITCHEN_STAFF" },
    { eventId: ids.event, userId: ids.helperStaff, role: "READ_ONLY_STAFF" },
    { eventId: ids.other, userId: ids.stranger, role: "EVENT_ADMIN" },
  ] });
  await register(ids.event, ids.sam, "CONFIRMED", "sam");
  await register(ids.event, ids.pat, "SUBMITTED", "pat");
  await register(ids.event, ids.lee, "CONFIRMED", "lee");
  const goneRegistration = await register(ids.event, ids.gone, "CONFIRMED", "gone");
  await register(ids.event, ids.wait, "WAITLISTED", "wait");
  await register(ids.other, ids.away, "CONFIRMED", "away");
  const ac = { kind: "area-coordinator" as const, accountId: ids.ac, canWrite: true as const };
  const staffToggle = { kind: "staff" as const, userId: ids.eventAdmin };
  const staffActor = async (user: AuthenticatedUser, write: boolean) => (write ? requireStaffStaffingWriter({ user }, ids.event, findActiveMembership) : requireStaffStaffingReader({ user }, ids.event, findActiveMembership));

  // Off by default, and who may switch it.
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "event-staffing" } }) === 0, "off by default");
  await refused(() => applyStaffingSettings({ kind: "area-coordinator", accountId: ids.plain }, ids.event, { enabled: true }), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => applyStaffingSettings({ kind: "area-coordinator", accountId: ids.revoked }, ids.event, { enabled: true }), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => applyStaffingSettings(ac, ids.unpublished, { enabled: true }), "a coordinator cannot reach an unpublished event", "EVENT_NOT_FOUND");
  await refused(() => applyStaffingSettings(ac, ids.general, { enabled: true }), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => requireStaffStaffingToggleAccess({ user: manager }, ids.event, findActiveMembership), "a Registration Manager cannot switch it", "PERMISSION_DENIED");
  await requireStaffStaffingToggleAccess({ user: admin }, ids.event, findActiveMembership);
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "event-staffing" } }) === 0, "nothing was switched on by a refusal");

  // While it is off, nobody reads or changes it.
  await refused(() => assertStaffingAccess(ac, ids.event, "read"), "the sheet is hidden while off", "MODULE_OFF");
  await refused(() => createActivity(ac, ids.event, { name: "Canoe", description: "", location: "", timeText: "", tltsNeeded: 0, lifeguardsNeeded: 0, helpersNeeded: 0 }), "no activity while off", "MODULE_OFF");

  // A coordinator switches it on, audited by account.
  assert((await applyStaffingSettings(ac, ids.event, { enabled: true })).enabled, "switched on");
  const audited = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED", entityId: "event-staffing" } });
  assert(audited && !audited.actorUserId && (audited.metadata as { actorAttendeeAccountId?: string }).actorAttendeeAccountId === ids.ac, "the switch is audited with the coordinator's account");
  await applyStaffingSettings(staffToggle, ids.event, { enabled: true });
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED" } }) === 1, "switching on twice audits once");

  // Who reads, who changes.
  await assertStaffingAccess(await staffActor(admin, true), ids.event, "write");
  await assertStaffingAccess(await staffActor(eventAdmin, true), ids.event, "write");
  await assertStaffingAccess(await staffActor(manager, false), ids.event, "read");
  await assertStaffingAccess(await staffActor(readOnly, false), ids.event, "read");
  await refused(() => staffActor(manager, true), "a Registration Manager reads but cannot change", "PERMISSION_DENIED");
  await refused(() => staffActor(readOnly, true), "read-only staff cannot change", "PERMISSION_DENIED");
  await refused(() => staffActor(kitchen, false), "Kitchen staff cannot read", "PERMISSION_DENIED");
  await refused(() => staffActor(stranger, false), "an Event Admin of another event cannot read", "EVENT_ACCESS_DENIED");
  await refused(() => assertStaffingAccess({ kind: "area-coordinator", accountId: ids.revoked, canWrite: true }, ids.event, "read"), "a revoked coordinator cannot read", "NOT_AVAILABLE");
  await refused(() => assertStaffingAccess({ kind: "area-coordinator", accountId: ids.plain, canWrite: true }, ids.event, "read"), "an attendee with no grant cannot read", "NOT_AVAILABLE");
  await refused(() => assertStaffingAccess({ kind: "staff", userId: ids.manager, canWrite: false }, ids.event, "write"), "staff without Configure event cannot write", "NOT_PERMITTED");

  // Activities, audited with ids and counts only.
  const canoe = await createActivity(ac, ids.event, { name: "Canoe", description: "Sample paddling", location: "Sample Lake", timeText: "Friday 2 p.m.", tltsNeeded: 3, lifeguardsNeeded: 4, helpersNeeded: 1 });
  const surprise = await createActivity(await staffActor(eventAdmin, true), ids.event, { name: "Surprise", description: "", location: "", timeText: "", tltsNeeded: 0, lifeguardsNeeded: 0, helpersNeeded: 0 });
  const renamed = await updateActivity(ac, ids.event, canoe.id, { name: "Canoe", description: "Sample paddling", location: "Sample Lake", timeText: "Friday 2 p.m.", tltsNeeded: 3, lifeguardsNeeded: 2, helpersNeeded: 1 });
  assert(renamed.lifeguardsNeeded === 2, "an activity can be changed");
  const foreign = await prisma.eventStaffingActivity.create({ data: { eventId: ids.other, name: "Elsewhere" } });
  await refused(() => updateActivity(ac, ids.event, foreign.id, { name: "X", description: "", location: "", timeText: "", tltsNeeded: 0, lifeguardsNeeded: 0, helpersNeeded: 0 }), "an activity of another event is never changed", "ACTIVITY_NOT_FOUND");
  await refused(() => deleteActivity(ac, ids.event, foreign.id), "an activity of another event is never deleted", "ACTIVITY_NOT_FOUND");
  assert((await prisma.eventStaffingActivity.findUniqueOrThrow({ where: { id: foreign.id } })).name === "Elsewhere", "the other event's activity is untouched");

  // Only people on the event can be assigned.
  const lead = (assignee: { kind: "person" | "user"; id: string }, activityId = canoe.id, role: "LEAD" | "HELPER" | "LIFEGUARD" = "LEAD") => addAssignment(ac, ids.event, { activityId, role, assignee });
  for (const [label, personId] of [["a person who is not registered", ids.nobody], ["a person registered for another event only", ids.away], ["a waitlisted person", ids.wait]] as const) {
    await refused(() => lead({ kind: "person", id: personId }), `${label} is refused`, "NOT_ON_EVENT");
  }
  await refused(() => lead({ kind: "user", id: ids.stranger }), "staff of another event are refused", "NOT_ON_EVENT");
  await refused(() => lead({ kind: "person", id: "no-such-person" }), "an unknown id is refused", "NOT_ON_EVENT");
  await refused(() => addAssignment(ac, ids.event, { activityId: foreign.id, role: "LEAD", assignee: { kind: "person", id: ids.sam } }), "an activity of another event takes nobody", "ACTIVITY_NOT_FOUND");
  assert(await prisma.eventStaffingAssignment.count({ where: { eventId: ids.event } }) === 0, "no refusal wrote a row");
  const picker = await listPickerPeople(ids.event);
  const pickerNames = picker.people.filter((person) => person.kind !== "account").map((person) => person.name).sort().join("|");
  assert(pickerNames === ["Cancelled, Gone", "Example, Pat", "Sample, Lee", "Sample, Sam", "Hal Helper", "Staffing Event Admin", "Staffing Manager", "Staffing Read Only", "Staffing Kitchen"].sort().join("|"), `the picker lists this event's registered people and staff only (${pickerNames})`);

  // Assign: lead, helpers, lifeguard; a new lead replaces the old one; the database's own checks hold.
  await lead({ kind: "person", id: ids.sam });
  const afterLead = await lead({ kind: "person", id: ids.pat });
  assert(afterLead.assignments.filter((entry) => entry.role === "LEAD").length === 1 && afterLead.assignments[0]!.name === "Pat Example", "a new lead replaces the old lead");
  await refused(() => lead({ kind: "person", id: ids.pat }, canoe.id, "HELPER"), "the same person twice on one activity is refused", "CONFLICT");
  await addAssignment(await staffActor(eventAdmin, true), ids.event, { activityId: canoe.id, role: "LIFEGUARD", assignee: { kind: "person", id: ids.sam } });
  await addAssignment(ac, ids.event, { activityId: canoe.id, role: "HELPER", assignee: { kind: "user", id: ids.helperStaff } });
  const goneAssignment = await addAssignment(ac, ids.event, { activityId: canoe.id, role: "LIFEGUARD", assignee: { kind: "person", id: ids.gone } });
  await refused(async () => prisma.eventStaffingAssignment.create({ data: { eventId: ids.event, activityId: surprise.id, role: "HELPER" } }), "a row with no person and no user is refused by the database");
  await refused(async () => prisma.eventStaffingAssignment.create({ data: { eventId: ids.event, activityId: surprise.id, role: "HELPER", personId: ids.sam, userId: ids.helperStaff } }), "a row with both is refused by the database");
  await prisma.eventStaffingAssignment.create({ data: { eventId: ids.event, activityId: surprise.id, role: "LEAD", personId: ids.sam } });
  await refused(async () => prisma.eventStaffingAssignment.create({ data: { eventId: ids.event, activityId: surprise.id, role: "LEAD", personId: ids.lee } }), "two leads on one activity are refused by the database");
  await prisma.eventStaffingAssignment.deleteMany({ where: { activityId: surprise.id } });
  assert(goneAssignment.assignments.length === 4, "the activity holds its people");

  // Gaps on the rows; a cancelled person counts for nothing.
  await prisma.registration.update({ where: { id: goneRegistration.id }, data: { status: "CANCELLED" } });
  const sheet = await loadStaffingSheet(ids.event);
  const sheetCanoe = sheet.find((entry) => entry.id === canoe.id)!;
  assert(sheetCanoe.assignments.find((entry) => entry.name === "Gone Cancelled")?.active === false, "a cancelled person is marked no longer on the event");
  const texts = activityGaps(sheetCanoe).map((gap) => gap.text);
  assert(texts.join("|") === "Canoe: 0 of 3 TLTs|Canoe: 1 of 2 lifeguards", `gaps follow the rows (${texts.join("|")})`);
  const summary = summarizeStaffing(sheet);
  assert(summary.gaps.map((gap) => gap.text).includes("Surprise: no lead") && summary.activitiesWithGaps === 2, "a summary lists every gap");

  // Audit: ids and counts only.
  const rows = await prisma.auditLog.findMany({ where: { eventId: ids.event, entityType: { in: ["EventStaffingActivity", "EventStaffingAssignment"] } }, orderBy: { createdAt: "asc" } });
  assert(rows.length >= 8 && rows.every((row) => !/Canoe|Sample|Pat|Sam|Hal|Gone|@/.test(JSON.stringify(row.metadata) + row.summary)), "no name, activity text or email is in the audit log");
  assert(rows.some((row) => row.action === "EVENT_STAFFING_ASSIGNED" && !row.actorUserId) && rows.some((row) => row.actorUserId === ids.eventAdmin), "staff by user, a coordinator by account");

  // The CSV.
  const exported = await buildStaffingExport(ac, ids.event, "Sample Spring Camporee 2027");
  assert(exported.csv.includes('"Canoe","Lead","Example, Pat"') && exported.csv.includes("Surprise") && !exported.csv.includes("@") && !exported.csv.includes("555") && !exported.csv.includes("Cancelled"), "the CSV holds names, activity and role, nothing else and nobody who left");
  const exportAudit = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_STAFFING_CSV_EXPORTED" } });
  const counts = exportAudit?.metadata as { activityCount?: number; assignmentCount?: number } | undefined;
  assert(counts?.activityCount === 2 && counts.assignmentCount === 3 && !JSON.stringify(exportAudit).includes("Pat"), "the download is audited with counts");

  // Each person sees their own assignments only.
  const own = await listOwnAssignments({ id: ids.samAccount, verifiedEmail: `${P}-sam@example.test` });
  assert(own.length === 1 && own[0]!.activityName === "Canoe" && own[0]!.roleLabel === "Lifeguard", `Sam sees Sam's assignment only (${JSON.stringify(own)})`);
  assert(!JSON.stringify(own).includes("Pat") && !JSON.stringify(own).includes("Hal"), "nobody else's name is in it");
  assert((await listOwnAssignments({ id: ids.plain, verifiedEmail: `${P}-plain@example.test` })).length === 0, "an unassigned attendee sees nothing");
  await prisma.event.update({ where: { id: ids.event }, data: { isPublished: false } });
  assert((await listOwnAssignments({ id: ids.samAccount, verifiedEmail: `${P}-sam@example.test` })).length === 0, "nothing shows for an event that is not published");
  await prisma.event.update({ where: { id: ids.event }, data: { isPublished: true } });
  await prisma.registration.updateMany({ where: { eventId: ids.event, accountHolderPersonId: ids.sam }, data: { status: "CANCELLED" } });
  assert((await listOwnAssignments({ id: ids.samAccount, verifiedEmail: `${P}-sam@example.test` })).length === 0, "nothing shows once the person's registration is cancelled");
  await prisma.registration.updateMany({ where: { eventId: ids.event, accountHolderPersonId: ids.sam }, data: { status: "CONFIRMED" } });

  // Remove a person and delete an activity; both audited.
  const withSam = (await loadStaffingSheet(ids.event)).find((entry) => entry.id === canoe.id)!;
  await removeAssignment(ac, ids.event, withSam.assignments.find((entry) => entry.role === "HELPER")!.id);
  await refused(() => removeAssignment(ac, ids.event, "no-such-assignment"), "a missing assignment is refused", "ASSIGNMENT_NOT_FOUND");
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: "EVENT_STAFFING_UNASSIGNED" } }) === 1, "taking a person off is audited");

  // An Area Coordinator can be an activity's lead, and only the lead.
  const archery = await createActivity(ac, ids.event, { name: "Archery", description: "", location: "", timeText: "", tltsNeeded: 0, lifeguardsNeeded: 0, helpersNeeded: 0 });
  const asAc = (accountId: string, role: "LEAD" | "HELPER" | "LIFEGUARD") => addAssignment(ac, ids.event, { activityId: archery.id, role, assignee: { kind: "account", id: accountId } });
  await refused(() => asAc(ids.ac, "HELPER"), "a coordinator cannot be a helper");
  await refused(() => asAc(ids.ac, "LIFEGUARD"), "a coordinator cannot be a lifeguard");
  await refused(() => asAc(ids.revoked, "LEAD"), "a revoked coordinator cannot be chosen", "NOT_ON_EVENT");
  await prisma.areaCoordinatorGrant.create({ data: { attendeeAccountId: ids.expired, grantedByUserId: ids.admin, expiresAt: new Date(Date.now() - 60_000) } });
  await refused(() => asAc(ids.expired, "LEAD"), "an expired coordinator grant cannot be chosen", "NOT_ON_EVENT");
  await refused(() => asAc(ids.plain, "LEAD"), "an account with no grant cannot be chosen", "NOT_ON_EVENT");
  assert((await listPickerPeople(ids.event)).people.filter((person) => person.kind === "account" && person.id.startsWith(P)).map((person) => person.id).join() === ids.ac, "the picker lists only active coordinators in its own group");
  const led = await asAc(ids.ac, "LEAD");
  assert(led.assignments.length === 1 && led.assignments[0]!.kind === "account" && led.assignments[0]!.active && led.assignments[0]!.name === "Sample Coordinator", "an active coordinator is the lead");
  await refused(async () => prisma.eventStaffingAssignment.create({ data: { eventId: ids.event, activityId: archery.id, role: "HELPER", attendeeAccountId: ids.ac } }), "the database refuses a coordinator account as a helper");
  const acOwn = await listOwnAssignments({ id: ids.ac, verifiedEmail: `${P}-ac@example.test` });
  assert(acOwn.length === 1 && acOwn[0]!.activityName === "Archery" && acOwn[0]!.roleLabel === "Lead", "the coordinator sees their own lead job");
  const acAudit = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_STAFFING_ASSIGNED", entityId: led.assignments[0]!.id } });
  assert(acAudit && !JSON.stringify(acAudit).includes("Sample Coordinator") && (acAudit.metadata as { assigneeKind?: string }).assigneeKind === "account", "audited by id only");
  await prisma.areaCoordinatorGrant.update({ where: { attendeeAccountId: ids.ac }, data: { revokedAt: new Date() } });
  assert((await loadStaffingSheet(ids.event)).find((entry) => entry.id === archery.id)!.assignments[0]!.active === false, "a lead whose grant ended counts for nothing");
  assert((await listOwnAssignments({ id: ids.ac, verifiedEmail: `${P}-ac@example.test` })).length === 0, "and no longer shows on their own list");
  await prisma.areaCoordinatorGrant.update({ where: { attendeeAccountId: ids.ac }, data: { revokedAt: null } });
  await deleteActivity(ac, ids.event, archery.id);

  // Switching off hides it and keeps the rows.
  await applyStaffingSettings(ac, ids.event, { enabled: false });
  await refused(() => assertStaffingAccess(ac, ids.event, "read"), "hidden once off", "MODULE_OFF");
  assert((await listOwnAssignments({ id: ids.samAccount, verifiedEmail: `${P}-sam@example.test` })).length === 0, "a person's own list is hidden once off");
  assert(await prisma.eventStaffingActivity.count({ where: { eventId: ids.event } }) === 2 && await prisma.eventStaffingAssignment.count({ where: { eventId: ids.event } }) === 3, "the activities and people are kept");
  await applyStaffingSettings(ac, ids.event, { enabled: true });
  assert((await loadStaffingSheet(ids.event)).length === 2, "switching back on shows them again");
  await deleteActivity(ac, ids.event, surprise.id);
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: "EVENT_STAFFING_ACTIVITY_DELETED" } }) === 2 && (await loadStaffingSheet(ids.event)).length === 1, "a delete removes the activity and is audited");

  console.log("Event staffing verified.");
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
