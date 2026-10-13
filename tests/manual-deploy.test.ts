import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts/manual-deploy.sh");
const sha = "a".repeat(40);
const app = "xcloud-site-1-app-1";

// Stand-ins for docker and curl. docker logs every call; `inspect` answers from
// FAKE_EXISTING (space-separated names), FAKE_RUNNING and FAKE_ENV.
const fakeDocker = `#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  inspect)
    case "$*" in
      *State.Running*) echo "$FAKE_RUNNING" ;;
      *Config.Env*) printf '%s\\n' "$FAKE_ENV" ;;
      *) case " $FAKE_EXISTING " in *" $2 "*) exit 0 ;; *) exit 1 ;; esac ;;
    esac ;;
  run)
    case "$*" in *"--rm"*) exit "\${FAKE_PREFLIGHT_EXIT:-0}" ;; esac ;;
esac
exit 0
`;
const fakeCurl = `#!/bin/sh
printf '%s' "$FAKE_HEALTH"
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(envFile: string, keyFile?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "manual-deploy-"));
  dirs.push(dir);
  const runtime = path.join(dir, "runtime");
  const bin = path.join(dir, "bin");
  mkdirSync(runtime);
  mkdirSync(bin);
  writeFileSync(path.join(runtime, ".env"), envFile);
  const keyPath = path.join(dir, "key");
  if (keyFile !== undefined) writeFileSync(keyPath, keyFile);
  for (const [name, body] of [["docker", fakeDocker], ["curl", fakeCurl], ["sleep", "#!/bin/sh\n"]]) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(dir, "docker.log");
  writeFileSync(log, "");

  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        IMSDA_DEPLOY_ALLOW_NON_ROOT: "1",
        IMSDA_XCLOUD_RUNTIME_DIR: runtime,
        IMSDA_APP_CONTAINER: app,
        IMSDA_KEY_FILE: keyPath,
        IMSDA_HEALTH_TIMEOUT: "0",
        FAKE_DOCKER_LOG: log,
        FAKE_EXISTING: app,
        FAKE_RUNNING: "true",
        FAKE_HEALTH: `{"status":"ok","release":{"sha":"${sha}"}}`,
        ...env,
      },
    });
    return { ...result, calls: readFileSync(log, "utf8") };
  };
  return { run };
}

const envWithKey = "DATABASE_URL=postgresql://u:p@db/app\nSECRET_ENCRYPTION_KEY=x\n";
const envWithoutKey = "DATABASE_URL=postgresql://u:p@db/app\n";

describe("manual-deploy.sh", () => {
  it("needs a full commit sha", () => {
    const { run } = setup(envWithKey);
    const result = run(["abc123"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("usage");
  });

  it("refuses when the key is in both .env and the key file", () => {
    const { run } = setup(envWithKey, "k");
    const result = run([sha]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Finish the move");
    expect(result.calls).not.toContain("stop");
  });

  it("refuses when there is no key anywhere", () => {
    const { run } = setup(envWithoutKey);
    const result = run([sha]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no encryption key");
  });

  it("leaves the running app alone when the environment check fails", () => {
    const { run } = setup(envWithKey);
    const result = run([sha], { FAKE_PREFLIGHT_EXIT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Nothing was changed");
    expect(result.calls).not.toMatch(/^stop /m);
  });

  it("swaps in the new container with the key file mounted", () => {
    const { run } = setup(envWithoutKey, "k");
    const result = run([sha]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.calls).toContain(`pull ghcr.io/duranttl/imsda-events:${sha}`);
    expect(result.calls).toContain(`rename ${app} ${app}-old`);
    expect(result.calls).toMatch(/run -d --name xcloud-site-1-app-1 .*SECRET_ENCRYPTION_KEY_FILE=\/run\/secrets\/encryption-key/);
    expect(result.calls).toMatch(/run -d .*imsda_events_assets:\/app\/storage\/event-assets/);
    expect(result.calls).toContain(`network connect postgresql_9kgaw_239292_xcloud-network ${app}`);
  });

  it("rolls back to the old container when the new one never reports healthy", () => {
    const { run } = setup(envWithKey);
    const result = run([sha], { FAKE_HEALTH: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rolled back");
    expect(result.calls).toContain(`rename ${app}-old ${app}`);
    expect(result.calls).toMatch(new RegExp(`^start ${app}$`, "m"));
  });
});
