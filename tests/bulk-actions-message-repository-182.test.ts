import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPermission } from "@/modules/access/permissions";

// #182 slice 2: a confirmed bulk message is only QUEUED. It is sent by an explicit approval, with a fresh review. Synthetic data only.
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class MockMessagingError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    getPrisma: vi.fn(),
    writeAuditLog: vi.fn(),
    enumerate: vi.fn(),
    preview: vi.fn(),
    enqueue: vi.fn(),
    outbox: vi.fn(),
    MessagingError: MockMessagingError,
  };
});
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/registrations/operations-search-repository", () => ({ enumerateOperationsRegistrationIds: mocks.enumerate }));
vi.mock("@/modules/tags/repository", () => ({ listActiveTags: vi.fn(), listTags: vi.fn(), applyRegistrationTag: vi.fn(), removeRegistrationTag: vi.fn(), TagConfigurationError: class extends Error {} }));
vi.mock("@/modules/communications/messaging-repository", () => ({
  getSelectedAudiencePreview: mocks.preview,
  enqueueSelectedAudienceBatch: mocks.enqueue,
  MessagingError: mocks.MessagingError,
}));

import { BulkActionError } from "@/modules/bulk-actions/domain";
import { approveMessage, declineMessage, isReservedBatchId, getMessageApprovalReview, listMessageApprovals, type ApprovalViewer } from "@/modules/bulk-actions/message-approvals";
import { confirmBulkAction, createBulkPreview, listRecentBulkActions, type BulkActionViewer } from "@/modules/bulk-actions/repository";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let runs: Row[];
let outcomes: Row[];
let approvals: Row[];
let matching: string[];
let batchAudit: Row | null;
let batchMessages: Row[];
let failOutcomeWrites: boolean;

const NOW = new Date("2027-03-01T15:00:00.000Z");
const FINGERPRINT = "a".repeat(64);
const STALE_FINGERPRINT = "b".repeat(64);
const queuer: EventPermission[] = ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_COMMUNICATIONS"];
const viewer = (permissions: EventPermission[] = queuer, userId = "user-a"): BulkActionViewer => ({ eventId: "event-1", userId, permissions });
const approver = (permissions: EventPermission[] = ["MANAGE_COMMUNICATIONS"], userId = "user-b", eventId = "event-1"): ApprovalViewer => ({ eventId, userId, permissions });
const KEY = "confirm-key-0001";

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, test]) => {
    if (key === "OR") return (test as Row[]).some((clause) => matches(row, clause));
    const value = row[key];
    if (test && typeof test === "object" && !(test instanceof Date)) {
      const t = test as Row;
      if ("in" in t) return t.in.includes(value);
      if ("not" in t) return value !== t.not;
      if ("gt" in t) return value > t.gt;
      if ("lt" in t) return value != null && value < t.lt;
      if ("lte" in t) return value <= t.lte;
    }
    return value === test;
  });
}

function installPrisma() {
  const bulkActionRun = {
    create: vi.fn(async ({ data }: { data: Row }) => { runs.push({ completedCount: 0, skippedCount: 0, conflictCount: 0, failedCount: 0, obsoleteCount: 0, exportRowCount: null, idempotencyKey: null, confirmedAt: null, completedAt: null, ...data }); return data; }),
    findFirst: vi.fn(async ({ where }: { where: Row }) => { const found = runs.find((run) => matches(run, where)); return found ? { ...found } : null; }),
    findMany: vi.fn(async ({ where, take }: { where: Row; take?: number }) => runs.filter((run) => matches(run, where)).slice(0, take).map((run) => ({ ...run, actor: { displayName: "Alex Sample" } }))),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const hit = runs.filter((run) => matches(run, where)); hit.forEach((run) => Object.assign(run, data)); return { count: hit.length }; }),
  };
  const bulkActionRecordOutcome = {
    createMany: vi.fn(async ({ data }: { data: Row[] }) => { if (failOutcomeWrites) { failOutcomeWrites = false; throw new Error("outcome write failed"); } outcomes.push(...data.filter((row) => !outcomes.some((have) => have.runId === row.runId && have.registrationId === row.registrationId))); return { count: data.length }; }),
    findMany: vi.fn(async ({ where }: { where: { runId: string; outcome?: { not: string } } }) =>
      outcomes.filter((row) => row.runId === where.runId && (!where.outcome || row.outcome !== where.outcome.not)).map((row) => ({ ...row, registration: { confirmationCode: `CODE-${row.registrationId}` } }))),
  };
  const registration = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, confirmationCode: `CODE-${id}`, updatedAt: new Date("2027-02-01T10:00:00.000Z") }))),
  };
  const bulkMessageApproval = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (approvals.some((row) => row.runId === data.runId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      approvals.push({ decidedByUserId: null, decidedAt: null, sendResult: null, createdAt: NOW, updatedAt: NOW, ...data });
      return data;
    }),
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const found = approvals.find((row) => matches(row, where));
      return found ? { ...found, queuedBy: { displayName: "Alex Sample" }, decidedBy: found.decidedByUserId ? { displayName: "Blake Sample" } : null } : null;
    }),
    findMany: vi.fn(async ({ where }: { where: Row }) => approvals.filter((row) => matches(row, where)).map((row) => ({ ...row, queuedBy: { displayName: "Alex Sample" }, decidedBy: row.decidedByUserId ? { displayName: "Blake Sample" } : null }))),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const hit = approvals.filter((row) => matches(row, where)); hit.forEach((row) => Object.assign(row, data, { updatedAt: new Date() })); return { count: hit.length }; }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => { const hit = approvals.filter((row) => matches(row, where)); approvals = approvals.filter((row) => !hit.includes(row)); return { count: hit.length }; }),
  };
  const auditLog = { findFirst: vi.fn(async () => batchAudit) };
  // Confirming a bulk message must never touch the outbox: any call is recorded, and the tests assert there are none.
  const messageOutbox = { create: mocks.outbox, createMany: mocks.outbox, update: mocks.outbox, updateMany: mocks.outbox, findMany: vi.fn(async () => batchMessages) };
  const db = { bulkActionRun, bulkActionRecordOutcome, registration, bulkMessageApproval, messageOutbox, auditLog, $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
  mocks.getPrisma.mockReturnValue(db);
}

function previewFor(ids: string[], skipped: Array<[string, string]> = [], overrides: Row = {}) {
  const skippedIds = new Set(skipped.map(([id]) => id));
  const recipients = ids.filter((id) => !skippedIds.has(id)).map((id) => ({ registrationId: id, confirmationCode: `CODE-${id}` }));
  return {
    fingerprint: FINGERPRINT,
    includedCount: recipients.length,
    skippedCount: skipped.length,
    deliveryMode: "LOCAL_CAPTURE",
    templatePublished: true,
    attachmentProblem: null,
    recipients,
    skipped: skipped.map(([id, code]) => ({ registrationId: id, code, label: "x", confirmationCode: `CODE-${id}`, recipientName: "Pat Sample" })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  runs = [];
  outcomes = [];
  approvals = [];
  matching = ["reg-1", "reg-2", "reg-3", "reg-4"];
  batchAudit = null;
  mocks.writeAuditLog.mockReset();
  batchMessages = [];
  failOutcomeWrites = false;
  installPrisma();
  mocks.enumerate.mockImplementation(async (_viewer: unknown, _params: unknown, _catalog: unknown, _issues: unknown, onlyIds?: string[]) => {
    const ids = onlyIds ? matching.filter((id) => onlyIds.includes(id)) : [...matching];
    return { ok: true, issues: [], total: ids.length, registrationIds: ids, queryString: "", query: {} };
  });
  mocks.preview.mockImplementation(async (_event: string, _key: string, ids: string[]) => previewFor(ids, [["reg-3", "NO_BALANCE_DUE"], ["reg-4", "ANNOUNCEMENT_OPTED_OUT_ALL"]].filter(([id]) => ids.includes(id)) as Array<[string, string]>));
  mocks.enqueue.mockImplementation(async (_event: string, input: { registrationIds: string[] }) => ({
    batchId: "x", templateKey: "BALANCE_REMINDER", messageIds: [], includedCount: 2, skippedCount: 2, deliveryMode: "LOCAL_CAPTURE", queuedCount: 0, capturedCount: input.registrationIds.length, suppressedCount: 0, replayed: false,
  }));
});

afterEach(() => vi.useRealTimers());

type Input = Parameters<typeof createBulkPreview>[1];
const messageInput = (overrides: Record<string, unknown> = {}): Input => ({ action: "QUEUE_MESSAGE", params: { templateKey: "BALANCE_REMINDER" }, query: "", ...overrides });
const infoInput = (): Input => ({ action: "REQUEST_INFORMATION", params: { title: "Shirt sizes", details: "Please add each camper's shirt size." }, query: "" });

async function refusal(promise: Promise<unknown>) {
  try { await promise; } catch (error) { expect(error).toBeInstanceOf(BulkActionError); return error as BulkActionError; }
  throw new Error("expected a refusal");
}

async function queue(input: Input = messageInput()) {
  const preview = await createBulkPreview(viewer(), input);
  const result = await confirmBulkAction(viewer(), preview.runId, KEY);
  return { preview, result };
}

describe("previewing a message action", () => {
  it("says nothing is sent now, names the skips with plain reasons, and sends nothing", async () => {
    const preview = await createBulkPreview(viewer(), messageInput());
    expect(preview).toMatchObject({ action: "QUEUE_MESSAGE", candidateCount: 4, willChangeCount: 2, createsFile: false });
    expect(preview.effect).toContain("Nothing is sent now. The message waits for approval under Messages waiting for approval.");
    expect(preview.proposedChange).toContain("balance reminder");
    expect(preview.exclusions).toEqual([
      expect.objectContaining({ reason: "NO_BALANCE_DUE", count: 1, sampleCodes: ["CODE-reg-3"] }),
      expect.objectContaining({ reason: "OPTED_OUT", count: 1, sampleCodes: ["CODE-reg-4"] }),
    ]);
    expect(preview.permissionsUsed).toContain("sending messages");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(approvals).toHaveLength(0);
  });

  it("describes a request for information with its title and the opt-out note", async () => {
    const preview = await createBulkPreview(viewer(), infoInput());
    expect(preview.proposedChange).toBe('Request missing information: "Shirt sizes"');
    expect(preview.effect).toContain("opted out of announcements are skipped");
    expect(mocks.preview).toHaveBeenCalledWith("event-1", "EVENT_ANNOUNCEMENT", expect.anything());
  });

  it("needs communications access on top of the People list access", async () => {
    expect((await refusal(createBulkPreview(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"]), messageInput()))).message).toContain("sending messages");
    expect((await refusal(createBulkPreview(viewer(["VIEW_EVENT", "MANAGE_COMMUNICATIONS"]), messageInput()))).code).toBe("PERMISSION_DENIED");
    expect(runs).toHaveLength(0);
  });

  it("refuses a template that cannot be sent, and more than 250 registrations", async () => {
    mocks.preview.mockResolvedValueOnce(previewFor([], [], { templatePublished: false }));
    expect((await refusal(createBulkPreview(viewer(), messageInput({ params: { templateKey: "CUSTOM_MESSAGE" } })))).message).toContain("not been published");
    mocks.preview.mockResolvedValueOnce(previewFor([], [], { attachmentProblem: "A file is too large." }));
    expect((await refusal(createBulkPreview(viewer(), messageInput({ params: { templateKey: "CUSTOM_MESSAGE" } })))).message).toBe("A file is too large.");
    matching = Array.from({ length: 251 }, (_, index) => `reg-${index}`);
    mocks.preview.mockImplementation(async (_e: string, _k: string, ids: string[]) => previewFor(ids));
    expect((await refusal(createBulkPreview(viewer(), messageInput()))).code).toBe("TOO_BROAD");
    expect(runs).toHaveLength(0);
  });

  it("keeps the staff-written text out of the audit trail", async () => {
    await createBulkPreview(viewer(), messageInput({ params: { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Uniquetitle", announcementBody: "Uniquebody" } }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(/Uniquetitle|Uniquebody/);
  });
});

describe("confirming a message action", () => {
  it("queues ONE approval, never sends, never touches the outbox, and records counts", async () => {
    const { result } = await queue();
    expect(result.summary).toMatchObject({ status: "APPLIED", completedLabel: "Queued for approval", counts: { completed: 2, skipped: 2, failed: 0 } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ eventId: "event-1", runId: result.summary.runId, action: "QUEUE_MESSAGE", templateKey: "BALANCE_REMINDER", status: "PENDING_APPROVAL", queuedCount: 2, queuedByUserId: "user-a", registrationIds: ["reg-1", "reg-2"] });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.outbox).not.toHaveBeenCalled();
    const queuedAudit = mocks.writeAuditLog.mock.calls.map(([entry]) => entry).find((entry) => entry.action === "BULK_MESSAGE_QUEUED");
    expect(queuedAudit).toMatchObject({ entityType: "BulkMessageApproval", metadata: { templateKey: "BALANCE_REMINDER", queuedCount: 2, skippedCount: 2, runId: result.summary.runId } });
  });

  it("maps skips to reason codes with no personal data", async () => {
    const { result } = await queue();
    expect(outcomes.filter((row) => row.outcome === "SKIPPED").map((row) => [row.registrationId, row.reason])).toEqual([["reg-3", "NO_BALANCE_DUE"], ["reg-4", "OPTED_OUT"]]);
    expect(result.summary.notCompleted.map((row) => row.reason)).toEqual(["No balance is due.", "The contact opted out of announcements."]);
    const stored = JSON.stringify([runs, approvals, outcomes, mocks.writeAuditLog.mock.calls]);
    expect(stored).not.toMatch(/example\.test|Pat Sample/);
  });

  it("stores the announcement text on the approval, and a request for information as an announcement", async () => {
    await queue(infoInput());
    expect(approvals[0]).toMatchObject({ action: "REQUEST_INFORMATION", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Shirt sizes", announcementBody: "Please add each camper's shirt size." });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("shirt size.");
  });

  it("a duplicate confirm returns the stored result and leaves one approval", async () => {
    const preview = await createBulkPreview(viewer(), messageInput());
    await confirmBulkAction(viewer(), preview.runId, KEY);
    const again = await confirmBulkAction(viewer(), preview.runId, KEY);
    expect(again.summary.replayed).toBe(true);
    expect(approvals).toHaveLength(1);
    expect((await refusal(confirmBulkAction(viewer(), preview.runId, "another-key-0002"))).code).toBe("ALREADY_CONFIRMED");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("queues nothing when nobody can receive it", async () => {
    mocks.preview.mockImplementation(async (_e: string, _k: string, ids: string[]) => previewFor(ids, ids.map((id) => [id, "INVALID_CONTACT_EMAIL"] as [string, string])));
    const { result } = await queue();
    expect(result.summary.counts).toMatchObject({ completed: 0, skipped: 4 });
    expect(approvals).toHaveLength(0);
  });

  it("refuses at confirm when communications access was removed after the preview", async () => {
    const preview = await createBulkPreview(viewer(), messageInput());
    expect((await refusal(confirmBulkAction(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"]), preview.runId, KEY))).code).toBe("PERMISSION_DENIED");
    expect(approvals).toHaveLength(0);
  });

  it("history calls a queued run queued, not completed", async () => {
    await queue();
    expect((await listRecentBulkActions("event-1"))[0]).toMatchObject({ completedLabel: "Queued for approval" });
  });
});

describe("approving", () => {
  async function queued() {
    const { result } = await queue();
    return { approvalId: approvals[0].id as string, runId: result.summary.runId };
  }

  it("sends through the reviewed batch with the approval id and the fingerprint the person was shown, then stores counts only", async () => {
    const { approvalId } = await queued();
    const decision = await approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW });
    expect(decision).toMatchObject({ status: "SENT", replayed: false, sendResult: { included: 2, skipped: 2, queued: 0, captured: 2, suppressed: 0 } });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith("event-1", { batchId: approvalId, templateKey: "BALANCE_REMINDER", registrationIds: ["reg-1", "reg-2"], announcementTitle: "", announcementBody: "", previewFingerprint: FINGERPRINT }, "user-b");
    expect(approvals[0]).toMatchObject({ status: "SENT", decidedByUserId: "user-b", decidedAt: NOW });
    expect(Object.keys(approvals[0].sendResult).sort()).toEqual(["captured", "included", "queued", "skipped", "suppressed"]);
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toContain("BULK_MESSAGE_APPROVED");
  });

  it("lets the person who queued it approve it", async () => {
    const { approvalId } = await queued();
    await expect(approveMessage(approver(["MANAGE_COMMUNICATIONS"], "user-a"), approvalId, FINGERPRINT)).resolves.toMatchObject({ status: "SENT" });
  });

  it("needs communications access at approval time: a permission removed after queueing sends nothing", async () => {
    const { approvalId } = await queued();
    expect((await refusal(approveMessage(approver(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"]), approvalId, FINGERPRINT))).code).toBe("PERMISSION_DENIED");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(approvals[0].status).toBe("PENDING_APPROVAL");
  });

  it("goes back to waiting when the review changed, and marks nothing sent", async () => {
    const { approvalId } = await queued();
    mocks.enqueue.mockRejectedValueOnce(new mocks.MessagingError("PREVIEW_CHANGED", "These registrations changed since you reviewed them."));
    await expect(approveMessage(approver(), approvalId, STALE_FINGERPRINT)).rejects.toMatchObject({ code: "PREVIEW_CHANGED" });
    expect(approvals[0]).toMatchObject({ status: "PENDING_APPROVAL", decidedByUserId: null, sendResult: null });
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).not.toContain("BULK_MESSAGE_APPROVED");
    // Approving again with the fresh fingerprint works.
    await expect(approveMessage(approver(), approvalId, FINGERPRINT)).resolves.toMatchObject({ status: "SENT" });
  });

  it("approving twice sends once and returns the stored result", async () => {
    const { approvalId } = await queued();
    await approveMessage(approver(), approvalId, FINGERPRINT);
    const second = await approveMessage(approver(), approvalId, FINGERPRINT);
    expect(second).toMatchObject({ status: "SENT", replayed: true, sendResult: { included: 2 } });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("refuses a second approval while the first is sending, and retries a stale one with the same batch id", async () => {
    const { approvalId } = await queued();
    approvals[0].status = "SENDING";
    approvals[0].updatedAt = new Date(NOW.getTime() - 60_000);
    expect((await refusal(approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW }))).code).toBe("IN_PROGRESS");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    approvals[0].updatedAt = new Date(NOW.getTime() - 11 * 60_000);
    await expect(approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW })).resolves.toMatchObject({ status: "SENT" });
    expect(mocks.enqueue).toHaveBeenCalledWith("event-1", expect.objectContaining({ batchId: approvalId }), "user-b");
  });

  it("refuses a missing or malformed fingerprint", async () => {
    const { approvalId } = await queued();
    expect((await refusal(approveMessage(approver(), approvalId, undefined))).code).toBe("INVALID_REQUEST");
    expect((await refusal(approveMessage(approver(), approvalId, "short"))).code).toBe("INVALID_REQUEST");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("treats an approval from another event as not found", async () => {
    const { approvalId } = await queued();
    expect((await refusal(approveMessage(approver(["MANAGE_COMMUNICATIONS"], "user-b", "event-2"), approvalId, FINGERPRINT))).code).toBe("NOT_FOUND");
    expect((await refusal(declineMessage(approver(["MANAGE_COMMUNICATIONS"], "user-b", "event-2"), approvalId))).code).toBe("NOT_FOUND");
    expect((await refusal(getMessageApprovalReview(approver(["MANAGE_COMMUNICATIONS"], "user-b", "event-2"), approvalId))).code).toBe("NOT_FOUND");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(approvals[0].status).toBe("PENDING_APPROVAL");
  });
});

describe("a send that committed but was not recorded", () => {
  async function queuedOne() {
    await queue();
    return approvals[0].id as string;
  }

  it("is marked SENT, not reset to waiting, when the send failed after its batch was written", async () => {
    const approvalId = await queuedOne();
    batchAudit = { metadata: { batchId: approvalId, templateKey: "BALANCE_REMINDER", selectedCount: 2, includedCount: 2, skippedCount: 2 } };
    batchMessages = [{ status: "CAPTURED" }, { status: "CAPTURED" }];
    mocks.enqueue.mockRejectedValueOnce(new Error("capture failed after commit"));
    const decision = await approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW });
    expect(decision).toMatchObject({ status: "SENT", sendResult: { included: 2, skipped: 2, captured: 2, queued: 0, suppressed: 0 } });
    expect(approvals[0]).toMatchObject({ status: "SENT", decidedByUserId: "user-b" });
    // It can no longer be declined as if it had not gone out.
    expect((await refusal(declineMessage(approver(), approvalId))).code).toBe("ALREADY_DECIDED");
  });

  it("resets to waiting only when no batch exists", async () => {
    const approvalId = await queuedOne();
    mocks.enqueue.mockRejectedValueOnce(new mocks.MessagingError("PREVIEW_CHANGED", "changed"));
    await expect(approveMessage(approver(), approvalId, STALE_FINGERPRINT)).rejects.toMatchObject({ code: "PREVIEW_CHANGED" });
    expect(approvals[0].status).toBe("PENDING_APPROVAL");
  });

  it("a stale SENDING retry records an existing batch instead of sending again", async () => {
    const approvalId = await queuedOne();
    approvals[0].status = "SENDING";
    approvals[0].updatedAt = new Date(NOW.getTime() - 11 * 60_000);
    batchAudit = { metadata: { batchId: approvalId, templateKey: "BALANCE_REMINDER", selectedCount: 2, includedCount: 2, skippedCount: 2 } };
    batchMessages = [{ status: "PENDING" }, { status: "SUPPRESSED" }];
    const decision = await approveMessage(approver(), approvalId, STALE_FINGERPRINT, { now: NOW });
    expect(decision).toMatchObject({ status: "SENT", sendResult: { queued: 1, suppressed: 1 } });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe("recording a send that already exists", () => {
  async function queuedOne() {
    await queue();
    return approvals[0].id as string;
  }

  it("does not count a batch of another template or size as this approval's", async () => {
    const approvalId = await queuedOne();
    batchAudit = { metadata: { batchId: approvalId, templateKey: "EVENT_ANNOUNCEMENT", selectedCount: 2, includedCount: 2, skippedCount: 0 } };
    mocks.enqueue.mockRejectedValueOnce(new mocks.MessagingError("IDEMPOTENCY_KEY_REUSED", "used"));
    await expect(approveMessage(approver(), approvalId, FINGERPRINT)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(approvals[0].status).toBe("PENDING_APPROVAL");
    batchAudit = { metadata: { batchId: approvalId, templateKey: "BALANCE_REMINDER", selectedCount: 9, includedCount: 9, skippedCount: 0 } };
    mocks.enqueue.mockRejectedValueOnce(new mocks.MessagingError("IDEMPOTENCY_KEY_REUSED", "used"));
    await expect(approveMessage(approver(), approvalId, FINGERPRINT)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(approvals[0].status).toBe("PENDING_APPROVAL");
  });

  it("leaves the row SENDING when the existence check itself fails, so a later approval can take it over", async () => {
    const approvalId = await queuedOne();
    mocks.enqueue.mockRejectedValueOnce(new Error("capture failed"));
    const db = mocks.getPrisma();
    db.auditLog.findFirst.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW })).rejects.toThrow("lookup failed");
    expect(approvals[0].status).toBe("SENDING");
    // Not stale yet: refused. Stale: taken over, and the existing batch is recorded.
    expect((await refusal(approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW }))).code).toBe("IN_PROGRESS");
    approvals[0].updatedAt = new Date(NOW.getTime() - 11 * 60_000);
    batchAudit = { metadata: { batchId: approvalId, templateKey: "BALANCE_REMINDER", selectedCount: 2, includedCount: 2, skippedCount: 2 } };
    await expect(approveMessage(approver(), approvalId, FINGERPRINT, { now: NOW })).resolves.toMatchObject({ status: "SENT" });
  });

  it("answers not found when the row is gone after a failed claim", async () => {
    const approvalId = await queuedOne();
    const db = mocks.getPrisma();
    // The claim matches nothing and the reload finds nothing.
    db.bulkMessageApproval.updateMany.mockImplementationOnce(async () => { approvals = []; return { count: 0 }; });
    const error = await refusal(approveMessage(approver(), approvalId, FINGERPRINT));
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("This message is no longer waiting for approval.");
  });

  it("reserves the batch id of a queued message within its own event", async () => {
    const approvalId = await queuedOne();
    expect(await isReservedBatchId("event-1", approvalId)).toBe(true);
    expect(await isReservedBatchId("event-1", "11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});

describe("a run that cannot record its outcomes", () => {
  it("leaves no approvable message behind", async () => {
    const preview = await createBulkPreview(viewer(), messageInput());
    failOutcomeWrites = true;
    const { summary } = await confirmBulkAction(viewer(), preview.runId, KEY);
    expect(approvals).toHaveLength(0);
    expect(summary.counts.completed).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("notes in the audit trail that a removed queued message was withdrawn", async () => {
    const preview = await createBulkPreview(viewer(), messageInput());
    failOutcomeWrites = true;
    await confirmBulkAction(viewer(), preview.runId, KEY);
    const withdrawn = mocks.writeAuditLog.mock.calls.map(([entry]) => entry).find((entry) => entry.action === "BULK_MESSAGE_WITHDRAWN");
    expect(withdrawn).toMatchObject({ summary: "Queued message removed: the bulk action did not finish.", entityId: preview.runId });
  });

  it("writes the approval and its audit row in one transaction, and neither when the audit row fails", async () => {
    const preview = await createBulkPreview(viewer(), messageInput());
    mocks.writeAuditLog.mockImplementation(async (entry: { action: string }) => { if (entry.action === "BULK_MESSAGE_QUEUED") throw new Error("audit failed"); });
    // The transaction stand-in has no rollback, so the cleanup after the failed handler is what removes the approval.
    await confirmBulkAction(viewer(), preview.runId, KEY);
    expect(approvals).toHaveLength(0);
    expect(outcomes.every((row) => row.outcome === "FAILED")).toBe(true);
  });
});

describe("recovering a run that stopped after queueing", () => {
  async function stuckRun() {
    const preview = await createBulkPreview(viewer(), messageInput());
    const run = runs.find((row) => row.id === preview.runId)!;
    Object.assign(run, { status: "APPLYING", idempotencyKey: KEY, confirmedAt: new Date(NOW.getTime() - 20 * 60_000) });
    approvals.push({ id: "approval-x", eventId: "event-1", runId: run.id, action: "QUEUE_MESSAGE", templateKey: "BALANCE_REMINDER", registrationIds: ["reg-1"], queuedCount: 1, status: "PENDING_APPROVAL", queuedByUserId: "user-a", decidedByUserId: null, decidedAt: null, sendResult: null, createdAt: NOW, updatedAt: NOW });
    return run;
  }

  it("removes the waiting approval when nothing was recorded as done", async () => {
    const run = await stuckRun();
    const { summary } = await confirmBulkAction(viewer(), run.id, KEY, { now: NOW });
    expect(summary.counts.completed).toBe(0);
    expect(approvals).toHaveLength(0);
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toContain("BULK_MESSAGE_WITHDRAWN");
  });

  it("keeps the approval when some outcome was recorded as done", async () => {
    const run = await stuckRun();
    outcomes.push({ runId: run.id, registrationId: "reg-1", outcome: "COMPLETED", reason: null });
    await confirmBulkAction(viewer(), run.id, KEY, { now: NOW });
    expect(approvals).toHaveLength(1);
  });
});

describe("declining", () => {
  it("never sends, audits, and cannot be approved afterwards", async () => {
    await queue();
    const approvalId = approvals[0].id as string;
    expect(await declineMessage(approver(), approvalId, { now: NOW })).toMatchObject({ status: "DECLINED" });
    expect(approvals[0]).toMatchObject({ status: "DECLINED", decidedByUserId: "user-b" });
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toContain("BULK_MESSAGE_DECLINED");
    expect((await refusal(approveMessage(approver(), approvalId, FINGERPRINT))).code).toBe("ALREADY_DECIDED");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("needs communications access, and cannot undo a sent message", async () => {
    await queue();
    const approvalId = approvals[0].id as string;
    expect((await refusal(declineMessage(approver(["VIEW_EVENT"]), approvalId))).code).toBe("PERMISSION_DENIED");
    await approveMessage(approver(), approvalId, FINGERPRINT);
    expect((await refusal(declineMessage(approver(), approvalId))).code).toBe("ALREADY_DECIDED");
  });
});

describe("the fresh review and the list", () => {
  it("reads a fresh preview and shows counts, reasons, text and sample codes, never an address or a name", async () => {
    await queue(infoInput());
    const approvalId = approvals[0].id as string;
    mocks.preview.mockClear();
    const review = await getMessageApprovalReview(approver(), approvalId);
    expect(mocks.preview).toHaveBeenCalledWith("event-1", "EVENT_ANNOUNCEMENT", ["reg-1", "reg-2"]);
    expect(review).toMatchObject({ title: "Shirt sizes", body: "Please add each camper's shirt size.", fingerprint: FINGERPRINT, deliveryMode: "LOCAL_CAPTURE", queuedCount: 2, includedCount: 2, sampleCodes: ["CODE-reg-1", "CODE-reg-2"], status: "PENDING_APPROVAL" });
    expect(JSON.stringify(review)).not.toMatch(/example\.test|Pat Sample/);
  });

  it("groups skipped people by reason label", async () => {
    await queue();
    const approvalId = approvals[0].id as string;
    mocks.preview.mockResolvedValueOnce(previewFor(["reg-1", "reg-2", "reg-3"], [["reg-2", "INVALID_CONTACT_EMAIL"], ["reg-3", "INVALID_CONTACT_EMAIL"]]));
    const review = await getMessageApprovalReview(approver(), approvalId);
    expect(review.skippedByReason).toEqual([{ reason: "NO_VALID_EMAIL", label: "It has no valid contact email.", count: 2 }]);
  });

  it("lists pending and recently decided, and needs communications access", async () => {
    await queue();
    expect((await listMessageApprovals(approver())).pending).toEqual([expect.objectContaining({ actionLabel: "Queue a message for approval", templateLabel: "Balance reminder", queuedByName: "Alex Sample", queuedCount: 2, status: "PENDING_APPROVAL" })]);
    await approveMessage(approver(), approvals[0].id, FINGERPRINT, { now: NOW });
    const list = await listMessageApprovals(approver());
    expect(list.pending).toHaveLength(0);
    expect(list.decided).toEqual([expect.objectContaining({ status: "SENT", decidedByName: "Blake Sample" })]);
    expect((await refusal(listMessageApprovals(approver(["VIEW_EVENT"])))).code).toBe("PERMISSION_DENIED");
  });
});
