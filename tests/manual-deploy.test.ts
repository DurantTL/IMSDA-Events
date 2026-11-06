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
  exec)
    case "$*" in *printenv*) printf '%s' "$FAKE_TOKEN"; exit 0 ;; esac ;;
  inspect)
    case "$*" in
      *State.Running*) echo "$FAKE_RUNNING" ;;
      *Config.Env*) printf '%s\\n' "$FAKE_ENV" ;;
      *) case " $FAKE_EXISTING " in *" $2 "*) exit 0 ;; *) exit 1 ;; esac ;;
    esac ;;
  run)
    case "$*" in *"--rm"*) exit "\${FAKE_PREFLIGHT_EXIT:-0}" ;; *) exit "\${FAKE_RUN_EXIT:-0}" ;; esac ;;
  start) exit "\${FAKE_START_EXIT:-0}" ;;
esac
exit 0
`;
// Like the real endpoint (#1400): the detail answers only to the bearer header on stdin (-H @-).
const sweepToken = "synthetic-sweep-token-0123456789-abcdefghij";
const fakeCurl = `#!/bin/sh
echo "curl $*" >> "$FAKE_DOCKER_LOG"
header="$(cat)"
[ "$header" = "Authorization: Bearer $FAKE_TOKEN" ] || exit 0
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
        IMSDA_ENV_FILE: path.join(runtime, ".env"),
        IMSDA_APP_CONTAINER: app,
        IMSDA_KEY_FILE: keyPath,
        IMSDA_HEALTH_TIMEOUT: "0",
        FAKE_DOCKER_LOG: log,
        FAKE_EXISTING: app,
        FAKE_RUNNING: "true",
        FAKE_TOKEN: sweepToken,
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

  // Key rotation (#1516): key files are named by version and never overwritten.
  function keyDir(files: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), "imsda-keys-"));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return dir;
  }

  it("picks the version-named key files from the versions in .env (key rotation, #1516)", () => {
    const dir = keyDir({ "secret-encryption-key": "old-key", "secret-encryption-key-v2": "new-key" });
    const { run } = setup(
      `${envWithoutKey}SECRET_ENCRYPTION_KEY_VERSION="2"\r\nSECRET_ENCRYPTION_PREVIOUS_KEY_VERSION=1 \n`,
    );
    const result = run([sha], { IMSDA_KEY_FILE: "", IMSDA_KEY_DIR: dir });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(
      new RegExp(`run -d .*source=${dir}/secret-encryption-key-v2,target=/run/secrets/encryption-key,readonly`),
    );
    expect(result.calls).toMatch(
      new RegExp(
        `run -d .*source=${dir}/secret-encryption-key,target=/run/secrets/encryption-key-previous,readonly -e SECRET_ENCRYPTION_PREVIOUS_KEY_FILE=/run/secrets/encryption-key-previous`,
      ),
    );
    expect(result.calls).not.toContain("old-key");
    expect(result.calls).not.toContain("new-key");
  });

  it("mounts no previous key without a previous version, and uses the version-1 file by default", () => {
    const dir = keyDir({ "secret-encryption-key": "old-key", "secret-encryption-key-v2": "new-key" });
    const { run } = setup(envWithoutKey);
    const result = run([sha], { IMSDA_KEY_FILE: "", IMSDA_KEY_DIR: dir });
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(new RegExp(`source=${dir}/secret-encryption-key,target=/run/secrets/encryption-key,`));
    expect(result.calls).not.toContain("SECRET_ENCRYPTION_PREVIOUS_KEY_FILE");
  });

  it("refuses a previous version whose key file is missing, before touching the running app", () => {
    const dir = keyDir({ "secret-encryption-key-v2": "new-key" });
    const { run } = setup(`${envWithoutKey}SECRET_ENCRYPTION_KEY_VERSION=2\nSECRET_ENCRYPTION_PREVIOUS_KEY_VERSION=1\n`);
    const result = run([sha], { IMSDA_KEY_FILE: "", IMSDA_KEY_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION=1 is set but");
    expect(result.calls).not.toMatch(/^stop /m);
  });

  it("refuses a key version that is not a whole number from 1", () => {
    const { run } = setup(`${envWithoutKey}SECRET_ENCRYPTION_KEY_VERSION=0\n`, "k");
    const result = run([sha]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be a whole number from 1");
  });

  it("still rolls back to the old container during a rotation, since its key file is untouched", () => {
    const dir = keyDir({ "secret-encryption-key": "old-key", "secret-encryption-key-v2": "new-key" });
    const { run } = setup(`${envWithoutKey}SECRET_ENCRYPTION_KEY_VERSION=2\nSECRET_ENCRYPTION_PREVIOUS_KEY_VERSION=1\n`);
    const result = run([sha], { IMSDA_KEY_FILE: "", IMSDA_KEY_DIR: dir, FAKE_RUN_EXIT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rolled back to the previous container");
    expect(result.calls).toMatch(new RegExp(`^start ${app}$`, "m"));
  });

  it("says the site is down when the rolled-back container will not start", () => {
    const { run } = setup(envWithoutKey, "k");
    const result = run([sha], { FAKE_RUN_EXIT: "1", FAKE_START_EXIT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("the site is down");
  });

  it("refuses a previous key in both .env and its file", () => {
    const dir = keyDir({ "secret-encryption-key": "old-key", "secret-encryption-key-v2": "new-key" });
    const { run } = setup(
      `${envWithoutKey}SECRET_ENCRYPTION_KEY_VERSION=2\nSECRET_ENCRYPTION_PREVIOUS_KEY_VERSION=1\nSECRET_ENCRYPTION_PREVIOUS_KEY=y\n`,
    );
    const result = run([sha], { IMSDA_KEY_FILE: "", IMSDA_KEY_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SECRET_ENCRYPTION_PREVIOUS_KEY is in");
  });

  it("sends the sweep token to the health URL on stdin, never on the command line", () => {
    const { run } = setup(envWithoutKey, "k");
    const result = run([sha]);
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(/^curl .*-H @- /m);
    expect(result.calls).not.toContain(sweepToken);
    expect(result.stdout).not.toContain(sweepToken);
  });

  it("reads the token from the new container and sends a quoted value verbatim", () => {
    const { run } = setup(envWithoutKey, "k");
    const quoted = `"${sweepToken}"`;
    const result = run([sha], { FAKE_TOKEN: quoted });
    expect(result.status).toBe(0);
    expect(result.calls).toContain(`exec ${app} printenv OUTBOX_SWEEP_TOKEN`);
    expect(result.calls).not.toContain(sweepToken);
  });

  it("rolls back, without calling the endpoint or printing a token, when the container has none", () => {
    const { run } = setup(envWithKey);
    const result = run([sha], { FAKE_TOKEN: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rolled back");
    expect(result.calls).not.toMatch(/^curl /m);
    expect(`${result.stdout}${result.stderr}${result.calls}`).not.toContain(sweepToken);
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
