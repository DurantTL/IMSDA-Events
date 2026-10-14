import { z } from "zod";

/**
 * Issued assets (#213, slice 1): the pure rules, free of server-only imports so tests and client screens can use them.
 *
 * A *type* is serialized (one numbered item, one holder at a time: a key, a radio) or quantity (a lot of N identical
 * items: welcome packets, towels). An *asset* is one numbered item or one lot. An *issuance* is one holder's claim on
 * one asset. It changes only to end (transferred, replaced, corrected); every change appends to history.
 * Money is not modelled here. A type carries only a reference to the deposit or replacement policy; deposits, returns,
 * loss, damage and charges are slice 2 (#214), which adds end reasons and history types without rewriting these rows.
 */

export const assetModes = ["SERIALIZED", "QUANTITY"] as const;
export type AssetMode = (typeof assetModes)[number];

export const assigneeKinds = ["ATTENDEE", "REGISTRATION", "STAFF", "ROOM", "VEHICLE", "TEAM"] as const;
export type AssigneeKind = (typeof assigneeKinds)[number];

export const assigneeKindLabels: Record<AssigneeKind, string> = {
  ATTENDEE: "Attendee",
  REGISTRATION: "Registration",
  STAFF: "Staff member",
  ROOM: "Room",
  VEHICLE: "Vehicle",
  TEAM: "Team",
};

export const assetConditions = ["NEW", "GOOD", "WORN", "DAMAGED"] as const;
export type AssetCondition = (typeof assetConditions)[number];

export const assetAvailabilities = ["AVAILABLE", "UNAVAILABLE", "RETIRED"] as const;
export type AssetAvailability = (typeof assetAvailabilities)[number];

export const entryMethods = ["MANUAL", "SCAN", "OFFLINE"] as const;
export type EntryMethod = (typeof entryMethods)[number];

/** The most one request can issue (a family's keys and packets, a whole team's radios). */
export const MAX_ITEMS_PER_ISSUE = 50;
/** The most numbered items one range adds (K-201 to K-260 is 60). */
export const MAX_RANGE_SIZE = 500;
/** How far back an offline desk may say an issue happened, and how far ahead a skewed clock may be forgiven. */
export const OFFLINE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Check-in staff may correct (withdraw) an issue only this soon after the server recorded it; later needs event setup permission. */
export const CORRECTION_WINDOW_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * What staff type or a scanner reads: trimmed and upper case, so "k-214 " and "K-214" are the same key. The database
 * insists on the same form for stored identifiers and scan codes.
 */
export function normalizeAssetCode(raw: string) {
  return raw.trim().toUpperCase();
}

const codeShape = /^[A-Z0-9][A-Z0-9._\-/#]*$/;

export function isValidAssetCode(code: string) {
  return code.length >= 1 && code.length <= 64 && codeShape.test(code);
}

/**
 * Identifiers for a numbered range: prefix "K-", 201 to 260 gives K-201 … K-260. `width` zero-pads the number
 * (width 4: K-0007). Throws a plain message the screen can show.
 */
export function expandRange(prefix: string, from: number, to: number, width = 0): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) throw new Error("Use whole numbers from 0 up.");
  if (to < from) throw new Error("The last number cannot be below the first.");
  if (to - from + 1 > MAX_RANGE_SIZE) throw new Error(`Add at most ${MAX_RANGE_SIZE} items at a time.`);
  const cleanPrefix = normalizeAssetCode(prefix);
  const codes: string[] = [];
  for (let value = from; value <= to; value += 1) {
    const digits = width > 0 ? String(value).padStart(width, "0") : String(value);
    const code = `${cleanPrefix}${digits}`;
    if (!isValidAssetCode(code)) throw new Error(`"${code}" is not a usable code. Use letters, numbers and - . _ / # only.`);
    codes.push(code);
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const idSchema = z.string().trim().min(1).max(64);
const textSchema = (max: number) => z.string().trim().max(max);
const reasonSchema = z.string().trim().min(1, "Give a reason.").max(300);
const isoSchema = z.string().datetime({ offset: true });
const keySchema = z.string().trim().min(8).max(100);
const moneyCents = z.number().int().min(0).max(10_000_000);

export const assetTypeCreateSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(1, "Give the type a name.").max(80),
  mode: z.enum(assetModes),
  assigneeKinds: z.array(z.enum(assigneeKinds)).min(1, "Choose who it can be issued to.").max(assigneeKinds.length),
  roomLinked: z.boolean().default(false),
  depositPolicyRef: textSchema(120).optional(),
  replacementPolicyRef: textSchema(120).optional(),
  /** Slice 2 (#214), in cents: the usual cash deposit for one holder's items of this kind, and the fee to replace one. */
  depositCents: moneyCents.default(0),
  depositShortfall: z.enum(["KEEP_ALL", "KEEP_FEES"]).default("KEEP_ALL"),
  replacementFeeCents: moneyCents.default(0),
}).strict();

export const assetTypeUpdateSchema = z.object({
  action: z.literal("update"),
  typeId: idSchema,
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  assigneeKinds: z.array(z.enum(assigneeKinds)).min(1).max(assigneeKinds.length).optional(),
  roomLinked: z.boolean().optional(),
  depositPolicyRef: textSchema(120).optional(),
  replacementPolicyRef: textSchema(120).optional(),
  depositCents: moneyCents.optional(),
  depositShortfall: z.enum(["KEEP_ALL", "KEEP_FEES"]).optional(),
  replacementFeeCents: moneyCents.optional(),
}).strict();

export const assetTypeActionSchema = z.discriminatedUnion("action", [assetTypeCreateSchema, assetTypeUpdateSchema]);
export type AssetTypeAction = z.infer<typeof assetTypeActionSchema>;

const codeField = z.string().trim().min(1).max(64).transform(normalizeAssetCode).refine(isValidAssetCode, "Use letters, numbers and - . _ / # only.");

export const assetActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    typeId: idSchema,
    identifier: codeField,
    /** What the barcode or QR encodes; the identifier when left out. */
    scanCode: codeField.optional(),
    quantityTotal: z.number().int().min(1).max(100_000).default(1),
    condition: z.enum(assetConditions).default("GOOD"),
    location: textSchema(120).optional(),
  }).strict(),
  z.object({
    action: z.literal("bulk"),
    typeId: idSchema,
    prefix: z.string().trim().max(32).default(""),
    from: z.number().int().min(0).max(9_999_999),
    to: z.number().int().min(0).max(9_999_999),
    width: z.number().int().min(0).max(8).default(0),
    condition: z.enum(assetConditions).default("GOOD"),
    location: textSchema(120).optional(),
  }).strict(),
  z.object({
    action: z.literal("update"),
    assetId: idSchema,
    condition: z.enum(assetConditions).optional(),
    location: textSchema(120).optional(),
    availability: z.enum(assetAvailabilities).optional(),
    quantityTotal: z.number().int().min(1).max(100_000).optional(),
    scanCode: codeField.optional(),
  }).strict(),
]);
export type AssetAction = z.infer<typeof assetActionSchema>;

export const assigneeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ATTENDEE"), attendeeId: idSchema }).strict(),
  z.object({ kind: z.literal("REGISTRATION"), registrationId: idSchema }).strict(),
  z.object({ kind: z.literal("STAFF"), userId: idSchema }).strict(),
  z.object({ kind: z.literal("ROOM"), eventUnitId: idSchema }).strict(),
  z.object({ kind: z.literal("VEHICLE"), label: z.string().trim().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("TEAM"), label: z.string().trim().min(1).max(80) }).strict(),
]);
export type AssigneeInput = z.infer<typeof assigneeSchema>;

export const issueItemSchema = z.object({
  /** What was scanned or typed: a scan code or an identifier. Both paths resolve the same way. */
  code: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(100_000).default(1),
  /** A quantity item already issued to this holder is a repeated tap, not a second helping, unless this is set. */
  addMore: z.boolean().default(false),
}).strict();

const recordedAtRules = (value: { entryMethod: EntryMethod; occurredAt?: string }) => value.occurredAt === undefined || value.entryMethod === "OFFLINE";
const recordedAtMessage = { message: "Only an offline entry can say when it happened.", path: ["occurredAt"] };

export const issueRequestSchema = z.object({
  assignee: assigneeSchema,
  /** The lodging assignment room-linked items are issued against; found automatically when the holder has one room. */
  assignmentId: idSchema.optional(),
  items: z.array(issueItemSchema).min(1, "Add at least one item.").max(MAX_ITEMS_PER_ISSUE),
  purpose: z.string().trim().min(1).max(200).default("Issued at check-in"),
  expectedReturnAt: isoSchema.optional(),
  entryMethod: z.enum(entryMethods).default("MANUAL"),
  /** Offline entries: when it really happened on the device. */
  occurredAt: isoSchema.optional(),
  /** A client-saved key: a retry of the same request returns the original result and writes nothing twice. */
  idempotencyKey: keySchema.optional(),
  /** All or nothing. Off, items that cannot be issued are reported and the rest are issued. */
  atomic: z.boolean().default(false),
}).strict().refine(recordedAtRules, recordedAtMessage);
export type IssueRequest = z.infer<typeof issueRequestSchema>;

export const issuanceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transfer"),
    to: assigneeSchema,
    assignmentId: idSchema.optional(),
    reason: reasonSchema,
    idempotencyKey: keySchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("replace"),
    /** The replacement asset's scan code or identifier. */
    replacementCode: z.string().trim().min(1).max(64),
    assignmentId: idSchema.optional(),
    reason: reasonSchema,
    /** Where the original goes: back to stock now, or held out until slice 2 records its return or loss. */
    originalAvailability: z.enum(["AVAILABLE", "UNAVAILABLE"]).default("UNAVAILABLE"),
    idempotencyKey: keySchema.optional(),
  }).strict(),
  z.object({ action: z.literal("correct"), reason: reasonSchema }).strict(),
]);
export type IssuanceAction = z.infer<typeof issuanceActionSchema>;

// ---------------------------------------------------------------------------
// The decision for one item
// ---------------------------------------------------------------------------

export type ItemErrorCode =
  | "ASSET_NOT_FOUND"
  | "DUPLICATE_IN_REQUEST"
  | "TYPE_INACTIVE"
  | "ASSET_UNAVAILABLE"
  | "ASSIGNEE_KIND_NOT_ALLOWED"
  | "ALREADY_ISSUED"
  | "QUANTITY_INVALID"
  | "INSUFFICIENT_QUANTITY"
  | "ROOM_ASSIGNMENT_REQUIRED"
  | "ROOM_ASSIGNMENT_AMBIGUOUS"
  | "ROOM_ASSIGNMENT_INVALID"
  | "ROOM_ASSIGNMENT_MOVED"
  | "OCCURRED_AT_INVALID";

export type HolderKey = { kind: AssigneeKind; ref: string };

export const holderKeyOf = (holder: { kind: AssigneeKind; attendeeId?: string | null; registrationId?: string | null; staffUserId?: string | null; roomUnitId?: string | null; assigneeLabel?: string | null }): HolderKey => ({
  kind: holder.kind,
  ref: holder.kind === "ATTENDEE" ? holder.attendeeId ?? ""
    : holder.kind === "REGISTRATION" ? holder.registrationId ?? ""
    : holder.kind === "STAFF" ? holder.staffUserId ?? ""
    : holder.kind === "ROOM" ? holder.roomUnitId ?? ""
    : (holder.assigneeLabel ?? "").trim().toUpperCase(),
});

export const sameHolder = (a: HolderKey, b: HolderKey) => a.kind === b.kind && a.ref === b.ref && a.ref !== "";

export type DecideInput = {
  type: { active: boolean; mode: AssetMode; assigneeKinds: readonly AssigneeKind[] };
  asset: { availability: AssetAvailability; quantityTotal: number };
  holder: HolderKey;
  /** Every open issuance of this asset, as of now, under the asset's lock. */
  open: ReadonlyArray<{ id: string; quantity: number; holder: HolderKey }>;
  quantity: number;
  addMore: boolean;
};

export type Decision =
  | { outcome: "ISSUE"; quantity: number }
  | { outcome: "DUPLICATE"; issuanceId: string }
  | { outcome: "REJECT"; code: ItemErrorCode; message: string };

/**
 * The one rule set. A scan, a typed code and an offline entry all arrive here, through the same transactional issue
 * service, so they cannot disagree. A serialized asset is never open twice; a quantity lot is never over-issued; a
 * second scan for the same holder is a duplicate (and changes nothing), not an error.
 */
export function decideIssue(input: DecideInput): Decision {
  const { type, asset, holder, open } = input;
  if (!type.active) return { outcome: "REJECT", code: "TYPE_INACTIVE", message: "That kind of item is switched off." };
  if (asset.availability !== "AVAILABLE") {
    return { outcome: "REJECT", code: "ASSET_UNAVAILABLE", message: asset.availability === "RETIRED" ? "That item is retired." : "That item is marked unavailable." };
  }
  if (!type.assigneeKinds.includes(holder.kind)) {
    return { outcome: "REJECT", code: "ASSIGNEE_KIND_NOT_ALLOWED", message: `That kind of item cannot be issued to a ${assigneeKindLabels[holder.kind].toLowerCase()}.` };
  }
  if (type.mode === "SERIALIZED") {
    if (input.quantity !== 1) return { outcome: "REJECT", code: "QUANTITY_INVALID", message: "A numbered item is issued one at a time." };
    const existing = open[0];
    if (!existing) return { outcome: "ISSUE", quantity: 1 };
    if (sameHolder(existing.holder, holder)) return { outcome: "DUPLICATE", issuanceId: existing.id };
    return { outcome: "REJECT", code: "ALREADY_ISSUED", message: "That item is already issued to someone else." };
  }
  const mine = open.find((row) => sameHolder(row.holder, holder));
  if (mine && !input.addMore) return { outcome: "DUPLICATE", issuanceId: mine.id };
  const out = open.reduce((sum, row) => sum + row.quantity, 0);
  const left = asset.quantityTotal - out;
  if (input.quantity > left) {
    return { outcome: "REJECT", code: "INSUFFICIENT_QUANTITY", message: left <= 0 ? "None left to issue." : `Only ${left} left to issue.` };
  }
  return { outcome: "ISSUE", quantity: input.quantity };
}

// ---------------------------------------------------------------------------
// Lodging references
// ---------------------------------------------------------------------------

export type RoomCandidate = { assignmentId: string; unitId: string; firstNight: string; lastNight: string };

/**
 * Which of a holder's room assignments an item is issued against, when staff did not choose. One room is
 * unambiguous (the segment covering `onNight`, else the earliest). Several rooms need a choice; none is a refusal.
 */
export function pickRoomCandidate(candidates: readonly RoomCandidate[], onNight: string):
  | { ok: true; candidate: RoomCandidate }
  | { ok: false; code: "ROOM_ASSIGNMENT_REQUIRED" | "ROOM_ASSIGNMENT_AMBIGUOUS" } {
  if (candidates.length === 0) return { ok: false, code: "ROOM_ASSIGNMENT_REQUIRED" };
  const rooms = new Set(candidates.map((candidate) => candidate.unitId));
  if (rooms.size > 1) return { ok: false, code: "ROOM_ASSIGNMENT_AMBIGUOUS" };
  const sorted = [...candidates].sort((a, b) => a.firstNight.localeCompare(b.firstNight));
  const covering = sorted.find((candidate) => candidate.firstNight <= onNight && onNight <= candidate.lastNight);
  return { ok: true, candidate: covering ?? sorted[0]! };
}

export type LodgingReferenceStatus = "CURRENT" | "MOVED" | "RELEASED";

/**
 * How an issuance's remembered room relates to the holder's lodging today: still the current assignment, moved to
 * another room (the key opens the old one), or released with no room at all. Never rewrites anything; a read of both.
 */
export function lodgingReferenceStatus(source: { cancelledAt: Date | null } | null, currentRoomIds: readonly string[], keyRoomId: string | null): LodgingReferenceStatus | null {
  if (!source) return null;
  if (!source.cancelledAt) return "CURRENT";
  if (currentRoomIds.length === 0) return "RELEASED";
  return keyRoomId && currentRoomIds.includes(keyRoomId) ? "CURRENT" : "MOVED";
}

/** Accepts an offline entry's claimed time only when it is plausible (not in the future, not stale). */
export function plausibleOccurredAt(occurredAt: Date, now: Date) {
  const age = now.getTime() - occurredAt.getTime();
  return age >= -CLOCK_SKEW_MS && age <= OFFLINE_MAX_AGE_MS;
}
