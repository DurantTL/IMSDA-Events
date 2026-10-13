import "server-only";

import { getPrisma } from "@/lib/prisma";
import { toCsv } from "@/modules/reporting/csv";
import {
  chargeCategoryLabels,
  coverStateOf,
  decideDepositOutcome,
  formatCents,
  reconcileUnits,
  returnOutcomeLabels,
  unitCountsFromHistory,
  type ChargeCategory,
  type UnitCounts,
} from "@/modules/issued-assets/returns-domain";
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
  state: "HELD" | "HANDED_BACK" | "PARTLY_KEPT" | "KEPT";
  refundCents: number;
  keepCents: number;
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
  const [types, assets, openRows, outcomeRows, replacedRows, correctedRows, ledger, historySums, openSums, facilityOpen, finishedWithBlock] = await Promise.all([
    client.issuedAssetType.findMany({ where: { eventId }, orderBy: { name: "asc" } }),
    client.issuedAsset.findMany({ where: { eventId }, select: { id: true, assetTypeId: true } }),
    client.assetIssuance.findMany({ where: { eventId, endedAt: null }, orderBy: { issuedAt: "asc" }, take: limit }),
    client.assetIssuance.findMany({ where: { eventId, endReason: { in: ["LOST", "DAMAGED"] } }, orderBy: { endedAt: "desc" }, take: limit }),
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

  const outstanding = rowsOf(openRows);
  const lost = rowsOf(outcomeRows.filter((row) => row.endReason === "LOST"));
  const damaged = rowsOf(outcomeRows.filter((row) => row.endReason === "DAMAGED"));

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
    const refund = settlements.find((row) => row.kind === "DEPOSIT_RETURNED")?.amountCents ?? 0;
    const keep = settlements.find((row) => row.kind === "DEPOSIT_KEPT")?.amountCents ?? 0;
    const type = entry.assetTypeId ? typeById.get(entry.assetTypeId) : undefined;
    const outcome = decideDepositOutcome({
      depositCents: entry.amountCents, policy: type?.depositShortfall ?? "KEEP_ALL", replacementFeeCents: type?.replacementFeeCents ?? 0,
      covers: own.map((row) => ({ state: coverStateOf(row), quantity: row.endQuantity ?? row.quantity })),
    });
    const first = own[0] ? described.get(own[0].id) : undefined;
    return {
      entryId: entry.id, typeName: type?.name ?? "", holderLabel: first?.holderLabel ?? "", deskAttendeeId: deskAttendee(first), amountCents: entry.amountCents,
      takenAt: entry.createdAt.toISOString(), takenByName: entry.actorNameSnapshot,
      state: settlements.length === 0 ? "HELD" : keep === 0 ? "HANDED_BACK" : refund === 0 ? "KEPT" : "PARTLY_KEPT",
      refundCents: refund, keepCents: keep, covered: own.length, stillOut: own.filter((row) => !row.endedAt).length,
      readyToSettle: settlements.length === 0 && outcome.ok,
    };
  });

  // Reconciliation per kind of item: every unit that went out is out, back, lost, damaged, withdrawn or an unaccounted original.
  const typeOfAsset = new Map(assets.map((asset) => [asset.id, asset.assetTypeId]));
  const reconciliation: TypeReconciliation[] = types.map((type) => {
    const rows = historySums.filter((row) => typeOfAsset.get(row.assetId) === type.id).map((row) => ({ type: row.type as string, quantity: row._sum.quantity ?? 0 }));
    const out = openSums.filter((row) => typeOfAsset.get(row.assetId) === type.id).reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
    const counts = unitCountsFromHistory(rows, out);
    const result = reconcileUnits(counts);
    return { typeId: type.id, typeName: type.name, ...counts, difference: result.difference, balanced: result.balanced };
  });

  // Money.
  const sumOf = (kind: string) => ledger.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amountCents, 0);
  const charged = sumOf("CHARGE");
  const waived = sumOf("WAIVER");
  const money = {
    depositsReceivedCents: sumOf("DEPOSIT_RECEIVED"), depositsHandedBackCents: sumOf("DEPOSIT_RETURNED"), depositsKeptCents: sumOf("DEPOSIT_KEPT"),
    depositsHeldCents: sumOf("DEPOSIT_RECEIVED") - sumOf("DEPOSIT_RETURNED") - sumOf("DEPOSIT_KEPT"),
    chargedCents: charged, waivedCents: waived, netChargedCents: charged - waived,
  };

  // Exceptions: everything a person still has to resolve.
  const exceptions: ExceptionRow[] = [];
  const subject = (row: IssuanceRow | undefined) => (row ? `${row.identifier} (${row.typeName})` : "");
  for (const row of outstanding) {
    exceptions.push({ code: "OUTSTANDING_ITEM", label: exceptionLabels.OUTSTANDING_ITEM, subject: subject(row), detail: `${row.quantity > 1 ? `${row.quantity} ` : ""}out since ${row.issuedAt.slice(0, 10)}${row.overdue ? ", past its expected return" : ""}`, holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
  }
  for (const row of rowsOf(replacedRows)) {
    exceptions.push({ code: "REPLACED_UNACCOUNTED", label: exceptionLabels.REPLACED_UNACCOUNTED, subject: subject(row), detail: "It was replaced without recording whether the original came back. Record it as lost or returned from the catalog, or write it off.", holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
  }
  const chargedIssuances = new Set(chargeEntries.map((entry) => entry.issuanceId));
  const keptDepositIssuances = new Set<string>();
  for (const deposit of deposits) {
    if ((settlementsByDeposit.get(deposit.id) ?? []).some((entry) => entry.kind === "DEPOSIT_KEPT")) for (const row of coversByDeposit.get(deposit.id) ?? []) keptDepositIssuances.add(row.id);
  }
  for (const row of [...lost, ...damaged]) {
    if (chargedIssuances.has(row.id) || keptDepositIssuances.has(row.id)) continue;
    exceptions.push({ code: "UNCHARGED_LOSS", label: exceptionLabels.UNCHARGED_LOSS, subject: subject(row), detail: `${returnOutcomeLabels[row.endReason === "LOST" ? "LOST" : "DAMAGED"]} ${row.endedAt?.slice(0, 10) ?? ""}. Charge it, waive it with a reason, or settle its deposit.`, holderLabel: row.holderLabel, amountCents: null, deskAttendeeId: row.deskAttendeeId, refId: row.id });
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
        ["Kind", "Holder", "Deposit", "State", "Handed back", "Kept", "Items covered", "Still out", "Taken by", "Taken"],
        ...report.deposits.map((row) => [row.typeName, row.holderLabel, formatCents(row.amountCents), row.state.toLowerCase().replace("_", " "), formatCents(row.refundCents), formatCents(row.keepCents), row.covered, row.stillOut, row.takenByName, when(row.takenAt)]),
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
