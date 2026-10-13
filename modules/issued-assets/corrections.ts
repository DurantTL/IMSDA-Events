import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { AssetError } from "@/modules/issued-assets/errors";
import { correctionActionSchema, coverStateOf, effectiveEndReason } from "@/modules/issued-assets/returns-domain";
import { lockAssets, requireEvent, transact, type Tx } from "@/modules/issued-assets/service";

/**
 * Issued assets (#214): corrections of a recorded outcome, and write-offs.
 *
 * An ended issuance never changes, so a correction is an append-only history row on it (`OUTCOME_CORRECTED`, carrying the
 * corrected fate, or `WRITTEN_OFF`) with the actor, the reason and the time. The closeout and the deposit rules read the
 * *effective* fate: the last correction, else the recorded end. A lost key found later is LOST corrected to RETURNED. The
 * original of a replacement made without recording what became of it is given its fate here, or written off.
 *
 * Money follows by rule, never automatically: a deposit that is not yet settled is settled by the corrected fates; one that
 * is already settled is flagged in the closeout for staff, and nothing is refunded or re-charged by a correction.
 */

type Client = ReturnType<typeof getPrisma> | Tx;

export type CorrectionRow = { issuanceId: string; assetId: string; type: "OUTCOME_CORRECTED" | "WRITTEN_OFF" | "EXCEPTION_REVIEWED"; fate: string | null; at: Date; recordedAt: Date; reason: string | null; actorUserId: string; quantity: number };

/** Every correction and write-off of the given issuances (or of the whole event), oldest first. */
export async function loadCorrectionRows(client: Client, eventId: string, issuanceIds?: readonly string[]): Promise<Map<string, CorrectionRow[]>> {
  const rows = await client.assetIssuanceHistory.findMany({
    where: { eventId, type: { in: ["OUTCOME_CORRECTED", "WRITTEN_OFF", "EXCEPTION_REVIEWED"] }, ...(issuanceIds ? { issuanceId: { in: [...issuanceIds] } } : {}) },
    orderBy: [{ recordedAt: "asc" }, { at: "asc" }],
    select: { issuanceId: true, assetId: true, type: true, correctedEndReason: true, at: true, recordedAt: true, reason: true, actorUserId: true, quantity: true },
  });
  const byIssuance = new Map<string, CorrectionRow[]>();
  for (const row of rows) {
    byIssuance.set(row.issuanceId, [...(byIssuance.get(row.issuanceId) ?? []), {
      issuanceId: row.issuanceId, assetId: row.assetId, type: row.type as CorrectionRow["type"], fate: row.correctedEndReason, at: row.at, recordedAt: row.recordedAt, reason: row.reason, actorUserId: row.actorUserId, quantity: row.quantity,
    }]);
  }
  return byIssuance;
}

/** The fate an ended issuance has now. `endReason` is what the deposit and closeout rules read. */
export function fateOf(row: { endedAt: Date | string | null; endReason: string | null }, corrections: readonly CorrectionRow[] | undefined) {
  const fates = (corrections ?? []).filter((entry) => entry.type === "OUTCOME_CORRECTED");
  const corrected = fates.length > 0 ? fates[fates.length - 1]!.fate : null;
  const writtenOff = (corrections ?? []).some((entry) => entry.type === "WRITTEN_OFF");
  return {
    endedAt: row.endedAt,
    endReason: effectiveEndReason(row.endReason, corrected, writtenOff),
    corrected: corrected !== null,
    writtenOff,
    /** Recorded first, then each correction: for the reconciliation. */
    steps: fates.map((entry, index) => ({ from: index === 0 ? row.endReason ?? "" : fates[index - 1]!.fate ?? "", to: entry.fate ?? "", quantity: entry.quantity })),
  };
}

export type CorrectionResult = { issuanceId: string; kind: "CORRECTED" | "WRITTEN_OFF" | "REVIEWED"; from: string | null; to: string | null; replayed: boolean };

/**
 * Corrects a recorded outcome (RETURNED, LOST, DAMAGED, or the original of a replacement) or writes a loss off. Event
 * administrators and finance only (MANAGE_FINANCE or CONFIGURE_EVENT), with a reason. A stock record follows a numbered
 * item whose latest issue this is (a found key goes back in stock). Nothing is charged, refunded or settled here.
 */
export async function recordOutcomeCorrection(eventId: string, actorUserId: string, rawInput: unknown, options: { canManageMoney: boolean }): Promise<CorrectionResult> {
  const input = correctionActionSchema.parse(rawInput);
  if (!options.canManageMoney) throw new AssetError("MONEY_PERMISSION_REQUIRED", "Correcting an outcome or writing off a loss needs finance (MANAGE_FINANCE) or an event administrator (CONFIGURE_EVENT).");
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    if (input.idempotencyKey) {
      const replay = await tx.assetIssuanceHistory.findUnique({ where: { eventId_idempotencyKey: { eventId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        const sameAction = replay.issuanceId === input.issuanceId
          && (input.action === "correct" ? replay.type === "OUTCOME_CORRECTED" && replay.correctedEndReason === input.fate
            : input.action === "write_off" ? replay.type === "WRITTEN_OFF" : replay.type === "EXCEPTION_REVIEWED");
        if (!sameAction) throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different correction.");
        return { issuanceId: replay.issuanceId, kind: replay.type === "WRITTEN_OFF" ? "WRITTEN_OFF" as const : replay.type === "EXCEPTION_REVIEWED" ? "REVIEWED" as const : "CORRECTED" as const, from: null, to: replay.correctedEndReason, replayed: true };
      }
    }
    const first = await tx.assetIssuance.findFirst({ where: { id: input.issuanceId, eventId }, select: { assetId: true } });
    if (!first) throw new AssetError("ISSUANCE_NOT_FOUND", "That issue was not found.");
    await lockAssets(tx, eventId, [first.assetId]);
    const row = await tx.assetIssuance.findFirstOrThrow({ where: { id: input.issuanceId, eventId }, include: { asset: true } });
    if (input.action !== "review" && (!row.endedAt || !["RETURNED", "LOST", "DAMAGED", "REPLACED"].includes(row.endReason ?? ""))) {
      throw new AssetError("CORRECTION_INVALID", "Only a recorded return, loss, damage or the original of a replacement can be corrected.");
    }
    const current = fateOf(row, (await loadCorrectionRows(tx, eventId, [row.id])).get(row.id));
    const base = {
      eventId, issuanceId: row.id, assetId: row.assetId, actorUserId, reason: input.reason, entryMethod: "MANUAL" as const, quantity: row.endQuantity ?? row.quantity,
      assigneeKind: row.assigneeKind, attendeeId: row.attendeeId, registrationId: row.registrationId, staffUserId: row.staffUserId, roomUnitId: row.roomUnitId,
      sourceAssignmentId: row.sourceAssignmentId, assigneeLabel: row.assigneeLabel, revision: row.revision, idempotencyKey: input.idempotencyKey ?? null,
    };
    if (input.action === "review") {
      await tx.assetIssuanceHistory.create({ data: { ...base, type: "EXCEPTION_REVIEWED" } });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_EXCEPTION_REVIEWED", entityType: "AssetIssuance", entityId: row.id, summary: "Reviewed a closeout exception on an issued item.", metadata: { assetId: row.assetId } }, tx);
      return { issuanceId: row.id, kind: "REVIEWED" as const, from: null, to: null, replayed: false };
    }
    if (input.action === "write_off") {
      const lostOrDamaged = current.endReason === "LOST" || current.endReason === "DAMAGED";
      const replacedOriginal = row.endReason === "REPLACED" && !current.corrected && !current.writtenOff;
      if (current.writtenOff || !(lostOrDamaged || replacedOriginal)) throw new AssetError("CORRECTION_INVALID", "Only a loss, a damaged item or the unaccounted original of a replacement can be written off, and only once.");
      await tx.assetIssuanceHistory.create({ data: { ...base, type: "WRITTEN_OFF" } });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_LOSS_WRITTEN_OFF", entityType: "AssetIssuance", entityId: row.id, summary: "Wrote off a lost, damaged or replaced item without charging it.", metadata: { assetId: row.assetId, was: current.endReason } }, tx);
      return { issuanceId: row.id, kind: "WRITTEN_OFF" as const, from: current.endReason, to: null, replayed: false };
    }
    if (input.fate === current.endReason) throw new AssetError("CORRECTION_INVALID", `That is already recorded as ${input.fate.toLowerCase()}.`);
    await tx.assetIssuanceHistory.create({ data: { ...base, type: "OUTCOME_CORRECTED", correctedEndReason: input.fate } });
    // A numbered item follows its latest issue's fate: a found key is back in stock, a lost or damaged one is held out.
    const wasLossy = current.endReason === "LOST" || current.endReason === "DAMAGED";
    const nowLossy = input.fate === "LOST" || input.fate === "DAMAGED";
    if (!row.serialized) {
      // A lot follows the corrected fate: units lost or damaged come off the lot, a found one goes back on (under the asset lock).
      const quantity = row.endQuantity ?? row.quantity;
      const held = (await tx.assetIssuance.aggregate({ where: { assetId: row.assetId, endedAt: null }, _sum: { quantity: true } }))._sum.quantity ?? 0;
      if (wasLossy && !nowLossy) {
        await tx.issuedAsset.update({ where: { id: row.assetId }, data: { quantityTotal: row.asset.quantityTotal + quantity } });
      } else if (!wasLossy && nowLossy) {
        const next = row.asset.quantityTotal - quantity;
        if (next >= 1 && next >= held) await tx.issuedAsset.update({ where: { id: row.assetId }, data: { quantityTotal: next } });
      }
    } else {
      const later = await tx.assetIssuance.count({ where: { assetId: row.assetId, createdAt: { gt: row.createdAt } } });
      if (later === 0) {
        if (input.fate === "RETURNED") {
          // A found or wrongly-damaged key is back in stock, and a damaged mark does not outlive the correction.
          await tx.issuedAsset.update({ where: { id: row.assetId }, data: { ...(row.asset.availability === "UNAVAILABLE" ? { availability: "AVAILABLE" as const } : {}), ...(row.asset.condition === "DAMAGED" ? { condition: "GOOD" as const } : {}) } });
        } else {
          await tx.issuedAsset.update({ where: { id: row.assetId }, data: { availability: "UNAVAILABLE", ...(input.fate === "DAMAGED" ? { condition: "DAMAGED" as const } : {}) } });
        }
      }
    }
    await writeAuditLog({ eventId, actorUserId, action: "ASSET_OUTCOME_CORRECTED", entityType: "AssetIssuance", entityId: row.id, summary: `Corrected a recorded outcome from ${(current.endReason ?? "").toLowerCase()} to ${input.fate.toLowerCase()}.`, metadata: { assetId: row.assetId, from: current.endReason, to: input.fate } }, tx);
    return { issuanceId: row.id, kind: "CORRECTED" as const, from: current.endReason, to: input.fate, replayed: false };
  });
}

/**
 * The issuances (of those given) that carry an unwaived replacement or damage charge **posted to a registration**: the guest
 * is actually billed for the loss, so the deposit is not kept for it as well. A charge that was only recorded (not posted)
 * is never collected by anything, so it never excuses an item from the deposit.
 */
export async function loadChargedIssuances(client: Client, eventId: string, issuanceIds: readonly string[]): Promise<Set<string>> {
  if (issuanceIds.length === 0) return new Set();
  const rows = await client.assetLedgerEntry.findMany({
    where: { eventId, kind: "CHARGE", chargeCategory: { in: ["REPLACEMENT", "DAMAGE"] }, registrationAdjustmentId: { not: null }, issuanceId: { in: [...issuanceIds] }, waivedBy: { none: {} } },
    select: { issuanceId: true },
  });
  return new Set(rows.flatMap((row) => (row.issuanceId ? [row.issuanceId] : [])));
}

/** What the deposit rules read for each covered issuance: its effective fate, how many it applies to, and whether a charge already covers it. */
export function coverInputs(
  rows: ReadonlyArray<{ id: string; endedAt: Date | string | null; endReason: string | null; quantity: number; endQuantity: number | null }>,
  corrections: Map<string, CorrectionRow[]>,
  charged: ReadonlySet<string>,
) {
  return rows.map((row) => ({
    state: coverStateOf({ endedAt: row.endedAt, endReason: fateOf(row, corrections.get(row.id)).endReason }),
    quantity: row.endQuantity ?? row.quantity,
    charged: charged.has(row.id),
  }));
}
