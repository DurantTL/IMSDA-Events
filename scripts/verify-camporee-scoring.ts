/**
 * Proves Camporee scoring (#1676) against a real PostgreSQL database:
 *
 * - off by default; an active Area Coordinator, the Clubs Administrator's role (Event Admin) and a system administrator can
 *   switch it on through the shared helper; a signed-in account with no grant, a revoked coordinator, an unpublished or a
 *   general event, and a Registration Manager are refused; each switch is audited with the coordinator's account;
 * - scored events are defined by whoever may switch it, with a clear refusal for a duplicate name and for changing what a
 *   score means once scores exist;
 * - scores can be entered for a registered club or Pathfinder only (not staff, not another event's people), by a coordinator
 *   or a Registration Manager too; ties share a place; ribbons are listed only for clubs that answered yes;
 * - only staff administrators publish; nothing is audited per score before publishing; a change after publishing is
 *   audited (ids and numbers only) and only they can make it;
 * - a director sees only their own club's rows, only while on and published; off hides it and keeps every score.
 *
 * Uses fictitious rows it creates and removes itself. Nothing is sent.
 *
 *   npm run test:camporee-scoring
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import type { ScoredEventInput } from "@/modules/camporee-scoring/domain";
import {
  CamporeeScoringError,
  applyCamporeeAction,
  loadCamporeeScoringState,
  loadDirectorCamporeeResults,
  requireStaffScoringAccess,
  type CamporeeActor,
} from "@/modules/camporee-scoring/service";
import { requireStaffToggleAccess } from "@/modules/event-modules/scoped-toggle";
import { findActiveMembership } from "@/modules/events/repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-camporee-scoring-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `cs1676_${randomUUID().slice(0, 8)}`;
const ids = {
  event: `${P}_ev`, unpublished: `${P}_unpub`, general: `${P}_gen`, other: `${P}_other`,
  clubA: `${P}_clubA`, clubB: `${P}_clubB`, clubC: `${P}_clubC`, clubD: `${P}_clubD`,
  admin: `${P}_admin`, eventAdmin: `${P}_eadmin`, manager: `${P}_mgr`, nobody: `${P}_nobody`,
  ac: `${P}_ac`, plain: `${P}_plain`, revoked: `${P}_revoked`,
  holder: `${P}_holder`, form: `${P}_form`, formVersion: `${P}_form_v1`,
};
const admin = { id: ids.admin, email: `${P}-admin@example.test`, displayName: "Scoring Admin", globalRole: "SYSTEM_ADMIN" } as AuthenticatedUser;
const eventAdmin = { id: ids.eventAdmin, email: `${P}-eadmin@example.test`, displayName: "Scoring Event Admin", globalRole: null } as AuthenticatedUser;
const manager = { id: ids.manager, email: `${P}-mgr@example.test`, displayName: "Scoring Manager", globalRole: null } as AuthenticatedUser;
const nobody = { id: ids.nobody, email: `${P}-nobody@example.test`, displayName: "Scoring Nobody", globalRole: null } as AuthenticatedUser;
const names = ["Ada", "Bea", "Cy", "Dot", "Eve"];
const personId = (name: string) => `${P}_person_${name}`;

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
  const eventIds = [ids.event, ids.unpublished, ids.general, ids.other];
  await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.publicRegistrationSubmission.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.clubA, ids.clubB, ids.clubC, ids.clubD] } } });
  await prisma.person.deleteMany({ where: { id: { in: [ids.holder, ...names.map(personId)] } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { attendeeAccountId: { in: [ids.ac, ids.revoked] } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: [ids.ac, ids.plain, ids.revoked] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.eventAdmin, ids.manager, ids.nobody] } } });
}

let counter = 0;
async function register(eventId: string, club: string, ribbons: string, attendees: Array<{ name: string; type: string }>) {
  counter += 1;
  const created = await prisma.registration.create({
    data: { eventId, accountHolderPersonId: ids.holder, confirmationCode: `${P}-${counter}`, status: "CONFIRMED", totalAmount: "50.00", submittedAt: new Date("2027-03-01T10:00:00Z") },
    select: { id: true },
  });
  await prisma.clubEventRegistration.create({ data: { eventId, organizationId: club, registrationId: created.id } });
  const out: Record<string, string> = {};
  for (const [position, attendee] of attendees.entries()) {
    const row = await prisma.registrationAttendee.create({
      data: { eventId, registrationId: created.id, personId: personId(attendee.name), attendeeType: "YOUTH", position, profileSnapshot: { firstName: attendee.name, lastName: "Scoresample" }, formResponses: { attendee_type: attendee.type } },
      select: { id: true },
    });
    out[attendee.name] = row.id;
  }
  await prisma.publicRegistrationSubmission.create({
    data: { eventId, formVersionId: ids.formVersion, registrationId: created.id, idempotencyKey: `${P}-${counter}`, requestHash: `hash-${counter}`, responses: ribbons ? { event_ribbons: ribbons } : {}, pricingSnapshot: { lineItems: [] } },
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
  await prisma.person.createMany({ data: [{ id: ids.holder, firstName: "Pat", lastName: "Holder" }, ...names.map((name) => ({ id: personId(name), firstName: name, lastName: "Scoresample" }))] });
  await prisma.organization.createMany({ data: ["A", "B", "C", "D"].map((letter) => ({ id: ids[`club${letter}` as "clubA"], type: "CLUB" as const, name: `Scoring Club ${letter} ${P}`, normalizedName: `scoring club ${letter.toLowerCase()} ${P}` })) });
  const when = { startsAt: new Date("2027-04-01T00:00:00Z"), endsAt: new Date("2027-04-03T00:00:00Z"), timezone: "America/Chicago", isPublished: true, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const };
  await prisma.event.create({ data: { id: ids.event, slug: `${P}-camporee`, name: "Scoring Spring Camporee", audience: "CLUB", ...when } });
  await prisma.event.create({ data: { id: ids.unpublished, slug: `${P}-unpub`, name: "Scoring Unpublished", audience: "CLUB", ...when, isPublished: false } });
  await prisma.event.create({ data: { id: ids.general, slug: `${P}-gen`, name: "Scoring General", audience: "GENERAL", ...when } });
  await prisma.event.create({ data: { id: ids.other, slug: `${P}-other`, name: "Scoring Other Camporee", audience: "CLUB", ...when } });
  await prisma.registrationForm.create({ data: { id: ids.form, eventId: ids.event, createdByUserId: ids.admin, name: "Synthetic form", slug: `${P}-form` } });
  await prisma.registrationFormVersion.create({ data: { id: ids.formVersion, formId: ids.form, createdByUserId: ids.admin, versionNumber: 1, definition: { sections: [] } } });
  await prisma.eventMembership.createMany({ data: [
    { eventId: ids.event, userId: ids.eventAdmin, role: "EVENT_ADMIN" },
    { eventId: ids.event, userId: ids.manager, role: "REGISTRATION_MANAGER" },
  ] });

  // Club A and C asked for ribbons, B did not, D registered but has no scores. Dot is staff and is never scored.
  const a = await register(ids.event, ids.clubA, "Yes", [{ name: "Ada", type: "Pathfinder" }, { name: "Dot", type: "Staff" }]);
  const b = await register(ids.event, ids.clubB, "No", [{ name: "Bea", type: "Pathfinder" }]);
  const c = await register(ids.event, ids.clubC, "Yes", [{ name: "Cy", type: "Pathfinder" }]);
  await register(ids.event, ids.clubD, "Yes", [{ name: "Eve", type: "Pathfinder" }]);
  // Another event's attendee cannot be scored here.
  const elsewhere = await register(ids.other, ids.clubA, "Yes", [{ name: "Ada", type: "Pathfinder" }]);

  const acActor: CamporeeActor = { kind: "area-coordinator", accountId: ids.ac };
  const adminActor: CamporeeActor = { kind: "staff", userId: ids.admin, administrator: true };
  const managerActor: CamporeeActor = { kind: "staff", userId: ids.manager, administrator: false };
  const state = (actor: CamporeeActor = adminActor) => loadCamporeeScoringState(ids.event, actor);
  const act = (actor: CamporeeActor, action: Parameters<typeof applyCamporeeAction>[2], eventId = ids.event) => applyCamporeeAction(actor, eventId, action);

  // Off by default: nothing can be defined or entered, and the card is hidden.
  assert(!(await state()).enabled && await prisma.eventModule.count({ where: { eventId: ids.event, moduleKey: "camporee-scoring" } }) === 0, "off by default");
  await refused(() => act(adminActor, { action: "saveScoredEvent", scoredEvent: { name: "Early", kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [] } }), "nothing can be defined while off", "NOT_AVAILABLE");
  assert(await loadDirectorCamporeeResults(ids.clubA, ids.event) === null, "a director sees nothing while off");

  // Who may switch it.
  await refused(() => act({ kind: "area-coordinator", accountId: ids.plain }, { action: "switch", enabled: true }), "an account with no grant is refused", "NOT_AVAILABLE");
  await refused(() => act({ kind: "area-coordinator", accountId: ids.revoked }, { action: "switch", enabled: true }), "a revoked coordinator is refused", "NOT_AVAILABLE");
  await refused(() => act(acActor, { action: "switch", enabled: true }, ids.general), "a general event is refused", "EVENT_NOT_FOUND");
  await refused(() => act(acActor, { action: "switch", enabled: true }, ids.unpublished), "a coordinator cannot reach an unpublished event", "EVENT_NOT_FOUND");
  await refused(() => requireStaffScoringAccess({ user: nobody }, ids.event, findActiveMembership), "staff with no role on the event are refused", "EVENT_ACCESS_DENIED");
  await refused(() => act(managerActor, { action: "switch", enabled: true }), "a Registration Manager cannot switch it", "NOT_PERMITTED");
  await refused(() => requireStaffToggleAccess({ user: manager }, ids.event, findActiveMembership), "the shared staff check refuses a Registration Manager", "PERMISSION_DENIED");
  await requireStaffToggleAccess({ user: eventAdmin }, ids.event, findActiveMembership);
  const managerAccess = await requireStaffScoringAccess({ user: manager }, ids.event, findActiveMembership);
  assert(managerAccess.kind === "staff" && !managerAccess.administrator, "a Registration Manager may enter scores, not administer");
  const eventAdminAccess = await requireStaffScoringAccess({ user: eventAdmin }, ids.event, findActiveMembership);
  assert(eventAdminAccess.kind === "staff" && eventAdminAccess.administrator, "an Event Admin (the Clubs Administrator's role) administers");
  assert(await prisma.eventModule.count({ where: { eventId: { in: [ids.event, ids.general, ids.unpublished] } } }) === 0, "refused calls changed nothing");

  // A coordinator turns it on, audited with their own account; twice audits once.
  assert((await act(acActor, { action: "switch", enabled: true })).enabled, "a coordinator switched it on");
  await act(acActor, { action: "switch", enabled: true });
  const onAudit = await prisma.auditLog.findMany({ where: { eventId: ids.event, action: "EVENT_MODULE_ENABLED" } });
  assert(onAudit.length === 1 && (onAudit[0]!.metadata as { actorAttendeeAccountId?: string; moduleKey?: string }).actorAttendeeAccountId === ids.ac, "the switch is audited with the coordinator's account");
  assert((onAudit[0]!.metadata as { moduleKey?: string }).moduleKey === "camporee-scoring", "the audit names the module");

  // Scored events.
  const events: ScoredEventInput[] = [
    { name: "Stilts", kind: "PATHFINDER", unit: "FEET", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [] },
    { name: "Canoe race", kind: "CLUB", unit: "TIME", higherWins: false, ribbonMode: "PLACES", ribbonPlaces: 2, ribbonBands: [] },
    { name: "Telephone verse", kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "BANDS", ribbonPlaces: 3, ribbonBands: [{ label: "Blue", threshold: "90" }, { label: "Red", threshold: "70" }] },
  ];
  await act(acActor, { action: "saveScoredEvent", scoredEvent: events[0]! });
  await act(adminActor, { action: "saveScoredEvent", scoredEvent: events[1]! });
  await act(adminActor, { action: "saveScoredEvent", scoredEvent: events[2]! });
  await refused(() => act(managerActor, { action: "saveScoredEvent", scoredEvent: { ...events[0]!, name: "Sneaky" } }), "a Registration Manager cannot define scored events", "NOT_PERMITTED");
  await refused(() => act(adminActor, { action: "saveScoredEvent", scoredEvent: { ...events[0]!, name: " stilts " } }), "a duplicate name is refused", "INVALID");
  await refused(() => act(adminActor, { action: "saveScoredEvent", scoredEvent: { ...events[2]!, name: "Bad bands", ribbonBands: [{ label: "Red", threshold: "70" }, { label: "Blue", threshold: "90" }] } }), "bands out of order are refused", "INVALID");
  const defined = await state();
  assert(defined.scoredEvents.length === 3, "three scored events");
  const idOf = (name: string) => defined.scoredEvents.find((event) => event.name === name)!.id;
  assert(defined.people.length === 4 && !defined.people.some((person) => person.name.startsWith("Dot")), "staff are not offered as Pathfinders");

  // Score entry: only this event's registered clubs and Pathfinders.
  const score = (actor: CamporeeActor, scoredEvent: string, subjectId: string, value: string | null) => act(actor, { action: "saveScore", entry: { scoredEventId: idOf(scoredEvent), subjectId, value } });
  await refused(() => score(acActor, "Stilts", a.Dot!, "10"), "a staff member cannot be scored as a Pathfinder", "INVALID");
  await refused(() => score(acActor, "Stilts", elsewhere.Ada!, "10"), "another event's attendee cannot be scored", "INVALID");
  await refused(() => score(acActor, "Canoe race", ids.general, "1:00"), "an unregistered club cannot be scored", "INVALID");
  await refused(() => score(acActor, "Canoe race", ids.clubA, "fast"), "a bad time is refused", "INVALID");
  await refused(() => score(nobodyActor(), "Stilts", a.Ada!, "10"), "a revoked coordinator cannot enter scores", "NOT_AVAILABLE");
  await score(acActor, "Stilts", a.Ada!, "50");
  await score(managerActor, "Stilts", b.Bea!, "50");
  await score(adminActor, "Stilts", c.Cy!, "20");
  await score(acActor, "Canoe race", ids.clubA, "1:02.5");
  await score(acActor, "Canoe race", ids.clubB, "45.2");
  await score(acActor, "Canoe race", ids.clubC, "1:10");
  await score(acActor, "Telephone verse", ids.clubA, "91");
  await score(acActor, "Telephone verse", ids.clubC, "60");
  await score(acActor, "Telephone verse", ids.clubC, "75");
  assert(await prisma.camporeeScore.count({ where: { eventId: ids.event } }) === 8, "one score per subject: a correction replaces");
  await refused(() => act(adminActor, { action: "saveScoredEvent", scoredEvent: { ...events[0]!, id: idOf("Stilts"), unit: "POINTS" } }), "the unit cannot change once scores exist", "INVALID");
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: { in: ["CAMPOREE_SCORE_CORRECTED_AFTER_PUBLISH", "CAMPOREE_SCORE_REMOVED_AFTER_PUBLISH"] } } }) === 0, "scores before publishing are not audited one by one");

  // Rankings, ties, ribbons, awards.
  const results = (await state()).results;
  const stilts = results.events.find((event) => event.name === "Stilts")!.rows;
  assert(stilts.map((row) => `${row.rank}${row.tied ? "t" : ""}`).join(",") === "1t,1t,3", "a tie shares first place");
  const canoe = results.events.find((event) => event.name === "Canoe race")!.rows;
  assert(canoe[0]!.clubName.includes("Club B") && canoe[0]!.scoreText === "45.2 sec" && canoe[1]!.scoreText === "1:02.5", "lower time wins");
  const clubB = results.clubs.find((club) => club.organizationId === ids.clubB)!;
  assert(!clubB.wantsRibbons && clubB.ribbons.length === 0 && clubB.firsts === 2, "a club that said no gets scores only, and still counts its firsts");
  const clubA = results.clubs.find((club) => club.organizationId === ids.clubA)!;
  assert(clubA.wantsRibbons && clubA.ribbons.map((line) => line.award).join(",") === "1st place,2nd place,Blue", "a club that said yes gets its ribbon list");
  const clubC = results.clubs.find((club) => club.organizationId === ids.clubC)!;
  assert(clubC.ribbons.map((line) => line.award).join(",") === "3rd place,Red", "club C: 3rd on stilts, and the verse score of 75 earns Red; nothing else");
  assert(results.trophies === 4 && results.ribbonsTotal === 5, "award counts: four first places, five ribbons for the clubs that asked");

  // Publishing is for staff administrators only.
  await refused(() => act(acActor, { action: "publish" }), "a coordinator cannot publish", "NOT_PERMITTED");
  await refused(() => act(managerActor, { action: "publish" }), "a Registration Manager cannot publish", "NOT_PERMITTED");
  assert(await loadDirectorCamporeeResults(ids.clubA, ids.event) === null, "a director sees nothing before publishing");
  assert((await act(adminActor, { action: "publish" })).publishedAt !== null, "an administrator published");
  await act(adminActor, { action: "publish" });
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: "CAMPOREE_RESULTS_PUBLISHED" } }) === 1, "publishing audits once");

  // A director sees only their own club.
  const mine = await loadDirectorCamporeeResults(ids.clubC, ids.event);
  assert(mine && mine.events.length === 3 && mine.events.every((event) => event.rows.every((row) => row.organizationId === ids.clubC)), "a director sees only their own rows");
  const text = JSON.stringify(mine);
  assert(!text.includes("Ada") && !text.includes("Bea") && !text.includes(`Club A ${P}`) && !text.includes(`Club B ${P}`), "no other club or Pathfinder appears in a director's results");
  const bOnly = await loadDirectorCamporeeResults(ids.clubB, ids.event);
  assert(bOnly && bOnly.awards && !bOnly.awards.wantsRibbons && bOnly.awards.ribbons.length === 0, "a club that said no sees scores, no ribbon list");
  assert(await loadDirectorCamporeeResults(ids.clubD, ids.event) === null || (await loadDirectorCamporeeResults(ids.clubD, ids.event))!.events.length === 0, "a club with no entries sees no scores");

  // After publishing: only staff administrators correct, and it is audited with ids and numbers only.
  await refused(() => score(acActor, "Canoe race", ids.clubA, "55"), "a coordinator cannot correct after publishing", "NOT_PERMITTED");
  await refused(() => score(managerActor, "Canoe race", ids.clubA, "55"), "a Registration Manager cannot correct after publishing", "NOT_PERMITTED");
  await score(adminActor, "Canoe race", ids.clubA, "40");
  await score(adminActor, "Canoe race", ids.clubA, "40");
  const corrections = await prisma.auditLog.findMany({ where: { eventId: ids.event, action: "CAMPOREE_SCORE_CORRECTED_AFTER_PUBLISH" } });
  assert(corrections.length === 1, "a correction after publishing is audited once (a repeat of the same score changes nothing)");
  const meta = corrections[0]!.metadata as { before?: number; after?: number; subjectId?: string };
  assert(meta.before === 6250 && meta.after === 4000 && meta.subjectId === ids.clubA, "the audit has the ids and the before and after");
  await score(adminActor, "Canoe race", ids.clubB, null);
  assert(await prisma.auditLog.count({ where: { eventId: ids.event, action: "CAMPOREE_SCORE_REMOVED_AFTER_PUBLISH" } }) === 1, "removing a score after publishing is audited");
  await refused(() => act(adminActor, { action: "deleteScoredEvent", id: idOf("Stilts") }), "a scored event cannot be removed while published", "NOT_PERMITTED");

  // Off hides it and keeps the data; back on, it is all still there.
  await act(acActor, { action: "switch", enabled: false });
  assert(await loadDirectorCamporeeResults(ids.clubC, ids.event) === null, "off: a director sees nothing");
  await refused(() => score(adminActor, "Stilts", c.Cy!, "30"), "off: scores cannot be entered", "NOT_AVAILABLE");
  assert(await prisma.camporeeScore.count({ where: { eventId: ids.event } }) === 7 && await prisma.camporeeScoredEvent.count({ where: { eventId: ids.event } }) === 3, "off keeps every score and scored event");
  assert((await state()).results.events.length === 3, "the staff view still reads them");
  await act(adminActor, { action: "switch", enabled: true });
  assert((await loadDirectorCamporeeResults(ids.clubC, ids.event))?.events.length === 3, "back on: results are still published");
  assert((await act(adminActor, { action: "unpublish" })).publishedAt === null && await loadDirectorCamporeeResults(ids.clubC, ids.event) === null, "unpublishing hides results from directors again");

  // No name reached the audit log, and no points were touched.
  const logs = await prisma.auditLog.findMany({ where: { eventId: ids.event } });
  assert(!logs.some((row) => /Scoresample|Ada|Bea|Club [ABCD]/.test(`${row.summary} ${JSON.stringify(row.metadata)}`)), "no name is written to the audit log");
  void CamporeeScoringError;
  console.log("camporee scoring: all checks passed");
}

function nobodyActor(): CamporeeActor {
  return { kind: "area-coordinator", accountId: ids.revoked };
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
