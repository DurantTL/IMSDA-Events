/**
 * Proves the optional Budget sheet (#1682) against a real PostgreSQL database:
 *
 * - off by default; an active Area Coordinator, an Event Admin and a system administrator can switch it on; an account with no
 *   grant, a revoked coordinator, an unpublished event, a general event and a Registration Manager are refused;
 * - while it is off nobody reads or changes the sheet; switched on, the event's coordinator and staff with Manage finance or
 *   View reports read it, a Registration Manager reads but cannot change a line, read-only staff and other accounts cannot;
 * - adding, changing and deleting a cost line is audited with amounts only; a line of another event is never touched;
 * - the auto-filled figures equal Finance's and the reports' own functions on the same rows, and the totals follow;
 * - the CSV holds totals and cost lines and is audited;
 * - switching off hides the sheet and keeps the cost lines;
 * - a copied event shows its source's sheet read only, and says so when the source kept none.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:event-budget
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { assertBudgetAccess, requireStaffBudgetReader, requireStaffBudgetWriter } from "@/modules/event-budgets/access";
import { computeBudgetTotals } from "@/modules/event-budgets/domain";
import { buildBudgetFigures } from "@/modules/event-budgets/figures";
import { buildBudgetExport, createCostLine, deleteCostLine, listCostLines, loadBudgetFigures, loadBudgetSheet, loadCarriedBudget, updateCostLine } from "@/modules/event-budgets/repository";
import { applyBudgetSettings, requireStaffBudgetToggleAccess } from "@/modules/event-budgets/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { getLodgingView } from "@/modules/lodging/service";
import { loadMealView } from "@/modules/meals/view-repository";
import { listRegistrations } from "@/modules/registrations/repository";
import { summarizeFinanceTotals } from "@/modules/registrations/finance-view";
import { clubHeadcounts } from "@/modules/reporting/club-event-reports";
import { getClubEventRecords } from "@/modules/reporting/club-event-reports-repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-event-budget-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@example.test");

const prisma = new PrismaClient();
const P = `bg1682_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_event`, copy: `${P}_copy`, bare: `${P}_bare`, bareCopy: `${P}_barecopy`, unpublished: `${P}_unpub`, general: `${P}_gen`,
  admin: `${P}_admin`, eventAdmin: `${P}_eadmin`, finance: `${P}_fin`, manager: `${P}_mgr`, readOnly: `${P}_ro`,
  ac: `${P}_ac`, revoked: `${P}_revoked`, plain: `${P}_plain`,
};
const userIds = [ids.admin, ids.eventAdmin, ids.finance, ids.manager, ids.readOnly];
const accountIds = [ids.ac, ids.revoked, ids.plain];
const eventIds = [ids.event, ids.copy, ids.bare, ids.bareCopy, ids.unpublished, ids.general];
const asUser = (id: string, name: string, globalRole: "SYSTEM_ADMIN" | null = null) => ({ id, email: `${id}@example.test`, displayName: name, globalRole }) as AuthenticatedUser;
const admin = asUser(ids.admin, "Budget Admin", "SYSTEM_ADMIN");
const eventAdmin = asUser(ids.eventAdmin, "Budget Event Admin");
const finance = asUser(ids.finance, "Budget Finance");
const manager = asUser(ids.manager, "Budget Manager");
const readOnly = asUser(ids.readOnly, "Budget Read Only");

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
  await prisma.eventCloneRecord.deleteMany({ where: { resultEventId: { in: eventIds } } });
  await prisma.eventBudgetCostLine.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: accountIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: accountIds } } });
}

async function main() {
  await cleanup();
  await prisma.attendeeAccount.createMany({ data: [
    { id: ids.ac, email: `${P}-ac@example.test`, displayName: "Sample Coordinator", status: "ACTIVE" },
    { id: ids.revoked, email: `${P}-revoked@example.test`, displayName: "Former Coordinator", status: "ACTIVE" },
    { id: ids.plain, email: `${P}-plain@example.test`, displayName: "Sample Attendee", status: "ACTIVE" },
  ] });
  await prisma.user.createMany({ data: [admin, eventAdmin, finance, manager, readOnly].map((user) => ({ id: user.id, email: user.email, displayName: user.displayName, ...(user.globalRole ? { globalRole: user.globalRole } : {}) })) });
  await prisma.areaCoordinatorGrant.createMany({ data: [
    { attendeeAccountId: ids.ac, grantedByUserId: ids.admin },
    { attendeeAccountId: ids.revoked, grantedByUserId: ids.admin, revokedAt: new Date(), revokedByUserId: ids.admin },
  ] });
  const base = { audience: "CLUB" as const, timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const };
  const dates = { startsAt: new Date("2027-05-07T14:00:00Z"), endsAt: new Date("2027-05-08T22:00:00Z") };
  await prisma.event.create({ data: { id: ids.event, slug: `${P}-event`, name: "Sample Spring Camporee 2027", ...base, ...dates } });
  await prisma.event.create({ data: { id: ids.bare, slug: `${P}-bare`, name: "Sample Fall Camporee 2027", ...base, ...dates } });
  await prisma.event.create({ data: { id: ids.unpublished, slug: `${P}-unpub`, name: "Sample Unpublished", ...base, ...dates, isPublished: false } });
  await prisma.event.create({ data: { id: ids.general, slug: `${P}-gen`, name: "Sample General", ...base, ...dates, audience: "GENERAL" } });
  await prisma.eventMembership.createMany({ data: [
    { eventId: ids.event, userId: ids.eventAdmin, role: "EVENT_ADMIN" },
    { eventId: ids.event, userId: ids.finance, role: "FINANCE_MANAGER" },
    { eventId: ids.event, userId: ids.manager, role: "REGISTRATION_MANAGER" },
    { eventId: ids.event, userId: ids.readOnly, role: "READ_ONLY_STAFF" },
  ] });
  const ac = { kind: "area-coordinator" as const, accountId: ids.ac, canWrite: true as const };
  const staffToggle = { kind: "staff" as const, userId: ids.eventAdmin };
  const staffActor = async (user: AuthenticatedUser, write: boolean) => (write ? requireStaffBudgetWriter({ user }, ids.event, findActiveMembership) : requireStaffBudgetReader({ user }, ids.event, findActiveMembership));

  // Off by default, and who may switch it.
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "event-budget" } }) === 0, "off by default");
  await refused(() => applyBudgetSettings({ kind: "area-coordinator", accountId: ids.plain }, ids.event, { enabled: true }), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => applyBudgetSettings({ kind: "area-coordinator", accountId: ids.revoked }, ids.event, { enabled: true }), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => applyBudgetSettings(ac, ids.unpublished, { enabled: true }), "a coordinator cannot reach an unpublished event", "EVENT_NOT_FOUND");
  await refused(() => applyBudgetSettings(ac, ids.general, { enabled: true }), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => requireStaffBudgetToggleAccess({ user: manager }, ids.event, findActiveMembership), "a Registration Manager cannot switch it", "PERMISSION_DENIED");
  await refused(() => requireStaffBudgetToggleAccess({ user: finance }, ids.event, findActiveMembership), "a Finance Manager cannot switch it", "PERMISSION_DENIED");
  await requireStaffBudgetToggleAccess({ user: admin }, ids.event, findActiveMembership);
  assert(await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "event-budget" } }) === 0, "nothing was switched on by a refusal");

  // While it is off, nobody reads or changes it.
  await refused(() => assertBudgetAccess(ac, ids.event, "read"), "the sheet is hidden while off", "MODULE_OFF");
  await refused(() => createCostLine(ac, ids.event, { label: "Pins", description: "", quantity: null, amountCents: 100 }), "no cost line while off", "MODULE_OFF");

  // A coordinator switches it on, audited by account.
  const state = await applyBudgetSettings(ac, ids.event, { enabled: true });
  assert(state.enabled, "switched on");
  const audited = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED", entityId: "event-budget" } });
  assert(audited && !audited.actorUserId && (audited.metadata as { actorAttendeeAccountId?: string }).actorAttendeeAccountId === ids.ac, "the switch is audited with the coordinator's account");
  await applyBudgetSettings(staffToggle, ids.event, { enabled: true });
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED" } }) === 1, "switching on twice audits once");

  // Who reads, who changes.
  await assertBudgetAccess(await staffActor(admin, true), ids.event, "write");
  await assertBudgetAccess(await staffActor(eventAdmin, true), ids.event, "write");
  await assertBudgetAccess(await staffActor(finance, true), ids.event, "write");
  await assertBudgetAccess(await staffActor(manager, false), ids.event, "read");
  await refused(() => staffActor(manager, true), "a Registration Manager reads but cannot change", "PERMISSION_DENIED");
  await refused(() => staffActor(readOnly, false), "read-only staff cannot read", "PERMISSION_DENIED");
  await refused(() => assertBudgetAccess({ kind: "area-coordinator", accountId: ids.revoked, canWrite: true }, ids.event, "read"), "a revoked coordinator cannot read", "NOT_AVAILABLE");
  await refused(() => assertBudgetAccess({ kind: "area-coordinator", accountId: ids.plain, canWrite: true }, ids.event, "read"), "an attendee with no grant cannot read", "NOT_AVAILABLE");
  await refused(() => assertBudgetAccess({ kind: "staff", userId: ids.manager, canWrite: false }, ids.event, "write"), "report-only staff cannot write", "NOT_PERMITTED");

  // Cost lines, audited with amounts only.
  const trophies = await createCostLine(ac, ids.event, { label: "Trophies", description: "Sample first place", quantity: 6, amountCents: 30_000 });
  const staffActorFinance = await staffActor(finance, true);
  const wristbands = await createCostLine(staffActorFinance, ids.event, { label: "Wristbands", description: "", quantity: null, amountCents: 12_550 });
  await updateCostLine(ac, ids.event, wristbands.id, { label: "Wristbands", description: "", quantity: 300, amountCents: 13_000 });
  const other = await prisma.eventBudgetCostLine.create({ data: { eventId: ids.bare, label: "Pins", amountCents: 500 } });
  await refused(() => updateCostLine(ac, ids.event, other.id, { label: "Pins", description: "", quantity: null, amountCents: 1 }), "a line of another event is never changed", "LINE_NOT_FOUND");
  await refused(() => deleteCostLine(ac, ids.event, other.id), "a line of another event is never deleted", "LINE_NOT_FOUND");
  assert((await prisma.eventBudgetCostLine.findUniqueOrThrow({ where: { id: other.id } })).amountCents === 500, "the other event's line is untouched");
  const actions = (await prisma.auditLog.findMany({ where: { eventId: ids.event, entityType: "EventBudgetCostLine" }, orderBy: { createdAt: "asc" } }));
  assert(actions.map((row) => row.action).join() === "EVENT_BUDGET_COST_ADDED,EVENT_BUDGET_COST_ADDED,EVENT_BUDGET_COST_CHANGED", "add, add and change are audited");
  assert(actions.every((row) => !JSON.stringify(row).includes("Sample first place")), "the free description is never in the audit log");
  assert(actions[1]!.actorUserId === ids.finance && !actions[0]!.actorUserId, "staff by user, a coordinator by account");

  // The figures equal the source functions on the same rows, and the totals follow.
  const [registrations, clubRecords, lodging, meals] = await Promise.all([listRegistrations(ids.event), getClubEventRecords(ids.event), getLodgingView(ids.event), loadMealView(ids.event)]);
  const direct = buildBudgetFigures({ registrations, attendees: clubRecords.clubs.flatMap((club) => club.attendees), lodging, meals });
  const loaded = await loadBudgetFigures(ids.event);
  assert(JSON.stringify(loaded) === JSON.stringify(direct), "the loaded figures are the builder's answer on the same rows");
  const totalsDirect = summarizeFinanceTotals(registrations);
  assert(loaded.money.billedCents === totalsDirect.billed && loaded.money.receivedCents === totalsDirect.received && loaded.money.refundedCents === totalsDirect.refunded, "money equals summarizeFinanceTotals");
  assert(JSON.stringify(loaded.counts) === JSON.stringify(clubHeadcounts(clubRecords.clubs.flatMap((club) => club.attendees))), "counts equal clubHeadcounts");
  assert(loaded.rooms === null && loaded.mealsOrdered === null, "rooms and meals are hidden when those modules are not set up");
  const sheet = await loadBudgetSheet(ids.event, "Sample Spring Camporee 2027");
  assert(sheet.costLines.length === 2 && sheet.totals.costsCents === 43_000, "two cost lines add up");
  assert(JSON.stringify(sheet.totals) === JSON.stringify(computeBudgetTotals(sheet.figures.money, await listCostLines(ids.event))), "the totals follow the lines");

  // The CSV.
  const exported = await buildBudgetExport(ac, ids.event, "Sample Spring Camporee 2027");
  assert(exported.csv.includes("Trophies") && exported.csv.includes("Total costs") && !exported.csv.includes("@"), "the CSV holds the cost lines and totals and no personal data");
  const exportAudit = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "EVENT_BUDGET_CSV_EXPORTED" } });
  assert(exportAudit && (exportAudit.metadata as { costLineCount?: number }).costLineCount === 2, "the download is audited with counts");

  // Last year's sheet on a copy.
  const cloneBase = { actorUserId: ids.admin, requestInput: {}, sourceFingerprint: "x", sourceVersions: {}, selections: {}, exclusions: {}, snapshot: {} };
  await prisma.event.create({ data: { id: ids.copy, slug: `${P}-copy`, name: "Sample Spring Camporee 2028", ...base, startsAt: new Date("2028-05-05T14:00:00Z"), endsAt: new Date("2028-05-06T22:00:00Z") } });
  await prisma.eventCloneRecord.create({ data: { ...cloneBase, sourceEventId: ids.event, resultEventId: ids.copy, requestKey: `${P}-k1` } });
  const carried = await loadCarriedBudget(ac, ids.copy);
  assert(carried.kind === "sheet" && carried.sheet.costLines.length === 2 && carried.sourceEventName === "Sample Spring Camporee 2027", "the copy shows last year's sheet");
  assert(await prisma.eventBudgetCostLine.count({ where: { eventId: ids.copy } }) === 0, "cost lines are not copied to the new event");
  await prisma.event.create({ data: { id: ids.bareCopy, slug: `${P}-barecopy`, name: "Sample Fall Camporee 2028", ...base, startsAt: new Date("2028-09-05T14:00:00Z"), endsAt: new Date("2028-09-06T22:00:00Z") } });
  await prisma.eventBudgetCostLine.deleteMany({ where: { eventId: ids.bare } });
  await prisma.eventCloneRecord.create({ data: { ...cloneBase, sourceEventId: ids.bare, resultEventId: ids.bareCopy, requestKey: `${P}-k2` } });
  const none = await loadCarriedBudget(ac, ids.bareCopy);
  assert(none.kind === "no-sheet", "a source with no sheet is said to have none");
  assert((await loadCarriedBudget(ac, ids.event)).kind === "none", "an event that was not copied shows no last year");

  // Switching off hides it and keeps the lines.
  await applyBudgetSettings(ac, ids.event, { enabled: false });
  await refused(() => assertBudgetAccess(ac, ids.event, "read"), "hidden once off", "MODULE_OFF");
  assert(await prisma.eventBudgetCostLine.count({ where: { eventId: ids.event } }) === 2, "the cost lines are kept");
  await applyBudgetSettings(ac, ids.event, { enabled: true });
  assert((await listCostLines(ids.event)).length === 2, "switching back on shows them again");
  await deleteCostLine(ac, ids.event, trophies.id);
  assert((await listCostLines(ids.event)).length === 1 && await prisma.auditLog.count({ where: { eventId: ids.event, action: "EVENT_BUDGET_COST_DELETED" } }) === 1, "a delete removes the line and is audited");

  console.log("Budget sheet verified.");
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
