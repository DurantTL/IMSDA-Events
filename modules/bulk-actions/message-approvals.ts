import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { EventPermission } from "@/modules/access/permissions";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { BULK_ACTION_CATALOG, BulkActionError, messageSkipReason, reasonLabel, type BulkActionKey, type BulkReasonCode } from "@/modules/bulk-actions/domain";
import { enqueueSelectedAudienceBatch, getSelectedAudiencePreview } from "@/modules/communications/messaging-repository";
import { selectedAudienceTemplateKeys, selectedAudienceTemplateLabels, type SelectedAudienceTemplateKey } from "@/modules/communications/selected-audience-templates";

/**
 * Approval of the messages a confirmed bulk run queued (#182).
 *
 * Confirming a bulk message action never sends. It leaves one `BulkMessageApproval` row, and this file is the only place a
 * queued message becomes a real send: a person with communications access reads a fresh review, then approves it with the
 * fingerprint they were shown (the same convention as scheduled emails). The approver may be the person who queued it. Every
 * function takes the signed-in person's own permissions for ONE event, built by the server, and checks communications access
 * itself, so a permission removed after queueing stops the send.
 */

export type ApprovalViewer = { eventId: string; userId: string; permissions: readonly EventPermission[] };

/** A send that has been SENDING for longer than this is treated as stopped and may be tried again with the same batch id. */
export const SENDING_STALE_MINUTES = 10;
/** How many decided approvals the list keeps showing. */
export const RECENT_DECIDED_MAX = 10;
const SAMPLE_CODES_MAX = 10;

export type MessageApprovalStatus = "PENDING_APPROVAL" | "SENDING" | "SENT" | "DECLINED";
export type SendResultCounts = { included: number; skipped: number; queued: number; captured: number; suppressed: number };

export type MessageApprovalListItem = {
  id: string;
  actionLabel: string;
  templateLabel: string;
  title: string | null;
  queuedByName: string;
  queuedAt: string;
  queuedCount: number;
  status: MessageApprovalStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  sendResult: SendResultCounts | null;
};

export type MessageApprovalReview = {
  id: string;
  status: MessageApprovalStatus;
  actionLabel: string;
  templateKey: SelectedAudienceTemplateKey;
  templateLabel: string;
  title: string | null;
  body: string | null;
  queuedCount: number;
  includedCount: number;
  skippedCount: number;
  skippedByReason: Array<{ reason: BulkReasonCode; label: string; count: number }>;
  fingerprint: string;
  deliveryMode: "DISABLED" | "LOCAL_CAPTURE" | "EXTERNAL_EMAIL";
  templatePublished: boolean;
  attachmentProblem: string | null;
  /** Confirmation codes of some of the people who would receive it. Never an address or a name. */
  sampleCodes: string[];
  queuedByName: string;
  queuedAt: string;
};

export type MessageApprovalDecision = { id: string; status: MessageApprovalStatus; sendResult: SendResultCounts | null; replayed: boolean };

function denied() {
  return new BulkActionError("PERMISSION_DENIED", "Your event role doesn't include sending messages. Ask your event administrator if you need access.", 403);
}

function requireCommunications(viewer: ApprovalViewer) {
  if (!viewer.permissions.includes("MANAGE_COMMUNICATIONS")) throw denied();
}

function notFound() {
  return new BulkActionError("NOT_FOUND", "That queued message could not be found.", 404);
}

function isTemplateKey(value: string): value is SelectedAudienceTemplateKey {
  return (selectedAudienceTemplateKeys as readonly string[]).includes(value);
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function countsOf(value: unknown): SendResultCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const num = (key: string) => (typeof record[key] === "number" ? record[key] as number : 0);
  return { included: num("included"), skipped: num("skipped"), queued: num("queued"), captured: num("captured"), suppressed: num("suppressed") };
}

async function loadApproval(eventId: string, approvalId: string) {
  // Always scoped by the event: an approval from another event reads as not found.
  return getPrisma().bulkMessageApproval.findFirst({
    where: { id: approvalId, eventId },
    include: { queuedBy: { select: { displayName: true } }, decidedBy: { select: { displayName: true } } },
  });
}

type ApprovalRow = NonNullable<Awaited<ReturnType<typeof loadApproval>>>;

function listItem(row: ApprovalRow): MessageApprovalListItem {
  return {
    id: row.id,
    actionLabel: BULK_ACTION_CATALOG[row.action as BulkActionKey].label,
    templateLabel: isTemplateKey(row.templateKey) ? selectedAudienceTemplateLabels[row.templateKey] : row.templateKey,
    title: row.announcementTitle,
    queuedByName: row.queuedBy.displayName,
    queuedAt: row.createdAt.toISOString(),
    queuedCount: row.queuedCount,
    status: row.status,
    decidedByName: row.decidedBy?.displayName ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    sendResult: countsOf(row.sendResult),
  };
}

/** The pending approvals for the event, and the last few that were decided. */
export async function listMessageApprovals(viewer: ApprovalViewer): Promise<{ pending: MessageApprovalListItem[]; decided: MessageApprovalListItem[] }> {
  requireCommunications(viewer);
  const include = { queuedBy: { select: { displayName: true } }, decidedBy: { select: { displayName: true } } } as const;
  const prisma = getPrisma();
  const [pending, decided] = await Promise.all([
    prisma.bulkMessageApproval.findMany({ where: { eventId: viewer.eventId, status: { in: ["PENDING_APPROVAL", "SENDING"] } }, orderBy: { createdAt: "asc" }, include }),
    prisma.bulkMessageApproval.findMany({ where: { eventId: viewer.eventId, status: { in: ["SENT", "DECLINED"] } }, orderBy: { updatedAt: "desc" }, take: RECENT_DECIDED_MAX, include }),
  ]);
  return { pending: pending.map(listItem), decided: decided.map(listItem) };
}

/** A fresh review: the same preview the send is checked against, read now. No addresses and no names. */
export async function getMessageApprovalReview(viewer: ApprovalViewer, approvalId: string): Promise<MessageApprovalReview> {
  requireCommunications(viewer);
  const row = await loadApproval(viewer.eventId, approvalId);
  if (!row || !isTemplateKey(row.templateKey)) throw notFound();
  const preview = await getSelectedAudiencePreview(viewer.eventId, row.templateKey, idsOf(row.registrationIds));
  const groups = new Map<BulkReasonCode, number>();
  for (const skip of preview.skipped) {
    const reason = messageSkipReason(skip.code);
    groups.set(reason, (groups.get(reason) ?? 0) + 1);
  }
  return {
    id: row.id,
    status: row.status,
    actionLabel: BULK_ACTION_CATALOG[row.action as BulkActionKey].label,
    templateKey: row.templateKey,
    templateLabel: selectedAudienceTemplateLabels[row.templateKey],
    title: row.announcementTitle,
    body: row.announcementBody,
    queuedCount: row.queuedCount,
    includedCount: preview.includedCount,
    skippedCount: preview.skippedCount,
    skippedByReason: [...groups].map(([reason, count]) => ({ reason, label: reasonLabel(reason), count })),
    fingerprint: preview.fingerprint,
    deliveryMode: preview.deliveryMode,
    templatePublished: preview.templatePublished,
    attachmentProblem: preview.attachmentProblem,
    sampleCodes: preview.recipients.slice(0, SAMPLE_CODES_MAX).map((recipient) => recipient.confirmationCode),
    queuedByName: row.queuedBy.displayName,
    queuedAt: row.createdAt.toISOString(),
  };
}

function decision(row: Pick<ApprovalRow, "id" | "status" | "sendResult">, replayed: boolean): MessageApprovalDecision {
  return { id: row.id, status: row.status, sendResult: countsOf(row.sendResult), replayed };
}

/**
 * Approve and send. The permission is checked again here, the claim is one conditional update, and the send is the reviewed
 * selected-registration batch with the approval's id as its batch id, so approving twice never sends twice. If the review has
 * changed (a balance paid, a template republished, delivery switched off) nothing is sent and the approval goes back to waiting.
 */
export async function approveMessage(viewer: ApprovalViewer, approvalId: string, previewFingerprint: unknown, options: { now?: Date } = {}): Promise<MessageApprovalDecision> {
  const now = options.now ?? new Date();
  requireCommunications(viewer);
  if (typeof previewFingerprint !== "string" || previewFingerprint.trim().length !== 64) throw new BulkActionError("INVALID_REQUEST", "Review the message again before approving it.");
  const fingerprint = previewFingerprint.trim();
  const prisma = getPrisma();
  const row = await loadApproval(viewer.eventId, approvalId);
  if (!row || !isTemplateKey(row.templateKey)) throw notFound();
  // Already sent: the stored result, and no second send.
  if (row.status === "SENT") return decision(row, true);
  if (row.status === "DECLINED") throw new BulkActionError("ALREADY_DECIDED", "This message was declined and will not be sent.", 409);

  const cutoff = new Date(now.getTime() - SENDING_STALE_MINUTES * 60_000);
  // One atomic step; a send that has been SENDING for too long may be taken again (the batch id keeps it from sending twice).
  const claimed = await prisma.bulkMessageApproval.updateMany({
    where: { id: row.id, eventId: viewer.eventId, OR: [{ status: "PENDING_APPROVAL" }, { status: "SENDING", updatedAt: { lt: cutoff } }] },
    data: { status: "SENDING" },
  });
  if (claimed.count !== 1) {
    const current = await loadApproval(viewer.eventId, approvalId);
    if (!current) throw new BulkActionError("NOT_FOUND", "This message is no longer waiting for approval.", 404);
    if (current.status === "SENT") return decision(current, true);
    if (current.status === "DECLINED") throw new BulkActionError("ALREADY_DECIDED", "This message was declined and will not be sent.", 409);
    throw new BulkActionError("IN_PROGRESS", "This message is being sent. Check Messages waiting for approval in a moment.", 409);
  }

  // A send that already committed (a retry of a stalled one) is recorded, never sent again.
  if (row.status === "SENDING") {
    const done = await recordIfAlreadySent(viewer, row, now);
    if (done) return done;
  }

  let operation: Awaited<ReturnType<typeof enqueueSelectedAudienceBatch>>;
  try {
    operation = await enqueueSelectedAudienceBatch(viewer.eventId, {
      batchId: row.id,
      templateKey: row.templateKey,
      registrationIds: idsOf(row.registrationIds),
      announcementTitle: row.announcementTitle ?? "",
      announcementBody: row.announcementBody ?? "",
      previewFingerprint: fingerprint,
    }, viewer.userId);
  } catch (error) {
    // The send may have committed before the failure (a crash, or a step after the commit). If the batch exists it is SENT.
    // If that check itself fails the row stays SENDING: a later approval takes it over once it is stale.
    const done = await recordIfAlreadySent(viewer, row, now);
    if (done) return done;
    // Nothing was written: it goes back to waiting, with the same id.
    await prisma.bulkMessageApproval.updateMany({ where: { id: row.id, eventId: viewer.eventId, status: "SENDING" }, data: { status: "PENDING_APPROVAL" } });
    throw error;
  }

  const sendResult: SendResultCounts = {
    included: operation.includedCount,
    skipped: operation.skippedCount,
    queued: operation.queuedCount,
    captured: operation.capturedCount,
    suppressed: operation.suppressedCount,
  };
  const marked = await prisma.bulkMessageApproval.updateMany({
    where: { id: row.id, eventId: viewer.eventId, status: "SENDING" },
    data: { status: "SENT", decidedByUserId: viewer.userId, decidedAt: now, sendResult: sendResult as Prisma.InputJsonValue },
  });
  if (marked.count !== 1) {
    // Someone else recorded it in the meantime: return what is stored and write no second audit row.
    const stored = await loadApproval(viewer.eventId, approvalId);
    if (!stored) throw new BulkActionError("NOT_FOUND", "This message is no longer waiting for approval.", 404);
    return decision(stored, true);
  }
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "BULK_MESSAGE_APPROVED",
    entityType: "BulkMessageApproval",
    entityId: row.id,
    correlationId: row.runId,
    summary: `Approved and sent a bulk message (${selectedAudienceTemplateLabels[row.templateKey]}) to ${sendResult.included} registrations.`,
    metadata: { action: row.action, templateKey: row.templateKey, runId: row.runId, ...sendResult, deliveryMode: operation.deliveryMode, replayed: operation.replayed, actorUserId: viewer.userId } as Prisma.InputJsonValue,
  });
  return { id: row.id, status: "SENT", sendResult, replayed: false };
}

/**
 * Whether the selected-registration batch for this approval already exists (its audit row, written in the same transaction as
 * the outbox rows). If so the approval is marked SENT with the counts that can be read back, instead of being reset to waiting
 * where it could be approved again (which the send would refuse) or declined as if it had not gone out.
 */
async function recordIfAlreadySent(viewer: ApprovalViewer, row: ApprovalRow, now: Date): Promise<MessageApprovalDecision | null> {
  const prisma = getPrisma();
  const audit = await prisma.auditLog.findFirst({
    where: { eventId: viewer.eventId, action: "SELECTED_AUDIENCE_BATCH_ENQUEUED", entityId: `selected-audience:${viewer.eventId}:${row.id}` },
    select: { metadata: true },
  });
  if (!audit) return null;
  const metadata = audit.metadata && typeof audit.metadata === "object" && !Array.isArray(audit.metadata) ? audit.metadata as Record<string, unknown> : {};
  // Only a batch that is this approval's own: the same batch id and template, and the same number of registrations.
  if (metadata.batchId !== row.id || metadata.templateKey !== row.templateKey) return null;
  if (typeof metadata.selectedCount === "number" && metadata.selectedCount !== idsOf(row.registrationIds).length) return null;
  const messages = await prisma.messageOutbox.findMany({ where: { eventId: viewer.eventId, correlationId: row.id }, select: { status: true } });
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const sendResult: SendResultCounts = {
    included: num(metadata.includedCount) || messages.length,
    skipped: num(metadata.skippedCount),
    queued: messages.filter((message) => message.status === "PENDING" || message.status === "PROCESSING").length,
    captured: messages.filter((message) => message.status === "CAPTURED").length,
    suppressed: messages.filter((message) => message.status === "SUPPRESSED").length,
  };
  const marked = await prisma.bulkMessageApproval.updateMany({
    where: { id: row.id, eventId: viewer.eventId, status: { in: ["SENDING", "PENDING_APPROVAL"] } },
    data: { status: "SENT", decidedByUserId: viewer.userId, decidedAt: now, sendResult: sendResult as Prisma.InputJsonValue },
  });
  if (marked.count !== 1) return { id: row.id, status: "SENT", sendResult, replayed: true };
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "BULK_MESSAGE_APPROVED",
    entityType: "BulkMessageApproval",
    entityId: row.id,
    correlationId: row.runId,
    summary: `Recorded a bulk message as sent (${isTemplateKey(row.templateKey) ? selectedAudienceTemplateLabels[row.templateKey] : row.templateKey}): the send had already been written.`,
    metadata: { action: row.action, templateKey: row.templateKey, runId: row.runId, ...sendResult, recovered: true, actorUserId: viewer.userId } as Prisma.InputJsonValue,
  });
  return { id: row.id, status: "SENT", sendResult, replayed: true };
}

/** Decline: the message is never sent. Only a message that is still waiting can be declined. */
export async function declineMessage(viewer: ApprovalViewer, approvalId: string, options: { now?: Date } = {}): Promise<MessageApprovalDecision> {
  const now = options.now ?? new Date();
  requireCommunications(viewer);
  const prisma = getPrisma();
  const row = await loadApproval(viewer.eventId, approvalId);
  if (!row) throw notFound();
  const updated = await prisma.bulkMessageApproval.updateMany({
    where: { id: row.id, eventId: viewer.eventId, status: "PENDING_APPROVAL" },
    data: { status: "DECLINED", decidedByUserId: viewer.userId, decidedAt: now },
  });
  if (updated.count !== 1) {
    const current = await loadApproval(viewer.eventId, approvalId);
    if (current?.status === "DECLINED") return decision(current, true);
    throw new BulkActionError("ALREADY_DECIDED", current?.status === "SENT" ? "This message was already sent." : "This message is being sent and cannot be declined now.", 409);
  }
  await writeAuditLog({
    eventId: viewer.eventId,
    actorUserId: viewer.userId,
    action: "BULK_MESSAGE_DECLINED",
    entityType: "BulkMessageApproval",
    entityId: row.id,
    correlationId: row.runId,
    summary: `Declined a bulk message (${isTemplateKey(row.templateKey) ? selectedAudienceTemplateLabels[row.templateKey] : row.templateKey}). It was not sent.`,
    metadata: { action: row.action, templateKey: row.templateKey, runId: row.runId, queuedCount: row.queuedCount, actorUserId: viewer.userId } as Prisma.InputJsonValue,
  });
  return { id: row.id, status: "DECLINED", sendResult: null, replayed: false };
}

/** Batch ids of queued bulk messages are reserved for their approval. */
export async function isReservedBatchId(eventId: string, batchId: string) {
  const found = await getPrisma().bulkMessageApproval.findFirst({ where: { id: batchId, eventId }, select: { id: true } });
  return found !== null;
}
