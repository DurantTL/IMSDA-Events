/**
 * Event attendee journeys in a real browser (#1439, round 2 phase A).
 *
 * Uses the built site like an attendee would, on a seeded database, at 1280 and 390 px wide (Chromium only):
 *  1. create an account while the Cloudflare Security check is blocked (the "Email me a code instead" way in, the office
 *     contact beside the blocked message, the same words for an address that has an account and one that has not), then the
 *     emailed verification code;
 *  2. find an event, register with a promo code and choose to pay by card, and reach the card step (Square cannot be reached
 *     with the fictitious ids this run uses, so the card form or its fallback is what shows). Run again with the
 *     Google-Translate simulation and with the privacy-browser blocker lists, the second time with the page's own price preview
 *     failing: the amount on the card step and the recorded total are still the server's numbers (P1);
 *  3. manage the registration as that account (My registrations: find it, update the contact details, the filter tabs);
 *  4. ask to cancel it, a staff member approves and carries it out, and the attendee's list says Cancelled.
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
 *   JOURNEY_ONLY=3 runs 1 and 2 as well); JOURNEY_DEBUG=1 prints the page when a step fails; JOURNEY_KEEP_DATA=1 keeps the seeded
 *   rows. Each shard seeds its own data (the run stamp includes the shard).
 *
 * Environment: JOURNEY_BASE_URL, JOURNEY_TURNSTILE_BASE_URL, JOURNEY_SHARD (desktop = 1280 wide, phone = 390 wide, unset = both),
 * JOURNEY_MAIL_PORT, JOURNEY_KEEP_DATA, JOURNEY_ONLY, JOURNEY_DEBUG, JOURNEY_BROWSERS (default chromium).
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
import { FINANCE_EMAIL, cleanupEventWorld, eventFormDefinition, emailFor, resetEventBudgets, seedEventWorld, seedExistingAccount, type EventWorld } from "./support/event-journey-data";
import { FakeMailServer } from "./support/fake-mail-server";
import * as S from "./support/journey-steps";
import { assertLocalUrl } from "./support/local-only-guard";
import { PREVIEW_FAILS_INIT_SCRIPT, blockedBy } from "./support/privacy-block-lists";
import {
  APPROVED_STATUS_WORDS, Recorder, checkBrowserOnlyEmail, checkEmptyState, checkErrorSummary, checkErroredFocus, checkFocusRing, checkInFlightLabel, checkNoAccess,
  checkPage, checkSaveFlow, checkSearchLive, checkSearchWithoutScript, checkTypedFields, clean, holdRequest, pollPage, type KnownBug,
} from "./support/site-rule-checks";

loadEnvConfig(process.cwd());

const turnstileBase = (process.env.JOURNEY_TURNSTILE_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");

/** Failures that are the site's fault (found by these journeys). The label is what the failing check prints. */
const registrationsPages = ["My registrations", "My registrations (filters)", "My registrations (contact updated)", "My registrations (request cancellation)", "My registrations (cancelled)", "My registrations (after cancelling)"];
export const KNOWN_BUGS: KnownBug[] = [
  {
    id: "sign-up-email-browser-only",
    description: "Create account: components/attendee-sign-up-form.tsx:185 is a raw type=\"email\" input with no noValidate and no EmailInput, so a bad address shows only the browser's own bubble on submit, never the shared message when the field is left (B8). tests/field-checks-1451.test.ts:57 lists the file as \"Not yet on EmailInput\".",
    checks: [{ label: "Create account (Security check blocked) | B8 | a bad email gets the shared message", detail: "shows no shared message" }],
  },
  {
    id: "search-clear-button-42px",
    description: "Search fields on desktop: app/globals.css:1262 sizes .search-field-clear 44px wide but height: 42px (only the phone rule at app/globals.css:9451 makes it --touch-target tall), so the clear button is 44x42 (L1 \"clear buttons are 44px\", C2).",
    checks: [{ label: "Events list | L1 | the clear button is 44px", detail: "44x42" }],
    only: "desktop",
  },
  {
    id: "public-registration-phone-not-tidied",
    description: "Registration form: components/public-registration-form.tsx:2337 draws a PHONE answer with a generic input that has no tidy-on-leave, so \"5155550134\" stays as typed, while PhoneInput (components/phone-input.tsx:52) turns it into \"(515) 555-0134\" when the field is left (B8, formatted the same way in every form). The shared message is the same; only the tidy differs.",
    checks: [{ label: "Registration form: About you | B8 | a good phone is tidied to (515) 555-0134", detail: "the phone stayed" }],
  },
  {
    id: "forms-help-trigger-module-button",
    description: "Forms help: components/forms-help.tsx:25 gives its <button> only the module class styles.trigger (components/forms-help.module.css .trigger) unless a className is passed, so it is a button look of its own. tests/look-guard-1440.test.ts's reviewed list misses it because it reads `className={styles.x}` and this is `className ?? styles.trigger` (L5).",
    checks: ["Registration form: About you", "Registration form: choices and payment"].map((page) => ({ label: `${page} | L5 | buttons use the shared classes`, detail: "forms-help-module" })),
  },
  {
    id: "disabled-buttons-wait-cursor",
    description: "Disabled buttons use cursor: wait, not not-allowed (L5): app/globals.css:5514 .public-square-pay-button:disabled (the card step's Pay button, disabled until the card form is ready) and app/globals.css:5624 .public-manage-contact-actions > button:disabled, with the same wording at :4347, :5473 and :5536.",
    checks: ["Card payment step", "My registrations (contact updated)"].map((page) => ({ label: `${page} | L5 | a disabled button shows the not-allowed cursor`, detail: "cursor wait" })),
  },
  {
    id: "attendee-status-pill-not-shared-chip",
    description: "My registrations: the status of each registration card (\"Pending payment\", \"Cancelled\") is a span.attendee-status-pill (components/account-registration-card.tsx:63, styled at app/globals.css:5083 with its own colors), not the shared .status-chip (L4).",
    checks: registrationsPages.map((page) => ({ label: `${page} | L4 | chips and badges use the shared classes`, detail: "attendee-status-pill" })),
  },
  {
    id: "attendee-filter-counts-plain-span",
    description: "My registrations: the filter tabs write their counts as a plain span.attendee-reg-count \"(1)\" (app/(public)/account/(portal)/registrations/page.tsx:249), not the navy .count-badge (L4: filter counts use the count badge).",
    checks: registrationsPages.map((page) => ({ label: `${page} | L4 | filter counts use the count badge`, detail: ".attendee-reg-count" })),
  },
  {
    id: "contact-form-saved-words",
    description: "Update contact details: components/attendee-registration-contact-form.tsx:122 confirms with \"Contact details saved. The code has been used.\", not the shared \"Saved.\" message (savedMessage in components/form-message.tsx) every other form uses (B5). The form also still writes its own message paragraph instead of FormMessage.",
    checks: [{ label: "Update contact details | B5 | contact details: one \"Saved.\" message after saving", detail: "Contact details saved." }],
  },
  {
    id: "withdraw-request-inline-confirm",
    description: "My registrations: withdrawing a cancellation request asks in its own inline step (components/cancellation-request-panel.tsx:234, \"Yes, withdraw it\" / \"Keep it\"), not in the shared confirm dialog every other cancel uses (B9). The flow does ask first and does offer Undo, only the style differs.",
    checks: [{ label: "My registrations (request cancellation) | B9 | withdrawing asks in the shared dialog", detail: "own inline step" }],
  },
];

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
  await group.getByTestId("security-check-code-input").fill(securityCode);

  // The password, then Create account. B10: the button says what it is doing while the request is in flight.
  await label(page, "Password").first().fill(attendee.password);
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
  // T3: the server took the emailed code in place of the Security check's token, so the person was never stuck.
  rec.record("Create account (Security check blocked)", "T3", "an emailed code lets the person create the account", "pass", "with the Security check blocked, the code from the email was accepted and the account's verification code was sent");
  await visited(ctx, page, "Create account (check your email)");

  // The emailed verification code: lands signed in.
  await S.enterSignUpVerificationCode(page, mail, { email: attendee.email, since: verifySince });
  await visited(ctx, page, "Account home (just signed up)");
  const row = await ctx.prisma.attendeeAccount.findFirst({ where: { email: attendee.email }, select: { id: true, emailVerifiedAt: true } });
  assert(row?.emailVerifiedAt, "the new account was not verified after the emailed code");
  attendee.accountId = row.id;
  ctx.world.accountIds.push(row.id);
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
  const code = await mail.waitForCodeWithSubject(existing.email, /security code/i, { since: known.at });
  rec.record("Sign-in (Security check blocked)", "T3", "an emailed code satisfies the blocked check", /^\d{6}$/.test(code) ? "pass" : "fail", "a six-digit code arrived in the outbox for the address that has an account");
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
  const pill = clean((await portalCard(page, ctx).locator(".attendee-status-pill").first().textContent()) ?? "");
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

  await filterTabs(ctx, page, { all: 1, upcoming: 1, past: 0, cancelled: 0 });

  // B14: a staff page opened as an attendee says the shared thing and who to ask.
  await S.openPage(page, "/finance/cancellation-requests");
  await settle(page);
  await checkNoAccess(page, rec, "Staff page opened as an attendee", ctx.attendee.email);
  await visited(ctx, page, "Staff page opened as an attendee");
}

/** The four filter tabs: counts, the address (B2), and an empty tab that says why and what to do next (B4). */
async function filterTabs(ctx: Ctx, page: J.Page, counts: { all: number; upcoming: number; past: number; cancelled: number }, options: { after?: boolean } = {}) {
  const { rec } = ctx;
  const name = options.after ? "My registrations (after cancelling)" : "My registrations (filters)";
  await S.openPage(page, "/account/registrations");
  await visited(ctx, page, name);
  rec.record(name, "L6", "tabs use the shared tablist with arrow keys", "n/a", "the four filters are links to their own addresses (navigation with aria-current), not a tab panel");
  const nav = page.getByRole("navigation", { name: "Show registrations" });
  const labels = (await nav.locator("a").allInnerTexts()).map((text: string) => clean(text));
  const want = [`All (${counts.all})`, `Upcoming (${counts.upcoming})`, `Past (${counts.past})`, `Cancelled (${counts.cancelled})`];
  assert(JSON.stringify(labels) === JSON.stringify(want), `the filter tabs read ${JSON.stringify(labels)}, expected ${JSON.stringify(want)}`);
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
  rec.record(name, "B2", "the filter tab is in the address (Back and shared links keep it)", onPast && backOnAll && sharedLink ? "pass" : "fail", `Past in the address: ${onPast}; Back returned to All: ${backOnAll}; ?show=cancelled opened on Cancelled: ${sharedLink}`);
  rec.record(name, "B2", "a filtered list has a Clear filters button", "n/a", "the four filters are tabs of links and All is the way back; an empty tab links \"Show all my registrations\"");
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
  await filterTabs(ctx, page, { all: 1, upcoming: 0, past: 0, cancelled: 1 }, { after: true });
}

/** The staff side: open the request, start the review, approve it with a reason, carry it out. */
async function staffCancellation(ctx: Ctx, page: J.Page, requestId: string) {
  const name = "Cancellation requests (staff)";
  await S.openPage(page, `/finance/cancellation-requests?event=${encodeURIComponent(ctx.world.eventId)}`);
  await settle(page);
  const row = page.locator(`a[href*="request=${requestId}"]`).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await visited(ctx, page, name, { rules: false });
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
  await visited(ctx, page, "Cancellation request (staff review)", { rules: false });
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
    if (registered && wanted("3")) await journey(ctx, "3. Manage the registration: contact details and the filter tabs", () => manageJourney(ctx, main.page));
    if (registered && wanted("4")) await journey(ctx, "4. Ask to cancel; staff approve; the list says Cancelled", () => cancelJourney(ctx, main.page));
  } finally {
    await main.context.close();
  }
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
  const summaries: string[] = [];
  const worlds: EventWorld[] = [];
  const tokens: string[] = [];
  const staffTokens: string[] = [];
  const recorders: Recorder[] = [];
  try {
    for (const viewport of chosen) {
      const started = Date.now();
      console.log(`\n== ${viewport.name} (${viewport.width}px)`);
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
