import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  coverStateOf,
  decideDepositOutcome,
  type ChargeCategory,
  type CoverState,
  type DepositOutcome,
  type FacilitySeverity,
  type FacilitySource,
  type FacilityStatus,
  type FacilityTargetKind,
} from "@/modules/issued-assets/returns-domain";

/**
 * What the check-out desk and the facility screens read (#214). Plain, serializable shapes. Names are read for display
 * only: no name is copied into a ledger entry's reason by this module, and nothing here logs one.
 */

type Client = ReturnType<typeof getPrisma>;

const toNight = (date: Date) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Deposits and charges for one holder's issuances
// ---------------------------------------------------------------------------

export type DepositView = {
  entryId: string;
  amountCents: number;
  typeName: string;
  takenAt: string;
  takenByName: string;
  covers: Array<{ issuanceId: string; identifier: string; state: CoverState; quantity: number }>;
  /** Set once the deposit has been settled (handed back and/or kept). */
  settled: null | { refundCents: number; keepCents: number; at: string; byName: string };
  /** What settling it would do now (null once settled). */
  outcome: DepositOutcome | null;
};

export type ChargeView = {
  entryId: string;
  issuanceId: string;
  identifier: string;
  category: ChargeCategory;
  amountCents: number;
  posted: boolean;
  reason: string;
  at: string;
  waived: boolean;
};

export type DeskMoney = { deposits: DepositView[]; charges: ChargeView[] };

export async function getDeskMoney(eventId: string, issuanceIds: readonly string[], client: Client = getPrisma()): Promise<DeskMoney> {
  if (issuanceIds.length === 0) return { deposits: [], charges: [] };
  const [depositRows, chargeRows] = await Promise.all([
    client.assetLedgerEntry.findMany({
      where: { eventId, kind: "DEPOSIT_RECEIVED", covers: { some: { issuanceId: { in: [...issuanceIds] } } } },
      orderBy: { createdAt: "desc" },
      include: {
        assetType: { select: { name: true, depositShortfall: true, replacementFeeCents: true } },
        settlements: { select: { kind: true, amountCents: true, createdAt: true, actorNameSnapshot: true } },
        covers: { select: { issuance: { select: { id: true, quantity: true, endQuantity: true, endedAt: true, endReason: true, asset: { select: { identifier: true } } } } } },
      },
    }),
    client.assetLedgerEntry.findMany({
      where: { eventId, kind: "CHARGE", issuanceId: { in: [...issuanceIds] } },
      orderBy: { createdAt: "desc" },
      include: { waivedBy: { select: { id: true } }, issuance: { select: { asset: { select: { identifier: true } } } } },
    }),
  ]);
  const deposits: DepositView[] = depositRows.map((row) => {
    const covers = row.covers.map((cover) => ({
      issuanceId: cover.issuance.id, identifier: cover.issuance.asset.identifier, state: coverStateOf(cover.issuance), quantity: cover.issuance.endQuantity ?? cover.issuance.quantity,
    }));
    const refund = row.settlements.find((entry) => entry.kind === "DEPOSIT_RETURNED");
    const keep = row.settlements.find((entry) => entry.kind === "DEPOSIT_KEPT");
    const settledAt = [refund, keep].filter((entry) => entry).map((entry) => entry!.createdAt).sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      entryId: row.id, amountCents: row.amountCents, typeName: row.assetType?.name ?? "", takenAt: row.createdAt.toISOString(), takenByName: row.actorNameSnapshot, covers,
      settled: settledAt ? { refundCents: refund?.amountCents ?? 0, keepCents: keep?.amountCents ?? 0, at: settledAt.toISOString(), byName: (refund ?? keep)!.actorNameSnapshot } : null,
      outcome: settledAt ? null : decideDepositOutcome({
        depositCents: row.amountCents, policy: row.assetType?.depositShortfall ?? "KEEP_ALL", replacementFeeCents: row.assetType?.replacementFeeCents ?? 0,
        covers: covers.map((cover) => ({ state: cover.state, quantity: cover.quantity })),
      }),
    };
  });
  const charges: ChargeView[] = chargeRows.map((row) => ({
    entryId: row.id, issuanceId: row.issuanceId!, identifier: row.issuance?.asset.identifier ?? "", category: row.chargeCategory!, amountCents: row.amountCents,
    posted: row.registrationAdjustmentId !== null, reason: row.reason, at: row.createdAt.toISOString(), waived: row.waivedBy.length > 0,
  }));
  return { deposits, charges };
}

// ---------------------------------------------------------------------------
// Facility issues
// ---------------------------------------------------------------------------

export type FacilityIssueRow = {
  id: string;
  title: string;
  description: string | null;
  severity: FacilitySeverity;
  status: FacilityStatus;
  source: FacilitySource;
  targetKind: FacilityTargetKind;
  targetLabel: string;
  eventUnitId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  reportedAt: string;
  reportedByName: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  /** The lodging hold that blocks the room for this issue, and whether it still does. */
  block: null | { holdId: string; kind: string; firstNight: string; lastNight: string; active: boolean };
  history: Array<{ type: string; at: string; actorName: string | null; status: FacilityStatus; severity: FacilitySeverity; note: string | null }>;
};

export const MAX_FACILITY_ROWS = 300;

export async function listFacilityIssues(eventId: string, options: { open?: boolean; limit?: number } = {}, client: Client = getPrisma()): Promise<FacilityIssueRow[]> {
  const rows = await client.facilityIssue.findMany({
    where: { eventId, ...(options.open ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : {}) },
    orderBy: [{ reportedAt: "desc" }],
    take: Math.min(options.limit ?? MAX_FACILITY_ROWS, MAX_FACILITY_ROWS),
    include: {
      unit: { select: { unit: { select: { name: true, building: { select: { name: true } } } } } },
      asset: { select: { identifier: true } },
      hold: { select: { id: true, kind: true, firstNight: true, lastNight: true, releasedAt: true } },
      history: { orderBy: [{ at: "asc" }, { revision: "asc" }], select: { type: true, at: true, actorUserId: true, status: true, severity: true, note: true } },
    },
  });
  const userIds = [...new Set(rows.flatMap((row) => [row.reportedByUserId, ...(row.assigneeUserId ? [row.assigneeUserId] : []), ...row.history.map((entry) => entry.actorUserId)]))];
  const users = userIds.length === 0 ? [] : await client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return rows.map((row) => ({
    id: row.id, title: row.title, description: row.description, severity: row.severity, status: row.status, source: row.source, targetKind: row.targetKind,
    targetLabel: row.unit ? `${row.unit.unit.name}${row.unit.unit.building.name && row.unit.unit.building.name !== row.unit.unit.name ? `, ${row.unit.unit.building.name}` : ""}` : row.asset?.identifier ?? row.targetLabel ?? "",
    eventUnitId: row.eventUnitId, assigneeUserId: row.assigneeUserId, assigneeName: row.assigneeUserId ? names.get(row.assigneeUserId) ?? null : null,
    reportedAt: row.reportedAt.toISOString(), reportedByName: names.get(row.reportedByUserId) ?? null, resolution: row.resolution, resolvedAt: row.resolvedAt?.toISOString() ?? null,
    block: row.hold ? { holdId: row.hold.id, kind: row.hold.kind, firstNight: toNight(row.hold.firstNight), lastNight: toNight(row.hold.lastNight), active: row.hold.releasedAt === null } : null,
    history: row.history.map((entry) => ({ type: entry.type, at: entry.at.toISOString(), actorName: names.get(entry.actorUserId) ?? null, status: entry.status, severity: entry.severity, note: entry.note })),
  }));
}
