import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { formatPersonName } from "@/lib/person-name";
import { AccessDeniedError, effectivePermissions, requireEventMembership, type MembershipLookup, type Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  buildResults,
  buildScoredEventDefinition,
  normalizeScoredEventName,
  parseScoreText,
  resultsForClub,
  scoreInputText,
  type CamporeeAction,
  type CamporeeResults,
  type EventResult,
  type ClubAwards,
  type RibbonBand,
  type ScoredEventDefinition,
  type ScoringCapabilities,
} from "@/modules/camporee-scoring/domain";
import { eventModuleDefinition } from "@/modules/event-modules/catalog";
import {
  ScopedToggleError,
  assertScopedToggleAllowed,
  loadScopedToolEvent,
  requireAreaCoordinatorToggleActor,
  scopedActorAudit,
  scopedModuleIsOn,
  writeScopedModuleSwitch,
  type ScopedToggleActor,
} from "@/modules/event-modules/scoped-toggle";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { clubWantsRibbons } from "@/modules/reporting/club-report-columns";

/**
 * Camporee scoring (#1676): the optional tool an Area Coordinator, the Clubs Administrator or staff turn on for a club
 * event. The switch is the shared helper `modules/event-modules/scoped-toggle.ts` (the same path Club teachers uses).
 *
 * Who may do what:
 *   - switch it on or off, and define the scored events: a system administrator, an Event Admin or the Clubs
 *     Administrator (staff), or an active Area Coordinator after the second sign-in step on a published club event;
 *   - enter and correct scores: those same people, and staff with the event's registration permission (a Registration
 *     Manager), who can enter scores but not switch or define;
 *   - publish and unpublish results, and correct a score after publishing (audited): staff administrators only. An Area
 *     Coordinator never publishes.
 * Club directors read only their own club's results, only while the tool is on and results are published.
 */

const moduleKey = "camporee-scoring" as const;

export class CamporeeScoringError extends Error {
  constructor(
    public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND" | "NOT_PERMITTED" | "INVALID" | "NOT_FOUND",
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "CamporeeScoringError";
  }
}

export type CamporeeActor =
  | { kind: "staff"; userId: string; administrator: boolean }
  | { kind: "area-coordinator"; accountId: string };

export function scoringCapabilities(actor: CamporeeActor): ScoringCapabilities {
  if (actor.kind === "area-coordinator") return { canSwitch: true, canDefine: true, canEnter: true, canPublish: false, canCorrectAfterPublish: false };
  return actor.administrator
    ? { canSwitch: true, canDefine: true, canEnter: true, canPublish: true, canCorrectAfterPublish: true }
    : { canSwitch: false, canDefine: false, canEnter: true, canPublish: false, canCorrectAfterPublish: false };
}

/** Staff who may use the tool: administrators, and staff with the event's registration permission (they enter scores only). */
export async function requireStaffScoringAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<CamporeeActor> {
  const access = await requireEventMembership(session, eventId, lookup);
  const administrator = access.user.globalRole === "SYSTEM_ADMIN" || access.membership?.role === "EVENT_ADMIN";
  if (!administrator && !effectivePermissions(access.user, access.membership).includes("MANAGE_REGISTRATION")) {
    throw new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");
  }
  return { kind: "staff", userId: access.user.id, administrator };
}

/** The signed-in Area Coordinator (grant active, second step passed), or a 404-shaped refusal. */
export async function requireAreaCoordinatorScoringActor(): Promise<CamporeeActor> {
  try {
    return await requireAreaCoordinatorToggleActor();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new CamporeeScoringError(error.code, error.message);
    throw error;
  }
}

const toggleActor = (actor: CamporeeActor): ScopedToggleActor =>
  actor.kind === "staff" ? { kind: "staff", userId: actor.userId } : actor;

async function scopedEvent(eventId: string, actor: CamporeeActor["kind"]) {
  try {
    return await loadScopedToolEvent(eventId, actor, "That club event could not be found. It may be archived or not a club event.");
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new CamporeeScoringError(error.code, error.message);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

type Subjects = {
  clubs: Map<string, { name: string; wantsRibbons: boolean }>;
  people: Map<string, { name: string; organizationId: string }>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Clubs and Pathfinders registered for the event: the only people a score can be entered for. */
async function loadSubjects(eventId: string): Promise<Subjects> {
  const rows = await getPrisma().clubEventRegistration.findMany({
    where: { eventId, registration: { status: { in: [...activeRegistrationStatuses] } } },
    select: {
      organizationId: true,
      organization: { select: { name: true } },
      registration: {
        select: {
          publicFormSubmission: { select: { responses: true } },
          attendees: { select: { id: true, formResponses: true, person: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });
  const clubs: Subjects["clubs"] = new Map();
  const people: Subjects["people"] = new Map();
  for (const row of rows) {
    const answer = record(row.registration.publicFormSubmission?.responses).event_ribbons;
    // A club with more than one team asked for ribbons when any team's registration says yes.
    const wants = clubWantsRibbons(typeof answer === "string" ? answer : "") || clubs.get(row.organizationId)?.wantsRibbons === true;
    clubs.set(row.organizationId, { name: row.organization.name, wantsRibbons: wants });
    for (const attendee of row.registration.attendees) {
      const role = record(attendee.formResponses).attendee_type;
      // Staff and children do not compete as Pathfinders.
      if (role === "Staff" || role === "Child") continue;
      people.set(attendee.id, { name: formatPersonName(attendee.person, "display") || "Unnamed person", organizationId: row.organizationId });
    }
  }
  return { clubs, people };
}

function definitionFromRow(row: { id: string; name: string; kind: string; unit: string; higherWins: boolean; ribbonMode: string; ribbonPlaces: number; ribbonBands: Prisma.JsonValue }): ScoredEventDefinition {
  const bands = Array.isArray(row.ribbonBands) ? row.ribbonBands.flatMap((band): RibbonBand[] => {
    const value = record(band);
    return typeof value.label === "string" && typeof value.thresholdHundredths === "number" ? [{ label: value.label, thresholdHundredths: value.thresholdHundredths }] : [];
  }) : [];
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ScoredEventDefinition["kind"],
    unit: row.unit as ScoredEventDefinition["unit"],
    higherWins: row.higherWins,
    ribbonMode: row.ribbonMode as ScoredEventDefinition["ribbonMode"],
    ribbonPlaces: row.ribbonPlaces,
    ribbonBands: bands,
  };
}

async function loadDefinitions(eventId: string): Promise<ScoredEventDefinition[]> {
  const rows = await getPrisma().camporeeScoredEvent.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map(definitionFromRow);
}

async function loadResults(eventId: string, definitions?: ScoredEventDefinition[], subjects?: Subjects): Promise<CamporeeResults> {
  const [defs, found, scores] = await Promise.all([
    definitions ?? loadDefinitions(eventId),
    subjects ?? loadSubjects(eventId),
    getPrisma().camporeeScore.findMany({ where: { eventId }, select: { scoredEventId: true, subjectId: true, organizationId: true, valueHundredths: true } }),
  ]);
  return buildResults(defs, scores, found);
}

export type CamporeeScoringState = {
  eventName: string;
  enabled: boolean;
  publishedAt: string | null;
  capabilities: ScoringCapabilities;
  scoredEvents: Array<ScoredEventDefinition & { scoreCount: number }>;
  /** What is typed in each box, so an entry can be corrected. */
  entries: Array<{ scoredEventId: string; subjectId: string; text: string }>;
  clubs: Array<{ organizationId: string; name: string; wantsRibbons: boolean }>;
  people: Array<{ attendeeId: string; name: string; organizationId: string; clubName: string }>;
  results: CamporeeResults;
};

/** The state shown to whoever may use the tool. Reads whatever was entered, even while the tool is off. */
export async function loadCamporeeScoringState(eventId: string, actor: CamporeeActor): Promise<CamporeeScoringState> {
  const event = await scopedEvent(eventId, actor.kind);
  const prisma = getPrisma();
  const [enabled, state, definitions, subjects, scoreRows] = await Promise.all([
    scopedModuleIsOn(eventId, moduleKey),
    prisma.camporeeScoringState.findUnique({ where: { eventId }, select: { publishedAt: true } }),
    loadDefinitions(eventId),
    loadSubjects(eventId),
    prisma.camporeeScore.findMany({ where: { eventId }, select: { scoredEventId: true, subjectId: true, organizationId: true, valueHundredths: true } }),
  ]);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const counts = new Map<string, number>();
  for (const score of scoreRows) counts.set(score.scoredEventId, (counts.get(score.scoredEventId) ?? 0) + 1);
  return {
    eventName: event.name,
    enabled,
    publishedAt: state?.publishedAt?.toISOString() ?? null,
    capabilities: scoringCapabilities(actor),
    scoredEvents: definitions.map((definition) => ({ ...definition, scoreCount: counts.get(definition.id) ?? 0 })),
    entries: scoreRows.flatMap((score) => {
      const definition = byId.get(score.scoredEventId);
      return definition ? [{ scoredEventId: score.scoredEventId, subjectId: score.subjectId, text: scoreInputText(definition.unit, score.valueHundredths) }] : [];
    }),
    clubs: [...subjects.clubs].map(([organizationId, club]) => ({ organizationId, name: club.name, wantsRibbons: club.wantsRibbons })).sort((a, b) => a.name.localeCompare(b.name)),
    people: [...subjects.people]
      .map(([attendeeId, person]) => ({ attendeeId, name: person.name, organizationId: person.organizationId, clubName: subjects.clubs.get(person.organizationId)?.name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.clubName.localeCompare(b.clubName)),
    results: buildResults(definitions, scoreRows, subjects),
  };
}

export type DirectorCamporeeResults = { publishedAt: string; events: EventResult[]; awards: ClubAwards | null };

/**
 * One club's own published results for the club portal, or null while the tool is off, nothing is published, or the club
 * has no entry. `organizationId` must be the club the caller's roster access was verified for, never a request value.
 */
export async function loadDirectorCamporeeResults(organizationId: string, eventId: string): Promise<DirectorCamporeeResults | null> {
  const prisma = getPrisma();
  const [enabled, state] = await Promise.all([
    scopedModuleIsOn(eventId, moduleKey),
    prisma.camporeeScoringState.findUnique({ where: { eventId }, select: { publishedAt: true } }),
  ]);
  if (!enabled || !state?.publishedAt) return null;
  const mine = resultsForClub(await loadResults(eventId), organizationId);
  if (mine.events.length === 0 && !mine.awards) return null;
  return { publishedAt: state.publishedAt.toISOString(), events: mine.events, awards: mine.awards };
}

/** The director card, where a failed read hides the card and never the page. */
export async function loadDirectorCamporeeResultsOrNull(organizationId: string, eventId: string): Promise<DirectorCamporeeResults | null> {
  try {
    return await loadDirectorCamporeeResults(organizationId, eventId);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

function auditEntry(actor: CamporeeActor, eventId: string, action: string, entityType: string, entityId: string, summary: string, extra: Record<string, string | number | boolean | null>) {
  const who = scopedActorAudit(toggleActor(actor));
  return {
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType,
    entityId,
    summary,
    // Ids and numbers only: no club or Pathfinder name is written to the audit log.
    metadata: { ...who.metadata, eventId, moduleKey, ...extra },
  };
}

function enteredBy(actor: CamporeeActor) {
  return actor.kind === "staff" ? { enteredByUserId: actor.userId, enteredByAccountId: null } : { enteredByUserId: null, enteredByAccountId: actor.accountId };
}

/**
 * Applies one action and returns the new state. Each action checks who the caller is and what they may do, then the
 * event, then the rule, so a refused call changes nothing.
 */
export async function applyCamporeeAction(actor: CamporeeActor, eventId: string, action: CamporeeAction): Promise<CamporeeScoringState> {
  try {
    await assertScopedToggleAllowed(moduleKey, toggleActor(actor));
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new CamporeeScoringError(error.code, error.message);
    throw error;
  }
  await scopedEvent(eventId, actor.kind);
  const capabilities = scoringCapabilities(actor);
  const refuse = (message: string) => new CamporeeScoringError("NOT_PERMITTED", message);

  if (action.action === "switch") {
    if (!capabilities.canSwitch) throw refuse("Only an Area Coordinator, the Clubs Administrator or event administrators can turn Camporee scoring on or off.");
    await getPrisma().$transaction((tx) => writeScopedModuleSwitch(tx, { actor: toggleActor(actor), eventId, moduleKey, enabled: action.enabled }));
    return loadCamporeeScoringState(eventId, actor);
  }
  if (!(await scopedModuleIsOn(eventId, moduleKey))) throw new CamporeeScoringError("NOT_AVAILABLE", "Camporee scoring is off for this event. Turn it on first.");

  switch (action.action) {
    case "saveScoredEvent":
      if (!capabilities.canDefine) throw refuse("Only an Area Coordinator, the Clubs Administrator or event administrators can set up scored events.");
      await saveScoredEvent(actor, eventId, action.scoredEvent);
      break;
    case "deleteScoredEvent":
      if (!capabilities.canDefine) throw refuse("Only an Area Coordinator, the Clubs Administrator or event administrators can remove scored events.");
      await deleteScoredEvent(actor, eventId, action.id);
      break;
    case "saveScore":
      if (!capabilities.canEnter) throw refuse("Your role doesn't include entering scores.");
      await saveScore(actor, eventId, action.entry, capabilities);
      break;
    case "publish":
    case "unpublish":
      if (!capabilities.canPublish) throw refuse("Only the Clubs Administrator or event administrators can publish results.");
      await setPublished(actor, eventId, action.action === "publish");
      break;
  }
  return loadCamporeeScoringState(eventId, actor);
}

async function isPublished(eventId: string): Promise<boolean> {
  const state = await getPrisma().camporeeScoringState.findUnique({ where: { eventId }, select: { publishedAt: true } });
  return Boolean(state?.publishedAt);
}

async function saveScoredEvent(actor: CamporeeActor, eventId: string, input: Parameters<typeof buildScoredEventDefinition>[0]) {
  const built = buildScoredEventDefinition(input);
  if (!built.ok) {
    const [field, message] = Object.entries(built.problems)[0]!;
    throw new CamporeeScoringError("INVALID", message, field);
  }
  const prisma = getPrisma();
  const normalizedName = normalizeScoredEventName(built.value.name);
  const published = await isPublished(eventId);
  const data = {
    name: built.value.name,
    normalizedName,
    kind: built.value.kind,
    unit: built.value.unit,
    higherWins: built.value.higherWins,
    ribbonMode: built.value.ribbonMode,
    ribbonPlaces: built.value.ribbonPlaces,
    ribbonBands: built.value.ribbonBands as unknown as Prisma.InputJsonValue,
  };
  const clash = await prisma.camporeeScoredEvent.findFirst({ where: { eventId, normalizedName, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
  if (clash) throw new CamporeeScoringError("INVALID", "Another scored event already has that name.", "name");
  await prisma.$transaction(async (tx) => {
    if (input.id) {
      const existing = await tx.camporeeScoredEvent.findFirst({ where: { id: input.id, eventId }, select: { id: true, kind: true, unit: true, higherWins: true, _count: { select: { scores: true } } } });
      if (!existing) throw new CamporeeScoringError("NOT_FOUND", "That scored event could not be found.");
      // Changing what a score means once scores exist would silently change every one of them.
      if (existing._count.scores > 0 && (existing.kind !== data.kind || existing.unit !== data.unit || existing.higherWins !== data.higherWins)) {
        throw new CamporeeScoringError("INVALID", "Scores are already entered, so who is scored, the unit and which direction wins can't change. Remove the scores first, or add a new scored event.", "kind");
      }
      await tx.camporeeScoredEvent.update({ where: { id: existing.id }, data });
      await writeAuditLog(auditEntry(actor, eventId, "CAMPOREE_SCORED_EVENT_CHANGED", "CamporeeScoredEvent", existing.id, "Changed a camporee scored event.", { afterPublish: published, scoreCount: existing._count.scores }), tx);
    } else {
      const last = await tx.camporeeScoredEvent.aggregate({ where: { eventId }, _max: { sortOrder: true } });
      const created = await tx.camporeeScoredEvent.create({ data: { ...data, eventId, sortOrder: (last._max.sortOrder ?? 0) + 1 }, select: { id: true } });
      await writeAuditLog(auditEntry(actor, eventId, "CAMPOREE_SCORED_EVENT_ADDED", "CamporeeScoredEvent", created.id, "Added a camporee scored event.", { afterPublish: published }), tx);
    }
  });
}

async function deleteScoredEvent(actor: CamporeeActor, eventId: string, id: string) {
  if (await isPublished(eventId)) throw new CamporeeScoringError("NOT_PERMITTED", "Results are published. Unpublish them before removing a scored event.");
  const prisma = getPrisma();
  const existing = await prisma.camporeeScoredEvent.findFirst({ where: { id, eventId }, select: { id: true, _count: { select: { scores: true } } } });
  if (!existing) throw new CamporeeScoringError("NOT_FOUND", "That scored event could not be found.");
  await prisma.$transaction(async (tx) => {
    await tx.camporeeScoredEvent.delete({ where: { id } });
    await writeAuditLog(auditEntry(actor, eventId, "CAMPOREE_SCORED_EVENT_REMOVED", "CamporeeScoredEvent", id, "Removed a camporee scored event and its scores.", { scoreCount: existing._count.scores }), tx);
  });
}

async function saveScore(actor: CamporeeActor, eventId: string, entry: { scoredEventId: string; subjectId: string; value: string | null }, capabilities: ScoringCapabilities) {
  const prisma = getPrisma();
  const row = await prisma.camporeeScoredEvent.findFirst({ where: { id: entry.scoredEventId, eventId } });
  if (!row) throw new CamporeeScoringError("NOT_FOUND", "That scored event could not be found.");
  const definition = definitionFromRow(row);
  const published = await isPublished(eventId);
  if (published && !capabilities.canCorrectAfterPublish) {
    throw new CamporeeScoringError("NOT_PERMITTED", "Results are published. Only the Clubs Administrator or event administrators can correct a score now.");
  }
  // Only a club or Pathfinder registered for this event can be scored.
  const subjects = await loadSubjects(eventId);
  const organizationId = definition.kind === "CLUB" ? (subjects.clubs.has(entry.subjectId) ? entry.subjectId : null) : subjects.people.get(entry.subjectId)?.organizationId ?? null;
  if (!organizationId) throw new CamporeeScoringError("INVALID", definition.kind === "CLUB" ? "Choose a club registered for this event." : "Choose a Pathfinder registered for this event.", "subject");
  const existing = await prisma.camporeeScore.findUnique({ where: { scoredEventId_subjectId: { scoredEventId: definition.id, subjectId: entry.subjectId } }, select: { id: true, valueHundredths: true } });
  const audit = (action: string, summary: string, before: number | null, after: number | null) => auditEntry(actor, eventId, action, "CamporeeScore", existing?.id ?? definition.id, summary, {
    scoredEventId: definition.id,
    subjectId: entry.subjectId,
    organizationId,
    before,
    after,
  });
  if (entry.value === null) {
    if (!existing) return;
    await prisma.$transaction(async (tx) => {
      await tx.camporeeScore.delete({ where: { id: existing.id } });
      if (published) await writeAuditLog(audit("CAMPOREE_SCORE_REMOVED_AFTER_PUBLISH", "Removed a camporee score after results were published.", existing.valueHundredths, null), tx);
    });
    return;
  }
  const parsed = parseScoreText(definition.unit, entry.value);
  if (!parsed.ok) throw new CamporeeScoringError("INVALID", parsed.message, "value");
  if (existing?.valueHundredths === parsed.hundredths) return;
  await prisma.$transaction(async (tx) => {
    await tx.camporeeScore.upsert({
      where: { scoredEventId_subjectId: { scoredEventId: definition.id, subjectId: entry.subjectId } },
      create: { scoredEventId: definition.id, eventId, organizationId, subjectId: entry.subjectId, attendeeId: definition.kind === "PATHFINDER" ? entry.subjectId : null, valueHundredths: parsed.hundredths, ...enteredBy(actor) },
      update: { valueHundredths: parsed.hundredths, ...enteredBy(actor) },
    });
    if (published) await writeAuditLog(audit("CAMPOREE_SCORE_CORRECTED_AFTER_PUBLISH", "Changed a camporee score after results were published.", existing?.valueHundredths ?? null, parsed.hundredths), tx);
  });
}

async function setPublished(actor: CamporeeActor, eventId: string, publish: boolean) {
  const prisma = getPrisma();
  const published = await isPublished(eventId);
  if (publish === published) return;
  if (publish && (await prisma.camporeeScore.count({ where: { eventId } })) === 0) {
    throw new CamporeeScoringError("INVALID", "Enter at least one score before publishing results.");
  }
  const userId = actor.kind === "staff" ? actor.userId : null;
  await prisma.$transaction(async (tx) => {
    await tx.camporeeScoringState.upsert({
      where: { eventId },
      create: { eventId, publishedAt: publish ? new Date() : null, publishedByUserId: publish ? userId : null },
      update: { publishedAt: publish ? new Date() : null, publishedByUserId: publish ? userId : null },
    });
    await writeAuditLog(auditEntry(actor, eventId, publish ? "CAMPOREE_RESULTS_PUBLISHED" : "CAMPOREE_RESULTS_UNPUBLISHED", "CamporeeScoringState", eventId, publish ? `Published ${eventModuleDefinition(moduleKey).title} results to clubs.` : `Took ${eventModuleDefinition(moduleKey).title} results back from clubs.`, {}), tx);
  });
}
