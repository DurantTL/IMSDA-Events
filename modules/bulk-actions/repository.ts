import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { formatPersonName } from "@/lib/person-name";
import type { EventPermission } from "@/modules/access/permissions";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  BULK_ACTION_CATALOG,
  BULK_BASE_PERMISSION,
  BULK_RECORD_UNIT,
  BulkActionError,
  EXPORT_FIELDS,
  NOT_COMPLETED_LIST_MAX,
  APPLYING_STALE_MINUTES,
  PREVIEW_TTL_MINUTES,
  auditQueryString,
  canonicalBulkQuery,
  describeQueryFilters,
  exportFieldSpec,
  idempotencyKeySchema,
  isExpired,
  missingForAction,
  paramsFromStored,
  parseBulkParams,
  parseBulkActionKey,
  permissionsUsed,
  reasonLabel,
  storedParams,
  tallyOutcomes,
  type BulkActionKey,
  type BulkActionOutcomeKey,
  type BulkActionParams,
  type BulkReasonCode,
  type ExportFieldKey,
  type OutcomeCounts,
  type SnapshotEntry,
  type StoredParams,
} from "@/modules/bulk-actions/domain";
import { attendeeBalanceCents } from "@/modules/registrations/finance-view";
import { registrationMoneyStatus } from "@/modules/registrations/status-words";
import { enumerateOperationsRegistrationIds } from "@/modules/registrations/operations-search-repository";
import { toCsv } from "@/modules/reporting/csv";
import { applyRegistrationTag, listActiveTags, listTags, removeRegistrationTag, TagConfigurationError } from "@/modules/tags/repository";

/**
 * Reviewed bulk actions over registrations, the database half (#182).
 *
 * Preview, then explicit confirm with an idempotency key, then apply with one outcome per record, with an audit trail.
 * Every function takes the signed-in person's own permissions for ONE event, built by the server and never read from the
 * request. A preview is not a grant: confirming re-checks the permissions, the action, the tag and the search, and
 * applies only to records that still match and have not changed since the preview.
 *
 * An action is a handler in `HANDLERS`. The framework owns everything else, so adding an action later is a new key in
 * the domain catalog and a new handler here, not a new endpoint or a generic field update.
 */

export type BulkActionViewer = { eventId: string; userId: string; permissions: readonly EventPermission[] };

type Db = ReturnType<typeof getPrisma>;

/* ---------- handlers ---------- */

type RecordOutcome = { registrationId: string; outcome: BulkActionOutcomeKey; reason?: BulkReasonCode };
type ExportFile = { body: string };
type PreviewSkip = { id: string; reason: BulkReasonCode };

type ActionHandler = {
  /** Whole-run conditions, checked at preview and again at confirm. Throws a refusal; changes nothing. */
  assertReady(viewer: BulkActionViewer, params: BulkActionParams): Promise<{ proposed: string }>;
  /** Candidates the action would skip right now, shown in the preview. */
  skipsFor(eventId: string, params: BulkActionParams, ids: readonly string[]): Promise<PreviewSkip[]>;
  /** Apply to records that passed the apply-time checks. One record failing never stops the rest. */
  apply(input: { eventId: string; actorUserId: string; runId: string; params: BulkActionParams; ids: readonly string[]; /** Each record's outcome is pushed here as it is reached, so a throw part-way keeps what was done. */ sink: RecordOutcome[] }): Promise<{ file?: ExportFile; exportRowCount?: number }>;
};

async function requireTag(eventId: string, tagId: string, applying: boolean) {
  // Both lists leave out recognition tags. Applying needs an active tag; removing works for an inactive one too, as it does
  // for a single registration, so a retired tag can still be cleaned off. A deleted tag is in neither list.
  const tag = (await (applying ? listActiveTags(eventId) : listTags(eventId))).find((candidate) => candidate.id === tagId);
  if (!tag) throw new BulkActionError("TAG_UNAVAILABLE", "That tag is no longer available. Choose another tag and preview again.", 409);
  return tag;
}

const tagHandler: ActionHandler = {
  async assertReady(viewer, params) {
    if (params.action === "EXPORT_FIELDS") throw new BulkActionError("INVALID_REQUEST", "Choose a tag.");
    const tag = await requireTag(viewer.eventId, params.tagId, params.action === "APPLY_TAG");
    return { proposed: params.action === "APPLY_TAG" ? `Apply the tag "${tag.name}"` : `Remove the tag "${tag.name}"` };
  },
  async skipsFor(eventId, params, ids) {
    if (params.action === "EXPORT_FIELDS") return [];
    const have = await activeAssignments(getPrisma(), eventId, params.tagId, ids);
    return ids.filter((id) => (params.action === "APPLY_TAG" ? have.has(id) : !have.has(id)))
      .map((id) => ({ id, reason: (params.action === "APPLY_TAG" ? "ALREADY_APPLIED" : "NOT_APPLIED") as BulkReasonCode }));
  },
  async apply({ eventId, actorUserId, runId, params, ids, sink }) {
    if (params.action === "EXPORT_FIELDS") return {};
    const have = await activeAssignments(getPrisma(), eventId, params.tagId, ids);
    const outcomes = sink;
    for (const registrationId of ids) {
      const applying = params.action === "APPLY_TAG";
      if (applying === have.has(registrationId)) {
        outcomes.push({ registrationId, outcome: "SKIPPED", reason: applying ? "ALREADY_APPLIED" : "NOT_APPLIED" });
        continue;
      }
      try {
        // The tag service writes the change and its own audit row, linked to this run by the correlation id.
        if (applying) await applyRegistrationTag(eventId, registrationId, params.tagId, actorUserId, { correlationId: runId });
        else await removeRegistrationTag(eventId, registrationId, params.tagId, actorUserId, { correlationId: runId });
        outcomes.push({ registrationId, outcome: "COMPLETED" });
      } catch (error) {
        // Someone removed it between the read and the write: nothing left to do, not a failure.
        if (!applying && error instanceof TagConfigurationError && error.code === "NOT_FOUND") {
          outcomes.push({ registrationId, outcome: "SKIPPED", reason: "NOT_APPLIED" });
          continue;
        }
        logError("A bulk tag change failed for one registration", error, { runId });
        outcomes.push({ registrationId, outcome: "FAILED", reason: "WRITE_FAILED" });
      }
    }
    return {};
  },
};

async function activeAssignments(prisma: Db, eventId: string, tagId: string, ids: readonly string[]) {
  const rows = await prisma.registrationTagAssignment.findMany({
    where: { eventId, tagId, removedAt: null, registrationId: { in: [...ids] } },
    select: { registrationId: true },
  });
  return new Set(rows.map((row) => row.registrationId));
}

function moneyToCents(value: { toString(): string } | number) {
  return Math.round(Number(value) * 100);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const exportHandler: ActionHandler = {
  async assertReady(_viewer, params) {
    if (params.action !== "EXPORT_FIELDS") throw new BulkActionError("INVALID_REQUEST", "Choose the fields to export.");
    const labels = params.fields.map((key) => exportFieldSpec(key)?.label ?? key);
    return { proposed: `Create a CSV file with: ${labels.join(", ")}` };
  },
  async skipsFor() {
    return [];
  },
  async apply({ eventId, params, ids, sink }) {
    if (params.action !== "EXPORT_FIELDS") return {};
    const fields = params.fields;
    const wants = (key: ExportFieldKey) => fields.includes(key);
    const needsContact = wants("contactName") || wants("contactEmail") || wants("contactPhone");
    const needsMoney = wants("balance") || wants("paymentState");
    // Only what the chosen fields need is read: a field that was not asked for is never loaded.
    const rows = await getPrisma().registration.findMany({
      where: { eventId, id: { in: [...ids] } },
      select: {
        id: true,
        ...(wants("code") ? { confirmationCode: true } : {}),
        ...(wants("status") ? { status: true } : {}),
        ...(wants("submittedAt") ? { submittedAt: true } : {}),
        ...(wants("attendeeCount") ? { _count: { select: { attendees: true } } } : {}),
        ...(needsContact ? { contactSnapshot: true, accountHolderPerson: { select: { firstName: true, lastName: true, normalizedEmail: true, phone: true } } } : {}),
        ...(wants("tags") ? { tagAssignments: { where: { removedAt: null, tag: { recognitionItem: null } }, select: { tag: { select: { name: true } } } } } : {}),
        // Money counts what the finance views count: succeeded payments less succeeded refunds only.
        ...(needsMoney ? {
          totalAmount: true,
          event: { select: { billingMode: true } },
          groupRegistration: { select: { id: true } },
          payments: { where: { status: "SUCCEEDED" as const }, select: { amount: true, refunds: { where: { status: "SUCCEEDED" as const }, select: { amount: true } } } },
        } : {}),
      },
    });
    // Which columns were read depends on the chosen fields, so the row is typed by what each field reads.
    type Row = {
      id: string;
      confirmationCode: string;
      status: string;
      submittedAt: Date | null;
      _count: { attendees: number };
      contactSnapshot: unknown;
      accountHolderPerson?: { firstName: string; lastName: string; normalizedEmail: string | null; phone: string | null };
      tagAssignments: Array<{ tag: { name: string } }>;
      totalAmount: { toString(): string };
      event?: { billingMode: string };
      groupRegistration?: { id: string } | null;
      payments: Array<{ amount: { toString(): string }; refunds: Array<{ amount: { toString(): string } }> }>;
    };
    const byId = new Map<string, Row>((rows as unknown as Row[]).map((row) => [row.id, row]));
    const header = fields.map((key) => exportFieldSpec(key)?.label ?? key);
    const body: Array<Array<string | number>> = [];
    const outcomes: RecordOutcome[] = [];
    for (const registrationId of ids) {
      const row = byId.get(registrationId);
      if (!row) {
        outcomes.push({ registrationId, outcome: "OBSOLETE", reason: "NO_LONGER_MATCHES" });
        continue;
      }
      const snapshot = row.contactSnapshot && typeof row.contactSnapshot === "object" && !Array.isArray(row.contactSnapshot) ? row.contactSnapshot as Record<string, unknown> : {};
      const person = row.accountHolderPerson;
      const paidCents = needsMoney
        ? row.payments.reduce((sum, payment) => sum + moneyToCents(payment.amount) - payment.refunds.reduce((refunded, refund) => refunded + moneyToCents(refund.amount), 0), 0)
        : 0;
      const totalCents = needsMoney ? moneyToCents(row.totalAmount) : 0;
      const deferredBilling = row.event?.billingMode === "DEFERRED_ORGANIZATION_INVOICE";
      // A church- or organization-billed registration owes nothing online, so its balance is $0 (the same rule as the lists).
      const balanceCents = attendeeBalanceCents({ balanceCents: Math.max(totalCents - paidCents, 0), isDeferredOrganizationBilling: deferredBilling });
      const cell = (key: ExportFieldKey): string | number => {
        switch (key) {
          case "code": return row.confirmationCode;
          case "status": return row.status;
          case "attendeeCount": return row._count.attendees;
          case "submittedAt": return row.submittedAt ? row.submittedAt.toISOString() : "";
          case "contactName": return formatPersonName({ firstName: text(snapshot.firstName) || person?.firstName, lastName: text(snapshot.lastName) || person?.lastName });
          case "contactEmail": return text(snapshot.email) || person?.normalizedEmail || "";
          case "contactPhone": return text(snapshot.phone) || person?.phone || "";
          case "tags": return row.tagAssignments.map((assignment) => assignment.tag.name).sort().join("; ");
          case "balance": return (balanceCents / 100).toFixed(2);
          // The existing finance words: "Balance due", "Paid in full", "No charge", "Billed to church".
          case "paymentState": return registrationMoneyStatus({ totalCents, balanceCents, deferredBilling, isGroup: Boolean(row.groupRegistration), audience: "staff" });
        }
      };
      // toCsv guards a cell that starts with = + - @ or a control character, so a typed name cannot run as a formula.
      body.push(fields.map(cell));
      outcomes.push({ registrationId, outcome: "COMPLETED" });
    }
    const file: ExportFile = { body: toCsv([header, ...body]) };
    // The file exists only once every row is built, so the outcomes are recorded together with it.
    sink.push(...outcomes);
    return { file, exportRowCount: body.length };
  },
};

/** One handler per action key. The type makes a missing handler a compile error. */
const HANDLERS: Record<BulkActionKey, ActionHandler> = {
  APPLY_TAG: tagHandler,
  REMOVE_TAG: tagHandler,
  EXPORT_FIELDS: exportHandler,
};

/* ---------- shapes ---------- */

export type BulkPreview = {
  runId: string;
  action: BulkActionKey;
  actionLabel: string;
  recordUnit: string;
  scope: { kind: "FILTER" | "SELECTED"; filters: string[]; notInScopeCount: number };
  candidateCount: number;
  /** Candidates the action would change. */
  willChangeCount: number;
  exclusions: Array<{ reason: BulkReasonCode; label: string; count: number; sampleCodes: string[] }>;
  proposedChange: string;
  permissionsUsed: string[];
  createsFile: boolean;
  /** Personal fields in an export, named, so the preview can say the file holds personal data. */
  personalFields: string[];
  effect: string;
  expiresAt: string;
};

export type BulkSummary = {
  runId: string;
  action: BulkActionKey;
  actionLabel: string;
  status: "PREVIEWED" | "APPLYING" | "APPLIED" | "EXPIRED";
  scope: { kind: "FILTER" | "SELECTED"; filters: string[] };
  recordUnit: string;
  candidateCount: number;
  counts: OutcomeCounts;
  exportRowCount: number | null;
  notCompleted: Array<{ confirmationCode: string; outcome: BulkActionOutcomeKey; reason: string }>;
  notCompletedTotal: number;
  replayed: boolean;
  completedAt: string | null;
};

export type BulkConfirmResult = { summary: BulkSummary; file: ExportFile | null };

/* ---------- helpers ---------- */

export function runFingerprint(input: { action: BulkActionKey; params: StoredParams; queryString: string; scopeKind: "FILTER" | "SELECTED"; selectedIds: readonly string[] | null; snapshot: readonly SnapshotEntry[] }) {
  const params = "fields" in input.params ? { fields: input.params.fields } : { tagId: input.params.tagId };
  return createHash("sha256").update(JSON.stringify({ a: input.action, p: params, q: input.queryString, k: input.scopeKind, s: input.selectedIds, r: input.snapshot })).digest("hex");
}


function parseSnapshot(value: unknown): SnapshotEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as SnapshotEntry).id === "string" && typeof (entry as SnapshotEntry).v === "string" ? [{ id: (entry as SnapshotEntry).id, v: (entry as SnapshotEntry).v }] : []));
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code === "P2002" : typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

function denied(missing: string[]) {
  return new BulkActionError("PERMISSION_DENIED", `Your event role doesn't include ${missing.join(", ")}. Ask your event administrator if you need access.`, 403);
}

function requireBulkAccess(viewer: BulkActionViewer, params: BulkActionParams) {
  const missing = missingForAction(params, viewer.permissions);
  if (missing.length > 0) throw denied(missing);
}

/** The refusal for an action key outside the allowlist. */
export function refuseUnknownAction(raw: unknown): BulkActionKey {
  const parsed = parseBulkActionKey(raw);
  if (!parsed.ok) throw new BulkActionError("RESTRICTED_ACTION", parsed.message, 422);
  return parsed.key;
}

const SKIP_SAMPLE = 20;

/* ---------- preview ---------- */

export async function createBulkPreview(
  viewer: BulkActionViewer,
  input: { action: unknown; params: unknown; query: string; selectedIds?: readonly string[] | null },
  options: { now?: Date } = {},
): Promise<BulkPreview> {
  const now = options.now ?? new Date();
  if (!viewer.permissions.includes(BULK_BASE_PERMISSION)) throw denied(["viewing registration records"]);
  const action = refuseUnknownAction(input.action);
  const params = parseBulkParams(action, input.params);
  requireBulkAccess(viewer, params);
  const handler = HANDLERS[action];
  const { proposed } = await handler.assertReady(viewer, params);
  const catalog = BULK_ACTION_CATALOG[action];

  const { queryString, issues: parseIssues } = canonicalBulkQuery(input.query);
  // The authorized result set: the same search the People page uses, with its own permission gates.
  const found = await enumerateOperationsRegistrationIds({ eventId: viewer.eventId, permissions: viewer.permissions }, new URLSearchParams(queryString), undefined, parseIssues);
  if (!found.ok) {
    if (found.issues.some((issue) => issue.code === "too-broad")) throw new BulkActionError("TOO_BROAD", "That filter matches too many registrations for a bulk action. Narrow it and try again.");
    throw new BulkActionError("SEARCH_UNAVAILABLE", found.issues[0]?.message ?? "That filter cannot be used here. Check the filters and try again.");
  }

  let ids = found.registrationIds;
  let scopeKind: "FILTER" | "SELECTED" = "FILTER";
  let notInScope = 0;
  let selectedIds: string[] | null = null;
  if (input.selectedIds) {
    if (input.selectedIds.length === 0) throw new BulkActionError("INVALID_REQUEST", "Select at least one registration, or leave the selection out to use the whole filter.");
    // A selection narrows the filter; it never reaches past it, and the filter is never widened to fit it.
    selectedIds = [...new Set(input.selectedIds)];
    const picked = new Set(selectedIds);
    ids = ids.filter((id) => picked.has(id));
    notInScope = selectedIds.length - ids.length;
    scopeKind = "SELECTED";
  }
  if (ids.length === 0) throw new BulkActionError("NOTHING_TO_DO", "No registrations match, so there is nothing to do.");
  // Too broad is refused, never truncated to fit.
  if (ids.length > catalog.maxRecords) {
    throw new BulkActionError("TOO_BROAD", `This would cover ${ids.length} registrations. ${catalog.label} is limited to ${catalog.maxRecords} at a time. Narrow the filter and try again.`);
  }

  const prisma = getPrisma();
  const versions = await prisma.registration.findMany({ where: { eventId: viewer.eventId, id: { in: ids } }, select: { id: true, confirmationCode: true, updatedAt: true } });
  const versionById = new Map(versions.map((row) => [row.id, row]));
  const snapshot: SnapshotEntry[] = ids.flatMap((id) => {
    const row = versionById.get(id);
    return row ? [{ id, v: row.updatedAt.toISOString() }] : [];
  });
  const skips = await handler.skipsFor(viewer.eventId, params, snapshot.map((entry) => entry.id));
  const stored = storedParams(params);
  const runId = randomUUID();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MINUTES * 60_000);
  await prisma.bulkActionRun.create({
    data: {
      id: runId,
      eventId: viewer.eventId,
      actorUserId: viewer.userId,
      action,
      params: stored as Prisma.InputJsonValue,
      scopeKind,
      queryString,
      selectedIds: selectedIds ?? Prisma.JsonNull,
      recordUnit: BULK_RECORD_UNIT,
      candidateCount: snapshot.length,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      fingerprint: runFingerprint({ action, params: stored, queryString, scopeKind, selectedIds, snapshot }),
      status: "PREVIEWED",
      previewedAt: now,
      expiresAt,
    },
  });
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "BULK_ACTION_PREVIEWED",
    entityType: "BulkActionRun",
    entityId: runId,
    correlationId: runId,
    summary: `Previewed a bulk action (${catalog.label}) on ${snapshot.length} ${BULK_RECORD_UNIT}.`,
    metadata: { action, params: stored, queryString: auditQueryString(queryString), scopeKind, recordUnit: BULK_RECORD_UNIT, candidateCount: snapshot.length, actorUserId: viewer.userId } as Prisma.InputJsonValue,
  });

  const exclusions = (["ALREADY_APPLIED", "NOT_APPLIED"] as const).flatMap((reason) => {
    const hit = skips.filter((skip) => skip.reason === reason);
    return hit.length === 0 ? [] : [{
      reason,
      label: reasonLabel(reason),
      count: hit.length,
      sampleCodes: hit.slice(0, SKIP_SAMPLE).flatMap((skip) => versionById.get(skip.id)?.confirmationCode ?? []),
    }];
  });
  const personalFields = params.action === "EXPORT_FIELDS" ? params.fields.flatMap((key) => (EXPORT_FIELDS.find((field) => field.key === key)?.personal ? [exportFieldSpec(key)!.label] : [])) : [];
  return {
    runId,
    action,
    actionLabel: catalog.label,
    recordUnit: BULK_RECORD_UNIT,
    scope: { kind: scopeKind, filters: describeQueryFilters(queryString, { showText: true }), notInScopeCount: notInScope },
    candidateCount: snapshot.length,
    willChangeCount: snapshot.length - skips.length,
    exclusions,
    proposedChange: proposed,
    permissionsUsed: permissionsUsed(params),
    createsFile: catalog.createsFile,
    personalFields,
    effect: catalog.effect,
    expiresAt: expiresAt.toISOString(),
  };
}

/* ---------- confirm and apply ---------- */

type RunRow = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

async function loadRun(prisma: Db, eventId: string, runId: string) {
  return prisma.bulkActionRun.findFirst({ where: { id: runId, eventId } });
}

function countsOf(run: Pick<RunRow, "completedCount" | "skippedCount" | "conflictCount" | "failedCount" | "obsoleteCount">): OutcomeCounts {
  return { completed: run.completedCount, skipped: run.skippedCount, conflict: run.conflictCount, failed: run.failedCount, obsolete: run.obsoleteCount };
}

async function summarize(prisma: Db, run: RunRow, replayed: boolean): Promise<BulkSummary> {
  const counts = countsOf(run);
  const notCompletedTotal = counts.skipped + counts.conflict + counts.failed + counts.obsolete;
  const rows = notCompletedTotal === 0 ? [] : await prisma.bulkActionRecordOutcome.findMany({
    where: { runId: run.id, outcome: { not: "COMPLETED" } },
    select: { outcome: true, reason: true, registration: { select: { confirmationCode: true } } },
    orderBy: { registration: { confirmationCode: "asc" } },
    take: NOT_COMPLETED_LIST_MAX,
  });
  return {
    runId: run.id,
    action: run.action,
    actionLabel: BULK_ACTION_CATALOG[run.action].label,
    status: isStaleUnconfirmed(run) ? "EXPIRED" : run.status,
    scope: { kind: run.scopeKind, filters: describeQueryFilters(run.queryString, { showText: false }) },
    recordUnit: run.recordUnit,
    candidateCount: run.candidateCount,
    counts,
    exportRowCount: run.exportRowCount,
    notCompleted: rows.map((row) => ({ confirmationCode: row.registration.confirmationCode, outcome: row.outcome, reason: reasonLabel(row.reason) })),
    notCompletedTotal,
    replayed,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

function isStaleUnconfirmed(run: Pick<RunRow, "status" | "expiresAt">) {
  return run.status === "EXPIRED" || (run.status === "PREVIEWED" && isExpired(run, new Date()));
}

/** The stored result of a run, for its own actor. */
export async function getBulkSummary(viewer: BulkActionViewer, runId: string): Promise<BulkSummary> {
  const prisma = getPrisma();
  const run = await loadRun(prisma, viewer.eventId, runId);
  if (!run) throw new BulkActionError("NOT_FOUND", "That bulk action could not be found.", 404);
  if (run.actorUserId !== viewer.userId) throw new BulkActionError("WRONG_ACTOR", "Only the person who previewed this action can see its result.", 403);
  return summarize(prisma, run, false);
}

export async function confirmBulkAction(
  viewer: BulkActionViewer,
  runId: string,
  rawKey: unknown,
  options: { now?: Date } = {},
): Promise<BulkConfirmResult> {
  const now = options.now ?? new Date();
  const key = idempotencyKeySchema.safeParse(rawKey);
  if (!key.success) throw new BulkActionError("INVALID_REQUEST", key.error.issues[0]?.message ?? "A confirmation key is required.");
  const idempotencyKey = key.data;
  if (!viewer.permissions.includes(BULK_BASE_PERMISSION)) throw denied(["viewing registration records"]);
  const prisma = getPrisma();
  const run = await loadRun(prisma, viewer.eventId, runId);
  if (!run) throw new BulkActionError("NOT_FOUND", "That bulk action could not be found.", 404);
  // Only the person who previewed it can confirm it.
  if (run.actorUserId !== viewer.userId) throw new BulkActionError("WRONG_ACTOR", "Only the person who previewed this action can confirm it.", 403);

  // Already confirmed: the same key gets the stored result and changes nothing; another key is refused.
  if (run.status === "APPLIED" || run.status === "APPLYING") return replay(prisma, run, idempotencyKey, now);
  if (run.status === "EXPIRED" || isExpired(run, now)) {
    // Typed search text is not kept once the run can no longer be applied.
    await prisma.bulkActionRun.updateMany({ where: { id: run.id, status: "PREVIEWED" }, data: { status: "EXPIRED", queryString: auditQueryString(run.queryString) } });
    throw new BulkActionError("EXPIRED", "This preview has expired. Preview again to continue.", 409);
  }

  const action = run.action;
  const params = paramsFromStored(action, run.params);
  // A preview is not a grant: every permission is checked again, with the ones the server just resolved.
  requireBulkAccess(viewer, params);
  const handler = HANDLERS[action];
  await handler.assertReady(viewer, params);

  const snapshot = parseSnapshot(run.snapshot);
  const snapshotIds = snapshot.map((entry) => entry.id);
  // The same search, narrowed to the records the person reviewed.
  const again = await enumerateOperationsRegistrationIds({ eventId: viewer.eventId, permissions: viewer.permissions }, new URLSearchParams(run.queryString), undefined, [], snapshotIds);
  if (!again.ok) throw new BulkActionError("SEARCH_UNAVAILABLE", "The filter for this preview can no longer be used. Nothing was changed. Preview again.", 409);
  const stillMatching = new Set(again.registrationIds);

  // One atomic step from PREVIEWED to APPLYING; only one request wins it.
  let claimed: { count: number };
  try {
    claimed = await prisma.bulkActionRun.updateMany({
      where: { id: run.id, eventId: viewer.eventId, actorUserId: viewer.userId, status: "PREVIEWED", expiresAt: { gt: now } },
      // Once the run leaves PREVIEWED the typed search text is replaced; the search above already ran with it.
      data: { status: "APPLYING", idempotencyKey, confirmedAt: now, queryString: auditQueryString(run.queryString) },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new BulkActionError("KEY_IN_USE", "That confirmation key was already used for a different action. Reload the page and try again.", 409);
    throw error;
  }
  if (claimed.count === 0) {
    const current = await loadRun(prisma, viewer.eventId, runId);
    if (current && (current.status === "APPLIED" || current.status === "APPLYING")) return replay(prisma, current, idempotencyKey, now);
    throw new BulkActionError("EXPIRED", "This preview has expired. Preview again to continue.", 409);
  }

  // The confirmation is on record before anything is changed, so a run that stops part-way is never unexplained.
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "BULK_ACTION_CONFIRMED",
    entityType: "BulkActionRun",
    entityId: run.id,
    correlationId: run.id,
    summary: `Confirmed a bulk action (${BULK_ACTION_CATALOG[action].label}) on ${run.candidateCount} ${run.recordUnit}.`,
    metadata: { action, params: storedParams(params), queryString: auditQueryString(run.queryString), scopeKind: run.scopeKind, candidateCount: run.candidateCount, actorUserId: viewer.userId } as Prisma.InputJsonValue,
  });

  const outcomes: RecordOutcome[] = [];
  let extras: { file?: ExportFile; exportRowCount?: number } = {};
  try {
    const versions = await prisma.registration.findMany({ where: { eventId: viewer.eventId, id: { in: snapshotIds } }, select: { id: true, updatedAt: true } });
    const currentVersion = new Map(versions.map((row) => [row.id, row.updatedAt.toISOString()]));
    const eligible: string[] = [];
    for (const entry of snapshot) {
      if (!stillMatching.has(entry.id)) outcomes.push({ registrationId: entry.id, outcome: "OBSOLETE", reason: "NO_LONGER_MATCHES" });
      else if (currentVersion.get(entry.id) !== entry.v) outcomes.push({ registrationId: entry.id, outcome: "CONFLICT", reason: "RECORD_CHANGED" });
      else eligible.push(entry.id);
    }
    extras = await handler.apply({ eventId: viewer.eventId, actorUserId: viewer.userId, runId: run.id, params, ids: eligible, sink: outcomes });
  } catch (error) {
    // A handler that throws still ends the run: what it did stays recorded and the records it did not reach are FAILED.
    logError("A bulk action stopped part-way", error, { runId: run.id });
    extras = {};
  }
  const reached = new Set(outcomes.map((row) => row.registrationId));
  for (const entry of snapshot) if (!reached.has(entry.id)) outcomes.push({ registrationId: entry.id, outcome: "FAILED", reason: "INTERRUPTED" });
  const summary = await finishRun(prisma, run, viewer.userId, params, outcomes, extras);
  return { summary, file: extras.file ?? null };
}

/** Writes the outcomes, ends the run as APPLIED with its counts, and audits it. */
async function finishRun(prisma: Db, run: RunRow, actorUserId: string, params: BulkActionParams, outcomes: RecordOutcome[], extras: { file?: ExportFile; exportRowCount?: number }) {
  await prisma.bulkActionRecordOutcome.createMany({
    data: outcomes.map((row) => ({ runId: run.id, registrationId: row.registrationId, outcome: row.outcome, reason: row.reason ?? null })),
    skipDuplicates: true,
  });
  const counts = tallyOutcomes(outcomes);
  const completedAt = new Date();
  const exportRowCount = extras.file ? extras.exportRowCount ?? 0 : null;
  await prisma.bulkActionRun.updateMany({
    where: { id: run.id, status: "APPLYING" },
    data: {
      status: "APPLIED",
      completedAt,
      completedCount: counts.completed,
      skippedCount: counts.skipped,
      conflictCount: counts.conflict,
      failedCount: counts.failed,
      obsoleteCount: counts.obsolete,
      exportRowCount,
    },
  });
  const stored = storedParams(params);
  await writeAuditLog({
    eventId: run.eventId,
    actorUserId,
    action: "BULK_ACTION_APPLIED",
    entityType: "BulkActionRun",
    entityId: run.id,
    correlationId: run.id,
    summary: `Applied a bulk action (${BULK_ACTION_CATALOG[run.action].label}): ${counts.completed} completed, ${counts.skipped} skipped, ${counts.conflict} changed since preview, ${counts.failed} failed, ${counts.obsolete} no longer matching.`,
    metadata: {
      action: run.action,
      params: stored,
      queryString: auditQueryString(run.queryString),
      scopeKind: run.scopeKind,
      recordUnit: run.recordUnit,
      candidateCount: run.candidateCount,
      counts,
      actorUserId,
      ...(extras.file ? { export: { fields: "fields" in stored ? stored.fields : [], filters: auditQueryString(run.queryString), rowCount: exportRowCount, exportedAt: completedAt.toISOString() } } : {}),
    } as Prisma.InputJsonValue,
  });
  const final = await loadRun(prisma, run.eventId, run.id);
  return summarize(prisma, final ?? { ...run, status: "APPLIED", completedAt, completedCount: counts.completed, skippedCount: counts.skipped, conflictCount: counts.conflict, failedCount: counts.failed, obsoleteCount: counts.obsolete, exportRowCount }, false);
}

async function replay(prisma: Db, run: RunRow, idempotencyKey: string, now: Date): Promise<BulkConfirmResult> {
  if (run.idempotencyKey !== idempotencyKey) {
    throw new BulkActionError("ALREADY_CONFIRMED", "This action was already confirmed. Its result is in Recent bulk actions. Preview again to run it again.", 409);
  }
  if (run.status === "APPLYING") {
    const started = run.confirmedAt?.getTime() ?? 0;
    if (now.getTime() - started < APPLYING_STALE_MINUTES * 60_000) {
      throw new BulkActionError("IN_PROGRESS", "This action is still being applied. Check Recent bulk actions in a moment.", 409);
    }
    // Applying for too long: the process that was doing it is gone. End the run so it is never stuck. Records with no
    // outcome are FAILED ("interrupted"), because it cannot be known whether the change was made.
    const done = await prisma.bulkActionRecordOutcome.findMany({ where: { runId: run.id }, select: { registrationId: true, outcome: true, reason: true } });
    const reached = new Set(done.map((row) => row.registrationId));
    const outcomes: RecordOutcome[] = [
      ...done.map((row) => ({ registrationId: row.registrationId, outcome: row.outcome as BulkActionOutcomeKey, reason: (row.reason ?? undefined) as BulkReasonCode | undefined })),
      ...parseSnapshot(run.snapshot).filter((entry) => !reached.has(entry.id)).map((entry) => ({ registrationId: entry.id, outcome: "FAILED" as const, reason: "INTERRUPTED" as const })),
    ];
    const summary = await finishRun(prisma, run, run.actorUserId, paramsFromStored(run.action, run.params), outcomes, {});
    return { summary: { ...summary, replayed: true }, file: null };
  }
  // No second change and no second file.
  return { summary: await summarize(prisma, run, true), file: null };
}

/* ---------- history ---------- */

export type RecentBulkAction = {
  runId: string;
  actorName: string;
  previewedAt: string;
  actionLabel: string;
  status: BulkSummary["status"];
  scope: { kind: "FILTER" | "SELECTED"; filters: string[] };
  candidateCount: number;
  counts: OutcomeCounts;
};

/** The last runs for the event: who, when, what, which scope and the counts. No names of registrants, no query text. */
export async function listRecentBulkActions(eventId: string, take = 10): Promise<RecentBulkAction[]> {
  const rows = await getPrisma().bulkActionRun.findMany({
    where: { eventId },
    orderBy: { previewedAt: "desc" },
    take,
    include: { actor: { select: { displayName: true } } },
  });
  return rows.map((run) => ({
    runId: run.id,
    actorName: run.actor.displayName,
    previewedAt: run.previewedAt.toISOString(),
    actionLabel: BULK_ACTION_CATALOG[run.action].label,
    status: isStaleUnconfirmed(run) ? "EXPIRED" : run.status,
    scope: { kind: run.scopeKind, filters: describeQueryFilters(run.queryString, { showText: false }) },
    candidateCount: run.candidateCount,
    counts: countsOf(run),
  }));
}
