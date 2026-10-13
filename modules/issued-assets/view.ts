import "server-only";

import { getPrisma } from "@/lib/prisma";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { attendeeName } from "@/modules/lodging/preferences-service";
import {
  lodgingReferenceStatus,
  normalizeAssetCode,
  type AssetAvailability,
  type AssetCondition,
  type AssetMode,
  type AssigneeKind,
  type LodgingReferenceStatus,
} from "@/modules/issued-assets/domain";
import { resolveAssetByCode } from "@/modules/issued-assets/service";

/**
 * What the issued-asset screens read (#213). Everything is a plain, serializable shape. Names are read for display
 * only: nothing here (and nothing in the audit log or history) copies a person's name into an asset record.
 */

type Client = ReturnType<typeof getPrisma>;

const toNight = (date: Date) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type CatalogType = {
  id: string;
  name: string;
  mode: AssetMode;
  active: boolean;
  assigneeKinds: AssigneeKind[];
  roomLinked: boolean;
  depositPolicyRef: string | null;
  replacementPolicyRef: string | null;
  assetCount: number;
  /** Items (or units of a lot) in stock and not out. */
  availableQuantity: number;
  outQuantity: number;
};

export type CatalogAsset = {
  id: string;
  typeId: string;
  identifier: string;
  scanCode: string;
  quantityTotal: number;
  condition: AssetCondition;
  location: string | null;
  availability: AssetAvailability;
  outQuantity: number;
};

export type CatalogView = { types: CatalogType[]; assets: CatalogAsset[]; truncated: boolean };

/** Sorts K-9 before K-10: numbers inside an identifier compare as numbers. */
const naturalCompare = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;
export const MAX_CATALOG_ASSETS = 2000;

export async function getCatalogView(eventId: string, client: Client = getPrisma()): Promise<CatalogView> {
  const [types, assets, open] = await Promise.all([
    client.issuedAssetType.findMany({ where: { eventId }, orderBy: { name: "asc" } }),
    client.issuedAsset.findMany({ where: { eventId }, take: MAX_CATALOG_ASSETS + 1 }),
    client.assetIssuance.groupBy({ by: ["assetId"], where: { eventId, endedAt: null }, _sum: { quantity: true } }),
  ]);
  const out = new Map(open.map((row) => [row.assetId, row._sum.quantity ?? 0]));
  const truncated = assets.length > MAX_CATALOG_ASSETS;
  const shown = assets.slice(0, MAX_CATALOG_ASSETS).sort((a, b) => naturalCompare(a.identifier, b.identifier));
  return {
    truncated,
    assets: shown.map((asset) => ({
      id: asset.id, typeId: asset.assetTypeId, identifier: asset.identifier, scanCode: asset.scanCode, quantityTotal: asset.quantityTotal,
      condition: asset.condition, location: asset.location, availability: asset.availability, outQuantity: out.get(asset.id) ?? 0,
    })),
    types: types.map((type) => {
      const own = assets.filter((asset) => asset.assetTypeId === type.id);
      const outQuantity = own.reduce((sum, asset) => sum + (out.get(asset.id) ?? 0), 0);
      const inStock = own.filter((asset) => asset.availability === "AVAILABLE").reduce((sum, asset) => sum + asset.quantityTotal, 0);
      return {
        id: type.id, name: type.name, mode: type.mode, active: type.active, assigneeKinds: type.assigneeKinds, roomLinked: type.roomLinked,
        depositPolicyRef: type.depositPolicyRef, replacementPolicyRef: type.replacementPolicyRef,
        assetCount: own.length, outQuantity, availableQuantity: Math.max(0, inStock - outQuantity),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Issuances, with their lodging references
// ---------------------------------------------------------------------------

export type IssuanceRow = {
  id: string;
  assetId: string;
  identifier: string;
  typeName: string;
  serialized: boolean;
  quantity: number;
  holderKind: AssigneeKind;
  holderLabel: string;
  purpose: string;
  issuedAt: string;
  issuedByName: string | null;
  entryMethod: "MANUAL" | "SCAN" | "OFFLINE";
  expectedReturnAt: string | null;
  open: boolean;
  endReason: "TRANSFERRED" | "REPLACED" | "CORRECTED" | null;
  endedAt: string | null;
  endNote: string | null;
  previousIssuanceId: string | null;
  /** The room the item opens, as it was when issued. It never changes. */
  roomName: string | null;
  sourceAssignmentId: string | null;
  /** Where the holder's lodging stands today relative to that room (null when the item is not room-linked). */
  lodging: { status: LodgingReferenceStatus; currentRooms: string[] } | null;
};

async function describeIssuances(client: Client, eventId: string, rows: Array<Awaited<ReturnType<Client["assetIssuance"]["findMany"]>>[number]>): Promise<IssuanceRow[]> {
  if (rows.length === 0) return [];
  const uniq = <T,>(values: Array<T | null | undefined>) => [...new Set(values.filter((value): value is T => value != null))];
  const assetIds = uniq(rows.map((row) => row.assetId));
  const attendeeIds = uniq(rows.map((row) => row.attendeeId));
  const registrationIds = uniq(rows.map((row) => row.registrationId));
  const userIds = uniq(rows.flatMap((row) => [row.staffUserId, row.issuedByUserId]));
  const unitIds = uniq(rows.map((row) => row.roomUnitId));
  const assignmentIds = uniq(rows.map((row) => row.sourceAssignmentId));
  const [assets, attendees, registrations, users, units, assignments] = await Promise.all([
    client.issuedAsset.findMany({ where: { eventId, id: { in: assetIds } }, select: { id: true, identifier: true, assetType: { select: { name: true } } } }),
    client.registrationAttendee.findMany({ where: { eventId, id: { in: attendeeIds } }, select: { id: true, profileSnapshot: true, person: { select: { firstName: true, lastName: true } } } }),
    client.registration.findMany({ where: { eventId, id: { in: registrationIds } }, select: { id: true, confirmationCode: true } }),
    client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }),
    client.eventLodgingUnit.findMany({ where: { eventId, id: { in: unitIds } }, select: { id: true, unit: { select: { name: true, building: { select: { name: true } } } } } }),
    client.eventLodgingAssignment.findMany({ where: { eventId, id: { in: assignmentIds } }, select: { id: true, cancelledAt: true } }),
  ]);
  const assetById = new Map(assets.map((row) => [row.id, row]));
  const attendeeById = new Map(attendees.map((row) => [row.id, attendeeName(row)]));
  const registrationById = new Map(registrations.map((row) => [row.id, `Registration ${row.confirmationCode}`]));
  const userById = new Map(users.map((row) => [row.id, row.displayName]));
  const unitName = new Map(units.map((row) => [row.id, `${row.unit.name}${row.unit.building.name && row.unit.building.name !== row.unit.name ? `, ${row.unit.building.name}` : ""}`]));
  const assignmentById = new Map(assignments.map((row) => [row.id, row]));

  // Where each room-linked holder is housed today, for the lodging status of a cancelled source assignment.
  const linkedAttendeeIds = uniq(rows.filter((row) => row.sourceAssignmentId && row.attendeeId).map((row) => row.attendeeId));
  const linkedRegistrationIds = uniq(rows.filter((row) => row.sourceAssignmentId && row.registrationId).map((row) => row.registrationId));
  const regAttendees = linkedRegistrationIds.length === 0 ? [] : await client.registrationAttendee.findMany({ where: { eventId, registrationId: { in: linkedRegistrationIds } }, select: { id: true, registrationId: true } });
  const currentFor = linkedAttendeeIds.length + regAttendees.length === 0 ? [] : await client.eventLodgingAssignment.findMany({
    where: { eventId, cancelledAt: null, eventLodgingUnitId: { not: null }, attendeeId: { in: [...linkedAttendeeIds, ...regAttendees.map((row) => row.id)] } },
    select: { attendeeId: true, eventLodgingUnitId: true },
  });
  const extraUnits = uniq(currentFor.map((row) => row.eventLodgingUnitId)).filter((id) => !unitName.has(id));
  if (extraUnits.length > 0) {
    const more = await client.eventLodgingUnit.findMany({ where: { eventId, id: { in: extraUnits } }, select: { id: true, unit: { select: { name: true, building: { select: { name: true } } } } } });
    for (const row of more) unitName.set(row.id, `${row.unit.name}${row.unit.building.name && row.unit.building.name !== row.unit.name ? `, ${row.unit.building.name}` : ""}`);
  }
  const attendeesOfRegistration = new Map<string, string[]>();
  for (const row of regAttendees) attendeesOfRegistration.set(row.registrationId, [...(attendeesOfRegistration.get(row.registrationId) ?? []), row.id]);
  const roomsOfAttendee = new Map<string, string[]>();
  for (const row of currentFor) roomsOfAttendee.set(row.attendeeId!, [...(roomsOfAttendee.get(row.attendeeId!) ?? []), row.eventLodgingUnitId!]);

  return rows.map((row) => {
    const asset = assetById.get(row.assetId);
    const holderLabel = row.assigneeKind === "ATTENDEE" ? attendeeById.get(row.attendeeId!) ?? "Attendee"
      : row.assigneeKind === "REGISTRATION" ? registrationById.get(row.registrationId!) ?? "Registration"
      : row.assigneeKind === "STAFF" ? userById.get(row.staffUserId!) ?? "Staff member"
      : row.assigneeKind === "ROOM" ? unitName.get(row.roomUnitId!) ?? "Room"
      : row.assigneeLabel ?? "";
    let lodging: IssuanceRow["lodging"] = null;
    if (row.sourceAssignmentId) {
      const holderAttendees = row.attendeeId ? [row.attendeeId] : attendeesOfRegistration.get(row.registrationId ?? "") ?? [];
      const currentIds = [...new Set(holderAttendees.flatMap((id) => roomsOfAttendee.get(id) ?? []))];
      const status = lodgingReferenceStatus(assignmentById.get(row.sourceAssignmentId) ?? null, currentIds, row.roomUnitId);
      if (status) lodging = { status, currentRooms: currentIds.map((id) => unitName.get(id) ?? "Room") };
    }
    return {
      id: row.id, assetId: row.assetId, identifier: asset?.identifier ?? "", typeName: asset?.assetType.name ?? "", serialized: row.serialized, quantity: row.quantity,
      holderKind: row.assigneeKind, holderLabel, purpose: row.purpose, issuedAt: row.issuedAt.toISOString(), issuedByName: userById.get(row.issuedByUserId) ?? null,
      entryMethod: row.entryMethod, expectedReturnAt: row.expectedReturnAt?.toISOString() ?? null, open: row.endedAt === null, endReason: row.endReason,
      endedAt: row.endedAt?.toISOString() ?? null, endNote: row.endNote, previousIssuanceId: row.previousIssuanceId,
      roomName: row.roomUnitId ? unitName.get(row.roomUnitId) ?? null : null, sourceAssignmentId: row.sourceAssignmentId, lodging,
    };
  });
}

// ---------------------------------------------------------------------------
// The issue desk
// ---------------------------------------------------------------------------

export type DeskType = { id: string; name: string; mode: AssetMode; assigneeKinds: AssigneeKind[]; roomLinked: boolean; depositPolicyRef: string | null };

export type DeskRoomAssignment = { assignmentId: string; roomName: string; firstNight: string; lastNight: string };

export type DeskPerson = {
  attendeeId: string;
  registrationId: string;
  name: string;
  confirmationCode: string;
  registrationActive: boolean;
  /** The person's current room assignments (one is the usual case; several need a choice for room keys). */
  rooms: DeskRoomAssignment[];
  issuances: IssuanceRow[];
};

export type AssigneeOptions = { rooms: Array<{ id: string; name: string }>; staff: Array<{ userId: string; name: string }> };

export async function getAssigneeOptions(eventId: string, client: Client = getPrisma()): Promise<AssigneeOptions> {
  const [units, members] = await Promise.all([
    client.eventLodgingUnit.findMany({ where: { eventId, assignable: true, retired: false }, select: { id: true, unit: { select: { name: true, key: true, building: { select: { name: true, sortOrder: true } } } } } }),
    client.eventMembership.findMany({ where: { eventId, status: "ACTIVE" }, select: { user: { select: { id: true, displayName: true } } } }),
  ]);
  return {
    rooms: units.map((row) => ({ id: row.id, name: `${row.unit.name}${row.unit.building.name !== row.unit.name ? `, ${row.unit.building.name}` : ""}` })).sort((a, b) => naturalCompare(a.name, b.name)),
    staff: members.map((row) => ({ userId: row.user.id, name: row.user.displayName })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getDeskTypes(eventId: string, client: Client = getPrisma()): Promise<DeskType[]> {
  const types = await client.issuedAssetType.findMany({ where: { eventId, active: true }, orderBy: { name: "asc" } });
  return types.map((type) => ({ id: type.id, name: type.name, mode: type.mode, assigneeKinds: type.assigneeKinds, roomLinked: type.roomLinked, depositPolicyRef: type.depositPolicyRef }));
}

export type DeskLot = { code: string; identifier: string; typeName: string; remaining: number };

/** Quantity lots with something left, so the desk can offer "welcome packet given" as one tap. */
export async function getDeskLots(eventId: string, client: Client = getPrisma()): Promise<DeskLot[]> {
  const lots = await client.issuedAsset.findMany({
    where: { eventId, availability: "AVAILABLE", assetType: { active: true, mode: "QUANTITY" } },
    select: { id: true, identifier: true, scanCode: true, quantityTotal: true, assetType: { select: { name: true } } },
    orderBy: { identifier: "asc" },
    take: 50,
  });
  const out = await client.assetIssuance.groupBy({ by: ["assetId"], where: { eventId, endedAt: null, assetId: { in: lots.map((lot) => lot.id) } }, _sum: { quantity: true } });
  const outById = new Map(out.map((row) => [row.assetId, row._sum.quantity ?? 0]));
  return lots.map((lot) => ({ code: lot.scanCode, identifier: lot.identifier, typeName: lot.assetType.name, remaining: Math.max(0, lot.quantityTotal - (outById.get(lot.id) ?? 0)) }));
}

export async function getDeskPerson(eventId: string, attendeeId: string, client: Client = getPrisma()): Promise<DeskPerson | null> {
  const attendee = await client.registrationAttendee.findFirst({
    where: { id: attendeeId, eventId },
    select: { id: true, registrationId: true, profileSnapshot: true, person: { select: { firstName: true, lastName: true } }, registration: { select: { status: true, confirmationCode: true } } },
  });
  if (!attendee) return null;
  const siblings = await client.registrationAttendee.findMany({ where: { eventId, registrationId: attendee.registrationId }, select: { id: true } });
  const [assignments, issuanceRows] = await Promise.all([
    client.eventLodgingAssignment.findMany({
      where: { eventId, attendeeId, cancelledAt: null, eventLodgingUnitId: { not: null } },
      orderBy: { firstNight: "asc" },
      select: { id: true, firstNight: true, lastNight: true, eventUnit: { select: { unit: { select: { name: true, building: { select: { name: true } } } } } } },
    }),
    client.assetIssuance.findMany({
      where: { eventId, OR: [{ attendeeId: { in: siblings.map((row) => row.id) } }, { registrationId: attendee.registrationId }] },
      orderBy: { issuedAt: "desc" },
    }),
  ]);
  const active = new Set<string>(activeRegistrationStatuses);
  return {
    attendeeId: attendee.id,
    registrationId: attendee.registrationId,
    name: attendeeName(attendee),
    confirmationCode: attendee.registration.confirmationCode,
    registrationActive: active.has(attendee.registration.status),
    rooms: assignments.map((row) => ({
      assignmentId: row.id,
      roomName: `${row.eventUnit!.unit.name}${row.eventUnit!.unit.building.name !== row.eventUnit!.unit.name ? `, ${row.eventUnit!.unit.building.name}` : ""}`,
      firstNight: toNight(row.firstNight),
      lastNight: toNight(row.lastNight),
    })),
    issuances: await describeIssuances(client, eventId, issuanceRows),
  };
}

/** Attendees by name or confirmation code, for the desk's lookup. Active registrations only; a short list. */
export async function searchDeskPeople(eventId: string, query: string, client: Client = getPrisma()) {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await client.registrationAttendee.findMany({
    where: {
      eventId,
      registration: { status: { in: [...activeRegistrationStatuses] } },
      OR: [
        { person: { firstName: { contains: q, mode: "insensitive" } } },
        { person: { lastName: { contains: q, mode: "insensitive" } } },
        { registration: { confirmationCode: { startsWith: q.toUpperCase() } } },
      ],
    },
    take: 15,
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
    select: { id: true, profileSnapshot: true, person: { select: { firstName: true, lastName: true } }, registration: { select: { confirmationCode: true } } },
  });
  return rows.map((row) => ({ attendeeId: row.id, name: attendeeName(row), confirmationCode: row.registration.confirmationCode }));
}

// ---------------------------------------------------------------------------
// Lookup by code, what is out, and a room's keys
// ---------------------------------------------------------------------------

export type AssetLookup = {
  asset: CatalogAsset & { typeName: string; mode: AssetMode };
  open: IssuanceRow[];
  /** Every issuance of this item, newest first: who has held it, with the lodging reference each time. */
  history: IssuanceRow[];
};

export async function lookupAsset(eventId: string, code: string, client: Client = getPrisma()): Promise<AssetLookup | null> {
  const found = await resolveAssetByCode(client, eventId, normalizeAssetCode(code));
  if (!found) return null;
  const asset = await client.issuedAsset.findFirstOrThrow({ where: { id: found.id, eventId }, include: { assetType: true } });
  const rows = await client.assetIssuance.findMany({ where: { eventId, assetId: asset.id }, orderBy: { issuedAt: "desc" }, take: 100 });
  const history = await describeIssuances(client, eventId, rows);
  const out = history.filter((row) => row.open).reduce((sum, row) => sum + row.quantity, 0);
  return {
    asset: {
      id: asset.id, typeId: asset.assetTypeId, identifier: asset.identifier, scanCode: asset.scanCode, quantityTotal: asset.quantityTotal, condition: asset.condition,
      location: asset.location, availability: asset.availability, outQuantity: out, typeName: asset.assetType.name, mode: asset.assetType.mode,
    },
    open: history.filter((row) => row.open),
    history,
  };
}

/** Everything currently issued, newest first, optionally narrowed to one kind of item. A page, not the whole event. */
export async function listOutNow(eventId: string, options: { typeId?: string; limit?: number } = {}, client: Client = getPrisma()) {
  const rows = await client.assetIssuance.findMany({
    where: { eventId, endedAt: null, ...(options.typeId ? { asset: { assetTypeId: options.typeId } } : {}) },
    orderBy: { issuedAt: "desc" },
    take: options.limit ?? 200,
  });
  return describeIssuances(client, eventId, rows);
}

/** Every key and item ever issued for one room, open and ended: the room's own history across moves. */
export async function listRoomIssuances(eventId: string, eventUnitId: string, client: Client = getPrisma()) {
  const rows = await client.assetIssuance.findMany({ where: { eventId, roomUnitId: eventUnitId }, orderBy: { issuedAt: "desc" }, take: 200 });
  return describeIssuances(client, eventId, rows);
}

export type HistoryEntry = {
  id: string;
  type: string;
  at: string;
  /** When the server wrote it (later than `at` for an offline entry). */
  recordedAt: string;
  actorName: string | null;
  reason: string | null;
  entryMethod: string;
  quantity: number;
  holderKind: AssigneeKind;
  sourceAssignmentId: string | null;
  roomUnitId: string | null;
  issuanceId: string;
  relatedIssuanceId: string | null;
};

/** The append-only history of one item, oldest first. */
export async function listAssetHistory(eventId: string, assetId: string, client: Client = getPrisma()): Promise<HistoryEntry[]> {
  const rank: Record<string, number> = { ISSUED: 0, TRANSFERRED_OUT: 1, REPLACED_OUT: 1, TRANSFERRED_IN: 2, REPLACED_IN: 2, CORRECTED: 3 };
  // A transfer or replacement writes its OUT and IN rows at one instant: the OUT reads first.
  const rows = (await client.assetIssuanceHistory.findMany({ where: { eventId, assetId }, orderBy: [{ at: "asc" }, { recordedAt: "asc" }, { revision: "asc" }], take: 500 }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.recordedAt.getTime() - b.recordedAt.getTime() || (rank[a.type] ?? 0) - (rank[b.type] ?? 0));
  const users = await client.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.actorUserId))] } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((row) => [row.id, row.displayName]));
  return rows.map((row) => ({
    id: row.id, type: row.type, at: row.at.toISOString(), recordedAt: row.recordedAt.toISOString(), actorName: names.get(row.actorUserId) ?? null, reason: row.reason, entryMethod: row.entryMethod, quantity: row.quantity,
    holderKind: row.assigneeKind, sourceAssignmentId: row.sourceAssignmentId, roomUnitId: row.roomUnitId, issuanceId: row.issuanceId, relatedIssuanceId: row.relatedIssuanceId,
  }));
}
