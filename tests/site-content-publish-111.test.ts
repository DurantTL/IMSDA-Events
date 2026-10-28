/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #111: save draft, publish, supersede, restore and discard on the hub content, against an in-memory stand-in for the
 * table that also enforces "one DRAFT and one PUBLISHED at a time" the way the database's partial indexes do.
 * Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), writeAuditLog: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/logger", () => ({ logWarn: mocks.logWarn, logError: vi.fn(), logInfo: vi.fn() }));

import {
  SiteContentError,
  discardHubDraft,
  getPublishedHubContent,
  getSiteContentAdminState,
  publishHubDraft,
  restoreHubRevision,
  saveHubDraft,
} from "@/modules/site-content/hub-content";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";

type Row = {
  id: string; content: unknown; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; note: string | null;
  createdByUserId: string | null; createdAt: Date; updatedAt: Date; publishedByUserId: string | null; publishedAt: Date | null; restoredFromId: string | null;
};
let rows: Row[];
let counter: number;
let tick: number;

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
}
const withActors = (row: Row) => ({ ...row, createdBy: row.createdByUserId ? { displayName: "Editor One" } : null, publishedBy: row.publishedByUserId ? { displayName: "Editor One" } : null });
const matches = (row: Row, where: any = {}) =>
  (where.id === undefined || row.id === where.id)
  && (where.updatedAt === undefined || row.updatedAt.getTime() === where.updatedAt.getTime())
  && (where.status === undefined || (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status)));

function fakeDb() {
  const table = {
    findFirst: async ({ where }: any) => { const row = rows.find((candidate) => matches(candidate, where)); return row ? withActors(row) : null; },
    findMany: async ({ where }: any) => rows.filter((candidate) => matches(candidate, where)).sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)).map(withActors),
    findUnique: async ({ where }: any) => { const row = rows.find((candidate) => candidate.id === where.id); return row ? withActors(row) : null; },
    findUniqueOrThrow: async ({ where }: any) => withActors(rows.find((candidate) => candidate.id === where.id)!),
    create: async ({ data }: any) => {
      const row: Row = { note: null, createdByUserId: null, publishedByUserId: null, publishedAt: null, restoredFromId: null, ...data, id: `rev${++counter}`, createdAt: new Date(2026, 9, counter), updatedAt: new Date(2026, 9, 28, 0, 0, ++tick) };
      if (row.status !== "SUPERSEDED" && rows.some((other) => other.status === row.status)) throw uniqueViolation();
      rows.push(row);
      return withActors(row);
    },
    update: async ({ where, data }: any) => { const row = rows.find((candidate) => candidate.id === where.id)!; Object.assign(row, data); return withActors(row); },
    updateMany: async ({ where, data }: any) => {
      const hits = rows.filter((candidate) => matches(candidate, where));
      hits.forEach((row) => Object.assign(row, data, { updatedAt: new Date(2026, 9, 28, 0, 0, ++tick) }));
      return { count: hits.length };
    },
    deleteMany: async ({ where }: any) => {
      const hits = rows.filter((candidate) => matches(candidate, where));
      rows = rows.filter((candidate) => !hits.includes(candidate));
      return { count: hits.length };
    },
  };
  const client = { siteContentRevision: table };
  return { ...client, $transaction: async (fn: (tx: unknown) => unknown) => fn(client) };
}

const published = () => rows.filter((row) => row.status === "PUBLISHED");
const content = (label: string) => ({ ...defaultHubContent(), navLinks: [{ label, href: "/events" }] });
const actions = () => mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action);

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  counter = 0;
  tick = 0;
  mocks.getPrisma.mockReturnValue(fakeDb());
});

describe("saving the draft", () => {
  it("creates the draft, then updates the same one, and audits each save with the parts that changed", async () => {
    const first = await saveHubDraft(content("One"), "first try", "editor");
    const second = await saveHubDraft(content("Two"), null, "editor");
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "DRAFT", note: null });
    expect(actions()).toEqual(["SITE_CONTENT_DRAFT_SAVED", "SITE_CONTENT_DRAFT_SAVED"]);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ actorUserId: "editor", entityId: first.id, metadata: { revisionId: first.id, changedKeys: ["navLinks"] } });
    // The audit row carries ids and key names, never the content.
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0][0].metadata)).not.toContain("One");
  });

  it("refuses content that breaks the rules, with a plain message, and writes nothing", async () => {
    const bad = { ...defaultHubContent(), navLinks: [{ label: "Go", href: "javascript:alert(1)" }] };
    await expect(saveHubDraft(bad, null, "editor")).rejects.toMatchObject({ code: "INVALID_CONTENT", status: 400 });
    await expect(saveHubDraft(defaultHubContent(), "x".repeat(201), "editor")).rejects.toBeInstanceOf(SiteContentError);
    expect(rows).toHaveLength(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not change what visitors see", async () => {
    await saveHubDraft(content("Draft only"), null, "editor");
    expect(await getPublishedHubContent()).toEqual(defaultHubContent());
  });
});

describe("publishing", () => {
  it("makes the draft the published version and leaves no draft", async () => {
    const draft = await saveHubDraft(content("One"), null, "editor");
    const live = await publishHubDraft("editor", new Date("2026-10-28T15:00:00Z"));
    expect(live).toMatchObject({ id: draft.id, status: "PUBLISHED", publishedByName: "Editor One", publishedAt: "2026-10-28T15:00:00.000Z" });
    expect(rows.filter((row) => row.status === "DRAFT")).toHaveLength(0);
    expect((await getPublishedHubContent()).navLinks[0].label).toBe("One");
    expect(actions()).toEqual(["SITE_CONTENT_DRAFT_SAVED", "SITE_CONTENT_PUBLISHED"]);
  });

  it("supersedes the earlier version on the next publish: exactly one PUBLISHED at any time", async () => {
    await saveHubDraft(content("One"), null, "editor");
    const first = await publishHubDraft("editor");
    expect(published()).toHaveLength(1);
    await saveHubDraft(content("Two"), null, "editor");
    const second = await publishHubDraft("editor");
    expect(published().map((row) => row.id)).toEqual([second.id]);
    expect(rows.find((row) => row.id === first.id)?.status).toBe("SUPERSEDED");
    expect(mocks.writeAuditLog.mock.calls.at(-1)![0]).toMatchObject({ action: "SITE_CONTENT_PUBLISHED", metadata: { revisionId: second.id, supersededRevisionId: first.id, changedKeys: ["navLinks"] } });
  });

  it("says so when there is no draft, and when the draft was taken by someone else first", async () => {
    await expect(publishHubDraft("editor")).rejects.toMatchObject({ code: "NO_DRAFT", status: 409 });
    await saveHubDraft(content("One"), null, "editor");
    const original = getPrisma();
    // A second publisher claims the draft between our read and our claim.
    mocks.getPrisma.mockReturnValue({
      ...original,
      $transaction: (fn: (tx: any) => unknown) => original.$transaction((tx: any) => fn({ ...tx, siteContentRevision: { ...tx.siteContentRevision, updateMany: async (args: any) => (args.where.status === "DRAFT" ? { count: 0 } : tx.siteContentRevision.updateMany(args)) } })),
    });
    await expect(publishHubDraft("editor")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("reports a conflict, not a crash, when the database refuses a second PUBLISHED row", async () => {
    await saveHubDraft(content("One"), null, "editor");
    const original = getPrisma();
    mocks.getPrisma.mockReturnValue({
      ...original,
      $transaction: (fn: (tx: any) => unknown) => original.$transaction((tx: any) => fn({ ...tx, siteContentRevision: { ...tx.siteContentRevision, updateMany: async (args: any) => { if (args.where.status === "DRAFT") throw uniqueViolation(); return tx.siteContentRevision.updateMany(args); } } })),
    });
    await expect(publishHubDraft("editor")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/** Runs `before` once, just before the named table call, to stand for another request that got in first. */
function interleave(method: "updateMany" | "deleteMany", before: () => void) {
  const original = getPrisma();
  let done = false;
  mocks.getPrisma.mockReturnValue({
    ...original,
    $transaction: (fn: (tx: any) => unknown) => original.$transaction((tx: any) => fn({
      ...tx,
      siteContentRevision: { ...tx.siteContentRevision, [method]: async (args: any) => { if (!done) { done = true; before(); } return tx.siteContentRevision[method](args); } },
    })),
  });
}

function getPrisma() {
  return mocks.getPrisma() as ReturnType<typeof fakeDb>;
}

describe("rolling back", () => {
  it("publishes a copy of an earlier version as a new PUBLISHED row with restoredFromId, keeping the old one", async () => {
    await saveHubDraft(content("One"), "first", "editor");
    const first = await publishHubDraft("editor");
    await saveHubDraft(content("Two"), null, "editor");
    const second = await publishHubDraft("editor");

    const restored = await restoreHubRevision(first.id, "admin");
    expect(restored).toMatchObject({ status: "PUBLISHED", restoredFromId: first.id });
    expect(restored.id).not.toBe(first.id);
    expect(published().map((row) => row.id)).toEqual([restored.id]);
    expect(rows.find((row) => row.id === first.id)?.status).toBe("SUPERSEDED");
    expect(rows.find((row) => row.id === second.id)?.status).toBe("SUPERSEDED");
    expect((await getPublishedHubContent()).navLinks[0].label).toBe("One");
    expect(mocks.writeAuditLog.mock.calls.at(-1)![0]).toMatchObject({
      action: "SITE_CONTENT_RESTORED",
      actorUserId: "admin",
      metadata: { revisionId: restored.id, restoredFromId: first.id, supersededRevisionId: second.id },
    });
    // The history lists every published version, newest first, with its actor.
    const state = await getSiteContentAdminState();
    expect(state.history).toHaveLength(3);
    expect(state.published?.id).toBe(restored.id);
  });

  it("refuses to restore the version already showing, a draft, or something that does not exist", async () => {
    await saveHubDraft(content("One"), null, "editor");
    const draftId = rows[0].id;
    await expect(restoreHubRevision(draftId, "editor")).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
    const live = await publishHubDraft("editor");
    await expect(restoreHubRevision(live.id, "editor")).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
    await expect(restoreHubRevision("missing", "editor")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(published()).toHaveLength(1);
  });

  it("will not restore a version that no longer fits the rules", async () => {
    rows.push({ id: "old", content: { notices: "broken" }, status: "SUPERSEDED", note: null, createdByUserId: null, createdAt: new Date(), updatedAt: new Date(), publishedByUserId: null, publishedAt: new Date(), restoredFromId: null });
    await expect(restoreHubRevision("old", "editor")).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
  });
});

describe("discarding the draft", () => {
  it("deletes only the draft, audits it, and leaves what is published", async () => {
    await saveHubDraft(content("One"), null, "editor");
    await publishHubDraft("editor");
    await saveHubDraft(content("Two"), null, "editor");
    await discardHubDraft("editor");
    expect(rows.map((row) => row.status)).toEqual(["PUBLISHED"]);
    expect(actions().at(-1)).toBe("SITE_CONTENT_DRAFT_DISCARDED");
    await expect(discardHubDraft("editor")).rejects.toMatchObject({ code: "NO_DRAFT" });
  });
});

describe("what visitors get", () => {
  it("is the default when nothing has been published", async () => {
    expect(await getPublishedHubContent()).toEqual(defaultHubContent());
  });

  it("is the default, with a warning that holds no content, when the stored document no longer parses", async () => {
    rows.push({ id: "bad", content: { navLinks: [{ label: "SECRET-TEXT", href: "javascript:alert(1)" }] }, status: "PUBLISHED", note: null, createdByUserId: null, createdAt: new Date(), updatedAt: new Date(), publishedByUserId: null, publishedAt: new Date(), restoredFromId: null });
    expect(await getPublishedHubContent()).toEqual(defaultHubContent());
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("SECRET-TEXT");
  });

  it("is the default when the database cannot be read", async () => {
    mocks.getPrisma.mockImplementation(() => { throw new Error("database down"); });
    expect(await getPublishedHubContent()).toEqual(defaultHubContent());
  });
});

describe("changes that race a publish or another save (#111 review)", () => {
  it("guards a save by status and the updatedAt it read, so a publish in between cannot be overwritten (409)", async () => {
    const draft = await saveHubDraft(content("One"), null, "editor");
    interleave("updateMany", () => { rows[0].status = "PUBLISHED"; });
    await expect(saveHubDraft(content("Two"), null, "editor")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: draft.id, status: "PUBLISHED" });
    expect((rows[0].content as any).navLinks[0].label).toBe("One");
  });

  it("refuses a save made from a stale view of the draft, and from a view that saw no draft", async () => {
    const first = await saveHubDraft(content("One"), null, "editor");
    const second = await saveHubDraft(content("Two"), null, "other-editor", { id: first.id, updatedAt: first.updatedAt });
    await expect(saveHubDraft(content("Three"), null, "editor", { id: first.id, updatedAt: first.updatedAt })).rejects.toMatchObject({ code: "CONFLICT", status: 409, message: expect.stringContaining("Someone else changed the draft") });
    await expect(saveHubDraft(content("Three"), null, "editor", null)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((rows[0].content as any).navLinks[0].label).toBe("Two");
    // The current view saves fine.
    await expect(saveHubDraft(content("Three"), null, "editor", { id: second.id, updatedAt: second.updatedAt })).resolves.toMatchObject({ id: first.id });
  });

  it("records the last saver, not the first", async () => {
    await saveHubDraft(content("One"), null, "first-editor");
    await saveHubDraft(content("Two"), null, "second-editor");
    expect(rows[0].createdByUserId).toBe("second-editor");
  });

  it("publishes only the draft the editor saw: a changed draft is a 409 and nothing goes live", async () => {
    const seen = await saveHubDraft(content("One"), null, "editor");
    await saveHubDraft(content("Two"), null, "other-editor");
    await expect(publishHubDraft("editor", new Date(), { id: seen.id, updatedAt: seen.updatedAt })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(published()).toHaveLength(0);
  });

  it("claims the draft only while it is unchanged since it was read, so what goes live is what the audit row describes", async () => {
    await saveHubDraft(content("One"), null, "editor");
    // A save lands between the publish's read and its claim (the first updateMany call is the claim: nothing was live yet).
    const original = getPrisma();
    let claimWhere: any;
    mocks.getPrisma.mockReturnValue({
      ...original,
      $transaction: (fn: (tx: any) => unknown) => original.$transaction((tx: any) => fn({
        ...tx,
        siteContentRevision: { ...tx.siteContentRevision, updateMany: async (args: any) => { claimWhere = args.where; rows[0].updatedAt = new Date(2030, 0, 1); return tx.siteContentRevision.updateMany(args); } },
      })),
    });
    await expect(publishHubDraft("editor")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(claimWhere).toMatchObject({ status: "DRAFT", updatedAt: expect.any(Date) });
    expect(rows[0].status).toBe("DRAFT");
    expect(published()).toHaveLength(0);
  });

  it("discard deletes only a row that is still the draft: a publish in between leaves the live row alone (409)", async () => {
    await saveHubDraft(content("One"), null, "editor");
    interleave("deleteMany", () => { rows[0].status = "PUBLISHED"; });
    await expect(discardHubDraft("editor")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PUBLISHED");
    expect(actions()).not.toContain("SITE_CONTENT_DRAFT_DISCARDED");
  });

  it("refuses to discard a draft that changed since the editor saw it", async () => {
    const seen = await saveHubDraft(content("One"), null, "editor");
    await saveHubDraft(content("Two"), null, "other-editor");
    await expect(discardHubDraft("editor", { id: seen.id, updatedAt: seen.updatedAt })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(rows).toHaveLength(1);
  });
});
