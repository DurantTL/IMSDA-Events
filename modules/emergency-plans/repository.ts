import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { EmergencyPlanError } from "@/modules/emergency-plans/access";
import {
  buildEmergencyPlanSnapshot,
  emptyEmergencyPlanDraft,
  isEmptyEmergencyPlan,
  parseEmergencyPlanSnapshot,
  storedProcedureItems,
  type EmergencyPlanDraft,
  type EmergencyPlanSnapshot,
} from "@/modules/emergency-plans/domain";

export type EmergencyPlanVersionSummary = { versionNumber: number; publishedAt: Date };
export type PublishedEmergencyPlan = EmergencyPlanVersionSummary & { snapshot: EmergencyPlanSnapshot };

type Reader = Pick<Prisma.TransactionClient, "emergencyPlan">;

async function readDraft(client: Reader, eventId: string): Promise<EmergencyPlanDraft> {
  const plan = await client.emergencyPlan.findUnique({
    where: { eventId },
    select: {
      locations: { orderBy: { sortOrder: "asc" } },
      procedures: { orderBy: { sortOrder: "asc" } },
      contacts: { orderBy: { escalationOrder: "asc" } },
    },
  });
  if (!plan) return emptyEmergencyPlanDraft;
  return {
    locations: plan.locations.map((row) => ({
      kind: row.kind,
      name: row.name,
      description: row.description,
      capacityNote: row.capacityNote,
      directions: row.directions,
      mapReference: row.mapReference,
    })),
    procedures: plan.procedures.map((row) => ({
      kind: row.kind,
      title: row.title,
      body: row.body,
      items: storedProcedureItems(row.items),
    })),
    contacts: plan.contacts.map((row) => ({
      role: row.role,
      name: row.name,
      phone: row.phone,
      escalationOrder: row.escalationOrder,
    })),
  };
}

/** The draft as stored (an empty draft before the first save). */
export function getEmergencyPlanDraft(eventId: string): Promise<EmergencyPlanDraft> {
  return readDraft(getPrisma(), eventId);
}

/** Replaces the draft with the validated input, in one transaction, and audits it. Published versions are untouched. */
export async function saveEmergencyPlanDraft(eventId: string, draft: EmergencyPlanDraft, actorUserId: string): Promise<EmergencyPlanDraft> {
  await getPrisma().$transaction(async (tx) => {
    const plan = await tx.emergencyPlan.upsert({ where: { eventId }, create: { eventId }, update: {}, select: { id: true } });
    await Promise.all([
      tx.emergencyPlanLocation.deleteMany({ where: { planId: plan.id } }),
      tx.emergencyPlanProcedure.deleteMany({ where: { planId: plan.id } }),
      tx.emergencyPlanContact.deleteMany({ where: { planId: plan.id } }),
    ]);
    await tx.emergencyPlanLocation.createMany({
      data: draft.locations.map((location, index) => ({ ...location, planId: plan.id, sortOrder: index })),
    });
    await tx.emergencyPlanProcedure.createMany({
      data: draft.procedures.map((procedure, index) => ({ ...procedure, items: procedure.items, planId: plan.id, sortOrder: index })),
    });
    await tx.emergencyPlanContact.createMany({
      data: draft.contacts.map((contact) => ({ ...contact, planId: plan.id })),
    });
    await tx.emergencyPlan.update({ where: { id: plan.id }, data: { updatedAt: new Date() } });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "emergency-plan.draft-saved",
      entityType: "EmergencyPlan",
      entityId: plan.id,
      summary: "Saved the emergency plan draft.",
      metadata: { locations: draft.locations.length, procedures: draft.procedures.length, contacts: draft.contacts.length },
    }, tx);
  });
  return getEmergencyPlanDraft(eventId);
}

/**
 * Publishes the draft as the next version: an immutable snapshot, numbered
 * max + 1, written in one transaction. A concurrent publish that takes the
 * same number loses on the unique key and is told to retry.
 */
export async function publishEmergencyPlan(eventId: string, actorUserId: string): Promise<PublishedEmergencyPlan> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      const draft = await readDraft(tx, eventId);
      if (isEmptyEmergencyPlan(draft)) {
        throw new EmergencyPlanError("Add at least one location, procedure or contact before publishing.", "EMPTY_PLAN", 409);
      }
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { name: true, startsAt: true, endsAt: true, timezone: true } });
      if (!event) throw new EmergencyPlanError("This event could not be found.", "EVENT_NOT_FOUND", 404);
      const plan = await tx.emergencyPlan.upsert({ where: { eventId }, create: { eventId }, update: {}, select: { id: true } });
      const latest = await tx.emergencyPlanVersion.aggregate({ where: { planId: plan.id }, _max: { versionNumber: true } });
      const snapshot = buildEmergencyPlanSnapshot(draft, event);
      const created = await tx.emergencyPlanVersion.create({
        data: {
          planId: plan.id,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          publishedByUserId: actorUserId,
        },
        select: { id: true, versionNumber: true, publishedAt: true },
      });
      await writeAuditLog({
        eventId,
        actorUserId,
        action: "emergency-plan.published",
        entityType: "EmergencyPlanVersion",
        entityId: created.id,
        summary: `Published emergency plan version ${created.versionNumber}.`,
        metadata: { versionNumber: created.versionNumber },
      }, tx);
      return { versionNumber: created.versionNumber, publishedAt: created.publishedAt, snapshot };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new EmergencyPlanError("Another version was published at the same moment. Reload and publish again.", "PUBLISH_CONFLICT", 409);
    }
    throw error;
  }
}

export async function listEmergencyPlanVersions(eventId: string): Promise<EmergencyPlanVersionSummary[]> {
  const rows = await getPrisma().emergencyPlanVersion.findMany({
    where: { plan: { eventId } },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, publishedAt: true },
  });
  return rows;
}

/** A published version, or the latest when `versionNumber` is omitted. Null when there is none (or it is unreadable). */
export async function getEmergencyPlanVersion(eventId: string, versionNumber?: number): Promise<PublishedEmergencyPlan | null> {
  const row = await getPrisma().emergencyPlanVersion.findFirst({
    where: { plan: { eventId }, ...(versionNumber === undefined ? {} : { versionNumber }) },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, publishedAt: true, snapshot: true },
  });
  if (!row) return null;
  const snapshot = parseEmergencyPlanSnapshot(row.snapshot);
  return snapshot ? { versionNumber: row.versionNumber, publishedAt: row.publishedAt, snapshot } : null;
}

/** The event's name and dates, for a draft preview. */
export async function getEmergencyPlanEvent(eventId: string) {
  return getPrisma().event.findUnique({ where: { id: eventId }, select: { name: true, startsAt: true, endsAt: true, timezone: true } });
}
