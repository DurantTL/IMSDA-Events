import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * #1798: the app container runs as the unprivileged `node` user, and the entrypoint stops before any migration when
 * that user cannot use the uploads folder or the encryption key file.
 */

const root = process.cwd();
const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const entrypoint = path.join(root, "docker-entrypoint.sh");
const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));
// The permission cases need a user the file modes apply to; root passes every check.
const asRoot = process.getuid?.() === 0;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    spawnSync("chmod", ["-R", "u+rwx", dir]);
    rmSync(dir, { recursive: true, force: true });
  }
});

function run(env: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "node-user-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  const log = path.join(dir, "calls.log");
  mkdirSync(bin);
  writeFileSync(log, "");
  for (const name of ["npx", "npm"]) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "$FAKE_LOG"\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const result = spawnSync("sh", [entrypoint, "echo", "app-started"], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: `${bin}:/usr/bin:/bin`, FAKE_LOG: log, ...env },
  });
  return { ...result, dir, calls: readFileSync(log, "utf8").trim() };
}

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "node-user-data-"));
  dirs.push(dir);
  return dir;
}

describe("the image runs as the node user (#1798)", () => {
  it("switches to node after the app is copied in, and before the entrypoint", () => {
    expect(runner).toMatch(/^USER node$/m);
    expect(runner.indexOf("COPY --from=build /app ./")).toBeLessThan(runner.indexOf("USER node"));
    expect(runner.indexOf("USER node")).toBeLessThan(runner.indexOf("ENTRYPOINT"));
    expect(runner).not.toMatch(/^USER (root|0)\b/m);
  });

  it("leaves the app's code owned by root and hands node only uploads and Next's cache", () => {
    expect(runner).toContain("COPY --from=build /app ./");
    expect(runner).not.toMatch(/COPY --from=build --chown/);
    expect(runner).toContain("chown -R node:node /app/storage /app/.next/cache");
    expect(runner).not.toMatch(/chown -R node:node \/app(\s|$)/m);
  });
});

describe("docker-entrypoint.sh checks what the node user needs (#1798)", () => {
  it("starts normally when the uploads folder and key file are usable", () => {
    const data = scratch();
    mkdirSync(path.join(data, "uploads", "event-1"), { recursive: true });
    writeFileSync(path.join(data, "uploads", "event-1", "banner.png"), "x");
    writeFileSync(path.join(data, "key"), "k", { mode: 0o400 });
    const { status, stdout, calls } = run({ ASSET_STORAGE_DIR: path.join(data, "uploads"), SECRET_ENCRYPTION_KEY_FILE: path.join(data, "key") });
    expect(status).toBe(0);
    expect(stdout).toContain("app-started");
    expect(calls).toContain("npx prisma migrate deploy");
  });

  it.skipIf(asRoot)("stops before any migration when a folder in uploads is not writable", () => {
    const data = scratch();
    const folder = path.join(data, "uploads", "event-1");
    mkdirSync(folder, { recursive: true });
    chmodSync(folder, 0o555);
    const { status, stderr, stdout, calls } = run({ ASSET_STORAGE_DIR: path.join(data, "uploads") });
    expect(status).toBe(78);
    expect(stderr).toContain("uploads folder");
    expect(stderr).toContain("Running as the node user");
    expect(stdout).not.toContain("app-started");
    expect(calls).toBe("");
  });

  it.skipIf(asRoot)("stops when an uploaded file is not readable", () => {
    const data = scratch();
    mkdirSync(path.join(data, "uploads"), { recursive: true });
    writeFileSync(path.join(data, "uploads", "banner.png"), "x");
    chmodSync(path.join(data, "uploads", "banner.png"), 0o000);
    const { status, calls } = run({ ASSET_STORAGE_DIR: path.join(data, "uploads"), IMSDA_SKIP_DB_PREP: "1" });
    expect(status).toBe(78);
    expect(calls).toBe("");
  });

  it.skipIf(asRoot).each(["SECRET_ENCRYPTION_KEY_FILE", "SECRET_ENCRYPTION_PREVIOUS_KEY_FILE"])("stops when the file named by %s is not readable, without printing it", (variable) => {
    const data = scratch();
    writeFileSync(path.join(data, "key"), "synthetic-key-value");
    chmodSync(path.join(data, "key"), 0o000);
    const { status, stderr, stdout, calls } = run({ [variable]: path.join(data, "key"), IMSDA_PREP_ONLY: "1" });
    expect(status).toBe(78);
    expect(stderr).toContain(variable);
    expect(`${stderr}${stdout}`).not.toContain("synthetic-key-value");
    expect(calls).toBe("");
  });

  it("names the same key file variables the app reads", () => {
    const env = readFileSync(path.join(root, "lib/env.ts"), "utf8");
    const script = readFileSync(entrypoint, "utf8");
    for (const variable of ["SECRET_ENCRYPTION_KEY_FILE", "SECRET_ENCRYPTION_PREVIOUS_KEY_FILE"]) {
      expect(env).toContain(variable);
      expect(script).toContain(variable);
    }
  });
});
