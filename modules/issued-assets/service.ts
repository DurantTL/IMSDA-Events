import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { pauseBeforeRetry } from "@/lib/prisma-errors";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { runSerializableTransaction } from "@/modules/payments/serializable";
import { attendeeName } from "@/modules/lodging/preferences-service";
import {
  assetActionSchema,
  assetTypeActionSchema,
  decideIssue,
  expandRange,
  holderKeyOf,
  issuanceActionSchema,
  issueRequestSchema,
  normalizeAssetCode,
  pickRoomCandidate,
  plausibleOccurredAt,
  sameHolder,
  type AssetMode,
  type AssigneeInput,
  type AssigneeKind,
  type EntryMethod,
  type HolderKey,
  type ItemErrorCode,
  type RoomCandidate,
} from "@/modules/issued-assets/domain";
import { AssetError } from "@/modules/issued-assets/errors";

/**
 * Issued assets (#213, slice 1): the catalog writers and the one transactional issue service.
 *
 * Every issuance writer (issue, transfer, replace, correct, and the catalog edits that could change what may be
 * issued) runs in a SERIALIZABLE transaction through `runSerializableTransaction`, takes the `IssuedAsset` row locks in
 * id order and bumps each row's `issueVersion` before it reads who holds the asset. Two staff scanning the same key
 * therefore leave one winner: the loser is rolled back, runs again, and is told the key is already issued. The database
 * says the same thing independently (a partial unique index and a trigger), so no other code path can break it.
 * Manual lookup, barcode scan and offline entry are all `issueAssets`; they differ only in how the code was obtained.
 * The history is append-only (triggers) and every writer appends exactly one history row per change.
 */

type Tx = Prisma.TransactionClient;

const busy = () => new AssetError("BUSY", "Several people are issuing at once and this could not settle. Nothing was saved. Try again.");

/** SERIALIZABLE with retries (the shared helper), and a few more rounds with a pause for a crowded desk. */
async function transact<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
  for (let round = 0; round < 4; round += 1) {
    try {
      return await runSerializableTransaction(operation, busy);
    } catch (error) {
      if (!(error instanceof AssetError && error.code === "BUSY") || round === 3) throw error;
      await pauseBeforeRetry(round);
    }
  }
  throw busy();
}

const toNight = (date: Date) => date.toISOString().slice(0, 10);
const clean = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

/** Lock the asset rows in id order and bump their version: a stale reader in another transaction is rolled back and retried. */
async function lockAssets(tx: Tx, eventId: string, ids: readonly string[]) {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "IssuedAsset" WHERE "eventId" = ${eventId} AND "id" = ANY(${sorted}::text[]) ORDER BY "id" FOR UPDATE`;
  await tx.$executeRaw`UPDATE "IssuedAsset" SET "issueVersion" = "issueVersion" + 1 WHERE "eventId" = ${eventId} AND "id" = ANY(${sorted}::text[])`;
}

async function requireEvent(tx: Tx, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new AssetError("EVENT_NOT_FOUND", "That event was not found.");
}

// ---------------------------------------------------------------------------
// Catalog: types
// ---------------------------------------------------------------------------

export async function applyAssetTypeAction(eventId: string, actorUserId: string, rawInput: unknown) {
  const input = assetTypeActionSchema.parse(rawInput);
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      await requireEvent(tx, eventId);
      if (input.action === "create") {
        const created = await tx.issuedAssetType.create({
          data: {
            eventId, name: input.name, mode: input.mode, assigneeKinds: [...new Set(input.assigneeKinds)], roomLinked: input.roomLinked,
            depositPolicyRef: clean(input.depositPolicyRef), replacementPolicyRef: clean(input.replacementPolicyRef),
            createdByUserId: actorUserId, updatedByUserId: actorUserId,
          },
        });
        await writeAuditLog({ eventId, actorUserId, action: "ASSET_TYPE_CREATED", entityType: "IssuedAssetType", entityId: created.id, summary: "Added an issued-asset type.", metadata: { mode: created.mode, roomLinked: created.roomLinked } }, tx);
        return { id: created.id };
      }
      const existing = await tx.issuedAssetType.findFirst({ where: { id: input.typeId, eventId } });
      if (!existing) throw new AssetError("TYPE_NOT_FOUND", "That kind of item was not found.");
      const data: Prisma.IssuedAssetTypeUpdateInput = { updatedByUserId: actorUserId };
      if (input.name !== undefined) data.name = input.name;
      if (input.active !== undefined) data.active = input.active;
      if (input.assigneeKinds !== undefined) data.assigneeKinds = [...new Set(input.assigneeKinds)];
      if (input.roomLinked !== undefined) data.roomLinked = input.roomLinked;
      if (input.depositPolicyRef !== undefined) data.depositPolicyRef = clean(input.depositPolicyRef);
      if (input.replacementPolicyRef !== undefined) data.replacementPolicyRef = clean(input.replacementPolicyRef);
      await tx.issuedAssetType.update({ where: { id: existing.id }, data });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_TYPE_UPDATED", entityType: "IssuedAssetType", entityId: existing.id, summary: "Updated an issued-asset type.", metadata: { fields: Object.keys(input).filter((key) => key !== "action" && key !== "typeId") } }, tx);
      return { id: existing.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AssetError("TYPE_EXISTS", "There is already a kind of item with that name.");
    if (error instanceof Error && error.message.includes("keeps its serialized or quantity behaviour")) throw new AssetError("TYPE_MODE_LOCKED", "A kind of item that already has items keeps its numbered or quantity behaviour.");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Catalog: assets
// ---------------------------------------------------------------------------

/** Every code (identifier or scan code) an event's assets answer to, mapped to the asset that owns it. */
async function codeOwners(tx: Tx, eventId: string) {
  const rows = await tx.issuedAsset.findMany({ where: { eventId }, select: { id: true, identifier: true, scanCode: true } });
  const owners = new Map<string, string>();
  for (const row of rows) {
    owners.set(row.identifier, row.id);
    owners.set(row.scanCode, row.id);
  }
  return owners;
}

export async function applyAssetAction(eventId: string, actorUserId: string, rawInput: unknown) {
  const input = assetActionSchema.parse(rawInput);
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    if (input.action === "update") {
      await lockAssets(tx, eventId, [input.assetId]);
      const asset = await tx.issuedAsset.findFirst({ where: { id: input.assetId, eventId }, include: { assetType: true } });
      if (!asset) throw new AssetError("ASSET_NOT_FOUND", "That item was not found.");
      const open = await tx.assetIssuance.findMany({ where: { assetId: asset.id, endedAt: null }, select: { quantity: true } });
      const out = open.reduce((sum, row) => sum + row.quantity, 0);
      const data: Prisma.IssuedAssetUpdateInput = {};
      if (input.condition !== undefined) data.condition = input.condition;
      if (input.location !== undefined) data.location = clean(input.location);
      if (input.availability !== undefined && input.availability !== asset.availability) {
        if (input.availability !== "AVAILABLE" && out > 0) throw new AssetError("ASSET_IN_USE", "That item is issued right now. Transfer, replace or correct the issue first.");
        data.availability = input.availability;
      }
      if (input.quantityTotal !== undefined && input.quantityTotal !== asset.quantityTotal) {
        if (asset.assetType.mode === "SERIALIZED") throw new AssetError("QUANTITY_INVALID", "A numbered item is exactly one.");
        if (input.quantityTotal < out) throw new AssetError("ASSET_IN_USE", `${out} are issued right now, so the lot cannot be smaller than that.`);
        data.quantityTotal = input.quantityTotal;
      }
      if (input.scanCode !== undefined && input.scanCode !== asset.scanCode) {
        const owner = (await codeOwners(tx, eventId)).get(input.scanCode);
        if (owner && owner !== asset.id) throw new AssetError("ASSET_EXISTS", "Another item already uses that code.");
        data.scanCode = input.scanCode;
      }
      if (Object.keys(data).length === 0) return { id: asset.id, created: 0, skipped: 0 };
      await tx.issuedAsset.update({ where: { id: asset.id }, data });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_UPDATED", entityType: "IssuedAsset", entityId: asset.id, summary: "Updated an issued item.", metadata: { fields: Object.keys(data), availability: data.availability ?? null, condition: data.condition ?? null } }, tx);
      return { id: asset.id, created: 0, skipped: 0 };
    }
    const type = await tx.issuedAssetType.findFirst({ where: { id: input.typeId, eventId } });
    if (!type) throw new AssetError("TYPE_NOT_FOUND", "That kind of item was not found.");
    const owners = await codeOwners(tx, eventId);
    if (input.action === "create") {
      const scanCode = input.scanCode ?? input.identifier;
      if (owners.has(input.identifier) || owners.has(scanCode)) throw new AssetError("ASSET_EXISTS", "An item with that identifier or code already exists.");
      if (type.mode === "SERIALIZED" && input.quantityTotal !== 1) throw new AssetError("QUANTITY_INVALID", "A numbered item is exactly one.");
      const created = await tx.issuedAsset.create({
        data: { eventId, assetTypeId: type.id, identifier: input.identifier, scanCode, quantityTotal: input.quantityTotal, condition: input.condition, location: clean(input.location), createdByUserId: actorUserId },
      });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_CREATED", entityType: "IssuedAsset", entityId: created.id, summary: "Added an issued item.", metadata: { typeId: type.id, quantityTotal: created.quantityTotal } }, tx);
      return { id: created.id, created: 1, skipped: 0 };
    }
    // bulk: a numbered range, serialized types only. Codes that already exist are skipped, so running it twice is safe.
    if (type.mode !== "SERIALIZED") throw new AssetError("RANGE_INVALID", "A numbered range is for numbered items. Add a quantity item on its own.");
    let codes: string[];
    try {
      codes = expandRange(input.prefix, input.from, input.to, input.width);
    } catch (error) {
      throw new AssetError("RANGE_INVALID", error instanceof Error ? error.message : "That range is not usable.");
    }
    const fresh = codes.filter((code) => !owners.has(code));
    if (fresh.length > 0) {
      await tx.issuedAsset.createMany({
        data: fresh.map((code) => ({ eventId, assetTypeId: type.id, identifier: code, scanCode: code, quantityTotal: 1, condition: input.condition, location: clean(input.location), createdByUserId: actorUserId })),
        skipDuplicates: true,
      });
    }
    await writeAuditLog({ eventId, actorUserId, action: "ASSET_RANGE_ADDED", entityType: "IssuedAssetType", entityId: type.id, summary: "Added a numbered range of items.", metadata: { first: codes[0]!, last: codes[codes.length - 1]!, created: fresh.length, skipped: codes.length - fresh.length } }, tx);
    return { id: type.id, created: fresh.length, skipped: codes.length - fresh.length };
  });
}

// ---------------------------------------------------------------------------
// Resolving what was scanned or typed
// ---------------------------------------------------------------------------

/** A scan code first (what a barcode carries), then the identifier staff read aloud. The same for every path. */
export async function resolveAssetByCode(client: Tx | ReturnType<typeof getPrisma>, eventId: string, rawCode: string) {
  const code = normalizeAssetCode(rawCode);
  if (!code) return null;
  return (await client.issuedAsset.findFirst({ where: { eventId, scanCode: code }, select: { id: true } }))
    ?? (await client.issuedAsset.findFirst({ where: { eventId, identifier: code }, select: { id: true } }));
}

// ---------------------------------------------------------------------------
// Holders and lodging references
// ---------------------------------------------------------------------------

type Holder = {
  kind: AssigneeKind;
  attendeeId: string | null;
  registrationId: string | null;
  staffUserId: string | null;
  roomUnitId: string | null;
  assigneeLabel: string | null;
  /** For results and screens only; never written. */
  display: string;
};

const holderKey = (holder: Holder): HolderKey => holderKeyOf(holder);

async function resolveHolder(tx: Tx, eventId: string, input: AssigneeInput): Promise<Holder> {
  const blank = { attendeeId: null, registrationId: null, staffUserId: null, roomUnitId: null, assigneeLabel: null };
  const active = new Set<string>(activeRegistrationStatuses);
  if (input.kind === "ATTENDEE") {
    const attendee = await tx.registrationAttendee.findFirst({
      where: { id: input.attendeeId, eventId },
      select: { id: true, profileSnapshot: true, person: { select: { firstName: true, lastName: true } }, registration: { select: { status: true } } },
    });
    if (!attendee) throw new AssetError("ASSIGNEE_NOT_FOUND", "That attendee was not found for this event.");
    if (!active.has(attendee.registration.status)) throw new AssetError("REGISTRATION_NOT_ACTIVE", "That attendee's registration is not submitted or confirmed.");
    return { ...blank, kind: "ATTENDEE", attendeeId: attendee.id, display: attendeeName(attendee) };
  }
  if (input.kind === "REGISTRATION") {
    const registration = await tx.registration.findFirst({ where: { id: input.registrationId, eventId }, select: { id: true, status: true, confirmationCode: true } });
    if (!registration) throw new AssetError("ASSIGNEE_NOT_FOUND", "That registration was not found for this event.");
    if (!active.has(registration.status)) throw new AssetError("REGISTRATION_NOT_ACTIVE", "That registration is not submitted or confirmed.");
    return { ...blank, kind: "REGISTRATION", registrationId: registration.id, display: `Registration ${registration.confirmationCode}` };
  }
  if (input.kind === "STAFF") {
    const membership = await tx.eventMembership.findUnique({ where: { eventId_userId: { eventId, userId: input.userId } }, select: { status: true, user: { select: { id: true, displayName: true } } } });
    if (!membership || membership.status !== "ACTIVE") throw new AssetError("STAFF_NOT_ON_EVENT", "That person is not active event staff.");
    return { ...blank, kind: "STAFF", staffUserId: membership.user.id, display: membership.user.displayName };
  }
  if (input.kind === "ROOM") {
    const unit = await tx.eventLodgingUnit.findFirst({ where: { id: input.eventUnitId, eventId }, select: { id: true, unit: { select: { name: true } } } });
    if (!unit) throw new AssetError("ASSIGNEE_NOT_FOUND", "That room was not found for this event.");
    return { ...blank, kind: "ROOM", roomUnitId: unit.id, display: unit.unit.name };
  }
  return { ...blank, kind: input.kind, assigneeLabel: input.label, display: input.label };
}

type RoomLink = { roomUnitId: string | null; sourceAssignmentId: string | null };

/**
 * The room a room-linked item opens and the exact lodging assignment it is issued against. Read under the same
 * SERIALIZABLE snapshot as the issue, so a move that commits first makes this issue retry against the new room. An
 * offline entry may name an assignment that was moved after the moment it happened: that is the correct historical
 * reference, so it is kept.
 */
async function resolveRoomLink(tx: Tx, eventId: string, holder: Holder, assignmentId: string | undefined, issuedAt: Date, entryMethod: EntryMethod): Promise<RoomLink> {
  if (holder.kind === "ROOM") {
    if (!assignmentId) return { roomUnitId: holder.roomUnitId, sourceAssignmentId: null };
    const assignment = await tx.eventLodgingAssignment.findFirst({ where: { id: assignmentId, eventId, eventLodgingUnitId: holder.roomUnitId } });
    if (!assignment) throw new AssetError("ROOM_ASSIGNMENT_INVALID", "That lodging assignment is not for this room.");
    assertAssignmentUsable(assignment, issuedAt, entryMethod);
    return { roomUnitId: holder.roomUnitId, sourceAssignmentId: assignment.id };
  }
  if (holder.kind !== "ATTENDEE" && holder.kind !== "REGISTRATION") return { roomUnitId: null, sourceAssignmentId: null };
  const attendeeIds = holder.attendeeId
    ? [holder.attendeeId]
    : (await tx.registrationAttendee.findMany({ where: { registrationId: holder.registrationId!, eventId }, select: { id: true } })).map((row) => row.id);
  if (assignmentId) {
    const assignment = await tx.eventLodgingAssignment.findFirst({ where: { id: assignmentId, eventId, attendeeId: { in: attendeeIds }, eventLodgingUnitId: { not: null } } });
    if (!assignment) throw new AssetError("ROOM_ASSIGNMENT_INVALID", "That lodging assignment is not a room assignment for this person.");
    assertAssignmentUsable(assignment, issuedAt, entryMethod);
    return { roomUnitId: assignment.eventLodgingUnitId, sourceAssignmentId: assignment.id };
  }
  const rows = await tx.eventLodgingAssignment.findMany({
    where: { eventId, attendeeId: { in: attendeeIds }, eventLodgingUnitId: { not: null }, cancelledAt: null },
    select: { id: true, eventLodgingUnitId: true, firstNight: true, lastNight: true },
  });
  const candidates: RoomCandidate[] = rows.map((row) => ({ assignmentId: row.id, unitId: row.eventLodgingUnitId!, firstNight: toNight(row.firstNight), lastNight: toNight(row.lastNight) }));
  const picked = pickRoomCandidate(candidates, toNight(issuedAt));
  if (!picked.ok) {
    throw new AssetError(picked.code, picked.code === "ROOM_ASSIGNMENT_AMBIGUOUS"
      ? "This person has more than one room. Choose which room the key is for."
      : "This person is not placed in a room yet, so a room key cannot be issued. Assign lodging first.");
  }
  return { roomUnitId: picked.candidate.unitId, sourceAssignmentId: picked.candidate.assignmentId };
}

function assertAssignmentUsable(assignment: { cancelledAt: Date | null }, issuedAt: Date, entryMethod: EntryMethod) {
  if (!assignment.cancelledAt) return;
  if (entryMethod === "OFFLINE" && assignment.cancelledAt.getTime() > issuedAt.getTime()) return;
  throw new AssetError("ROOM_ASSIGNMENT_MOVED", "That room assignment has changed since. Choose the current one.");
}

// ---------------------------------------------------------------------------
// Writing issuances
// ---------------------------------------------------------------------------

type OpenIssuance = Prisma.AssetIssuanceGetPayload<Record<string, never>>;

/** The holder of a stored issuance. For a ROOM holder `roomUnitId` is the holder; for anyone else it is only the room a key opens. */
const rowHolderKey = (row: OpenIssuance): HolderKey => holderKeyOf({ kind: row.assigneeKind, attendeeId: row.attendeeId, registrationId: row.registrationId, staffUserId: row.staffUserId, roomUnitId: row.roomUnitId, assigneeLabel: row.assigneeLabel });

type NewIssuance = {
  eventId: string;
  assetId: string;
  serialized: boolean;
  quantity: number;
  holder: Holder;
  link: RoomLink;
  purpose: string;
  expectedReturnAt: Date | null;
  issuedAt: Date;
  actorUserId: string;
  entryMethod: EntryMethod;
  idempotencyKey: string | null;
  previousIssuanceId: string | null;
  historyType: "ISSUED" | "TRANSFERRED_IN" | "REPLACED_IN";
  reason: string | null;
};

async function writeNewIssuance(tx: Tx, p: NewIssuance) {
  const id = randomUUID();
  const issuance = await tx.assetIssuance.create({
    data: {
      id, eventId: p.eventId, assetId: p.assetId, serialized: p.serialized, quantity: p.quantity,
      assigneeKind: p.holder.kind, attendeeId: p.holder.attendeeId, registrationId: p.holder.registrationId, staffUserId: p.holder.staffUserId,
      roomUnitId: p.holder.kind === "ROOM" ? p.holder.roomUnitId : p.link.roomUnitId, sourceAssignmentId: p.link.sourceAssignmentId, assigneeLabel: p.holder.assigneeLabel,
      purpose: p.purpose, expectedReturnAt: p.expectedReturnAt, issuedAt: p.issuedAt, issuedByUserId: p.actorUserId, entryMethod: p.entryMethod,
      idempotencyKey: p.idempotencyKey, previousIssuanceId: p.previousIssuanceId, revision: 1,
    },
  });
  await tx.assetIssuanceHistory.create({
    data: {
      eventId: p.eventId, issuanceId: id, assetId: p.assetId, type: p.historyType, at: p.issuedAt, actorUserId: p.actorUserId, reason: p.reason,
      entryMethod: p.entryMethod, quantity: p.quantity, assigneeKind: issuance.assigneeKind, attendeeId: issuance.attendeeId, registrationId: issuance.registrationId,
      staffUserId: issuance.staffUserId, roomUnitId: issuance.roomUnitId, sourceAssignmentId: issuance.sourceAssignmentId, assigneeLabel: issuance.assigneeLabel,
      relatedIssuanceId: p.previousIssuanceId, revision: 1,
    },
  });
  return issuance;
}

/** Ends an open issuance and appends its history row. The `endedAt IS NULL` condition makes a double end impossible. */
async function endIssuance(tx: Tx, row: OpenIssuance, p: { actorUserId: string; endReason: "TRANSFERRED" | "REPLACED" | "CORRECTED"; historyType: "TRANSFERRED_OUT" | "REPLACED_OUT" | "CORRECTED"; reason: string; entryMethod: EntryMethod; relatedIssuanceId: string | null; at: Date }) {
  const revision = row.revision + 1;
  const ended = await tx.assetIssuance.updateMany({
    where: { id: row.id, endedAt: null },
    data: { endedAt: p.at, endReason: p.endReason, endedByUserId: p.actorUserId, endNote: p.reason, revision },
  });
  if (ended.count !== 1) throw new AssetError("ISSUANCE_NOT_OPEN", "That issue was already ended by someone else.");
  await tx.assetIssuanceHistory.create({
    data: {
      eventId: row.eventId, issuanceId: row.id, assetId: row.assetId, type: p.historyType, at: p.at, actorUserId: p.actorUserId, reason: p.reason,
      entryMethod: p.entryMethod, quantity: row.quantity, assigneeKind: row.assigneeKind, attendeeId: row.attendeeId, registrationId: row.registrationId,
      staffUserId: row.staffUserId, roomUnitId: row.roomUnitId, sourceAssignmentId: row.sourceAssignmentId, assigneeLabel: row.assigneeLabel,
      relatedIssuanceId: p.relatedIssuanceId, revision,
    },
  });
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export type IssueItemResult = {
  index: number;
  code: string;
  status: "ISSUED" | "DUPLICATE" | "REPLAYED" | "REJECTED";
  issuanceId?: string;
  assetId?: string;
  identifier?: string;
  typeName?: string;
  quantity?: number;
  error?: { code: ItemErrorCode | "IDEMPOTENCY_KEY_REUSED"; message: string };
};

export type IssueResult = {
  holder: { kind: AssigneeKind; display: string };
  issued: number;
  duplicates: number;
  rejected: number;
  items: IssueItemResult[];
};

/**
 * Issues one or several items to one holder in one transaction: a family's two keys and welcome packet, a team's
 * radios. A manual entry, a barcode scan and an offline entry sent later are all this function.
 *
 * - Items that cannot be issued are reported per item and the others are issued (`atomic: false`, the default), or
 *   nothing is issued and `ITEMS_REJECTED` carries the per-item reasons (`atomic: true`).
 * - A repeated scan for the same holder is a DUPLICATE: nothing changes. A key held by someone else is refused.
 * - A quantity lot is never over-issued, and a serialized asset is never open twice, even when staff race.
 * - A saved `idempotencyKey` makes a retry (a lost response, an offline queue replay) return the original result.
 */
export async function issueAssets(eventId: string, actorUserId: string, rawInput: unknown): Promise<IssueResult> {
  const input = issueRequestSchema.parse(rawInput);
  const now = new Date();
  const issuedAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (input.occurredAt && !plausibleOccurredAt(issuedAt, now)) {
    throw new AssetError("OCCURRED_AT_INVALID", "That time is too far in the past or the future. Check the device clock.");
  }
  const expectedReturnAt = input.expectedReturnAt ? new Date(input.expectedReturnAt) : null;
  if (expectedReturnAt && expectedReturnAt < issuedAt) throw new AssetError("OCCURRED_AT_INVALID", "The expected return cannot be before the issue time.");
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    const holder = await resolveHolder(tx, eventId, input.assignee);
    const key = holderKey(holder);

    // Resolve every code first (no locks yet), then lock the assets together, in order, and re-read under the locks.
    const resolved = await Promise.all(input.items.map((item) => resolveAssetByCode(tx, eventId, item.code)));
    await lockAssets(tx, eventId, resolved.flatMap((row) => (row ? [row.id] : [])));
    const assetIds = [...new Set(resolved.flatMap((row) => (row ? [row.id] : [])))];
    const assets = await tx.issuedAsset.findMany({ where: { eventId, id: { in: assetIds } }, include: { assetType: true } });
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const openRows = await tx.assetIssuance.findMany({ where: { eventId, assetId: { in: assetIds }, endedAt: null } });

    const itemKeys = input.items.map((_, index) => (input.idempotencyKey ? `${input.idempotencyKey}:${index}` : null));
    const replayRows = input.idempotencyKey
      ? await tx.assetIssuance.findMany({ where: { eventId, idempotencyKey: { in: itemKeys.filter((value): value is string => value !== null) } } })
      : [];
    const replayByKey = new Map(replayRows.map((row) => [row.idempotencyKey!, row]));

    type LinkOutcome = RoomLink | { error: AssetError };
    let linkOutcome: LinkOutcome | undefined;
    const needLink = async (): Promise<LinkOutcome> => {
      if (!linkOutcome) {
        try {
          linkOutcome = await resolveRoomLink(tx, eventId, holder, input.assignmentId, issuedAt, input.entryMethod);
        } catch (error) {
          if (!(error instanceof AssetError)) throw error;
          linkOutcome = { error };
        }
      }
      return linkOutcome;
    };

    const results: IssueItemResult[] = [];
    const toWrite: Array<{ index: number; assetId: string; serialized: boolean; quantity: number; link: RoomLink; itemKey: string | null }> = [];
    const seen = new Set<string>();
    for (const [index, item] of input.items.entries()) {
      const base = { index, code: item.code };
      const asset = resolved[index] ? assetsById.get(resolved[index]!.id) : undefined;
      const replay = itemKeys[index] ? replayByKey.get(itemKeys[index]!) : undefined;
      if (replay) {
        if (!asset || replay.assetId !== asset.id || !sameHolder(rowHolderKey(replay), key)) {
          throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different issue.");
        }
        results.push({ ...base, status: "REPLAYED", issuanceId: replay.id, assetId: asset.id, identifier: asset.identifier, typeName: asset.assetType.name, quantity: replay.quantity });
        seen.add(asset.id);
        continue;
      }
      if (!asset) {
        results.push({ ...base, status: "REJECTED", error: { code: "ASSET_NOT_FOUND", message: `No item has the code ${normalizeAssetCode(item.code)}.` } });
        continue;
      }
      const named = { assetId: asset.id, identifier: asset.identifier, typeName: asset.assetType.name };
      if (seen.has(asset.id)) {
        results.push({ ...base, ...named, status: "REJECTED", error: { code: "DUPLICATE_IN_REQUEST", message: "That item appears twice in this request." } });
        continue;
      }
      seen.add(asset.id);
      const open = openRows.filter((row) => row.assetId === asset.id).map((row) => ({ id: row.id, quantity: row.quantity, holder: rowHolderKey(row) }));
      const decision = decideIssue({
        type: { active: asset.assetType.active, mode: asset.assetType.mode as AssetMode, assigneeKinds: asset.assetType.assigneeKinds },
        asset: { availability: asset.availability, quantityTotal: asset.quantityTotal },
        holder: key, open, quantity: item.quantity, addMore: item.addMore,
      });
      if (decision.outcome === "DUPLICATE") {
        results.push({ ...base, ...named, status: "DUPLICATE", issuanceId: decision.issuanceId });
        continue;
      }
      if (decision.outcome === "REJECT") {
        results.push({ ...base, ...named, status: "REJECTED", error: { code: decision.code, message: decision.message } });
        continue;
      }
      let itemLink: RoomLink = { roomUnitId: holder.kind === "ROOM" ? holder.roomUnitId : null, sourceAssignmentId: null };
      if (asset.assetType.roomLinked && (holder.kind === "ATTENDEE" || holder.kind === "REGISTRATION" || holder.kind === "ROOM")) {
        const resolvedLink = await needLink();
        if ("error" in resolvedLink) {
          results.push({ ...base, ...named, status: "REJECTED", error: { code: resolvedLink.error.code as ItemErrorCode, message: resolvedLink.error.message } });
          continue;
        }
        itemLink = resolvedLink;
      }
      toWrite.push({ index, assetId: asset.id, serialized: asset.assetType.mode === "SERIALIZED", quantity: decision.quantity, link: itemLink, itemKey: itemKeys[index] ?? null });
      results.push({ ...base, ...named, status: "ISSUED", quantity: decision.quantity });
    }

    const rejected = results.filter((result) => result.status === "REJECTED");
    if (input.atomic && rejected.length > 0) {
      throw new AssetError("ITEMS_REJECTED", rejected[0]!.error?.message ?? "Some items could not be issued.", { items: results });
    }
    for (const write of toWrite) {
      const issuance = await writeNewIssuance(tx, {
        eventId, assetId: write.assetId, serialized: write.serialized, quantity: write.quantity, holder, link: write.link,
        purpose: input.purpose, expectedReturnAt, issuedAt, actorUserId, entryMethod: input.entryMethod, idempotencyKey: write.itemKey,
        previousIssuanceId: null, historyType: "ISSUED", reason: null,
      });
      results[write.index]!.issuanceId = issuance.id;
    }
    if (toWrite.length > 0) {
      await writeAuditLog({
        eventId, actorUserId, action: "ASSET_ISSUED", entityType: "AssetIssuance", entityId: results[toWrite[0]!.index]!.issuanceId,
        summary: `Issued ${toWrite.length} item${toWrite.length === 1 ? "" : "s"}.`,
        metadata: { holderKind: holder.kind, entryMethod: input.entryMethod, assetIds: toWrite.map((write) => write.assetId).slice(0, 50), rejected: rejected.length },
      }, tx);
    }
    return {
      holder: { kind: holder.kind, display: holder.display },
      issued: toWrite.length,
      duplicates: results.filter((result) => result.status === "DUPLICATE" || result.status === "REPLAYED").length,
      rejected: rejected.length,
      items: results,
    };
  });
}

// ---------------------------------------------------------------------------
// Transfer, replace, correct
// ---------------------------------------------------------------------------

async function loadOpenIssuance(tx: Tx, eventId: string, issuanceId: string) {
  const row = await tx.assetIssuance.findFirst({ where: { id: issuanceId, eventId } });
  if (!row) throw new AssetError("ISSUANCE_NOT_FOUND", "That issue was not found.");
  return row;
}

/**
 * Transfers, replaces or corrects one open issuance. None of them overwrites: the old issuance ends (with its reason
 * and actor) and, for a transfer or replacement, a new one starts that points back at it; both get history rows.
 */
export async function applyIssuanceAction(eventId: string, actorUserId: string, issuanceId: string, rawInput: unknown) {
  const input = issuanceActionSchema.parse(rawInput);
  return transact(async (tx) => {
    await requireEvent(tx, eventId);
    const first = await loadOpenIssuance(tx, eventId, issuanceId);
    let replacement: { id: string } | null = null;
    let replacementCode = "";
    if (input.action === "replace") {
      replacementCode = normalizeAssetCode(input.replacementCode);
      replacement = await resolveAssetByCode(tx, eventId, replacementCode);
      if (!replacement) throw new AssetError("ASSET_NOT_FOUND", `No item has the code ${replacementCode}.`);
      if (replacement.id === first.assetId) throw new AssetError("SAME_ASSET", "That is the item already issued. Scan the replacement.");
    }
    await lockAssets(tx, eventId, [first.assetId, ...(replacement ? [replacement.id] : [])]);
    const old = await loadOpenIssuance(tx, eventId, issuanceId);
    const now = new Date();
    const asset = await tx.issuedAsset.findFirstOrThrow({ where: { id: old.assetId, eventId }, include: { assetType: true } });

    if (input.action === "correct") {
      if (old.endedAt) throw new AssetError("ISSUANCE_NOT_OPEN", "That issue has already ended.");
      await endIssuance(tx, old, { actorUserId, endReason: "CORRECTED", historyType: "CORRECTED", reason: input.reason, entryMethod: "MANUAL", relatedIssuanceId: null, at: now });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_ISSUE_CORRECTED", entityType: "AssetIssuance", entityId: old.id, summary: "Corrected (withdrew) an issued item entered in error.", metadata: { assetId: old.assetId } }, tx);
      return { endedIssuanceId: old.id, issuanceId: null as string | null };
    }
    if (old.endedAt) throw new AssetError("ISSUANCE_NOT_OPEN", "That issue has already ended.");

    if (input.idempotencyKey) {
      const replay = await tx.assetIssuance.findUnique({ where: { eventId_idempotencyKey: { eventId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.previousIssuanceId !== old.id) throw new AssetError("IDEMPOTENCY_KEY_REUSED", "That saved retry key was already used for a different change.");
        return { endedIssuanceId: old.id, issuanceId: replay.id as string | null };
      }
    }

    if (input.action === "transfer") {
      const holder = await resolveHolder(tx, eventId, input.to);
      if (sameHolder(holderKey(holder), rowHolderKey(old))) throw new AssetError("SAME_HOLDER", "That item is already issued to them.");
      if (!asset.assetType.assigneeKinds.includes(holder.kind)) throw new AssetError("ASSIGNEE_KIND_NOT_ALLOWED", "That kind of item cannot be issued to that kind of holder.");
      const link: RoomLink = asset.assetType.roomLinked && (holder.kind === "ATTENDEE" || holder.kind === "REGISTRATION" || holder.kind === "ROOM")
        ? await resolveRoomLink(tx, eventId, holder, input.assignmentId, now, "MANUAL")
        : { roomUnitId: holder.kind === "ROOM" ? holder.roomUnitId : null, sourceAssignmentId: null };
      const created = await moveToNew(tx, old, asset.assetType.mode === "SERIALIZED", asset.id, holder, link, { actorUserId, reason: input.reason, endReason: "TRANSFERRED", outType: "TRANSFERRED_OUT", inType: "TRANSFERRED_IN", idempotencyKey: input.idempotencyKey ?? null, now });
      await writeAuditLog({ eventId, actorUserId, action: "ASSET_TRANSFERRED", entityType: "AssetIssuance", entityId: created.id, summary: "Transferred an issued item to another holder.", metadata: { assetId: asset.id, from: old.id, toKind: holder.kind } }, tx);
      return { endedIssuanceId: old.id, issuanceId: created.id as string | null };
    }

    // replace: the same holder gets another item of the same type; the original ends as REPLACED.
    const next = await tx.issuedAsset.findFirstOrThrow({ where: { id: replacement!.id, eventId }, include: { assetType: true } });
    if (next.assetTypeId !== asset.assetTypeId) throw new AssetError("REPLACEMENT_TYPE_MISMATCH", "The replacement must be the same kind of item.");
    const holderInput: AssigneeInput = old.assigneeKind === "ATTENDEE" ? { kind: "ATTENDEE", attendeeId: old.attendeeId! }
      : old.assigneeKind === "REGISTRATION" ? { kind: "REGISTRATION", registrationId: old.registrationId! }
      : old.assigneeKind === "STAFF" ? { kind: "STAFF", userId: old.staffUserId! }
      : old.assigneeKind === "ROOM" ? { kind: "ROOM", eventUnitId: old.roomUnitId! }
      : { kind: old.assigneeKind, label: old.assigneeLabel! };
    const holder = await resolveHolder(tx, eventId, holderInput);
    const open = (await tx.assetIssuance.findMany({ where: { eventId, assetId: next.id, endedAt: null } })).map((row) => ({ id: row.id, quantity: row.quantity, holder: rowHolderKey(row) }));
    const decision = decideIssue({
      type: { active: true, mode: next.assetType.mode as AssetMode, assigneeKinds: next.assetType.assigneeKinds },
      asset: { availability: next.availability, quantityTotal: next.quantityTotal },
      holder: holderKey(holder), open, quantity: old.quantity, addMore: true,
    });
    if (decision.outcome === "REJECT") throw new AssetError(decision.code, `The replacement: ${decision.message}`);
    if (decision.outcome === "DUPLICATE") throw new AssetError("ALREADY_ISSUED", "The replacement is already issued to this holder.");
    // A room-linked replacement follows the holder's lodging today: the assignment staff chose, or the one still current.
    let link: RoomLink = { roomUnitId: old.roomUnitId, sourceAssignmentId: old.sourceAssignmentId };
    if (asset.assetType.roomLinked && (holder.kind === "ATTENDEE" || holder.kind === "REGISTRATION" || holder.kind === "ROOM")) {
      const keepOld = !input.assignmentId && old.sourceAssignmentId
        ? await tx.eventLodgingAssignment.findFirst({ where: { id: old.sourceAssignmentId, eventId, cancelledAt: null }, select: { id: true } })
        : null;
      link = keepOld ? { roomUnitId: old.roomUnitId, sourceAssignmentId: old.sourceAssignmentId } : await resolveRoomLink(tx, eventId, holder, input.assignmentId, now, "MANUAL");
    }
    const created = await moveToNew(tx, old, next.assetType.mode === "SERIALIZED", next.id, holder, link, { actorUserId, reason: input.reason, endReason: "REPLACED", outType: "REPLACED_OUT", inType: "REPLACED_IN", idempotencyKey: input.idempotencyKey ?? null, now });
    await tx.issuedAsset.update({ where: { id: asset.id }, data: { availability: input.originalAvailability } });
    await writeAuditLog({ eventId, actorUserId, action: "ASSET_REPLACED", entityType: "AssetIssuance", entityId: created.id, summary: "Replaced an issued item.", metadata: { from: old.id, originalAssetId: asset.id, replacementAssetId: next.id, originalAvailability: input.originalAvailability } }, tx);
    return { endedIssuanceId: old.id, issuanceId: created.id as string | null };
  });
}

async function moveToNew(
  tx: Tx, old: OpenIssuance, serialized: boolean, newAssetId: string, holder: Holder, link: RoomLink,
  p: { actorUserId: string; reason: string; endReason: "TRANSFERRED" | "REPLACED"; outType: "TRANSFERRED_OUT" | "REPLACED_OUT"; inType: "TRANSFERRED_IN" | "REPLACED_IN"; idempotencyKey: string | null; now: Date },
) {
  const newId = randomUUID();
  // End first so the freed quantity or serialized slot is visible to the new issue's checks.
  await endIssuance(tx, old, { actorUserId: p.actorUserId, endReason: p.endReason, historyType: p.outType, reason: p.reason, entryMethod: "MANUAL", relatedIssuanceId: newId, at: p.now });
  const created = await tx.assetIssuance.create({
    data: {
      id: newId, eventId: old.eventId, assetId: newAssetId, serialized, quantity: old.quantity,
      assigneeKind: holder.kind, attendeeId: holder.attendeeId, registrationId: holder.registrationId, staffUserId: holder.staffUserId,
      roomUnitId: holder.kind === "ROOM" ? holder.roomUnitId : link.roomUnitId, sourceAssignmentId: link.sourceAssignmentId, assigneeLabel: holder.assigneeLabel,
      purpose: old.purpose, expectedReturnAt: old.expectedReturnAt, issuedAt: p.now, issuedByUserId: p.actorUserId, entryMethod: "MANUAL",
      idempotencyKey: p.idempotencyKey, previousIssuanceId: old.id, revision: 1,
    },
  });
  await tx.assetIssuanceHistory.create({
    data: {
      eventId: old.eventId, issuanceId: newId, assetId: newAssetId, type: p.inType, at: p.now, actorUserId: p.actorUserId, reason: p.reason, entryMethod: "MANUAL",
      quantity: old.quantity, assigneeKind: created.assigneeKind, attendeeId: created.attendeeId, registrationId: created.registrationId, staffUserId: created.staffUserId,
      roomUnitId: created.roomUnitId, sourceAssignmentId: created.sourceAssignmentId, assigneeLabel: created.assigneeLabel, relatedIssuanceId: old.id, revision: 1,
    },
  });
  return created;
}
