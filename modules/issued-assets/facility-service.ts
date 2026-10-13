import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { normalizeAssetCode } from "@/modules/issued-assets/domain";
import { AssetError } from "@/modules/issued-assets/errors";
import { facilityActionSchema, type FacilityBlockInput } from "@/modules/issued-assets/returns-domain";
import { requireEvent, resolveAssetByCode, transact, type Tx } from "@/modules/issued-assets/service";
import { LodgingError } from "@/modules/lodging/errors";
import { createHold } from "@/modules/lodging/service";

/**
 * Issued assets (#214, slice 2): facility issues and room blocks.
 *
 * A facility issue is a ticket about a room, site, item or place found at check-out or reported any time: severity,
 * status, assignee and resolution change, and every change appends a full snapshot to its history (database triggers keep
 * the history append-only and a finished issue closed). A *block* is a lodging hold (maintenance, safety, damage or staff)
 * placed through the lodging service: it takes the room or site out of availability for a window of nights and never
 * touches an assignment that already exists. Resolving an issue does not release its block; an administrator does that
 * (a resolved issue that still blocks a room is listed in the closeout).
 */

const finished = new Set(["RESOLVED", "DISMISSED"]);

async function snapshot(tx: Tx, issue: { id: string; eventId: string; severity: Prisma.FacilityIssueHistoryUncheckedCreateInput["severity"]; status: Prisma.FacilityIssueHistoryUncheckedCreateInput["status"]; assigneeUserId: string | null; holdId: string | null; revision: number }, type: "REPORTED" | "UPDATED" | "BLOCK_PLACED" | "RESOLVED" | "DISMISSED", actorUserId: string, note: string | null) {
  await tx.facilityIssueHistory.create({
    data: { eventId: issue.eventId, issueId: issue.id, type, actorUserId, status: issue.status, severity: issue.severity, assigneeUserId: issue.assigneeUserId, note, holdId: issue.holdId, revision: issue.revision },
  });
}

async function requireStaff(tx: Tx, eventId: string, userId: string) {
  const member = await tx.eventMembership.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { status: true } });
  if (!member || member.status !== "ACTIVE") throw new AssetError("STAFF_NOT_ON_EVENT", "That person is not active event staff.");
}

export type FacilityResult = { issueId: string; holdId: string | null; blockError: string | null };

export async function applyFacilityAction(eventId: string, actorUserId: string, rawInput: unknown, options: { canConfigure: boolean }): Promise<FacilityResult> {
  const input = facilityActionSchema.parse(rawInput);

  if (input.action === "block") {
    if (!options.canConfigure) throw new AssetError("CONFIGURE_REQUIRED", "Blocking a room or site changes lodging availability. An event administrator has to do it.");
    return placeBlock(eventId, actorUserId, input.issueId, input.block);
  }

  if (input.action === "report") {
    if (input.block && !options.canConfigure) throw new AssetError("CONFIGURE_REQUIRED", "Blocking a room or site changes lodging availability. Report the issue, and an event administrator can block it.");
    const issueId = await transact(async (tx) => {
      await requireEvent(tx, eventId);
      let unitId: string | null = null;
      let assetId: string | null = null;
      if (input.targetKind === "UNIT") {
        const unit = await tx.eventLodgingUnit.findFirst({ where: { id: input.eventUnitId!, eventId }, select: { id: true } });
        if (!unit) throw new AssetError("ASSIGNEE_NOT_FOUND", "That room or site was not found for this event.");
        unitId = unit.id;
      } else if (input.targetKind === "ASSET") {
        const asset = await resolveAssetByCode(tx, eventId, normalizeAssetCode(input.assetCode!));
        if (!asset) throw new AssetError("ASSET_NOT_FOUND", `No item has the code ${normalizeAssetCode(input.assetCode!)}.`);
        assetId = asset.id;
      }
      if (input.sourceIssuanceId) {
        const source = await tx.assetIssuance.findFirst({ where: { id: input.sourceIssuanceId, eventId }, select: { id: true } });
        if (!source) throw new AssetError("ISSUANCE_NOT_FOUND", "That issue was not found.");
      }
      if (input.assigneeUserId) await requireStaff(tx, eventId, input.assigneeUserId);
      const created = await tx.facilityIssue.create({
        data: {
          eventId, targetKind: input.targetKind, eventUnitId: unitId, assetId, targetLabel: input.targetKind === "OTHER" ? input.targetLabel! : null,
          title: input.title, description: input.description?.trim() || null, severity: input.severity, source: input.source,
          sourceIssuanceId: input.sourceIssuanceId ?? null, assigneeUserId: input.assigneeUserId ?? null, reportedByUserId: actorUserId,
        },
      });
      await snapshot(tx, created, "REPORTED", actorUserId, input.description?.trim() || null);
      await writeAuditLog({
        eventId, actorUserId, action: "FACILITY_ISSUE_REPORTED", entityType: "FacilityIssue", entityId: created.id,
        summary: "Reported a facility issue.", metadata: { targetKind: input.targetKind, severity: input.severity, source: input.source },
      }, tx);
      return created.id;
    });
    if (!input.block) return { issueId, holdId: null, blockError: null };
    try {
      const placed = await placeBlock(eventId, actorUserId, issueId, input.block);
      return { issueId, holdId: placed.holdId, blockError: null };
    } catch (error) {
      if (error instanceof AssetError && (error.code === "BLOCK_REFUSED" || error.code === "BLOCK_EXISTS")) return { issueId, holdId: null, blockError: error.message };
      throw error;
    }
  }

  // update
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    const current = await tx.facilityIssue.findFirst({ where: { id: input.issueId, eventId } });
    if (!current) throw new AssetError("FACILITY_NOT_FOUND", "That facility issue was not found.");
    if (finished.has(current.status)) throw new AssetError("FACILITY_FINISHED", "That issue is closed. Report a new one if the problem is back.");
    const status = input.status ?? current.status;
    const finishing = finished.has(status);
    const resolution = input.resolution?.trim() || null;
    if (finishing && !resolution) throw new AssetError("FACILITY_INVALID", "Say how it was resolved (or why it is dismissed).");
    let assigneeUserId = current.assigneeUserId;
    if (input.assigneeUserId !== undefined) {
      assigneeUserId = input.assigneeUserId === "" ? null : input.assigneeUserId;
      if (assigneeUserId) await requireStaff(tx, eventId, assigneeUserId);
    }
    const severity = input.severity ?? current.severity;
    const note = input.note?.trim() || null;
    const changed = status !== current.status || severity !== current.severity || assigneeUserId !== current.assigneeUserId || note !== null;
    if (!changed) throw new AssetError("FACILITY_INVALID", "Nothing changed.");
    const revision = current.revision + 1;
    const now = new Date();
    const updated = await tx.facilityIssue.updateMany({
      where: { id: current.id, revision: current.revision },
      data: {
        status, severity, assigneeUserId, revision,
        ...(finishing ? { resolution, resolvedAt: now, resolvedByUserId: actorUserId } : {}),
      },
    });
    if (updated.count !== 1) throw new AssetError("BUSY", "Someone else changed that issue. Reload and try again.");
    await snapshot(tx, { ...current, status, severity, assigneeUserId, revision }, status === "RESOLVED" ? "RESOLVED" : status === "DISMISSED" ? "DISMISSED" : "UPDATED", actorUserId, finishing ? resolution : note);
    await writeAuditLog({
      eventId, actorUserId, action: "FACILITY_ISSUE_UPDATED", entityType: "FacilityIssue", entityId: current.id,
      summary: finishing ? `Marked a facility issue ${status.toLowerCase()}.` : "Updated a facility issue.", metadata: { from: current.status, to: status, severity },
    }, tx);
    return { issueId: current.id, holdId: current.holdId, blockError: null };
  });
}

/**
 * Blocks the room or site of a facility issue for a window of nights, through the lodging hold service: the hold is the
 * block, availability reads it, and no assignment is changed. The hold is placed in the lodging service's own
 * transaction and then linked to the issue.
 */
async function placeBlock(eventId: string, actorUserId: string, issueId: string, block: FacilityBlockInput): Promise<FacilityResult> {
  const issue = await getPrisma().facilityIssue.findFirst({ where: { id: issueId, eventId }, include: { hold: { select: { releasedAt: true } } } });
  if (!issue) throw new AssetError("FACILITY_NOT_FOUND", "That facility issue was not found.");
  if (finished.has(issue.status)) throw new AssetError("FACILITY_FINISHED", "That issue is closed.");
  if (issue.targetKind !== "UNIT" || !issue.eventUnitId) throw new AssetError("FACILITY_INVALID", "Only a room or site can be blocked.");
  if (issue.hold && !issue.hold.releasedAt) throw new AssetError("BLOCK_EXISTS", "That issue already blocks the room. Release the block in Lodging first to place another.");
  let holdId: string;
  try {
    holdId = (await createHold(eventId, issue.eventUnitId, actorUserId, { kind: block.kind, reason: block.reason, firstNight: block.firstNight, lastNight: block.lastNight })).id;
  } catch (error) {
    if (error instanceof LodgingError) throw new AssetError("BLOCK_REFUSED", error.message);
    throw error;
  }
  await transact(async (tx) => {
    const current = await tx.facilityIssue.findFirstOrThrow({ where: { id: issue.id, eventId } });
    if (finished.has(current.status)) return;
    const revision = current.revision + 1;
    const updated = await tx.facilityIssue.updateMany({ where: { id: current.id, revision: current.revision }, data: { holdId, revision } });
    if (updated.count !== 1) throw new AssetError("BUSY", "Someone else changed that issue. Reload and try again.");
    await snapshot(tx, { ...current, holdId, revision }, "BLOCK_PLACED", actorUserId, `${block.kind.toLowerCase()} block ${block.firstNight} to ${block.lastNight}`);
    await writeAuditLog({
      eventId, actorUserId, action: "FACILITY_BLOCK_PLACED", entityType: "FacilityIssue", entityId: current.id,
      summary: "Blocked a room or site for a facility issue.", metadata: { holdId, kind: block.kind, firstNight: block.firstNight, lastNight: block.lastNight },
    }, tx);
  });
  return { issueId: issue.id, holdId, blockError: null };
}
