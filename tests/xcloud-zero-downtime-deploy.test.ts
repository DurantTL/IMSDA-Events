import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #1263: deploys switch to the new version without stopping the site.
const root = process.cwd();
const deployScript = path.join(root, "deploy/xcloud/deploy.sh");
const autodeployScript = path.join(root, "deploy/xcloud/autodeploy.sh");
const entrypoint = path.join(root, "docker-entrypoint.sh");
const holdingServer = path.join(root, "deploy/startup-holding-server.mjs");
const sha = "b".repeat(40);

// docker logs every call with the prep/skip variables it was given.
const fakeDocker = `#!/bin/sh
echo "$* prep=\${IMSDA_PREP_ONLY:-} skip=\${IMSDA_SKIP_DB_PREP:-}" >> "$FAKE_LOG"
case "$1" in
  image) case "$*" in *--format*) echo "\${FAKE_PREVIOUS:-}" ;; esac; exit 0 ;;
  run) exit "\${FAKE_LEGACY_EXIT:-0}" ;;
  compose) case "$*" in *" run "*) exit "\${FAKE_PREP_EXIT:-0}" ;; esac ;;
esac
exit 0
`;
// curl answers /api/health with FAKE_SHA_<port>.
const fakeCurl = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *:8101/*) printf '{"release":{"sha":"%s"}}' "$FAKE_SHA_8101" ;;
    *:8100/*) printf '{"release":{"sha":"%s"}}' "$FAKE_SHA_8100" ;;
  esac
done
`;
const fakeGit = `#!/bin/sh
echo "${sha}"
`;
const fakeSleep = "#!/bin/sh\nexit 0\n";
const logger = (name: string) => `#!/bin/sh\necho "${name} $*" >> "$FAKE_LOG"\n`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(tools: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "zero-downtime-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const compose = path.join(dir, "docker-compose.yml");
  writeFileSync(compose, "image: imsda-events:live\n");
  return { dir, bin, compose, log: path.join(dir, "log") };
}

function runDeploy(env: Record<string, string>) {
  const ctx = setup({ docker: fakeDocker, curl: fakeCurl, git: fakeGit, sleep: fakeSleep });
  writeFileSync(ctx.log, "");
  const result = spawnSync("sh", [deployScript], {
    encoding: "utf8",
    env: {
      PATH: `${ctx.bin}:/usr/bin:/bin`,
      IMSDA_LOCK_HELD: "1",
      XCLOUD_SITE_PATH: ctx.dir,
      XCLOUD_COMPOSE_FILE: ctx.compose,
      IMSDA_HEALTH_WAIT_SECONDS: "6",
      IMSDA_CLEANUP: "/nonexistent",
      IMSDA_FAILED_SHA_FILE: path.join(ctx.dir, "failed-sha"),
      FAKE_PREVIOUS: "c".repeat(40),
      FAKE_LOG: ctx.log,
      ...env,
    },
  });
  const failedFile = path.join(ctx.dir, "failed-sha");
  const failed = existsSync(failedFile) ? readFileSync(failedFile, "utf8").trim() : null;
  return { ...result, failed, calls: readFileSync(ctx.log, "utf8").trim().split("\n") };
}

describe("deploy.sh zero-downtime switch", () => {
  it("prepares the database and proves the new version on 8101 before touching the live app", () => {
    const { status, calls } = runDeploy({ FAKE_SHA_8101: sha, FAKE_SHA_8100: sha });
    expect(status).toBe(0);
    const prep = calls.findIndex((c) => c.includes("compose") && c.includes(" run ") && c.includes("prep=1"));
    const standby = calls.findIndex((c) => c.includes("up -d --no-deps standby") && c.includes("skip=1"));
    const liveTag = calls.findIndex((c) => c.startsWith(`tag ghcr.io/duranttl/imsda-events:${sha} imsda-events:live`));
    const app = calls.findIndex((c) => c.includes("up -d --no-deps app") && c.includes("skip=1"));
    const removed = calls.findIndex((c, index) => c.includes("rm -sf standby") && index > app);
    expect(prep).toBeGreaterThan(-1);
    expect(standby).toBeGreaterThan(prep);
    expect(liveTag).toBeGreaterThan(standby);
    expect(app).toBeGreaterThan(liveTag);
    expect(removed).toBeGreaterThan(app);
  });

  it("leaves the live version alone when the new version never reports its SHA", () => {
    const { status, calls, stderr, failed } = runDeploy({ FAKE_SHA_8101: "c".repeat(40), FAKE_SHA_8100: "c".repeat(40) });
    expect(status).toBe(1);
    expect(stderr).toContain("live app was not restarted");
    expect(failed).toBe(sha);
    expect(calls.some((c) => c.includes("imsda-events:live") && c.startsWith("tag"))).toBe(false);
    expect(calls.some((c) => c.includes(" app"))).toBe(false);
  });

  it("stops before starting anything when the migrations fail", () => {
    const { status, calls, stderr } = runDeploy({ FAKE_PREP_EXIT: "1", FAKE_SHA_8101: sha, FAKE_SHA_8100: sha });
    expect(status).toBe(1);
    expect(stderr).toContain("Migrations or syncs");
    expect(calls.some((c) => c.includes("up -d"))).toBe(false);
  });

  it("puts the previous image back when the live app does not come up on the new SHA", () => {
    const { status, calls } = runDeploy({ FAKE_SHA_8101: sha, FAKE_SHA_8100: "c".repeat(40) });
    expect(status).toBe(1);
    expect(calls).toContain("tag imsda-events:previous imsda-events:live prep= skip=");
    // The previous version restarts without re-running the preparation, and
    // the standby is removed only after that.
    const rollback = calls.findIndex((c, index) => c.includes("up -d --no-deps app") && index > calls.indexOf("tag imsda-events:previous imsda-events:live prep= skip="));
    expect(calls[rollback]).toContain("skip=1");
    expect(calls.findIndex((c, index) => c.includes("rm -sf standby") && index > rollback)).toBeGreaterThan(rollback);
  });

  it("clears the failed marker after a successful deploy", () => {
    expect(runDeploy({ FAKE_SHA_8101: sha, FAKE_SHA_8100: sha }).failed).toBeNull();
  });

  it("stops without changing anything when Docker cannot inspect the image", () => {
    const { status, calls, stderr } = runDeploy({ FAKE_LEGACY_EXIT: "125", FAKE_SHA_8101: sha, FAKE_SHA_8100: sha });
    expect(status).toBe(1);
    expect(stderr).toContain("Could not inspect");
    expect(calls.some((c) => c.includes("up -d") || c.includes("imsda-events:live"))).toBe(false);
  });

  it("runs the preparation without a terminal so a deploy from SSH cannot stall", () => {
    const { calls } = runDeploy({ FAKE_SHA_8101: sha, FAKE_SHA_8100: sha });
    expect(calls.find((c) => c.includes("compose") && c.includes(" run "))).toContain("run -T --rm --no-deps --name imsda-prep standby");
  });

  it("switches an image built before #1263 the old way instead of hanging on its prep run", () => {
    const { status, calls } = runDeploy({ FAKE_LEGACY_EXIT: "1", FAKE_SHA_8101: sha, FAKE_SHA_8100: sha });
    expect(status).toBe(0);
    expect(calls.some((c) => c.includes(" run ") && c.includes("compose"))).toBe(false);
    expect(calls.some((c) => c.includes("standby"))).toBe(false);
    expect(calls.some((c) => c.includes("up -d --no-deps app"))).toBe(true);
  });
});

describe("autodeploy.sh night window", () => {
  // git logs every call; rev-parse answers FAKE_ORIGIN. docker answers the live
  // label from FAKE_LIVE and pulls succeed unless FAKE_PULL_EXIT is set.
  const autoGit = `#!/bin/sh
echo "git $*" >> "$FAKE_LOG"
case "$*" in *rev-parse*) echo "$FAKE_ORIGIN" ;; *fetch*) exit "\${FAKE_FETCH_EXIT:-0}" ;; esac
exit 0
`;
  const autoDocker = `#!/bin/sh
echo "docker $*" >> "$FAKE_LOG"
case "$1" in
  image) echo "$FAKE_LIVE" ;;
  pull) exit "\${FAKE_PULL_EXIT:-0}" ;;
esac
exit 0
`;
  const fakeDate = `#!/bin/sh
echo "$TZ" > "$FAKE_LOG.tz"
echo "$FAKE_HOUR"
`;

  function runAutodeploy(env: Record<string, string>) {
    const ctx = setup({ git: autoGit, docker: autoDocker, date: fakeDate, "imsda-deploy": logger("imsda-deploy") });
    writeFileSync(ctx.log, "");
    writeFileSync(`${ctx.log}.tz`, "");
    const result = spawnSync("sh", [autodeployScript], {
      encoding: "utf8",
      env: {
        PATH: `${ctx.bin}:/usr/bin:/bin`,
        XCLOUD_SITE_PATH: ctx.dir,
        IMSDA_DEPLOY: path.join(ctx.bin, "imsda-deploy"),
        FAKE_LOG: ctx.log,
        FAKE_ORIGIN: sha,
        FAKE_LIVE: "c".repeat(40),
        IMSDA_FAILED_SHA_FILE: path.join(ctx.dir, "failed-sha"),
        ...env,
      },
    });
    return { ...result, calls: readFileSync(ctx.log, "utf8"), tz: readFileSync(`${ctx.log}.tz`, "utf8").trim() };
  }

  it("fetches origin/main and deploys a published commit inside the window, moving the checkout only then", () => {
    const { status, calls, tz } = runAutodeploy({ FAKE_HOUR: "02" });
    expect(status).toBe(0);
    expect(tz).toBe("America/Chicago");
    expect(calls).toContain("fetch --quiet origin main");
    expect(calls).toContain(`docker pull --quiet ghcr.io/duranttl/imsda-events:${sha}`);
    expect(calls.indexOf("merge --ff-only --quiet origin/main")).toBeLessThan(calls.indexOf("imsda-deploy"));
    expect(calls).toContain("imsda-deploy");
  });

  it.each(["05", "08", "13", "23"])("waits outside the default window (hour %s) without touching the checkout", (hour) => {
    const { status, calls } = runAutodeploy({ FAKE_HOUR: hour });
    expect(status).toBe(0);
    expect(calls).not.toContain("merge");
    expect(calls).not.toContain("imsda-deploy");
  });

  it("honours a custom window", () => {
    expect(runAutodeploy({ FAKE_HOUR: "09", IMSDA_DEPLOY_WINDOW: "08-10" }).calls).toContain("imsda-deploy");
  });

  it("supports a window that crosses midnight", () => {
    expect(runAutodeploy({ FAKE_HOUR: "23", IMSDA_DEPLOY_WINDOW: "22-02" }).calls).toContain("imsda-deploy");
    expect(runAutodeploy({ FAKE_HOUR: "01", IMSDA_DEPLOY_WINDOW: "22-02" }).calls).toContain("imsda-deploy");
    expect(runAutodeploy({ FAKE_HOUR: "03", IMSDA_DEPLOY_WINDOW: "22-02" }).calls).not.toContain("imsda-deploy");
  });

  it("does not retry a commit that already failed to deploy", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "failed-sha-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "failed-sha"), `${sha}\n`);
    const { calls } = runAutodeploy({ FAKE_HOUR: "02", IMSDA_FAILED_SHA_FILE: path.join(dir, "failed-sha") });
    expect(calls).not.toContain("imsda-deploy");
  });

  it("does nothing when origin/main is already live", () => {
    const { calls } = runAutodeploy({ FAKE_HOUR: "02", FAKE_LIVE: sha });
    expect(calls).not.toContain("merge");
    expect(calls).not.toContain("imsda-deploy");
  });

  it("waits when the image is not published yet", () => {
    const { status, calls } = runAutodeploy({ FAKE_HOUR: "02", FAKE_PULL_EXIT: "1" });
    expect(status).toBe(0);
    expect(calls).not.toContain("merge");
    expect(calls).not.toContain("imsda-deploy");
  });

  it("skips the run when the fetch fails", () => {
    const { status, calls } = runAutodeploy({ FAKE_HOUR: "02", FAKE_FETCH_EXIT: "1" });
    expect(status).toBe(0);
    expect(calls).not.toContain("imsda-deploy");
  });
});

describe("docker-entrypoint.sh preparation modes", () => {
  function runEntrypoint(env: Record<string, string>) {
    const ctx = setup({ npx: logger("npx"), npm: logger("npm") });
    writeFileSync(ctx.log, "");
    const result = spawnSync("sh", [entrypoint, "echo", "app-started"], {
      encoding: "utf8",
      env: { PATH: `${ctx.bin}:/usr/bin:/bin`, FAKE_LOG: ctx.log, ...env },
    });
    return { ...result, calls: readFileSync(ctx.log, "utf8").trim() };
  }

  it("skips migrations and syncs when the deploy already ran them", () => {
    const { status, stdout, calls } = runEntrypoint({ IMSDA_SKIP_DB_PREP: "1" });
    expect(status).toBe(0);
    expect(stdout).toContain("app-started");
    expect(calls).toBe("");
  });

  it("runs only the preparation in prep-only mode and never starts the app", () => {
    const { status, stdout, calls } = runEntrypoint({ IMSDA_PREP_ONLY: "1" });
    expect(status).toBe(0);
    expect(stdout).not.toContain("app-started");
    expect(calls).toContain("npx prisma migrate deploy");
    expect(calls).toContain("npm run event-content:sync");
  });

  it("still prepares and starts by default", () => {
    const { status, stdout, calls } = runEntrypoint({});
    expect(status).toBe(0);
    expect(stdout).toContain("app-started");
    expect(calls).toContain("npx prisma migrate deploy");
  });
});

describe("startup holding server", () => {
  it("answers /api/* with a 503 JSON updating message while the app starts", async () => {
    const port = 39_000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [holdingServer], { env: { ...process.env, PORT: String(port) } });
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 50 && !response; attempt += 1) {
        response = await fetch(`http://127.0.0.1:${port}/api/registrations`, { method: "POST" }).catch(() => null);
        if (!response) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(response?.status).toBe(503);
      expect(response?.headers.get("retry-after")).toBe("15");
      expect(await response?.json()).toEqual({
        code: "UPDATING",
        message: "The site is updating. Your answers are still here — try again in a minute.",
      });
      const page = await fetch(`http://127.0.0.1:${port}/events`);
      expect(page.status).toBe(503);
      expect(page.headers.get("content-type")).toContain("text/html");
    } finally {
      child.kill("SIGTERM");
    }
  });
});
