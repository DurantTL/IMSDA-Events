/**
 * Proves the event lifecycle contract (#156) against a real PostgreSQL database.
 *
 * - Transitions move the stored state and `isPublished` together, write one immutable history row and one audit row,
 *   and a retry of the same transition is a no-op (no second history row).
 * - A stale expected state is refused (CONFLICT); an undeclared move, a missing permission and an unmet condition
 *   are refused; a refusal changes nothing.
 * - Two concurrent transitions: exactly one wins and exactly one history row is written.
 * - The history table refuses UPDATE and DELETE (except event deletion), and deleting the actor's account leaves it.
 * - Event deletion still succeeds and takes the history with it.
 * - Archive and unarchive write history only when they changed the row.
 * - Old code that writes only `isPublished` is reconciled by `effectiveLifecycleState`.
 * - The backfill gives legacy events a state, writes no history, keeps `updatedAt`, and a second run changes nothing.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:event-lifecycle
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
process.env.SECRET_ENCRYPTION_KEY ||= "verify-event-lifecycle-synthetic-key-not-a-secret";

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; }
})();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  console.error(`Refusing to run: DATABASE_URL points at "${databaseHost || "nothing"}", not a local or CI database.`);
  process.exit(1);
}

const prisma = new PrismaClient();
const P = "evlife";
const id = (name: string) => `${P}_${name}`;
const adminId = id("sysadmin");
const actorId = id("actor");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  try { await promise; return null; } catch (error) { return error; }
}

function hasCode(error: unknown, code: string) {
  return Boolean(error) && typeof error === "object" && "code" in (error as object) && (error as { code: string }).code === code;
}

async function deleteOwnEvents() {
  await prisma.$transaction(async (tx) => {
    // Event deletion is the one way lifecycle history may be deleted.
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.event.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  });
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { startsWith: `${P}_` } }, { entityId: { startsWith: `${P}_` } }] } });
  await deleteOwnEvents();
  await prisma.user.deleteMany({ where: { id: { startsWith: `${P}_` } } });
}

const future = { startsAt: new Date("2031-10-13T15:00:00Z"), endsAt: new Date("2031-10-15T18:00:00Z"), timezone: "America/Chicago" };
const past = { startsAt: new Date("2024-10-13T15:00:00Z"), endsAt: new Date("2024-10-15T18:00:00Z"), timezone: "America/Chicago" };

async function createEvent(name: string, extra: Record<string, unknown> = {}, withForm = true) {
  const eventId = id(name);
  await prisma.event.create({
    data: {
      id: eventId, slug: `${P}-${name}`, name: `Evlife ${name}`, location: "Synthetic Camp", supportContact: "help@example.test",
      ...future, ...extra,
    },
  });
  if (withForm) {
    const form = await prisma.registrationForm.create({ data: { eventId, createdByUserId: adminId, name: `Evlife form ${name}`, slug: `${P}-form-${name}`, status: "PUBLISHED" } });
    await prisma.registrationFormVersion.create({ data: { formId: form.id, createdByUserId: adminId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: {} } });
  }
  return eventId;
}

async function main() {
  const { transitionEventLifecycle, getEventLifecycle, EventLifecycleError } = await import("../modules/events/lifecycle-repository");
  const { publishEvent, unpublishEvent } = await import("../modules/events/repository");
  const { archiveEvent, unarchiveEvent } = await import("../modules/events/archive-repository");
  const { deleteEvent } = await import("../modules/events/deletion-repository");
  const { backfillEventLifecycle } = await import("../modules/events/lifecycle-backfill");
  const { evaluateEventRegistrationPhase } = await import("../modules/events/lifecycle");

  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: adminId, email: `${P}-admin@example.test`, displayName: "Lifecycle Check Admin", globalRole: "SYSTEM_ADMIN" },
      { id: actorId, email: `${P}-actor@example.test`, displayName: "Lifecycle Check Actor" },
    ],
  });
  const configure = { userId: actorId, permissions: ["CONFIGURE_EVENT"] as const };
  const history = (eventId: string) => prisma.eventLifecycleTransition.findMany({ where: { eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const row = (eventId: string) => prisma.event.findUniqueOrThrow({ where: { id: eventId } });

  // ---- A new event is a legacy row: state null, derived as DRAFT. ----
  const e1 = await createEvent("main");
  const fresh = await row(e1);
  assert(fresh.lifecycleState === null && fresh.lifecycleVersion === 0 && !fresh.isPublished, "a new event has no stored state and version 0");
  assert((await getEventLifecycle({ eventId: e1, permissions: ["CONFIGURE_EVENT"] }))?.state === "DRAFT", "a legacy unpublished event reads as DRAFT");

  // ---- Draft -> Test -> Published. ----
  const toTest = await transitionEventLifecycle({ eventId: e1, toState: "TEST", expectedFromState: "DRAFT", actor: configure, reason: "  Trying the form  " });
  assert(toTest.changed && toTest.fromState === "DRAFT" && toTest.toState === "TEST", "DRAFT -> TEST changes");
  let state = await row(e1);
  assert(state.lifecycleState === "TEST" && state.isPublished === false && state.lifecycleVersion === 1, "TEST is stored, not public, version bumped");
  assert(evaluateEventRegistrationPhase(state) === "DRAFT", "a TEST event is not open for registration");
  const retry = await transitionEventLifecycle({ eventId: e1, toState: "TEST", expectedFromState: "DRAFT", actor: configure });
  assert(!retry.changed && (await history(e1)).length === 1, "a retry of the same transition is a no-op with no second history row");
  const reasonRow = (await history(e1))[0]!;
  assert(reasonRow.reason === "Trying the form" && reasonRow.actorUserId === actorId && reasonRow.fromState === "DRAFT" && reasonRow.toState === "TEST", "history holds actor, states and the trimmed reason");

  const toPublished = await transitionEventLifecycle({ eventId: e1, toState: "PUBLISHED", expectedFromState: "TEST", actor: configure });
  assert(toPublished.changed, "TEST -> PUBLISHED changes");
  state = await row(e1);
  assert(state.lifecycleState === "PUBLISHED" && state.isPublished === true && state.lifecycleVersion === 2, "PUBLISHED is public and isPublished follows");
  assert(evaluateEventRegistrationPhase(state) === "OPEN", "a published future event is open for registration");
  const publishRow = (await history(e1))[1]!;
  const evidence = publishRow.evidence as { publishReadiness?: Array<{ id: string; complete: boolean }> } | null;
  assert(Array.isArray(evidence?.publishReadiness) && evidence!.publishReadiness!.every((item) => item.complete), "publishing records the readiness checklist as evidence");
  const publishAudit = await prisma.auditLog.findMany({ where: { entityId: e1, action: "EVENT_PUBLISHED" } });
  assert(publishAudit.length === 1, "one EVENT_PUBLISHED audit row");

  // ---- Closing registration does not complete or close the event. ----
  await transitionEventLifecycle({ eventId: e1, toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: configure });
  state = await row(e1);
  assert(state.isPublished === true && evaluateEventRegistrationPhase(state) === "CLOSED", "REGISTRATION_CLOSED stays public and closes registration");
  assert((await getEventLifecycle({ eventId: e1, permissions: ["CONFIGURE_EVENT"] }))?.state === "REGISTRATION_CLOSED", "the state is REGISTRATION_CLOSED, not COMPLETE");
  const completeTooEarly = await caught(transitionEventLifecycle({ eventId: e1, toState: "COMPLETE", expectedFromState: "REGISTRATION_CLOSED", actor: configure }));
  assert(completeTooEarly instanceof EventLifecycleError && completeTooEarly.code === "CONDITION_UNMET", "COMPLETE before the event ends is refused");
  const startedTooEarly = await caught(transitionEventLifecycle({ eventId: e1, toState: "IN_PROGRESS", expectedFromState: "REGISTRATION_CLOSED", actor: configure }));
  assert(startedTooEarly instanceof EventLifecycleError && startedTooEarly.code === "CONDITION_UNMET", "IN_PROGRESS before the first day is refused");
  await transitionEventLifecycle({ eventId: e1, toState: "PUBLISHED", expectedFromState: "REGISTRATION_CLOSED", actor: configure });
  assert(evaluateEventRegistrationPhase(await row(e1)) === "OPEN", "reopening registration works");

  // ---- Refusals change nothing. ----
  const before = { row: await row(e1), count: (await history(e1)).length };
  const stale = await caught(transitionEventLifecycle({ eventId: e1, toState: "REGISTRATION_CLOSED", expectedFromState: "DRAFT", actor: configure }));
  assert(stale instanceof EventLifecycleError && stale.code === "CONFLICT", "a stale expected state is a conflict");
  const unknown = await caught(transitionEventLifecycle({ eventId: e1, toState: "CLOSED", expectedFromState: "PUBLISHED", actor: configure }));
  assert(unknown instanceof EventLifecycleError && unknown.code === "UNKNOWN_TRANSITION", "an undeclared move is refused");
  const noPermission = await caught(transitionEventLifecycle({ eventId: e1, toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: { userId: actorId, permissions: ["VIEW_EVENT"] } }));
  assert(noPermission instanceof EventLifecycleError && noPermission.code === "PERMISSION_DENIED", "a missing permission is refused");
  const longReason = await caught(transitionEventLifecycle({ eventId: e1, toState: "REGISTRATION_CLOSED", expectedFromState: "PUBLISHED", actor: configure, reason: "x".repeat(501) }));
  assert(longReason instanceof EventLifecycleError && longReason.code === "REASON_TOO_LONG", "a reason over 500 characters is refused");
  const missing = await caught(transitionEventLifecycle({ eventId: id("nope"), toState: "TEST", expectedFromState: "DRAFT", actor: configure }));
  assert(hasCode(missing, "EVENT_NOT_FOUND"), "a missing event is EVENT_NOT_FOUND");
  const after = { row: await row(e1), count: (await history(e1)).length };
  assert(JSON.stringify(before) === JSON.stringify(after), "refusals change no row and write no history");

  // ---- Not ready: no form, so publishing is refused and nothing changes. ----
  const notReady = await createEvent("notready", {}, false);
  const refused = await caught(transitionEventLifecycle({ eventId: notReady, toState: "PUBLISHED", expectedFromState: "DRAFT", actor: configure }));
  assert(hasCode(refused, "EVENT_NOT_READY"), "publishing without a published form is EVENT_NOT_READY");
  assert((await history(notReady)).length === 0 && (await row(notReady)).lifecycleState === null, "a refused publish changes nothing");

  // ---- Concurrency: different targets, exactly one wins. ----
  const race = await createEvent("race");
  const results = await Promise.allSettled([
    transitionEventLifecycle({ eventId: race, toState: "TEST", expectedFromState: "DRAFT", actor: configure }),
    transitionEventLifecycle({ eventId: race, toState: "PUBLISHED", expectedFromState: "DRAFT", actor: configure }),
  ]);
  const won = results.filter((result) => result.status === "fulfilled");
  const lost = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(won.length === 1 && lost.length === 1 && lost[0]!.reason instanceof EventLifecycleError && lost[0]!.reason.code === "CONFLICT", "of two concurrent different transitions exactly one wins and one is a conflict");
  assert((await history(race)).length === 1, "exactly one history row is written for the race");
  const raceRow = await row(race);
  assert(raceRow.lifecycleVersion === 1 && raceRow.isPublished === (raceRow.lifecycleState === "PUBLISHED"), "the winner's state and isPublished agree");
  // Same target twice at once: one change, one idempotent no-op.
  const race2 = await createEvent("race2");
  const same = await Promise.all([
    transitionEventLifecycle({ eventId: race2, toState: "TEST", expectedFromState: "DRAFT", actor: configure }),
    transitionEventLifecycle({ eventId: race2, toState: "TEST", expectedFromState: "DRAFT", actor: configure }),
  ]);
  assert(same.filter((result) => result.changed).length === 1 && (await history(race2)).length === 1, "two identical concurrent transitions change once and write one history row");

  // ---- Publish and unpublish keep working and stay in step with isPublished. ----
  const legacyEvent = await createEvent("legacy");
  await publishEvent(legacyEvent, actorId);
  let legacy = await row(legacyEvent);
  assert(legacy.isPublished && legacy.lifecycleState === "PUBLISHED", "publishEvent publishes through the lifecycle");
  await publishEvent(legacyEvent, actorId);
  assert((await history(legacyEvent)).length === 1 && (await prisma.auditLog.count({ where: { entityId: legacyEvent, action: "EVENT_PUBLISHED" } })) === 1, "publishing twice writes one history and one audit row");
  await unpublishEvent(legacyEvent, actorId);
  legacy = await row(legacyEvent);
  assert(!legacy.isPublished && legacy.lifecycleState === "DRAFT", "unpublishEvent returns it to DRAFT");
  assert((await prisma.auditLog.count({ where: { entityId: legacyEvent, action: "EVENT_UNPUBLISHED" } })) === 1, "one EVENT_UNPUBLISHED audit row");
  // Old code that writes only isPublished is reconciled.
  await prisma.event.update({ where: { id: legacyEvent }, data: { isPublished: true } });
  assert((await getEventLifecycle({ eventId: legacyEvent, permissions: [] }))?.state === "PUBLISHED", "isPublished written alone by old code reads as PUBLISHED");
  assert(evaluateEventRegistrationPhase(await row(legacyEvent)) === "OPEN", "and registration stays open");

  // ---- A finished event: complete, reconcile, close; finance permission and no unpublishing. ----
  const done = await createEvent("done", past);
  await prisma.event.update({ where: { id: done }, data: { isPublished: true } });
  assert((await getEventLifecycle({ eventId: done, permissions: ["CONFIGURE_EVENT"] }))?.allowedNext.map((next) => next.state).includes("COMPLETE") === true, "an ended published event may be completed");
  await transitionEventLifecycle({ eventId: done, toState: "COMPLETE", expectedFromState: "PUBLISHED", actor: configure });
  const noFinance = await caught(transitionEventLifecycle({ eventId: done, toState: "FINANCIAL_RECONCILIATION", expectedFromState: "COMPLETE", actor: configure }));
  assert(noFinance instanceof EventLifecycleError && noFinance.code === "PERMISSION_DENIED", "financial reconciliation needs MANAGE_FINANCE");
  const finance = { userId: actorId, permissions: ["MANAGE_FINANCE"] as const };
  await transitionEventLifecycle({ eventId: done, toState: "FINANCIAL_RECONCILIATION", expectedFromState: "COMPLETE", actor: finance });
  await transitionEventLifecycle({ eventId: done, toState: "CLOSED", expectedFromState: "FINANCIAL_RECONCILIATION", actor: finance });
  const closed = await row(done);
  assert(closed.isPublished && closed.lifecycleState === "CLOSED" && evaluateEventRegistrationPhase(closed) === "CLOSED", "a closed event stays public with registration closed");
  const unpublishClosed = await caught(unpublishEvent(done, actorId));
  assert(hasCode(unpublishClosed, "EVENT_LIFECYCLE_REFUSED") && (await row(done)).isPublished, "a closed event cannot be unpublished (409)");
  const reopen = await caught(transitionEventLifecycle({ eventId: done, toState: "PUBLISHED", expectedFromState: "CLOSED", actor: configure }));
  assert(reopen instanceof EventLifecycleError && reopen.code === "UNKNOWN_TRANSITION", "nothing leaves CLOSED");
  assert((await history(done)).length === 3, "three history rows for the finished event");

  // ---- Archive and unarchive write history only when they changed the row. ----
  const archiveTarget = await createEvent("archive");
  await prisma.event.update({ where: { id: archiveTarget }, data: { isPublished: true } });
  await archiveEvent({ eventId: archiveTarget, actor: { userId: adminId, globalRole: "SYSTEM_ADMIN", eventRole: null } });
  await archiveEvent({ eventId: archiveTarget, actor: { userId: adminId, globalRole: "SYSTEM_ADMIN", eventRole: null } });
  assert((await history(archiveTarget)).length === 1, "archiving twice writes one history row");
  let archivedHistory = await history(archiveTarget);
  assert(archivedHistory[0]!.fromState === "PUBLISHED" && archivedHistory[0]!.toState === "ARCHIVED", "archive records PUBLISHED -> ARCHIVED");
  assert((await getEventLifecycle({ eventId: archiveTarget, permissions: ["CONFIGURE_EVENT"] }))?.state === "ARCHIVED", "an archived event reads as ARCHIVED");
  const archivedMove = await caught(transitionEventLifecycle({ eventId: archiveTarget, toState: "REGISTRATION_CLOSED", expectedFromState: "ARCHIVED", actor: configure }));
  assert(archivedMove instanceof EventLifecycleError && archivedMove.code === "ARCHIVED", "an archived event takes no lifecycle transition");
  await unarchiveEvent({ eventId: archiveTarget, actor: { userId: adminId, globalRole: "SYSTEM_ADMIN", eventRole: null } });
  archivedHistory = await history(archiveTarget);
  assert(archivedHistory.length === 2 && archivedHistory[1]!.fromState === "ARCHIVED" && archivedHistory[1]!.toState === "PUBLISHED", "unarchive records ARCHIVED -> PUBLISHED");

  // ---- The history is immutable; the actor's account can still be removed. ----
  const target = (await history(e1))[0]!;
  const updateRefused = await caught(prisma.$executeRaw`UPDATE "EventLifecycleTransition" SET "reason" = 'changed' WHERE "id" = ${target.id}`);
  assert(updateRefused && /immutable/i.test(String(updateRefused)), "UPDATE of a history row is refused");
  const deleteRefused = await caught(prisma.eventLifecycleTransition.delete({ where: { id: target.id } }));
  assert(deleteRefused && /only with its event/i.test(String(deleteRefused)), "DELETE of a history row is refused");
  const checkRefused = await caught(prisma.$executeRaw`UPDATE "Event" SET "lifecycleState" = 'ARCHIVED' WHERE "id" = ${e1}`);
  assert(checkRefused && /Event_lifecycleState_not_archived/.test(String(checkRefused)), "ARCHIVED can never be stored on the event");
  await prisma.auditLog.deleteMany({ where: { actorUserId: actorId } });
  await prisma.user.delete({ where: { id: actorId } });
  const stillThere = await prisma.eventLifecycleTransition.findUniqueOrThrow({ where: { id: target.id } });
  assert(stillThere.actorUserId === actorId && stillThere.reason === "Trying the form", "deleting the actor's account leaves the history row untouched");

  // ---- Backfill: dry run writes nothing; apply fills nulls only, no history, updatedAt kept; second run changes 0. ----
  const legacyNull = await createEvent("bfnull", {}, false);
  const legacyPublished = await createEvent("bfpub", { isPublished: true }, false);
  const legacyArchived = await createEvent("bfarch", { isPublished: true, archivedAt: new Date("2030-01-01T00:00:00Z") }, false);
  const stamp = async (eventId: string) => (await row(eventId)).updatedAt.getTime();
  const stamps = [await stamp(legacyNull), await stamp(legacyPublished), await stamp(legacyArchived)];
  const historyBefore = await prisma.eventLifecycleTransition.count();
  const dry = await backfillEventLifecycle(false);
  assert(dry.dryRun && dry.updatedCount === 0 && (await row(legacyNull)).lifecycleState === null, "the dry run writes nothing");
  assert(dry.rows.some((candidate) => candidate.id === legacyNull && candidate.to === "DRAFT" && candidate.needsWrite), "the dry run maps an unpublished event to DRAFT");
  const applied = await backfillEventLifecycle(true);
  assert(applied.updatedCount === applied.needsWrite && applied.updatedCount >= 3, "apply writes every null state");
  assert((await row(legacyNull)).lifecycleState === "DRAFT" && (await row(legacyPublished)).lifecycleState === "PUBLISHED" && (await row(legacyArchived)).lifecycleState === "PUBLISHED", "events map from isPublished; an archived event keeps its archive overlay");
  assert(JSON.stringify(stamps) === JSON.stringify([await stamp(legacyNull), await stamp(legacyPublished), await stamp(legacyArchived)]), "the backfill leaves updatedAt alone");
  assert((await prisma.eventLifecycleTransition.count()) === historyBefore, "the backfill writes no history rows");
  const again = await backfillEventLifecycle(true);
  assert(again.updatedCount === 0 && again.needsWrite === 0, "a second apply changes nothing");
  assert(!JSON.stringify(applied.rows).includes("Evlife"), "the report carries no event names");

  // ---- Event deletion still works and takes the history with it. ----
  const eventWithHistory = (await history(e1)).length;
  assert(eventWithHistory > 0, "the event to delete has history");
  await deleteEvent({ eventId: e1, actor: { userId: adminId, globalRole: "SYSTEM_ADMIN" }, confirmName: "Evlife main" });
  assert((await prisma.event.count({ where: { id: e1 } })) === 0 && (await prisma.eventLifecycleTransition.count({ where: { eventId: e1 } })) === 0, "deleting an event removes it and its history");

  await cleanup();
  console.log("Event lifecycle checks passed.");
}

main()
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
