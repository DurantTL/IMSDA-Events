import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #1790: the database copy taken before each deploy.
const script = path.join(process.cwd(), "scripts/backup/pre-deploy-backup.sh");
const sha = "d".repeat(40);

// Stand-ins: pg_dump writes FAKE_DUMP_BYTES bytes, pg_restore --list fails on
// FAKE_RESTORE_FAIL, aws logs every call and answers `s3 ls` with FAKE_R2_LISTING.
const fakes: Record<string, string> = {
  pg_dump: `#!/bin/sh
echo "pg_dump $*" >> "$FAKE_LOG"
[ -n "$FAKE_DUMP_FAIL" ] && exit 1
for arg in "$@"; do case "$arg" in --file=*) file="\${arg#--file=}" ;; esac; done
head -c "\${FAKE_DUMP_BYTES:-4096}" /dev/zero > "$file"
`,
  pg_restore: `#!/bin/sh
echo "pg_restore $*" >> "$FAKE_LOG"
[ -n "$FAKE_RESTORE_FAIL" ] && exit 1
exit 0
`,
  aws: `#!/bin/sh
echo "aws $*" >> "$FAKE_LOG"
case "$*" in
  *"s3 ls"*) printf '%s\\n' "$FAKE_R2_LISTING"; exit 0 ;;
  *"s3 cp"*) [ -n "$FAKE_UPLOAD_FAIL" ] && exit 1 ;;
esac
exit 0
`,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "pre-deploy-backup-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  const backups = path.join(dir, "backups");
  mkdirSync(bin);
  mkdirSync(backups);
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(dir, "log");
  writeFileSync(log, "");
  const predeploy = path.join(backups, "pre-deploy");
  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${bin}:/usr/bin:/bin`,
        BACKUP_DIR: backups,
        PGDATABASE: "imsda_events",
        BACKUP_REQUIRE_OFFSITE: "true",
        BACKUP_OFFSITE_COMMAND: `sh ${path.join(process.cwd(), "scripts/backup/offsite-r2.sh")} "$1"`,
        R2_ACCOUNT_ID: "synthetic-account",
        R2_ACCESS_KEY_ID: "synthetic-key-id",
        R2_SECRET_ACCESS_KEY: "synthetic-secret-value",
        R2_BUCKET: "synthetic-bucket",
        FAKE_LOG: log,
        ...env,
      },
    });
    const files = (() => {
      try {
        return readdirSync(predeploy).sort();
      } catch {
        return [];
      }
    })();
    return { ...result, files, calls: readFileSync(log, "utf8") };
  };
  return { run, predeploy };
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe("pre-deploy-backup.sh", () => {
  it("writes one readable copy named with the UTC date, time and version, and sends it off-site", () => {
    const { run, predeploy } = setup();
    const result = run([sha]);
    expect(result.status).toBe(0);
    expect(result.files).toHaveLength(1);
    const name = result.files[0];
    expect(name).toMatch(/^imsda-predeploy-\d{8}T\d{6}Z-d{12}\.pgdump$/);
    expect(statSync(path.join(predeploy, name)).mode & 0o777).toBe(0o600);
    expect(result.calls).toContain("pg_dump --format=custom");
    expect(result.calls).toContain("pg_restore --list");
    // Its own folder in R2, so it is never taken for a nightly dump.
    expect(result.calls).toContain(`s3://synthetic-bucket/imsda-events/pre-deploy/${name}`);
    expect(result.stdout + result.stderr).not.toContain("synthetic-secret-value");
  });

  it("never uses a name the nightly scripts, the rehearsal or the R2 check look for", () => {
    const { run } = setup();
    const result = run([sha]);
    expect(result.files[0]).not.toMatch(/\.dump$/);
    expect(result.files[0]).not.toMatch(/^imsda-events-/);
  });

  it("files the copy under a custom R2 prefix when one is set", () => {
    const { run } = setup();
    const result = run([sha], { R2_PREFIX: "events.example/" });
    expect(result.status).toBe(0);
    expect(result.calls).toContain("s3://synthetic-bucket/events.example/pre-deploy/imsda-predeploy-");
  });

  it("fails, so the deploy stops, when the dump fails", () => {
    const { run } = setup();
    const result = run([sha], { FAKE_DUMP_FAIL: "1" });
    expect(result.status).not.toBe(0);
    expect(result.files).toEqual([]);
  });

  it("fails and keeps nothing when the copy is tiny or cannot be read back", () => {
    const cases: Record<string, string>[] = [{ FAKE_DUMP_BYTES: "10" }, { FAKE_RESTORE_FAIL: "1" }];
    for (const env of cases) {
      const { run } = setup();
      const result = run([sha], env);
      expect(result.status).not.toBe(0);
      expect(result.files).toEqual([]);
    }
  });

  it("fails when the off-site copy fails while off-site is required", () => {
    const { run } = setup();
    const result = run([sha], { FAKE_UPLOAD_FAIL: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OFF-SITE COPY FAILED");
  });

  it("fails when off-site is required but no off-site command is set", () => {
    const { run } = setup();
    const result = run([sha], { BACKUP_OFFSITE_COMMAND: "" });
    expect(result.status).not.toBe(0);
  });

  it("refuses an argument that is not a commit sha", () => {
    const { run } = setup();
    for (const arg of [[], ["main"], ["abc; rm -rf /"]]) {
      const result = run(arg);
      expect(result.status).toBe(2);
      expect(result.calls).not.toContain("pg_dump");
    }
  });

  it("deletes local copies older than 14 days, always keeping the newest three", () => {
    const { run, predeploy } = setup();
    mkdirSync(predeploy);
    const old = ["imsda-predeploy-20260101T000000Z-aaaaaaaaaaaa.pgdump", "imsda-predeploy-20260102T000000Z-bbbbbbbbbbbb.pgdump"];
    const recent = "imsda-predeploy-20261110T000000Z-cccccccccccc.pgdump";
    old.forEach((name, i) => {
      writeFileSync(path.join(predeploy, name), "x");
      utimesSync(path.join(predeploy, name), daysAgo(30 - i), daysAgo(30 - i));
    });
    writeFileSync(path.join(predeploy, recent), "x");
    utimesSync(path.join(predeploy, recent), daysAgo(5), daysAgo(5));
    writeFileSync(path.join(predeploy, "imsda-predeploy-stale.pgdump.partial"), "x");

    // With the new copy there are four; the oldest one goes.
    const result = run([sha]);
    expect(result.status).toBe(0);
    expect(result.files).not.toContain(old[0]);
    expect(result.files).toContain(old[1]);
    expect(result.files).toContain(recent);
    expect(result.files.some((f) => f.endsWith(".partial"))).toBe(false);
  });

  it("deletes R2 copies older than 14 days by the stamp in their name, keeping the newest three", () => {
    const { run } = setup();
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const keys = [40, 30, 20, 10, 1].map((days, i) => `imsda-predeploy-${stamp(daysAgo(days))}-${String(i).repeat(12)}.pgdump`);
    const listing = [
      ...keys.map((key) => `2026-11-01 00:00:00      4096 ${key}`),
      "2026-11-01 00:00:00      4096 notes.txt",
    ].join("\n");
    const result = run([sha], { FAKE_R2_LISTING: listing });
    expect(result.status).toBe(0);
    // Newest three (by name) are the 10- and 1-day copies plus the 20-day one; the 40 and 30 go.
    expect(result.calls).toContain(`s3 rm s3://synthetic-bucket/imsda-events/pre-deploy/${keys[0]}`);
    expect(result.calls).toContain(`s3 rm s3://synthetic-bucket/imsda-events/pre-deploy/${keys[1]}`);
    for (const key of keys.slice(2)) expect(result.calls).not.toContain(`s3 rm s3://synthetic-bucket/imsda-events/pre-deploy/${key}`);
    expect(result.calls).not.toContain("notes.txt --endpoint");
  });
});
