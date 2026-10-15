/* eslint-disable @typescript-eslint/no-explicit-any -- a loose in-memory stand-in for the Prisma client */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: { HEALTH_RECORDS_ENABLED: true } as Record<string, unknown>,
  audit: [] as Array<Record<string, any>>,
  grants: [] as Array<Record<string, any>>,
  uses: [] as Array<Record<string, any>>,
  liveRecords: 0,
  snapshots: [] as Array<Record<string, any>>,
  acknowledged: true,
}));

const client: any = {
  healthRecord: { count: async () => state.liveRecords },
  healthRecordSnapshot: {
    count: async () => state.snapshots.length,
    findMany: async () => state.snapshots,
  },
  healthSnapshotBreakGlass: {
    create: async ({ data }: { data: Record<string, any> }) => {
      const row = { id: `grant-${state.grants.length + 1}`, ...data };
      state.grants.push(row);
      return { id: row.id };
    },
    findMany: async ({ where, take }: { where?: Record<string, any>; take?: number }) => {
      let rows = [...state.grants];
      if (where?.userId) rows = rows.filter((grant) => grant.userId === where.userId && where.personId.in.includes(grant.personId) && grant.expiresAt > where.expiresAt.gt);
      else rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return rows.slice(0, take ?? 1000).map((grant) => ({ ...grant, user: { displayName: "Synthetic Admin" } }));
    },
  },
  healthBreakGlassUse: {
    create: async ({ data }: { data: Record<string, any> }) => {
      state.uses.push({ createdAt: new Date("2026-10-26T12:00:00Z"), ...data });
      return { id: `use-${state.uses.length}` };
    },
    groupBy: async ({ where }: { where: { grantId: { in: string[] } } }) => {
      const groups = new Map<string, { grantId: string; kind: string; count: number; last: Date }>();
      for (const use of state.uses.filter((row) => where.grantId.in.includes(row.grantId))) {
        const key = `${use.grantId}:${use.kind}`;
        const group = groups.get(key) ?? { grantId: use.grantId, kind: use.kind, count: 0, last: use.createdAt };
        group.count += 1;
        if (use.createdAt > group.last) group.last = use.createdAt;
        groups.set(key, group);
      }
      return [...groups.values()].map((group) => ({ grantId: group.grantId, kind: group.kind, _count: { _all: group.count }, _max: { createdAt: group.last } }));
    },
  },
  $transaction: async (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => state.env }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: async (entry: Record<string, any>) => {
    state.audit.push(entry);
  },
}));
vi.mock("@/modules/health-records/acknowledgment", () => ({
  requireHealthPrivacyAcknowledgment: async () => {
    if (!state.acknowledged) throw Object.assign(new Error("ack"), { code: "ACKNOWLEDGMENT_REQUIRED" });
  },
}));
vi.mock("@/modules/health-records/crypto", () => ({ openSnapshotField: () => "SYNTHETIC-SEALED-VALUE" }));

import type { HealthViewer } from "@/modules/health-records/domain";
import { listSnapshotBreakGlassGrants, startSnapshotBreakGlass, viewSealedSnapshots } from "@/modules/health-records/snapshot-access-repository";

/** One break-glass mechanism for the live record and the sealed copies (#929). Synthetic ids and reasons only. */

const now = new Date("2026-10-26T12:00:00Z");
const admin: HealthViewer = { kind: "SYSTEM_ADMIN", userId: "admin-1" };
const actingAdmin: HealthViewer = { kind: "SYSTEM_ADMIN", userId: "admin-1", actAsId: "act-1" };
const REASON = "Synthetic reason: a parent asked about an allergy";

beforeEach(() => {
  state.env.HEALTH_RECORDS_ENABLED = true;
  state.audit = [];
  state.grants = [];
  state.uses = [];
  state.liveRecords = 0;
  state.snapshots = [];
  state.acknowledged = true;
});

describe("starting break-glass", () => {
  it("covers a person who has only a live record, for 24 hours, and audits that it covers both", async () => {
    state.liveRecords = 1;
    const grant = await startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now);
    expect(grant).toMatchObject({ snapshotCount: 0, liveRecordCount: 1 });
    expect(grant.expiresAt.getTime() - now.getTime()).toBe(24 * 3_600_000);
    expect(state.audit[0]).toMatchObject({
      action: "HEALTH_SNAPSHOT_BREAK_GLASS_STARTED",
      metadata: { personId: "person-1", liveRecordCount: 1, snapshotCount: 0, covers: ["LIVE_RECORD", "SEALED_COPIES"], reason: REASON },
    });
  });

  it("covers a person who has only sealed copies", async () => {
    state.snapshots = [{ id: "snap-1" }];
    await expect(startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now)).resolves.toMatchObject({ snapshotCount: 1, liveRecordCount: 0 });
  });

  it("gives one answer for a person with nothing on file and one that does not exist, and creates no grant", async () => {
    await expect(startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now)).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
    expect(state.grants).toHaveLength(0);
  });

  it("needs a typed reason of 10 to 500 characters and the privacy acknowledgment", async () => {
    state.liveRecords = 1;
    await expect(startSnapshotBreakGlass(admin, { personId: "person-1", reason: "too short" }, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(startSnapshotBreakGlass(admin, { personId: "person-1", reason: "x".repeat(501) }, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    state.acknowledged = false;
    await expect(startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now)).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_REQUIRED" });
    expect(state.grants).toHaveLength(0);
  });

  it("refuses anyone but a system administrator", async () => {
    state.liveRecords = 1;
    await expect(startSnapshotBreakGlass({ kind: "HEALTH_ROLE", userId: "u-1", eventIds: ["e1"] }, { personId: "person-1", reason: REASON }, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startSnapshotBreakGlass({ kind: "CLUB_LEADER", organizationId: "c", accountId: "a" }, { personId: "person-1", reason: REASON }, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("with HEALTH_RECORDS_ENABLED off", () => {
  it("does not start break-glass or open sealed copies: the whole Health Record surface answers not found", async () => {
    state.env.HEALTH_RECORDS_ENABLED = false;
    state.liveRecords = 1;
    await expect(startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(viewSealedSnapshots(admin, "person-1", now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.grants).toHaveLength(0);
  });
});

describe("opening sealed copies with the same grant", () => {
  it("is refused with BREAK_GLASS_REQUIRED without a grant and refused after 24 hours, and a use is recorded when allowed", async () => {
    state.liveRecords = 1;
    state.snapshots = [{ id: "snap-1", eventId: "e1", eventDate: "2026-10-09", trigger: "CHECK_IN", takenAt: now, consentVersion: "v", signedOn: null, expiresAt: now, fieldCount: 1, event: { name: "Synthetic Event" }, fields: [{ fieldKey: "medications", sealedValue: "x" }] }];
    await expect(viewSealedSnapshots(admin, "person-1", now)).rejects.toMatchObject({ code: "BREAK_GLASS_REQUIRED" });
    const grant = await startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now);
    const opened = await viewSealedSnapshots(admin, "person-1", new Date(now.getTime() + 3_600_000));
    expect(opened.grantId).toBe(grant.grantId);
    expect(state.uses).toEqual([expect.objectContaining({ grantId: grant.grantId, userId: "admin-1", personId: "person-1", kind: "SEALED_COPIES" })]);
    await expect(viewSealedSnapshots(admin, "person-1", new Date(now.getTime() + 24 * 3_600_000))).rejects.toMatchObject({ code: "BREAK_GLASS_REQUIRED" });
  });
});

describe("the monthly review list", () => {
  it("lists each grant with who, when, why, whose record and its uses of the live record and sealed copies, never a value", async () => {
    state.liveRecords = 1;
    const { grantId } = await startSnapshotBreakGlass(actingAdmin, { personId: "person-1", reason: REASON }, now);
    state.uses.push(
      { grantId, userId: "admin-1", personId: "person-1", kind: "LIVE_RECORD", createdAt: new Date("2026-10-26T13:00:00Z") },
      { grantId, userId: "admin-1", personId: "person-1", kind: "LIVE_RECORD", createdAt: new Date("2026-10-26T14:00:00Z") },
      { grantId, userId: "admin-1", personId: "person-1", kind: "SEALED_COPIES", createdAt: new Date("2026-10-26T15:00:00Z") },
    );
    const rows = await listSnapshotBreakGlassGrants(admin);
    expect(rows).toEqual([{
      id: grantId,
      userId: "admin-1",
      userDisplayName: "Synthetic Admin",
      personId: "person-1",
      reason: REASON,
      grantedAt: now,
      expiresAt: new Date(now.getTime() + 24 * 3_600_000),
      uses: { total: 3, lastUsedAt: new Date("2026-10-26T15:00:00Z"), byKind: { LIVE_RECORD: 2, SEALED_COPIES: 1 } },
    }]);
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC-SEALED-VALUE");
    expect(state.audit.at(-1)).toMatchObject({ action: "HEALTH_SNAPSHOT_BREAK_GLASS_LISTED", metadata: { grantCount: 1 } });
  });

  it("keeps a grant whose person was deleted, with a null person id", async () => {
    state.liveRecords = 1;
    const { grantId } = await startSnapshotBreakGlass(admin, { personId: "person-1", reason: REASON }, now);
    state.grants[0]!.personId = null;
    state.uses.push({ grantId, userId: "admin-1", personId: null, kind: "LIVE_RECORD", createdAt: new Date("2026-10-26T13:00:00Z") });
    const rows = await listSnapshotBreakGlassGrants(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: grantId, personId: null, reason: REASON, uses: { total: 1, byKind: { LIVE_RECORD: 1 } } });
  });

  it("stays available with HEALTH_RECORDS_ENABLED off, for a system administrator", async () => {
    state.env.HEALTH_RECORDS_ENABLED = false;
    await expect(listSnapshotBreakGlassGrants(admin)).resolves.toEqual([]);
  });

  it("refuses everyone but a system administrator", async () => {
    await expect(listSnapshotBreakGlassGrants({ kind: "HEALTH_ROLE", userId: "u-1", eventIds: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
