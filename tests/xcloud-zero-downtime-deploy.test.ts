import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #1263: deploys switch to the new version without stopping the site.
const root = process.cwd();
const deployScript = path.join(root, "deploy/xcloud/deploy.sh");
const entrypoint = path.join(root, "docker-entrypoint.sh");
const holdingServer = path.join(root, "deploy/startup-holding-server.mjs");
const sha = "b".repeat(40);

// docker logs every call with the prep/skip variables it was given.
const fakeDocker = `#!/bin/sh
echo "$* prep=\${IMSDA_PREP_ONLY:-} skip=\${IMSDA_SKIP_DB_PREP:-}" >> "$FAKE_LOG"
case "$1" in
  image) exit 0 ;;
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
      FAKE_LOG: ctx.log,
      ...env,
    },
  });
  return { ...result, calls: readFileSync(ctx.log, "utf8").trim().split("\n") };
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
    const { status, calls, stderr } = runDeploy({ FAKE_SHA_8101: "c".repeat(40), FAKE_SHA_8100: "c".repeat(40) });
    expect(status).toBe(1);
    expect(stderr).toContain("live version was not changed");
    expect(calls.some((c) => c.includes("imsda-events:live") && c.startsWith("tag"))).toBe(false);
    expect(calls.some((c) => c.includes(" app"))).toBe(false);
  });

  it("stops before starting anything when the migrations fail", () => {
    const { status, calls } = runDeploy({ FAKE_PREP_EXIT: "1", FAKE_SHA_8101: sha, FAKE_SHA_8100: sha });
    expect(status).not.toBe(0);
    expect(calls.some((c) => c.includes("up -d"))).toBe(false);
  });

  it("puts the previous image back when the live app does not come up on the new SHA", () => {
    const { status, calls } = runDeploy({ FAKE_SHA_8101: sha, FAKE_SHA_8100: "c".repeat(40) });
    expect(status).toBe(1);
    expect(calls).toContain("tag imsda-events:previous imsda-events:live prep= skip=");
    expect(calls.at(-2)).toContain("up -d --no-deps app prep= skip=");
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
