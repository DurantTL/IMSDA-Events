import "server-only";

import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  decideIssue,
  normalizeAssetCode,
  plausibleOccurredAt,
  type AssetCondition,
  type AssetMode,
  type HolderKey,
} from "@/modules/issued-assets/domain";
import { AssetError } from "@/modules/issued-assets/errors";
import {
  resolveReturnQuantity,
  returnRequestSchema,
  stockAfterReturn,
  type ReturnItemErrorCode,
  type ReturnOutcome,
} from "@/modules/issued-assets/returns-domain";
import {
  endIssuance,
  inheritDepositCover,
  lockAssets,
  requireEvent,
  resolveAssetByCode,
  resolveRoomLink,
  rowHolderKey,
  transact,
  writeNewIssuance,
  type Holder,
  type OpenIssuance,
  type RoomLink,
  type Tx,
} from "@/modules/issued-assets/service";

/**
 * Issued assets (#214, slice 2): the one transactional return service.
 *
 * A return, a loss and a damage are the same write: the issuance ends (its end reason, actor, note and time) and one
 * history row is appended, in a SERIALIZABLE transaction that locks the asset rows in id order exactly as issuing does.
 * An ended issuance never changes. A partial return of a lot ends the issuance and starts the remainder as a new one
 * pointing back at it. A lost or damaged numbered item can be replaced in the same step. A manual entry, a scan and an
 * offline sheet sent later are all `returnAssets`, and a saved retry key makes a replay write nothing twice.
 */

export type ReturnItemResult = {
  index: number;
  code: string;
  status: "RETURNED" | "LOST" | "DAMAGED" | "DUPLICATE" | "REPLAYED" | "REJECTED";
  issuanceId?: string;
  assetId?: string;
  identifier?: string;
  typeName?: string;
  quantity?: number;
  /** The part of a lot still out after a partial outcome. */
  remainingQuantity?: number;
  replacementIssuanceId?: string;
  replacementIdentifier?: string;
  error?: { code: ReturnItemErrorCode; message: string };
};

export type ReturnResult = {
  returned: number;
  lost: number;
  damaged: number;
  duplicates: number;
  rejected: number;
  items: ReturnItemResult[];
};

type Plan = {
  index: number;
  row: OpenIssuance;
  outcome: ReturnOutcome;
  quantity: number;
  remainder: number;
  condition: AssetCondition | null;
  note: string;
  evidenceRef: string | null;
  itemKey: string | null;
  at: Date;
  replacement: null | { assetId: string; identifier: string; serialized: boolean; link: RoomLink };
  stockDelta?: number;
  asset: { id: string; identifier: string; typeName: string; mode: AssetMode; quantityTotal: number };
};

const holderOf = (row: OpenIssuance): Holder => ({
  kind: row.assigneeKind, attendeeId: row.attendeeId, registrationId: row.registrationId, staffUserId: row.staffUserId,
  roomUnitId: row.assigneeKind === "ROOM" ? row.roomUnitId : null, assigneeLabel: row.assigneeLabel, display: "",
});

const endedLabel: Record<string, string> = { RETURNED: "returned", LOST: "recorded lost", DAMAGED: "returned damaged", TRANSFERRED: "transferred", REPLACED: "replaced", CORRECTED: "withdrawn in error" };

export async function returnAssets(eventId: string, actorUserId: string, rawInput: unknown): Promise<ReturnResult> {
  const input = returnRequestSchema.parse(rawInput);
  const now = new Date();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
  if (occurredAt && !plausibleOccurredAt(occurredAt, now)) {
    throw new AssetError("OCCURRED_AT_INVALID", "That time is too far in the past or the future. Check the device clock.");
  }
  return transact(async (tx) => {
    await requireEvent(tx, eventId);

    // Resolve every named issue or code first (no locks yet), then lock the assets together, in order, and re-read.
    const byId = new Map<string, OpenIssuance>();
    const namedRows = await tx.assetIssuance.findMany({ where: { eventId, id: { in: input.items.flatMap((item) => (item.issuanceId ? [item.issuanceId] : [])) } } });
    for (const row of namedRows) byId.set(row.id, row);
    const codeAssets = await Promise.all(input.items.map((item) => (item.issuanceId ? null : resolveAssetByCode(tx, eventId, item.code!))));
    const replacementAssets = await Promise.all(input.items.map((item) => (item.replacementCode ? resolveAssetByCode(tx, eventId, item.replacementCode) : null)));
    const assetIds = [...new Set([
      ...namedRows.map((row) => row.assetId),
      ...codeAssets.flatMap((row) => (row ? [row.id] : [])),
      ...replacementAssets.flatMap((row) => (row ? [row.id] : [])),
    ])];
    await lockAssets(tx, eventId, assetIds);

    const assets = await tx.issuedAsset.findMany({ where: { eventId, id: { in: assetIds } }, include: { assetType: true } });
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const issuances = await tx.assetIssuance.findMany({ where: { eventId, assetId: { in: assetIds } }, orderBy: { issuedAt: "desc" } });
    const issuanceById = new Map(issuances.map((row) => [row.id, row]));
    const openByAsset = new Map<string, OpenIssuance[]>();
    for (const row of issuances) if (!row.endedAt) openByAsset.set(row.assetId, [...(openByAsset.get(row.assetId) ?? []), row]);

    const itemKeys = input.items.map((_, index) => (input.idempotencyKey ? `${input.idempotencyKey}:${index}` : null));
    const replayRows = input.idempotencyKey
      ? await tx.assetIssuanceHistory.findMany({ where: { eventId, idempotencyKey: { in: itemKeys.filter((value): value is string => value !== null) } } })
      : [];
    const replayByKey = new Map(replayRows.map((row) => [row.idempotencyKey!, row]));

    const results: ReturnItemResult[] = [];
    const plans: Plan[] = [];
    const usedIssuances = new Set<string>();
    const usedReplacements = new Set<string>();

    for (const [index, item] of input.items.entries()) {
      const label = item.code ?? item.issuanceId ?? "";
      const base = { index, code: label };
      const reject = (code: ReturnItemErrorCode, message: string, extra: Partial<ReturnItemResult> = {}) => results.push({ ...base, ...extra, status: "REJECTED", error: { code, message } });

      // The target: the named issue, or the one open issue of the scanned item.
      const named = item.issuanceId ? issuanceById.get(item.issuanceId) ?? byId.get(item.issuanceId) : undefined;
      const scanned = codeAssets[index];
      const replay = itemKeys[index] ? replayByKey.get(itemKeys[index]!) : undefined;
      if (replay) {
        const matches = item.issuanceId ? replay.issuanceId === item.issuanceId : scanned ? replay.assetId === scanned.id : false;
        if (!matches) throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different return.");
        const asset = assetById.get(replay.assetId);
        results.push({ ...base, status: "REPLAYED", issuanceId: replay.issuanceId, assetId: replay.assetId, identifier: asset?.identifier, typeName: asset?.assetType.name, quantity: replay.quantity });
        usedIssuances.add(replay.issuanceId);
        continue;
      }
      if (item.issuanceId && !named) { reject("ISSUANCE_NOT_FOUND", "That issue was not found for this event."); continue; }
      if (!item.issuanceId && !scanned) { reject("ASSET_NOT_FOUND", `No item has the code ${normalizeAssetCode(item.code!)}.`); continue; }

      const assetId = named ? named.assetId : scanned!.id;
      const asset = assetById.get(assetId)!;
      const names = { assetId: asset.id, identifier: asset.identifier, typeName: asset.assetType.name };
      let row: OpenIssuance | undefined = named;
      if (!row) {
        const open = openByAsset.get(asset.id) ?? [];
        if (open.length > 1) { reject("AMBIGUOUS_HOLDER", "That item is out to several holders. Return it from the holder's own list.", names); continue; }
        row = open[0];
        if (!row) {
          const last = issuances.find((candidate) => candidate.assetId === asset.id);
          if (last?.endReason === "RETURNED" || last?.endReason === "LOST" || last?.endReason === "DAMAGED") {
            results.push({ ...base, ...names, status: "DUPLICATE", issuanceId: last.id });
          } else {
            reject("NOT_OUT", "That item is not issued to anyone, so there is nothing to return.", names);
          }
          continue;
        }
      }
      if (usedIssuances.has(row.id)) { reject("DUPLICATE_IN_REQUEST", "That item appears twice in this request.", names); continue; }
      usedIssuances.add(row.id);
      if (row.endedAt) {
        if (row.endReason === "RETURNED" || row.endReason === "LOST" || row.endReason === "DAMAGED") results.push({ ...base, ...names, status: "DUPLICATE", issuanceId: row.id });
        else reject("NOT_OUT", `That issue already ended (${endedLabel[row.endReason ?? ""] ?? "ended"}).`, names);
        continue;
      }

      const sized = resolveReturnQuantity(row.quantity, row.serialized, item.quantity);
      if (!sized.ok) { reject("QUANTITY_INVALID", sized.message, names); continue; }
      // An offline sheet says when it happened; it cannot be before the issue itself. Online, a fast device clock is forgiven.
      let at = occurredAt ?? now;
      if (occurredAt && at < row.issuedAt) { reject("OCCURRED_AT_INVALID", "That return is dated before the item was issued.", names); continue; }
      if (!occurredAt && at < row.issuedAt) at = row.issuedAt;

      let replacement: Plan["replacement"] = null;
      if (item.replacementCode) {
        const next = replacementAssets[index];
        const nextAsset = next ? assetById.get(next.id) : undefined;
        if (!nextAsset) { reject("REPLACEMENT_INVALID", `No item has the code ${normalizeAssetCode(item.replacementCode)}.`, names); continue; }
        if (!row.serialized || nextAsset.assetType.mode !== "SERIALIZED") { reject("REPLACEMENT_INVALID", "Only a numbered item is replaced here. A lot is shared stock.", names); continue; }
        if (nextAsset.id === asset.id) { reject("REPLACEMENT_INVALID", "The replacement must be a different item.", names); continue; }
        if (nextAsset.assetTypeId !== asset.assetTypeId) { reject("REPLACEMENT_INVALID", "The replacement must be the same kind of item.", names); continue; }
        if (usedReplacements.has(nextAsset.id)) { reject("REPLACEMENT_INVALID", "That replacement is used twice in this request.", names); continue; }
        const holderKey: HolderKey = rowHolderKey(row);
        const decision = decideIssue({
          type: { active: true, mode: "SERIALIZED", assigneeKinds: nextAsset.assetType.assigneeKinds },
          asset: { availability: nextAsset.availability, quantityTotal: nextAsset.quantityTotal },
          holder: holderKey, open: (openByAsset.get(nextAsset.id) ?? []).map((open) => ({ id: open.id, quantity: open.quantity, holder: rowHolderKey(open) })),
          quantity: 1, addMore: false,
        });
        if (decision.outcome !== "ISSUE") { reject("REPLACEMENT_INVALID", `The replacement: ${decision.outcome === "REJECT" ? decision.message : "it is already issued to this holder."}`, names); continue; }
        let link: RoomLink = { roomUnitId: row.roomUnitId, sourceAssignmentId: row.sourceAssignmentId };
        if (nextAsset.assetType.roomLinked && (row.assigneeKind === "ATTENDEE" || row.assigneeKind === "REGISTRATION" || row.assigneeKind === "ROOM")) {
          const stillCurrent = row.sourceAssignmentId
            ? await tx.eventLodgingAssignment.findFirst({ where: { id: row.sourceAssignmentId, eventId, cancelledAt: null }, select: { id: true } })
            : null;
          if (!stillCurrent) {
            try {
              link = await resolveRoomLink(tx, eventId, holderOf(row), undefined, at, "MANUAL");
            } catch (error) {
              if (!(error instanceof AssetError)) throw error;
              reject("REPLACEMENT_INVALID", `The replacement: ${error.message}`, names);
              continue;
            }
          }
        }
        usedReplacements.add(nextAsset.id);
        replacement = { assetId: nextAsset.id, identifier: nextAsset.identifier, serialized: true, link };
      }

      plans.push({
        index, row, outcome: item.outcome, quantity: sized.quantity, remainder: sized.remainder,
        condition: item.outcome === "RETURNED" ? item.condition ?? null : item.outcome === "DAMAGED" ? "DAMAGED" : null,
        note: item.note ?? "Returned at check-out", evidenceRef: item.evidenceRef ?? null, itemKey: itemKeys[index] ?? null, at, replacement,
        asset: { id: asset.id, identifier: asset.identifier, typeName: asset.assetType.name, mode: asset.assetType.mode as AssetMode, quantityTotal: asset.quantityTotal },
      });
      results.push({ ...base, ...names, status: item.outcome, issuanceId: row.id, quantity: sized.quantity, ...(sized.remainder > 0 ? { remainingQuantity: sized.remainder } : {}), ...(replacement ? { replacementIdentifier: replacement.identifier } : {}) });
    }

    for (const plan of plans) {
      const { row } = plan;
      // A lost or damaged unit of a lot comes off the lot when the lot can spare it; the change is recorded on the history row
      // so a later correction reverses exactly that.
      let stockDelta = 0;
      if (plan.asset.mode !== "SERIALIZED" && plan.outcome !== "RETURNED") {
        const heldNow = (await tx.assetIssuance.aggregate({ where: { assetId: row.assetId, endedAt: null }, _sum: { quantity: true } }))._sum.quantity ?? 0;
        const total = (await tx.issuedAsset.findUniqueOrThrow({ where: { id: plan.asset.id }, select: { quantityTotal: true } })).quantityTotal;
        const next = total - plan.quantity;
        if (next >= 1 && next >= heldNow - row.quantity + plan.remainder) stockDelta = -plan.quantity;
      }
      plan.stockDelta = stockDelta;
      // End first, so the freed quantity is visible to the remainder's own checks (the database sums open quantities).
      await endIssuance(tx, row, {
        actorUserId, endReason: plan.outcome, historyType: plan.outcome, reason: plan.note, entryMethod: input.entryMethod,
        relatedIssuanceId: null, at: plan.at, endQuantity: plan.quantity, idempotencyKey: plan.itemKey, evidenceRef: plan.evidenceRef, condition: plan.condition, stockDelta,
      });
      const remainderId = plan.remainder > 0 ? await startRemainder(tx, plan, actorUserId, input.entryMethod) : null;
      let replacementId: string | null = null;
      if (plan.replacement) {
        const replacementRow = await writeNewIssuance(tx, {
          eventId, assetId: plan.replacement.assetId, serialized: true, quantity: 1, holder: holderOf(row), link: plan.replacement.link,
          purpose: row.purpose, expectedReturnAt: row.expectedReturnAt && row.expectedReturnAt >= plan.at ? row.expectedReturnAt : null, issuedAt: plan.at,
          actorUserId, entryMethod: input.entryMethod, idempotencyKey: plan.itemKey ? `${plan.itemKey}:r` : null, previousIssuanceId: row.id,
          historyType: "REPLACED_IN", reason: plan.note,
        });
        replacementId = replacementRow.id;
        results[results.findIndex((result) => result.index === plan.index)]!.replacementIssuanceId = replacementId;
      }
      if (remainderId) await inheritDepositCover(tx, eventId, row.id, remainderId);
      if (replacementId) await inheritDepositCover(tx, eventId, row.id, replacementId);
      await updateStock(tx, plan);
    }

    const count = (status: ReturnItemResult["status"]) => results.filter((result) => result.status === status).length;
    if (plans.length > 0) {
      await writeAuditLog({
        eventId, actorUserId, action: "ASSET_RETURN_RECORDED", entityType: "AssetIssuance", entityId: plans[0]!.row.id,
        summary: `Recorded ${plans.length} item outcome${plans.length === 1 ? "" : "s"} at check-out.`,
        metadata: {
          entryMethod: input.entryMethod, returned: count("RETURNED"), lost: count("LOST"), damaged: count("DAMAGED"), rejected: count("REJECTED"),
          assetIds: plans.map((plan) => plan.asset.id).slice(0, 50),
        },
      }, tx);
    }
    return {
      returned: count("RETURNED"), lost: count("LOST"), damaged: count("DAMAGED"),
      duplicates: results.filter((result) => result.status === "DUPLICATE" || result.status === "REPLAYED").length,
      rejected: count("REJECTED"),
      items: results.sort((a, b) => a.index - b.index),
    };
  });
}

/** The part of a lot that stays out after a partial outcome: a new issuance that continues the old one (same holder and room). */
async function startRemainder(tx: Tx, plan: Plan, actorUserId: string, entryMethod: "MANUAL" | "SCAN" | "OFFLINE") {
  const { row } = plan;
  const created = await writeNewIssuance(tx, {
    eventId: row.eventId, assetId: row.assetId, serialized: false, quantity: plan.remainder, holder: holderOf(row),
    link: { roomUnitId: row.roomUnitId, sourceAssignmentId: row.sourceAssignmentId },
    purpose: row.purpose, expectedReturnAt: row.expectedReturnAt && row.expectedReturnAt >= plan.at ? row.expectedReturnAt : null, issuedAt: plan.at,
    actorUserId, entryMethod, idempotencyKey: null, previousIssuanceId: row.id, historyType: "REMAINDER_ISSUED", reason: "The rest of a partial return stays out.",
  });
  return created.id;
}

/**
 * What the outcome does to the stock record: a returned item may change condition; a lost or damaged numbered item is
 * held out of stock; a lost or damaged unit of a lot comes off the lot's total when the lot can spare it.
 */
async function updateStock(tx: Tx, plan: Plan) {
  const after = stockAfterReturn(plan.outcome, plan.condition ?? undefined);
  if (plan.asset.mode === "SERIALIZED") {
    const data: Prisma.IssuedAssetUpdateInput = {};
    if (after.condition) data.condition = after.condition;
    if (after.unavailable) data.availability = "UNAVAILABLE";
    if (Object.keys(data).length > 0) await tx.issuedAsset.update({ where: { id: plan.asset.id }, data });
    return;
  }
  if (plan.outcome === "RETURNED" || !plan.stockDelta) return;
  await tx.issuedAsset.update({ where: { id: plan.asset.id }, data: { quantityTotal: { increment: plan.stockDelta } } });
}
