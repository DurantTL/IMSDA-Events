import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPermission } from "@/modules/access/permissions";

// #182: the reviewed bulk-action framework against an in-memory stand-in for the database. Synthetic data only.
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class MockTagConfigurationError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    getPrisma: vi.fn(),
    writeAuditLog: vi.fn(),
    enumerate: vi.fn(),
    listActiveTags: vi.fn(),
    listTags: vi.fn(),
    applyTag: vi.fn(),
    removeTag: vi.fn(),
    TagConfigurationError: MockTagConfigurationError,
  };
});
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/registrations/operations-search-repository", () => ({ enumerateOperationsRegistrationIds: mocks.enumerate }));
vi.mock("@/modules/tags/repository", () => ({
  listActiveTags: mocks.listActiveTags,
  listTags: mocks.listTags,
  applyRegistrationTag: mocks.applyTag,
  removeRegistrationTag: mocks.removeTag,
  TagConfigurationError: mocks.TagConfigurationError,
}));

import { BulkActionError } from "@/modules/bulk-actions/domain";
import {
  confirmBulkAction,
  createBulkPreview,
  getBulkSummary,
  listRecentBulkActions,
  type BulkActionViewer,
} from "@/modules/bulk-actions/repository";

type Reg = {
  id: string;
  confirmationCode: string;
  status: string;
  updatedAt: Date;
  submittedAt: Date | null;
  contactSnapshot: Record<string, string>;
  accountHolderPerson: { firstName: string; lastName: string; normalizedEmail: string | null; phone: string | null };
  _count: { attendees: number };
  tagAssignments: Array<{ tag: { name: string } }>;
  totalAmount: number;
  payments: Array<{ amount: number; status?: string; refunds: Array<{ amount: number; status?: string }> }>;
  event: { billingMode: string };
  groupRegistration: { id: string } | null;
};
type Run = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Outcome = { runId: string; registrationId: string; outcome: string; reason: string | null };

let regs: Map<string, Reg>;
let runs: Run[];
let outcomes: Outcome[];
/** "registrationId|tagId" pairs that currently carry the tag. */
let assigned: Set<string>;
let matching: string[];
let failFor: Set<string>;
let selects: Array<Record<string, unknown>>;
let createManyCalls = 0;
let failCreateManyOn = 0;

const NOW = new Date("2027-03-01T15:00:00.000Z");
const TAG = { id: "tag-1", name: "Follow up" };
const owner: EventPermission[] = ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION", "VIEW_REPORTS", "MANAGE_FINANCE"];
const viewer = (permissions: EventPermission[] = owner, userId = "user-a"): BulkActionViewer => ({ eventId: "event-1", userId, permissions });

function makeReg(index: number, overrides: Partial<Reg> = {}): Reg {
  return {
    id: `reg-${index}`,
    confirmationCode: `CODE${String(index).padStart(4, "0")}`,
    status: "CONFIRMED",
    updatedAt: new Date("2027-02-01T10:00:00.000Z"),
    submittedAt: new Date("2027-01-15T12:00:00.000Z"),
    contactSnapshot: { firstName: `Pat${index}`, lastName: "Sample", email: `pat${index}@example.test`, phone: "(515) 555-0100" },
    accountHolderPerson: { firstName: "Pat", lastName: "Sample", normalizedEmail: `pat${index}@example.test`, phone: "(515) 555-0100" },
    _count: { attendees: 2 },
    tagAssignments: [],
    totalAmount: 100,
    payments: [{ amount: 40, status: "SUCCEEDED", refunds: [] }],
    event: { billingMode: "PER_REGISTRATION" },
    groupRegistration: null,
    ...overrides,
  };
}

function seed(count: number) {
  regs = new Map();
  for (let index = 1; index <= count; index += 1) regs.set(`reg-${index}`, makeReg(index));
  matching = [...regs.keys()];
}

function pick(row: Record<string, unknown>, select: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  // The same status filters the real query asks for: only SUCCEEDED payments and refunds come back.
  if (select.payments?.where?.status && Array.isArray(row.payments)) {
    out.payments = (row.payments as Reg["payments"]).filter((payment) => payment.status === select.payments.where.status)
      .map((payment) => ({ ...payment, refunds: payment.refunds.filter((refund) => refund.status === select.payments.select.refunds.where.status) }));
  }
  return out;
}

function cond(value: unknown, test: unknown): boolean {
  const num = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  if (test && typeof test === "object" && !(test instanceof Date)) {
    const t = test as Record<string, unknown>;
    if ("in" in t) return (t.in as unknown[]).includes(value);
    if ("not" in t) return value !== t.not;
    if ("gt" in t) return (num(value) as number) > (num(t.gt) as number);
    if ("gte" in t) return (num(value) as number) >= (num(t.gte) as number);
    if ("lt" in t) return value != null && (num(value) as number) < (num(t.lt) as number);
    if ("lte" in t) return (num(value) as number) <= (num(t.lte) as number);
  }
  return value === test;
}

function runMatches(run: Run, where: Record<string, any>): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
  return Object.entries(where).every(([key, value]) => cond(run[key], value));
}

function installPrisma() {
  const bulkActionRun = {
    create: vi.fn(async ({ data }: { data: Run }) => {
      runs.push({ completedCount: 0, skippedCount: 0, conflictCount: 0, failedCount: 0, obsoleteCount: 0, exportRowCount: null, idempotencyKey: null, confirmedAt: null, completedAt: null, ...data });
      return data;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const found = runs.find((run) => runMatches(run, where));
      return found ? { ...found } : null;
    }),
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
      runs.filter((run) => runMatches(run, where)).sort((a, b) => b.previewedAt.getTime() - a.previewedAt.getTime()).slice(0, take).map((run) => ({ ...run, actor: { displayName: "Alex Sample" } }))),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Run }) => {
      const hit = runs.filter((run) => runMatches(run, where));
      if (hit.length > 0 && data.idempotencyKey && runs.some((run) => run.eventId === (where.eventId ?? "event-1") && run.idempotencyKey === data.idempotencyKey && !hit.includes(run))) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      hit.forEach((run) => Object.assign(run, data));
      return { count: hit.length };
    }),
  };
  const bulkActionRecordOutcome = {
    createMany: vi.fn(async ({ data }: { data: Outcome[] }) => {
      createManyCalls += 1;
      if (failCreateManyOn === createManyCalls) throw new Error("outcome write failed");
      const fresh = data.filter((row) => !outcomes.some((have) => have.runId === row.runId && have.registrationId === row.registrationId));
      outcomes.push(...fresh);
      return { count: fresh.length };
    }),
    findMany: vi.fn(async ({ where, take }: { where: { runId: string; outcome?: { not: string } }; take?: number }) =>
      outcomes.filter((row) => row.runId === where.runId && (!where.outcome || row.outcome !== where.outcome.not)).slice(0, take)
        .map((row) => ({ ...row, registration: { confirmationCode: regs.get(row.registrationId)?.confirmationCode ?? "GONE" } }))),
  };
  const registration = {
    findMany: vi.fn(async ({ where, select }: { where: { id: { in: string[] } }; select: Record<string, unknown> }) => {
      selects.push(select);
      return where.id.in.flatMap((id) => (regs.has(id) ? [pick(regs.get(id) as unknown as Record<string, unknown>, select)] : []));
    }),
  };
  const registrationTagAssignment = {
    findMany: vi.fn(async ({ where }: { where: { tagId: string; registrationId: { in: string[] } } }) =>
      where.registrationId.in.filter((id) => assigned.has(`${id}|${where.tagId}`)).map((registrationId) => ({ registrationId }))),
  };
  mocks.getPrisma.mockReturnValue({ bulkActionRun, bulkActionRecordOutcome, registration, registrationTagAssignment });
  return { bulkActionRun };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  runs = [];
  outcomes = [];
  assigned = new Set();
  failFor = new Set();
  selects = [];
  createManyCalls = 0;
  failCreateManyOn = 0;
  seed(3);
  installPrisma();
  mocks.listActiveTags.mockResolvedValue([TAG]);
  mocks.listTags.mockResolvedValue([TAG]);
  mocks.enumerate.mockImplementation(async (_viewer: unknown, _params: unknown, _catalog: unknown, _issues: unknown, onlyIds?: string[]) => {
    const ids = onlyIds ? matching.filter((id) => onlyIds.includes(id)) : [...matching];
    return { ok: true, issues: [], total: ids.length, registrationIds: ids, queryString: "", query: {} };
  });
  mocks.applyTag.mockImplementation(async (_event: string, registrationId: string, tagId: string) => {
    if (failFor.has(registrationId)) throw new Error("write failed");
    assigned.add(`${registrationId}|${tagId}`);
  });
  mocks.removeTag.mockImplementation(async (_event: string, registrationId: string, tagId: string) => {
    if (failFor.has(registrationId)) throw new Error("write failed");
    assigned.delete(`${registrationId}|${tagId}`);
  });
});

afterEach(() => vi.useRealTimers());

type Input = Parameters<typeof createBulkPreview>[1];
const tagInput = (overrides: Record<string, unknown> = {}): Input => ({ action: "APPLY_TAG", params: { tagId: TAG.id }, query: "status=CONFIRMED", ...overrides });
const exportInput = (fields: string[], overrides: Record<string, unknown> = {}): Input => ({ action: "EXPORT_FIELDS", params: { fields }, query: "", ...overrides });
const KEY = "confirm-key-0001";

async function refusal(promise: Promise<unknown>) {
  try { await promise; } catch (error) { expect(error).toBeInstanceOf(BulkActionError); return error as BulkActionError; }
  throw new Error("expected a refusal");
}

describe("preview", () => {
  it("records the reviewed scope and candidates, audits it, and changes nothing", async () => {
    assigned.add(`reg-2|${TAG.id}`);
    const preview = await createBulkPreview(viewer(), tagInput());
    expect(preview).toMatchObject({ action: "APPLY_TAG", recordUnit: "registrations", candidateCount: 3, willChangeCount: 2, createsFile: false });
    expect(preview.scope).toMatchObject({ kind: "FILTER", notInScopeCount: 0 });
    expect(preview.exclusions).toEqual([expect.objectContaining({ reason: "ALREADY_APPLIED", count: 1, sampleCodes: ["CODE0002"] })]);
    expect(preview.permissionsUsed.join(" ")).toContain("managing registrations");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "PREVIEWED", eventId: "event-1", actorUserId: "user-a", queryString: "status=CONFIRMED", candidateCount: 3 });
    expect(runs[0].snapshot).toEqual([{ id: "reg-1", v: "2027-02-01T10:00:00.000Z" }, { id: "reg-2", v: "2027-02-01T10:00:00.000Z" }, { id: "reg-3", v: "2027-02-01T10:00:00.000Z" }]);
    expect(runs[0].expiresAt.getTime() - NOW.getTime()).toBe(30 * 60_000);
    expect(runs[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "BULK_ACTION_PREVIEWED", entityType: "BulkActionRun", entityId: preview.runId, metadata: expect.objectContaining({ action: "APPLY_TAG", params: { tagId: TAG.id }, scopeKind: "FILTER", candidateCount: 3 }) }));
  });

  it("starts from the authorized search with the server-built viewer", async () => {
    await createBulkPreview(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"]), tagInput());
    expect(mocks.enumerate).toHaveBeenCalledWith({ eventId: "event-1", permissions: ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"] }, expect.any(URLSearchParams), undefined, expect.anything());
  });

  it("never stores or audits personal data", async () => {
    regs.get("reg-1")!.contactSnapshot.lastName = "Uniquesurname";
    await createBulkPreview(viewer(), tagInput({ query: "q=Uniquesurname" }));
    const stored = JSON.stringify([runs, mocks.writeAuditLog.mock.calls]);
    expect(stored).not.toContain("example.test");
    expect(stored).not.toContain("555-0100");
    // The typed search text is kept on the run, to re-run it at confirm, but never copied into the audit trail.
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("Uniquesurname");
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).toContain("q=%5Btext%5D");
  });

  it.each([
    ["refund", "Refunds"],
    ["cancel_registration", "Cancellations"],
    ["transfer_registration", "Transfers"],
    ["merge_identity", "Identity merges"],
    ["protected_record", "Protected records"],
    ["assign_lodging", "Lodging and session"],
    ["session_assignment", "Lodging and session"],
    ["update_price", "Payment, price and capacity"],
    ["set_capacity", "Payment, price and capacity"],
    ["set_field", "Bulk actions can apply a tag"],
    ["update_registration", "Bulk actions can apply a tag"],
    ["", "Bulk actions can apply a tag"],
  ])("refuses the restricted action %j and names where to go", async (action, guide) => {
    const error = await refusal(createBulkPreview(viewer(), { action, params: { field: "status", value: "CANCELLED" }, query: "" }));
    expect(error.code).toBe("RESTRICTED_ACTION");
    expect(error.status).toBe(422);
    expect(error.message).toContain(guide);
    expect(mocks.enumerate).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);
  });

  it("refuses a non-string action and an action in a different case", async () => {
    expect((await refusal(createBulkPreview(viewer(), { action: { $set: "x" }, params: {}, query: "" }))).code).toBe("RESTRICTED_ACTION");
    expect((await refusal(createBulkPreview(viewer(), { action: "apply_tag", params: { tagId: TAG.id }, query: "" }))).code).toBe("RESTRICTED_ACTION");
  });

  it("needs the People list permission, then each action's own", async () => {
    expect((await refusal(createBulkPreview(viewer(["VIEW_EVENT", "MANAGE_REGISTRATION"]), tagInput()))).code).toBe("PERMISSION_DENIED");
    expect((await refusal(createBulkPreview(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"]), tagInput()))).message).toContain("managing registrations");
    expect((await refusal(createBulkPreview(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"]), exportInput(["code"])))).message).toContain("downloading reports");
    expect(runs).toHaveLength(0);
  });

  it("refuses an export field the viewer lacks permission for, instead of dropping it", async () => {
    const noFinance: EventPermission[] = ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "VIEW_REPORTS"];
    const error = await refusal(createBulkPreview(viewer(noFinance), exportInput(["code", "balance"])));
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.message).toContain("Balance");
    expect(runs).toHaveLength(0);
    // The same fields are fine for someone who holds the finance permission.
    await expect(createBulkPreview(viewer(), exportInput(["code", "balance"]))).resolves.toMatchObject({ createsFile: true });
  });

  it.each(["healthNotes", "medicalNeeds", "consentEvidence", "restrictedNote", "insurance", "contactSnapshot"])("never offers the field %s", async (field) => {
    const error = await refusal(createBulkPreview(viewer(), exportInput(["code", field])));
    expect(error.code).toBe("INVALID_REQUEST");
    expect(runs).toHaveLength(0);
  });

  it("says an export holds personal data when it includes contact fields", async () => {
    const preview = await createBulkPreview(viewer(), exportInput(["code", "contactName", "contactEmail"]));
    expect(preview.personalFields).toEqual(["Primary contact name", "Primary contact email"]);
    expect(preview.createsFile).toBe(true);
  });

  it("refuses a tag that is inactive, deleted or a recognition tag", async () => {
    mocks.listActiveTags.mockResolvedValue([]);
    expect((await refusal(createBulkPreview(viewer(), tagInput()))).code).toBe("TAG_UNAVAILABLE");
    expect(runs).toHaveLength(0);
  });

  it("refuses more than 500 registrations for a tag action, and never truncates", async () => {
    seed(501);
    const error = await refusal(createBulkPreview(viewer(), tagInput()));
    expect(error.code).toBe("TOO_BROAD");
    expect(error.message).toContain("501");
    expect(runs).toHaveLength(0);
    seed(500);
    await expect(createBulkPreview(viewer(), tagInput())).resolves.toMatchObject({ candidateCount: 500 });
    expect(runs[0].snapshot).toHaveLength(500);
  });

  it("refuses more than 5000 registrations for an export, and allows 5000", async () => {
    seed(5001);
    expect((await refusal(createBulkPreview(viewer(), exportInput(["code"])))).code).toBe("TOO_BROAD");
    expect(runs).toHaveLength(0);
    seed(5000);
    await expect(createBulkPreview(viewer(), exportInput(["code"]))).resolves.toMatchObject({ candidateCount: 5000 });
  });

  it("refuses a search the service says is too broad or unavailable", async () => {
    mocks.enumerate.mockResolvedValueOnce({ ok: false, issues: [{ filter: "search", code: "too-broad", message: "x" }], registrationIds: [], total: 0 });
    expect((await refusal(createBulkPreview(viewer(), tagInput()))).code).toBe("TOO_BROAD");
    mocks.enumerate.mockResolvedValueOnce({ ok: false, issues: [{ filter: "tag", code: "unavailable", message: "This filter is not available for this event." }], registrationIds: [], total: 0 });
    const error = await refusal(createBulkPreview(viewer(), tagInput()));
    expect(error.code).toBe("SEARCH_UNAVAILABLE");
    expect(error.message).toContain("not available");
  });

  it("refuses an empty result", async () => {
    matching = [];
    expect((await refusal(createBulkPreview(viewer(), tagInput()))).code).toBe("NOTHING_TO_DO");
  });

  it("narrows to a selection inside the filter and never widens the filter to fit it", async () => {
    matching = ["reg-1", "reg-2"];
    const preview = await createBulkPreview(viewer(), tagInput({ selectedIds: ["reg-2", "reg-3", "reg-2"] }));
    expect(preview.scope).toMatchObject({ kind: "SELECTED", notInScopeCount: 1 });
    expect(preview.candidateCount).toBe(1);
    expect(runs[0]).toMatchObject({ scopeKind: "SELECTED", selectedIds: ["reg-2", "reg-3"] });
    expect(runs[0].snapshot.map((entry: { id: string }) => entry.id)).toEqual(["reg-2"]);
    expect((await refusal(createBulkPreview(viewer(), tagInput({ selectedIds: [] })))).code).toBe("INVALID_REQUEST");
  });
});

async function previewed(input: Input = tagInput(), who = viewer()) {
  return (await createBulkPreview(who, input)).runId;
}

describe("confirm and apply", () => {
  it("applies a tag with one outcome per record, links each write to the run, and audits it", async () => {
    assigned.add(`reg-2|${TAG.id}`);
    const runId = await previewed();
    const { summary, file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file).toBeNull();
    expect(summary).toMatchObject({ status: "APPLIED", counts: { completed: 2, skipped: 1, conflict: 0, failed: 0, obsolete: 0 }, replayed: false });
    expect(summary.notCompleted).toEqual([{ confirmationCode: "CODE0002", outcome: "SKIPPED", reason: expect.stringContaining("already") }]);
    expect(mocks.applyTag).toHaveBeenCalledTimes(2);
    expect(mocks.applyTag).toHaveBeenCalledWith("event-1", "reg-1", TAG.id, "user-a", { correlationId: runId });
    expect(runs[0]).toMatchObject({ status: "APPLIED", idempotencyKey: KEY, completedCount: 2, skippedCount: 1 });
    expect(outcomes).toHaveLength(3);
    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ action: "BULK_ACTION_APPLIED", entityId: runId, correlationId: runId, metadata: expect.objectContaining({ action: "APPLY_TAG", params: { tagId: TAG.id }, counts: expect.objectContaining({ completed: 2, skipped: 1 }), scopeKind: "FILTER", actorUserId: "user-a" }) }));
  });

  it("removes a tag, skipping registrations that do not have it", async () => {
    assigned.add(`reg-1|${TAG.id}`);
    const runId = await previewed(tagInput({ action: "REMOVE_TAG" }));
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary.counts).toMatchObject({ completed: 1, skipped: 2 });
    expect(mocks.removeTag).toHaveBeenCalledTimes(1);
    expect(mocks.removeTag).toHaveBeenCalledWith("event-1", "reg-1", TAG.id, "user-a", { correlationId: runId });
    expect(mocks.applyTag).not.toHaveBeenCalled();
  });

  it("a duplicate submit with the same key returns the stored outcome and applies nothing twice", async () => {
    const runId = await previewed();
    const first = await confirmBulkAction(viewer(), runId, KEY);
    const writes = mocks.applyTag.mock.calls.length;
    const audits = mocks.writeAuditLog.mock.calls.length;
    const second = await confirmBulkAction(viewer(), runId, KEY);
    expect(second.summary).toMatchObject({ replayed: true, counts: first.summary.counts, status: "APPLIED" });
    expect(mocks.applyTag).toHaveBeenCalledTimes(writes);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(audits);
    expect(outcomes).toHaveLength(3);
  });

  it("two confirmations at once apply once", async () => {
    const runId = await previewed();
    const results = await Promise.allSettled([confirmBulkAction(viewer(), runId, KEY), confirmBulkAction(viewer(), runId, KEY)]);
    expect(mocks.applyTag).toHaveBeenCalledTimes(3);
    expect(results.filter((result) => result.status === "fulfilled" && !result.value.summary.replayed)).toHaveLength(1);
    const lost = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    for (const result of lost) expect((result.reason as BulkActionError).code).toBe("IN_PROGRESS");
  });

  it("refuses a different key on an already-confirmed run", async () => {
    const runId = await previewed();
    await confirmBulkAction(viewer(), runId, KEY);
    const error = await refusal(confirmBulkAction(viewer(), runId, "another-key-0002"));
    expect(error.code).toBe("ALREADY_CONFIRMED");
    expect(error.status).toBe(409);
    expect(mocks.applyTag).toHaveBeenCalledTimes(3);
  });

  it("refuses a key already used for another run in the event", async () => {
    const first = await previewed();
    const second = await previewed();
    await confirmBulkAction(viewer(), first, KEY);
    const error = await refusal(confirmBulkAction(viewer(), second, KEY));
    expect(error.code).toBe("KEY_IN_USE");
    expect(runs.find((run) => run.id === second)?.status).toBe("PREVIEWED");
    expect(mocks.applyTag).toHaveBeenCalledTimes(3);
  });

  it("needs a usable idempotency key", async () => {
    const runId = await previewed();
    for (const key of [undefined, "", "short", "has spaces in it", 42]) {
      expect((await refusal(confirmBulkAction(viewer(), runId, key))).code).toBe("INVALID_REQUEST");
    }
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(runs[0].status).toBe("PREVIEWED");
  });

  it("only the run's own actor can confirm or read the result", async () => {
    const runId = await previewed();
    const error = await refusal(confirmBulkAction(viewer(owner, "user-b"), runId, KEY));
    expect(error.code).toBe("WRONG_ACTOR");
    expect(error.status).toBe(403);
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(runs[0].status).toBe("PREVIEWED");
    expect((await refusal(getBulkSummary(viewer(owner, "user-b"), runId))).code).toBe("WRONG_ACTOR");
  });

  it("does not find a run from another event", async () => {
    const runId = await previewed();
    const error = await refusal(confirmBulkAction({ ...viewer(), eventId: "event-2" }, runId, KEY));
    expect(error.code).toBe("NOT_FOUND");
    expect(mocks.applyTag).not.toHaveBeenCalled();
  });

  it("refuses an expired preview and marks it expired", async () => {
    const runId = await previewed();
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60_000));
    const error = await refusal(confirmBulkAction(viewer(), runId, KEY));
    expect(error.code).toBe("EXPIRED");
    expect(runs[0].status).toBe("EXPIRED");
    expect(mocks.applyTag).not.toHaveBeenCalled();
    // And a later try is still refused.
    expect((await refusal(confirmBulkAction(viewer(), runId, KEY))).code).toBe("EXPIRED");
  });

  it("refuses the whole run when the permission was removed after the preview", async () => {
    const runId = await previewed();
    const error = await refusal(confirmBulkAction(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"]), runId, KEY));
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(outcomes).toHaveLength(0);
    expect(runs[0].status).toBe("PREVIEWED");
    expect((await refusal(confirmBulkAction(viewer([]), runId, KEY))).code).toBe("PERMISSION_DENIED");
  });

  it("refuses an export whose field permission was removed after the preview", async () => {
    const runId = await previewed(exportInput(["code", "balance"]));
    const error = await refusal(confirmBulkAction(viewer(["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "VIEW_REPORTS"]), runId, KEY));
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.message).toContain("Balance");
    expect(runs[0].status).toBe("PREVIEWED");
    expect(outcomes).toHaveLength(0);
  });

  it("refuses the whole run when the tag was deactivated or deleted since the preview", async () => {
    const runId = await previewed();
    mocks.listActiveTags.mockResolvedValue([]);
    const error = await refusal(confirmBulkAction(viewer(), runId, KEY));
    expect(error.code).toBe("TAG_UNAVAILABLE");
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(runs[0].status).toBe("PREVIEWED");
  });

  it("re-runs the same query narrowed to the previewed ids, and refuses if the search is no longer allowed", async () => {
    const runId = await previewed();
    mocks.enumerate.mockResolvedValueOnce({ ok: false, issues: [{ filter: "tag", code: "unavailable", message: "x" }], registrationIds: [], total: 0 });
    expect((await refusal(confirmBulkAction(viewer(), runId, KEY))).code).toBe("SEARCH_UNAVAILABLE");
    expect(runs[0].status).toBe("PREVIEWED");
    await confirmBulkAction(viewer(), runId, KEY);
    expect(mocks.enumerate).toHaveBeenLastCalledWith(expect.anything(), expect.any(URLSearchParams), undefined, [], ["reg-1", "reg-2", "reg-3"]);
  });

  it("marks changed records CONFLICT and records that no longer match OBSOLETE, never overwriting them", async () => {
    const runId = await previewed();
    regs.get("reg-1")!.updatedAt = new Date("2027-02-20T10:00:00.000Z");
    matching = ["reg-1", "reg-2"];
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary.counts).toEqual({ completed: 1, skipped: 0, conflict: 1, failed: 0, obsolete: 1 });
    expect(summary.notCompleted).toEqual([
      { confirmationCode: "CODE0001", outcome: "CONFLICT", reason: expect.stringContaining("changed") },
      { confirmationCode: "CODE0003", outcome: "OBSOLETE", reason: expect.stringContaining("no longer matches") },
    ]);
    expect(mocks.applyTag).toHaveBeenCalledTimes(1);
    expect(mocks.applyTag).toHaveBeenCalledWith("event-1", "reg-2", TAG.id, "user-a", expect.anything());
  });

  it("treats a record that was deleted since the preview as a conflict, not a failure of the run", async () => {
    const runId = await previewed();
    regs.delete("reg-3");
    matching = ["reg-1", "reg-2", "reg-3"];
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary.counts).toMatchObject({ completed: 2, conflict: 1 });
  });

  it("continues after one record fails and ends APPLIED with counts", async () => {
    const runId = await previewed();
    failFor.add("reg-2");
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary).toMatchObject({ status: "APPLIED", counts: { completed: 2, failed: 1 } });
    expect(summary.notCompleted).toEqual([{ confirmationCode: "CODE0002", outcome: "FAILED", reason: expect.stringContaining("could not be saved") }]);
    expect(mocks.applyTag).toHaveBeenCalledTimes(3);
    expect(runs[0].status).toBe("APPLIED");
    // A failure's reason is a code, not the error text.
    expect(JSON.stringify(outcomes)).not.toContain("write failed");
  });
});

describe("a run always ends", () => {
  it("audits the confirmation before anything is changed", async () => {
    const runId = await previewed();
    await confirmBulkAction(viewer(), runId, KEY);
    const actions = mocks.writeAuditLog.mock.calls.map((call) => call[0].action);
    expect(actions).toEqual(["BULK_ACTION_PREVIEWED", "BULK_ACTION_CONFIRMED", "BULK_ACTION_APPLIED"]);
  });

  it("ends the run with FAILED outcomes when the handler throws, keeping what was done", async () => {
    const runId = await previewed();
    // The assignment lookup fails, so the handler stops before it reaches any record.
    const prisma = mocks.getPrisma();
    prisma.registrationTagAssignment.findMany.mockRejectedValueOnce(new Error("lookup failed"));
    mocks.getPrisma.mockReturnValue(prisma);
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary).toMatchObject({ status: "APPLIED", counts: { completed: 0, failed: 3 } });
    expect(summary.notCompleted.every((row) => row.outcome === "FAILED" && row.reason.includes("stopped"))).toBe(true);
    expect(runs[0]).toMatchObject({ status: "APPLIED", failedCount: 3 });
    expect(mocks.writeAuditLog.mock.calls.at(-1)![0].action).toBe("BULK_ACTION_APPLIED");
    expect(JSON.stringify(outcomes)).not.toContain("lookup failed");
  });

  it("returns no file and FAILED outcomes when an export cannot be built", async () => {
    const runId = await previewed(exportInput(["code"]));
    const prisma = mocks.getPrisma();
    prisma.registration.findMany.mockResolvedValueOnce([{ id: "reg-1", confirmationCode: "X", updatedAt: new Date("2027-02-01T10:00:00.000Z") }, { id: "reg-2", updatedAt: new Date("2027-02-01T10:00:00.000Z") }, { id: "reg-3", updatedAt: new Date("2027-02-01T10:00:00.000Z") }]);
    prisma.registration.findMany.mockRejectedValueOnce(new Error("read failed"));
    const { summary, file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file).toBeNull();
    expect(summary).toMatchObject({ status: "APPLIED", exportRowCount: null, counts: { completed: 0, failed: 3 } });
  });

  it("ends a run stuck in APPLYING on the retry, once it is past the time limit", async () => {
    const runId = await previewed();
    runs[0].status = "APPLYING";
    runs[0].idempotencyKey = KEY;
    runs[0].confirmedAt = new Date(NOW.getTime() - 20 * 60_000);
    const { summary, file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file).toBeNull();
    expect(summary).toMatchObject({ status: "APPLIED", counts: { failed: 3 } });
    expect(runs[0].status).toBe("APPLIED");
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog.mock.calls.at(-1)![0].action).toBe("BULK_ACTION_APPLIED");
  });

  it("still says in progress for a run that only just started", async () => {
    const runId = await previewed();
    runs[0].status = "APPLYING";
    runs[0].idempotencyKey = KEY;
    runs[0].confirmedAt = new Date(NOW.getTime() - 60_000);
    expect((await refusal(confirmBulkAction(viewer(), runId, KEY))).code).toBe("IN_PROGRESS");
  });

  it("replaces the typed search text once the run is confirmed or expires", async () => {
    const confirmed = await previewed(tagInput({ query: "q=Uniquesurname" }));
    expect(runs[0].queryString).toContain("Uniquesurname");
    await confirmBulkAction(viewer(), confirmed, KEY);
    expect(runs[0].queryString).toBe("q=%5Btext%5D");
    const expired = await previewed(tagInput({ query: "q=Othername" }));
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60_000));
    await refusal(confirmBulkAction(viewer(), expired, "another-key-0002"));
    expect(runs[1].queryString).toBe("q=%5Btext%5D");
  });
});

describe("removing an inactive tag", () => {
  it("is allowed, as for a single registration, while applying one is not", async () => {
    mocks.listActiveTags.mockResolvedValue([]);
    mocks.listTags.mockResolvedValue([{ ...TAG, isActive: false }]);
    assigned.add(`reg-1|${TAG.id}`);
    expect((await refusal(createBulkPreview(viewer(), tagInput()))).code).toBe("TAG_UNAVAILABLE");
    const runId = await previewed(tagInput({ action: "REMOVE_TAG" }));
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary.counts).toMatchObject({ completed: 1, skipped: 2 });
  });

  it("is refused for a deleted tag", async () => {
    mocks.listTags.mockResolvedValue([]);
    expect((await refusal(createBulkPreview(viewer(), tagInput({ action: "REMOVE_TAG" })))).code).toBe("TAG_UNAVAILABLE");
  });
});

describe("recovering a stalled run", () => {
  const appliedAudits = () => mocks.writeAuditLog.mock.calls.filter((call) => call[0].action === "BULK_ACTION_APPLIED").length;
  const stall = (runId: string) => {
    const run = runs.find((row) => row.id === runId)!;
    run.status = "APPLYING";
    run.idempotencyKey = KEY;
    run.confirmedAt = new Date(NOW.getTime() - 20 * 60_000);
  };

  it("keeps the outcomes already saved and fails only the records with none, after a crash", async () => {
    const runId = await previewed();
    stall(runId);
    outcomes.push({ runId, registrationId: "reg-1", outcome: "COMPLETED", reason: null });
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary.counts).toEqual({ completed: 1, skipped: 0, conflict: 0, failed: 2, obsolete: 0 });
    expect(outcomes.find((row) => row.registrationId === "reg-1")?.outcome).toBe("COMPLETED");
    expect(summary.notCompleted.map((row) => row.confirmationCode)).toEqual(["CODE0002", "CODE0003"]);
    expect(appliedAudits()).toBe(1);
  });

  it("lets only one of two late retries take the recovery", async () => {
    const runId = await previewed();
    stall(runId);
    const results = await Promise.allSettled([confirmBulkAction(viewer(), runId, KEY), confirmBulkAction(viewer(), runId, KEY)]);
    expect(appliedAudits()).toBe(1);
    expect(outcomes).toHaveLength(3);
    for (const result of results) {
      if (result.status === "rejected") expect((result.reason as BulkActionError).code).toBe("IN_PROGRESS");
      else expect(result.value.summary.status).toBe("APPLIED");
    }
    expect(runs[0].status).toBe("APPLIED");
  });

  it("recovery while the original apply is still running keeps the real outcomes, audits once and stops the original", async () => {
    seed(60);
    const runId = await previewed();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached: () => void = () => {};
    const atGate = new Promise<void>((resolve) => { reached = resolve; });
    mocks.applyTag.mockImplementation(async (_event: string, registrationId: string, tagId: string) => {
      if (registrationId === "reg-27") { reached(); await gate; }
      assigned.add(`${registrationId}|${tagId}`);
    });
    const original = confirmBulkAction(viewer(), runId, KEY);
    await atGate;
    // Past the time limit, the same key is retried while the first request is still inside its apply.
    const recovered = await confirmBulkAction(viewer(), runId, KEY, { now: new Date(NOW.getTime() + 11 * 60_000) });
    expect(recovered.summary).toMatchObject({ status: "APPLIED", counts: { completed: 25, failed: 35 } });
    release();
    const late = await original;
    // The original learns it no longer owns the run: no second audit row, no file, the stored summary, and it stops at its next check.
    expect(late.file).toBeNull();
    expect(late.summary.counts).toEqual(recovered.summary.counts);
    expect(appliedAudits()).toBe(1);
    expect(mocks.applyTag.mock.calls.length).toBeLessThanOrEqual(50);
    expect(outcomes.filter((row) => row.outcome === "COMPLETED")).toHaveLength(25);
    expect(runs[0]).toMatchObject({ status: "APPLIED", completedCount: 25, failedCount: 35 });
  });

  it("saves progress as it goes, so a crash leaves the done records COMPLETED", async () => {
    seed(30);
    const runId = await previewed();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached: () => void = () => {};
    const atGate = new Promise<void>((resolve) => { reached = resolve; });
    mocks.applyTag.mockImplementation(async (_event: string, registrationId: string, tagId: string) => {
      if (registrationId === "reg-28") { reached(); await gate; }
      assigned.add(`${registrationId}|${tagId}`);
    });
    const original = confirmBulkAction(viewer(), runId, KEY);
    await atGate;
    expect(outcomes.filter((row) => row.outcome === "COMPLETED")).toHaveLength(25);
    release();
    await original;
  });

  it("ends a stalled run when the page loads, with the same recovery", async () => {
    const runId = await previewed();
    stall(runId);
    const recent = await listRecentBulkActions("event-1", 10, NOW);
    expect(recent[0]).toMatchObject({ status: "APPLIED", counts: { failed: 3 } });
    expect(appliedAudits()).toBe(1);
    await listRecentBulkActions("event-1", 10, NOW);
    expect(appliedAudits()).toBe(1);
    expect(mocks.applyTag).not.toHaveBeenCalled();
  });

  it("uses a different reason when nothing was written because the apply failed first", async () => {
    const runId = await previewed();
    mocks.getPrisma().registration.findMany.mockRejectedValueOnce(new Error("version read failed"));
    const { summary } = await confirmBulkAction(viewer(), runId, KEY);
    expect(summary.counts).toMatchObject({ failed: 3, completed: 0 });
    expect(summary.notCompleted.every((row) => row.reason === "Nothing was changed for this one.")).toBe(true);
    expect(mocks.applyTag).not.toHaveBeenCalled();
  });
});

describe("abandoned previews", () => {
  it("expires them in bulk and replaces the typed text, on the page load and on a new preview", async () => {
    await previewed(tagInput({ query: "q=Firstname&status=CONFIRMED" }));
    await previewed(tagInput({ query: "q=Secondname&status=CONFIRMED" }));
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60_000));
    const fresh = await previewed(tagInput({ query: "q=Newtext" }));
    // The new preview's own sweep already ended the two old ones.
    expect(runs.slice(0, 2).map((run) => [run.status, run.queryString])).toEqual([["EXPIRED", "q=%5Btext%5D&status=CONFIRMED"], ["EXPIRED", "q=%5Btext%5D&status=CONFIRMED"]]);
    expect(runs.find((run) => run.id === fresh)).toMatchObject({ status: "PREVIEWED", queryString: "q=Newtext" });
    vi.setSystemTime(new Date(NOW.getTime() + 90 * 60_000));
    const recent = await listRecentBulkActions("event-1");
    expect(recent.every((run) => run.status === "EXPIRED")).toBe(true);
    expect(JSON.stringify(runs)).not.toContain("Newtext");
  });

  it("leaves a preview that has not expired alone", async () => {
    await previewed(tagInput({ query: "q=Keepme" }));
    await listRecentBulkActions("event-1");
    expect(runs[0]).toMatchObject({ status: "PREVIEWED", queryString: "q=Keepme" });
  });
});

describe("export", () => {
  it("returns a formula-safe CSV once, with only the chosen fields", async () => {
    regs.get("reg-1")!.contactSnapshot.firstName = '=HYPERLINK("http://example.test","click")';
    regs.get("reg-2")!.contactSnapshot.firstName = "+1 Sample";
    regs.get("reg-2")!.tagAssignments = [{ tag: { name: "VIP" } }, { tag: { name: "Alpha" } }];
    const runId = await previewed(exportInput(["code", "contactName", "tags"]));
    const { summary, file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file).not.toBeNull();
    const lines = file!.body.trim().split("\r\n");
    expect(lines[0]).toBe('"Confirmation code","Primary contact name","Tags"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://example.test"",""click"")`);
    expect(lines[1]).not.toMatch(/^"[^"]*","=/);
    expect(lines[2]).toContain(`"'+1 Sample Sample"`);
    expect(lines[2]).toContain('"Alpha; VIP"');
    expect(summary).toMatchObject({ status: "APPLIED", exportRowCount: 3, counts: { completed: 3 } });
    // Only what the fields need is read: no email, no money, no attendee counts.
    expect(Object.keys(selects.at(-1) ?? {}).sort()).toEqual(["confirmationCode", "contactSnapshot", "accountHolderPerson", "id", "tagAssignments"].sort());
    expect(file!.body).not.toContain("example.test\",\"");
  });

  it("adds balance and payment state for finance viewers", async () => {
    const runId = await previewed(exportInput(["code", "balance", "paymentState", "attendeeCount", "status", "submittedAt"]));
    const { file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file!.body.split("\r\n")[1]).toBe('"CODE0001","60.00","Balance due","2","CONFIRMED","2027-01-15T12:00:00.000Z"');
  });

  it("counts only succeeded payments and refunds, and uses the finance words", async () => {
    regs.get("reg-1")!.payments = [
      { amount: 40, status: "SUCCEEDED", refunds: [{ amount: 10, status: "SUCCEEDED" }, { amount: 30, status: "PENDING" }] },
      { amount: 60, status: "FAILED", refunds: [] },
      { amount: 50, status: "PENDING", refunds: [] },
    ];
    regs.get("reg-2")!.payments = [{ amount: 100, status: "SUCCEEDED", refunds: [{ amount: 5, status: "FAILED" }] }];
    regs.get("reg-3")!.totalAmount = 0;
    regs.get("reg-3")!.payments = [];
    const runId = await previewed(exportInput(["code", "balance", "paymentState"]));
    const { file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file!.body.trim().split("\r\n").slice(1)).toEqual(['"CODE0001","70.00","Balance due"', '"CODE0002","0.00","Paid in full"', '"CODE0003","0.00","No charge"']);
  });

  it("shows no balance for a church- or organization-billed registration, and says who is billed", async () => {
    regs.get("reg-1")!.event = { billingMode: "DEFERRED_ORGANIZATION_INVOICE" };
    regs.get("reg-1")!.payments = [];
    regs.get("reg-2")!.event = { billingMode: "DEFERRED_ORGANIZATION_INVOICE" };
    regs.get("reg-2")!.groupRegistration = { id: "group-1" };
    regs.get("reg-2")!.payments = [];
    const runId = await previewed(exportInput(["code", "balance", "paymentState"]));
    const { file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file!.body.trim().split("\r\n").slice(1, 3)).toEqual(['"CODE0001","0.00","Billed to church"', '"CODE0002","0.00","Billed to group contact"']);
  });

  it("leaves out records that changed or no longer match, and counts them", async () => {
    const runId = await previewed(exportInput(["code"]));
    regs.get("reg-1")!.updatedAt = new Date("2027-02-25T00:00:00.000Z");
    matching = ["reg-1", "reg-2"];
    const { summary, file } = await confirmBulkAction(viewer(), runId, KEY);
    expect(file!.body.trim().split("\r\n")).toEqual(['"Confirmation code"', '"CODE0002"']);
    expect(summary).toMatchObject({ exportRowCount: 1, counts: { completed: 1, conflict: 1, obsolete: 1 } });
  });

  it("makes the file once: the same key again returns the stored summary and no second file", async () => {
    const runId = await previewed(exportInput(["code"]));
    const first = await confirmBulkAction(viewer(), runId, KEY);
    expect(first.file).not.toBeNull();
    const reads = selects.length;
    const second = await confirmBulkAction(viewer(), runId, KEY);
    expect(second.file).toBeNull();
    expect(second.summary).toMatchObject({ replayed: true, exportRowCount: 3 });
    expect(selects).toHaveLength(reads); // nothing is read or built again
  });

  it("audits the exact fields, filters, row count and time, and stores no file or personal data", async () => {
    const runId = await previewed(exportInput(["code", "contactEmail"], { query: "status=CONFIRMED" }));
    await confirmBulkAction(viewer(), runId, KEY);
    const audit = mocks.writeAuditLog.mock.calls.at(-1)![0];
    expect(audit.action).toBe("BULK_ACTION_APPLIED");
    expect(audit.metadata.export).toEqual({ fields: ["code", "contactEmail"], filters: "status=CONFIRMED", rowCount: 3, exportedAt: NOW.toISOString() });
    const stored = JSON.stringify([runs, outcomes, mocks.writeAuditLog.mock.calls]);
    expect(stored).not.toContain("example.test");
    expect(stored).not.toContain("CODE0001\"");
  });
});

describe("history", () => {
  it("lists the last runs with who, when, action, scope and counts", async () => {
    const runId = await previewed();
    await confirmBulkAction(viewer(), runId, KEY);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await previewed(tagInput({ query: "q=somebody" }));
    const recent = await listRecentBulkActions("event-1", 10);
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ actorName: "Alex Sample", actionLabel: "Apply a tag", status: "PREVIEWED", candidateCount: 3 });
    // Typed search text is named, never shown.
    expect(JSON.stringify(recent)).not.toContain("somebody");
    expect(recent[1]).toMatchObject({ status: "APPLIED", counts: { completed: 3 }, scope: { kind: "FILTER", filters: ["Status: confirmed"] } });
  });

  it("shows a preview past its time as expired", async () => {
    await previewed();
    vi.setSystemTime(new Date(NOW.getTime() + 45 * 60_000));
    expect((await listRecentBulkActions("event-1"))[0].status).toBe("EXPIRED");
  });
});
