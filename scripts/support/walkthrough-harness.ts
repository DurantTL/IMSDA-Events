/**
 * Runs the shared walkthrough steps (`tests/browser/walkthroughs/`) against the local app (#1482). Used by
 * `scripts/capture-help-screenshots.ts` (screenshots) and `scripts/verify-help-walkthroughs.ts` (check only).
 *
 * LOCAL USE ONLY. It writes synthetic fixtures (every id starts with "walkthrough"), mints a signed-in session for the sample
 * director for walkthroughs that start signed in, and switches passkeys on for the local database while it runs. It refuses
 * NODE_ENV=production, a database or app URL that is not on this machine, and a database that is not a seeded dev or CI one.
 *
 * The emailed sign-in code is read from the local development mail path: with no ACCOUNT_EMAIL_* configured and outside
 * production, the app returns the code in its own sign-in response instead of sending mail. Never real email.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "@prisma/client";
import { walkthroughViewports, type WalkthroughImageKind } from "../../modules/help/walkthrough-images";
import { walkthroughs } from "../../modules/help/walkthroughs";
import { runWalkthrough, type StepEvent } from "../../tests/browser/walkthroughs/steps";
import type { WalkthroughContext, WalkthroughPage, WalkthroughStart } from "../../tests/browser/walkthroughs/types";
import * as fixtures from "./help-walkthrough-fixtures";

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

async function loadChromium() {
  for (const name of ["playwright-core", "playwright"]) {
    try {
      // By variable name so tsc and eslint do not need the package. `require` also finds a globally installed copy (NODE_PATH).
      const loaded = createRequire(path.join(process.cwd(), "package.json"))(name);
      if (loaded.chromium) return loaded.chromium;
    } catch {
      try {
        const loaded = await import(/* webpackIgnore: true */ name);
        if (loaded.chromium) return loaded.chromium;
      } catch {
        // try the next one
      }
    }
  }
  throw new Error("Missing playwright-core. Run: npm i --no-save playwright-core@1.56.1");
}

export async function runWalkthroughHarness(options: HarnessOptions): Promise<HarnessResult> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const log = options.log ?? ((line: string) => console.log(line));
  // Hard guard first: nothing below loads Prisma or the session store until this has passed.
  fixtures.assertWalkthroughSafety(baseUrl);
  const selected = walkthroughs.filter((walkthrough) => !options.only || walkthrough.id.includes(options.only));
  if (selected.length === 0) throw new Error(`No walkthrough id contains "${options.only}".`);

  const { PrismaClient: Prisma } = await import("@prisma/client");
  const chromium = await loadChromium();
  const prisma: PrismaClient = new Prisma();
  const sessionStore = await import("../../modules/attendee-accounts/session-store");
  const { attendeeSessionCookie } = await import("../../modules/security/session-cookies");
  const tokens: string[] = [];
  let seeded = false;
  let templateStates: fixtures.TemplateState[] = [];
  let passkeyRpIdBefore: string | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  const result: HarnessResult = [];
  try {
    await fixtures.assertSeededDatabase(prisma);
    seeded = true;
    templateStates = await fixtures.readTemplateStates(prisma);
    passkeyRpIdBefore = await fixtures.enablePasskeys(prisma);
    browser = await chromium.launch({
      executablePath: process.env.HELP_SHOTS_BROWSER || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    for (const walkthrough of selected) {
      for (const kind of options.kinds) {
        // Every run starts from the same fixtures, so the pictures come out the same.
        await fixtures.deleteWalkthroughFixtures(prisma);
        await fixtures.clearSignInRateLimits(prisma);
        await fixtures.createWalkthroughFixtures(prisma);
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
            const queued = await prisma.messageOutbox.findFirst({
              where: { accountAttendeeId: fixtures.walkthroughIds.director },
              orderBy: { createdAt: "desc" },
              select: { bodyTextSnapshot: true },
            });
            const found = queued?.bodyTextSnapshot.match(/\b(\d{6})\b/)?.[1];
            if (found) return found;
            await page.waitForTimeout(250);
          }
          throw new Error("No sign-in code arrived. Run the app outside production (npm run dev) with no ACCOUNT_EMAIL_* set, so it returns the code instead of sending mail.");
        };
        const begin = async (start: WalkthroughStart) => {
          if (start !== "signed-in") return;
          await fixtures.enrolPlaceholderTwoStep(prisma);
          const session = await sessionStore.createAttendeeSession(fixtures.walkthroughIds.director, null, { secondFactorVerifiedAt: new Date() });
          tokens.push(session.token);
          await context.addCookies([{ name: attendeeSessionCookie.legacyName, value: session.token, url: baseUrl, httpOnly: true, expires: Math.floor(session.expiresAt.getTime() / 1000) }]);
        };
        const walkthroughContext: WalkthroughContext = {
          page,
          baseUrl,
          clubPath: `/account/clubs/${fixtures.walkthroughIds.club}`,
          director: { email: fixtures.walkthroughDirector.email, password: fixtures.walkthroughDirector.password, displayName: fixtures.walkthroughDirector.displayName },
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
  } finally {
    await browser?.close().catch(() => undefined);
    if (seeded) {
      const { revokeAttendeeSession } = await import("../../modules/attendee-accounts/session-store");
      for (const token of tokens) await revokeAttendeeSession(token).catch(() => undefined);
      await fixtures.deleteWalkthroughFixtures(prisma).catch((error: Error) => console.error(`Could not remove the walkthrough fixtures: ${error.message}`));
      await fixtures.restoreTemplateStates(prisma, templateStates).catch((error: Error) => console.error(`Could not restore the form templates: ${error.message}`));
      if (passkeyRpIdBefore !== undefined) await fixtures.restorePasskeys(prisma, passkeyRpIdBefore).catch((error: Error) => console.error(`Could not restore the passkey setting: ${error.message}`));
    }
    await prisma.$disconnect();
  }
  return result;
}

