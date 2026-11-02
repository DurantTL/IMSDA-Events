/**
 * Event journeys in a real browser (#1439, round 2: phase A attendees, phase B event staff).
 *
 * Phase A uses the built site like an attendee would, on a seeded database, at 1280 and 390 px wide (Chromium only):
 *  1. create an account while the Cloudflare Security check is blocked (the "Email me a code instead" way in, the office
 *     contact beside the blocked message, the same words for an address that has an account and one that has not), then the
 *     emailed verification code;
 *  2. find an event, register with a promo code and choose to pay by card, and reach the card step (Square cannot be reached
 *     with the fictitious ids this run uses, so the card form or its fallback is what shows). Run again with the
 *     Google-Translate simulation and with the privacy-browser blocker lists, the second time with the page's own price preview
 *     failing: the amount on the card step and the recorded total are still the server's numbers (P1);
 *  3. manage the registration as that account (My registrations: find it, update the contact details, the status filter links);
 *  4. ask to cancel it, a staff member approves and carries it out, and the attendee's list says Cancelled.
 * Phase B uses it like event staff would, each journey in a browser signed in as a stamped synthetic staff user:
 *  5. create an event from a template (/event-setup/from-template). THE ONE STEP RUN AS A SYSTEM ADMINISTRATOR: that page is theirs
 *     only, so a stamped synthetic SYSTEM_ADMIN user's session is minted for it and for nothing else;
 *  6. the publish checklist, as that event's EVENT_ADMIN (a stamped staff user granted the role on the new event): "Set up this
 *     event" on the Overview, an attendee type, the event settings (one Save), then Publish event in the shared confirm dialog;
 *  7. the form builder (between the settings and Publish event): leave-with-unsaved-changes, Preview & test with Continue and Back,
 *     Run test submission (recorded as a test, no registration), publish the form version;
 *  8. the attendee list of an event with 55 stamped attendees (sort both ways, the pager, a filter that survives Back, Clear filters,
 *     an empty filter, search, Download CSV with its file name);
 *  9. check-in as CHECK_IN_STAFF: search, Check in, Undo (the /check-in-station screen is not covered yet);
 * 10. a scheduled email as the COMMUNICATIONS_MANAGER: New schedule, Review, Save, Approve, then the sweep as the scheduler calls it,
 *     the email in the dev outbox for the three stamped recipients only, and the page saying it was sent;
 * 14. staff without the permission (CHECK_IN_STAFF) opening finance and scheduled emails see the shared no-access state.
 * Every page a journey visits is checked against docs/SITE-RULES.md (scripts/support/site-rule-checks.ts).
 *
 * LOCAL USE ONLY (see scripts/support/browser-journeys.ts): synthetic rows only, sessions minted for the staff context, and it
 * refuses a production NODE_ENV or a database or URL that is not on this machine.
 *
 * TWO APPS. Journey 1 needs the Security check switched on, journeys 2 to 4 need it off (a public form with no token goes
 * through a much stricter limit). So two copies of the built app run on one database: JOURNEY_BASE_URL (default
 * http://localhost:3000, no Turnstile) and JOURNEY_TURNSTILE_BASE_URL (default http://localhost:3002, Cloudflare's published
 * always-pass test keys; the suite blocks challenges.cloudflare.com in the browser so the Security check cannot load, which is the
 * case under test). Both run with the dev outbox and the fictitious Square sandbox values (below).
 *
 * THE DEV OUTBOX. In production mode the app never returns a code in a response, so the suite starts a small Resend look-alike
 * (scripts/support/fake-mail-server.ts) on JOURNEY_MAIL_PORT (default 3999) and reads the emailed codes from it.
 *
 * RUN LOCALLY, step by step
 *   1. Seeded database: npm run db:deploy && npm run db:seed, then club-forms:sync, lodging:sync, form-templates:sync,
 *      event-content:sync.
 *   2. npm i --no-save playwright@1.63.0 && npx playwright install chromium
 *   3. npm run build, then start BOTH apps (production mode). The shared variables:
 *        MANAGE_LINK_DERIVATION_SECRET=ci-only-manage-link-derivation-secret-0000000
 *        ATTENDEE_PASS_SIGNING_SECRET=ci-only-attendee-pass-signing-secret-000000
 *        RATE_LIMIT_HASH_SECRET=ci-only-rate-limit-hash-secret-0000000000
 *        OUTBOX_SWEEP_TOKEN=ci-only-outbox-sweep-token-000000000000
 *        SECRET_ENCRYPTION_KEY=ci-only-secret-encryption-key-00000000000
 *        ACCOUNT_EMAIL_SENDER_ADDRESS=events@ci.example.test  RESEND_API_KEY=ci-placeholder-never-sent
 *        RESEND_API_URL=http://127.0.0.1:3999
 *        SQUARE_ENVIRONMENT=sandbox SQUARE_APPLICATION_ID=sandbox-sq0idb-synthetic SQUARE_LOCATION_ID=LSYNTHETIC
 *        SQUARE_ACCESS_TOKEN=synthetic-token-never-used SQUARE_WEBHOOK_SIGNATURE_KEY=synthetic-signature-key-0000
 *        SQUARE_WEBHOOK_NOTIFICATION_URL=https://events.example.test/api/webhooks/square
 *      then:  npm run start -- -p 3000
 *      and:   APP_BASE_URL=http://localhost:3002 TURNSTILE_SITE_KEY=1x00000000000000000000AA \
 *             TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA TURNSTILE_ALLOWED_HOSTNAMES=localhost \
 *             npm run start -- -p 3002
 *      (the same two start lines are what .github/workflows/ci.yml does for "Event journeys (real browser)").
 *   4. npm run test:event-journeys (both widths, one after the other), or JOURNEY_SHARD=desktop / phone for one.
 *   JOURNEY_ONLY=1,3,T runs only those journeys (1 creates the account that 3 and 4 use, 2 makes the registration they use, so
 *   JOURNEY_ONLY=3 runs 1 and 2 as well; 6 and 7 run 5 first; the ids are 1 2 3 4 5 6 7 8 9 10 14 T B P); JOURNEY_DEBUG=1 prints the page when a step fails; JOURNEY_KEEP_DATA=1 keeps the seeded
 *   rows. Each shard seeds its own data (the run stamp includes the shard).
 *
 * Environment: JOURNEY_BASE_URL, JOURNEY_TURNSTILE_BASE_URL, JOURNEY_SHARD (desktop = 1280 wide, phone = 390 wide, unset = both),
 * JOURNEY_MAIL_PORT, JOURNEY_KEEP_DATA, JOURNEY_ONLY, JOURNEY_DEBUG, JOURNEY_BROWSERS (default chromium).
 *
 * The platform's central email sender is set for the run when the database has none (a publish and scheduled email need it) and put
 * back at the end. The sweep (journey 10) uses OUTBOX_SWEEP_TOKEN from the environment, then the CI value.
 *
 * Budgets: the sign-in, sign-up, Security check, public registration and payment send limits would stop repeated local runs, so the
 * suite clears those buckets on the local database before it starts.
 *
 * KNOWN_BUGS POLICY. Same as scripts/verify-club-journeys.ts: a failing rule check that is the SITE's fault (checked in the
 * source, not a test mistake) is never weakened or skipped. It is added to KNOWN_BUGS with an id, a one-line description naming the
 * file, and the exact check label(s) (`page | rule | what`). It then shows as an "expected failure" and does not fail the run, and
 * the run FAILS if that check unexpectedly passes, so the entry is deleted in the same change that fixes the site. A new, unlisted
 * failure always fails the run.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import * as J from "./support/browser-journeys";
import { FINANCE_EMAIL, cleanupEventWorld, eventFormDefinition, emailFor, resetEventBudgets, seedEventWorld, seedExistingAccount, type EventWorld, type StaffRole } from "./support/event-journey-data";
import { FakeMailServer } from "./support/fake-mail-server";
import * as S from "./support/journey-steps";
import { assertLocalUrl } from "./support/local-only-guard";
import { PREVIEW_FAILS_INIT_SCRIPT, blockedBy } from "./support/privacy-block-lists";
import {
  APPROVED_STATUS_WORDS, Recorder, checkBrowserOnlyEmail, checkEmptyState, checkErrorSummary, checkErroredFocus, checkFocusRing, checkInFlightLabel, checkNoAccess, checkRestricted,
  checkPage, checkConfirmDialog, checkDialogBehavior, checkLeaveWarning, checkSaveFlow, checkSearchLive, checkSearchWithoutScript, checkTypedFields, clean, holdRequest, pollPage, type KnownBug,
} from "./support/site-rule-checks";

loadEnvConfig(process.cwd());

const turnstileBase = (process.env.JOURNEY_TURNSTILE_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");

/** Failures that are the site's fault (found by these journeys). The label is what the failing check prints. */
export const KNOWN_BUGS: KnownBug[] = [];

type Viewport = { name: "desktop" | "phone"; width: number };
const viewports: Viewport[] = [{ name: "desktop", width: 1280 }, { name: "phone", width: 390 }];

type Attendee = { email: string; password: string; name: string; accountId: string | null };

type Ctx = {
  browser: J.Browser;
  world: EventWorld;
  mail: FakeMailServer;
  rec: Recorder;
  viewport: Viewport;
  prisma: PrismaClient;
  tokens: string[];
  staffTokens: string[];
  attendee: Attendee;
  /** What the journeys learn on the way: the registration made in journey 2. */
  registration?: { id: string; confirmationCode: string; cardChargeCents: number; subtotalCents: number };
  /** Journey 5 makes this event from a template; journeys 6 and 7 work on it. */
  created?: { id: string; slug: string; name: string };
};

const problems: string[] = [];

function failStep(ctx: Ctx, journey: string, error: unknown) {
  const message = `${ctx.viewport.name}: ${journey}: ${(error as Error).message.split("\n").slice(0, 3).join(" ").slice(0, 500)}`;
  console.error(`  FAIL ${message}`);
  problems.push(message);
}

let lastPage: J.Page | null = null;
let blockedRequests = 0;

async function journey(ctx: Ctx, name: string, run: () => Promise<void>) {
  const started = Date.now();
  console.log(`  - ${name}`);
  let ok = true;
  try {
    await run();
  } catch (error) {
    ok = false;
    failStep(ctx, name, error);
    // JOURNEY_DEBUG=1 shows what the person would have been looking at when a step failed.
    if (process.env.JOURNEY_DEBUG && lastPage) console.error(`    page ${lastPage.url()}:\n${(await J.bodyText(lastPage).catch(() => "")).split("\n").filter(Boolean).slice(0, 80).join("\n")}`);
  }
  console.log(`    (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return ok;
}

/** A page is interactive once React has attached to it (a click before that is lost). */
async function settle(page: J.Page) {
  lastPage = page;
  await page.waitForLoadState("load");
  await page.waitForFunction(() => [...document.body.querySelectorAll("*")].slice(0, 400).some((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber$"))), undefined, { timeout: 20_000 });
  // A streamed page can hydrate its shell before its content arrives (a run once saw 21 characters on a no-access page).
  // Wait for real content; a page that stays blank still fails the health check that follows.
  await page.waitForFunction(() => (document.body?.innerText ?? "").trim().length >= 40, undefined, { timeout: 15_000 }).catch(() => undefined);
}

/** The page is loaded, healthy, and passes the passive SITE-RULES checks (with the look rules on). */
async function visited(ctx: Ctx, page: J.Page, name: string, options: { rules?: boolean } = {}) {
  await settle(page);
  await J.assertHealthy(page, `${ctx.viewport.name}: ${name}`, problems);
  if (options.rules !== false) await checkPage(page, ctx.rec, name, { look: true });
}

async function visit(ctx: Ctx, page: J.Page, name: string, path: string, options: { rules?: boolean } = {}) {
  await S.openPage(page, path);
  await visited(ctx, page, name, options);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A pattern for a label or a button name that still matches when the translation simulator puts "[es] " in front of it. */
const named = (text: string) => new RegExp(`^(\\[es\\] )?${esc(text)}(\\s*\\*)?(\\s*\\(required\\))?$`);
/** A field by its label; a field with a problem has its message inside the label, so only the start is matched. */
const label = (page: J.Page, text: string) => page.getByLabel(new RegExp(`^(\\[es\\] )?${esc(text)}`));
const button = (page: J.Page, text: string) => page.getByRole("button", { name: named(text) });

/**
 * Square's own script refuses the fictitious application id this run configures ("initializing the payment method"): that is
 * not ours to fix and not what is under test (the card form or its fallback showing is), so it is not a failure (the same
 * tolerance as scripts/verify-privacy-browsers.ts).
 */
const TOLERATED_PAGE_ERRORS = [/initializing the payment method/i];
/**
 * With the page's own price preview made to throw (journey 2's last variant) React notes that the browser's page differs from
 * the server's: that is the failure being simulated, so only that variant tolerates it (as scripts/verify-privacy-browsers.ts does).
 */
const PREVIEW_FAILURE_ERRORS = [/Minified React error #(418|423|425)/, /hydrat/i];
const watch = (page: J.Page, tolerated: RegExp[] = []) => J.watchPage(page, {
  push: (...items: string[]) => { for (const item of items) if (![...TOLERATED_PAGE_ERRORS, ...tolerated].some((pattern) => pattern.test(item))) problems.push(item); return problems.length; },
} as unknown as string[]);

async function newAttendeeContext(ctx: Ctx, options: { translate?: boolean; block?: "cloudflare" | "lists"; previewFails?: boolean; cookie?: Awaited<ReturnType<typeof J.mintDirectorSession>> } = {}) {
  const context = await J.newContext(ctx.browser, { translate: Boolean(options.translate), cookie: options.cookie, width: ctx.viewport.width });
  context.setDefaultTimeout(20_000);
  if (options.block) {
    await context.route("**/*", async (route: { request(): { url(): string }; abort(reason?: string): Promise<void>; continue(): Promise<void> }) => {
      try {
        const url = route.request().url();
        // The one case under test in journey 1: only the Security check is blocked. The lists block it and much more.
        const blocked = options.block === "cloudflare" ? /^https:\/\/challenges\.cloudflare\.com\//.test(url) : blockedBy(url);
        if (blocked) { blockedRequests += 1; return await route.abort("blockedbyclient"); }
        return await route.continue();
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
  }
  if (options.previewFails) await context.addInitScript(PREVIEW_FAILS_INIT_SCRIPT);
  const page = await context.newPage();
  watch(page, options.previewFails ? PREVIEW_FAILURE_ERRORS : []);
  lastPage = page;
  return { context, page };
}

/* ---------------------------------------------------------------- 1. create an account (Security check blocked) */

async function signUpJourney(ctx: Ctx, page: J.Page) {
  const { rec, mail, attendee } = ctx;
  const { getFormsHelpContact } = await import("../modules/system-admin/platform-settings");
  const { telHref } = await import("../modules/system-admin/forms-help-contact");
  const contact = await getFormsHelpContact();

  await S.openPage(page, `${turnstileBase}/account/sign-up`);
  // The Security check cannot load (challenges.cloudflare.com is blocked), so its blocked message and Try again show.
  const group = page.getByTestId("security-check");
  await group.getByTestId("security-check-retry").waitFor({ state: "visible", timeout: 25_000 });
  await visited(ctx, page, "Create account (Security check blocked)");

  // T4: the office contact sits beside the blocked message, with translate="no" on the email and the phone.
  const contactBox = group.getByTestId("security-check-contact");
  await contactBox.waitFor({ state: "visible", timeout: 5_000 });
  const mailLink = contactBox.locator('a[href^="mailto:"]');
  const phoneLink = contactBox.locator('a[href^="tel:"]');
  const shownEmail = clean((await mailLink.textContent()) ?? "");
  const shownPhone = clean((await phoneLink.textContent()) ?? "");
  const noTranslate = (await mailLink.getAttribute("translate")) === "no" && (await phoneLink.getAttribute("translate")) === "no";
  const inside = (await group.innerText()).includes("could not load");
  rec.record("Create account (Security check blocked)", "T4", "the office contact is beside the blocked message", inside && shownEmail === contact.email && shownPhone === contact.phone && (await mailLink.getAttribute("href")) === `mailto:${contact.email}` && (await phoneLink.getAttribute("href")) === telHref(contact.phone) ? "pass" : "fail", `shown: ${shownEmail}, ${shownPhone} (the footer help setting says ${contact.email}, ${contact.phone})`);
  rec.record("Create account (Security check blocked)", "T4", "translate=\"no\" on the email and the phone", noTranslate ? "pass" : "fail", noTranslate ? "both links carry translate=\"no\"" : "the email or the phone can be rewritten by a translator");

  // L2 on the name field, L5 (Create account is disabled until the password is good) is read by checkPage above.
  await checkFocusRing(page, rec, "Create account (Security check blocked)", label(page, "Your name"));

  // B8: a bad email address is caught the shared way.
  const emailField = label(page, "Email address");
  await checkBrowserOnlyEmail(page, rec, "Create account (Security check blocked)", emailField);

  // T3: "Email me a code instead" needs the email first; pressing it with none says so.
  const emailCode = group.getByTestId("security-check-email-code-button");
  await emailCode.click();
  await group.getByText("Type your email address in the form first").waitFor({ state: "visible", timeout: 5_000 });
  await label(page, "Your name").fill(attendee.name);
  await emailField.fill(attendee.email);
  const sentAfter = Date.now() - 1_000;
  await emailCode.click();
  await group.getByTestId("security-check-code-input").waitFor({ state: "visible", timeout: 20_000 });
  assert(/we sent a code/i.test(await group.innerText()), "the Security check did not say a code was sent");
  const securityCode = await mail.waitForCodeWithSubject(attendee.email, /security code/i, { since: sentAfter });
  if (process.env.JOURNEY_DEBUG) console.error(`    security code ${securityCode}: ${JSON.stringify(mail.to(attendee.email).map((m) => [m.subject, m.text.slice(0, 200)]))}`);
  await group.getByTestId("security-check-code-input").fill(securityCode);

  // The password, then Create account. B10: the button says what it is doing while the request is in flight.
  await label(page, "Password").first().fill(attendee.password);
  if (process.env.JOURNEY_DEBUG) page.on("response", async (response: { url(): string; status(): number; text(): Promise<string> }) => { if (/\/api\/attendee\/sign-up/.test(response.url())) console.error(`    sign-up ${response.status()} ${(await response.text().catch(() => "")).slice(0, 300)}`); });
  const create = page.getByRole("button", { name: /^Create account$/ });
  await create.waitFor({ state: "visible" });
  const held = await holdRequest(page, (url, method) => method === "POST" && url.endsWith("/api/attendee/sign-up"));
  const verifySince = Date.now() - 1_000;
  await create.click();
  await Promise.race([held.hit, page.waitForTimeout(8_000)]);
  const working = clean((await page.getByRole("button", { name: /Creating|Create account/ }).first().textContent()) ?? "");
  rec.record("Create account (Security check blocked)", "B10", "Create account says what it is doing while working", /…$/.test(working) ? "pass" : "fail", `while the request was in flight the button said "${working}"`);
  await held.stop();
  await page.getByText(/Check\s+\S+@\S+/).first().waitFor({ state: "visible", timeout: 25_000 });
  await visited(ctx, page, "Create account (check your email)");

  // The emailed verification code: lands signed in.
  await S.enterSignUpVerificationCode(page, mail, { email: attendee.email, since: verifySince });
  await visited(ctx, page, "Account home (just signed up)");
  const row = await ctx.prisma.attendeeAccount.findFirst({ where: { email: attendee.email }, select: { id: true, emailVerifiedAt: true } });
  assert(row?.emailVerifiedAt, "the new account was not verified after the emailed code");
  attendee.accountId = row.id;
  ctx.world.accountIds.push(row.id);
  // T3: with the Security check blocked, the emailed code stood in for its token, and the person really has an account (a verified
  // row in the database) and is signed in (the account home greets them by name).
  const greeted = await page.getByText(/Hello,/).first().isVisible().catch(() => false);
  rec.record("Create account (Security check blocked)", "T3", "an emailed code lets the person create an account and sign in", greeted && Boolean(row.emailVerifiedAt) ? "pass" : "fail", greeted ? "the account row is verified and the account home greets the person" : "the account exists but the person is not shown as signed in");
}

/** T3 and T5 on the sign-in page: the emailed code for an address with an account and for one without get the same status and words. */
async function emailCodeSamenessJourney(ctx: Ctx, page: J.Page) {
  const { rec, mail } = ctx;
  const existing = await seedExistingAccount(ctx.prisma, ctx.world);
  const stranger = emailFor(ctx.world, "nobody-has-this");
  await S.openPage(page, `${turnstileBase}/account/sign-in`);
  const group = page.getByTestId("security-check");
  await group.getByTestId("security-check-retry").waitFor({ state: "visible", timeout: 25_000 });
  await visited(ctx, page, "Sign-in (Security check blocked)");
  const emailField = label(page, "Email address");
  const ask = async (address: string) => {
    await emailField.fill(address);
    const status = group.getByTestId("security-check-email-code").locator('[role="status"]');
    const wait = page.waitForResponse((response: { url(): string }) => response.url().endsWith("/api/security-check/email-code"));
    const clicked = Date.now() - 1_000;
    await group.getByTestId("security-check-email-code-button").click();
    const response = await wait;
    const body = await response.json().catch(() => ({}));
    await pollPage<string>(page, async () => clean((await status.textContent()) ?? ""), (text) => text.length > 0, 8_000);
    return { status: response.status(), message: String(body.message ?? ""), shown: clean((await status.textContent()) ?? ""), at: clicked };
  };
  const known = await ask(existing.email);
  const unknown = await ask(stranger);
  const same = known.status === unknown.status && known.message === unknown.message && known.shown === unknown.shown && known.status === 202 && known.shown.length > 0;
  rec.record("Sign-in (Security check blocked)", "T5", "the emailed-code answer is the same for an address with an account and one without", same ? "pass" : "fail", same ? `both answered ${known.status} "${known.shown}"` : `with an account: ${known.status} "${known.shown}"; without: ${unknown.status} "${unknown.shown}"`);
  // The only difference is the inbox: the address that has an account gets its code.
  const first = await mail.waitForCodeWithSubject(existing.email, /security code/i, { since: known.at });
  assert(/^\d{6}$/.test(first), "no six-digit code arrived for the address that has an account");
  // Sign in with it, the Security check still blocked: password, then the emailed code. With no code typed, Sign in sends nothing
  // and says what to do (never a dead end).
  await emailField.fill(existing.email);
  await label(page, "Password").first().fill(existing.password);
  const signIn = page.locator("form").getByRole("button", { name: S.exactly("Sign in") });
  await signIn.click();
  await group.getByText(/Enter the code from your email first|Press Email me a code instead/).first().waitFor({ state: "visible", timeout: 10_000 });
  // A new code, asked for now: only mail that arrives after this click counts (the first code's mail may have come a moment ago).
  const since = Date.now();
  await group.getByTestId("security-check-email-code-button").click();
  const code = await mail.waitForCodeWithSubject(existing.email, /security code/i, { since });
  assert(code !== first, "the second code asked for was the same message as the first");
  await group.getByTestId("security-check-code-input").fill(code);
  await signIn.click();
  await page.waitForURL((url: URL) => !/\/sign-in/.test(url.pathname), { timeout: 25_000 }).catch(async (error: Error) => {
    throw new Error(`${error.message.split("\n")[0]} at ${page.url()}; the page says: ${clean(await page.locator("main").innerText().catch(() => "?")).slice(-450)}`);
  });
  // Signed in: the account home greets the person by name.
  await S.openPage(page, `${turnstileBase}/account`);
  const greeted = await page.getByText(/Hello,/).first().waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
  rec.record("Sign-in (Security check blocked)", "T3", "an emailed code lets the person sign in", greeted ? "pass" : "fail", greeted ? "password plus the emailed code signed in an account that has no club role, and the account home greets them" : "the emailed code did not sign the person in");
}

/* ---------------------------------------------------------------- 2. find the event, register with a promo code, pay by card */

/** What the server makes of this registration, from the app's own shared functions (never read off a page): cents. */
async function expectedNumbers(ctx: Ctx) {
  const { calculateFormTotal, registrationFormDefinitionSchema } = await import("../modules/forms/definition");
  const { applyPromoCodeToCalculation, evaluatePromoCode, normalizePromoCode } = await import("../modules/promo-codes/domain");
  const { PRICES } = await import("./support/event-journey-data");
  const definition = registrationFormDefinitionSchema.parse(eventFormDefinition(ctx.world));
  const pricingDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const responses = { first_name: "Riley", last_name: "Journey", email: "x@example.test", ticket: "Standard", shirts: PRICES.shirts, promo_code: ctx.world.promoCode, payment_method: "Credit / debit card" };
  const calculation = calculateFormTotal(definition, responses, pricingDate);
  const row = await ctx.prisma.promoCode.findFirst({ where: { eventId: ctx.world.eventId, normalizedCode: normalizePromoCode(ctx.world.promoCode) } });
  assert(row, "the seeded promo code is missing");
  const rule = { id: row.id, code: row.code, normalizedCode: row.normalizedCode, isActive: row.isActive, discountType: row.discountType, discountValue: row.discountValue, startsOn: row.startsOn, endsOn: row.endsOn, minimumSubtotalCents: row.minimumSubtotalCents, maximumUses: row.maximumUses, maximumDiscountCents: row.maximumDiscountCents, redeemedCount: 0 };
  const evaluation = evaluatePromoCode(rule, { submittedCode: ctx.world.promoCode, eligibleSubtotalCents: calculation.subtotalCents, pricingDate });
  assert(evaluation.valid, "the seeded promo code is not valid for the seeded form");
  const applied = applyPromoCodeToCalculation(definition, responses, calculation, evaluation);
  // The functions and the seed agree with plain arithmetic (so a change to either cannot make the check pass by itself).
  const gross = PRICES.standard + PRICES.shirt * PRICES.shirts;
  assert(applied.preDiscountSubtotalCents === gross && applied.discountAmountCents === Math.round(gross * PRICES.promoBasisPoints / 10_000), "the shared pricing function disagrees with the seeded prices");
  return { grossCents: applied.preDiscountSubtotalCents, discountCents: applied.discountAmountCents, subtotalCents: applied.subtotalCents, feeCents: applied.processingFeeCents, cardChargeCents: applied.totalCents };
}

async function findEventJourney(ctx: Ctx, page: J.Page) {
  const { rec, world } = ctx;
  await S.openPage(page, "/events");
  // The search box's search-as-you-type attaches once the page's scripts have all run.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await visited(ctx, page, "Events list");
  const box = page.locator('input[type="search"]').first();
  // S5 (the box keeps focus and the count is announced) and L2 (its ring).
  await checkFocusRing(page, rec, "Events list", box);
  // A search that matches nothing always changes the count the page announces (this run's event may be the only one listed).
  await checkSearchLive(page, rec, "Events list", { box, query: "zzqx-no-event-has-this" });
  await box.fill("");
  const link = page.locator(`a[href="/events/${world.eventSlug}"]`);
  await link.first().waitFor({ state: "visible", timeout: 15_000 });
  await checkSearchWithoutScript(ctx.browser, rec, "Events list", { url: `${J.baseUrl}/events`, query: world.eventName, expectText: world.eventName });
  await link.first().click();
  await page.waitForURL(new RegExp(`/events/${world.eventSlug}$`), { timeout: 20_000 });
  await visited(ctx, page, "Event page");
  await page.getByRole("link", { name: /^Register/ }).first().click();
  await page.waitForURL(new RegExp(`/register/${world.eventSlug}/${world.formSlug}`), { timeout: 20_000 });
}

type RegisterOptions = { email: string; rules: boolean; mode: "plain" | "translate" | "lists" | "preview"; phone?: string };

/** The form's two steps, the promo code, the card choice, Submit; returns once "Registration received" shows. */
async function fillAndSubmitRegistration(ctx: Ctx, page: J.Page, options: RegisterOptions) {
  const { rec, world } = ctx;
  const rules = options.rules;
  await settle(page);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await button(page, "Continue").waitFor({ state: "visible", timeout: 20_000 });
  if (rules) await visited(ctx, page, "Registration form: About you");

  const first = label(page, "First name");
  const email = label(page, "Email");
  const phone = label(page, "Mobile phone");
  if (rules) {
    // L2: a focused field (still without a problem) shows the one ring.
    await checkFocusRing(page, rec, "Registration form: About you", first);
    // A signed-in person arrives with their name and email filled in; clear them to see what an empty form says.
    for (const field of [first, label(page, "Last name"), email]) await field.fill("");
    // B7: leaving the required answers empty and pressing Continue shows the shared summary and a message by each field.
    await checkErrorSummary(page, rec, "Registration form: About you", "required answers missing", () => button(page, "Continue").click());
    // B8 and L3 on the contact fields.
    await checkTypedFields(page, rec, "Registration form: About you", { phone, email, birthDate: label(page, "Date of birth") });
    await checkErroredFocus(page, rec, "Registration form: About you", email);
  }
  await first.fill("Riley");
  await label(page, "Last name").fill("Journey");
  await email.fill(options.email);
  await phone.fill(options.phone ?? "(515) 555-0100");
  await button(page, "Continue").click();

  await label(page, "Standard").first().check().catch(async () => { await page.getByLabel(/Standard/).first().check(); });
  await label(page, "Shirts").fill(String(2));
  await label(page, "Promo code").fill(world.promoCode.toLowerCase());
  await page.getByLabel(/Credit \/ debit card/).first().check();
  const apply = page.locator(".public-registration-promo-control button").first();
  if (rules) {
    await checkInFlightLabel(page, rec, "Registration form: choices and payment", "Apply (promo code)", { button: apply, click: () => apply.click(), match: (url, method) => method === "POST" && url.endsWith("/promo-code"), expect: /Checking…/ });
  } else await apply.click();
  // "Apply" becomes "Remove" once the server accepts the code.
  await page.locator(".public-registration-promo-control button", { hasText: named("Remove") }).waitFor({ state: "visible", timeout: 25_000 });
  if (options.mode === "preview") {
    await page.getByTestId("preview-unavailable").first().waitFor({ state: "visible", timeout: 10_000 });
    assert(/calculated when you submit/i.test(clean(await page.locator(".public-registration-summary").first().innerText())), "the page did not say the total is calculated when it is submitted");
    assert(await page.evaluate(() => (window as unknown as { __previewThrew?: boolean }).__previewThrew === true), "the injected price-preview failure never reached the page");
  }
  if (rules) await visited(ctx, page, "Registration form: choices and payment");

  const submit = page.getByRole("button", { name: /Submit registration|Submitting/ }).first();
  if (rules) {
    await checkInFlightLabel(page, rec, "Registration form: choices and payment", "Submit registration", { button: submit, click: () => submit.click(), match: (url, method) => method === "POST" && url.endsWith("/registrations"), expect: /Submitting…/ });
  } else await submit.click();
  await page.getByText(named("Registration received")).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 30_000 });
}

/** The recorded registration for this email: the server's numbers (P1), read from the database. */
async function recordedRegistration(ctx: Ctx, email: string, expected: Awaited<ReturnType<typeof expectedNumbers>>) {
  const find = () => ctx.prisma.registration.findFirst({
    where: { eventId: ctx.world.eventId, contactSnapshot: { path: ["email"], equals: email } },
    select: { id: true, confirmationCode: true, totalAmount: true, status: true, contactSnapshot: true },
  });
  let row = await find();
  for (let attempt = 0; !row && attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    row = await find();
  }
  assert(row, `the registration for ${email} was not stored`);
  const total = Math.round(Number(row.totalAmount) * 100);
  assert(total === expected.subtotalCents, `the recorded total is ${total} cents, the server's own number is ${expected.subtotalCents}`);
  const redemption = await ctx.prisma.promoCodeRedemption.findUnique({ where: { registrationId: row.id }, select: { discountAmountCents: true, eligibleSubtotalCents: true } });
  assert(redemption, "the promo code redemption was not recorded");
  assert(redemption.discountAmountCents === expected.discountCents && redemption.eligibleSubtotalCents === expected.grossCents, `the recorded discount is ${redemption.discountAmountCents} of ${redemption.eligibleSubtotalCents}, the server's own numbers are ${expected.discountCents} of ${expected.grossCents}`);
  assert((await ctx.prisma.paymentAttempt.count({ where: { registrationId: row.id } })) === 0, "a payment attempt exists although no card was submitted");
  return row;
}

/** The card step: "Pay $X securely with Square" with the server's amount; Square's form or its fallback shows. */
async function cardStep(ctx: Ctx, page: J.Page, expected: Awaited<ReturnType<typeof expectedNumbers>>, options: { mode: RegisterOptions["mode"]; rules: boolean }) {
  const { formatCents } = await import("../modules/payments/format-cents");
  const link = page.getByRole("link", { name: /Continue to secure card payment/ });
  await link.first().waitFor({ state: "visible", timeout: 20_000 });
  if (options.rules) await visited(ctx, page, "Registration received");
  await link.first().click();
  const heading = `Pay ${formatCents(expected.cardChargeCents)} securely with Square`;
  const shown = await pollPage<string>(page, async () => clean(await page.locator("main").first().innerText()), (text) => text.includes(heading), 25_000);
  assert(shown.ok, `the card step did not say "${heading}" (the server's amount); it says: ${clean(shown.value ?? "").slice(0, 200)}`);
  // Square cannot be reached with the fictitious ids this run uses: its card form or the plain fallback is what shows.
  const failure = page.getByTestId("square-load-failed");
  const frame = page.locator(".public-square-card-frame iframe");
  await Promise.race([failure.waitFor({ timeout: 30_000 }), frame.first().waitFor({ timeout: 30_000 })]);
  if (options.mode === "lists") assert(await failure.isVisible(), "with Square's address blocked the card step showed no fallback");
  if (await failure.isVisible()) {
    const text = clean(await failure.innerText());
    assert(/could not load/i.test(text) && /Try again/.test(text), `the card-form fallback was unclear: ${text}`);
  }
  if (options.rules) await visited(ctx, page, "Card payment step");
}

async function registerJourney(ctx: Ctx, page: J.Page, options: RegisterOptions, fromList: boolean) {
  const expected = await expectedNumbers(ctx);
  if (fromList) await findEventJourney(ctx, page);
  else await S.openPage(page, `/register/${ctx.world.eventSlug}/${ctx.world.formSlug}`);
  await fillAndSubmitRegistration(ctx, page, options);
  const row = await recordedRegistration(ctx, options.email, expected);
  await cardStep(ctx, page, expected, { mode: options.mode, rules: options.rules });
  if (options.mode === "plain") ctx.registration = { id: row.id, confirmationCode: row.confirmationCode, cardChargeCents: expected.cardChargeCents, subtotalCents: expected.subtotalCents };
}

/** Journey 2 again, as a person would meet it under the translator or a privacy browser: P1, the amounts are still the server's. */
async function registerVariant(ctx: Ctx, mode: "translate" | "lists" | "preview") {
  const email = emailFor(ctx.world, mode);
  const { context, page } = await newAttendeeContext(ctx, { translate: mode === "translate", block: mode === "translate" ? undefined : "lists", previewFails: mode === "preview" });
  const blockedAtStart = blockedRequests;
  try {
    await registerJourney(ctx, page, { email, rules: false, mode }, false);
    await J.assertHealthy(page, `${ctx.viewport.name}: ${mode} card step`, problems);
    if (mode !== "translate") {
      console.log(`    (${blockedRequests - blockedAtStart} request(s) were blocked by the filter lists)`);
      assert(blockedRequests > blockedAtStart, "the blocker lists blocked no request in this journey, so it proved nothing");
    } else {
      const exact: string[] = await page.evaluate("window.__translationSimExactValues()");
      assert(exact.length === 0, `translate="no" values were rewritten: ${exact.join(" | ")}`);
      await page.waitForFunction(() => (window as unknown as { __translationSim: { wrapped: number } }).__translationSim.wrapped >= 20, undefined, { timeout: 30_000 })
        .catch(async () => { throw new Error(`the simulator rewrote only ${await page.evaluate("window.__translationSim.wrapped")} text nodes; it is not running`); });
    }
  } catch (error) {
    // The context closes below, so show what the person was looking at now.
    if (process.env.JOURNEY_DEBUG) console.error(`    page ${page.url()}:\n${(await J.bodyText(page).catch(() => "")).split("\n").filter(Boolean).slice(0, 70).join("\n")}`);
    throw error;
  } finally {
    await context.close();
  }
}

/* ---------------------------------------------------------------- 3. manage the registration */

const portalCard = (page: J.Page, ctx: Ctx) => page.locator("article.attendee-ov-card").filter({ hasText: ctx.registration!.confirmationCode });

/** B12 for the registration card's own status pill: one of the approved words. */
async function checkCardStatus(ctx: Ctx, page: J.Page, name: string, expected?: string) {
  const pill = clean((await portalCard(page, ctx).locator(".attendee-ov-card-title .status-chip").first().textContent()) ?? "");
  const approved = APPROVED_STATUS_WORDS.some((word) => word.toLowerCase() === pill.toLowerCase());
  ctx.rec.record(name, "B12", "the registration's status shows an approved word", approved && (!expected || pill === expected) ? "pass" : "fail", `the card's status says "${pill}"${expected ? ` (expected "${expected}")` : ""}`);
}

async function openDisclosure(page: J.Page, ctx: Ctx, text: string) {
  const summary = portalCard(page, ctx).locator("summary").filter({ hasText: text }).first();
  await summary.click();
  return summary;
}

async function manageJourney(ctx: Ctx, page: J.Page) {
  const { rec } = ctx;
  const reg = ctx.registration;
  assert(reg, "journey 3 needs the registration journey 2 makes");
  const name = "My registrations";
  await visit(ctx, page, name, "/account/registrations");
  const card = portalCard(page, ctx);
  await card.first().waitFor({ state: "visible", timeout: 20_000 });
  assert(await card.getByText(ctx.world.eventName).count(), "the registration card does not name the event");
  await checkCardStatus(ctx, page, name);

  // The card step is also offered from the account: "Continue payment" shows the server's amount.
  const { formatCents } = await import("../modules/payments/format-cents");
  await openDisclosure(page, ctx, "Continue payment");
  const heading = `Pay ${formatCents(reg.cardChargeCents)} securely with Square`;
  const paid = await pollPage<string>(page, async () => clean(await card.innerText()), (text) => text.includes(heading), 25_000);
  assert(paid.ok, `Continue payment did not say "${heading}"; the card says: ${clean(paid.value ?? "").slice(0, 200)}`);

  // Update contact details: an emailed code, one Save, the same Saved words.
  await openDisclosure(page, ctx, "Update contact details");
  await card.locator("details.public-manage-contact-card > summary").click();
  const form = card.locator("form").filter({ has: page.getByRole("button", { name: /Email a code/ }) });
  await form.waitFor({ state: "visible", timeout: 10_000 });
  const phone = form.getByLabel(/^Phone/);
  const email = form.getByLabel(/^Email/);
  await checkTypedFields(page, rec, "Update contact details", { phone, email });
  await checkErroredFocus(page, rec, "Update contact details", email);
  await email.fill(ctx.attendee.email);
  const sentAfter = Date.now() - 1_000;
  await form.getByRole("button", { name: /Email a code/ }).click();
  const code = await ctx.mail.waitForCodeWithSubject(ctx.attendee.email, /edit verification code/i, { since: sentAfter });
  await form.getByLabel(/Six-digit edit code/).fill(code);
  const newPhone = "(515) 555-0111";
  await phone.fill(newPhone);
  const save = form.locator('button[type="submit"]');
  await checkSaveFlow(page, rec, "Update contact details", "contact details", {
    form, button: save, click: () => save.click(),
    match: (url, method) => method === "PATCH" && url.includes(`/api/attendee/registrations/${reg.id}`),
    done: () => pollPage<string>(page, async () => clean((await form.locator('[role="status"], [role="alert"]').allInnerTexts()).join(" ")), (text) => /saved|not saved|could not/i.test(text), 15_000),
  });
  const stored = await ctx.prisma.registration.findUnique({ where: { id: reg.id }, select: { contactSnapshot: true } });
  assert((stored?.contactSnapshot as { phone?: string } | null)?.phone === newPhone, `the saved phone is "${(stored?.contactSnapshot as { phone?: string } | null)?.phone}", expected ${newPhone}`);
  await visited(ctx, page, "My registrations (contact updated)");

  await statusFilters(ctx, page, { all: 1, upcoming: 1, past: 0, cancelled: 0 });

  // B14: a staff page opened as an attendee says the shared thing and who to ask.
  await S.openPage(page, "/finance/cancellation-requests");
  await settle(page);
  await checkNoAccess(page, rec, "Staff page opened as an attendee", ctx.attendee.email);
  await visited(ctx, page, "Staff page opened as an attendee");
}

/** The status filter links (All, Upcoming, Past, Cancelled): counts, the address (B2), and an empty view that says why and what to do next (B4). */
async function statusFilters(ctx: Ctx, page: J.Page, counts: { all: number; upcoming: number; past: number; cancelled: number }, options: { after?: boolean } = {}) {
  const { rec } = ctx;
  const name = options.after ? "My registrations (after cancelling)" : "My registrations (filters)";
  await S.openPage(page, "/account/registrations");
  await visited(ctx, page, name);
  rec.record(name, "L6", "tabs use the shared tablist with arrow keys", "n/a", "the status filters are links in a nav (each to its own address, aria-current on the chosen one), not a tablist");
  const nav = page.getByRole("navigation", { name: "Show registrations" });
  const labels = (await nav.locator("a").allInnerTexts()).map((text: string) => clean(text));
  const want = [`All (${counts.all})`, `Upcoming (${counts.upcoming})`, `Past (${counts.past})`, `Cancelled (${counts.cancelled})`];
  assert(JSON.stringify(labels) === JSON.stringify(want), `the status filter links read ${JSON.stringify(labels)}, expected ${JSON.stringify(want)}`);
  // B2: choosing a tab puts it in the address; Back goes to the one before; a shared link opens on that tab.
  await nav.getByRole("link", { name: /^Past/ }).click();
  await page.waitForURL((url: URL) => url.searchParams.get("show") === "past", { timeout: 15_000 });
  await settle(page);
  const current = async () => clean((await nav.locator('a[aria-current="true"]').first().textContent().catch(() => "")) ?? "");
  const onPast = /^Past/.test(await current());
  await page.goBack({ waitUntil: "load" });
  await settle(page);
  const backOnAll = new URL(page.url()).searchParams.get("show") === null && /^All/.test(await current());
  await S.openPage(page, "/account/registrations?show=cancelled");
  await settle(page);
  const sharedLink = /^Cancelled/.test(await current());
  rec.record(name, "B2", "the status filter is in the address (Back and shared links keep it)", onPast && backOnAll && sharedLink ? "pass" : "fail", `Past in the address: ${onPast}; Back returned to All: ${backOnAll}; ?show=cancelled opened on Cancelled: ${sharedLink}`);
  rec.record(name, "B2", "a filtered list has a Clear filters button", "n/a", "a single status filter whose All link is the way back (an empty view also links \"Show all my registrations\")");
  if (counts.upcoming === 0) {
    await S.openPage(page, "/account/registrations?show=upcoming");
    await settle(page);
    await checkEmptyState(page, rec, name, "the Upcoming tab", page.locator('.attendee-ov-empty[role="status"]'));
  }
  if (counts.past === 0) {
    await S.openPage(page, "/account/registrations?show=past");
    await settle(page);
    await checkEmptyState(page, rec, name, "the Past tab", page.locator('.attendee-ov-empty[role="status"]'));
  }
  if (counts.cancelled === 0) {
    await S.openPage(page, "/account/registrations?show=cancelled");
    await settle(page);
    await checkEmptyState(page, rec, name, "the Cancelled tab", page.locator('.attendee-ov-empty[role="status"]'));
  }
  await S.openPage(page, "/account/registrations");
  await settle(page);
}

/* ---------------------------------------------------------------- 4. cancel it */

async function cancelJourney(ctx: Ctx, page: J.Page) {
  const { rec } = ctx;
  const reg = ctx.registration;
  assert(reg, "journey 4 needs the registration journey 2 makes");
  const name = "My registrations (request cancellation)";
  await S.openPage(page, "/account/registrations");
  await settle(page);
  const card = portalCard(page, ctx);
  await card.first().waitFor({ state: "visible", timeout: 20_000 });
  const posts: string[] = [];
  const track = (request: { method(): string; url(): string; postData(): string | null }) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/attendee/registrations/${reg.id}/cancellation`)) posts.push(String((JSON.parse(request.postData() ?? "{}") as { action?: string }).action));
  };
  page.on("request", track);
  try {
    await openDisclosure(page, ctx, "Request cancellation");
    const panel = card.locator(".cancel-request-panel");
    await panel.waitFor({ state: "visible", timeout: 10_000 });
    await visited(ctx, page, name);
    await panel.getByRole("button", { name: "Show the proposed outcome" }).click();
    await panel.getByText("Proposed outcome").first().waitFor({ state: "visible", timeout: 20_000 });
    // B9: nothing has been sent but the preview; the request goes only when the person presses Send.
    rec.record(name, "B9", "a cancellation request is not sent until the person confirms it", JSON.stringify(posts) === JSON.stringify(["preview"]) ? "pass" : "fail", `requests so far: ${JSON.stringify(posts)}`);
    await panel.getByLabel(/Why are you asking/).fill(`Journey check ${ctx.world.stamp}: plans changed`);
    const send = panel.getByRole("button", { name: /Send request for review|Sending…/ });
    await checkInFlightLabel(page, rec, name, "Send request for review", { button: send, click: () => send.click(), match: (url, method, body) => method === "POST" && url.endsWith("/cancellation") && /"action":"submit"/.test(body ?? ""), expect: /Sending…/ });
    await panel.getByText(/Your request was sent/).waitFor({ state: "visible", timeout: 20_000 });
    assert(JSON.stringify(posts) === JSON.stringify(["preview", "submit"]), `the requests were ${JSON.stringify(posts)}`);
    // Undo: a sent request can be withdrawn, after its own confirmation.
    const withdraw = panel.getByRole("button", { name: /Withdraw/ });
    const undoOffered = await withdraw.first().isVisible();
    rec.record(name, "B9", "a sent request can be withdrawn (Undo)", undoOffered ? "pass" : "fail", undoOffered ? "\"Withdraw this request\" is offered" : "no way to take the request back");
    if (undoOffered) {
      await withdraw.first().click();
      const shared = await page.locator(".confirm-dialog").count();
      const inline = await panel.getByRole("group", { name: /Confirm withdrawing/ }).count();
      rec.record(name, "B9", "withdrawing asks in the shared dialog", shared > 0 ? "pass" : "fail", shared > 0 ? "the shared confirm dialog opened" : inline > 0 ? "it asks in its own inline step (\"Yes, withdraw it\" / \"Keep it\"), not the shared confirm dialog" : "nothing asked before the action");
      if (inline > 0) await panel.getByRole("button", { name: "Keep it" }).click();
      else if (shared > 0) await page.keyboard.press("Escape");
    }
  } finally {
    page.off("request", track);
  }
  const request = await ctx.prisma.cancellationRequest.findFirst({ where: { registrationId: reg.id }, select: { id: true, status: true } });
  assert(request && request.status !== "WITHDRAWN", `the cancellation request was not recorded (${request?.status ?? "none"})`);
  const stillThere = await ctx.prisma.registration.findUnique({ where: { id: reg.id }, select: { status: true } });
  assert(stillThere && stillThere.status !== "CANCELLED", "sending the request cancelled the registration at once; only a staff member may do that");

  // A staff member approves the request in the cancellation requests queue and carries it out.
  const cookie = await J.mintStaffSession(ctx.staffTokens, FINANCE_EMAIL);
  const staff = await J.newContext(ctx.browser, { translate: false, cookie, width: ctx.viewport.width });
  staff.setDefaultTimeout(20_000);
  const staffPage = await staff.newPage();
  watch(staffPage);
  try {
    await staffCancellation(ctx, staffPage, request.id);
  } finally {
    await staff.close();
  }

  // The attendee's list now says Cancelled (B12), under the Cancelled tab.
  await S.openPage(page, "/account/registrations?show=cancelled");
  await settle(page);
  await portalCard(page, ctx).first().waitFor({ state: "visible", timeout: 20_000 });
  await visited(ctx, page, "My registrations (cancelled)");
  await checkCardStatus(ctx, page, "My registrations (cancelled)", "Cancelled");
  const row = await ctx.prisma.registration.findUnique({ where: { id: reg.id }, select: { status: true } });
  assert(row?.status === "CANCELLED", `the registration is ${row?.status}, expected CANCELLED`);
  await statusFilters(ctx, page, { all: 1, upcoming: 0, past: 0, cancelled: 1 }, { after: true });
}

/** The staff side: open the request, start the review, approve it with a reason, carry it out. */
async function staffCancellation(ctx: Ctx, page: J.Page, requestId: string) {
  const name = "Cancellation requests (staff)";
  await S.openPage(page, `/finance/cancellation-requests?event=${encodeURIComponent(ctx.world.eventId)}`);
  await settle(page);
  const row = page.locator(`a[href*="request=${requestId}"]`).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await visited(ctx, page, name);
  await row.click();
  await page.waitForURL((url: URL) => url.searchParams.get("request") === requestId, { timeout: 20_000 });
  await settle(page);
  const act = async (text: RegExp) => {
    await page.getByRole("button", { name: text }).click().catch(async (error: Error) => {
      throw new Error(`${error.message.split("\n")[0]} Buttons: ${(await page.locator("main button").evaluateAll((nodes: HTMLButtonElement[]) => nodes.map((node) => `${(node.textContent ?? "").trim()}${node.disabled ? " (disabled)" : ""}`))).join(" | ")}; reason box: "${await page.getByLabel(/Reason or note/).inputValue().catch(() => "?")}"; hint: ${clean(await page.locator(".cancel-request-actions .field-help").first().innerText().catch(() => ""))}`);
    });
  };
  await act(/^Start review$/);
  // The review has started once Start review is gone (the page clears the note box when that answer arrives, so wait first).
  await page.getByRole("button", { name: /^Start review$/ }).waitFor({ state: "detached", timeout: 20_000 });
  await page.getByRole("button", { name: /^Approve/ }).waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".count-badge", { hasText: "Under review" }).waitFor({ state: "visible", timeout: 20_000 });
  await visited(ctx, page, "Cancellation request (staff review)");
  // The page reloads its data after the review starts and can clear a note typed in that moment: type until Approve turns on.
  const approve = page.getByRole("button", { name: /^Approve/ });
  const typed = await pollPage<boolean>(page, async () => {
    if (await approve.isEnabled()) return true;
    await page.getByLabel(/Reason or note/).fill("Journey check: approved");
    return approve.isEnabled();
  }, Boolean, 15_000);
  assert(typed.ok, "Approve stayed off after a reason was typed");
  await act(/^Approve/);
  await page.getByText(/Approval recorded/).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("heading", { name: "Carry out" }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByLabel(/I am carrying out this approved cancellation now/).check();
  await act(/^Carry out$/);
  await pollPage<string>(page, async () => clean(await page.locator("body").innerText()), (text) => /Cancel the registration:\s*Done/.test(text), 25_000)
    .then((result) => assert(result.ok, "carrying out did not report the registration as cancelled"));
}

/* ---------------------------------------------------------------- staff journeys (phase B) */

/** A browser signed in as one of the stamped synthetic staff users (a minted session: staff sign-in needs a second factor). */
async function staffContext(ctx: Ctx, role: StaffRole) {
  const cookie = await J.mintStaffSessionFor(ctx.staffTokens, ctx.world.staff[role]);
  const context = await J.newContext(ctx.browser, { translate: false, cookie, width: ctx.viewport.width });
  context.setDefaultTimeout(20_000);
  const page = await context.newPage();
  watch(page);
  lastPage = page;
  return { context, page };
}

/** Runs a staff journey in its own signed-in browser; on a failure with JOURNEY_DEBUG it shows what was on the page before the browser closes. */
async function asStaff(ctx: Ctx, role: StaffRole, run: (page: J.Page) => Promise<void>) {
  const { context, page } = await staffContext(ctx, role);
  try {
    await run(page);
  } catch (error) {
    if (process.env.JOURNEY_DEBUG) console.error(`    page ${page.url()}:\n${(await J.bodyText(page).catch(() => "")).split("\n").filter(Boolean).slice(0, 90).join("\n")}`);
    throw error;
  } finally {
    await context.close();
  }
}

/** The staff page loaded, it is usable, and the page checks. */
async function staffVisit(ctx: Ctx, page: J.Page, name: string, path: string) {
  await S.openPage(page, path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await visited(ctx, page, name);
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/* ---- 5. create an event from a template (the one step run as a system administrator: /event-setup/from-template is theirs only) */

async function templateJourney(ctx: Ctx) {
  const { rec, world } = ctx;
  await asStaff(ctx, "sysadmin", async (page) => {
    const name = `Journey Template Event ${world.stamp}`;
    if (process.env.JOURNEY_DEBUG) page.on("response", async (response: { url(): string; status(): number; text(): Promise<string> }) => { if (/event-templates/.test(response.url())) console.error(`    ${response.status()} ${response.url()} ${(await response.text().catch(() => "")).slice(0, 300)}`); });
    await staffVisit(ctx, page, "Start from template", "/event-setup/from-template");
    // B7: an empty form shows the shared summary and a message by each field.
    const create = page.getByRole("button", { name: /^(Create draft event|Creating…)$/ });
    await checkErrorSummary(page, rec, "Start from template", "required answers missing", () => create.click());
    // "Blank event": a small starter form, so the whole publish path can be walked in one journey.
    const option = page.getByLabel("Template").locator("option", { hasText: "Blank event (General)" }).first();
    await page.getByLabel("Template").selectOption({ label: ((await option.textContent()) ?? "").trim() });
    await page.getByLabel("Event name").fill(name);
    await page.getByLabel("Starts on").fill(inDays(120));
    await page.getByLabel("Start time").fill("09:00");
    await page.getByLabel("Ends on").fill(inDays(122));
    await page.getByLabel("End time").fill("17:00");
    await checkInFlightLabel(page, rec, "Start from template", "Create draft event", { button: create, click: () => create.click(), match: (url, method) => method === "POST" && /\/api\/event-templates\/[^/]+\/apply$/.test(url), expect: /Creating…/ });
    await page.waitForURL((url: URL) => url.pathname === "/more/event-settings" && url.searchParams.has("event"), { timeout: 10_000 }).catch(async (error: Error) => {
      throw new Error(`${error.message.split("\n")[0]} The page says: ${clean(await page.locator("main").innerText().catch(() => "?")).slice(0, 500)}`);
    });
    const eventId = new URL(page.url()).searchParams.get("event")!;
    world.extraEventIds.push(eventId);
    // The draft exists with what the template carries.
    const event = await ctx.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, slug: true, name: true, isPublished: true, audience: true } });
    assert(event && event.name === name, "the draft event was not created with the typed name");
    assert(!event.isPublished, "a new event from a template must be a draft");
    const application = await ctx.prisma.eventTemplateApplication.findUnique({ where: { eventId }, select: { payloadSnapshot: true } });
    assert(application, "no template application was recorded for the new event");
    const payload = application.payloadSnapshot as { formTemplateKeys?: string[]; audience?: string };
    const forms = await ctx.prisma.registrationForm.count({ where: { eventId } });
    assert((payload.formTemplateKeys?.length ?? 0) > 0 && forms === payload.formTemplateKeys!.length, `the draft has ${forms} form(s); the template carries ${payload.formTemplateKeys?.length ?? 0}`);
    assert(event.audience === (payload.audience ?? "GENERAL"), `the draft's audience is ${event.audience}, the template's is ${payload.audience}`);
    ctx.created = { id: event.id, slug: event.slug, name };
    await settle(page);
  });
}

/* ---- 6. the publish checklist, as the event's administrator (6a: the checklist and the event settings; 7 follows; 6b: Publish event) */

const SETUP_STEPS = ["Event basics", "Attendee types", "Registration forms and prices", "Test form", "Publish form", "Publish event", "View public page"];

async function grantEventAdmin(ctx: Ctx) {
  const created = ctx.created;
  assert(created, "the staff journeys 6 and 7 need the event journey 5 makes");
  // A stamped synthetic staff member becomes this event's administrator, as an administrator would be assigned.
  await ctx.prisma.eventMembership.upsert({
    where: { eventId_userId: { eventId: created.id, userId: ctx.world.staff.eventadmin.id } },
    update: { role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] },
    create: { eventId: created.id, userId: ctx.world.staff.eventadmin.id, role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] },
  });
  return created;
}

/** The checklist items a viewer sees on the Overview, with whether each is done. */
async function setupChecklist(page: J.Page) {
  const panel = page.locator("section, aside").filter({ has: page.getByRole("heading", { name: "Set up this event" }) }).last();
  await panel.waitFor({ state: "visible", timeout: 15_000 });
  return { panel, text: clean(await panel.innerText()) };
}

async function publishChecklistJourney(ctx: Ctx, page: J.Page) {
  const { rec } = ctx;
  const created = await grantEventAdmin(ctx);
  const eventQuery = `?event=${encodeURIComponent(created.id)}`;
  await staffVisit(ctx, page, "Overview (setting up an event)", `/overview${eventQuery}`);
  const before = await setupChecklist(page);
  // "Set up this event" lists every step this administrator can act on, in order, with what is done so far.
  const positions = SETUP_STEPS.map((label) => before.text.indexOf(label));
  assert(positions.every((position) => position >= 0) && positions.every((position, index) => index === 0 || position > positions[index - 1]!), `"Set up this event" does not list ${SETUP_STEPS.join(", ")} in order: ${before.text.slice(0, 300)}`);
  const doneBefore = Number(/(\d) of 7 done/.exec(before.text)?.[1] ?? -1);
  assert(doneBefore >= 1 && doneBefore < 7 && /Event basics Done/.test(before.text), `the checklist does not say how many of the 7 steps are done: ${before.text.slice(0, 200)}`);
  const hrefs = await before.panel.locator("a[href]").evaluateAll((links: HTMLAnchorElement[]) => links.map((link) => link.getAttribute("href") ?? ""));
  assert(hrefs.some((href: string) => href.startsWith("/more/event-settings")) && hrefs.some((href: string) => href.startsWith("/registration-builder")), `the checklist links are ${JSON.stringify(hrefs)}`);

  // The checklist's own link opens attendee setup; one adult type is what the readiness list needs.
  await before.panel.getByRole("link", { name: /Open attendee setup/ }).click();
  await page.waitForURL((url: URL) => url.pathname === "/more/attendee-configuration", { timeout: 20_000 });
  await visited(ctx, page, "Attendee setup");
  await page.locator("#attendee-type-code-input").fill("ADULT");
  await page.locator('form:has(#attendee-type-code-input) input[name="label"]').fill("Adult");
  await page.locator('form:has(#attendee-type-code-input) input[name="minimumAge"]').fill("18");
  await page.locator('form:has(#attendee-type-code-input)').getByRole("button", { name: "Add attendee type" }).click();
  const typed = await pollPage<number>(page, () => ctx.prisma.eventAttendeeType.count({ where: { eventId: created.id, isActive: true } }), (count) => count >= 1, 15_000);
  assert(typed.ok, "the attendee type was not saved");

  // Event settings: the location and the support contact the readiness list asks for, saved with one Save.
  await staffVisit(ctx, page, "Event settings", `/more/event-settings${eventQuery}`);
  const readiness = clean(await page.locator("#event-readiness-panel").innerText());
  assert(/Not done: Event location/.test(readiness) && /Not done: Support contact/.test(readiness), `the readiness list does not ask for the location and the support contact: ${readiness.slice(0, 300)}`);
  await page.locator("#event-field-location").fill(`Journey Hall ${ctx.world.stamp}`);
  // The support contact sits in a folded section: open it the way a person would.
  const contactSection = page.locator("details", { has: page.locator("#event-field-support-contact") }).first();
  if (await contactSection.count() && !(await contactSection.evaluate((node: HTMLDetailsElement) => node.open))) await contactSection.locator("summary").first().click();
  await page.locator("#event-field-support-contact").fill("registration@journey.example.test");
  const form = page.locator("form.event-settings-layout");
  const save = page.locator("#event-save-button");
  await checkSaveFlow(page, rec, "Event settings", "event settings", {
    form, button: save, click: () => save.click(),
    match: (url, method) => method !== "GET" && url.includes(`/api/events/${created.id}`),
    done: () => pollPage<string>(page, async () => clean(await page.locator(".event-savebar-status").innerText()), (text) => /^(Saved|Not saved)/.test(text), 20_000),
  });
  const saved = await ctx.prisma.event.findUnique({ where: { id: created.id }, select: { location: true, supportContact: true } });
  assert(saved?.location === `Journey Hall ${ctx.world.stamp}` && saved.supportContact === "registration@journey.example.test", `the saved event has location "${saved?.location}" and support contact "${saved?.supportContact}"`);
}

/* ---- 7. the form builder: preview, test, publish the form */

async function builderJourney(ctx: Ctx, page: J.Page) {
  const { rec } = ctx;
  const created = await grantEventAdmin(ctx);
  const url = `/registration-builder?event=${encodeURIComponent(created.id)}`;
  await staffVisit(ctx, page, "Registration builder", url);
  // L6 (the sidebar tabs) is read by the page checks above; B6: typing in the form and leaving warns.
  const title = page.getByLabel("Form title");
  await checkLeaveWarning(page, rec, "Registration builder", "form title", async () => { await title.fill(`Journey retitled ${ctx.world.stamp}`); },
    () => page.goto(`${J.baseUrl}/overview?event=${encodeURIComponent(created.id)}`));
  await S.openPage(page, url);
  await settle(page);
  // "Preview & test": through the steps with Continue and Back, then the test submission.
  const preview = page.locator("#live-form-preview");
  await page.getByRole("button", { name: /^Preview & test$/ }).first().click();
  await preview.waitFor({ state: "visible", timeout: 10_000 });
  await visited(ctx, page, "Registration builder (preview and test)");
  const stepLabel = async () => clean((await preview.locator(".preview-step-progress > span").first().innerText()));
  assert(/step 1 of 2/i.test(await stepLabel()), `the preview starts on "${await stepLabel()}"`);
  // Continue with the required answers empty stays on the step and says so.
  await preview.getByRole("button", { name: "Continue" }).click();
  await preview.locator(".preview-test-alert").waitFor({ state: "visible", timeout: 5_000 });
  assert(/step 1 of 2/i.test(await stepLabel()), "Continue moved on although required answers were empty");
  await preview.getByLabel(/^First name/).fill("Riley");
  await preview.getByLabel(/^Last name/).fill("Journey");
  await preview.getByLabel(/^Email address/).fill(emailFor(ctx.world, "builder"));
  await preview.getByRole("button", { name: "Continue" }).click();
  await pollPage<string>(page, stepLabel, (text) => /step 2 of 2/i.test(text), 5_000).then((result) => assert(result.ok, "Continue did not move the preview to step 2"));
  await preview.getByRole("button", { name: "Back" }).click();
  await pollPage<string>(page, stepLabel, (text) => /step 1 of 2/i.test(text), 5_000).then((result) => assert(result.ok, "Back did not return the preview to step 1"));
  await preview.getByRole("button", { name: "Continue" }).click();
  const run = preview.getByRole("button", { name: /Run test submission|Testing…/ });
  await run.waitFor({ state: "visible", timeout: 10_000 });
  await checkInFlightLabel(page, rec, "Registration builder (preview and test)", "Run test submission", { button: run, click: () => run.click(), match: (urlText, method) => method === "POST" && /test/i.test(urlText), expect: /Testing…/ });
  const tested = await pollPage<number>(page, () => ctx.prisma.formTestSubmission.count({ where: { eventId: created.id, isValid: true } }), (count) => count >= 1, 20_000);
  assert(tested.ok, "no valid test submission was recorded for the event");
  const registrations = await ctx.prisma.registration.count({ where: { eventId: created.id } });
  assert(registrations === 0, "a test submission created a registration");
  await preview.getByText(/1 test submission/).waitFor({ state: "visible", timeout: 10_000 });

  // Publish the form's version: the checklist asks for a published form.
  const publish = page.getByRole("button", { name: /Publish version/ });
  await publish.click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Publish registration form/ });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await checkDialogBehavior(page, rec, "Registration builder", "publish form dialog", dialog, publish);
  await publish.click();
  await dialog.getByRole("button", { name: /^Publish form$/ }).click();
  const published = await pollPage<number>(page, () => ctx.prisma.registrationFormVersion.count({ where: { form: { eventId: created.id }, status: "PUBLISHED" } }), (count) => count >= 1, 20_000);
  assert(published.ok, "the form version was not published");
}

async function publishEventJourney(ctx: Ctx, page: J.Page) {
  const { rec } = ctx;
  const created = await grantEventAdmin(ctx);
  const eventQuery = `?event=${encodeURIComponent(created.id)}`;
  await staffVisit(ctx, page, "Event settings (ready to publish)", `/more/event-settings${eventQuery}`);
  const readiness = clean(await page.locator("#event-readiness-panel").innerText());
  assert(/Ready to publish/.test(readiness), `the event is not ready to publish: ${readiness.slice(0, 400)}`);
  // Publish event asks first, in the shared dialog (L7, B9); cancelling leaves it a draft.
  const publish = page.locator(".event-publish-button");
  await checkConfirmDialog(page, rec, "Event settings (ready to publish)", "publish the event", () => publish.click(), publish);
  assert(!(await ctx.prisma.event.findUnique({ where: { id: created.id }, select: { isPublished: true } }))?.isPublished, "cancelling the publish dialog published the event anyway");
  await publish.click();
  const confirm = page.locator(".confirm-dialog").getByRole("button", { name: new RegExp(`^Publish ${esc(created.name)}$`) });
  await checkInFlightLabel(page, rec, "Event settings (ready to publish)", "Publish (dialog)", { button: page.locator(".confirm-dialog button.primary-button"), click: () => confirm.click(), match: (url, method) => method !== "GET" && url.includes(`/api/events/${created.id}`), expect: /Publishing…/ });
  const live = await pollPage<boolean>(page, async () => Boolean((await ctx.prisma.event.findUnique({ where: { id: created.id }, select: { isPublished: true } }))?.isPublished), Boolean, 20_000);
  assert(live.ok, "the event is not published in the database");
  // The checklist now shows Publish event done.
  await staffVisit(ctx, page, "Overview (event published)", `/overview${eventQuery}`);
  // Every step is now done, so the page hides "Set up this event" (it disappears once nothing is left); if it is still there, Publish event must read Done.
  const panels = page.locator("section, aside").filter({ has: page.getByRole("heading", { name: "Set up this event" }) });
  await pollPage<number>(page, () => panels.count(), (count) => count === 0, 8_000);
  if (await panels.count()) {
    const row = panels.last().locator("li").filter({ hasText: /Publish event/ }).first();
    assert(/Done/.test(clean(await row.innerText())), `the checklist row for Publish event says: ${clean(await row.innerText())}`);
    rec.record("Overview (event published)", "Setup", "the checklist shows Publish event done", "pass", "the row reads Done");
  } else rec.record("Overview (event published)", "Setup", "the checklist shows Publish event done", "pass", "every step is done, so the checklist is hidden as the page says it will be");
}

async function staffEventJourneys(ctx: Ctx) {
  await asStaff(ctx, "eventadmin", async (page) => {
    await publishChecklistJourney(ctx, page);
    await builderJourney(ctx, page);
    await publishEventJourney(ctx, page);
  });
}

/* ---- 8. the attendee list, as the event's administrator */

/** The names in the first column of the attendee table, in the order shown (each row's attendee). */
const attendeeNames = (page: J.Page) => page.locator('tbody [data-col="name"]').allInnerTexts().then((texts: string[]) => texts.map((text) => clean(text)));

/** Sorts the list by a column: the header's own link on a wide screen, the "Sort by" and "Direction" choices where the table is cards. */
async function sortAttendees(page: J.Page, column: string, label: string, direction: "asc" | "desc") {
  const header = page.locator(`th[data-col="${column}"] a`).first();
  if (await header.isVisible().catch(() => false)) {
    // A first press sorts ascending, a second flips it.
    await header.click();
    await page.waitForURL((url: URL) => url.searchParams.get("sort") === column, { timeout: 15_000 });
    if (direction === "desc") {
      await page.locator(`th[data-col="${column}"] a`).first().click();
      await page.waitForURL((url: URL) => url.searchParams.get("dir") === "desc", { timeout: 15_000 });
    }
  } else {
    await page.getByLabel("Sort by").selectOption({ label });
    await page.getByLabel("Direction").selectOption(direction);
    await page.waitForURL((url: URL) => url.searchParams.get("sort") === column && (url.searchParams.get("dir") ?? "asc") === direction, { timeout: 15_000 });
  }
  await settle(page);
  // The address changes before the sorted rows render: wait until the pager's Next link carries the new order, so a later
  // read or Next press never uses the previous render (a run once read page 2 in the old order).
  await page.waitForFunction(({ column, direction }) => {
    const next = [...document.querySelectorAll<HTMLAnchorElement>(".list-pager a")].find((link) => /next/i.test(link.textContent ?? ""));
    if (!next) return true;
    const params = new URL(next.href).searchParams;
    return params.get("sort") === column && (params.get("dir") ?? "asc") === direction;
  }, { column, direction }, { timeout: 15_000 });
}

async function attendeeListJourney(ctx: Ctx, page: J.Page) {
  const { rec, world } = ctx;
  const list = world.list;
  const name = "Attendee list";
  const base = `/people/attendees?event=${encodeURIComponent(list.eventId)}`;
  await staffVisit(ctx, page, name, base);
  // B1: the shared count line and pager (50 to a page, so 55 attendees make two pages).
  const count = page.locator(".list-pager").first();
  assert(/Showing 1.50 of 55 attendees/.test(clean(await count.innerText())), `the count line says "${clean(await count.innerText())}", expected "Showing 1–50 of 55 attendees"`);
  assert((await attendeeNames(page)).length === 50, "the first page does not hold 50 attendees");

  // B1: a header (or, on a phone, the Sort by choice) puts the whole list in order, both ways, across the pages.
  await sortAttendees(page, "name", "Attendee", "asc");
  const ascending = await attendeeNames(page);
  await sortAttendees(page, "name", "Attendee", "desc");
  const descending = await attendeeNames(page);
  const sorted = (names: string[], factor: 1 | -1) => names.every((entry, index) => index === 0 || factor * names[index - 1]!.localeCompare(entry, "en", { sensitivity: "base" }) <= 0);
  rec.record(name, "B1", "a header sorts the list ascending and descending", sorted(ascending, 1) && sorted(descending, -1) && ascending[0] !== descending[0] && /PatA0/.test(ascending[0]!) && /PatZ1/.test(descending[0]!) ? "pass" : "fail", `first rows: ascending "${ascending[0]}", descending "${descending[0]}"`);
  // The second page keeps the order and says which rows it shows.
  await page.locator(".list-pager").getByRole("link", { name: "Next" }).click();
  await page.waitForURL((url: URL) => url.searchParams.get("page") === "2", { timeout: 15_000 });
  await settle(page);
  const second = await attendeeNames(page);
  const pagerText = clean(await page.locator(".list-pager").first().innerText());
  rec.record(name, "B1", "the pager moves to page 2 with the sort kept", second.length === 5 && /Showing 51.55 of 55 attendees/.test(pagerText) && new URL(page.url()).searchParams.get("sort") === "name" && sorted(second, -1) && descending.at(-1)!.localeCompare(second[0]!, "en", { sensitivity: "base" }) >= 0 ? "pass" : "fail", `page 2 shows ${second.length} row(s); "${pagerText}"`);

  // B2: a filter lives in the address; open a row, go Back, and it is kept; Clear filters resets it.
  await S.openPage(page, `${base}&q=PatB`);
  await settle(page);
  const narrowed = await attendeeNames(page);
  assert(narrowed.length > 0 && narrowed.length < 55 && narrowed.every((entry: string) => /PatB/.test(entry)), `the filter q=PatB left ${narrowed.length} rows: ${narrowed.slice(0, 3).join(", ")}`);
  await page.locator('tbody [data-col="confirmationCode"] a').first().click();
  await page.waitForURL((url: URL) => url.pathname === "/people" && url.searchParams.has("registration"), { timeout: 20_000 });
  await page.goBack({ waitUntil: "load" });
  await settle(page);
  const kept = new URL(page.url()).searchParams.get("q") === "PatB" && (await page.locator('input[type="search"][name="q"]').inputValue()) === "PatB" && (await attendeeNames(page)).length === narrowed.length;
  rec.record(name, "B2", "the filter is kept after opening a row and going Back", kept ? "pass" : "fail", kept ? "q=PatB stayed in the address, in the search box and in the list" : `after Back the address is ${page.url()}`);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await page.waitForURL((url: URL) => !url.searchParams.has("q"), { timeout: 15_000 });
  await settle(page);
  rec.record(name, "B2", "Clear filters resets the list", (await page.locator(".list-pager").first().innerText()).includes("of 55 attendees") ? "pass" : "fail", `count line: "${clean(await page.locator(".list-pager").first().innerText())}"`);

  // B4: a filter nothing matches says why and what to do next.
  await S.openPage(page, `${base}&q=zzqx-nobody-has-this`);
  await settle(page);
  await checkEmptyState(page, rec, name, "a filter with no match", page.locator("tbody .empty-state"));

  // S4 and S5 in the search box: results narrow as typed, focus stays, the new count is announced.
  await S.openPage(page, base);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await checkSearchLive(page, rec, name, { box: page.locator('input[type="search"][name="q"]'), query: "PatC" });
  await page.locator('input[type="search"][name="q"]').fill("");

  // B11: Download CSV: named <event-slug>-attendees-<date in Central>.csv and holding the stamped rows.
  await S.openPage(page, base);
  await settle(page);
  const centralDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const dateBefore = centralDate();
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("link", { name: /Download CSV/ }).click(),
  ]).then(([file]) => file as { suggestedFilename(): string; path(): Promise<string | null> });
  // The date may turn over between the click and the check, so the date before and the date after are both accepted.
  const dateAfter = centralDate();
  const fileName = download.suggestedFilename();
  const expectedNames = [...new Set([dateBefore, dateAfter])].map((date) => `${list.slug}-attendees-${date}.csv`);
  rec.record(name, "B11", "the CSV is named <event-slug>-attendees-<date>.csv", expectedNames.includes(fileName) ? "pass" : "fail", `file name: ${fileName} (expected ${expectedNames.join(" or ")})`);
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile((await download.path())!, "utf8");
  const stamped = csv.split("\n").filter((line) => line.includes(list.lastNameMarker)).length;
  rec.record(name, "B11", "the CSV holds the stamped attendees", stamped === 55 ? "pass" : "fail", `${stamped} row(s) with ${list.lastNameMarker} (expected 55)`);
}

/* ---- B14 for a staff role without the permission */

async function noPermissionJourney(ctx: Ctx) {
  const { rec, world } = ctx;
  // Check-in staff can run the check-in desk and nothing else of this event: the attendee list and scheduled emails are not theirs.
  await asStaff(ctx, "checkin", async (page) => {
    await S.openPage(page, `/finance/cancellation-requests?event=${encodeURIComponent(world.list.eventId)}`);
    await visited(ctx, page, "Cancellation requests (check-in staff)");
    await checkRestricted(page, rec, "Cancellation requests (check-in staff)", { title: "Finance is restricted", whoToAsk: "your event administrator" });
    await S.openPage(page, `/communications/scheduled?event=${encodeURIComponent(world.list.eventId)}`);
    await visited(ctx, page, "Scheduled emails (check-in staff)");
    await checkRestricted(page, rec, "Scheduled emails (check-in staff)", { title: "Scheduled emails are restricted", whoToAsk: "your event administrator" });
  });
}

/* ---- 9. check-in, as check-in staff */

async function checkInJourney(ctx: Ctx, page: J.Page) {
  const { rec, world } = ctx;
  const list = world.list;
  const name = "Check-in desk";
  await staffVisit(ctx, page, name, `/check-in?event=${encodeURIComponent(list.eventId)}`);
  const search = page.getByPlaceholder("Search name, club, or confirmation code");
  // S4 and S5: results narrow as typed, focus stays in the box, and the count is announced.
  await checkSearchLive(page, rec, name, { box: search, query: "PatC" });
  await search.fill("PatD0");
  await page.getByText(/1 of 55 arrivals shown\./).waitFor({ state: "visible", timeout: 10_000 });
  const attendee = await ctx.prisma.registrationAttendee.findFirst({ where: { eventId: list.eventId, person: { firstName: "PatD0", lastName: list.lastNameMarker } }, select: { id: true } });
  assert(attendee, "the stamped attendee PatD0 is not in the database");
  const activeCheckIn = () => ctx.prisma.checkIn.count({ where: { registrationAttendeeId: attendee.id, undoneAt: null } });
  assert((await activeCheckIn()) === 0, "the attendee was already checked in");
  const toggle = page.getByRole("button", { name: /^(Check in|Confirming…|Undo|Saving…)$/ }).first();
  await checkInFlightLabel(page, rec, name, "Check in", { button: toggle, click: () => toggle.click(), match: (url, method) => method === "POST" && /\/check-in/.test(url) && !/_rsc/.test(url), expect: /…$/ });
  const arrived = await pollPage<number>(page, activeCheckIn, (count) => count === 1, 15_000);
  assert(arrived.ok, "the arrival was not recorded in the database");
  await page.getByRole("button", { name: "Undo" }).first().waitFor({ state: "visible", timeout: 15_000 });
  // Undo takes it back, and says "Saving…" while it does.
  const undo = page.getByRole("button", { name: /^(Undo|Saving…)$/ }).first();
  await checkInFlightLabel(page, rec, name, "Undo", { button: undo, click: () => undo.click(), match: (url, method) => method !== "GET" && /\/check-in/.test(url) && !/_rsc/.test(url), expect: /Saving…/ });
  const undone = await pollPage<number>(page, activeCheckIn, (count) => count === 0, 15_000);
  assert(undone.ok, "Undo did not take the arrival back in the database");
  const history = await ctx.prisma.checkIn.findFirst({ where: { registrationAttendeeId: attendee.id }, select: { undoneAt: true } });
  assert(history?.undoneAt, "the undone check-in kept no history");
  await page.getByRole("button", { name: "Check in" }).first().waitFor({ state: "visible", timeout: 15_000 });
}

/* ---- 10. a scheduled email, as the event's communications manager */

async function scheduledEmailJourney(ctx: Ctx, page: J.Page) {
  const { rec, world, mail } = ctx;
  const m = world.mail;
  const name = "Scheduled emails";
  const base = `/communications/scheduled?event=${encodeURIComponent(m.eventId)}`;
  await staffVisit(ctx, page, name, base);
  // B4: nothing is scheduled yet, and the page says so and where to get help.
  await checkEmptyState(page, rec, name, "no schedules yet", page.locator(".empty-state").filter({ hasText: /No emails are scheduled/ }));
  const scheduleName = `Journey reminder ${world.stamp}`;
  await page.getByRole("button", { name: /New schedule/ }).click();
  const editor = page.locator('section[aria-label="New schedule"]');
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await visited(ctx, page, "Scheduled emails (new schedule)");
  await editor.getByLabel("Name", { exact: true }).fill(scheduleName);
  await editor.getByLabel(/^Message/).selectOption({ label: "Event announcement" });
  await editor.getByLabel("Announcement title").fill(`Journey news ${world.stamp}`);
  await editor.getByLabel("Announcement message").fill("A synthetic announcement for the browser journey check.");
  await editor.getByLabel("Date", { exact: true }).fill(inDays(1));
  await editor.getByLabel("Time of day").fill("09:00");
  // "Registration contact" is ticked already: the three stamped registrations are the whole audience of this event.
  await editor.getByRole("button", { name: /Review schedule/ }).click();
  await editor.getByRole("button", { name: /Save schedule/ }).waitFor({ state: "visible", timeout: 20_000 });
  const reviewText = clean(await editor.innerText());
  assert(/\b3 (people|recipients|addresses|will)/i.test(reviewText) || /3 approved/i.test(reviewText), `the review does not show the three recipients: ${reviewText.slice(-700)}`);
  await editor.getByRole("button", { name: /Save schedule/ }).click();
  const card = page.locator("li.scheduled-email-card").filter({ hasText: scheduleName });
  await card.waitFor({ state: "visible", timeout: 20_000 });
  assert(/Pending approval/.test(clean(await card.innerText())), "a saved schedule is not pending approval");
  // B13: the time it will be sent is in Central and labelled.
  const sends = clean(await card.locator("dd").filter({ hasText: /\d{1,2}:\d{2}/ }).first().innerText().catch(() => ""));
  rec.record("Scheduled emails (saved schedule)", "B13", "the schedule's time is shown in Central, labelled", /\b(CT|CDT|CST|Central)\b/.test(sends) ? "pass" : "fail", `the card says it sends: "${sends}"`);
  await visited(ctx, page, "Scheduled emails (saved schedule)");

  // Approve: the list's Approve opens the review; "Approve and schedule" is the one act that lets it send.
  await card.getByRole("button", { name: "Review and approve" }).click();
  const approvePanel = page.locator(`section[aria-label="Approve ${scheduleName}"]`);
  await approvePanel.waitFor({ state: "visible", timeout: 20_000 });
  await approvePanel.getByRole("button", { name: "Approve and schedule" }).click();
  await page.getByText(/is approved\. It will be sent at/).waitFor({ state: "visible", timeout: 20_000 });
  const batch = await ctx.prisma.scheduledEmailBatch.findFirst({ where: { eventId: m.eventId, name: scheduleName }, select: { id: true, status: true } });
  assert(batch && batch.status === "ACTIVE", `the approved schedule is ${batch?.status}`);
  assert((await ctx.prisma.scheduledEmailRecipient.count({ where: { batchId: batch.id } })) === 3, "the approved list is not the three stamped recipients");

  // The sweep, exactly as the scheduler calls it.
  // The token is OUTBOX_SWEEP_TOKEN from the environment; the apps in CI (and the ones this suite is documented to run against) use
  // the CI value, and a local .env may carry another one, so the CI value is tried when the environment's is refused.
  const tokens = [...new Set([process.env.OUTBOX_SWEEP_TOKEN, "ci-only-outbox-sweep-token-000000000000"].filter((value): value is string => Boolean(value)))];
  const sweep = async () => {
    let status = 0;
    for (const token of tokens) {
      status = (await fetch(`${J.baseUrl}/api/internal/outbox/sweep`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })).status;
      if (status !== 401 && status !== 403) break;
    }
    return status;
  };
  const announcement = new RegExp(`Journey news ${world.stamp}`);
  const announcedTo = (address: string) => mail.messages.filter((message) => message.to.includes(address) && announcement.test(message.subject + message.text));
  // Approved but not yet due (tomorrow): a sweep, as the scheduler would run it, must send nothing to anyone yet.
  assert((await sweep()) === 200, "the outbox sweep did not answer 200 before the schedule was due");
  assert(m.recipients.every((address) => announcedTo(address).length === 0), "a schedule that is not due yet was sent");
  // Make it due. The earliest the page lets a time be set is five minutes ahead, so instead of waiting, the approved time is moved
  // into the past in the database: the rule (date and time in the event's zone) and the stored send time together, so the schedule
  // still agrees with itself (moving only one makes the sender pause it as "changed after approval"). Two minutes late is well
  // inside the six hours after which a late schedule is dropped.
  const due = new Date(Math.floor((Date.now() - 2 * 60_000) / 60_000) * 60_000);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(due);
  const part = (type: string) => local.find((entry) => entry.type === type)!.value;
  await ctx.prisma.scheduledEmailBatch.update({ where: { id: batch.id }, data: { sendAt: due, localDate: `${part("year")}-${part("month")}-${part("day")}`, localTime: `${part("hour")}:${part("minute")}` } });
  const since = Date.now() - 1_000;
  assert((await sweep()) === 200, "the outbox sweep did not answer 200");
  for (const address of m.recipients) {
    await mail.waitForMessage(address, (message) => new RegExp(`Journey news ${world.stamp}`).test(message.subject + message.text), { since });
  }
  // Only the stamped recipients got it: nobody else's address was sent this announcement.
  const strangers = mail.messages.filter((message) => message.receivedAt >= since && new RegExp(`Journey news ${world.stamp}`).test(message.subject + message.text) && !message.to.every((address) => m.recipients.includes(address)));
  assert(strangers.length === 0, `the announcement also went to ${strangers.map((message) => message.to.join(",")).join("; ")} (recipients: ${JSON.stringify(m.recipients)})`);
  // The page shows it as sent.
  await S.openPage(page, base);
  await settle(page);
  const done = await pollPage<string>(page, async () => {
    await sweep().catch(() => 0);
    await page.reload({ waitUntil: "load" });
    return clean(await page.locator("li.scheduled-email-card").filter({ hasText: scheduleName }).innerText());
  }, (text) => /3 sent|3 captured/.test(text), 40_000);
  // Exactly one message per stamped recipient: the sweeps above ran more than once and none of them sent it twice.
  const counts = m.recipients.map((address) => announcedTo(address).length);
  rec.record("Scheduled emails (after sending)", "Delivery", "exactly one message reached each stamped recipient", counts.every((count) => count === 1) ? "pass" : "fail", `messages per recipient: ${JSON.stringify(counts)}`);
  rec.record("Scheduled emails (after sending)", "B12", "the schedule shows it was sent", done.ok ? "pass" : "fail", `the card says: "${(done.value ?? "").slice(0, 200)}"`);
  await visited(ctx, page, "Scheduled emails (after sending)");
}

/* ---------------------------------------------------------------- run */

const ONLY = (process.env.JOURNEY_ONLY ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const wanted = (id: string) => ONLY.length === 0 || ONLY.includes(id);

async function runShard(ctx: Ctx) {
  // 1b first, in its own browser: the sign-in page sends a signed-in person away.
  const anonymous = await newAttendeeContext(ctx, { block: "cloudflare" });
  try {
    if (wanted("1")) await journey(ctx, "1b. Emailed code: same words with or without an account", () => emailCodeSamenessJourney(ctx, anonymous.page));
  } finally {
    await anonymous.context.close();
  }
  // One browser is the attendee from the sign-up to the cancellation. It blocks only the Security check (journey 1's case).
  const main = await newAttendeeContext(ctx, { block: "cloudflare" });
  let signedUp = false;
  let registered = false;
  try {
    signedUp = await journey(ctx, "1. Create an account with the Security check blocked", () => signUpJourney(ctx, main.page));
    if (signedUp && ["2", "3", "4"].some(wanted)) {
      registered = await journey(ctx, "2. Find the event, register with a promo code, pay by card", () => registerJourney(ctx, main.page, { email: ctx.attendee.email, rules: true, mode: "plain" }, true));
    }
    if (registered && wanted("3")) await journey(ctx, "3. Manage the registration: contact details and the status filters", () => manageJourney(ctx, main.page));
    if (registered && wanted("4")) await journey(ctx, "4. Ask to cancel; staff approve; the list says Cancelled", () => cancelJourney(ctx, main.page));
  } finally {
    await main.context.close();
  }
  if (wanted("5") || wanted("6") || wanted("7")) await journey(ctx, "5. Create an event from a template (as a system administrator)", () => templateJourney(ctx));
  if (wanted("6") || wanted("7")) await journey(ctx, "6 and 7. The publish checklist, the form builder test, Publish event (as the event's administrator)", () => staffEventJourneys(ctx));
  if (wanted("8")) await journey(ctx, "8. The attendee list: sort, page, filter, search, download (as the event's administrator)", () => asStaff(ctx, "eventadmin", (page) => attendeeListJourney(ctx, page)));
  if (wanted("9")) await journey(ctx, "9. Check in an attendee and undo it (as check-in staff)", () => asStaff(ctx, "checkin", (page) => checkInJourney(ctx, page)));
  if (wanted("10")) await journey(ctx, "10. A scheduled email, approved, swept and delivered (as the communications manager)", () => asStaff(ctx, "comms", (page) => scheduledEmailJourney(ctx, page)));
  if (wanted("14")) await journey(ctx, "14. Staff without the permission see the shared no-access state (as check-in staff)", () => noPermissionJourney(ctx));
  if (wanted("T")) await journey(ctx, "2 again with the translation simulation", () => registerVariant(ctx, "translate"));
  if (wanted("B")) await journey(ctx, "2 again with the privacy-browser blocker lists", () => registerVariant(ctx, "lists"));
  if (wanted("P")) await journey(ctx, "2 again with the blocker lists and the price preview failing", () => registerVariant(ctx, "preview"));
}

async function main() {
  J.guardLocal();
  assertLocalUrl(turnstileBase, "JOURNEY_TURNSTILE_BASE_URL");
  const playwright = await J.loadPlaywright();
  const shardFilter = process.env.JOURNEY_SHARD?.trim();
  const chosen = viewports.filter((viewport) => !shardFilter || viewport.name === shardFilter);
  if (chosen.length === 0) throw new Error(`JOURNEY_SHARD must be desktop or phone (got "${shardFilter}")`);
  const prisma = new PrismaClient();
  await resetEventBudgets(prisma);
  const mail = new FakeMailServer();
  await mail.start();
  try {
    // Fail fast, before anything is seeded, unless the apps' email really lands in this suite's outbox.
    await resetEventBudgets(prisma);
    await mail.assertAppMailReachesOutbox(J.baseUrl);
    await mail.assertAppMailReachesOutbox(turnstileBase);
  } catch (error) {
    await mail.stop();
    await prisma.$disconnect();
    throw error;
  }
  // The platform's central email sender is a system administrator's one-time setup (System management > Email). A publish
  // needs it (readiness item "Central email sender saved") and so do scheduled emails; a fresh CI database has none, so it is
  // set for the run (to the CI sender address) and put back at the end.
  const platform = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { defaultSenderEmail: true } });
  const platformExisted = Boolean(platform);
  const senderWas = platform?.defaultSenderEmail ?? null;
  if (!senderWas?.trim()) await prisma.platformSettings.upsert({ where: { id: "platform" }, update: { defaultSenderEmail: "events@ci.example.test" }, create: { id: "platform", defaultSenderEmail: "events@ci.example.test" } });
  const summaries: string[] = [];
  const worlds: EventWorld[] = [];
  const tokens: string[] = [];
  const staffTokens: string[] = [];
  const recorders: Recorder[] = [];
  try {
    for (const viewport of chosen) {
      const started = Date.now();
      console.log(`\n== ${viewport.name} (${viewport.width}px)`);
      // Each width spends several emailed-code sends; a fresh budget per width keeps a both-widths local run inside the limit.
      await resetEventBudgets(prisma);
      const world = await seedEventWorld(prisma, viewport.name);
      worlds.push(world);
      const rec = new Recorder(viewport.name, KNOWN_BUGS);
      recorders.push(rec);
      const attendee: Attendee = { email: emailFor(world, "attendee"), password: "Cobalt-Harbor-Velvet-Orchid-2087-Pelican", name: `Riley Journey${world.stamp}-Attendee`, accountId: null };
      for (const name of (process.env.JOURNEY_BROWSERS ?? "chromium").split(",").map((value) => value.trim()).filter(Boolean)) {
        const browser = await J.launch(playwright, name);
        try {
          await runShard({ browser, world, mail, rec, viewport, prisma, tokens, staffTokens, attendee });
        } finally {
          await browser.close();
        }
      }
      summaries.push(`${viewport.name}: ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  } finally {
    await J.revokeSessions(tokens);
    await J.revokeStaffSessions(staffTokens);
    if (process.env.JOURNEY_KEEP_DATA !== "1") for (const world of worlds) await cleanupEventWorld(prisma, world);
    // Put the sender back; a platform row that did not exist before the run (made by the setting above) is removed again.
    if (platformExisted) await prisma.platformSettings.updateMany({ where: { id: "platform" }, data: { defaultSenderEmail: senderWas } });
    else await prisma.platformSettings.deleteMany({ where: { id: "platform" } });
    await mail.stop();
    await prisma.$disconnect();
  }

  for (const rec of recorders) {
    console.log(`\nSite rules checked (${rec.viewport}):`);
    for (const line of rec.summary()) console.log(line);
    problems.push(...rec.unexpected);
    for (const bug of KNOWN_BUGS) if (!rec.seenKnown.has(bug.id) && (!bug.only || bug.only === rec.viewport)) console.log(`  note: known bug ${bug.id} was not reached in ${rec.viewport}`);
  }
  console.log(`\nTime: ${summaries.join(", ")}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.map((line) => `  - ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nEvent journeys: OK");
}

main().catch((error) => { console.error(error); process.exit(1); });
