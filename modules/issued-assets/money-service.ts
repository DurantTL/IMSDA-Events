import "server-only";

import { writeAuditLog } from "@/modules/audit/audit-service";
import { AssetError } from "@/modules/issued-assets/errors";
import { coverInputs, fateOf, loadChargedIssuances, loadCorrectionRows } from "@/modules/issued-assets/corrections";
import {
  chargeActionSchema,
  decideDepositOutcome,
  depositActionSchema,
  formatCents,
  type DepositOutcome,
} from "@/modules/issued-assets/returns-domain";
import { lockAssets, requireEvent, rowHolderKey, transact, type Tx } from "@/modules/issued-assets/service";
import { sameHolder } from "@/modules/issued-assets/domain";
import { AdjustmentError, postAssetAdjustment } from "@/modules/registrations/adjustments";
import { lateRefundSchema } from "@/modules/issued-assets/returns-domain";

/**
 * Issued assets (#214, slice 2): cash deposits, charges and waivers.
 *
 * Record, don't move money. Every entry is appended to the asset ledger (`AssetLedgerEntry`, in the pattern of the meal
 * ledger) with who, why and when, and nothing is edited or deleted. A cash deposit taken or handed back at the desk is
 * only recorded. A charge can also be posted to the registration through the existing adjustment path (an ASSET line, so it
 * shows in balances); a waiver of a posted charge is the reversing line. No provider is called and no card is refunded:
 * refunds stay a human decision.
 */

const actorNameOf = async (tx: Tx, actorUserId: string) => (await tx.user.findUnique({ where: { id: actorUserId }, select: { displayName: true } }))?.displayName ?? "Staff";

/** The registration an issuance's money belongs to: its own, or the registration of the attendee holding it. */
async function registrationsOf(tx: Tx, rows: ReadonlyArray<{ id: string; registrationId: string | null; attendeeId: string | null }>) {
  const attendeeIds = [...new Set(rows.flatMap((row) => (row.attendeeId ? [row.attendeeId] : [])))];
  const attendees = attendeeIds.length === 0 ? [] : await tx.registrationAttendee.findMany({ where: { id: { in: attendeeIds } }, select: { id: true, registrationId: true } });
  const byAttendee = new Map(attendees.map((row) => [row.id, row.registrationId]));
  return new Map(rows.map((row) => [row.id, row.registrationId ?? (row.attendeeId ? byAttendee.get(row.attendeeId) ?? null : null)]));
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export type DepositRecorded = { depositEntryId: string; amountCents: number; covered: number; replayed: boolean };

/**
 * Records a cash deposit taken at the desk for one holder's open items of one kind (two room keys). The amount is what staff
 * actually took (a $5 to $10 key deposit), not the type's suggestion. Nothing moves: the deposit is a ledger entry plus the
 * issuances it covers. Whatever continues a covered issue later (a replacement, the rest of a lot) is covered too.
 */
export async function recordDeposit(eventId: string, actorUserId: string, rawInput: unknown): Promise<DepositRecorded> {
  const parsed = depositActionSchema.parse(rawInput);
  if (parsed.action !== "record") throw new AssetError("DEPOSIT_COVER_INVALID", "That is not a deposit to record.");
  const input = parsed;
  const ids = [...new Set(input.issuanceIds)];
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    if (input.idempotencyKey) {
      const existing = await tx.assetLedgerEntry.findUnique({ where: { eventId_idempotencyKey: { eventId, idempotencyKey: input.idempotencyKey } }, include: { covers: { select: { issuanceId: true } } } });
      if (existing) {
        const same = existing.kind === "DEPOSIT_RECEIVED" && existing.amountCents === input.amountCents && existing.covers.length === ids.length && existing.covers.every((cover) => ids.includes(cover.issuanceId));
        if (!same) throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different deposit.");
        return { depositEntryId: existing.id, amountCents: existing.amountCents, covered: existing.covers.length, replayed: true };
      }
    }
    const first = await tx.assetIssuance.findMany({ where: { eventId, id: { in: ids } }, select: { assetId: true } });
    if (first.length !== ids.length) throw new AssetError("ISSUANCE_NOT_FOUND", "One of those issues was not found.");
    await lockAssets(tx, eventId, first.map((row) => row.assetId));
    const rows = await tx.assetIssuance.findMany({ where: { eventId, id: { in: ids } }, include: { asset: { include: { assetType: true } }, deposits: true } });
    if (rows.some((row) => row.endedAt)) throw new AssetError("DEPOSIT_COVER_INVALID", "A deposit covers items that are out. One of those has already come back or ended.");
    if (rows.some((row) => row.deposits.length > 0)) throw new AssetError("DEPOSIT_COVER_INVALID", "One of those items is already covered by a deposit.");
    const types = new Set(rows.map((row) => row.asset.assetTypeId));
    if (types.size !== 1) throw new AssetError("DEPOSIT_COVER_INVALID", "One deposit covers one kind of item. Take a separate deposit for each kind.");
    const type = rows[0]!.asset.assetType;
    if (type.depositCents <= 0) throw new AssetError("DEPOSIT_NOT_REQUIRED", `${type.name} has no deposit. Set one up in Issued assets first.`);
    const registrations = await registrationsOf(tx, rows);
    const holders = rows.map((row) => rowHolderKey(row));
    const sameHolderAll = holders.every((holder) => sameHolder(holder, holders[0]!));
    const registrationIds = new Set(rows.map((row) => registrations.get(row.id) ?? null));
    if (!sameHolderAll && (registrationIds.size !== 1 || registrationIds.has(null))) {
      throw new AssetError("DEPOSIT_COVER_INVALID", "One deposit covers one holder's items (or one registration's). Those belong to different holders.");
    }
    const registrationId = registrationIds.size === 1 ? [...registrationIds][0] ?? null : null;
    const entry = await tx.assetLedgerEntry.create({
      data: {
        eventId, kind: "DEPOSIT_RECEIVED", amountCents: input.amountCents, assetTypeId: type.id, registrationId, settlement: "CASH_AT_DESK",
        depositShortfallSnapshot: type.depositShortfall, replacementFeeSnapshotCents: type.replacementFeeCents,
        reason: input.reason.trim() || "Cash key deposit taken at check-in", actorUserId, actorNameSnapshot: await actorNameOf(tx, actorUserId), idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await tx.assetDepositCover.createMany({ data: rows.map((row) => ({ eventId, issuanceId: row.id, depositEntryId: entry.id })) });
    await writeAuditLog({
      eventId, actorUserId, action: "ASSET_DEPOSIT_RECORDED", entityType: "AssetLedgerEntry", entityId: entry.id,
      summary: `Recorded a cash deposit of ${formatCents(input.amountCents)} for ${rows.length} item${rows.length === 1 ? "" : "s"}.`,
      metadata: { amountCents: input.amountCents, typeId: type.id, issuanceIds: ids.slice(0, 50), registrationId },
    }, tx);
    return { depositEntryId: entry.id, amountCents: entry.amountCents, covered: rows.length, replayed: false };
  });
}

export type DepositSettled = {
  depositEntryId: string;
  outcome: Extract<DepositOutcome, { ok: true }>["outcome"];
  refundCents: number;
  keepCents: number;
  shortfallCents: number;
  message: string;
  replayed: boolean;
};

/**
 * Settles a cash deposit once every covered item is accounted for: the full deposit is handed back only when every
 * covered item came back in good order, otherwise the type's policy decides what is kept. The server decides the amounts
 * (staff only confirm). It records "handed back" and "kept" entries; the desk hands the cash over, nothing is paid out
 * by this system. A deposit settles once.
 */
export async function settleDeposit(eventId: string, actorUserId: string, rawInput: unknown): Promise<DepositSettled> {
  const parsed = depositActionSchema.parse(rawInput);
  if (parsed.action !== "settle") throw new AssetError("DEPOSIT_NOT_FOUND", "That is not a deposit to settle.");
  const input = parsed;
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    const found = await tx.assetLedgerEntry.findFirst({ where: { id: input.depositEntryId, eventId, kind: "DEPOSIT_RECEIVED" }, include: { covers: { select: { issuanceId: true } } } });
    if (!found) throw new AssetError("DEPOSIT_NOT_FOUND", "That deposit was not found.");
    const coveredIds = found.covers.map((cover) => cover.issuanceId);
    const lockRows = await tx.assetIssuance.findMany({ where: { eventId, id: { in: coveredIds } }, select: { assetId: true } });
    await lockAssets(tx, eventId, lockRows.map((row) => row.assetId));
    const settlements = await tx.assetLedgerEntry.findMany({ where: { eventId, depositEntryId: found.id } });
    if (settlements.length > 0) {
      const keys = input.idempotencyKey ? [`${input.idempotencyKey}:R`, `${input.idempotencyKey}:K`] : [];
      if (!settlements.some((entry) => entry.idempotencyKey && keys.includes(entry.idempotencyKey))) {
        throw new AssetError("DEPOSIT_ALREADY_SETTLED", "That deposit was already settled.", { entries: settlements.map((entry) => ({ kind: entry.kind, amountCents: entry.amountCents })) });
      }
      const refund = settlements.find((entry) => entry.kind === "DEPOSIT_RETURNED")?.amountCents ?? 0;
      const keep = settlements.find((entry) => entry.kind === "DEPOSIT_KEPT")?.amountCents ?? 0;
      return { depositEntryId: found.id, outcome: keep === 0 ? "FULL_REFUND" : refund === 0 ? "KEPT" : "PARTIAL_REFUND", refundCents: refund, keepCents: keep, shortfallCents: 0, message: "Already settled.", replayed: true };
    }
    const rows = await tx.assetIssuance.findMany({ where: { eventId, id: { in: coveredIds } } });
    // Settled by the terms the deposit was taken under, not by the kind as it reads today.
    const type = await tx.issuedAssetType.findFirstOrThrow({ where: { id: found.assetTypeId!, eventId } });
    const corrections = await loadCorrectionRows(tx, eventId, coveredIds);
    const charged = await loadChargedIssuances(tx, eventId, coveredIds);
    const outcome = decideDepositOutcome({
      depositCents: found.amountCents, policy: found.depositShortfallSnapshot ?? type.depositShortfall, replacementFeeCents: found.replacementFeeSnapshotCents ?? type.replacementFeeCents,
      covers: coverInputs(rows, corrections, charged),
    });
    if (!outcome.ok) throw new AssetError("DEPOSIT_UNRESOLVED", outcome.message, { unresolved: outcome.unresolved });
    const note = input.note?.trim();
    const reason = `${outcome.message}${note ? ` Note: ${note}` : ""}`.slice(0, 500);
    const name = await actorNameOf(tx, actorUserId);
    const common = { eventId, assetTypeId: found.assetTypeId, registrationId: found.registrationId, depositEntryId: found.id, settlement: "CASH_AT_DESK" as const, reason, actorUserId, actorNameSnapshot: name };
    if (outcome.refundCents > 0) await tx.assetLedgerEntry.create({ data: { ...common, kind: "DEPOSIT_RETURNED", amountCents: outcome.refundCents, idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:R` : null } });
    if (outcome.keepCents > 0) await tx.assetLedgerEntry.create({ data: { ...common, kind: "DEPOSIT_KEPT", amountCents: outcome.keepCents, idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:K` : null } });
    await writeAuditLog({
      eventId, actorUserId, action: "ASSET_DEPOSIT_SETTLED", entityType: "AssetLedgerEntry", entityId: found.id,
      summary: `Settled a cash deposit: ${formatCents(outcome.refundCents)} handed back, ${formatCents(outcome.keepCents)} kept.`,
      metadata: { outcome: outcome.outcome, refundCents: outcome.refundCents, keepCents: outcome.keepCents, missing: outcome.missing, damaged: outcome.damaged },
    }, tx);
    return { depositEntryId: found.id, outcome: outcome.outcome, refundCents: outcome.refundCents, keepCents: outcome.keepCents, shortfallCents: outcome.shortfallCents, message: outcome.message, replayed: false };
  });
}

// ---------------------------------------------------------------------------
// Charges and waivers
// ---------------------------------------------------------------------------

export type ChargeRecorded = { chargeEntryId: string; amountCents: number; /** What a deposit that already kept money for the loss covered; the charge is the rest. */ offsetCents: number; posted: boolean; replayed: boolean };

function adjustmentFailure(error: unknown): never {
  if (error instanceof AdjustmentError) throw new AssetError("CHARGE_NOT_POSTABLE", error.message);
  throw error;
}

/**
 * Records a charge for a lost or damaged item (or another charge) and, when asked, posts it to the registration as an
 * append-only ASSET adjustment line so it shows in the balance. Check-in staff may record only the kind's configured
 * replacement fee for a lost or damaged numbered item; any other charge needs finance (MANAGE_FINANCE) or event
 * administration (CONFIGURE_EVENT). A charge is never created automatically and never collected: the guest pays through
 * the usual balance, and a refund is a human decision.
 */
export async function postCharge(eventId: string, actorUserId: string, rawInput: unknown, options: { canManageMoney: boolean }): Promise<ChargeRecorded> {
  const parsed = chargeActionSchema.parse(rawInput);
  if (parsed.action !== "charge") throw new AssetError("CHARGE_NOT_FOUND", "That is not a charge to record.");
  const input = parsed;
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    if (input.idempotencyKey) {
      const existing = await tx.assetLedgerEntry.findUnique({ where: { eventId_idempotencyKey: { eventId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.kind !== "CHARGE" || existing.issuanceId !== input.issuanceId || existing.chargeCategory !== input.category || existing.amountCents + existing.depositOffsetCents !== input.amountCents) {
          throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different charge.");
        }
        return { chargeEntryId: existing.id, amountCents: existing.amountCents, offsetCents: existing.depositOffsetCents, posted: existing.registrationAdjustmentId !== null, replayed: true };
      }
    }
    const first = await tx.assetIssuance.findFirst({ where: { id: input.issuanceId, eventId }, select: { assetId: true } });
    if (!first) throw new AssetError("ISSUANCE_NOT_FOUND", "That issue was not found.");
    await lockAssets(tx, eventId, [first.assetId]);
    const row = await tx.assetIssuance.findFirstOrThrow({ where: { id: input.issuanceId, eventId }, include: { asset: { include: { assetType: true } } } });
    const effective = fateOf(row, (await loadCorrectionRows(tx, eventId, [row.id])).get(row.id)).endReason;
    const lostOrDamaged = effective === "LOST" || effective === "DAMAGED";
    if (input.category !== "OTHER" && !lostOrDamaged) throw new AssetError("CHARGE_NOT_ALLOWED", "A replacement or damage charge is for an item recorded as lost or damaged.");
    if (row.endReason === "CORRECTED") throw new AssetError("CHARGE_NOT_ALLOWED", "That issue was withdrawn as entered in error, so it cannot be charged.");
    const type = row.asset.assetType;
    // A charge that is only recorded is never collected by anything, and it must not be mistaken for one that is: check-in
    // staff may only post the standard fee to the registration; recording a charge without posting is a money decision.
    if (!input.post && !options.canManageMoney) {
      throw new AssetError("MONEY_PERMISSION_REQUIRED", "Check-in staff can only post the standard replacement fee to the registration. Recording a charge without posting it needs finance or an event administrator.");
    }
    if (!options.canManageMoney) {
      const quantity = row.endQuantity ?? row.quantity;
      const standard = input.category === "REPLACEMENT" && lostOrDamaged && type.replacementFeeCents > 0 && input.amountCents === type.replacementFeeCents * quantity;
      if (!standard) {
        throw new AssetError("MONEY_PERMISSION_REQUIRED", type.replacementFeeCents > 0
          ? `Check-in staff can record only the standard replacement fee (${formatCents(type.replacementFeeCents * quantity)}). Another amount needs finance or an event administrator.`
          : "This kind has no standard replacement fee. A charge needs finance or an event administrator.");
      }
    }
    // A deposit that already kept money for this loss must not be taken again as a charge: only a money manager, with
    // a confirmation, may charge the part above what the deposit kept.
    let offset = 0;
    if (input.category !== "OTHER" && lostOrDamaged) {
      const cover = await tx.assetDepositCover.findUnique({ where: { issuanceId: row.id } });
      if (cover) {
        const settlements = await tx.assetLedgerEntry.findMany({ where: { eventId, depositEntryId: cover.depositEntryId, kind: "DEPOSIT_KEPT" }, select: { amountCents: true } });
        const kept = settlements.reduce((sum, entry) => sum + entry.amountCents, 0);
        if (kept > 0) {
          const siblings = await tx.assetDepositCover.findMany({ where: { depositEntryId: cover.depositEntryId }, select: { issuanceId: true } });
          const used = (await tx.assetLedgerEntry.aggregate({
            where: { eventId, kind: "CHARGE", issuanceId: { in: siblings.map((entry) => entry.issuanceId) }, waivedBy: { none: {} } }, _sum: { depositOffsetCents: true },
          }))._sum.depositOffsetCents ?? 0;
          const remaining = Math.max(0, kept - used);
          if (remaining > 0) {
            if (!options.canManageMoney || !input.confirmKeptDeposit) {
              throw new AssetError("DEPOSIT_ALREADY_KEPT", `The cash deposit already kept ${formatCents(remaining)} for lost or damaged items, so charging the full amount would take the guest's money twice. ${options.canManageMoney ? "Confirm to charge only the part above what the deposit kept." : "Finance or an event administrator can charge only the part above it."}`);
            }
            offset = Math.min(input.amountCents, remaining);
            if (offset >= input.amountCents) throw new AssetError("CHARGE_NOT_ALLOWED", "The deposit that was kept already covers that amount. Nothing more is charged.");
          }
        }
      }
    }
    const chargeCents = input.amountCents - offset;
    const duplicate = await tx.assetLedgerEntry.findFirst({ where: { eventId, issuanceId: row.id, kind: "CHARGE", chargeCategory: input.category }, select: { id: true } });
    if (duplicate) throw new AssetError("CHARGE_EXISTS", "That item already has a charge of this kind. If it was a mistake, waive it.");
    const registrationId = (await registrationsOf(tx, [row])).get(row.id) ?? null;
    let adjustmentId: string | null = null;
    if (input.post) {
      if (!registrationId) throw new AssetError("CHARGE_NOT_POSTABLE", "This holder has no registration to post to. Record the charge without posting.");
      try {
        adjustmentId = await postAssetAdjustment(tx, { eventId, registrationId, actorUserId, amountCents: chargeCents, reason: `${row.asset.identifier}: ${input.reason}`.slice(0, 500) });
      } catch (error) {
        adjustmentFailure(error);
      }
    }
    const entry = await tx.assetLedgerEntry.create({
      data: {
        eventId, kind: "CHARGE", amountCents: chargeCents, depositOffsetCents: offset, assetTypeId: type.id, issuanceId: row.id, registrationId, chargeCategory: input.category,
        settlement: adjustmentId ? "REGISTRATION_ADJUSTMENT" : "RECORD_ONLY", registrationAdjustmentId: adjustmentId, reason: input.reason,
        actorUserId, actorNameSnapshot: await actorNameOf(tx, actorUserId), idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await writeAuditLog({
      eventId, actorUserId, action: "ASSET_CHARGE_RECORDED", entityType: "AssetLedgerEntry", entityId: entry.id,
      summary: `Recorded a ${input.category.toLowerCase()} charge of ${formatCents(chargeCents)}${adjustmentId ? " and posted it to the registration" : ""}.`,
      metadata: { amountCents: chargeCents, depositOffsetCents: offset, category: input.category, issuanceId: row.id, posted: adjustmentId !== null, registrationId },
    }, tx);
    return { chargeEntryId: entry.id, amountCents: entry.amountCents, offsetCents: offset, posted: adjustmentId !== null, replayed: false };
  });
}

export type WaiverRecorded = { waiverEntryId: string; chargeEntryId: string; amountCents: number; reversedOnRegistration: boolean; /** The registration is no longer active, so the waiver is recorded here and the charge line on it is left as it is. */ registrationInactive: boolean; replayed: boolean };

/**
 * Waives a charge in full: an approved decision with a required reason, by finance (MANAGE_FINANCE) or an event
 * administrator (CONFIGURE_EVENT). The charge stays on record. A charge posted to the registration is cancelled by a
 * reversing ASSET line (refused when the guest already paid it: record the refund first, which is a human decision).
 */
export async function waiveCharge(eventId: string, actorUserId: string, rawInput: unknown, options: { canManageMoney: boolean }): Promise<WaiverRecorded> {
  const parsed = chargeActionSchema.parse(rawInput);
  if (parsed.action !== "waive") throw new AssetError("CHARGE_NOT_FOUND", "That is not a waiver.");
  const input = parsed;
  if (!options.canManageMoney) throw new AssetError("MONEY_PERMISSION_REQUIRED", "Waiving a charge needs finance (MANAGE_FINANCE) or an event administrator (CONFIGURE_EVENT).");
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    if (input.idempotencyKey) {
      const existing = await tx.assetLedgerEntry.findUnique({ where: { eventId_idempotencyKey: { eventId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.kind !== "WAIVER" || existing.waivesEntryId !== input.chargeEntryId) throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different waiver.");
        return { waiverEntryId: existing.id, chargeEntryId: input.chargeEntryId, amountCents: existing.amountCents, reversedOnRegistration: existing.registrationAdjustmentId !== null, registrationInactive: false, replayed: true };
      }
    }
    const first = await tx.assetLedgerEntry.findFirst({ where: { id: input.chargeEntryId, eventId, kind: "CHARGE" }, select: { issuanceId: true } });
    if (!first) throw new AssetError("CHARGE_NOT_FOUND", "That charge was not found.");
    const issuance = first.issuanceId ? await tx.assetIssuance.findFirst({ where: { id: first.issuanceId, eventId }, select: { assetId: true } }) : null;
    if (issuance) await lockAssets(tx, eventId, [issuance.assetId]);
    const charge = await tx.assetLedgerEntry.findFirstOrThrow({ where: { id: input.chargeEntryId, eventId, kind: "CHARGE" }, include: { waivedBy: { select: { id: true } } } });
    if (charge.waivedBy.length > 0) throw new AssetError("CHARGE_ALREADY_WAIVED", "That charge was already waived.");
    let reversal: string | null = null;
    let registrationInactive = false;
    if (charge.registrationAdjustmentId) {
      // A cancelled or waitlisted registration takes no adjustment: the waiver is still recorded in the asset ledger, and says so.
      const active = await tx.registration.findFirst({ where: { id: charge.registrationId!, eventId, status: { in: ["SUBMITTED", "CONFIRMED"] } }, select: { id: true } });
      if (!active) {
        registrationInactive = true;
      } else {
        try {
          reversal = await postAssetAdjustment(tx, {
            eventId, registrationId: charge.registrationId!, actorUserId, amountCents: -charge.amountCents,
            reason: `Waived: ${input.reason}`.slice(0, 500), reversesAdjustmentId: charge.registrationAdjustmentId,
          });
        } catch (error) {
          adjustmentFailure(error);
        }
      }
    }
    const entry = await tx.assetLedgerEntry.create({
      data: {
        eventId, kind: "WAIVER", amountCents: charge.amountCents, assetTypeId: charge.assetTypeId, issuanceId: charge.issuanceId, registrationId: charge.registrationId,
        waivesEntryId: charge.id, settlement: reversal ? "REGISTRATION_ADJUSTMENT" : "RECORD_ONLY", registrationAdjustmentId: reversal, reason: registrationInactive ? `${input.reason} (the registration is not active, so no line was reversed on it)`.slice(0, 500) : input.reason,
        actorUserId, actorNameSnapshot: await actorNameOf(tx, actorUserId), idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await writeAuditLog({
      eventId, actorUserId, action: "ASSET_CHARGE_WAIVED", entityType: "AssetLedgerEntry", entityId: entry.id,
      summary: `Waived a charge of ${formatCents(charge.amountCents)}.`,
      metadata: { chargeEntryId: charge.id, amountCents: charge.amountCents, reversedOnRegistration: reversal !== null, registrationInactive },
    }, tx);
    return { waiverEntryId: entry.id, chargeEntryId: charge.id, amountCents: charge.amountCents, reversedOnRegistration: reversal !== null, registrationInactive, replayed: false };
  });
}

export type LateRefundRecorded = { entryId: string; amountCents: number; remainingKeptCents: number; replayed: boolean };

/**
 * Records cash handed back at the desk after a correction showed that something a kept deposit was kept for had come back
 * (a lost key found). It is a ledger entry (who, why, when), never a provider refund, and it is capped at what the deposit
 * kept. Finance or an event administrator only, with a reason. The deposit must already be settled with money kept, and one of
 * the issues it covers must have been corrected.
 */
export async function recordLateDepositRefund(eventId: string, actorUserId: string, rawInput: unknown, options: { canManageMoney: boolean }): Promise<LateRefundRecorded> {
  const input = lateRefundSchema.parse(rawInput);
  if (!options.canManageMoney) throw new AssetError("MONEY_PERMISSION_REQUIRED", "Recording cash handed back after a correction needs finance (MANAGE_FINANCE) or an event administrator (CONFIGURE_EVENT).");
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    if (input.idempotencyKey) {
      const existing = await tx.assetLedgerEntry.findUnique({ where: { eventId_idempotencyKey: { eventId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.kind !== "DEPOSIT_HANDED_BACK_LATE" || existing.depositEntryId !== input.depositEntryId || existing.amountCents !== input.amountCents) {
          throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different hand-back.");
        }
        return { entryId: existing.id, amountCents: existing.amountCents, remainingKeptCents: 0, replayed: true };
      }
    }
    const found = await tx.assetLedgerEntry.findFirst({ where: { id: input.depositEntryId, eventId, kind: "DEPOSIT_RECEIVED" }, include: { covers: { select: { issuanceId: true } } } });
    if (!found) throw new AssetError("DEPOSIT_NOT_FOUND", "That deposit was not found.");
    const coveredIds = found.covers.map((cover) => cover.issuanceId);
    const lockRows = await tx.assetIssuance.findMany({ where: { eventId, id: { in: coveredIds } }, select: { assetId: true } });
    await lockAssets(tx, eventId, lockRows.map((row) => row.assetId));
    const entries = await tx.assetLedgerEntry.findMany({ where: { eventId, depositEntryId: found.id }, select: { kind: true, amountCents: true } });
    const kept = entries.filter((entry) => entry.kind === "DEPOSIT_KEPT").reduce((sum, entry) => sum + entry.amountCents, 0);
    const late = entries.filter((entry) => entry.kind === "DEPOSIT_HANDED_BACK_LATE").reduce((sum, entry) => sum + entry.amountCents, 0);
    if (kept === 0) throw new AssetError("CORRECTION_INVALID", "That deposit kept no money, so there is nothing to hand back after a correction.");
    const corrections = await loadCorrectionRows(tx, eventId, coveredIds);
    if (![...corrections.values()].some((rows) => rows.some((entry) => entry.type === "OUTCOME_CORRECTED"))) {
      throw new AssetError("CORRECTION_INVALID", "None of the items this deposit covers has a corrected outcome, so the kept deposit stands.");
    }
    if (input.amountCents > kept - late) throw new AssetError("CORRECTION_INVALID", `Only ${formatCents(kept - late)} of the kept deposit can still be handed back.`);
    const entry = await tx.assetLedgerEntry.create({
      data: {
        eventId, kind: "DEPOSIT_HANDED_BACK_LATE", amountCents: input.amountCents, assetTypeId: found.assetTypeId, registrationId: found.registrationId, depositEntryId: found.id,
        settlement: "CASH_AT_DESK", reason: input.reason, actorUserId, actorNameSnapshot: await actorNameOf(tx, actorUserId), idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await writeAuditLog({
      eventId, actorUserId, action: "ASSET_DEPOSIT_HANDED_BACK_AFTER_CORRECTION", entityType: "AssetLedgerEntry", entityId: entry.id,
      summary: `Recorded ${formatCents(input.amountCents)} of a kept deposit handed back after a correction.`, metadata: { depositEntryId: found.id, amountCents: input.amountCents },
    }, tx);
    return { entryId: entry.id, amountCents: input.amountCents, remainingKeptCents: kept - late - input.amountCents, replayed: false };
  });
}
