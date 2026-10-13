import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  logError: vi.fn(),
  getServerEnv: vi.fn(),
  getSweepHeartbeat: vi.fn(),
  getPlatformSettings: vi.fn(),
  readdir: vi.fn(),
  getBackupStatus: vi.fn<() => Promise<unknown>>(async () => { throw new Error("backup log unavailable in this test"); }),
  redirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { mocks.redirect(to); throw new Error(`REDIRECT:${to}`); },
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/components/system-readiness-workspace", () => ({ SystemReadinessWorkspace: () => null }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/integrations/email/provider", () => ({ getEmailAvailability: () => ({ deliveryConfigured: true }) }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getSweepHeartbeat: mocks.getSweepHeartbeat }));
vi.mock("@/modules/operations/backup-status-repository", () => ({ getBackupStatus: mocks.getBackupStatus }));
vi.mock("@/modules/system-admin/platform-settings", () => ({ getPlatformSettings: mocks.getPlatformSettings }));
vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs/promises")>()), readdir: mocks.readdir }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import SystemReadinessPage from "@/app/(workspace)/admin/readiness/page";
import { POST, GET } from "@/app/api/admin/system-readiness/route";
import { assessBackupStatus, type BackupRunRecord, type BackupRunSummary } from "@/modules/operations/backup-status";
import { getAutomaticBackupEvidence, type BackupEvidence } from "@/modules/system-admin/readiness-backup";
import {
  automaticBackupKeys,
  evaluateAutomaticChecks,
  evaluateBackupItems,
  pendingMigrationNames,
  type ReadinessFacts,
} from "@/modules/system-admin/readiness-checks";
import { manualReadinessItems } from "@/modules/system-admin/readiness-items";
import {
  getSystemReadiness,
  ReadinessError,
  tickReadinessItem,
  untickReadinessItem,
} from "@/modules/system-admin/readiness-repository";

const now = new Date("2026-10-16T12:00:00.000Z");

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    admins: [
      { displayName: "Synthetic Admin One", hasMfaOrPasskey: true },
      { displayName: "Synthetic Admin Two", hasMfaOrPasskey: false },
    ],
    pendingMigrations: [],
    sweep: { status: "ok", lastSucceededAt: now.toISOString(), lastFailedAt: null, ageMs: 1000 },
    encryptionKeyConfigured: true,
    email: { deliveryConfigured: true, senderConfigured: true, senderReadable: true, senderDeliverable: true },
    square: { environment: "sandbox", productionUnlocked: false },
    backup: { readable: false },
    ...overrides,
  };
}

function row(rows: ReturnType<typeof evaluateAutomaticChecks>, key: string) {
  const found = rows.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing row ${key}`);
  return found;
}

const record = (hours: number, overrides: Partial<BackupRunRecord> = {}): BackupRunRecord => {
  const finishedAt = new Date(now.getTime() - hours * 3_600_000);
  return { startedAt: new Date(finishedAt.getTime() - 240_000), finishedAt, ok: true, dumpBytes: 5000, assetsBytes: 700, offsiteOk: true, ...overrides };
};
const evidence = (summary: Partial<BackupRunSummary>, at = now): BackupEvidence => ({
  readable: true,
  status: assessBackupStatus(
    { latest: null, latestSuccess: null, latestOffsiteSuccess: null, latestRehearsal: null, latestRehearsalSuccess: null, migrationFinishedAt: new Date("2026-10-01T00:00:00.000Z"), ...summary },
    at,
  ),
});
const healthyEvidence = (): BackupEvidence => {
  const backup = record(10);
  const rehearsal = record(48);
  return evidence({ latest: backup, latestSuccess: backup, latestOffsiteSuccess: backup, latestRehearsal: rehearsal, latestRehearsalSuccess: rehearsal });
};

describe("manual readiness items", () => {
  it("have unique, stable-looking keys and never say background check", () => {
    const keys = manualReadinessItems.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of manualReadinessItems) {
      expect(item.key).toMatch(/^[a-z0-9-]+$/);
      expect(`${item.title} ${item.detail}`.toLowerCase()).not.toContain("background check");
    }
    expect(manualReadinessItems.some((item) => item.title.includes("Sterling Volunteers check"))).toBe(true);
  });
});

describe("automatic readiness checks", () => {
  it("names the administrators without MFA or a passkey", () => {
    const mfa = row(evaluateAutomaticChecks(facts(), now), "admins-mfa");
    expect(mfa.status).toBe("attention");
    expect(mfa.people).toEqual(["Synthetic Admin Two"]);
    expect(mfa.summary).toContain("1 of 2");
  });

  it("passes when every administrator is covered, and flags none at all", () => {
    expect(row(evaluateAutomaticChecks(facts({ admins: [{ displayName: "A", hasMfaOrPasskey: true }] }), now), "admins-mfa").status).toBe("ok");
    expect(row(evaluateAutomaticChecks(facts({ admins: [] }), now), "admins-mfa").status).toBe("attention");
    expect(row(evaluateAutomaticChecks(facts({ admins: null }), now), "admins-mfa").status).toBe("unknown");
  });

  it("reports pending migrations by count only", () => {
    const rows = evaluateAutomaticChecks(facts({ pendingMigrations: ["20261016100000_x", "20261016110000_y"] }), now);
    expect(row(rows, "migrations").status).toBe("attention");
    expect(row(rows, "migrations").summary).toBe("2 migrations are not applied yet.");
    expect(row(evaluateAutomaticChecks(facts({ pendingMigrations: null }), now), "migrations").status).toBe("unknown");
  });

  it("maps the sweeper heartbeat", () => {
    const base = { lastSucceededAt: null, lastFailedAt: null, ageMs: null };
    expect(row(evaluateAutomaticChecks(facts({ sweep: { ...base, status: "stale" } }), now), "outbox-sweeper").status).toBe("attention");
    expect(row(evaluateAutomaticChecks(facts({ sweep: { ...base, status: "never" } }), now), "outbox-sweeper").status).toBe("attention");
    expect(row(evaluateAutomaticChecks(facts({ sweep: null }), now), "outbox-sweeper").status).toBe("unknown");
    expect(row(evaluateAutomaticChecks(facts(), now), "outbox-sweeper").status).toBe("ok");
  });

  it("shows encryption key, email and Square as yes/no and state only", () => {
    const rows = evaluateAutomaticChecks(
      facts({
        encryptionKeyConfigured: false,
        email: { deliveryConfigured: false, senderConfigured: true, senderReadable: true, senderDeliverable: false },
        square: { environment: "production", productionUnlocked: false },
      }),
      now,
    );
    expect(row(rows, "encryption-key").status).toBe("attention");
    expect(row(rows, "email-provider").status).toBe("attention");
    expect(row(rows, "email-sender").status).toBe("attention");
    expect(row(rows, "square-environment").status).toBe("info");
    expect(row(rows, "square-environment").summary).toContain("not unlocked");
  });

  it("hides the manual backup items only when the log was read", () => {
    expect(automaticBackupKeys({ readable: false }).size).toBe(0);
    expect([...automaticBackupKeys(healthyEvidence())].sort()).toEqual(["backup-offsite", "restore-rehearsal"]);
  });
});

describe("automatic backup rows (#895)", () => {
  it("shows fresh backup and restore test as ok, with dates and yes/no", () => {
    const rows = evaluateBackupItems(healthyEvidence(), now);
    expect(rows.map((candidate) => candidate.status)).toEqual(["ok", "ok"]);
    expect(rows[0].summary).toContain("2026-10-16");
    expect(rows[0].summary).toContain("Latest run reached the offsite copy: yes");
    expect(rows[1].summary).toContain("2026-10-14");
  });

  it("agrees with the health status rules: stale, failing, never and missing offsite are attention", () => {
    const stale = record(40);
    expect(evaluateBackupItems(evidence({ latest: stale, latestSuccess: stale, latestOffsiteSuccess: stale }), now)[0]).toMatchObject({ status: "attention" });

    const failed = record(1, { ok: false });
    const good = record(10);
    expect(evaluateBackupItems(evidence({ latest: failed, latestSuccess: good, latestOffsiteSuccess: good }), now)[0]).toMatchObject({ status: "attention" });

    const noOffsite = record(10, { offsiteOk: false });
    const row = evaluateBackupItems(evidence({ latest: noOffsite, latestSuccess: noOffsite }), now)[0];
    expect(row.status).toBe("attention");
    expect(row.summary).toContain("Latest run reached the offsite copy: no");

    // Never run, shortly after the table was created: health says "never", which is attention here, not ok.
    const fresh = evidence({ migrationFinishedAt: new Date(now.getTime() - 3_600_000) });
    const never = evaluateBackupItems(fresh, now);
    expect(never.map((candidate) => candidate.status)).toEqual(["attention", "attention"]);
    expect(never[0].summary).toContain("No backup has run yet");
    expect(never[1].summary).toContain("No restore test has run yet");
  });

  it("flags stopped offsite copies and a backup that never reached offsite", () => {
    const old = record(60, { offsiteOk: true });
    const latest = record(10, { offsiteOk: false });
    const stopped = evaluateBackupItems(evidence({ latest, latestSuccess: latest, latestOffsiteSuccess: old }), now)[0];
    expect(stopped.status).toBe("attention");
    expect(stopped.summary).toContain("Offsite copies have stopped (last 2026-10-14)");

    const neverOffsite = record(10, { offsiteOk: null });
    const rows = evaluateBackupItems(evidence({ latest: neverOffsite, latestSuccess: neverOffsite }), now);
    expect(rows[0].status).toBe("attention");
    expect(rows[0].summary).toContain("No offsite copy has been recorded.");
  });

  it("says the latest run failed whenever it did, even while the last success is recent", () => {
    const failed = record(1, { ok: false });
    const good = record(10);
    const row = evaluateBackupItems(evidence({ latest: failed, latestSuccess: good, latestOffsiteSuccess: good }), now)[0];
    expect(row.summary).toContain("The latest run failed.");
  });

  it("flags a restore test that is overdue or failed", () => {
    const backup = record(10);
    const old = record(24 * 9);
    expect(evaluateBackupItems(evidence({ latest: backup, latestSuccess: backup, latestOffsiteSuccess: backup, latestRehearsal: old, latestRehearsalSuccess: old }), now)[1]).toMatchObject({ status: "attention" });
    const failed = record(2, { ok: false });
    const row = evaluateBackupItems(evidence({ latest: backup, latestSuccess: backup, latestOffsiteSuccess: backup, latestRehearsal: failed, latestRehearsalSuccess: record(48) }), now)[1];
    expect(row.status).toBe("attention");
    expect(row.summary).toContain("failed");
  });

  it("shows unknown rows when the backup log cannot be read", () => {
    expect(evaluateBackupItems({ readable: false }, now).map((candidate) => candidate.status)).toEqual(["unknown", "unknown"]);
  });

  it("never shows locations or secrets in any row", () => {
    const leaky = healthyEvidence();
    if (!leaky.readable) throw new Error("unreachable");
    // Even if a location sneaked into the assessed status, the rows only render the fields they name.
    Object.assign(leaky.status, { bucket: "synthetic-bucket-name", path: "/srv/backups/synthetic", host: "backup.synthetic.example", accessKey: "SYNTHETICKEY123" });
    const text = JSON.stringify([...evaluateBackupItems(leaky, now), ...evaluateBackupItems({ readable: false }, now)]);
    for (const needle of ["synthetic-bucket-name", "/srv/backups", "backup.synthetic.example", "SYNTHETICKEY123", "s3://", "http"]) {
      expect(text).not.toContain(needle);
    }
  });

  it("the seam returns unreadable evidence instead of throwing when the log read fails", async () => {
    mocks.getBackupStatus.mockRejectedValueOnce(new Error("connection to db.internal.example refused"));
    await expect(getAutomaticBackupEvidence(now)).resolves.toEqual({ readable: false });
    const ok = healthyEvidence();
    if (!ok.readable) throw new Error("unreachable");
    mocks.getBackupStatus.mockResolvedValueOnce(ok.status);
    await expect(getAutomaticBackupEvidence(now)).resolves.toMatchObject({ readable: true });
  });
});

function fakeDatabase(existing: Record<string, unknown> | null) {
  const tx = {
    systemReadinessTick: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  mocks.getPrisma.mockReturnValue({ ...tx, $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) });
  return tx;
}

describe("ticking and unticking", () => {
  const actor = { id: "user-1", displayName: "Synthetic Admin One" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records who ticked and audits it", async () => {
    const tx = fakeDatabase(null);
    await tickReadinessItem("director-invites-sent", actor, "  sent to all synthetic clubs ");
    expect(tx.systemReadinessTick.create).toHaveBeenCalledWith({
      data: { itemKey: "director-invites-sent", tickedByUserId: "user-1", tickedByName: "Synthetic Admin One", note: "sent to all synthetic clubs" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SYSTEM_READINESS_TICKED", entityId: "director-invites-sent", actorUserId: "user-1" }),
      tx,
    );
  });

  it("refuses an unknown item and a second tick", async () => {
    fakeDatabase(null);
    await expect(tickReadinessItem("nope", actor)).rejects.toMatchObject({ code: "UNKNOWN_ITEM" });
    fakeDatabase({ itemKey: "wr26-signed-off" });
    await expect(tickReadinessItem("wr26-signed-off", actor)).rejects.toMatchObject({ code: "ALREADY_TICKED" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("requires a reason to untick and keeps it in the audit entry", async () => {
    const tx = fakeDatabase({ itemKey: "wr26-signed-off", tickedByName: "Synthetic Admin Two", tickedAt: new Date("2026-10-10T00:00:00.000Z") });
    await expect(untickReadinessItem("wr26-signed-off", actor, "   ")).rejects.toBeInstanceOf(ReadinessError);
    expect(tx.systemReadinessTick.deleteMany).not.toHaveBeenCalled();
    await untickReadinessItem("wr26-signed-off", actor, "Ticked in error");
    expect(tx.systemReadinessTick.deleteMany).toHaveBeenCalledWith({ where: { itemKey: "wr26-signed-off" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SYSTEM_READINESS_UNTICKED",
        metadata: expect.objectContaining({ reason: "Ticked in error", previouslyTickedBy: "Synthetic Admin Two" }),
      }),
      tx,
    );
  });

  it("refuses to untick an item that is not ticked", async () => {
    fakeDatabase(null);
    await expect(untickReadinessItem("wr26-signed-off", actor, "why")).rejects.toMatchObject({ code: "NOT_TICKED" });
  });
});

describe("system readiness route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
  });

  function post(body: unknown) {
    return POST(new Request("http://localhost/api/admin/system-readiness", { method: "POST", body: JSON.stringify(body) }));
  }

  it("refuses anyone who is not a signed-in system administrator, before touching the database", async () => {
    for (const session of [{ user: null }, { user: { id: "u", displayName: "Event Admin", globalRole: null } }]) {
      mocks.getCurrentSession.mockResolvedValue(session);
      expect((await post({ action: "tick", key: "wr26-signed-off" })).status).toBe(403);
      expect((await GET(new Request("http://localhost/api/admin/system-readiness"))).status).toBe(403);
    }
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects cross-origin posts", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", displayName: "A", globalRole: "SYSTEM_ADMIN" } });
    expect((await post({ action: "tick", key: "wr26-signed-off" })).status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("rejects a malformed body from an administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", displayName: "A", globalRole: "SYSTEM_ADMIN" } });
    expect((await post({ action: "delete-everything", key: "x" })).status).toBe(400);
  });
});

describe("tick races", () => {
  const actor = { id: "user-1", displayName: "Synthetic Admin One" };
  beforeEach(() => vi.clearAllMocks());

  function knownError(code: string) {
    return new Prisma.PrismaClientKnownRequestError("synthetic", { code, clientVersion: "test" });
  }

  it("maps a concurrent tick (P2002) to ALREADY_TICKED", async () => {
    const tx = fakeDatabase(null);
    tx.systemReadinessTick.create.mockRejectedValue(knownError("P2002"));
    await expect(tickReadinessItem("wr26-signed-off", actor)).rejects.toMatchObject({ code: "ALREADY_TICKED" });
  });

  it("maps a concurrent untick (P2025 or nothing deleted) to NOT_TICKED", async () => {
    const existing = { itemKey: "wr26-signed-off", tickedByName: "X", tickedAt: new Date() };
    const tx = fakeDatabase(existing);
    tx.systemReadinessTick.deleteMany.mockRejectedValue(knownError("P2025"));
    await expect(untickReadinessItem("wr26-signed-off", actor, "why")).rejects.toMatchObject({ code: "NOT_TICKED" });
    tx.systemReadinessTick.deleteMany.mockResolvedValue({ count: 0 });
    await expect(untickReadinessItem("wr26-signed-off", actor, "why")).rejects.toMatchObject({ code: "NOT_TICKED" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns 409 through the route for a tick race", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", displayName: "A", globalRole: "SYSTEM_ADMIN" } });
    const tx = fakeDatabase(null);
    tx.systemReadinessTick.create.mockRejectedValue(knownError("P2002"));
    const response = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ action: "tick", key: "wr26-signed-off" }) }));
    expect(response.status).toBe(409);
  });
});

describe("pending migrations", () => {
  const at = new Date("2026-10-01T00:00:00.000Z");
  it("treats failed and rolled-back rows as pending and a re-applied one as applied", () => {
    const rows = [
      { migration_name: "a_done", finished_at: at, rolled_back_at: null },
      { migration_name: "b_failed", finished_at: null, rolled_back_at: null },
      { migration_name: "c_rolled_back", finished_at: at, rolled_back_at: at },
      { migration_name: "d_reapplied", finished_at: at, rolled_back_at: at },
      { migration_name: "d_reapplied", finished_at: at, rolled_back_at: null },
    ];
    expect(pendingMigrationNames(["a_done", "b_failed", "c_rolled_back", "d_reapplied", "e_missing"], rows))
      .toEqual(["b_failed", "c_rolled_back", "e_missing"]);
  });
});

describe("getSystemReadiness", () => {
  const SECRET_KEY = "synthetic-encryption-key-value-0123456789";
  const SENDER = "synthetic.sender@events.synthetic-domain.test";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerEnv.mockReturnValue({
      SECRET_ENCRYPTION_KEY: SECRET_KEY,
      ACCOUNT_EMAIL_SENDER_ADDRESS: SENDER,
      SQUARE_ENABLE_PRODUCTION: false,
    });
    mocks.getSweepHeartbeat.mockResolvedValue({ status: "ok", lastSucceededAt: null, lastFailedAt: null, ageMs: 0 });
    mocks.getPlatformSettings.mockResolvedValue({ defaultSenderEmail: SENDER });
    mocks.readdir.mockResolvedValue([{ name: "m1", isDirectory: () => true }]);
  });

  function database(ticksError?: Error) {
    mocks.getPrisma.mockReturnValue({
      user: { findMany: vi.fn().mockResolvedValue([{ displayName: "Synthetic Admin", mfaEnrollment: { status: "ACTIVE" }, passkeys: [] }]) },
      $queryRaw: vi.fn().mockResolvedValue([{ migration_name: "m1", finished_at: new Date(), rolled_back_at: null }]),
      systemReadinessTick: {
        findMany: ticksError ? vi.fn().mockRejectedValue(ticksError) : vi.fn().mockResolvedValue([]),
      },
    });
  }

  it("never serialises the key or a sender address", async () => {
    database();
    const text = JSON.stringify(await getSystemReadiness(now));
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain(SENDER);
    expect(text).not.toContain("synthetic.sender");
  });

  it("replaces the manual backup items with automatic rows when the log was read, leaking nothing", async () => {
    database();
    const ok = healthyEvidence();
    if (!ok.readable) throw new Error("unreachable");
    mocks.getBackupStatus.mockResolvedValueOnce({ ...ok.status, bucket: "synthetic-bucket-name", path: "/srv/backups/synthetic", host: "backup.synthetic.example", accessKey: "SYNTHETICKEY123" });
    const readiness = await getSystemReadiness(now);
    const manualKeys = readiness.groups.flatMap((group) => group.items).map((item) => item.key);
    expect(manualKeys).not.toContain("backup-offsite");
    expect(manualKeys).not.toContain("restore-rehearsal");
    expect(readiness.automatic.find((candidate) => candidate.key === "backup-offsite")?.status).toBe("ok");
    expect(readiness.automatic.find((candidate) => candidate.key === "restore-rehearsal")?.status).toBe("ok");
    const text = JSON.stringify(readiness);
    for (const needle of ["synthetic-bucket-name", "/srv/backups", "backup.synthetic.example", "SYNTHETICKEY123"]) {
      expect(text).not.toContain(needle);
    }
  });

  it("keeps the manual backup items tickable and shows unknown rows when the log is unreadable", async () => {
    database();
    mocks.getBackupStatus.mockRejectedValueOnce(new Error("connection refused"));
    const readiness = await getSystemReadiness(now);
    const manualKeys = readiness.groups.flatMap((group) => group.items).map((item) => item.key);
    expect(manualKeys).toContain("backup-offsite");
    expect(manualKeys).toContain("restore-rehearsal");
    expect(readiness.automatic.find((candidate) => candidate.key === "backup-offsite")?.status).toBe("unknown");
    expect(readiness.automatic.find((candidate) => candidate.key === "restore-rehearsal")?.status).toBe("unknown");
  });

  it("keeps automatic checks when the tick table is missing", async () => {
    database(new Error("relation does not exist"));
    const readiness = await getSystemReadiness(now);
    expect(readiness.ticksAvailable).toBe(false);
    expect(readiness.summary.manualDone).toBe(0);
    expect(readiness.groups.flatMap((group) => group.items).every((item) => item.tick === null)).toBe(true);
    expect(readiness.automatic.find((candidate) => candidate.key === "migrations")?.status).toBe("ok");
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("shows the sender as unknown when settings cannot be read and no account sender is set", async () => {
    mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: SECRET_KEY, SQUARE_ENABLE_PRODUCTION: false });
    mocks.getPlatformSettings.mockRejectedValue(new Error("down"));
    database();
    const readiness = await getSystemReadiness(now);
    expect(readiness.automatic.find((candidate) => candidate.key === "email-sender")?.status).toBe("unknown");
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("Square unlock display", () => {
  it("shows the unlock state on sandbox too", () => {
    const rows = evaluateAutomaticChecks(facts(), now);
    expect(row(rows, "square-environment").summary).toBe("Sandbox. Production unlock: off.");
  });
});

describe("route success and validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", displayName: "Synthetic Admin", globalRole: "SYSTEM_ADMIN" } });
  });

  it("ticks for an administrator and returns the readiness", async () => {
    const tx = fakeDatabase(null);
    mocks.getServerEnv.mockReturnValue({ SQUARE_ENABLE_PRODUCTION: false });
    mocks.getSweepHeartbeat.mockResolvedValue(null);
    mocks.getPlatformSettings.mockResolvedValue({ defaultSenderEmail: null });
    mocks.readdir.mockResolvedValue([]);
    const client = mocks.getPrisma();
    client.user = { findMany: vi.fn().mockResolvedValue([]) };
    client.$queryRaw = vi.fn().mockResolvedValue([]);
    const response = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ action: "tick", key: "wr26-signed-off" }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).readiness.groups).toBeDefined();
    expect(tx.systemReadinessTick.create).toHaveBeenCalled();
  });

  it("returns 400 for an untick without a reason", async () => {
    fakeDatabase({ itemKey: "wr26-signed-off", tickedByName: "X", tickedAt: new Date() });
    const response = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ action: "untick", key: "wr26-signed-off" }) }));
    expect(response.status).toBe(400);
  });
});

describe("readiness page access", () => {
  beforeEach(() => vi.clearAllMocks());
  it("redirects a non-admin to no-access and a signed-out user to login", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    await expect(SystemReadinessPage()).rejects.toThrow("REDIRECT:/no-access");
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(SystemReadinessPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });
});
