/**
 * Real-browser check that IMSDA Events works, or says plainly what is blocked, in privacy browsers (#1445, rules T2 and P1).
 *
 * Drives Chromium, Firefox and WebKit (Playwright) through the key journeys with EasyList/EasyPrivacy-style request
 * blocking (`scripts/support/privacy-block-lists.ts`), in three modes: control (nothing blocked), shields (what Brave
 * Shields and Avast block) and strict (the same, plus third-party iframes and cookies refused and site storage
 * blocked). Journeys:
 *
 *  - sign-in with the emailed code (a club role without two-step sign-in);
 *  - club director pages, including the roster;
 *  - public registration with a promo code and card, ending on the card form (or its fallback message);
 *  - the same registration while the page's own price preview throws: the page says the total is calculated on submit,
 *    and the recorded total and the card amount are still the server's numbers (rule P1);
 *  - the calendar embed on another site, with no third-party cookies and no third-party storage;
 *  - the Cloudflare Security check blocked, on a second app that has Turnstile keys (optional).
 *
 * Every journey asserts the page works or shows its fallback message, and that no uncaught error reached the page.
 *
 * LOCAL USE ONLY. It writes synthetic rows (every id starts with "pbx") and mints a session that skips the second
 * factor, so it refuses to run with NODE_ENV=production, or with a database or URL that is not on this machine.
 *
 * Setup (the app must run with a fictitious Square sandbox config so the card form is offered, and with the embed host
 * allowed to frame the calendar; see .github/workflows/browser-privacy.yml and docs/PRIVACY-BROWSERS.md):
 *   npm i --no-save playwright@1.63.0 && npx playwright install --with-deps chromium firefox webkit
 *
 *   PRIVACY_BASE_URL=http://localhost:3001 npm run test:privacy-browsers
 *
 * Environment:
 *   PRIVACY_BASE_URL            default http://localhost:3000
 *   PRIVACY_TURNSTILE_BASE_URL  a second app with TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY set; Security check journeys run only with it
 *   PRIVACY_BROWSERS            comma list, default chromium,firefox,webkit
 *   PRIVACY_MODES               comma list, default control,shields,strict
 *   PRIVACY_ONLY                run journeys whose name contains this text
 *   PRIVACY_EMBED_HOST_PORT     default 3999 (the app's EMBED_ALLOWED_ORIGINS must allow http://127.0.0.1:<port>)
 *   PRIVACY_KEEP                set to 1 to keep the synthetic rows
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase, assertLocalUrl } from "./support/local-only-guard";
import { BLOCK_FILTERS, STRICT_STORAGE_INIT_SCRIPT, blockedBy, type BlockMode } from "./support/privacy-block-lists";
import {
  cleanupPrivacyBrowsers,
  directorCookie,
  emails,
  eventSlug,
  expected,
  formSlug,
  ids,
  PASSWORD,
  planSignInCode,
  promoCode,
  seedPrivacyBrowsers,
} from "./support/privacy-browsers-seed";

/* eslint-disable @typescript-eslint/no-explicit-any */
loadEnvConfig(process.cwd());

// Structural stand-ins: playwright is installed on demand, not a dependency.
type Page = any;
type Context = any;
type Browser = any;

const baseUrl = (process.env.PRIVACY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const turnstileUrl = process.env.PRIVACY_TURNSTILE_BASE_URL?.replace(/\/$/, "") ?? null;
const browserNames = (process.env.PRIVACY_BROWSERS ?? "chromium,firefox,webkit").split(",").map((value) => value.trim()).filter(Boolean);
const modes = (process.env.PRIVACY_MODES ?? "control,shields,strict").split(",").map((value) => value.trim()).filter(Boolean) as BlockMode[];
const only = process.env.PRIVACY_ONLY;
const embedHostPort = Number(process.env.PRIVACY_EMBED_HOST_PORT ?? 3999);
const timeout = 30_000;

const prisma = new PrismaClient();

/** What a registration with the seeded form costs on the server: $50.00 ticket + 2 shirts at $15.00, 10% off. */
const SERVER_RECORDED_TOTAL = "$72.00";
/** The $72.00 subtotal plus the card fee the form's own rate makes of it (2.9% + 30 cents, passed to the registrant). */
const SERVER_CARD_CHARGE = "$74.46";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Tracker = { pageErrors: string[]; blocked: Set<string>; blockedUrls: string[]; thirdPartyFramesBlocked: number };

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * WebKit (Playwright's build) refuses Secure and `__Host-` cookies on http://localhost, which is how this check runs the
 * production build. Without them nobody can sign in, in any mode, so for WebKit only the app's session cookies are
 * copied into the browser under their plain legacy name (which the app still reads). Nothing else about the response
 * changes. A real WebKit on https keeps the cookie as written.
 */
function sessionCookiesFor(setCookieHeader: string, origin: string) {
  const cookies: Array<{ name: string; value: string; url: string; httpOnly: boolean; expires?: number }> = [];
  for (const line of setCookieHeader.split("\n")) {
    if (!line.trim()) continue;
    const [pair, ...attributes] = line.split(";").map((part: string) => part.trim());
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!name.startsWith("__Host-") || value === "") continue;
    const maxAge = attributes.find((attribute: string) => /^max-age=/i.test(attribute))?.split("=")[1];
    const expires = attributes.find((attribute: string) => /^expires=/i.test(attribute))?.slice(8);
    cookies.push({
      name: name.slice("__Host-".length),
      value,
      url: origin,
      httpOnly: attributes.some((attribute: string) => /^httponly$/i.test(attribute)),
      ...(maxAge ? { expires: Math.floor(Date.now() / 1000) + Number(maxAge) } : expires ? { expires: Math.floor(new Date(expires).getTime() / 1000) } : {}),
    });
  }
  return cookies;
}

async function newContext(browser: Browser, mode: BlockMode, tracker: Tracker, browserName: string, options: { allowFrameFrom?: string[] } = {}): Promise<Context> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: "en-US" });
  context.setDefaultTimeout(timeout);
  if (mode === "strict") await context.addInitScript(STRICT_STORAGE_INIT_SCRIPT);
  if (browserName === "webkit") {
    context.on("response", async (response: any) => {
      try {
        if (!response.url().startsWith(baseUrl)) return;
        const header: string | undefined = (await response.allHeaders())["set-cookie"];
        const cookies = header ? sessionCookiesFor(header, new URL(response.url()).origin) : [];
        if (cookies.length > 0) await context.addCookies(cookies);
      } catch {
        // The context closed while a response was still arriving.
      }
    });
  }
  if (mode !== "control") {
    await context.route("**/*", async (route: any) => {
      try {
        await handleRoute(route);
      } catch {
        // The page or context went away while this request was in flight (a journey ended): nothing left to answer.
        await route.abort().catch(() => undefined);
      }
    });
  }
  return context;

  async function handleRoute(route: any) {
    {
      const request = route.request();
      const url: string = request.url();
      const filter = blockedBy(url);
      if (filter) {
        tracker.blocked.add(filter.name);
        tracker.blockedUrls.push(url);
        return route.abort("blockedbyclient");
      }
      if (mode === "strict") {
        const topUrl: string = request.frame()?.page().mainFrame().url() ?? "";
        const thirdParty = topUrl !== "" && topUrl !== "about:blank" && hostOf(topUrl) !== hostOf(url);
        if (request.resourceType() === "document" && request.frame()?.parentFrame() && thirdParty && !(options.allowFrameFrom ?? []).includes(hostOf(url))) {
          tracker.thirdPartyFramesBlocked += 1;
          return route.abort("blockedbyclient");
        }
        if (thirdParty) {
          // Third-party cookies: none go out and none come back.
          const headers = { ...request.headers() };
          delete headers.cookie;
          const response = await route.fetch({ headers });
          const responseHeaders = { ...response.headers() };
          delete responseHeaders["set-cookie"];
          return route.fulfill({ response, headers: responseHeaders });
        }
      }
      return route.continue();
    }
  }
}

/** Stops the routes first: a handler that is still fetching when the context closes would reject with nobody to catch it. */
async function closeContext(context: Context) {
  await context.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
  await context.close().catch(() => undefined);
}

function watch(page: Page, tracker: Tracker) {
  page.on("pageerror", (error: Error) => tracker.pageErrors.push(error.message));
}

/**
 * Errors that are not ours to fix and that a check must not fail on: Square's own script refuses the fictitious
 * application id this check configures ("initializing the payment method"), and a price preview that is made to throw
 * on the client alone makes React note a hydration difference against the server's HTML (the real failure, a script
 * that breaks on the visitor's side, is exactly that).
 */
const TOLERATED_ERRORS = [
  /initializing the payment method/i,
  // WebKit reports a Next prefetch that was cancelled because the page moved on as an unhandled rejection.
  /_rsc=.*due to access control checks/i,
];

function noUncaughtErrors(tracker: Tracker, tolerated: RegExp[] = []) {
  const unexpected = tracker.pageErrors.filter((message) => ![...TOLERATED_ERRORS, ...tolerated].some((pattern) => pattern.test(message)));
  assert(unexpected.length === 0, `An uncaught error reached the page: ${unexpected.join(" | ")}`);
}

async function noErrorScreen(page: Page) {
  const shown = await page.getByText("Something went wrong", { exact: false }).count();
  assert(shown === 0, `The page showed its "Something went wrong" error screen at ${page.url()}.`);
}

/** Only the limits these journeys hit (sign-in and its code, registration, promo quotes, password reset), not every bucket. */
const RATE_LIMIT_POLICIES = ["attendee.sign-in", "attendee.sign-in-code", "attendee.password-reset", "public.registration.", "public.promo-quote.", "registration.code-access"];

async function clearRateLimits() {
  await prisma.rateLimitBucket.deleteMany({ where: { OR: RATE_LIMIT_POLICIES.map((policy) => ({ policy: { startsWith: policy } })) } });
}

// ---- Journeys ---------------------------------------------------------------------------------------------------

type Journey = {
  name: string;
  /** Needs the second app with Turnstile keys. */
  turnstile?: boolean;
  run: (ctx: { browser: Browser; mode: BlockMode; tracker: Tracker; browserName: string }) => Promise<void>;
};

async function signInWithEmailCode({ browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  await clearRateLimits();
  const context = await newContext(browser, mode, tracker, browserName);
  try {
    const page: Page = await context.newPage();
    watch(page, tracker);
    await page.goto(`${baseUrl}/account/sign-in`);
    await page.getByLabel("Email address").fill(emails.code);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/account\/sign-in\/code/);
    await page.getByRole("heading", { name: "Check your email" }).waitFor();
    // The real code is minted when the email is delivered, which this check never does: make one known instead.
    const code = await planSignInCode(prisma, ids.codeAccount);
    await page.getByLabel("Sign-in code").fill(code);
    // A whole code submits itself; if this browser did not, submit the form.
    const left = (url: URL) => !url.pathname.startsWith("/account/sign-in");
    await page.waitForURL(left, { timeout: 4000 }).catch(async () => {
      await page.getByLabel("Sign-in code").press("Enter");
      await page.waitForURL(left);
    });
    await noErrorScreen(page);
    assert(page.url().startsWith(`${baseUrl}/account`), `After the code, expected the account area, got ${page.url()}`);
    noUncaughtErrors(tracker);
  } finally {
    await closeContext(context);
  }
}

async function clubDirectorPages({ browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  const context = await newContext(browser, mode, tracker, browserName);
  try {
    const cookie = await directorCookie();
    await context.addCookies([{ name: cookie.name, value: cookie.value, url: baseUrl, httpOnly: true, expires: cookie.expires }]);
    const page: Page = await context.newPage();
    watch(page, tracker);
    await page.goto(`${baseUrl}/account/clubs`);
    await page.getByText("Pbx Eagles Club").first().waitFor();
    await page.goto(`${baseUrl}/account/clubs/${ids.club}/roster`);
    // The Members section starts closed; opening it writes the choice to localStorage, which strict mode refuses.
    // The section must still open.
    await page.getByRole("button", { name: /^Members/ }).or(page.locator("summary", { hasText: /^Members/ })).first().click();
    for (const name of ["Pathy0", "Pathy1", "Pathy2"]) {
      await page.getByText(name).first().waitFor();
    }
    await noErrorScreen(page);
    await page.goto(`${baseUrl}/account/clubs/${ids.club}`);
    await noErrorScreen(page);
    noUncaughtErrors(tracker);
  } finally {
    await closeContext(context);
  }
}

async function fillRegistration(page: Page, email: string, options: { expectPreview: boolean }) {
  await page.goto(`${baseUrl}/register/${eventSlug}/${formSlug}`);
  // Hydration must finish before anything is typed, or React starts the form over under the typing.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill("Person");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Standard").check();
  await page.getByLabel("Shirts").fill("2");
  await page.getByLabel("Promo code").fill(promoCode.toLowerCase());
  await page.getByLabel("Credit / debit card").check();
  await page.getByRole("button", { name: "Apply" }).click();
  const summary = page.locator(".public-registration-summary");
  if (options.expectPreview) {
    // The preview comes from the shared function: with a promo code and card it shows the discount and fee.
    await summary.getByText("Discounted subtotal").waitFor();
    assert((await summary.innerText()).includes("$72.00"), "The preview did not show the discounted subtotal.");
  } else {
    // The preview threw: the page must say so, and never show a made-up total.
    await summary.getByTestId("preview-unavailable").waitFor();
    const text = await summary.innerText();
    assert(/calculated when you submit/i.test(text), `The page did not say the total is calculated on submit: ${text}`);
    assert(!/Total\s*\$/.test(text), `A total was shown although the preview failed: ${text}`);
  }
}

async function registerAndCheckServerNumbers(page: Page, email: string) {
  await page.getByRole("button", { name: "Submit registration" }).first().click();
  await page.getByText("Registration received").first().waitFor();
  const body = await page.locator("main, body").first().innerText();
  const recorded = /Total recorded\s*\n?\s*(\$[\d,.]+)/.exec(body)?.[1];
  assert(recorded === SERVER_RECORDED_TOTAL, `The confirmation showed ${recorded ?? "no total"}, expected the server's ${SERVER_RECORDED_TOTAL}.`);
  // The stored amount, read from the database: the server's number, not anything the page computed.
  const registration = await prisma.registration.findFirst({
    where: { eventId: ids.event, contactSnapshot: { path: ["email"], equals: email } },
    select: { id: true, totalAmount: true },
  });
  assert(registration, "The registration was not stored.");
  assert(Math.round(Number(registration.totalAmount) * 100) === expected.totalPayLaterCents, `Stored total was ${registration.totalAmount}, expected 72.00.`);
  const attempts = await prisma.paymentAttempt.count({ where: { registrationId: registration.id } });
  assert(attempts === 0, "A payment attempt exists although no card was submitted.");
  return page.getByRole("link", { name: "Continue to secure card payment" });
}

async function paymentStep(page: Page, link: any, mode: BlockMode) {
  await link.click();
  // The charge is the server's: the balance plus the card fee from the form's own rate.
  await page.getByText(`Pay ${SERVER_CARD_CHARGE} securely with Square`).waitFor();
  const failure = page.getByTestId("square-load-failed");
  const cardFrame = page.locator(".public-square-card-frame iframe");
  if (mode === "control") {
    // Unblocked, the card form loads; with no route to Square (or fictitious ids) it must show the fallback instead of nothing.
    await Promise.race([failure.waitFor({ timeout: 25_000 }), cardFrame.first().waitFor({ timeout: 25_000 })]);
    return;
  }
  try {
    await failure.waitFor({ timeout: 15_000 });
  } catch (error) {
    if (process.env.PRIVACY_DEBUG) console.log((await page.locator("body").innerText()).slice(-900));
    throw error;
  }
  const text = await failure.innerText();
  assert(/could not load/i.test(text) && /Try again/.test(text), `The card-form fallback message was unclear: ${text}`);
  assert(/Pay later|contact the event team/i.test(text), `The fallback did not name another way to pay: ${text}`);
  await failure.getByRole("button", { name: "Try again" }).click();
  await failure.waitFor();
}

async function publicRegistration({ browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  await clearRateLimits();
  const context = await newContext(browser, mode, tracker, browserName);
  try {
    const page: Page = await context.newPage();
    watch(page, tracker);
    const email = `pbx.reg.${randomBytes(4).toString("hex")}@example.test`;
    await fillRegistration(page, email, { expectPreview: true });
    const link = await registerAndCheckServerNumbers(page, email);
    await paymentStep(page, link, mode);
    await noErrorScreen(page);
    noUncaughtErrors(tracker);
  } finally {
    await closeContext(context);
  }
}

/** Makes the shared price function throw in the page, the way a broken or blocked script would. */
const PREVIEW_FAILS_INIT_SCRIPT = `
(() => {
  const original = Array.prototype.reduce;
  Array.prototype.reduce = function (callback, ...rest) {
    if (typeof callback === "function" && /Math\\.max\\([^)]*amountCents/.test(Function.prototype.toString.call(callback))) {
      window.__previewThrew = true;
      throw new Error("The price preview failed (injected by the privacy-browser check).");
    }
    return original.call(this, callback, ...rest);
  };
})();
`;

async function publicRegistrationPreviewFails({ browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  await clearRateLimits();
  const context = await newContext(browser, mode, tracker, browserName);
  try {
    await context.addInitScript(PREVIEW_FAILS_INIT_SCRIPT);
    const page: Page = await context.newPage();
    // The injected failure is caught by the page (that is the point), so it is not an uncaught error; any other one is.
    watch(page, tracker);
    const email = `pbx.preview.${randomBytes(4).toString("hex")}@example.test`;
    await fillRegistration(page, email, { expectPreview: false });
    assert(await page.evaluate(() => (window as unknown as { __previewThrew?: boolean }).__previewThrew === true), "The injected failure never reached the page's price preview.");
    const link = await registerAndCheckServerNumbers(page, email);
    await paymentStep(page, link, mode);
    await noErrorScreen(page);
    noUncaughtErrors(tracker, [/Minified React error #(418|423|425)/, /hydrat/i]);
  } finally {
    await closeContext(context);
  }
}

let embedServer: Server | null = null;
async function startEmbedHost() {
  if (embedServer) return;
  const embed = [
    '<iframe class="imsda-embed"',
    `        src="${baseUrl}/embed/calendar"`,
    '        title="IMSDA upcoming events"',
    '        width="100%" height="480" style="border:0;display:block"></iframe>',
    `<script src="${baseUrl}/embed/embed-host.js" async></script>`,
  ].join("\n");
  embedServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host site</title></head><body><h1>Another website</h1>${embed}</body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    embedServer!.once("error", reject);
    embedServer!.listen(embedHostPort, "127.0.0.1", resolve);
  });
}

async function calendarEmbed({ browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  await startEmbedHost();
  const context = await newContext(browser, mode, tracker, browserName, { allowFrameFrom: [hostOf(baseUrl)] });
  try {
    const page: Page = await context.newPage();
    watch(page, tracker);
    await page.goto(`http://127.0.0.1:${embedHostPort}/`);
    const frame = page.frameLocator("iframe.imsda-embed");
    try {
      await frame.getByRole("heading", { name: "Upcoming events" }).waitFor();
    } catch (error) {
      throw new Error(`The calendar embed did not render. Start the app with EMBED_ALLOWED_ORIGINS="'self' http://127.0.0.1:${embedHostPort}" so this host may frame it. ${(error as Error).message}`);
    }
    noUncaughtErrors(tracker);
  } finally {
    await closeContext(context);
  }
}

async function eventPageWithoutAnalytics({ browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  const context = await newContext(browser, mode, tracker, browserName);
  try {
    const page: Page = await context.newPage();
    watch(page, tracker);
    await page.goto(`${baseUrl}/events/${eventSlug}`);
    await page.getByRole("heading", { name: "Pbx Privacy Weekend" }).first().waitFor();
    // Give the web-vitals beacon time to fire (and be blocked); nothing visible may change.
    await page.waitForTimeout(1500);
    await noErrorScreen(page);
    noUncaughtErrors(tracker);
  } finally {
    await closeContext(context);
  }
}

async function securityCheckBlocked(path: string, { browser, mode, tracker, browserName }: Parameters<Journey["run"]>[0]) {
  assert(turnstileUrl, "PRIVACY_TURNSTILE_BASE_URL is not set.");
  await clearRateLimits();
  const context = await newContext(browser, mode, tracker, browserName);
  try {
    const page: Page = await context.newPage();
    watch(page, tracker);
    const signInPosts: string[] = [];
    page.on("request", (request: any) => {
      if (request.method() === "POST" && /\/api\/(attendee\/)?(sign-in|password-reset)/.test(request.url())) signInPosts.push(request.url());
    });
    await page.goto(`${turnstileUrl}${path}`);
    const group = page.getByTestId("security-check");
    await group.waitFor();
    if (mode === "control") {
      // Unblocked: the box loads (Cloudflare's test keys answer with a dummy token), or, with no route to Cloudflare, the
      // same plain message appears. Never an empty gap.
      await Promise.race([
        group.locator('input[name="cf-turnstile-response"]').waitFor({ state: "attached", timeout: 25_000 }),
        group.getByTestId("security-check-retry").waitFor({ timeout: 25_000 }),
      ]);
      noUncaughtErrors(tracker);
      return;
    }
    const retry = group.getByTestId("security-check-retry");
    await retry.waitFor();
    const text = await group.innerText();
    assert(/could not load/i.test(text) && /Try again/.test(text), `The Security check message was unclear: ${text}`);
    // Try again asks for the script again; blocked again, the message comes back. Nothing is skipped.
    await retry.click();
    await retry.waitFor();
    // No way around the check: Submit without a token sends nothing and says to finish the check.
    const email = page.getByLabel(/Email/).first();
    await email.fill(emails.code);
    const password = page.getByLabel("Password", { exact: true });
    if (await password.count()) await password.fill(PASSWORD);
    await page.getByRole("button", { name: /^(Sign in|Send|Email|Reset|Continue)/ }).last().click();
    // Blocked, Submit keeps the blocked message and Try again (never a dead end) and sends nothing.
    await retry.waitFor();
    assert(/could not load/i.test(await group.innerText()), "Submit replaced the blocked message.");
    assert(signInPosts.length === 0, `A request was sent without the Security check: ${signInPosts.join(", ")}`);
    noUncaughtErrors(tracker);
  } finally {
    await closeContext(context);
  }
}

const journeys: Journey[] = [
  { name: "sign-in with the emailed code", run: signInWithEmailCode },
  { name: "club director pages and roster", run: clubDirectorPages },
  { name: "event page, analytics blocked", run: eventPageWithoutAnalytics },
  { name: "public registration, promo code and card", run: publicRegistration },
  { name: "public registration, price preview throws", run: publicRegistrationPreviewFails },
  { name: "calendar embed on another site", run: calendarEmbed },
  { name: "Security check blocked on sign-in", turnstile: true, run: (ctx) => securityCheckBlocked("/account/sign-in", ctx) },
  { name: "Security check blocked on password reset", turnstile: true, run: (ctx) => securityCheckBlocked("/account/forgot-password", ctx) },
];

// ---- Runner -----------------------------------------------------------------------------------------------------

type Result = { browser: string; mode: string; journey: string; ok: boolean; detail: string; blocked: string[] };

async function main() {
  assertLocalDatabase(process.env, "run the privacy-browser check");
  assertLocalUrl(baseUrl, "PRIVACY_BASE_URL");
  if (turnstileUrl) assertLocalUrl(turnstileUrl, "PRIVACY_TURNSTILE_BASE_URL");

  let playwright: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    playwright = require("playwright");
  } catch {
    console.error("Missing playwright. Run: npm i --no-save playwright@1.63.0 && npx playwright install --with-deps chromium firefox webkit");
    process.exit(2);
  }

  console.log(`Filters in the list: ${BLOCK_FILTERS.length}. Modes: ${modes.join(", ")}. Browsers: ${browserNames.join(", ")}.`);
  await seedPrivacyBrowsers(prisma);
  const results: Result[] = [];
  try {
    for (const browserName of browserNames) {
      const browser: Browser = await playwright[browserName].launch();
      try {
        for (const mode of modes) {
          for (const journey of journeys) {
            if (only && !journey.name.includes(only)) continue;
            if (journey.turnstile && !turnstileUrl) continue;
            const tracker: Tracker = { pageErrors: [], blocked: new Set(), blockedUrls: [], thirdPartyFramesBlocked: 0 };
            const started = Date.now();
            try {
              await journey.run({ browser, mode, tracker, browserName });
              results.push({ browser: browserName, mode, journey: journey.name, ok: true, detail: `${Math.round((Date.now() - started) / 100) / 10}s`, blocked: [...tracker.blocked] });
            } catch (error) {
              results.push({ browser: browserName, mode, journey: journey.name, ok: false, detail: `${(error as Error).message.split("\n").slice(0, 3).join(" ")}${process.env.PRIVACY_DEBUG ? ` [blocked: ${tracker.blockedUrls.join(", ")}]` : ""}`, blocked: [...tracker.blocked] });
            }
            const last = results[results.length - 1];
            console.log(`${last.ok ? "PASS" : "FAIL"}  ${browserName.padEnd(8)} ${mode.padEnd(8)} ${journey.name}  ${last.detail}`);
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    embedServer?.close();
    if (process.env.PRIVACY_KEEP !== "1") await cleanupPrivacyBrowsers(prisma);
    await prisma.$disconnect();
  }

  const failures = results.filter((result) => !result.ok);
  const blockedNames = new Set(results.flatMap((result) => result.blocked));
  console.log(`\n${results.length - failures.length} of ${results.length} journeys passed. Filters that blocked something: ${[...blockedNames].join("; ") || "none"}.`);
  if (failures.length > 0) {
    console.error("\nFAILED:");
    for (const failure of failures) console.error(`- ${failure.browser} / ${failure.mode} / ${failure.journey}: ${failure.detail}`);
    process.exit(1);
  }
}

process.on("unhandledRejection", async (error) => {
  console.error("Unhandled rejection:", error);
  try {
    if (process.env.PRIVACY_KEEP !== "1") await cleanupPrivacyBrowsers(prisma);
    await prisma.$disconnect();
  } finally {
    process.exit(1);
  }
});

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
