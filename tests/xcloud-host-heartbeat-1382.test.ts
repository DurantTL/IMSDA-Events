import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #1382: host jobs report one heartbeat per run, and a heartbeat can never fail or block a job.
const root = process.cwd();
const heartbeatScript = path.join(root, "deploy/xcloud/heartbeat.sh");
const autodeployScript = path.join(root, "deploy/xcloud/autodeploy.sh");
const cleanupScript = path.join(root, "deploy/xcloud/cleanup.sh");
const installerScript = path.join(root, "scripts/install-xcloud-runtime-guard.sh");
const sha = "b".repeat(40);
const token = "synthetic-heartbeat-token-0123456789abcdef";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(tools: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "heartbeat-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(dir, "log");
  writeFileSync(log, "");
  return { dir, bin, log };
}

// A curl stand-in: records its arguments and stdin, answers with FAKE_STATUS.
const fakeCurl = `#!/bin/sh
echo "ARGS: $*" >> "$FAKE_LOG"
cat >> "$FAKE_LOG.stdin"
printf '%s' "\${FAKE_STATUS:-200}"
`;

describe("heartbeat.sh", () => {
  function run(args: string[], env: Record<string, string>, tools: Record<string, string> = { curl: fakeCurl }) {
    const ctx = setup(tools);
    writeFileSync(`${ctx.log}.stdin`, "");
    const envFile = path.join(ctx.dir, "heartbeat.env");
    writeFileSync(envFile, `IMSDA_HEARTBEAT_TOKEN=${token}\n`);
    const result = spawnSync("sh", [heartbeatScript, ...args], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${ctx.bin}:/usr/bin:/bin`, IMSDA_HEARTBEAT_ENV_FILE: envFile, FAKE_LOG: ctx.log, ...env },
    });
    return {
      ...result,
      out: `${result.stdout}${result.stderr}`,
      args: readFileSync(ctx.log, "utf8"),
      stdin: readFileSync(`${ctx.log}.stdin`, "utf8"),
    };
  }

  it("posts the JSON it builds, with the token on stdin only, and prints one line without the token or URL", () => {
    const result = run(["server-docker-cleanup", "SUCCEEDED", "result=cleaned", "diskUsedAfterPct=71", "imagesRemoved=4"], {});
    expect(result.status).toBe(0);
    expect(result.out.trim()).toBe("[heartbeat] server-docker-cleanup SUCCEEDED recorded");
    expect(result.args).toContain('"job":"server-docker-cleanup"');
    expect(result.args).toContain('"summary":{"result":"cleaned","diskUsedAfterPct":71,"imagesRemoved":4}');
    expect(result.args).toContain("--connect-timeout 2");
    expect(result.args).toContain("--max-time 5");
    expect(result.args).toContain("http://127.0.0.1:8100/api/internal/system-jobs/heartbeat");
    expect(result.args).not.toContain(token);
    expect(result.stdin).toContain(`Authorization: Bearer ${token}`);
  });

  it("reports a rejected status in one line and still exits 0", () => {
    const result = run(["server-runtime-guard", "FAILED", "result=failed"], { FAKE_STATUS: "401" });
    expect(result.status).toBe(0);
    expect(result.out.trim()).toBe("[heartbeat] server-runtime-guard FAILED not recorded (status 401)");
  });

  it("exits 0 with one line and sends nothing when there is no token", () => {
    const result = run(["server-autodeploy", "SUCCEEDED", "result=deployed"], { IMSDA_HEARTBEAT_ENV_FILE: "/nonexistent/file" });
    expect(result.status).toBe(0);
    expect(result.out.trim().split("\n")).toHaveLength(1);
    expect(result.args).toBe("");
  });

  it.each(["https://events.imsda.org/api/internal/system-jobs/heartbeat", "http://example.com:8100/x", "http://127.0.0.1.evil.test/x", "http://127.0.0.1:8100@other.host/x", "http://localhost:80@other.host/", "http://127.0.0.1:81x/y", "http://127.0.0.1:/x"])(
    "refuses a non-loopback address (%s) and never prints it",
    (url) => {
      const result = run(["server-autodeploy", "SUCCEEDED", "result=deployed"], { IMSDA_HEARTBEAT_URL: url });
      expect(result.status).toBe(0);
      expect(result.args).toBe("");
      expect(result.out).not.toContain(url);
      expect(result.out).not.toContain(token);
    },
  );

  it.each([
    ["a key with a symbol", ["result=ok", "bad;key=1"]],
    ["a value with a quote", ["result=o\"k"]],
    ["an uppercase word value", ["result=OK"]],
    ["no equals sign", ["result"]],
    ["an empty value", ["result="]],
    ["a leading-zero number", ["imagesRemoved=007"]],
  ])("sends nothing for %s, and exits 0", (_name, pairs) => {
    const result = run(["server-runtime-guard", "SUCCEEDED", ...pairs], {});
    expect(result.status).toBe(0);
    expect(result.args).toBe("");
    expect(result.out).not.toContain(token);
  });

  it("exits 0 with bad arguments and with no arguments", () => {
    expect(run(["server-autodeploy", "MAYBE"], {}).status).toBe(0);
    expect(run([], {}).status).toBe(0);
  });

  it("exits 0 when curl fails, when nothing listens, and when curl is missing", () => {
    const failing = run(["server-autodeploy", "SUCCEEDED", "result=deployed"], {}, { curl: "#!/bin/sh\nexit 7\n" });
    expect(failing.status).toBe(0);
    expect(failing.out).toContain("not recorded");
    // The real curl against a port nothing listens on.
    const unreachable = run(["server-autodeploy", "SUCCEEDED", "result=deployed"], { IMSDA_HEARTBEAT_URL: "http://127.0.0.1:1/x" }, {});
    expect(unreachable.status).toBe(0);
    expect(unreachable.out.trim()).toMatch(/^\[heartbeat\] server-autodeploy SUCCEEDED not recorded/);
    expect(unreachable.out).not.toContain(token);
  });
});

describe("autodeploy.sh heartbeats", () => {
  const autoGit = `#!/bin/sh
echo "git $*" >> "$FAKE_LOG"
case "$*" in *rev-parse*) echo "$FAKE_ORIGIN" ;; *fetch*) exit "\${FAKE_FETCH_EXIT:-0}" ;; *merge*) exit "\${FAKE_MERGE_EXIT:-0}" ;; esac
exit 0
`;
  const autoDocker = `#!/bin/sh
case "$1" in
  image) echo "$FAKE_LIVE" ;;
  pull) exit "\${FAKE_PULL_EXIT:-0}" ;;
esac
exit 0
`;
  const fakeDate = `#!/bin/sh\necho "$FAKE_HOUR"\n`;
  const fakeDeploy = `#!/bin/sh\necho "imsda-deploy" >> "$FAKE_LOG"\nexit "\${FAKE_DEPLOY_EXIT:-0}"\n`;
  const fakeHeartbeat = `#!/bin/sh\necho "heartbeat $*" >> "$FAKE_LOG"\nexit "\${FAKE_HEARTBEAT_EXIT:-0}"\n`;

  function run(env: Record<string, string>, withHeartbeat = true) {
    const ctx = setup({ git: autoGit, docker: autoDocker, date: fakeDate, "imsda-deploy": fakeDeploy, "imsda-heartbeat": fakeHeartbeat });
    const failedFile = path.join(ctx.dir, "failed-sha");
    const result = spawnSync("sh", [autodeployScript], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${ctx.bin}:/usr/bin:/bin`,
        XCLOUD_SITE_PATH: ctx.dir,
        IMSDA_DEPLOY: path.join(ctx.bin, "imsda-deploy"),
        IMSDA_HEARTBEAT: withHeartbeat ? path.join(ctx.bin, "imsda-heartbeat") : path.join(ctx.dir, "missing"),
        IMSDA_FAILED_SHA_FILE: failedFile,
        FAKE_LOG: ctx.log,
        FAKE_ORIGIN: sha,
        FAKE_LIVE: "c".repeat(40),
        FAKE_HOUR: "02",
        ...env,
      },
    });
    const calls = readFileSync(ctx.log, "utf8");
    return { status: result.status, calls, beats: calls.split("\n").filter((line) => line.startsWith("heartbeat ")), dir: ctx.dir, failedFile };
  }

  it.each([
    ["deploys", {}, 0, "SUCCEEDED result=deployed"],
    ["is up to date", { FAKE_LIVE: sha }, 0, "SUCCEEDED result=up-to-date"],
    ["is outside the window", { FAKE_HOUR: "13" }, 0, "SUCCEEDED result=outside-window"],
    ["is waiting for the image", { FAKE_PULL_EXIT: "1" }, 0, "SUCCEEDED result=image-pending"],
    ["cannot fetch", { FAKE_FETCH_EXIT: "1" }, 0, "FAILED result=fetch-failed"],
    ["cannot fast-forward", { FAKE_MERGE_EXIT: "1" }, 1, "FAILED result=fast-forward-failed"],
    ["fails to deploy", { FAKE_DEPLOY_EXIT: "3" }, 3, "FAILED result=deploy-failed"],
  ])("sends exactly one heartbeat when it %s, and keeps its exit code", (_name, env, status, beat) => {
    const result = run(env);
    expect(result.status).toBe(status);
    expect(result.beats).toEqual([`heartbeat server-autodeploy ${beat}`]);
  });

  it("reports a held failed commit", () => {
    const ctx = setup({});
    writeFileSync(path.join(ctx.dir, "failed-sha"), `${sha}\n`);
    const result = run({ IMSDA_FAILED_SHA_FILE: path.join(ctx.dir, "failed-sha") });
    expect(result.beats).toEqual(["heartbeat server-autodeploy FAILED result=failed-commit-held"]);
    expect(result.calls).not.toContain("imsda-deploy");
  });

  it("behaves the same with the heartbeat helper missing, or failing", () => {
    expect(run({}, false)).toMatchObject({ status: 0 });
    expect(run({}, false).calls).toContain("imsda-deploy");
    expect(run({ FAKE_DEPLOY_EXIT: "3" }, false).status).toBe(3);
    const failingHelper = run({ FAKE_HEARTBEAT_EXIT: "9" });
    expect(failingHelper.status).toBe(0);
    expect(failingHelper.calls).toContain("imsda-deploy");
  });
});

describe("cleanup.sh heartbeats", () => {
  // `docker image ls -q` answers a count that drops after the first call, like a real cleanup.
  const cleanupDocker = `#!/bin/sh
case "$*" in
  "image ls -q")
    n="$FAKE_LOG.count"
    if [ -e "$n" ]; then printf 'a\\nb\\n'; else printf 'a\\nb\\nc\\nd\\ne\\nf\\n'; : > "$n"; fi ;;
esac
exit 0
`;
  const dfByCall = `#!/bin/sh
n="$FAKE_LOG.df"
if [ -e "$n" ]; then pct=71; else pct=80; : > "$n"; fi
printf 'Filesystem Size Used Avail Use%% Mounted\\n/dev/x 100G 70G 30G %s%% /\\n' "$pct"
`;
  const fakeHeartbeat = `#!/bin/sh\necho "heartbeat $*" >> "$FAKE_LOG"\nexit 0\n`;

  function run(env: Record<string, string>, tools: Record<string, string> = {}, withHeartbeat = true) {
    const ctx = setup({ docker: cleanupDocker, df: dfByCall, "imsda-heartbeat": fakeHeartbeat, ...tools });
    const result = spawnSync("sh", [cleanupScript], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${ctx.bin}:/usr/bin:/bin`,
        IMSDA_HEARTBEAT: withHeartbeat ? path.join(ctx.bin, "imsda-heartbeat") : path.join(ctx.dir, "missing"),
        FAKE_LOG: ctx.log,
        ...env,
      },
    });
    const calls = readFileSync(ctx.log, "utf8");
    return { status: result.status, out: result.stdout, calls, beats: calls.split("\n").filter((line) => line.startsWith("heartbeat ")) };
  }

  it("reports cleaned with the disk percentages and images removed", () => {
    const result = run({ IMSDA_LOCK_HELD: "1" });
    expect(result.status).toBe(0);
    expect(result.beats).toEqual([
      "heartbeat server-docker-cleanup SUCCEEDED result=cleaned diskUsedBeforePct=80 diskUsedAfterPct=71 imagesRemoved=4",
    ]);
    expect(result.out).toContain("Disk before:");
    expect(result.out).toContain("Disk after:");
  });

  it("leaves the image count out when Docker does not answer, rather than reporting zero removed", () => {
    const downDocker = `#!/bin/sh\ncase "$*" in "image ls -q") exit 1 ;; esac\nexit 0\n`;
    const result = run({ IMSDA_LOCK_HELD: "1" }, { docker: downDocker });
    expect(result.status).toBe(0);
    expect(result.beats).toHaveLength(1);
    expect(result.beats[0]).toContain("result=cleaned");
    expect(result.beats[0]).not.toContain("imagesRemoved");
    expect(result.beats[0]).toContain("diskUsedAfterPct=71");
  });

  it("leaves a percentage out when df cannot be read", () => {
    const result = run({ IMSDA_LOCK_HELD: "1" }, { df: "#!/bin/sh\necho garbage\n" });
    expect(result.status).toBe(0);
    expect(result.beats[0]).not.toContain("diskUsed");
    expect(result.beats[0]).toContain("imagesRemoved=4");
  });

  it("still cleans and exits 0 with the heartbeat helper missing", () => {
    const result = run({ IMSDA_LOCK_HELD: "1" }, {}, false);
    expect(result.status).toBe(0);
    expect(result.out).toContain("Disk after:");
  });

  it("reports one skipped-lock-busy run (not a failure) from the outer lock branch and exits 0", () => {
    const result = run({ IMSDA_LOCK_FILE: "/nonexistent/lock" }, { flock: "#!/bin/sh\nexit 200\n" });
    expect(result.status).toBe(0);
    expect(result.beats).toEqual(["heartbeat server-docker-cleanup SUCCEEDED result=skipped-lock-busy"]);
  });

  it("does not add a second heartbeat in the outer branch after a real run", () => {
    // The stand-in flock runs the command it is given, as the real one does, so the inner run reports cleaned.
    const result = run({ IMSDA_LOCK_FILE: "/nonexistent/lock" }, { flock: '#!/bin/sh\nwhile [ "$1" != "/nonexistent/lock" ]; do shift; done; shift; exec "$@"\n' });
    expect(result.status).toBe(0);
    expect(result.beats).toHaveLength(1);
    expect(result.beats[0]).toContain("SUCCEEDED result=cleaned");
  });
});

describe("runtime guard installer", () => {
  const installer = readFileSync(installerScript, "utf8");
  const line = installer.split("\n").find((entry) => entry.startsWith("ExecStopPost="));

  it("adds an ExecStopPost that never fails the unit and escapes $ for systemd", () => {
    expect(line).toBeDefined();
    expect(line).toMatch(/^ExecStopPost=-\/bin\/sh -c '/);
    expect(line).not.toMatch(/(?<!\$)\$(?!\$)/);
  });

  function runStopPost(serviceResult: string, installed: boolean) {
    const ctx = setup({});
    // What systemd hands the shell: "$$" becomes "$"; the quoted program is the argument after "-c".
    const program = line!.replace(/^ExecStopPost=-\/bin\/sh -c '/, "").replace(/'$/, "").replaceAll("$$", "$");
    expect(program).not.toContain("sbin");
    const target = path.join(ctx.dir, "bin-heartbeat");
    const rewritten = program.replaceAll("/usr/local/bin/imsda-heartbeat", target);
    if (installed) {
      writeFileSync(target, `#!/bin/sh\necho "$*" >> "${ctx.log}"\n`);
      chmodSync(target, 0o755);
    }
    const result = spawnSync("sh", ["-c", rewritten], { encoding: "utf8", env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", SERVICE_RESULT: serviceResult } });
    return { status: result.status, calls: readFileSync(ctx.log, "utf8").trim() };
  }

  it("reports ok on success and failed otherwise, using /usr/local/bin/imsda-heartbeat", () => {
    expect(runStopPost("success", true)).toMatchObject({ status: 0, calls: "server-runtime-guard SUCCEEDED result=ok" });
    expect(runStopPost("exit-code", true)).toMatchObject({ status: 0, calls: "server-runtime-guard FAILED result=failed" });
  });

  it("does nothing when the helper is not installed", () => {
    expect(runStopPost("success", false)).toMatchObject({ status: 0, calls: "" });
  });
});
