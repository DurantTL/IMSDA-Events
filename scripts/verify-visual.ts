/**
 * Visual check (#1774): opens the key pages (scripts/visual/pages.ts) at 1280 and 390 px wide in a real browser, on the
 * seeded database with a fixed clock, and compares each picture with the saved baseline in tests/visual/baselines.
 * See docs/VISUAL-CHECK.md.
 *
 * LOCAL USE ONLY. It writes a few synthetic rows (ids start with "visualcheck_"), moves every database-written time back to
 * the fixed time, and mints sessions that skip the second factor. It refuses a non-local database or URL and a database that
 * is not a seeded dev or CI one. Use a freshly seeded throwaway database.
 *
 *   VISUAL_FIXED_NOW=2026-09-10T15:00:00Z NODE_OPTIONS="--require ./scripts/support/fixed-clock.cjs" npm run test:visual
 *   npm run test:visual -- --update          write or replace the baselines (and remove ones of pages no longer listed)
 *   npm run test:visual -- --only=club,area  only pages whose name contains one of these
 *
 * Unless VISUAL_BASE_URL is set, it starts the built app (`next start -p 3100`) with the same fixed clock and stops it at the end;
 * the app must be built first (`npm run build`, with the same fixed-clock environment).
 *
 * playwright-core is not a dependency; install it first with `npm i --no-save playwright-core@1.56.1` (or have `playwright`).
 *
 * Environment:
 *   VISUAL_FIXED_NOW  the fixed time; must equal VISUAL_FIXED_NOW in scripts/visual/pages.ts
 *   VISUAL_BASE_URL   use an app that is already running (it must run with the same fixed clock)
 *   VISUAL_OUT_DIR    before, after and difference pictures and report.json go here (default: a temp dir)
 *   VISUAL_BROWSER    path to a Chromium or Chrome executable (default: Playwright's)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "@prisma/client";
import { assertLocalDatabase, assertLocalUrl } from "./support/local-only-guard";
import { compareImages } from "./visual/compare";
import { VISUAL_FIXED_NOW, visualPages, visualWidths, type VisualPage, type VisualRole } from "./visual/pages";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;
type Browser = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const args = process.argv.slice(2);
const update = args.includes("--update");
const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",").map((part) => part.trim()).filter(Boolean) ?? [];
const startOwnApp = !process.env.VISUAL_BASE_URL;
const port = 3100;
const baseUrl = (process.env.VISUAL_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const outDir = process.env.VISUAL_OUT_DIR ?? mkdtempSync(path.join(tmpdir(), "visual-"));
const baselineDir = path.join(process.cwd(), "tests", "visual", "baselines");
const clockPreload = path.join(process.cwd(), "scripts", "support", "fixed-clock.cjs");

/** Window heights. The picture is the whole page, so this only decides how tall a "full screen" thing (a 100vh layout) is. */
const viewportHeights: Record<number, number> = { 1280: 800, 390: 844 };
/** A page taller than this is cut off here, so one very long list cannot make the pictures huge. */
const MAX_PICTURE_HEIGHT = 5000;
/** A picture is retaken until two in a row are identical, up to this many times, this far apart. */
const MAX_SHOT_TRIES = 4;
const SHOT_GAP_MS = 250;
/** Stops motion and the blinking caret, whatever the page's own CSS does. */
const calmCss = "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }";

type Outcome = { name: string; width: number; status: "same" | "different" | "new" | "updated" | "failed"; detail: string };
const outcomes: Outcome[] = [];

function assertFixedClock() {
  const clock = (globalThis as { __visualFixedClock?: { start: number } }).__visualFixedClock;
  if (!clock || clock.start !== Date.parse(VISUAL_FIXED_NOW)) {
    throw new Error(
      `The fixed clock is not on. Run it as:\n  VISUAL_FIXED_NOW=${VISUAL_FIXED_NOW} NODE_OPTIONS="--require ./scripts/support/fixed-clock.cjs" npm run test:visual\n` +
        "(the seed, the build and the app must start with the same two settings; see docs/VISUAL-CHECK.md).",
    );
  }
  if (process.env.VISUAL_FIXED_NOW !== VISUAL_FIXED_NOW) throw new Error(`VISUAL_FIXED_NOW must be ${VISUAL_FIXED_NOW}.`);
}

async function assertSeededDatabase(prisma: PrismaClient) {
  const wanted = [
    { where: { email: "admin@imsda-events.test" }, name: "admin@imsda-events.test" },
    { where: { email: "system@imsda-events.test" }, name: "system@imsda-events.test" },
    { where: { id: "usr_system_admin" }, name: "usr_system_admin" },
  ];
  const missing: string[] = [];
  for (const item of wanted) {
    if (!(await prisma.user.findFirst({ where: item.where, select: { id: true } }))) missing.push(item.name);
  }
  if (missing.length > 0) {
    throw new Error(`Refusing to write synthetic rows: this is not a seeded dev or CI database (missing ${missing.join(", ")}). Run \`npm run db:seed\` on a local database first.`);
  }
}

async function startApp(): Promise<ChildProcess> {
  if (!existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    throw new Error("There is no production build (.next/BUILD_ID). Run `npm run build` first, with VISUAL_FIXED_NOW set and the fixed-clock preload in NODE_OPTIONS.");
  }
  const preload = `--require ${clockPreload}`;
  const nodeOptions = [process.env.NODE_OPTIONS ?? "", process.env.NODE_OPTIONS?.includes("fixed-clock.cjs") ? "" : preload].join(" ").trim();
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    env: { ...process.env, VISUAL_FIXED_NOW, VISUAL_CLOCK_FROZEN: "1", NODE_OPTIONS: nodeOptions, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  let exited = false;
  child.on("exit", () => { exited = true; });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (exited) throw new Error(`The app stopped while starting:\n${log}`);
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status < 500) return child;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  child.kill();
  throw new Error(`The app did not start in 90 seconds:\n${log}`);
}

const cookieFor = async (prisma: PrismaClient, role: VisualRole, tokens: { staff: string[]; attendee: string[] }) => {
  const { visualAccounts } = await import("./support/visual-fixture");
  const staffSession = await import("../modules/access/session-store");
  const attendeeSession = await import("../modules/attendee-accounts/session-store");
  const { attendeeSessionCookie, staffSessionCookie } = await import("../modules/security/session-cookies");
  if (role === "attendee" || role === "director" || role === "area") {
    const session = await attendeeSession.createAttendeeSession(visualAccounts[role], null, { secondFactorVerifiedAt: new Date() });
    tokens.attendee.push(session.token);
    return { name: attendeeSessionCookie.legacyName, value: session.token, expires: Math.floor(session.expiresAt.getTime() / 1000) };
  }
  const email = role === "system-admin" ? "system@imsda-events.test" : "admin@imsda-events.test";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`The seeded account ${email} is missing. Run \`npm run db:seed\` first.`);
  const session = await staffSession.createDatabaseSession(user.id, null);
  tokens.staff.push(session.token);
  return { name: staffSessionCookie.legacyName, value: session.token, expires: Math.floor(session.expiresAt.getTime() / 1000) };
};

/** Waits for the shell's "Loading IMAdventist…" fallback to go away; true when it did. */
const waitForShell = (page: Page) =>
  page.waitForFunction(() => !document.querySelector(".shell-loading") && !/Loading IMAdventist/.test(document.body.innerText), undefined, { timeout: 20_000 }).then(() => true, () => false);

/** Opens the page and checks it is the intended page: no sign-in, no 404, no error. Returns a problem or null. */
async function openPage(page: Page, spec: VisualPage): Promise<string | null> {
  const response = await page.goto(`${baseUrl}${spec.path}`, { waitUntil: "load" });
  await page.addStyleTag({ content: calmCss });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  if (!(await waitForShell(page))) return 'it never left the "Loading IMAdventist…" screen';
  await page.evaluate(() => document.fonts.ready);
  const status = response?.status() ?? 0;
  if (status >= 400) return `the server answered ${status}`;
  const wantedPath = new URL(spec.path, "http://x").pathname;
  const finalUrl = new URL(page.url());
  if (finalUrl.pathname !== wantedPath) return `it went to ${finalUrl.pathname} instead of ${wantedPath}`;
  const text: string = await page.evaluate(() => document.body.innerText);
  if (/Application error|This page couldn.t load|Something went wrong/i.test(text)) return "it shows an error page";
  if (/^\s*(404|Page not found)\b/im.test(text) && !spec.expectText) return "it shows a not-found page";
  if (spec.role !== "visitor" && /Sign in to (continue|your)/i.test(text) && !spec.expectText?.test(text)) return "it shows the sign-in page";
  if (spec.expectText && !spec.expectText.test(text)) return `it does not show the expected text ${spec.expectText}`;
  return null;
}

/** Takes the whole-page picture again until two in a row are identical (late content, a settling layout). */
async function steadyShot(page: Page, spec: VisualPage, width: number): Promise<Buffer> {
  const height: number = await page.evaluate(() => document.documentElement.scrollHeight);
  const options: Record<string, unknown> = {
    type: "png", fullPage: true, animations: "disabled", caret: "hide", scale: "css",
    mask: (spec.mask ?? []).map((selector) => page.locator(selector)),
  };
  if (height > MAX_PICTURE_HEIGHT) options.clip = { x: 0, y: 0, width, height: MAX_PICTURE_HEIGHT };
  let previous: Buffer | null = null;
  let shot: Buffer = Buffer.alloc(0);
  for (let attempt = 0; attempt < MAX_SHOT_TRIES; attempt += 1) {
    shot = (await page.screenshot(options)) as Buffer;
    if (previous && previous.equals(shot)) return shot;
    previous = shot;
    await page.waitForTimeout(SHOT_GAP_MS);
  }
  return shot;
}

function writeOut(name: string, width: number, kind: "before" | "after" | "diff", data: Buffer) {
  writeFileSync(path.join(outDir, `${name}@${width}-${kind}.png`), data);
}

async function checkPage(page: Page, spec: VisualPage, width: number) {
  const problem = await openPage(page, spec);
  if (problem) {
    outcomes.push({ name: spec.name, width, status: "failed", detail: problem });
    return;
  }
  const shot = await steadyShot(page, spec, width);
  const baselinePath = path.join(baselineDir, String(width), `${spec.name}.png`);
  if (update) {
    mkdirSync(path.dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, shot);
    outcomes.push({ name: spec.name, width, status: "updated", detail: "baseline written" });
    return;
  }
  if (!existsSync(baselinePath)) {
    writeOut(spec.name, width, "after", shot);
    outcomes.push({ name: spec.name, width, status: "new", detail: "there is no baseline yet" });
    return;
  }
  const baseline = readFileSync(baselinePath);
  const result = compareImages(baseline, shot);
  if (result.ok) {
    outcomes.push({ name: spec.name, width, status: "same", detail: `${result.differing} pixels differ` });
    return;
  }
  writeOut(spec.name, width, "before", baseline);
  writeOut(spec.name, width, "after", shot);
  if (result.diff) writeOut(spec.name, width, "diff", result.diff);
  outcomes.push({ name: spec.name, width, status: "different", detail: result.message });
}

function removeObsoleteBaselines() {
  if (only.length > 0) return;
  const wanted = new Set(visualPages.map((spec) => `${spec.name}.png`));
  for (const width of visualWidths) {
    const dir = path.join(baselineDir, String(width));
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".png") && !wanted.has(file)) {
        rmSync(path.join(dir, file));
        console.log(`Removed the baseline of a page no longer listed: ${width}/${file}`);
      }
    }
  }
}

async function main() {
  assertFixedClock();
  assertLocalDatabase(process.env, "write synthetic clubs and accounts, move database times and mint sessions");
  assertLocalUrl(baseUrl, "VISUAL_BASE_URL");
  const names = new Set<string>();
  for (const spec of visualPages) {
    if (names.has(spec.name)) throw new Error(`Two pages are named ${spec.name}.`);
    names.add(spec.name);
  }
  const specs = visualPages.filter((spec) => only.length === 0 || only.some((part) => spec.name.includes(part)));
  if (specs.length === 0) throw new Error(`No page name contains ${only.join(" or ")}.`);

  let chromium;
  for (const name of ["playwright-core", "playwright"]) {
    try {
      // Load by variable name so tsc and eslint do not need the package; require() also honours NODE_PATH.
      ({ chromium } = createRequire(path.join(process.cwd(), "package.json"))(name));
      break;
    } catch (error) {
      if (process.env.VISUAL_DEBUG) console.error(error);
    }
  }
  if (!chromium) {
    console.error("Missing playwright-core. Run: npm i --no-save playwright-core@1.56.1");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  const { PrismaClient: Prisma } = await import("@prisma/client");
  const prisma: PrismaClient = new Prisma();
  const tokens: { staff: string[]; attendee: string[] } = { staff: [], attendee: [] };
  let browser: Browser;
  let app: ChildProcess | undefined;
  let shotsStarted = 0;
  let browserVersion = "unknown";
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await browser?.close().catch(() => undefined);
    app?.kill();
    const { revokeDatabaseSession } = await import("../modules/access/session-store");
    const { revokeAttendeeSession } = await import("../modules/attendee-accounts/session-store");
    for (const token of tokens.staff) await revokeDatabaseSession(token).catch(() => undefined);
    for (const token of tokens.attendee) await revokeAttendeeSession(token).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };
  // Ctrl-C or a stopped job: revoke the sessions, stop the app, and exit with an error.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143)); });
  }
  try {
    await assertSeededDatabase(prisma);
    const { seedVisualFixture, normalizeTimestamps } = await import("./support/visual-fixture");
    await seedVisualFixture(prisma);
    const normalized = await normalizeTimestamps(prisma);
    console.log(`Moved ${normalized.moved} database times back to ${VISUAL_FIXED_NOW} (${normalized.columns} columns${normalized.skipped.length ? `; could not change ${normalized.skipped.join(", ")}` : ""}).`);
    if (startOwnApp) app = await startApp();

    const cookies = new Map<VisualRole, { name: string; value: string; expires: number }>();
    for (const role of new Set(specs.map((spec) => spec.role))) {
      if (role !== "visitor") cookies.set(role, await cookieFor(prisma, role, tokens));
    }
    // Minting a session writes times with the database's own clock.
    await normalizeTimestamps(prisma);

    browser = await chromium.launch({
      executablePath: process.env.VISUAL_BROWSER || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--font-render-hinting=none"],
    });
    browserVersion = await browser.version();
    console.log(`Browser ${browserVersion}.`);
    console.log(`Visual check of ${specs.length} pages at ${visualWidths.join(" and ")} px${update ? " (updating the baselines)" : ""}; pictures in ${outDir}`);
    shotsStarted = Date.now();
    for (const width of visualWidths) {
      for (const role of new Set(specs.map((spec) => spec.role))) {
        const roleSpecs = specs.filter((spec) => spec.role === role);
        const context = await browser.newContext({
          viewport: { width, height: viewportHeights[width] ?? 800 },
          hasTouch: width <= 768,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          colorScheme: "light",
          locale: "en-US",
          timezoneId: "America/Chicago",
        });
        // tsx compiles with esbuild's keepNames, which wraps functions in __name(); the page has no such helper.
        await context.addInitScript("window.__name = (target) => target;");
        // The page's own clock stands still at the same moment as the server's.
        await context.clock.setFixedTime(new Date(VISUAL_FIXED_NOW));
        const cookie = cookies.get(role);
        // No expiry date: the browser's own cookie clock is the real one, and the session's expiry is set on the fixed clock.
        if (cookie) await context.addCookies([{ name: cookie.name, value: cookie.value, url: baseUrl, httpOnly: true }]);
        const page = await context.newPage();
        for (const spec of roleSpecs) {
          console.log(`${spec.name} @${width}`);
          try {
            await checkPage(page, spec, width);
          } catch (error) {
            outcomes.push({ name: spec.name, width, status: "failed", detail: (error as Error).message.split("\n")[0] ?? "failed" });
          }
        }
        await context.close();
      }
    }
  } finally {
    await cleanup();
  }
  const seconds = Math.round((Date.now() - shotsStarted) / 1000);

  if (update) removeObsoleteBaselines();
  const bad = outcomes.filter((outcome) => outcome.status === "failed" || outcome.status === "different" || outcome.status === "new");
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ fixedNow: VISUAL_FIXED_NOW, browser: browserVersion, widths: visualWidths, seconds, outcomes }, null, 2));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary && !update) {
    const rows = bad.map((outcome) => `| ${outcome.name} | ${outcome.width} | ${outcome.status} | ${outcome.detail.replace(/\|/g, "\\|")} |`);
    appendFileSync(summary, `### Visual check\n\nBrowser: ${browserVersion}\n\n${bad.length === 0 ? `All ${outcomes.length} pictures match their baselines.` : `${bad.length} of ${outcomes.length} pictures need a look. The before, after and difference pictures are in the \`visual-diffs\` artifact.\n\n| Page | Width | Result | Detail |\n| --- | --- | --- | --- |\n${rows.join("\n")}`}\n`);
  }
  console.log(`\n${outcomes.length} pictures in ${seconds} s.`);
  if (update) {
    console.log(`Baselines written to ${path.relative(process.cwd(), baselineDir)}.`);
    if (bad.length > 0) {
      for (const outcome of bad) console.error(`  - ${outcome.name} @${outcome.width}: ${outcome.detail}`);
      process.exit(1);
    }
    return;
  }
  if (bad.length > 0) {
    console.error(`${bad.length} picture(s) failed:`);
    for (const outcome of bad) console.error(`  - ${outcome.name} @${outcome.width}: ${outcome.status}: ${outcome.detail}`);
    console.error(`Before, after and difference pictures: ${outDir}`);
    process.exit(1);
  }
  console.log("All visual checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
