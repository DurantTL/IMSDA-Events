import "server-only";

import { snapshotIsYouthNotPathfinder } from "@/modules/club-registrations/domain";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { formatPersonName } from "@/lib/person-name";
import { AccessDeniedError, effectivePermissions, requireEventMembership, type MembershipLookup, type Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  buildResults,
  buildScoredEventDefinition,
  keepsInspectionShape,
  normalizeScoredEventName,
  parseScoreText,
  resultsForClub,
  scoreInputText,
  type EventScoringAction,
  type EventScoringResults,
  type EventResult,
  type ClubAwards,
  type RibbonBand,
  type ScoredEventDefinition,
  type ScoringCapabilities,
} from "@/modules/event-scoring/domain";
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

const moduleKey = "event-scoring" as const;

export class EventScoringError extends Error {
  constructor(
    public readonly code: "NOT_AVAILABLE" | "EVENT_NOT_FOUND" | "NOT_PERMITTED" | "INVALID" | "NOT_FOUND" | "CONFLICT",
    message: string,
    public readonly field?: string,
    /** For CONFLICT: the score on file now, as typed into a box (empty for none). */
    public readonly current?: string,
  ) {
    super(message);
    this.name = "EventScoringError";
  }
}

export type EventScoringActor =
  | { kind: "staff"; userId: string; administrator: boolean }
  | { kind: "area-coordinator"; accountId: string };

export function scoringCapabilities(actor: EventScoringActor): ScoringCapabilities {
  if (actor.kind === "area-coordinator") return { canSwitch: true, canDefine: true, canEnter: true, canPublish: false, canCorrectAfterPublish: false };
  return actor.administrator
    ? { canSwitch: true, canDefine: true, canEnter: true, canPublish: true, canCorrectAfterPublish: true }
    : { canSwitch: false, canDefine: false, canEnter: true, canPublish: false, canCorrectAfterPublish: false };
}

/** Staff who may use the tool: administrators, and staff with the event's registration permission (they enter scores only). */
export async function requireStaffScoringAccess(session: Session, eventId: string, lookup: MembershipLookup): Promise<EventScoringActor> {
  const access = await requireEventMembership(session, eventId, lookup);
  const administrator = access.user.globalRole === "SYSTEM_ADMIN" || access.membership?.role === "EVENT_ADMIN";
  if (!administrator && !effectivePermissions(access.user, access.membership).includes("MANAGE_REGISTRATION")) {
    throw new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");
  }
  return { kind: "staff", userId: access.user.id, administrator };
}

/** The signed-in Area Coordinator (grant active, second step passed), or a 404-shaped refusal. */
export async function requireAreaCoordinatorScoringActor(): Promise<EventScoringActor> {
  try {
    return await requireAreaCoordinatorToggleActor();
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new EventScoringError(error.code, error.message);
    throw error;
  }
}

const toggleActor = (actor: EventScoringActor): ScopedToggleActor =>
  actor.kind === "staff" ? { kind: "staff", userId: actor.userId } : actor;

async function scopedEvent(eventId: string, actor: EventScoringActor["kind"]) {
  try {
    return await loadScopedToolEvent(eventId, actor, "That club event could not be found. It may be archived or not a club event.");
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new EventScoringError(error.code, error.message);
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

/**
 * Whether a registered person is offered as a "Pathfinder" to score: not Staff or Child, and not a club guest aged 10 to 17
 * who is not a Pathfinder (#1728), whatever role the form says for them.
 */
export function isOfferedAsPathfinder(role: unknown, profileSnapshot: unknown) {
  if (role === "Staff" || role === "Child") return false;
  return !snapshotIsYouthNotPathfinder(record(profileSnapshot));
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
          attendees: { select: { id: true, formResponses: true, profileSnapshot: true, person: { select: { firstName: true, lastName: true } } } },
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
      // Who is offered as a "Pathfinder": every attendee on a club registration except those typed Staff or Child. That
      // includes TLTs (teen leaders in training) and anyone whose registration form has no attendee type. Adults on staff
      // and children are left out. A Pathfinder's score is tied to the registration attendee, so removing that attendee
      // from the registration deletes their score (database cascade); the club's own scores are not affected.
      if (!isOfferedAsPathfinder(role, attendee.profileSnapshot)) continue;
      people.set(attendee.id, { name: formatPersonName(attendee.person, "display") || "Unnamed person", organizationId: row.organizationId });
    }
  }
  return { clubs, people };
}

/** The clubs registered for the event (active registrations), the only clubs a club score can be entered for. Lean: no people. */
export async function loadRegisteredClubs(eventId: string): Promise<Array<{ organizationId: string; name: string; orgCode: string | null }>> {
  const rows = await getPrisma().clubEventRegistration.findMany({
    where: { eventId, registration: { status: { in: [...activeRegistrationStatuses] } } },
    select: { organizationId: true, organization: { select: { name: true, orgCode: true } } },
  });
  const clubs = new Map<string, { name: string; orgCode: string | null }>();
  for (const row of rows) clubs.set(row.organizationId, { name: row.organization.name, orgCode: row.organization.orgCode });
  return [...clubs].map(([organizationId, club]) => ({ organizationId, ...club })).sort((a, b) => a.name.localeCompare(b.name));
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
  const rows = await getPrisma().scoredActivity.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map(definitionFromRow);
}

async function loadResults(eventId: string, definitions?: ScoredEventDefinition[], subjects?: Subjects): Promise<EventScoringResults> {
  const [defs, found, scores] = await Promise.all([
    definitions ?? loadDefinitions(eventId),
    subjects ?? loadSubjects(eventId),
    getPrisma().activityScore.findMany({ where: { eventId }, select: { scoredEventId: true, subjectId: true, organizationId: true, valueHundredths: true } }),
  ]);
  return buildResults(defs, scores, found);
}

export type EventScoringView = {
  eventName: string;
  enabled: boolean;
  publishedAt: string | null;
  capabilities: ScoringCapabilities;
  scoredEvents: Array<ScoredEventDefinition & { scoreCount: number }>;
  /** What is typed in each box, so an entry can be corrected. */
  entries: Array<{ scoredEventId: string; subjectId: string; text: string }>;
  clubs: Array<{ organizationId: string; name: string; wantsRibbons: boolean }>;
  people: Array<{ attendeeId: string; name: string; organizationId: string; clubName: string }>;
  results: EventScoringResults;
};

/** The state shown to whoever may use the tool. Reads whatever was entered, even while the tool is off. */
export async function loadEventScoringView(eventId: string, actor: EventScoringActor): Promise<EventScoringView> {
  const event = await scopedEvent(eventId, actor.kind);
  const prisma = getPrisma();
  const [enabled, state, definitions, subjects, scoreRows] = await Promise.all([
    scopedModuleIsOn(eventId, moduleKey),
    prisma.eventScoringState.findUnique({ where: { eventId }, select: { publishedAt: true } }),
    loadDefinitions(eventId),
    loadSubjects(eventId),
    prisma.activityScore.findMany({ where: { eventId }, select: { scoredEventId: true, subjectId: true, organizationId: true, valueHundredths: true } }),
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

export type DirectorEventScoringResults = { publishedAt: string; events: EventResult[]; awards: ClubAwards | null };

/**
 * One club's own published results for the club portal, or null while the tool is off, nothing is published, or the club
 * has no entry. `organizationId` must be the club the caller's roster access was verified for, never a request value.
 */
export async function loadDirectorEventScoringResults(organizationId: string, eventId: string): Promise<DirectorEventScoringResults | null> {
  const prisma = getPrisma();
  const [enabled, state] = await Promise.all([
    scopedModuleIsOn(eventId, moduleKey),
    prisma.eventScoringState.findUnique({ where: { eventId }, select: { publishedAt: true } }),
  ]);
  if (!enabled || !state?.publishedAt) return null;
  const mine = resultsForClub(await loadResults(eventId), organizationId);
  if (mine.events.length === 0 && !mine.awards) return null;
  return { publishedAt: state.publishedAt.toISOString(), events: mine.events, awards: mine.awards };
}

/** The director card, where a failed read hides the card and never the page. */
export async function loadDirectorEventScoringResultsOrNull(organizationId: string, eventId: string): Promise<DirectorEventScoringResults | null> {
  try {
    return await loadDirectorEventScoringResults(organizationId, eventId);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

function auditEntry(actor: EventScoringActor, eventId: string, action: string, entityType: string, entityId: string, summary: string, extra: Record<string, string | number | boolean | null>) {
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

function enteredBy(actor: EventScoringActor) {
  return actor.kind === "staff" ? { enteredByUserId: actor.userId, enteredByAccountId: null } : { enteredByUserId: null, enteredByAccountId: actor.accountId };
}

/**
 * Applies one action and returns the new state. Each action checks who the caller is and what they may do, then the
 * event, then the rule, so a refused call changes nothing.
 */
export async function applyEventScoringAction(actor: EventScoringActor, eventId: string, action: EventScoringAction): Promise<EventScoringView> {
  try {
    await assertScopedToggleAllowed(moduleKey, toggleActor(actor));
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new EventScoringError(error.code, error.message);
    throw error;
  }
  await scopedEvent(eventId, actor.kind);
  const capabilities = scoringCapabilities(actor);
  const refuse = (message: string) => new EventScoringError("NOT_PERMITTED", message);

  if (action.action === "switch") {
    if (!capabilities.canSwitch) throw refuse("Only an Area Coordinator, the Clubs Administrator or event administrators can turn Camporee scoring on or off.");
    await getPrisma().$transaction((tx) => writeScopedModuleSwitch(tx, { actor: toggleActor(actor), eventId, moduleKey, enabled: action.enabled }));
    return loadEventScoringView(eventId, actor);
  }
  if (!(await scopedModuleIsOn(eventId, moduleKey))) throw new EventScoringError("NOT_AVAILABLE", "Camporee scoring is off for this event. Turn it on first.");

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
  return loadEventScoringView(eventId, actor);
}

/**
 * Enters or corrects one score and returns nothing else, so a caller on a slow connection sends and receives very little.
 * The same checks and the same rule after publishing as the full action, which uses this too. `context` lets a caller that
 * saves many scores in a row look up the registered clubs and the published state once.
 */
export async function enterScore(
  actor: EventScoringActor,
  eventId: string,
  entry: { scoredEventId: string; subjectId: string; value: string | null; expected?: string },
  context?: { clubIds?: ReadonlySet<string>; published?: boolean },
): Promise<void> {
  try {
    await assertScopedToggleAllowed(moduleKey, toggleActor(actor));
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new EventScoringError(error.code, error.message);
    throw error;
  }
  await scopedEvent(eventId, actor.kind);
  const capabilities = scoringCapabilities(actor);
  if (!capabilities.canEnter) throw new EventScoringError("NOT_PERMITTED", "Your role doesn't include entering scores.");
  if (!(await scopedModuleIsOn(eventId, moduleKey))) throw new EventScoringError("NOT_AVAILABLE", "Camporee scoring is off for this event. Turn it on first.");
  await saveScore(actor, eventId, entry, capabilities, context);
}

export async function isScoringPublished(eventId: string): Promise<boolean> {
  return isPublished(eventId);
}

async function isPublished(eventId: string): Promise<boolean> {
  const state = await getPrisma().eventScoringState.findUnique({ where: { eventId }, select: { publishedAt: true } });
  return Boolean(state?.publishedAt);
}

async function saveScoredEvent(actor: EventScoringActor, eventId: string, input: Parameters<typeof buildScoredEventDefinition>[0]) {
  const built = buildScoredEventDefinition(input);
  if (!built.ok) {
    const [field, message] = Object.entries(built.problems)[0]!;
    throw new EventScoringError("INVALID", message, field);
  }
  const prisma = getPrisma();
  const normalizedName = normalizeScoredEventName(built.value.name);
  const published = await isPublished(eventId);
  // Once results are published, a change to a scored event (its name, ribbon places or bands) changes what directors see:
  // only those who may correct a score after publishing can make it. It is audited below like a score correction.
  if (published && !scoringCapabilities(actor).canCorrectAfterPublish) {
    throw new EventScoringError("NOT_PERMITTED", "Results are published. Only the Clubs Administrator or event administrators can change a scored event now.");
  }
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
  const clash = await prisma.scoredActivity.findFirst({ where: { eventId, normalizedName, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
  if (clash) throw new EventScoringError("INVALID", "Another scored event already has that name.", "name");
  try {
    await writeScoredEvent(actor, eventId, input, data, published);
  } catch (error) {
    // Two saves with the same name at once: the unique index answers, and the person gets the same message as the check above.
    if ((error as { code?: string }).code === "P2002") throw new EventScoringError("INVALID", "Another scored event already has that name.", "name");
    throw error;
  }
}

async function writeScoredEvent(actor: EventScoringActor, eventId: string, input: { id?: string }, data: Omit<Prisma.ScoredActivityUncheckedCreateInput, "eventId">, published: boolean) {
  await getPrisma().$transaction(async (tx) => {
    if (input.id) {
      const existing = await tx.scoredActivity.findFirst({ where: { id: input.id, eventId }, select: { id: true, kind: true, unit: true, higherWins: true, inspectionKind: true, _count: { select: { scores: true } } } });
      if (!existing) throw new EventScoringError("NOT_FOUND", "That scored event could not be found.");
      // An inspection event (#1896) is always a score for each club, entered as a number, highest wins.
      if (existing.inspectionKind && !keepsInspectionShape(data)) {
        throw new EventScoringError("INVALID", "This is an inspection. It stays a score for each club, entered as a number, where the highest score wins.", "kind");
      }
      // Changing what a score means once scores exist would silently change every one of them.
      if (existing._count.scores > 0 && (existing.kind !== data.kind || existing.unit !== data.unit || existing.higherWins !== data.higherWins)) {
        throw new EventScoringError("INVALID", "Scores are already entered, so who is scored, the unit and which direction wins can't change. Remove the scores first, or add a new scored event.", "kind");
      }
      await tx.scoredActivity.update({ where: { id: existing.id }, data });
      await writeAuditLog(auditEntry(actor, eventId, "EVENT_SCORING_ACTIVITY_CHANGED", "ScoredActivity", existing.id, "Changed a camporee scored event.", { afterPublish: published, scoreCount: existing._count.scores }), tx);
    } else {
      const last = await tx.scoredActivity.aggregate({ where: { eventId }, _max: { sortOrder: true } });
      const created = await tx.scoredActivity.create({ data: { ...data, eventId, sortOrder: (last._max.sortOrder ?? 0) + 1 }, select: { id: true } });
      await writeAuditLog(auditEntry(actor, eventId, "EVENT_SCORING_ACTIVITY_ADDED", "ScoredActivity", created.id, "Added a camporee scored event.", { afterPublish: published }), tx);
    }
  });
}

async function deleteScoredEvent(actor: EventScoringActor, eventId: string, id: string) {
  if (await isPublished(eventId)) throw new EventScoringError("NOT_PERMITTED", "Results are published. Unpublish them before removing a scored event.");
  const prisma = getPrisma();
  const existing = await prisma.scoredActivity.findFirst({ where: { id, eventId }, select: { id: true, _count: { select: { scores: true } } } });
  if (!existing) throw new EventScoringError("NOT_FOUND", "That scored event could not be found.");
  await prisma.$transaction(async (tx) => {
    await tx.scoredActivity.delete({ where: { id } });
    await writeAuditLog(auditEntry(actor, eventId, "EVENT_SCORING_ACTIVITY_REMOVED", "ScoredActivity", id, "Removed a camporee scored event and its scores.", { scoreCount: existing._count.scores }), tx);
  });
}

async function saveScore(actor: EventScoringActor, eventId: string, entry: { scoredEventId: string; subjectId: string; value: string | null; expected?: string }, capabilities: ScoringCapabilities, context?: { clubIds?: ReadonlySet<string>; published?: boolean }) {
  const prisma = getPrisma();
  const row = await prisma.scoredActivity.findFirst({ where: { id: entry.scoredEventId, eventId } });
  if (!row) throw new EventScoringError("NOT_FOUND", "That scored event could not be found.");
  const definition = definitionFromRow(row);
  const published = context?.published ?? await isPublished(eventId);
  if (published && !capabilities.canCorrectAfterPublish) {
    throw new EventScoringError("NOT_PERMITTED", "Results are published. Only the Clubs Administrator or event administrators can correct a score now.");
  }
  // Only a club or Pathfinder registered for this event can be scored.
  const clubIds = definition.kind === "CLUB" ? (context?.clubIds ?? new Set((await loadRegisteredClubs(eventId)).map((club) => club.organizationId))) : null;
  const people = definition.kind === "PATHFINDER" ? (await loadSubjects(eventId)).people : null;
  const organizationId = clubIds ? (clubIds.has(entry.subjectId) ? entry.subjectId : null) : people?.get(entry.subjectId)?.organizationId ?? null;
  if (!organizationId) throw new EventScoringError("INVALID", definition.kind === "CLUB" ? "Choose a club registered for this event." : "Choose a Pathfinder registered for this event.", "subject");
  const existing = await prisma.activityScore.findUnique({ where: { scoredEventId_subjectId: { scoredEventId: definition.id, subjectId: entry.subjectId } }, select: { id: true, valueHundredths: true } });
  const audit = (action: string, summary: string, before: number | null, after: number | null) => auditEntry(actor, eventId, action, "ActivityScore", existing?.id ?? definition.id, summary, {
    scoredEventId: definition.id,
    subjectId: entry.subjectId,
    organizationId,
    before,
    after,
  });
  // A caller that sends the score it last saw (`expected`, empty for none) is refused when the score on file is another one, so
  // a save that was slow to arrive cannot overwrite a newer one. The write itself is conditional, so two at once cannot both pass.
  let expected: number | null | undefined;
  if (entry.expected !== undefined) {
    if (entry.expected.trim() === "") expected = null;
    else {
      const parsedExpected = parseScoreText(definition.unit, entry.expected);
      if (!parsedExpected.ok) throw new EventScoringError("INVALID", parsedExpected.message, "expected");
      expected = parsedExpected.hundredths;
    }
  }
  const conflict = async () => {
    const now = await prisma.activityScore.findUnique({ where: { scoredEventId_subjectId: { scoredEventId: definition.id, subjectId: entry.subjectId } }, select: { valueHundredths: true } });
    return new EventScoringError("CONFLICT", "This score changed since you opened it. Here is the score on file.", "value", now ? scoreInputText(definition.unit, now.valueHundredths) : "");
  };
  if (expected !== undefined && (existing?.valueHundredths ?? null) !== expected) throw await conflict();
  if (entry.value === null) {
    if (!existing) return;
    await prisma.$transaction(async (tx) => {
      if (expected === undefined) await tx.activityScore.delete({ where: { id: existing.id } });
      else if ((await tx.activityScore.deleteMany({ where: { id: existing.id, valueHundredths: expected! } })).count === 0) throw await conflict();
      if (published) await writeAuditLog(audit("EVENT_SCORING_SCORE_REMOVED_AFTER_PUBLISH", "Removed a camporee score after results were published.", existing.valueHundredths, null), tx);
    });
    return;
  }
  const parsed = parseScoreText(definition.unit, entry.value);
  if (!parsed.ok) throw new EventScoringError("INVALID", parsed.message, "value");
  if (existing?.valueHundredths === parsed.hundredths) return;
  const created = { scoredEventId: definition.id, eventId, organizationId, subjectId: entry.subjectId, attendeeId: definition.kind === "PATHFINDER" ? entry.subjectId : null, valueHundredths: parsed.hundredths, ...enteredBy(actor) };
  await prisma.$transaction(async (tx) => {
    if (expected === undefined) {
      await tx.activityScore.upsert({
        where: { scoredEventId_subjectId: { scoredEventId: definition.id, subjectId: entry.subjectId } },
        create: created,
        update: { valueHundredths: parsed.hundredths, ...enteredBy(actor) },
      });
    } else if (existing) {
      const updated = await tx.activityScore.updateMany({ where: { id: existing.id, valueHundredths: expected! }, data: { valueHundredths: parsed.hundredths, ...enteredBy(actor) } });
      if (updated.count === 0) throw await conflict();
    } else {
      try {
        await tx.activityScore.create({ data: created });
      } catch (error) {
        // Someone else entered a first score at the same moment: the unique index answers.
        if ((error as { code?: string }).code === "P2002") throw await conflict();
        throw error;
      }
    }
    if (published) await writeAuditLog(audit("EVENT_SCORING_SCORE_CORRECTED_AFTER_PUBLISH", "Changed a camporee score after results were published.", existing?.valueHundredths ?? null, parsed.hundredths), tx);
  });
}

async function setPublished(actor: EventScoringActor, eventId: string, publish: boolean) {
  const prisma = getPrisma();
  const published = await isPublished(eventId);
  if (publish === published) return;
  if (publish && (await prisma.activityScore.count({ where: { eventId } })) === 0) {
    throw new EventScoringError("INVALID", "Enter at least one score before publishing results.");
  }
  const userId = actor.kind === "staff" ? actor.userId : null;
  await prisma.$transaction(async (tx) => {
    await tx.eventScoringState.upsert({
      where: { eventId },
      create: { eventId, publishedAt: publish ? new Date() : null, publishedByUserId: publish ? userId : null },
      update: { publishedAt: publish ? new Date() : null, publishedByUserId: publish ? userId : null },
    });
    await writeAuditLog(auditEntry(actor, eventId, publish ? "EVENT_SCORING_RESULTS_PUBLISHED" : "EVENT_SCORING_RESULTS_UNPUBLISHED", "EventScoringView", eventId, publish ? `Published ${eventModuleDefinition(moduleKey).title} results to clubs.` : `Took ${eventModuleDefinition(moduleKey).title} results back from clubs.`, {}), tx);
  });
}
