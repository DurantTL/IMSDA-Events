import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assessOffsiteBackups,
  compileNamePatterns,
  DATABASE_BACKUP_STALE_AFTER_MS,
  DEFAULT_DATABASE_PATTERNS,
  formatBackupSize,
  offsiteDatabaseStatus,
} from "@/modules/operations/offsite-backups";
import {
  getOffsiteBackups,
  OFFSITE_FAILURE_TTL_MS,
  OFFSITE_SUCCESS_TTL_MS,
  resetOffsiteBackupsCache,
} from "@/modules/operations/offsite-backups-reader";
import { R2ListError } from "@/integrations/backups/r2-read";
import type { BackupObject } from "@/integrations/backups/types";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const obj = (key: string, hours: number, size: number | null = 100): BackupObject => ({ key, lastModified: hoursAgo(hours), size });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetOffsiteBackupsCache();
});
afterEach(() => vi.useRealTimers());

describe("offsite backup assessment (#1412)", () => {
  it("finds the newest database dump and files archive with safe labels", () => {
    const result = assessOffsiteBackups({
      objects: [
        obj("site/secret-prefix/db-old.sql.gz", 30, 10),
        obj("site/secret-prefix/db-new.SQL.GZ", 5, 2048),
        obj("site/secret-prefix/files-old.tar.gz", 50, 7),
        obj("site/secret-prefix/files-new.tgz", 6, 5_000_000),
        obj("site/secret-prefix/readme.txt", 1),
      ],
      partial: false,
      now: NOW,
    });
    expect(result.database).toEqual({ at: hoursAgo(5).toISOString(), bytes: 2048, label: "Database dump (.sql.gz)" });
    expect(result.files).toEqual({ at: hoursAgo(6).toISOString(), bytes: 5_000_000, label: "Files archive (.tgz)" });
    expect(JSON.stringify(result)).not.toContain("secret-prefix");
    expect(offsiteDatabaseStatus(result, NOW)).toBe("ok");
  });

  it("treats exactly 26 hours as fresh and just over as stale", () => {
    const at = (ms: number) => assessOffsiteBackups({ objects: [{ key: "a.sql", lastModified: new Date(NOW.getTime() - ms), size: 1 }], partial: false, now: NOW });
    expect(offsiteDatabaseStatus(at(DATABASE_BACKUP_STALE_AFTER_MS), NOW)).toBe("ok");
    expect(offsiteDatabaseStatus(at(DATABASE_BACKUP_STALE_AFTER_MS + 1), NOW)).toBe("stale");
  });

  it("reports missing when no database dump exists, and none found for files", () => {
    const result = assessOffsiteBackups({ objects: [obj("x/files.zip", 1)], partial: false, now: NOW });
    expect(result.database).toBeNull();
    expect(offsiteDatabaseStatus(result, NOW)).toBe("missing");
    const noFiles = assessOffsiteBackups({ objects: [obj("x/a.dump", 1)], partial: false, now: NOW });
    expect(noFiles.files).toBeNull();
    expect(noFiles.database?.label).toBe("Database dump (.dump)");
  });

  it("carries partial through", () => {
    expect(assessOffsiteBackups({ objects: [], partial: true, now: NOW }).partial).toBe(true);
  });

  it("matches the file name only, case-insensitively, with database patterns first", () => {
    expect(assessOffsiteBackups({ objects: [obj("backup.sql/notes.txt", 1)], partial: false, now: NOW }).database).toBeNull();
    const both = assessOffsiteBackups({
      objects: [obj("a.tar.gz", 2)],
      databasePatterns: "*.tar.gz",
      filesPatterns: "*.tar.gz",
      partial: false,
      now: NOW,
    });
    expect(both.database?.label).toBe("Database dump (.tar.gz)");
    expect(both.files).toBeNull();
  });

  it("supports custom patterns, `*` as the only wildcard, and escapes the rest", () => {
    const [pattern] = compileNamePatterns("nightly-*.bak", DEFAULT_DATABASE_PATTERNS);
    expect(pattern.regex.test("NIGHTLY-2026.bak")).toBe(true);
    expect(pattern.regex.test("nightly-2026xbak")).toBe(false);
    expect(compileNamePatterns("a.b?", []) [0].regex.test("aXbY")).toBe(false);
    expect(compileNamePatterns("  ", ["*.sql"])[0].regex.test("x.sql")).toBe(true);
    // A pattern without a plain extension tail gives a label with the kind only.
    const result = assessOffsiteBackups({ objects: [obj("nightly-1.bak", 1)], databasePatterns: "nightly-*", partial: false, now: NOW });
    expect(result.database?.label).toBe("Database dump");
  });

  it("formats sizes", () => {
    expect(formatBackupSize(null)).toBe("size not reported");
    expect(formatBackupSize(512)).toBe("512 B");
    expect(formatBackupSize(2048)).toBe("2 KB");
    expect(formatBackupSize(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBackupSize(3.5 * 1024 ** 3)).toBe("3.5 GB");
  });
});

describe("offsite backup reader and cache (#1412)", () => {
  const env = {
    BACKUP_R2_READ_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    BACKUP_R2_READ_ACCESS_KEY_ID: "id",
    BACKUP_R2_READ_SECRET_ACCESS_KEY: "secret",
    BACKUP_R2_READ_BUCKET: "my-bucket",
  };

  it("never lists when not connected or misconfigured", async () => {
    const list = vi.fn();
    expect(await getOffsiteBackups({ env: {}, list })).toEqual({ state: "not_connected" });
    expect(await getOffsiteBackups({ env: { BACKUP_R2_READ_BUCKET: "my-bucket" }, list })).toMatchObject({ state: "misconfigured" });
    expect(list).not.toHaveBeenCalled();
  });

  it("caches a success for 10 minutes", async () => {
    const list = vi.fn(async () => ({ objects: [obj("a.sql", 1)], partial: false }));
    const first = await getOffsiteBackups({ env, list });
    expect(first).toMatchObject({ state: "checked" });
    vi.setSystemTime(new Date(NOW.getTime() + OFFSITE_SUCCESS_TTL_MS - 1));
    await getOffsiteBackups({ env, list });
    expect(list).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + OFFSITE_SUCCESS_TTL_MS + 1));
    await getOffsiteBackups({ env, list });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("caches a failure for 1 minute with a generic reason", async () => {
    const list = vi.fn(async () => { throw new R2ListError("refused"); });
    const result = await getOffsiteBackups({ env, list });
    expect(result).toMatchObject({ state: "error", reason: "R2 refused the read-only key" });
    vi.setSystemTime(new Date(NOW.getTime() + OFFSITE_FAILURE_TTL_MS - 1));
    await getOffsiteBackups({ env, list });
    expect(list).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + OFFSITE_FAILURE_TTL_MS + 1));
    await getOffsiteBackups({ env, list });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("maps other failures to generic reasons and never echoes the error", async () => {
    const timeout = await getOffsiteBackups({ env, list: async () => { throw new R2ListError("timeout"); } });
    expect(timeout).toMatchObject({ reason: "timed out" });
    resetOffsiteBackupsCache();
    const other = await getOffsiteBackups({ env, list: async () => { throw new Error("connect to my-bucket.example failed"); } });
    expect(other).toMatchObject({ state: "error", reason: "could not reach R2" });
    expect(JSON.stringify(other)).not.toContain("my-bucket");
  });

  it("shares one read between concurrent callers", async () => {
    let release: () => void = () => undefined;
    const list = vi.fn(() => new Promise<{ objects: BackupObject[]; partial: boolean }>((resolve) => { release = () => resolve({ objects: [], partial: false }); }));
    const a = getOffsiteBackups({ env, list });
    const b = getOffsiteBackups({ env, list });
    release();
    expect(await a).toBe(await b);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
