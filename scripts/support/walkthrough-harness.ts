/**
 * Runs the shared walkthrough steps (`tests/browser/walkthroughs/`) against the local app (#1482). Used by
 * `scripts/capture-help-screenshots.ts` (screenshots) and `scripts/verify-help-walkthroughs.ts` (check only).
 *
 * LOCAL USE ONLY. It writes synthetic fixtures (every id starts with "walkthrough"), mints a signed-in session for the sample
 * director for walkthroughs that start signed in, and switches passkeys on for the local database while it runs. It refuses
 * NODE_ENV=production, a database or app URL that is not on this machine, and a database that is not a seeded dev or CI one.
 *
 * The emailed sign-in code is read from the local development mail path: with no ACCOUNT_EMAIL_* configured and outside
 * production, the app returns the code in its own sign-in response instead of sending mail. Never real email: a run refuses to
 * start when account email is set in its environment.
 *
 * A run changes a few things outside its own fixtures (passkeys, some form templates, the club events already in the database, and for
 * coordinator walkthroughs the clubs already in the database). Their "before" state is saved to a marker file in the OS temp directory before anything changes;
 * the end of the run, SIGINT and SIGTERM restore it, and so does the next run if this one was killed (walkthrough-restore.ts).
 */
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "@prisma/client";
import { walkthroughViewports, type WalkthroughImageKind } from "../../modules/help/walkthrough-images";
import { totpCode } from "../../modules/access/totp";
import { walkthroughs } from "../../modules/help/walkthroughs";
import { runWalkthrough, type StepEvent } from "../../tests/browser/walkthroughs/steps";
import type { WalkthroughContext, WalkthroughPage, WalkthroughStart } from "../../tests/browser/walkthroughs/types";
import * as fixtures from "./help-walkthrough-fixtures";
import { RunStopped, runSetupSteps, throwIfStopping } from "./walkthrough-setup";
import { applyRestoreState, databaseNameOf, recoverFromLeftoverMarker, removeRestoreMarker, restoreMarkerFile, writeRestoreMarker, type RestoreState } from "./walkthrough-restore";

loadEnvConfig(process.cwd());

export type StepCapture = StepEvent & { kind: WalkthroughImageKind; page: WalkthroughPage };

export type HarnessOptions = {
  baseUrl: string;
  /** Only walkthroughs whose id contains this text. */
  only?: string;
  kinds: readonly WalkthroughImageKind[];
  /** Runs after each step has put the page in its state. */
  onStep?: (capture: StepCapture) => Promise<void>;
  log?: (line: string) => void;
};

export type HarnessResult = { walkthroughId: string; kind: WalkthroughImageKind; steps: number }[];

/** Every Playwright package that can be loaded here: playwright-core (npm i --no-save) first, then playwright. */
function loadPlaywrightModules(): { name: string; chromium: { launch: (options: Record<string, unknown>) => Promise<unknown> } }[] {
  const found: { name: string; chromium: { launch: (options: Record<string, unknown>) => Promise<unknown> } }[] = [];
  for (const name of ["playwright-core", "playwright"]) {
    try {
      // By variable name so tsc and eslint do not need the package. `require` also finds a globally installed copy (NODE_PATH).
      const loaded = createRequire(path.join(process.cwd(), "package.json"))(name);
      if (loaded.chromium) found.push({ name, chromium: loaded.chromium });
    } catch {
      // not installed
    }
  }
  return found;
}

/** A Chromium already on this machine, under PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers, for when a package's own build is missing. */
function findInstalledChromium(): string | null {
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"]) {
    if (!root || !existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      for (const binary of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const full = path.join(root, entry, binary);
        if (existsSync(full)) return full;
      }
    }
  }
  return null;
}

/**
 * Launches Chromium without needing HELP_SHOTS_BROWSER: the package's own build, then (when launching fails, for example because
 * playwright-core 1.56 wants a build this machine does not have) a Chromium found on disk, then the next package.
 */
async function launchBrowser() {
  const modules = loadPlaywrightModules();
  if (modules.length === 0) throw new Error("Missing playwright-core. Run: npm i --no-save playwright-core@1.56.1");
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  const explicit = process.env.HELP_SHOTS_BROWSER || undefined;
  const installed = explicit ? null : findInstalledChromium();
  const errors: string[] = [];
  for (const { name, chromium } of modules) {
    for (const executablePath of explicit ? [explicit] : [undefined, ...(installed ? [installed] : [])]) {
      try {
        return await chromium.launch({ executablePath, args });
      } catch (error) {
        errors.push(`${name}${executablePath ? ` (${executablePath})` : ""}: ${(error as Error).message.split("\n")[0]}`);
      }
    }
  }
  throw new Error(`Could not launch Chromium. Set HELP_SHOTS_BROWSER to a Chromium executable.\n${errors.join("\n")}`);
}

export async function runWalkthroughHarness(options: HarnessOptions): Promise<HarnessResult> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const log = options.log ?? ((line: string) => console.log(line));
  // Hard guard first: nothing below loads Prisma or the session store until this has passed.
  fixtures.assertWalkthroughSafety(baseUrl);
  const selected = walkthroughs.filter((walkthrough) => !options.only || walkthrough.id.includes(options.only));
  if (selected.length === 0) throw new Error(`No walkthrough id contains "${options.only}".`);

  const { PrismaClient: Prisma } = await import("@prisma/client");
  const prisma: PrismaClient = new Prisma();
  const sessionStore = await import("../../modules/attendee-accounts/session-store");
  const { attendeeSessionCookie } = await import("../../modules/security/session-cookies");
  const tokens: string[] = [];
  let seeded = false;
  let restoreState: RestoreState | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  const result: HarnessResult = [];
  const markerFile = restoreMarkerFile();
  let cleanupRun: Promise<void> | null = null;
  /** When the latest run's fixtures were made: the sample people it created are removed by this time. */
  let lastRunStartedAt: Date | null = null;
  // Puts everything back. Runs once, from the end of the run or from a SIGINT/SIGTERM, whichever comes first; the other caller
  // waits for the same run, so the process is never closed (or the database disconnected) before the restore is done.
  const restoreEverything = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (browser as any)?.close().catch(() => undefined);
    if (!seeded) return;
    const { revokeAttendeeSession } = await import("../../modules/attendee-accounts/session-store");
    for (const token of tokens) await revokeAttendeeSession(token).catch(() => undefined);
    await fixtures.deleteWalkthroughFixtures(prisma).catch((error: Error) => console.error(`Could not remove the walkthrough fixtures: ${error.message}`));
    if (lastRunStartedAt) await fixtures.deleteSamplePeopleCreatedSince(prisma, lastRunStartedAt).catch((error: Error) => console.error(`Could not remove the sample people: ${error.message}`));
    if (restoreState) {
      const failures = await applyRestoreState(prisma, restoreState);
      for (const failure of failures) console.error(`Could not restore ${failure}`);
      // Keep the marker when something could not be restored: the next run tries again.
      if (failures.length === 0) removeRestoreMarker(markerFile);
    }
  };
  const cleanup = () => (cleanupRun ??= restoreEverything());
  // A signal only sets a flag and closes the browser. The run checks the flag before every write, and the single `finally`
  // below does the one restore and (after it) the exit, so nothing is written after the restore.
  let stopping: NodeJS.Signals | null = null;
  const shouldStop = () => stopping !== null;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = signal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (browser as any)?.close().catch(() => undefined);
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  try {
    await fixtures.assertSeededDatabase(prisma);
    seeded = true;
    const database = databaseNameOf(process.env.DATABASE_URL);
    // A run that was killed left its marker: repair that first, so the "before" below is the real one.
    await recoverFromLeftoverMarker(prisma, markerFile, database, log);
    const needsCoordinatorArea = selected.some((walkthrough) => walkthrough.audience === "coordinator");
    const hiddenClubs = needsCoordinatorArea ? await fixtures.listOtherClubIds(prisma) : [];
    const hiddenEvents = await fixtures.listOtherClubEventIds(prisma);
    const before = { database, hiddenClubs, hiddenEvents, templates: await fixtures.readTemplateStates(prisma), passkeyRpId: await fixtures.readPasskeyRpId(prisma) };
    // The marker is written BEFORE anything changes, and only a marker this run wrote is ever restored from or removed:
    // when the write is refused (a marker already there), `restoreState` stays null and the cleanup leaves that file alone.
    writeRestoreMarker(markerFile, before);
    restoreState = before;
    // `on`, not `once`: a second SIGINT/SIGTERM (Ctrl-C signals the whole process group) must not kill the process in the middle of the restore.
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    // Every write below is checked against the stop flag first.
    await runSetupSteps(
      [
        { name: "passkeys", run: () => fixtures.enablePasskeys(prisma) },
        { name: "clubs", run: () => fixtures.hideClubs(prisma, hiddenClubs) },
        { name: "events", run: () => fixtures.setEventsPublished(prisma, hiddenEvents, false) },
        { name: "browser", run: async () => { browser = await launchBrowser(); } },
      ],
      shouldStop,
    );
    for (const walkthrough of selected) {
      for (const kind of options.kinds) {
        throwIfStopping(shouldStop);
        // Every run starts from the same fixtures, so the pictures come out the same.
        await fixtures.deleteWalkthroughFixtures(prisma);
        if (lastRunStartedAt) await fixtures.deleteSamplePeopleCreatedSince(prisma, lastRunStartedAt);
        await fixtures.clearSignInRateLimits(prisma);
        throwIfStopping(shouldStop);
        const { authenticatorSecret } = await fixtures.createWalkthroughFixtures(prisma);
        lastRunStartedAt = new Date();
        const viewport = walkthroughViewports[kind];
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          hasTouch: kind === "phone",
          isMobile: false,
          reducedMotion: "reduce",
          colorScheme: "light",
          locale: "en-US",
          timezoneId: "America/Chicago",
        });
        // tsx compiles with keepNames, which wraps functions in __name(); the page has no such helper.
        await context.addInitScript("window.__name = (target) => target;");
        // The development server's own badge and toasts are not part of the product.
        await context.addInitScript(`document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = "nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button] { display: none !important; } *, *::before, *::after { caret-color: transparent !important; }"; document.head.append(style); });`);
        const page = await context.newPage();
        let latestCode: string | null = null;
        page.on("response", async (response: { url: () => string; json: () => Promise<unknown> }) => {
          const url = response.url();
          if (!/\/api\/attendee\/(sign-in|sign-in-code\/send)$/.test(new URL(url).pathname)) return;
          const body = (await response.json().catch(() => null)) as { signInCode?: { developmentCode?: string }; developmentCode?: string } | null;
          const code = body?.signInCode?.developmentCode ?? body?.developmentCode;
          if (code) latestCode = code;
        });
        const readSignInCode = async () => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            if (latestCode) return latestCode;
            await page.waitForTimeout(250);
          }
          throw new Error("No sign-in code arrived. Run the app outside production (npm run dev) with no ACCOUNT_EMAIL_* or RESEND_API_KEY set, so it returns the code instead of sending mail.");
        };
        const begin = async (start: WalkthroughStart) => {
          if (start === "signed-out") return;
          const accountId = start === "signed-in" ? fixtures.walkthroughIds.director : fixtures.walkthroughCoordinator.id;
          if (start === "signed-in") await fixtures.enrolPlaceholderTwoStep(prisma);
          const session = await sessionStore.createAttendeeSession(accountId, null, { secondFactorVerifiedAt: new Date() });
          tokens.push(session.token);
          await context.addCookies([{ name: attendeeSessionCookie.legacyName, value: session.token, url: baseUrl, httpOnly: true, expires: Math.floor(session.expiresAt.getTime() / 1000) }]);
        };
        const walkthroughContext: WalkthroughContext = {
          page,
          baseUrl,
          clubPath: `/account/clubs/${fixtures.walkthroughIds.club}`,
          director: { email: fixtures.walkthroughDirector.email, password: fixtures.walkthroughDirector.password, displayName: fixtures.walkthroughDirector.displayName },
          coordinator: { email: fixtures.walkthroughCoordinator.email, password: fixtures.walkthroughCoordinator.password, displayName: fixtures.walkthroughCoordinator.displayName },
          authenticatorCode: () => totpCode(authenticatorSecret, new Date()),
          rosterPerson: fixtures.walkthroughRosterPerson,
          invitee: { email: fixtures.walkthroughInvitee.email },
          supplyName: fixtures.walkthroughSupplyName,
          readSignInCode,
          begin,
        };
        log(`${walkthrough.id} (${kind}, ${viewport.width}px)`);
        try {
          const steps = await runWalkthrough(walkthrough.id, walkthroughContext, async (event) => {
            await options.onStep?.({ ...event, kind, page });
          });
          result.push({ walkthroughId: walkthrough.id, kind, steps });
        } catch (error) {
          // Keep a picture of where it stopped, to read in the job log's artifact or locally.
          const failure = path.join(process.env.HELP_SHOTS_FAILURE_DIR ?? os.tmpdir(), `walkthrough-failure-${walkthrough.id}-${kind}.png`);
          await page.screenshot({ path: failure, fullPage: true }).then(() => log(`  Saved a picture of the failure: ${failure}`)).catch(() => undefined);
          throw error;
        } finally {
          await context.close();
        }
      }
    }
  } catch (error) {
    // A stop closes the browser under the running step, so its error is the stop, not a failure.
    if (!(error instanceof RunStopped) && !stopping) throw error;
  } finally {
    // The handlers stay until everything is put back: a repeated signal while restoring is ignored.
    await cleanup();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await prisma.$disconnect();
  }
  if (stopping) process.exit(stopping === "SIGINT" ? 130 : 143);
  return result;
}

