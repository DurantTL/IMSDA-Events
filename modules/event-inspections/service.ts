import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  inspectionKeys,
  inspectionNames,
  type ImportPreview,
  type InspectionAction,
  type InspectionCapabilities,
  type InspectionKey,
} from "@/modules/event-inspections/domain";
import { InspectionImportError, matchedRows, planInspectionImport } from "@/modules/event-inspections/import-plan";
import { eventModuleDefinition } from "@/modules/event-modules/catalog";
import {
  ScopedToggleError,
  assertScopedToggleAllowed,
  loadScopedToolEvent,
  scopedActorAudit,
  scopedModuleIsOn,
  writeScopedModuleSwitch,
  type ScopedToggleActor,
} from "@/modules/event-modules/scoped-toggle";
import { normalizeScoredEventName, parseScoreText, scoreInputText } from "@/modules/event-scoring/domain";
import {
  EventScoringError,
  enterScore,
  isScoringPublished,
  loadRegisteredClubs,
  scoringCapabilities,
  type EventScoringActor,
} from "@/modules/event-scoring/service";

/**
 * Campsite and uniform inspection scoring (#1896): an optional per-event tool, off by default, that sits on Camporee scoring
 * (#1676). Switching it on makes two scored events in that scoring, "Campsite inspection" and "Uniform inspection" (one
 * score for each club, in points, highest wins), marked by `ScoredActivity.inspectionKind` so they are made once. Scores
 * are written through Camporee scoring's own `enterScore`, so ranks, ribbons, results, the rule after publishing and its
 * audit are the existing ones. This file adds no points rule: Camporee scoring does not feed club points.
 *
 * Who may do what is exactly Camporee scoring's: an active Area Coordinator after the second sign-in step, the Clubs
 * Administrator, an Event Admin or a system administrator may switch it and enter scores; staff with the registration
 * permission may enter scores. Anyone else is refused. Switching it off hides the entry screen and keeps every score.
 */

const moduleKey = "inspection-scoring" as const;
const scoringKey = "event-scoring" as const;

export type InspectionActor = EventScoringActor;

const toggleActor = (actor: InspectionActor): ScopedToggleActor => (actor.kind === "staff" ? { kind: "staff", userId: actor.userId } : actor);

export function inspectionCapabilities(actor: InspectionActor): InspectionCapabilities {
  const caps = scoringCapabilities(actor);
  return { canSwitch: caps.canSwitch, canEnter: caps.canEnter, canCorrectAfterPublish: caps.canCorrectAfterPublish };
}

async function guard(actor: InspectionActor, eventId: string): Promise<{ id: string; name: string }> {
  try {
    await assertScopedToggleAllowed(moduleKey, toggleActor(actor));
    return await loadScopedToolEvent(eventId, actor.kind, "That club event could not be found. It may be archived or not a club event.");
  } catch (error) {
    if (error instanceof ScopedToggleError) throw new EventScoringError(error.code, error.message);
    throw error;
  }
}

export type InspectionView = {
  eventName: string;
  /** The Inspections tool is on. */
  enabled: boolean;
  /** Camporee scoring, which the tool needs, is on. */
  scoringEnabled: boolean;
  published: boolean;
  capabilities: InspectionCapabilities;
  inspections: Array<{ key: InspectionKey; name: string; activityId: string }>;
  clubs: Array<{ organizationId: string; name: string }>;
  /** What is entered now, so a screen opens with the saved scores in the boxes. */
  entries: Array<{ inspection: InspectionKey; subjectId: string; text: string }>;
};

/** The state for the entry screen: the two inspections, the registered clubs and the scores so far. Reads even while off. */
export async function loadInspectionView(eventId: string, actor: InspectionActor): Promise<InspectionView> {
  const event = await guard(actor, eventId);
  const capabilities = inspectionCapabilities(actor);
  if (!capabilities.canEnter) throw new EventScoringError("NOT_PERMITTED", "Your role doesn't include entering inspection scores.");
  const prisma = getPrisma();
  const [enabled, scoringEnabled, published, activities, clubs] = await Promise.all([
    scopedModuleIsOn(eventId, moduleKey),
    scopedModuleIsOn(eventId, scoringKey),
    isScoringPublished(eventId),
    prisma.scoredActivity.findMany({ where: { eventId, inspectionKind: { not: null } }, select: { id: true, inspectionKind: true } }),
    loadRegisteredClubs(eventId),
  ]);
  const byActivity = new Map<string, InspectionKey>();
  for (const activity of activities) if (inspectionKeys.includes(activity.inspectionKind as InspectionKey)) byActivity.set(activity.id, activity.inspectionKind as InspectionKey);
  const scores = byActivity.size === 0 ? [] : await prisma.activityScore.findMany({
    where: { eventId, scoredEventId: { in: [...byActivity.keys()] } },
    select: { scoredEventId: true, subjectId: true, valueHundredths: true },
  });
  return {
    eventName: event.name,
    enabled,
    scoringEnabled,
    published,
    capabilities,
    inspections: inspectionKeys.flatMap((key) => {
      const activityId = [...byActivity].find(([, value]) => value === key)?.[0];
      return activityId ? [{ key, name: inspectionNames[key], activityId }] : [];
    }),
    clubs: clubs.map(({ organizationId, name }) => ({ organizationId, name })),
    entries: scores.map((score) => ({ inspection: byActivity.get(score.scoredEventId)!, subjectId: score.subjectId, text: scoreInputText("POINTS", score.valueHundredths) })),
  };
}

function auditRow(actor: InspectionActor, eventId: string, action: string, entityType: string, entityId: string, summary: string, extra: Record<string, string | number | boolean | null>) {
  const who = scopedActorAudit(toggleActor(actor));
  return {
    eventId,
    ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType,
    entityId,
    summary,
    // Ids and numbers only: no club name is written to the audit log.
    metadata: { ...who.metadata, eventId, moduleKey, ...extra },
  };
}

/** Makes the two inspection events when they are missing. A scored event the staff already named the same and set up the same way is adopted. */
async function ensureInspectionEvents(tx: Prisma.TransactionClient, actor: InspectionActor, eventId: string) {
  for (const key of inspectionKeys) {
    if (await tx.scoredActivity.findUnique({ where: { eventId_inspectionKind: { eventId, inspectionKind: key } }, select: { id: true } })) continue;
    const name = inspectionNames[key];
    const normalizedName = normalizeScoredEventName(name);
    const sameName = await tx.scoredActivity.findUnique({ where: { eventId_normalizedName: { eventId, normalizedName } }, select: { id: true, kind: true, unit: true, higherWins: true } });
    if (sameName) {
      if (sameName.kind !== "CLUB" || sameName.unit !== "POINTS" || !sameName.higherWins) {
        throw new EventScoringError("INVALID", `A scored event named "${name}" already exists with other settings. Rename it in Camporee scoring, then turn Inspections on.`);
      }
      await tx.scoredActivity.update({ where: { id: sameName.id }, data: { inspectionKind: key } });
      await writeAuditLog(auditRow(actor, eventId, "EVENT_INSPECTION_ACTIVITY_ADOPTED", "ScoredActivity", sameName.id, "Marked an existing scored event as an inspection.", { inspection: key }), tx);
      continue;
    }
    const last = await tx.scoredActivity.aggregate({ where: { eventId }, _max: { sortOrder: true } });
    const created = await tx.scoredActivity.create({
      data: { eventId, name, normalizedName, kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [], inspectionKind: key, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      select: { id: true },
    });
    await writeAuditLog(auditRow(actor, eventId, "EVENT_INSPECTION_ACTIVITY_ADDED", "ScoredActivity", created.id, "Added an inspection scored event.", { inspection: key }), tx);
  }
}

export type InspectionActionResult = { enabled: boolean; saved?: { inspection: InspectionKey; subjectId: string; text: string } };

/** The switch or one club's score. Returns only what the screen needs, so a slow connection carries a few bytes. */
export async function applyInspectionAction(actor: InspectionActor, eventId: string, action: InspectionAction): Promise<InspectionActionResult> {
  await guard(actor, eventId);
  const capabilities = inspectionCapabilities(actor);
  if (action.action === "switch") {
    if (!capabilities.canSwitch) throw new EventScoringError("NOT_PERMITTED", "Only an Area Coordinator, the Clubs Administrator or event administrators can turn Inspections on or off.");
    if (action.enabled && !(await scopedModuleIsOn(eventId, scoringKey))) {
      throw new EventScoringError("NOT_AVAILABLE", "Turn on Camporee scoring first. Inspection scores are scored events in it.");
    }
    try {
      await getPrisma().$transaction(async (tx) => {
        await writeScopedModuleSwitch(tx, { actor: toggleActor(actor), eventId, moduleKey, enabled: action.enabled });
        if (action.enabled) await ensureInspectionEvents(tx, actor, eventId);
      });
    } catch (error) {
      // Two switches at once: the unique index answers and the second one finds the events already made.
      if ((error as { code?: string }).code === "P2002") return { enabled: action.enabled };
      throw error;
    }
    return { enabled: action.enabled };
  }
  if (!capabilities.canEnter) throw new EventScoringError("NOT_PERMITTED", "Your role doesn't include entering inspection scores.");
  await requireOn(eventId);
  const activity = await getPrisma().scoredActivity.findUnique({ where: { eventId_inspectionKind: { eventId, inspectionKind: action.entry.inspection } }, select: { id: true } });
  if (!activity) throw new EventScoringError("NOT_FOUND", "This inspection is not set up. Turn Inspections off and on again.");
  let text = "";
  if (action.entry.value !== null) {
    const parsed = parseScoreText("POINTS", action.entry.value);
    if (!parsed.ok) throw new EventScoringError("INVALID", parsed.message, "value");
    text = scoreInputText("POINTS", parsed.hundredths);
  }
  await enterScore(actor, eventId, { scoredEventId: activity.id, subjectId: action.entry.subjectId, value: action.entry.value });
  return { enabled: true, saved: { inspection: action.entry.inspection, subjectId: action.entry.subjectId, text } };
}

async function requireOn(eventId: string) {
  if (!(await scopedModuleIsOn(eventId, moduleKey))) throw new EventScoringError("NOT_AVAILABLE", "Inspections is off for this event. Turn it on first.");
}

async function planFor(actor: InspectionActor, eventId: string, csv: string): Promise<{ preview: ImportPreview; clubIds: Set<string> }> {
  await guard(actor, eventId);
  if (!inspectionCapabilities(actor).canEnter) throw new EventScoringError("NOT_PERMITTED", "Your role doesn't include entering inspection scores.");
  await requireOn(eventId);
  // The registered clubs are Camporee scoring's own list; the code and id column only picks among them.
  const registered = await loadRegisteredClubs(eventId);
  try {
    const preview = planInspectionImport(csv, registered);
    return { preview, clubIds: new Set(registered.map((club) => club.organizationId)) };
  } catch (error) {
    if (error instanceof InspectionImportError) throw new EventScoringError("INVALID", error.message, "csv");
    throw error;
  }
}

/** What a file would do, row by row. Changes nothing. */
export async function previewInspectionImport(actor: InspectionActor, eventId: string, csv: string): Promise<ImportPreview> {
  return (await planFor(actor, eventId, csv)).preview;
}

export type InspectionImportResult = { applied: number; failed: Array<{ line: number; message: string }>; skipped: number };

/**
 * Applies a file only if it is the file that was previewed (the digest is of the rows as previewed, clubs included): a
 * changed file or a changed list of registered clubs asks for a new preview. Only matched rows are written; every other row
 * is left out. One audit row records the counts.
 */
export async function applyInspectionImport(actor: InspectionActor, eventId: string, csv: string, digest: string): Promise<InspectionImportResult> {
  const { preview, clubIds } = await planFor(actor, eventId, csv);
  if (preview.digest !== digest) throw new EventScoringError("INVALID", "The file or the list of registered clubs changed since the preview. Preview the file again.", "csv");
  const published = await isScoringPublished(eventId);
  if (published && !inspectionCapabilities(actor).canCorrectAfterPublish) {
    throw new EventScoringError("NOT_PERMITTED", "Results are published. Only the Clubs Administrator or event administrators can correct a score now.");
  }
  const activities = await getPrisma().scoredActivity.findMany({ where: { eventId, inspectionKind: { not: null } }, select: { id: true, inspectionKind: true } });
  const idByKey = new Map(activities.map((activity) => [activity.inspectionKind as string, activity.id]));
  const rows = matchedRows(preview);
  const failed: InspectionImportResult["failed"] = [];
  let applied = 0;
  for (const row of rows) {
    const scoredEventId = idByKey.get(row.inspection);
    if (!scoredEventId) {
      failed.push({ line: row.line, message: "This inspection is not set up. Turn Inspections off and on again." });
      continue;
    }
    try {
      await enterScore(actor, eventId, { scoredEventId, subjectId: row.organizationId, value: scoreInputText("POINTS", row.hundredths) }, { clubIds, published });
      applied += 1;
    } catch (error) {
      if (!(error instanceof EventScoringError)) throw error;
      failed.push({ line: row.line, message: error.message });
    }
  }
  await writeAuditLog(auditRow(actor, eventId, "EVENT_INSPECTION_IMPORT_APPLIED", "EventModule", moduleKey, `Applied an inspection score import for the ${eventModuleDefinition(moduleKey).title} tool.`, {
    applied,
    failed: failed.length,
    skipped: preview.rows.length - rows.length,
    afterPublish: published,
  }));
  return { applied, failed, skipped: preview.rows.length - rows.length };
}
