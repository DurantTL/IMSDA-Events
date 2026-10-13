import "server-only";

import { getPrisma } from "@/lib/prisma";
import { toCsv } from "@/modules/reporting/csv";
import {
  applyOutcomeCorrections,
  chargeCategoryLabels,
  decideDepositOutcome,
  depositHeldCents,
  formatCents,
  reconcileUnits,
  returnOutcomeLabels,
  unitCountsFromHistory,
  type ChargeCategory,
  type UnitCounts,
} from "@/modules/issued-assets/returns-domain";
import { coverInputs, fateOf, loadChargedIssuances, loadCorrectionRows } from "@/modules/issued-assets/corrections";
import { listFacilityIssues, type FacilityIssueRow } from "@/modules/issued-assets/returns-view";
import { describeIssuances, type IssuanceRow } from "@/modules/issued-assets/view";

/**
 * The issued-asset closeout (#214): what is still out, lost, damaged, charged, waived and held, the facility issues that
 * are still open, and every exception that needs a person. It reads; it never charges, waives, settles or releases
 * anything. A financial closeout consumes `exceptions` (and `unresolvedCount`) as the list of asset and facility items
 * to resolve first, and resolving them stays a human decision.
 */

type Client = ReturnType<typeof getPrisma>;

/** Rows a section lists before it says it is cut short (never silently). */
export const CLOSEOUT_ROW_LIMIT = 2000;

export type CloseoutRow = IssuanceRow & { deskAttendeeId: string | null; overdue: boolean };

export type ChargeRow = {
  entryId: string;
  issuanceId: string;
  identifier: string;
  typeName: string;
  holderLabel: string;
  deskAttendeeId: string | null;
  category: ChargeCategory;
  amountCents: number;
  posted: boolean;
  reason: string;
  actorName: string;
  at: string;
  state: "CHARGED" | "WAIVED";
  waiver: null | { reason: string; actorName: string; at: string };
};

export type DepositRow = {
  entryId: string;
  typeName: string;
  holderLabel: string;
  deskAttendeeId: string | null;
  amountCents: number;
  takenAt: string;
  takenByName: string;
  state: "HELD" | "HANDED_BACK" | "PARTLY_HANDED_BACK" | "PARTLY_KEPT" | "KEPT";
  /** Handed back at settling, plus anything handed back later after a found item. */
  refundCents: number;
  /** Kept at settling, less what was handed back later. */
  keepCents: number;
  /** Of the kept money, what was handed back later. */
  lateHandedBackCents: number;
  /** Of the kept money, what is still held: not handed back and not counted against a posted, unwaived charge. A waiver restores it. */
  stillHeldCents: number;
  covered: number;
  stillOut: number;
  /** Held, and every covered item is accounted for: ready to settle at the desk. */
  readyToSettle: boolean;
};

export const exceptionCodes = [
  "OUTSTANDING_ITEM",
  "REPLACED_UNACCOUNTED",
  "UNCHARGED_LOSS",
  "DEPOSIT_UNSETTLED",
  "CORRECTED_WITH_DEPOSIT",
  "CORRECTION_NEEDS_REVIEW",
  "WAIVED_ON_INACTIVE_REGISTRATION",
  "WAIVED_AFTER_REFUND",
  "FACILITY_OPEN",
  "BLOCK_ON_FINISHED_ISSUE",
  "RECONCILIATION_MISMATCH",
] as const;
export type ExceptionCode = (typeof exceptionCodes)[number];

export const exceptionLabels: Record<ExceptionCode, string> = {
  OUTSTANDING_ITEM: "Still out",
  REPLACED_UNACCOUNTED: "Replaced, original not accounted for",
  UNCHARGED_LOSS: "Lost or damaged, nothing charged, waived or kept",
  DEPOSIT_UNSETTLED: "Cash deposit not settled",
  CORRECTED_WITH_DEPOSIT: "Withdrawn as an error but a deposit is open",
  CORRECTION_NEEDS_REVIEW: "Outcome corrected after money was recorded",
  WAIVED_ON_INACTIVE_REGISTRATION: "Waived after cancellation: the line is still on the registration total",
  WAIVED_AFTER_REFUND: "Charge waived after the deposit was refunded for it",
  FACILITY_OPEN: "Facility issue unresolved",
  BLOCK_ON_FINISHED_ISSUE: "Resolved issue still blocks a room",
  RECONCILIATION_MISMATCH: "Counts do not reconcile",
};

export type ExceptionRow = {
  code: ExceptionCode;
  label: string;
  subject: string;
  detail: string;
  holderLabel: string | null;
  amountCents: number | null;
  deskAttendeeId: string | null;
  refId: string;
  /** For an exception about a deposit: the deposit entry, so cash handed back after a correction can be recorded against it. */
  depositId?: string | null;
};

export type TypeReconciliation = UnitCounts & { typeId: string; typeName: string; difference: number; balanced: boolean };

export type CloseoutReport = {
  generatedAt: string;
  /** A section was cut at `CLOSEOUT_ROW_LIMIT` rows. */
  truncated: boolean;
  types: TypeReconciliation[];
  money: { depositsReceivedCents: number; depositsHandedBackCents: number; depositsKeptCents: number; depositsHeldCents: number; chargedCents: number; waivedCents: number; netChargedCents: number };
  outstanding: CloseoutRow[];
  lost: CloseoutRow[];
  damaged: CloseoutRow[];
  charges: ChargeRow[];
  deposits: DepositRow[];
  facility: FacilityIssueRow[];
  exceptions: ExceptionRow[];
  unresolvedCount: number;
};

export async function getCloseoutReport(eventId: string, now: Date = new Date(), client: Client = getPrisma()): Promise<CloseoutReport> {
  const limit = CLOSEOUT_ROW_LIMIT + 1;
  const corrections = await loadCorrectionRows(client, eventId);
  const correctedIds = [...corrections.keys()];
  /** A review (money permission, a reason) clears exactly the exception it names, raised by exactly the entry it names. */
  const reviewedFor = (issuanceId: string, code: string, triggerId: string) =>
    (corrections.get(issuanceId) ?? []).some((entry) => entry.type === "EXCEPTION_REVIEWED" && entry.reviewedCode === code && entry.reviewedRefId === triggerId);
  const [types, assets, openRows, outcomeRows, replacedRows, correctedRows, ledger, historySums, openSums, facilityOpen, finishedWithBlock] = await Promise.all([
    client.issuedAssetType.findMany({ where: { eventId }, orderBy: { name: "asc" } }),
    client.issuedAsset.findMany({ where: { eventId }, select: { id: true, assetTypeId: true } }),
    client.assetIssuance.findMany({ where: { eventId, endedAt: null }, orderBy: { issuedAt: "asc" }, take: limit }),
    client.assetIssuance.findMany({ where: { eventId, OR: [{ endReason: { in: ["LOST", "DAMAGED"] } }, { id: { in: correctedIds } }] }, orderBy: { endedAt: "desc" }, take: limit }),
    client.assetIssuance.findMany({ where: { eventId, endReason: "REPLACED" }, orderBy: { endedAt: "desc" }, take: limit }),
    client.assetIssuance.findMany({ where: { eventId, endReason: "CORRECTED", deposits: { some: {} } }, orderBy: { endedAt: "desc" }, take: limit }),
    client.assetLedgerEntry.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, take: limit * 2 }),
    client.assetIssuanceHistory.groupBy({ by: ["assetId", "type"], where: { eventId }, _sum: { quantity: true } }),
    client.assetIssuance.groupBy({ by: ["assetId"], where: { eventId, endedAt: null }, _sum: { quantity: true } }),
    listFacilityIssues(eventId, { open: true }, client),
    client.facilityIssue.findMany({ where: { eventId, status: { in: ["RESOLVED", "DISMISSED"] }, hold: { releasedAt: null } }, select: { id: true, title: true, holdId: true } }),
  ]);
  const truncated = [openRows, outcomeRows, replacedRows, correctedRows].some((rows) => rows.length > CLOSEOUT_ROW_LIMIT) || ledger.length > CLOSEOUT_ROW_LIMIT * 2;
  const cap = <T,>(rows: T[]) => rows.slice(0, CLOSEOUT_ROW_LIMIT);

  // Deposits with their covered issuances, and the issuances charges point at.
  const deposits = ledger.filter((entry) => entry.kind === "DEPOSIT_RECEIVED");
  const depositIds = deposits.map((entry) => entry.id);
  const covers = depositIds.length === 0 ? [] : await client.assetDepositCover.findMany({ where: { eventId, depositEntryId: { in: depositIds } } });
  const coverIssuanceIds = covers.map((cover) => cover.issuanceId);
  const coveredRows = coverIssuanceIds.length === 0 ? [] : await client.assetIssuance.findMany({ where: { eventId, id: { in: coverIssuanceIds } } });
  const chargeEntries = ledger.filter((entry) => entry.kind === "CHARGE");
  const chargeIssuanceIds = [...new Set(chargeEntries.flatMap((entry) => (entry.issuanceId ? [entry.issuanceId] : [])))];
  const chargeIssuances = chargeIssuanceIds.length === 0 ? [] : await client.assetIssuance.findMany({ where: { eventId, id: { in: chargeIssuanceIds } } });

  const everyRow = new Map([...openRows, ...outcomeRows, ...replacedRows, ...correctedRows, ...coveredRows, ...chargeIssuances].map((row) => [row.id, row]));
  const chargedNow = await loadChargedIssuances(client, eventId, [...everyRow.keys()]);
  const described = new Map((await describeIssuances(client, eventId, [...everyRow.values()])).map((row) => [row.id, row]));

  // Where to send staff for a holder: an attendee holder directly, a registration through its first attendee.
  const registrationIds = [...new Set([...described.values()].flatMap((row) => (row.attendeeId === null && row.registrationId ? [row.registrationId] : [])))];
  const firstAttendees = registrationIds.length === 0 ? [] : await client.registrationAttendee.findMany({ where: { eventId, registrationId: { in: registrationIds } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, registrationId: true } });
  const firstOfRegistration = new Map<string, string>();
  for (const row of firstAttendees) if (!firstOfRegistration.has(row.registrationId)) firstOfRegistration.set(row.registrationId, row.id);
  const deskAttendee = (row: IssuanceRow | undefined) => (row ? row.attendeeId ?? (row.registrationId ? firstOfRegistration.get(row.registrationId) ?? null : null) : null);
  const toRow = (row: { id: string }): CloseoutRow | null => {
    const found = described.get(row.id);
    if (!found) return null;
    return { ...found, deskAttendeeId: deskAttendee(found), overdue: found.open && found.expectedReturnAt !== null && new Date(found.expectedReturnAt) < now };
  };
  const rowsOf = (rows: Array<{ id: string }>) => cap(rows).flatMap((row) => { const found = toRow(row); return found ? [found] : []; });
  const effectiveOf = (row: { id: string; endedAt: Date | null; endReason: string | null }) => fateOf(row, corrections.get(row.id));
  /** A lost or damaged row shows its effective fate and the quantity it covers (a lot may be lost in part). */
  const outcomeRowsOf = (fate: "LOST" | "DAMAGED") => cap(outcomeRows.filter((row) => effectiveOf(row).endReason === fate)).flatMap((row) => {
    const found = toRow(row);
    return found ? [{ ...found, quantity: row.endQuantity ?? row.quantity, endReason: fate }] : [];
  });

  const outstanding = rowsOf(openRows);
  const lost = outcomeRowsOf("LOST");
  const damaged = outcomeRowsOf("DAMAGED");

  // Charges with their waivers.
  const waiverByCharge = new Map(ledger.filter((entry) => entry.kind === "WAIVER").map((entry) => [entry.waivesEntryId!, entry]));
  const charges: ChargeRow[] = cap(chargeEntries).map((entry) => {
    const issuance = entry.issuanceId ? described.get(entry.issuanceId) : undefined;
    const waiver = waiverByCharge.get(entry.id);
    return {
      entryId: entry.id, issuanceId: entry.issuanceId ?? "", identifier: issuance?.identifier ?? "", typeName: issuance?.typeName ?? "", holderLabel: issuance?.holderLabel ?? "",
      deskAttendeeId: deskAttendee(issuance), category: entry.chargeCategory!, amountCents: entry.amountCents, posted: entry.registrationAdjustmentId !== null, reason: entry.reason,
      actorName: entry.actorNameSnapshot, at: entry.createdAt.toISOString(), state: waiver ? "WAIVED" : "CHARGED",
      waiver: waiver ? { reason: waiver.reason, actorName: waiver.actorNameSnapshot, at: waiver.createdAt.toISOString() } : null,
    };
  });

  // Deposits.
  const typeById = new Map(types.map((type) => [type.id, type]));
  const settlementsByDeposit = new Map<string, typeof ledger>();
  for (const entry of ledger) if (entry.depositEntryId) settlementsByDeposit.set(entry.depositEntryId, [...(settlementsByDeposit.get(entry.depositEntryId) ?? []), entry]);
  const coversByDeposit = new Map<string, typeof coveredRows>();
  const coveredById = new Map(coveredRows.map((row) => [row.id, row]));
  for (const cover of covers) {
    const row = coveredById.get(cover.issuanceId);
    if (row) coversByDeposit.set(cover.depositEntryId, [...(coversByDeposit.get(cover.depositEntryId) ?? []), row]);
  }
  const depositRows: DepositRow[] = cap(deposits).map((entry) => {
    const own = coversByDeposit.get(entry.id) ?? [];
    const settlements = settlementsByDeposit.get(entry.id) ?? [];
    const sum = (kind: string) => settlements.filter((row) => row.kind === kind).reduce((total, row) => total + row.amountCents, 0);
    const late = sum("DEPOSIT_HANDED_BACK_LATE");
    const refund = sum("DEPOSIT_RETURNED") + late;
    const keep = sum("DEPOSIT_KEPT") - late;
    const ownIds = new Set(own.map((row) => row.id));
    const offsets = chargeEntries.filter((charge) => charge.issuanceId && ownIds.has(charge.issuanceId) && charge.registrationAdjustmentId !== null && !waiverByCharge.has(charge.id)).reduce((total, charge) => total + charge.depositOffsetCents, 0);
    const type = entry.assetTypeId ? typeById.get(entry.assetTypeId) : undefined;
    const outcome = decideDepositOutcome({
      depositCents: entry.amountCents, policy: entry.depositShortfallSnapshot ?? type?.depositShortfall ?? "KEEP_ALL", replacementFeeCents: entry.replacementFeeSnapshotCents ?? type?.replacementFeeCents ?? 0,
      covers: coverInputs(own, corrections, chargedNow),
    });
    const first = own[0] ? described.get(own[0].id) : undefined;
    return {
      entryId: entry.id, typeName: type?.name ?? "", holderLabel: first?.holderLabel ?? "", deskAttendeeId: deskAttendee(first), amountCents: entry.amountCents,
      takenAt: entry.createdAt.toISOString(), takenByName: entry.actorNameSnapshot,
      state: settlements.length === 0 ? "HELD" : keep === 0 ? "HANDED_BACK" : late > 0 ? "PARTLY_HANDED_BACK" : refund === 0 ? "KEPT" : "PARTLY_KEPT",
      refundCents: refund, keepCents: keep, lateHandedBackCents: late,
      stillHeldCents: depositHeldCents({ keptCents: sum("DEPOSIT_KEPT"), lateCents: late, offsetCents: offsets }), covered: own.length, stillOut: own.filter((row) => !row.endedAt).length,
      readyToSettle: settlements.length === 0 && outcome.ok,
    };
  });

  // Reconciliation per kind of item: every unit that went out is out, back, lost, damaged, withdrawn or an unaccounted original.
  const typeOfAsset = new Map(assets.map((asset) => [asset.id, asset.assetTypeId]));
  const reconciliation: TypeReconciliation[] = types.map((type) => {
    const rows = historySums.filter((row) => typeOfAsset.get(row.assetId) === type.id).map((row) => ({ type: row.type as string, quantity: row._sum.quantity ?? 0 }));
    const out = openSums.filter((row) => typeOfAsset.get(row.assetId) === type.id).reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
    const steps = [...corrections.entries()].flatMap(([id, entries]) => (typeOfAsset.get(entries[0]!.assetId) === type.id ? fateOf({ endedAt: new Date(), endReason: everyRow.get(id)?.endReason ?? null }, entries).steps : []));
    const counts = applyOutcomeCorrections(unitCountsFromHistory(rows, out), steps);
    const result = reconcileUnits(counts);
    return { typeId: type.id, typeName: type.name, ...counts, difference: result.difference, balanced: result.balanced };
  });

  // Money.
  const sumOf = (kind: string) => ledger.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amountCents, 0);
  const charged = sumOf("CHARGE");
  const waived = sumOf("WAIVER");
  const lateBack = sumOf("DEPOSIT_HANDED_BACK_LATE");
  const money = {
    depositsReceivedCents: sumOf("DEPOSIT_RECEIVED"), depositsHandedBackCents: sumOf("DEPOSIT_RETURNED") + lateBack, depositsKeptCents: sumOf("DEPOSIT_KEPT") - lateBack,
    depositsHeldCents: sumOf("DEPOSIT_RECEIVED") - sumOf("DEPOSIT_RETURNED") - sumOf("DEPOSIT_KEPT"),
    chargedCents: charged, waivedCents: waived, netChargedCents: charged - waived,
  };

  // Exceptions: everything a person still has to resolve.
  const exceptions: ExceptionRow[] = [];
  const subject = (row: IssuanceRow | undefined) => (row ? `${row.identifier} (${row.typeName})` : "");
  for (const row of outstanding) {
    exceptions.push({ code: "OUTSTANDING_ITEM", label: exceptionLabels.OUTSTANDING_ITEM, subject: subject(row), detail: `${row.quantity > 1 ? `${row.quantity} ` : ""}out since ${row.issuedAt.slice(0, 10)}${row.overdue ? ", past its expected return" : ""}`, holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
  }
  for (const row of rowsOf(replacedRows.filter((entry) => { const fate = effectiveOf(entry); return fate.endReason === "REPLACED"; }))) {
    exceptions.push({ code: "REPLACED_UNACCOUNTED", label: exceptionLabels.REPLACED_UNACCOUNTED, subject: subject(row), detail: "It was replaced without recording whether the original came back. Record whether it was returned, lost or damaged, or write it off, with a reason.", holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
  }
  const chargedIssuances = new Set(chargeEntries.map((entry) => entry.issuanceId));
  // A loss is dealt with when it was charged (even if waived), its cash deposit was settled, or finance wrote it off.
  const settledDepositIssuances = new Set<string>();
  for (const deposit of deposits) {
    if ((settlementsByDeposit.get(deposit.id) ?? []).length > 0) for (const row of coversByDeposit.get(deposit.id) ?? []) settledDepositIssuances.add(row.id);
  }
  for (const row of [...lost, ...damaged]) {
    if (chargedIssuances.has(row.id) || settledDepositIssuances.has(row.id) || effectiveOf({ id: row.id, endedAt: row.endedAt ? new Date(row.endedAt) : null, endReason: row.endReason }).writtenOff) continue;
    exceptions.push({ code: "UNCHARGED_LOSS", label: exceptionLabels.UNCHARGED_LOSS, subject: subject(row), detail: `${returnOutcomeLabels[row.endReason === "LOST" ? "LOST" : "DAMAGED"]} ${row.endedAt?.slice(0, 10) ?? ""}. Charge it, settle its deposit, or have finance write it off with a reason.`, holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
  }
  for (const deposit of depositRows.filter((row) => row.state === "HELD")) {
    exceptions.push({ code: "DEPOSIT_UNSETTLED", label: exceptionLabels.DEPOSIT_UNSETTLED, subject: `${formatCents(deposit.amountCents)} ${deposit.typeName} deposit`, detail: deposit.stillOut > 0 ? `${deposit.stillOut} covered item${deposit.stillOut === 1 ? " is" : "s are"} still out.` : deposit.readyToSettle ? "Every covered item is accounted for: ready to settle at the desk." : "Covered items have no recorded outcome.", holderLabel: deposit.holderLabel, amountCents: deposit.amountCents, deskAttendeeId: deposit.deskAttendeeId, refId: deposit.entryId });
  }
  const heldDepositOf = new Map<string, string>();
  for (const cover of covers) heldDepositOf.set(cover.issuanceId, cover.depositEntryId);
  for (const row of rowsOf(correctedRows)) {
    const depositId = heldDepositOf.get(row.id);
    const state = depositRows.find((deposit) => deposit.entryId === depositId)?.state;
    if (state && state !== "HELD") continue;
    exceptions.push({ code: "CORRECTED_WITH_DEPOSIT", label: exceptionLabels.CORRECTED_WITH_DEPOSIT, subject: subject(row), detail: "It was withdrawn as entered in error, but a cash deposit covers it and is not settled. Decide whether the deposit goes back.", holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
  }
  // A corrected outcome never refunds or charges by itself: when money was already recorded on the old fate, staff review it.
  for (const [issuanceId, entries] of corrections) {
    const fate = fateOf({ endedAt: new Date(), endReason: null }, entries);
    if (!fate.corrected) continue;
    const row = described.get(issuanceId);
    if (!row) continue;
    const lastCorrection = entries.filter((entry) => entry.type === "OUTCOME_CORRECTED").slice(-1)[0]!;
    const depositId = heldDepositOf.get(issuanceId);
    const settledAt = depositId ? (settlementsByDeposit.get(depositId) ?? []).map((entry) => entry.createdAt.getTime()).sort((a, b) => a - b)[0] : undefined;
    const settledBefore = settledAt !== undefined && settledAt < lastCorrection.recordedAt.getTime();
    const staleCharge = chargedNow.has(issuanceId) && fate.endReason !== "LOST" && fate.endReason !== "DAMAGED";
    if (!settledBefore && !staleCharge) continue;
    // Cleared by a recorded review (money permission and a reason) or by cash handed back against the deposit after the correction.
    const handedBackAfter = depositId ? (settlementsByDeposit.get(depositId) ?? []).some((entry) => entry.kind === "DEPOSIT_HANDED_BACK_LATE" && entry.createdAt.getTime() > lastCorrection.recordedAt.getTime()) : false;
    if (reviewedFor(issuanceId, "CORRECTION_NEEDS_REVIEW", lastCorrection.id) || handedBackAfter) continue;
    exceptions.push({
      code: "CORRECTION_NEEDS_REVIEW", label: exceptionLabels.CORRECTION_NEEDS_REVIEW, subject: subject(row),
      detail: `Corrected to ${(fate.endReason ?? "").toLowerCase()}: ${settledBefore ? "its cash deposit was settled on the earlier outcome" : "a charge was recorded on the earlier outcome"}. Review whether to refund, waive or charge; nothing was changed automatically.`,
      holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: deskAttendee(row), refId: issuanceId, depositId: settledBefore ? depositId ?? null : null,
    });
  }
  // A waiver that left money behind: the charge line is still on a cancelled registration's total, or the deposit was handed back because of a charge that was then waived (nobody paid for the loss).
  const chargeById = new Map(chargeEntries.map((entry) => [entry.id, entry]));
  const latestWaiver = new Map<string, (typeof ledger)[number]>();
  for (const waiver of ledger.filter((entry) => entry.kind === "WAIVER")) {
    const issuanceId = waiver.waivesEntryId ? chargeById.get(waiver.waivesEntryId)?.issuanceId : null;
    if (issuanceId) latestWaiver.set(issuanceId, waiver);
  }
  for (const waiver of latestWaiver.values()) {
    const charge = waiver.waivesEntryId ? chargeById.get(waiver.waivesEntryId) : undefined;
    const issuanceId = charge?.issuanceId;
    if (!charge || !issuanceId || charge.registrationAdjustmentId === null) continue;
    const row = described.get(issuanceId);
    if (!row) continue;
    if (waiver.registrationAdjustmentId === null && !reviewedFor(issuanceId, "WAIVED_ON_INACTIVE_REGISTRATION", waiver.id)) {
      exceptions.push({ code: "WAIVED_ON_INACTIVE_REGISTRATION", label: exceptionLabels.WAIVED_ON_INACTIVE_REGISTRATION, subject: subject(row), detail: `${formatCents(charge.amountCents)} was waived in the asset ledger, but the registration is not active, so the charge line is still on its total. Review it.`, holderLabel: row.holderLabel, amountCents: charge.amountCents, deskAttendeeId: deskAttendee(row), refId: issuanceId });
    }
    const depositId = heldDepositOf.get(issuanceId);
    const refund = depositId ? (settlementsByDeposit.get(depositId) ?? []).find((entry) => entry.kind === "DEPOSIT_RETURNED") : undefined;
    if (refund && refund.createdAt.getTime() > charge.createdAt.getTime() && waiver.createdAt.getTime() > refund.createdAt.getTime() && !reviewedFor(issuanceId, "WAIVED_AFTER_REFUND", waiver.id)) {
      exceptions.push({ code: "WAIVED_AFTER_REFUND", label: exceptionLabels.WAIVED_AFTER_REFUND, subject: subject(row), detail: `The deposit was handed back because ${formatCents(charge.amountCents)} was charged for this loss, and the charge was then waived: nobody paid for it. Review it.`, holderLabel: row.holderLabel, amountCents: charge.amountCents, deskAttendeeId: deskAttendee(row), refId: issuanceId });
    }
  }
  for (const issue of facilityOpen) {
    exceptions.push({ code: "FACILITY_OPEN", label: exceptionLabels.FACILITY_OPEN, subject: `${issue.targetLabel}: ${issue.title}`, detail: `${issue.severity.toLowerCase()} severity, ${issue.status === "OPEN" ? "open" : "in progress"}${issue.assigneeName ? `, assigned to ${issue.assigneeName}` : ", not assigned"}.`, holderLabel: null, amountCents: null, deskAttendeeId: null, refId: issue.id });
  }
  for (const issue of finishedWithBlock) {
    exceptions.push({ code: "BLOCK_ON_FINISHED_ISSUE", label: exceptionLabels.BLOCK_ON_FINISHED_ISSUE, subject: issue.title, detail: "The issue is closed but its block still takes the room out of availability. Release it in Lodging if the room is usable again.", holderLabel: null, amountCents: null, deskAttendeeId: null, refId: issue.id });
  }
  for (const type of reconciliation.filter((row) => !row.balanced)) {
    exceptions.push({ code: "RECONCILIATION_MISMATCH", label: exceptionLabels.RECONCILIATION_MISMATCH, subject: type.typeName, detail: `${type.inflow} went out but ${type.inflow - type.difference} are accounted for (difference ${type.difference}).`, holderLabel: null, amountCents: null, deskAttendeeId: null, refId: type.typeId });
  }

  return {
    generatedAt: now.toISOString(), truncated, types: reconciliation, money, outstanding, lost, damaged, charges, deposits: depositRows, facility: facilityOpen, exceptions, unresolvedCount: exceptions.length,
  };
}

/** Just the unresolved items, for a financial closeout to list. Reads only: nothing is charged, waived or settled by looking. */
export async function getCloseoutExceptions(eventId: string, client: Client = getPrisma()) {
  const report = await getCloseoutReport(eventId, new Date(), client);
  return { unresolvedCount: report.unresolvedCount, exceptions: report.exceptions };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const closeoutSections = ["summary", "outstanding", "lost", "damaged", "charges", "deposits", "facility", "exceptions"] as const;
export type CloseoutSection = (typeof closeoutSections)[number];

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

/**
 * One section of the closeout as CSV. Every cell goes through the shared `csvCell`, which prefixes a formula trigger
 * (=, +, -, @, tab, return) so a name or a note can never run as a formula in a spreadsheet.
 */
export function closeoutCsv(report: CloseoutReport, section: CloseoutSection): string {
  const issueRows = (rows: CloseoutRow[]) => [
    ["Item", "Kind", "Quantity", "Holder", "Holder type", "Room", "Issued", "Expected back", "Ended", "Note"],
    ...rows.map((row) => [row.identifier, row.typeName, row.quantity, row.holderLabel, row.holderKind, row.roomName ?? "", when(row.issuedAt), when(row.expectedReturnAt), when(row.endedAt), row.endNote ?? ""]),
  ];
  switch (section) {
    case "summary":
      return toCsv([
        ["Kind", "Went out", "Returned", "Lost", "Damaged", "Withdrawn in error", "Replaced originals unaccounted", "Still out", "Difference", "Reconciles"],
        ...report.types.map((row) => [row.typeName, row.inflow, row.returned, row.lost, row.damaged, row.corrected, row.replacedUnaccounted, row.outstanding, row.difference, row.balanced ? "yes" : "NO"]),
        [],
        ["Cash deposits received", formatCents(report.money.depositsReceivedCents)],
        ["Handed back", formatCents(report.money.depositsHandedBackCents)],
        ["Kept", formatCents(report.money.depositsKeptCents)],
        ["Still held", formatCents(report.money.depositsHeldCents)],
        ["Charged", formatCents(report.money.chargedCents)],
        ["Waived", formatCents(report.money.waivedCents)],
        ["Net charged", formatCents(report.money.netChargedCents)],
      ]);
    case "outstanding": return toCsv(issueRows(report.outstanding));
    case "lost": return toCsv(issueRows(report.lost));
    case "damaged": return toCsv(issueRows(report.damaged));
    case "charges":
      return toCsv([
        ["Item", "Kind", "Holder", "Category", "Amount", "State", "Posted to registration", "Reason", "By", "When", "Waiver reason", "Waived by", "Waived when"],
        ...report.charges.map((row) => [row.identifier, row.typeName, row.holderLabel, chargeCategoryLabels[row.category], formatCents(row.amountCents), row.state === "WAIVED" ? "waived" : "charged", row.posted ? "yes" : "no", row.reason, row.actorName, when(row.at), row.waiver?.reason ?? "", row.waiver?.actorName ?? "", when(row.waiver?.at ?? null)]),
      ]);
    case "deposits":
      return toCsv([
        ["Kind", "Holder", "Deposit", "State", "Handed back", "Kept", "Kept, still held", "Items covered", "Still out", "Taken by", "Taken"],
        ...report.deposits.map((row) => [row.typeName, row.holderLabel, formatCents(row.amountCents), row.state.toLowerCase().replaceAll("_", " "), formatCents(row.refundCents), formatCents(row.keepCents), formatCents(row.stillHeldCents), row.covered, row.stillOut, row.takenByName, when(row.takenAt)]),
      ]);
    case "facility":
      return toCsv([
        ["Where", "Problem", "Severity", "Status", "Assigned to", "Source", "Reported", "Block", "Block nights", "Resolution"],
        ...report.facility.map((row) => [row.targetLabel, row.title, row.severity.toLowerCase(), row.status.toLowerCase().replace("_", " "), row.assigneeName ?? "", row.source === "CHECKOUT_INSPECTION" ? "check-out inspection" : "report", when(row.reportedAt), row.block ? (row.block.active ? row.block.kind.toLowerCase() : "released") : "", row.block ? `${row.block.firstNight} to ${row.block.lastNight}` : "", row.resolution ?? ""]),
      ]);
    case "exceptions":
      return toCsv([
        ["Exception", "Item", "Holder", "Amount", "Detail"],
        ...report.exceptions.map((row) => [row.label, row.subject, row.holderLabel ?? "", row.amountCents === null ? "" : formatCents(row.amountCents), row.detail]),
      ]);
  }
}
