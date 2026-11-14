import { z } from "zod";
import type { EventPermission } from "@/modules/access/permissions";
import {
  DOMAIN_PERMISSIONS,
  parseOperationsSearchParams,
  serializeOperationsSearchQuery,
} from "@/modules/registrations/operations-search-domain";

/**
 * Reviewed bulk actions over registrations, the pure half (#182).
 *
 * The action key is a CLOSED allowlist. There is no generic "set a field" action: anything outside the list is refused
 * with the page that owns that work. A new action is a new key here, a catalog entry, and a handler in the repository.
 * Nothing in this file touches the database.
 */

export const BULK_ACTION_KEYS = ["APPLY_TAG", "REMOVE_TAG", "EXPORT_FIELDS"] as const;
export type BulkActionKey = (typeof BULK_ACTION_KEYS)[number];

/** Registrations are the unit of every action in this slice. */
export const BULK_RECORD_UNIT = "registrations";

/** More than this is refused as too broad. It is never truncated to fit. */
export const TAG_ACTION_MAX_RECORDS = 500;
export const EXPORT_ACTION_MAX_RECORDS = 5000;

/** A preview is good for this long. After that the person previews again. */
export const PREVIEW_TTL_MINUTES = 30;

/** A run still APPLYING after this long is treated as stopped, and ended on the next retry. */
export const APPLYING_STALE_MINUTES = 10;

/** At most this many non-completed records are listed by confirmation code in one summary. */
export const NOT_COMPLETED_LIST_MAX = 200;

export type BulkActionErrorCode =
  | "RESTRICTED_ACTION"
  | "INVALID_REQUEST"
  | "PERMISSION_DENIED"
  | "TOO_BROAD"
  | "NOTHING_TO_DO"
  | "SEARCH_UNAVAILABLE"
  | "TAG_UNAVAILABLE"
  | "NOT_FOUND"
  | "WRONG_ACTOR"
  | "EXPIRED"
  | "ALREADY_CONFIRMED"
  | "IN_PROGRESS"
  | "KEY_IN_USE";

/** A refusal with a message a person can act on. Never carries personal data. */
export class BulkActionError extends Error {
  constructor(public readonly code: BulkActionErrorCode, message: string, public readonly status = 400) {
    super(message);
    this.name = "BulkActionError";
  }
}

export type BulkActionOutcomeKey = "COMPLETED" | "SKIPPED" | "CONFLICT" | "FAILED" | "OBSOLETE";

/** Short codes for why a record did not complete. No free text and no personal data. */
export const REASON_LABELS = {
  ALREADY_APPLIED: "The tag was already on it.",
  NOT_APPLIED: "The tag was not on it.",
  RECORD_CHANGED: "It changed after the preview, so it was left alone.",
  NO_LONGER_MATCHES: "It no longer matches the filter.",
  WRITE_FAILED: "The change could not be saved.",
  NOT_CHANGED: "Nothing was changed for this one.",
  INTERRUPTED: "The action stopped before this one. Check it before trying again.",
} as const;
export type BulkReasonCode = keyof typeof REASON_LABELS;

export function reasonLabel(code: string | null | undefined) {
  return code && code in REASON_LABELS ? REASON_LABELS[code as BulkReasonCode] : "";
}

/* ---------- restricted-domain guard ---------- */

const RESTRICTED_GUIDES: ReadonlyArray<readonly [RegExp, string]> = [
  [/refund/, "Refunds are issued one registration at a time from its payments, by someone with finance access."],
  [/cancel|reactivat|waitlist|promote/, "Cancellations, reactivations and waitlist changes go through the registration's own lifecycle actions."],
  [/transfer|substitut/, "Transfers and substitutions are reviewed one registration at a time from the registration's page."],
  [/merge|identity|duplicate|person_match/, "Identity merges are reviewed on the possible duplicates pages, never in bulk."],
  [/protected|medical|health|consent|insurance|allerg|note/, "Protected records are handled only on their own pages, by the people allowed to see them."],
  [/lodging|room|session|class|assign|seat|bed/, "Lodging and session assignments are made on the Lodging and Classes pages."],
  [/payment|price|pricing|capacity|total|balance|discount|fee|charge|invoice/, "Payment, price and capacity changes are made on the Finance and Event setup pages."],
];

const GENERIC_GUIDE = "Bulk actions can apply a tag, remove a tag or export approved fields. For anything else, use the page that is built for it.";

/** The action a request names, or a refusal that names the page to use. Never throws for an unknown key; it refuses. */
export function parseBulkActionKey(raw: unknown): { ok: true; key: BulkActionKey } | { ok: false; message: string } {
  if (typeof raw === "string" && (BULK_ACTION_KEYS as readonly string[]).includes(raw)) return { ok: true, key: raw as BulkActionKey };
  const normalized = typeof raw === "string" ? raw.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "";
  const guide = RESTRICTED_GUIDES.find(([pattern]) => pattern.test(normalized));
  return { ok: false, message: `That action is not available as a bulk action. ${guide ? guide[1] : GENERIC_GUIDE}` };
}

/* ---------- catalog ---------- */

export type BulkActionCatalogEntry = {
  key: BulkActionKey;
  label: string;
  /** The viewer needs all of these, on top of the base access to the People list. */
  permissions: readonly EventPermission[];
  maxRecords: number;
  /** Said in the preview. */
  effect: string;
  createsFile: boolean;
};

/** The base access every bulk action needs: the same as the People page. */
export const BULK_BASE_PERMISSION: EventPermission = "VIEW_SENSITIVE_DATA";

export const BULK_ACTION_CATALOG: Record<BulkActionKey, BulkActionCatalogEntry> = {
  APPLY_TAG: {
    key: "APPLY_TAG",
    label: "Apply a tag",
    permissions: ["MANAGE_REGISTRATION"],
    maxRecords: TAG_ACTION_MAX_RECORDS,
    effect: "Puts the tag on each registration that does not have it. Registrations that already have it are skipped.",
    createsFile: false,
  },
  REMOVE_TAG: {
    key: "REMOVE_TAG",
    label: "Remove a tag",
    permissions: ["MANAGE_REGISTRATION"],
    maxRecords: TAG_ACTION_MAX_RECORDS,
    effect: "Takes the tag off each registration that has it. The history of who applied and removed it is kept.",
    createsFile: false,
  },
  EXPORT_FIELDS: {
    key: "EXPORT_FIELDS",
    label: "Export selected fields (CSV)",
    permissions: ["VIEW_REPORTS", "VIEW_SENSITIVE_DATA"],
    maxRecords: EXPORT_ACTION_MAX_RECORDS,
    effect: "Creates a CSV file with the fields you chose. The file is made once, when you confirm, and is not kept. To export again, preview again.",
    createsFile: true,
  },
};

export function isTagAction(key: BulkActionKey) {
  return key === "APPLY_TAG" || key === "REMOVE_TAG";
}

/* ---------- export fields ---------- */

export type ExportFieldKey =
  | "code" | "status" | "attendeeCount" | "submittedAt"
  | "contactName" | "contactEmail" | "contactPhone"
  | "tags" | "balance" | "paymentState";

export type ExportFieldSpec = {
  key: ExportFieldKey;
  label: string;
  /** The viewer needs any one of these. */
  permissions: readonly EventPermission[];
  personal: boolean;
};

/**
 * The approved fields. Health, medical, consent evidence, restricted notes and insurance are not here and cannot be
 * added by a request: a key outside this list is invalid.
 */
export const EXPORT_FIELDS: readonly ExportFieldSpec[] = [
  { key: "code", label: "Confirmation code", permissions: ["VIEW_EVENT"], personal: false },
  { key: "status", label: "Status", permissions: ["VIEW_EVENT"], personal: false },
  { key: "attendeeCount", label: "Number of attendees", permissions: ["VIEW_EVENT"], personal: false },
  { key: "submittedAt", label: "Submitted (ISO 8601)", permissions: ["VIEW_EVENT"], personal: false },
  { key: "contactName", label: "Primary contact name", permissions: ["VIEW_SENSITIVE_DATA"], personal: true },
  { key: "contactEmail", label: "Primary contact email", permissions: ["VIEW_SENSITIVE_DATA"], personal: true },
  { key: "contactPhone", label: "Primary contact phone", permissions: ["VIEW_SENSITIVE_DATA"], personal: true },
  { key: "tags", label: "Tags", permissions: DOMAIN_PERMISSIONS.tags, personal: false },
  { key: "balance", label: "Balance", permissions: ["MANAGE_FINANCE"], personal: false },
  { key: "paymentState", label: "Payment state", permissions: ["MANAGE_FINANCE"], personal: false },
];

const EXPORT_FIELD_KEYS = EXPORT_FIELDS.map((field) => field.key) as [ExportFieldKey, ...ExportFieldKey[]];

export function exportFieldSpec(key: string) {
  return EXPORT_FIELDS.find((field) => field.key === key);
}

/* ---------- parameters ---------- */

const tagParamsSchema = z.strictObject({ tagId: z.string().trim().min(1).max(100) });
const exportParamsSchema = z.strictObject({ fields: z.array(z.enum(EXPORT_FIELD_KEYS)).min(1).max(EXPORT_FIELDS.length) });

export type BulkActionParams =
  | { action: "APPLY_TAG" | "REMOVE_TAG"; tagId: string }
  | { action: "EXPORT_FIELDS"; fields: ExportFieldKey[] };

/** What is stored on the run: the tag id, or the field keys in the order the file will have them. */
export type StoredParams = { tagId: string } | { fields: ExportFieldKey[] };

function invalid(message: string): never {
  throw new BulkActionError("INVALID_REQUEST", message);
}

/** Parse the action's parameters. A field key that is not approved is invalid, never dropped. */
export function parseBulkParams(action: BulkActionKey, raw: unknown): BulkActionParams {
  if (isTagAction(action)) {
    const parsed = tagParamsSchema.safeParse(raw);
    if (!parsed.success) invalid("Choose a tag.");
    return { action: action as "APPLY_TAG" | "REMOVE_TAG", tagId: parsed.data.tagId };
  }
  const parsed = exportParamsSchema.safeParse(raw);
  if (!parsed.success) invalid("Choose at least one of the approved fields to export.");
  const fields = [...new Set(parsed.data.fields)];
  return { action: "EXPORT_FIELDS", fields };
}

export function storedParams(params: BulkActionParams): StoredParams {
  return params.action === "EXPORT_FIELDS" ? { fields: params.fields } : { tagId: params.tagId };
}

export function paramsFromStored(action: BulkActionKey, stored: unknown): BulkActionParams {
  return parseBulkParams(action, stored);
}

/* ---------- permissions ---------- */

/** Everything the viewer lacks for this action and its fields, as readable names. Empty means allowed. */
export function missingForAction(params: BulkActionParams, permissions: readonly EventPermission[]): string[] {
  const missing: string[] = [];
  if (!permissions.includes(BULK_BASE_PERMISSION)) missing.push("viewing registration records");
  for (const needed of BULK_ACTION_CATALOG[params.action].permissions) {
    if (!permissions.includes(needed)) missing.push(permissionName(needed));
  }
  if (params.action === "EXPORT_FIELDS") {
    for (const key of params.fields) {
      const spec = exportFieldSpec(key);
      if (spec && !spec.permissions.some((needed) => permissions.includes(needed))) missing.push(`the "${spec.label}" field`);
    }
  }
  return [...new Set(missing)];
}

function permissionName(permission: EventPermission) {
  switch (permission) {
    case "MANAGE_REGISTRATION": return "managing registrations";
    case "VIEW_REPORTS": return "downloading reports";
    case "VIEW_SENSITIVE_DATA": return "viewing registration records";
    case "MANAGE_FINANCE": return "finance";
    default: return permission.toLowerCase().replaceAll("_", " ");
  }
}

/** The permissions the preview says this run uses. */
export function permissionsUsed(params: BulkActionParams): string[] {
  const used = new Set<string>([permissionName(BULK_BASE_PERMISSION), ...BULK_ACTION_CATALOG[params.action].permissions.map(permissionName)]);
  if (params.action === "EXPORT_FIELDS") {
    for (const key of params.fields) {
      const spec = exportFieldSpec(key);
      if (spec && spec.permissions.length === 1) used.add(permissionName(spec.permissions[0]));
    }
  }
  return [...used];
}

/* ---------- idempotency, fingerprint, tallies ---------- */

export const idempotencyKeySchema = z.string().trim().min(8, "The confirmation key is too short.").max(100, "The confirmation key is too long.").regex(/^[A-Za-z0-9._:-]+$/, "The confirmation key has characters that are not allowed.");

export type SnapshotEntry = { id: string; v: string };

export type OutcomeCounts = { completed: number; skipped: number; conflict: number; failed: number; obsolete: number };

export function emptyCounts(): OutcomeCounts {
  return { completed: 0, skipped: 0, conflict: 0, failed: 0, obsolete: 0 };
}

export function tallyOutcomes(outcomes: ReadonlyArray<{ outcome: BulkActionOutcomeKey }>): OutcomeCounts {
  const counts = emptyCounts();
  for (const { outcome } of outcomes) counts[outcome.toLowerCase() as keyof OutcomeCounts] += 1;
  return counts;
}

/** Canonical order for summaries: the states a person must look at come first. */
export const OUTCOME_ORDER: readonly BulkActionOutcomeKey[] = ["FAILED", "CONFLICT", "OBSOLETE", "SKIPPED", "COMPLETED"];

export const OUTCOME_LABELS: Record<BulkActionOutcomeKey, string> = {
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
  CONFLICT: "Changed since preview",
  FAILED: "Failed",
  OBSOLETE: "No longer matches",
};

/** The `where` for a run that is past its preview window. */
export function isExpired(run: { expiresAt: Date }, now: Date) {
  return run.expiresAt.getTime() <= now.getTime();
}

/* ---------- the scope, in words ---------- */

/**
 * The query as the audit trail keeps it: the same canonical string with the typed search text replaced, because a
 * person may have typed a name there. Every other filter is a stable key or value.
 */
export function auditQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  if (params.has("q")) params.set("q", "[text]");
  return params.toString();
}

/**
 * The active filters of a canonical query as short lines for the preview and the history. Choices that are ids (tags,
 * locations, organizations, attendee types, form answers) say how many were picked, never the ids.
 */
export function describeQueryFilters(queryString: string, options: { showText?: boolean } = {}): string[] {
  const { query } = parseOperationsSearchParams(new URLSearchParams(queryString));
  const lines: string[] = [];
  const words = (values: readonly string[]) => values.map((value) => value.toLowerCase().replaceAll("_", " ")).join(", ");
  const count = (label: string, values: readonly unknown[]) => { if (values.length) lines.push(`${label}: ${values.length} selected`); };
  if (query.text) lines.push(options.showText ? `Search text: "${query.text}"` : "Search text");
  if (query.status.length) lines.push(`Status: ${words(query.status)}`);
  count("Attendee type", query.attendeeType);
  if (query.source.length) lines.push(`Source: ${words(query.source)}`);
  count("Organization", query.organization);
  count("Location", query.location);
  if (query.waitlist.length) lines.push(`Waitlist: ${words(query.waitlist)}`);
  if (query.payment.length) lines.push(`Payment: ${words(query.payment)}`);
  if (query.checkIn) lines.push(`Check-in: ${words([query.checkIn])}`);
  count("Tag", query.tag);
  count("Form answer", query.answers);
  return lines;
}

/** The canonical form of a query string typed or carried by a link: no page, defaults left out. */
export function canonicalBulkQuery(raw: string) {
  const { query, issues } = parseOperationsSearchParams(new URLSearchParams(raw));
  return { queryString: serializeOperationsSearchQuery({ ...query, page: 1 }), issues };
}
