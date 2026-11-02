/**
 * Club director journeys in a real browser (#1439, round 1 part A).
 *
 * Uses the built site like a club director would, on a seeded database, at 1280 and 390 px wide (Chromium only):
 * sign in with the emailed code, set up two-step with an authenticator app, add a leader, work the roster, the yearly
 * forms, register the club for an event, orders, a monthly record, the year-end report, Getting started and Help, and
 * the Forms help popup. Every page a journey visits is checked against docs/SITE-RULES.md (scripts/support/
 * site-rule-checks.ts), and the key journey (sign in, roster add, monthly record) runs again with the Google-Translate
 * simulation and with the privacy-browser blocker lists.
 *
 * LOCAL USE ONLY (see scripts/support/browser-journeys.ts): synthetic rows only, sessions minted for the second
 * browser context, and it refuses a production NODE_ENV or a database or URL that is not on this machine.
 *
 * THE DEV OUTBOX. In production mode the app never returns a sign-in code in a response, so the suite starts a small
 * Resend look-alike (scripts/support/fake-mail-server.ts) on JOURNEY_MAIL_PORT (default 3999) and reads emailed codes
 * and invites from it. Start the app under test with:
 *   RESEND_API_KEY=ci-placeholder-never-sent RESEND_API_URL=http://127.0.0.1:3999 \
 *   ACCOUNT_EMAIL_SENDER_ADDRESS=events@ci.example.test  (plus the fictitious CI secrets from
 *   .github/workflows/browser-translation.yml, "Start the built app")
 *
 *   npm i --no-save playwright@1.63.0 && npx playwright install chromium
 *   npm run build && npm run start   # with the variables above
 *   npm run test:club-journeys
 *
 * Environment: JOURNEY_BASE_URL (default http://localhost:3000), JOURNEY_SHARD (desktop = 1280 wide, phone = 390
 * wide, unset = both, one after the other), JOURNEY_MAIL_PORT, JOURNEY_KEEP_DATA=1 (keep the seeded rows),
 * JOURNEY_BROWSERS (default chromium; the suite is built and checked on Chromium). Each shard seeds its own data (the
 * run stamp includes the shard), so a database can hold both. Run them one after another against one app: a shard owns
 * the dev outbox port and the passkey setting below, so CI runs each shard in its own job with its own app and database.
 *
 * Passkeys: the gate lists "This phone or computer (Easiest)" first only when passkeys are switched on, so the suite
 * switches them on (platform setting passkeyRpId = localhost) for the run and puts the old value back at the end.
 *
 * Sign-in budgets: the account sign-in code send limit (20 per hour per address) would stop repeated local runs, so the
 * suite clears the "attendee." rate-limit buckets on the local database before it starts.
 *
 * KNOWN_BUGS: failures that are the site's fault. Each is reported as an "expected failure" and the suite fails if one
 * unexpectedly passes, so the entry is removed when the site is fixed.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import * as J from "./support/browser-journeys";
import { FakeMailServer } from "./support/fake-mail-server";
import { cleanupJourneyWorld, resetSignInBudgets, seedClubFormTemplate, seedCoordinatorWorld, seedJourneyWorld, seedSupplyItem, type Director, type JourneyWorld } from "./support/journey-data";
import * as S from "./support/journey-steps";
import { blockedBy } from "./support/privacy-block-lists";
import { AREA_ROLLUP_WORDS, Recorder, checkConfirmDialog, checkDialogBehavior, checkErrorSummary, checkLeaveWarning, checkPage, clean, pollPage, type KnownBug } from "./support/site-rule-checks";

loadEnvConfig(process.cwd());

/** Failures that are the site's fault (found by these journeys). The label is what the failing check prints. */
export const KNOWN_BUGS: KnownBug[] = [
  {
    id: "club-events-registered-word",
    description: "Club events: a submitted club registration shows the chip \"Registered · N going\" (components/club-event-list.tsx statusFor), but \"Registered\" is only approved for the area coordinator roll-up; the registration's status word is \"Submitted\" (B12, #1479).",
    labels: ["Club events (registered) | B12 | status chip words", "Club event: registered | B12 | the submitted registration shows an approved status word"],
  },
  {
    id: "monthly-record-unsaved",
    description: "Monthly Records: the Monthly Record form (components/club-report-form.tsx) never uses useUnsavedChangesGuard, so typing in it and then leaving the page (address bar, link, Back) gives no warning (B6).",
    labels: ["Monthly Record form | B6 | monthly record: leaving with unsaved changes warns"],
  },
  {
    id: "year-end-unsaved",
    description: "Year-End Report: components/club-year-end-report-form.tsx never uses useUnsavedChangesGuard, so editing a number and clicking another page leaves with no warning (B6).",
    labels: ["Year-End Report | B6 | year-end report: leaving with unsaved changes warns"],
  },
  {
    id: "orders-remove-no-confirm",
    description: "Orders: \"Remove from the list\" (components/club-order-workspace.tsx removeLine) removes the line at once, with no confirmation and no Undo (B9).",
    labels: ["Orders (with a line) | B9 | remove an order line: asks for confirmation in the shared dialog"],
  },
  {
    id: "help-no-search",
    description: "Help: the account Help page (app/(public)/account/(portal)/help/page.tsx) lists the director guides but has no search box (only the staff Help has one), so a director cannot search for a guide (H5, S4).",
    labels: ["Help | H5 | Help search finds the director guide", "Coordinator: Help | H5 | Help search finds the coordinator guide"],
  },
  {
    id: "records-grid-scrolls-sideways",
    description: "Coordinator Monthly Records: the \"Monthly Record status by club\" grid (CoordinatorMonthlyRecords) is a 14-column table that scrolls sideways inside its wrapper (scrollWidth 1600 in a 1132px box at 1280px wide) (B3).",
    labels: ["Coordinator: Monthly Records | B3 | tables do not scroll sideways"],
    only: "desktop",
  },
  {
    id: "records-chart-table-scrolls-sideways",
    description: "Coordinator Monthly Records on a phone: the \"Records by month\" table (components/club-report-charts.tsx tableWrap) scrolls sideways (374px of content in a 330px box at 390px wide) instead of turning into cards (B3).",
    labels: ["Coordinator: Monthly Records | B3 | tables do not scroll sideways"],
    only: "phone",
  },
  {
    id: "club-profile-unsaved",
    description: "Club settings: the club profile form (components/club-profile-form.tsx) never uses useUnsavedChangesGuard, so editing it and clicking another page leaves with no warning (B6).",
    labels: ["Club settings | B6 | club profile form: leaving with unsaved changes warns"],
  },
  {
    id: "club-form-native-required",
    description: "Club forms: components/club-form-fill-in.tsx puts a native `required` on its fields and no noValidate, so submitting with an answer missing shows only the browser's own tooltip, never the shared summary at the top and a message by the field (B7).",
    labels: [
      "Fill in a club form | B7 | required answers missing: error at the top",
      "Fill in a club form | B7 | required answers missing: error by the field",
    ],
  },
];

type Viewport = { name: "desktop" | "phone"; width: number };
const viewports: Viewport[] = [{ name: "desktop", width: 1280 }, { name: "phone", width: 390 }];

type Ctx = {
  browser: J.Browser;
  world: JourneyWorld;
  mail: FakeMailServer;
  rec: Recorder;
  viewport: Viewport;
  prisma: PrismaClient;
  tokens: string[];
  failures: string[];
};

const problems: string[] = [];

/** A plain failure of a journey step (not a rule check). */
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
  try {
    await run();
  } catch (error) {
    failStep(ctx, name, error);
    // JOURNEY_DEBUG=1 shows what the person would have been looking at when a step failed.
    if (process.env.JOURNEY_DEBUG && lastPage) console.error(`    page ${lastPage.url()}:\n${(await J.bodyText(lastPage).catch(() => "")).split("\n").filter(Boolean).slice(0, 80).join("\n")}`);
  }
  console.log(`    (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

/** A page is interactive once React has attached to it (a click before that is lost). */
async function settle(page: J.Page) {
  lastPage = page;
  await page.waitForLoadState("load");
  await page.waitForFunction(() => [...document.body.querySelectorAll("*")].slice(0, 400).some((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber$"))), undefined, { timeout: 20_000 });
}

/** The page is loaded, healthy, and passes the passive SITE-RULES checks. */
async function visited(ctx: Ctx, page: J.Page, name: string, options: { rules?: boolean; coordinator?: boolean } = {}) {
  await settle(page);
  await J.assertHealthy(page, `${ctx.viewport.name}: ${name}`, problems);
  // The coordinator's roll-ups "Registered" and "Not registered" are approved words on coordinator pages only (B12).
  if (options.rules !== false) await checkPage(page, ctx.rec, name, { extraWords: options.coordinator ? AREA_ROLLUP_WORDS : [] });
}

async function visit(ctx: Ctx, page: J.Page, name: string, path: string, options: { rules?: boolean; coordinator?: boolean } = {}) {
  await S.openPage(page, path);
  await visited(ctx, page, name, options);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function newDirectorContext(ctx: Ctx, options: { translate?: boolean; block?: boolean; cookie?: Awaited<ReturnType<typeof J.mintDirectorSession>> } = {}) {
  const context = await J.newContext(ctx.browser, { translate: Boolean(options.translate), cookie: options.cookie, width: ctx.viewport.width });
  context.setDefaultTimeout(20_000);
  if (options.block) {
    // What a privacy browser does: the same filter list as scripts/verify-privacy-browsers.ts (shields mode).
    await context.route("**/*", async (route: { request(): { url(): string }; abort(reason?: string): Promise<void>; continue(): Promise<void> }) => {
      try {
        if (blockedBy(route.request().url())) { blockedRequests += 1; return await route.abort("blockedbyclient"); }
        return await route.continue();
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
  }
  const page = await context.newPage();
  J.watchPage(page, problems);
  lastPage = page;
  return { context, page };
}

/* ---------------------------------------------------------------- 1. sign in and two-step */

async function signInJourney(ctx: Ctx, page: J.Page, director: Director, options: { rules: boolean }) {
  const { rec } = ctx;
  const club = S.clubPath(director.clubId);
  const checks = options.rules;

  // The sign-in page. B7 does not apply to it: the only error it can show is one generic line (so the page never says
  // whether an address has an account), and its fields use the browser's own required/email checks.
  await S.openPage(page, `/account/sign-in?next=${encodeURIComponent(club)}`);
  await visited(ctx, page, "Sign-in page", { rules: checks });
  if (checks) rec.record("Sign-in page", "B7", "errors at the top and by the field", "n/a", "a wrong password gets one generic line by design (no account lookup hint); fields use the browser's own checks");

  // Password -> asked for the emailed code (A2). Never inside on a password alone.
  const since = await S.submitPassword(page, { email: director.email, password: director.password, next: club });
  await page.waitForURL(/\/account\/sign-in\/code/, { timeout: 20_000 });
  await visited(ctx, page, "Check-your-email page", { rules: checks });
  if (checks) {
    await S.openPage(page, club);
    const stillAsked = /\/account\/sign-in\/code/.test(new URL(page.url()).pathname);
    rec.record("Check-your-email page", "A2", "a club page needs the emailed code after the password", stillAsked ? "pass" : "fail", stillAsked ? "opening the club page went back to the code page" : `the club page opened on a password alone (${page.url()})`);
    await S.openPage(page, `/account/sign-in/code?next=${encodeURIComponent(club)}`);
  }
  await S.enterEmailedCode(page, ctx.mail, { email: director.email, since });

  // A club page that needs two-step sends a club director with no two-step to the gate (A1, A3, H3), keeping the way back.
  await S.openPage(page, club);
  await page.getByRole("button", { name: /Set up two-step sign-in/ }).waitFor({ state: "visible", timeout: 20_000 });
  assert(/\/account\/two-step/.test(page.url()) && page.url().includes(encodeURIComponent(club)), `the club page did not lead to the two-step gate (${page.url()})`);
  await visited(ctx, page, "Two-step gate", { rules: checks });

  if (checks) {
    // A3: says plainly why, at the moment it is needed. A5: one name, "two-step sign-in".
    const text = clean(await J.bodyText(page));
    const why = /why this is needed/i.test(text) && /young people|youth/i.test(text) && /medical/i.test(text);
    rec.record("Two-step gate", "A3", "explains why two-step is needed", why ? "pass" : "fail", why ? "\"Why this is needed\" names young people and medical records" : "the gate does not say why (youth and medical records)");
    const other = /\b(two[- ]factor|2[- ]?factor|2fa|mfa|multi[- ]?factor|two[- ]step (verification|authentication)|2[- ]step)\b/i.exec(text);
    rec.record("Two-step gate", "A5", "one name: two-step sign-in", /two-step sign-in/i.test(text) && !other ? "pass" : "fail", other ? `also says "${other[0]}"` : /two-step sign-in/i.test(text) ? "only \"two-step sign-in\"" : "the name \"two-step sign-in\" is missing");
  }

  const options2 = await S.startTwoStepSetup(page);
  if (options2.length > 0) await visited(ctx, page, "Two-step choice", { rules: checks });
  if (checks) {
    const first = options2[0] ?? "";
    const passkeyFirst = /phone or computer|passkey/i.test(first) && /Easiest/.test(first) && /authenticator/i.test(options2[1] ?? "") && !/Easiest/.test(options2[1] ?? "");
    rec.record("Two-step choice", "A4", "passkey first, marked Easiest", passkeyFirst ? "pass" : "fail", options2.length === 0 ? "no choice screen: no passkey option is offered" : `options in order: ${options2.map((option: string) => `"${option.slice(0, 40)}"`).join(", ")}`);
  }
  await S.finishAuthenticatorSetup(page);
  await visited(ctx, page, "Two-step done", { rules: checks });
  await S.openClubFromTwoStepDone(page, director.clubName);
  assert(!(await page.getByText(/Set up two-step sign-in first/).count()), "the club page still asks for two-step after setup");
  await visited(ctx, page, "Club home", { rules: checks });
}

/* ---------------------------------------------------------------- 2. team */

async function teamJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  const leaderEmail = `journeycheck.${world.stamp}.leader@example.test`;
  const since = await S.addTeamAdmin(page, world.clubId, leaderEmail);
  await page.getByText(leaderEmail).first().waitFor({ state: "visible", timeout: 20_000 });
  await visited(ctx, page, "Club settings");
  assert(await page.getByText(/Pending invites/).count(), "the new invite is not listed under Pending invites");

  // The invite email reaches the (fake) outbox, with a link to follow.
  const message = await ctx.mail.waitForMessage(leaderEmail, /invited/i, { since });
  assert(/https?:\/\/\S+/.test(message.text), `the invite email has no link: "${message.subject}"`);

  // B9: cancelling the invite asks first, in the shared dialog.
  const cancel = page.getByRole("button", { name: /Cancel invite to/ });
  await checkConfirmDialog(page, rec, "Club settings", "cancel an invite", () => cancel.click(), cancel);
  assert(await page.getByText(leaderEmail).count(), "cancelling the dialog removed the invite anyway");

  // B6: editing the club profile and leaving warns.
  await checkLeaveWarning(page, rec, "Club settings", "club profile form",
    () => page.locator('input[name="meetingPlace"]').fill(`Journey hall ${world.stamp}`),
    () => page.getByRole("link", { name: exactlyNav("Roster") }).first().click());
}

const exactlyNav = (text: string) => S.exactly(text);

/* ---------------------------------------------------------------- 3. roster (P2) */

async function rosterJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  const url = `${J.baseUrl}${S.clubPath(world.clubId, "/roster")}`;
  const cookie = await J.mintDirectorSession(ctx.tokens, world.main.accountId);
  const second = await newDirectorContext(ctx, { cookie });
  try {
    await J.openRoster(page, url);
    await visited(ctx, page, "Roster");
    await J.openRoster(second.page, url);
    const first = "Zed";
    const last = `Journey${world.stamp}-Zulu`;
    const before = await J.activeCount(page);

    // L7 and B7 on the add dialog: Escape closes it and gives focus back; an empty submit shows the shared errors.
    const addButton = page.locator(".club-roster-heading-actions").getByRole("button", { name: /Add to roster/ });
    await J.openAddDialog(page);
    await checkErrorSummary(page, rec, "Roster add dialog", "empty required fields", () => J.submitRosterForm(page));
    await checkDialogBehavior(page, rec, "Roster add dialog", "add dialog", J.rosterForm(page), addButton);

    // P2: the new person is in the list at once, with no reload; another device sees it after a reload.
    await J.addRosterMember(page, first, last);
    assert(await J.visibleText(page, last), "the new roster member did not appear without a reload");
    if (before !== null) assert((await J.activeCount(page)) === before + 1, `the active count is ${await J.activeCount(page)} after adding, expected ${before + 1}`);
    await second.page.reload({ waitUntil: "load" });
    await J.settleRoster(second.page);
    assert(await J.visibleText(second.page, last), "a second browser did not see the new member after a reload");

    // B9: removing asks first (shared dialog); then really remove, and the other browser sees that after a reload.
    const actions = page.locator(`summary[aria-label^="Actions for ${first} ${last}"]`);
    await checkConfirmDialog(page, rec, "Roster", "remove a member", async () => {
      await actions.click();
      await page.locator(`button[aria-label^="Remove ${first} ${last}"]`).first().click();
    });
    await J.removeRosterMember(page, first, last).catch(async () => {
      await page.reload({ waitUntil: "load" });
      await J.settleRoster(page);
      await J.removeRosterMember(page, first, last);
    });
    await second.page.reload({ waitUntil: "load" });
    await J.settleRoster(second.page);
    assert(!(await second.page.getByText(last, { exact: false }).count()), "a second browser still lists the removed member after a reload");
  } finally {
    await second.context.close();
  }
}

/* ---------------------------------------------------------------- 4. yearly forms */

async function formsJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  // Before the conference turns a form on, the page says so and shows where to get help (H3, H4).
  await S.openPage(page, S.clubPath(world.clubId, "/forms"));
  await visited(ctx, page, "Forms (none turned on)");
  // The conference turns a form on; the director sees it and fills it in.
  const template = await seedClubFormTemplate(ctx.prisma, world);
  await S.openPage(page, S.clubPath(world.clubId, "/forms"));
  await page.getByText(template.name).first().waitFor({ state: "visible", timeout: 20_000 });
  await visited(ctx, page, "Forms");
  await page.getByRole("link", { name: /Fill in/ }).first().click();
  await page.waitForURL(/\/forms\/.+\/new/, { timeout: 20_000 });
  await settle(page);
  await visited(ctx, page, "Fill in a club form");
  // B7: submitting with the required answers missing shows the shared errors.
  await checkErrorSummary(page, rec, "Fill in a club form", "required answers missing", async () => {
    await page.getByRole("button", { name: /Submit form/ }).click();
  });
  await S.fillClubForm(page, { "Where did the club collect": `Journey church lot ${world.stamp}`, "Cans collected": "42" });
  await page.getByRole("button", { name: /Submit form/ }).click();
  await page.waitForURL((url: URL) => !/\/new$/.test(url.pathname), { timeout: 20_000 });
  await settle(page);
  await visited(ctx, page, "Club form submitted");
  await S.openPage(page, S.clubPath(world.clubId, "/forms"));
  await settle(page);
  assert(await J.visibleText(page, template.name), "the filled form is not listed on the Forms page");
  assert(await page.getByText(/1 form/).count(), "the Forms page does not count the filled form");
}

/* ---------------------------------------------------------------- 5. register the club for an event */

async function eventsJourney(ctx: Ctx, page: J.Page) {
  const { world } = ctx;
  await visit(ctx, page, "Club events", S.clubPath(world.clubId, "/events"));
  await page.getByText(world.eventName).first().waitFor({ state: "visible", timeout: 20_000 });
  // The list holds every open club event on the database (another shard's too), so pick this run's by its address.
  await page.locator(`a[href$="/events/${world.eventId}"]`).first().click();
  await page.waitForURL(new RegExp(`/events/${world.eventId}$`), { timeout: 20_000 });
  await settle(page);
  await visited(ctx, page, "Club event: who's going");
  await S.registerClubForEvent(page, { contact: { first: "Dana", last: "Director", email: world.directorEmail }, people: world.rosterNames.slice(0, 2).map(([first, last]) => `${last}, ${first}`) });
  // The confirmation shows the registration's status with one of the approved words.
  await page.getByText(/Your club is registered/).first().waitFor({ state: "visible", timeout: 20_000 });
  // The card first says "Loading your registration..."; the settled card has the contact line.
  await page.getByText(/Questions\? Email/).first().waitFor({ state: "visible", timeout: 20_000 });
  await visited(ctx, page, "Club event: registered");
  const approved = ["Draft", "Submitted", "Pending payment", "Pending approval", "Confirmed", "Waitlisted", "Cancelled", "Refunded"];
  const confirmation = clean(await J.bodyText(page));
  const shown = approved.find((word) => new RegExp(`\\b${word}\\b`, "i").test(confirmation));
  ctx.rec.record("Club event: registered", "B12", "the submitted registration shows an approved status word", shown ? "pass" : "fail", shown ? `the page says "${shown}"` : `none of the approved status words is on the page after submitting; it says "${/REGISTERED|Registered/.test(confirmation) ? "Registered" : "something else"}"`);
  // Back on the list the club's registration shows too (its chip is checked as part of the page).
  await visit(ctx, page, "Club events (registered)", S.clubPath(world.clubId, "/events"));
  assert(await page.locator(".status-chip").filter({ hasText: /going/ }).count(), "the Club events list shows no registration chip after submitting");
}

/* ---------------------------------------------------------------- 6. orders */

async function ordersJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  // Before conference staff load the supply catalog the page says so and says who to ask (H3, H4, H5).
  await visit(ctx, page, "Orders (no catalog yet)", S.clubPath(world.clubId, "/orders"));
  await page.getByRole("link", { name: /Help guide/ }).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  const item = await seedSupplyItem(ctx.prisma, world);
  await visit(ctx, page, "Orders", S.clubPath(world.clubId, "/orders"));
  await S.addOrderLine(page, { item: item.name, quantity: 3 });
  assert(await J.visibleText(page, item.name), "the new line is not in the order list");
  await visited(ctx, page, "Orders (with a line)");
  // The list is live (P2): a reload still shows it.
  await page.reload({ waitUntil: "load" });
  await settle(page);
  assert(await J.visibleText(page, item.name), "the order line is gone after a reload");
  // B9: removing a line asks first.
  const remove = page.getByRole("button", { name: new RegExp(`Remove from the list: ${item.name}`) });
  await checkConfirmDialog(page, rec, "Orders (with a line)", "remove an order line", () => remove.click(), remove);
}

/* ---------------------------------------------------------------- 7. monthly record */

const monthKey = (monthsBack: number) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 15));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

async function monthlyRecordJourney(ctx: Ctx, page: J.Page, options: { rules: boolean } = { rules: true }) {
  const { world, rec } = ctx;
  const month = monthKey(1);
  await S.openPage(page, S.clubPath(world.clubId, `/records?month=${month}`));
  await visited(ctx, page, "Monthly Records", { rules: options.rules });
  await S.openMonthlyRecord(page);
  await visited(ctx, page, "Monthly Record form", { rules: options.rules });
  if (options.rules) {
    // B6: typing in the record and leaving warns.
    await checkLeaveWarning(page, rec, "Monthly Record form", "monthly record",
      () => page.locator('input[name="meetingPlace"]').fill("Warn check"),
      // The form is in a dialog that covers the page's links, so leave the way the address bar does.
      () => page.goto(`${J.baseUrl}${S.clubPath(world.clubId, "/roster")}`));
    await S.openPage(page, S.clubPath(world.clubId, `/records?month=${month}`));
    await S.openMonthlyRecord(page);
  }
  const place = `Journey fellowship hall ${world.stamp}`;
  await S.fillMonthlyRecord(page, { place, attendance: "14", pathfinders: "9", tlts: "2", staff: "4" });
  await S.saveMonthlyRecordDraft(page);
  // Saved, and still there after a reload (P2).
  await page.reload({ waitUntil: "load" });
  await settle(page);
  await S.openMonthlyRecord(page);
  assert((await page.locator('input[name="meetingPlace"]').inputValue()) === place, "the saved monthly record did not keep the meeting place after a reload");
}

/* ---------------------------------------------------------------- 8. year-end */

async function yearEndJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  const { clubYearFor } = await import("../modules/club-rosters/domain");
  const year = clubYearFor(new Date());
  await visit(ctx, page, "Year-End Report", S.clubPath(world.clubId, `/reports/year-end/${year}`));
  await checkLeaveWarning(page, rec, "Year-End Report", "year-end report",
    () => page.locator("#ye-baptismAdult").fill("1"),
    () => page.getByRole("link", { name: S.exactly("Roster") }).first().click());
  await S.fillYearEnd(page, { adultBaptisms: "2", tltMaleLow: "1" });
  await S.saveYearEndDraft(page);
  await page.reload({ waitUntil: "load" });
  await settle(page);
  assert((await page.locator("#ye-baptismAdult").inputValue()) === "2", "the saved year-end draft did not keep its numbers after a reload");
}

/* ---------------------------------------------------------------- 9. getting started and help */

async function helpJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  await visit(ctx, page, "Club home", S.clubPath(world.clubId));
  // H5: the Getting started checklist and its guide are linked from the director's home.
  await page.getByText(/Get your club set up/).first().waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("link", { name: /Read the Getting started guide/ }).first().click();
  await page.waitForURL(/\/account\/help\/director-getting-started/, { timeout: 20_000 });
  await visited(ctx, page, "Getting started guide");
  await S.expectHeading(page, /Getting started/);
  // Help from the account menu lists the director guides.
  await visit(ctx, page, "Help", "/account/help");
  const guide = page.getByRole("link", { name: /Getting started as a club director/ });
  assert(await guide.count(), "the Help page does not list the director's Getting started guide");
  // H5 (search): the Help search finds the director guide. The director's Help page has no search box.
  const search = page.locator('input[type="search"], [role="searchbox"]');
  if ((await search.count()) === 0) rec.record("Help", "H5", "Help search finds the director guide", "fail", "the account Help page has no search box to type in");
  else {
    await search.first().fill("getting started");
    const found = await pollPage<number>(page, () => guide.count(), (count) => count > 0, 4_000);
    rec.record("Help", "H5", "Help search finds the director guide", found.ok ? "pass" : "fail", found.ok ? "searching \"getting started\" lists the guide" : "the guide is not found by searching");
  }
  await guide.first().click();
  await page.waitForURL(/\/account\/help\/director-getting-started/, { timeout: 20_000 });
  await S.expectHeading(page, /Getting started/);
}

/* ---------------------------------------------------------------- 10. forms help popup */

async function formsHelpJourney(ctx: Ctx, page: J.Page) {
  const { world, rec } = ctx;
  await visit(ctx, page, "Forms (help popup)", S.clubPath(world.clubId, "/forms"));
  const opener = page.getByRole("button", { name: /Forms help/ }).first();
  await opener.click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Having form issues/ });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await checkDialogBehavior(page, rec, "Forms (help popup)", "Forms help popup", dialog, opener);
}

/* ---------------------------------------------------------------- area coordinator */

async function coordinatorContext(ctx: Ctx) {
  const coordinator = ctx.world.coordinator!;
  const cookie = await J.mintDirectorSession(ctx.tokens, coordinator.accountId);
  return newDirectorContext(ctx, { cookie });
}

/** Coordinator pages stream their tables in after the page is interactive, so wait for the network to go quiet before checking them. */
const quiet = (page: J.Page) => page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
async function coordinatorVisit(ctx: Ctx, page: J.Page, name: string, path: string) {
  await S.openPage(page, path);
  await quiet(page);
  await visited(ctx, page, `Coordinator: ${name}`, { coordinator: true });
}
async function coordinatorVisited(ctx: Ctx, page: J.Page, name: string) {
  await quiet(page);
  await visited(ctx, page, `Coordinator: ${name}`, { coordinator: true });
}

/** 1. Their clubs: every active club is listed (an area coordinator sees all clubs by design, #387), and one opens view only. */
async function coordinatorClubsJourney(ctx: Ctx, page: J.Page) {
  const { clubs } = ctx.world.coordinator!;
  await coordinatorVisit(ctx, page, "All clubs", "/account/clubs");
  for (const club of [ctx.world.main, clubs.missing, clubs.complete, clubs.outside]) {
    assert(await page.getByText(club.clubName).first().isVisible(), `the club list does not show ${club.clubName}`);
  }
  // Decision (not a bug): the role sees every active club, with the ones it does not run marked "View only". The
  // coordinator's brief asked for "only their area's clubs", but no area exists in the data model; the club stands for
  // "a club outside the area" and is expected to be listed.
  ctx.rec.record("Coordinator: All clubs", "Scope", "every active club is listed (#387), including one outside any area", "pass", "the outside club is listed with View only, as the role is defined");
  assert(await page.getByText(/Showing 1.\d+ of \d+ clubs/).count(), "the list does not say how many clubs it shows");
  await page.locator(`a[href$="/account/area/${clubs.complete.clubId}"]`).first().click();
  await page.waitForURL(new RegExp(`/account/area/${clubs.complete.clubId}$`), { timeout: 20_000 });
  await coordinatorVisited(ctx, page, "Club (view only)");
  assert(await page.getByText(/View only/).count(), "the club page does not say it is view only");
}

/** 2. Who's missing what: the club without a record is listed, the complete one is not. */
async function coordinatorMissingJourney(ctx: Ctx, page: J.Page) {
  const { clubs } = ctx.world.coordinator!;
  await coordinatorVisit(ctx, page, "Overview", "/account/area-clubs/overview");
  const section = page.locator("#whos-missing-what");
  await section.waitFor({ state: "visible", timeout: 20_000 });
  const text = clean(await section.innerText());
  assert(text.includes(clubs.missing.clubName), "Who's missing what does not list the club with no monthly record");
  assert(/Missing/.test(text), "Who's missing what shows no Missing chip");
  assert(!text.includes(clubs.complete.clubName), "Who's missing what lists the club whose records are all in");
  // Its next step opens that club.
  await section.locator(`a[href$="/account/area/${clubs.missing.clubId}"]`).first().click();
  await page.waitForURL(new RegExp(`/account/area/${clubs.missing.clubId}$`), { timeout: 20_000 });
}

/** 3. Monthly review: a submitted record opens read only; a club with none says Not submitted. The coordinator has no approval to give. */
async function coordinatorRecordsJourney(ctx: Ctx, page: J.Page) {
  const { clubs, submittedMonths } = ctx.world.coordinator!;
  // A month that has ended (the current month is "Not due yet" for everyone).
  const month = submittedMonths[Math.max(0, submittedMonths.length - 2)]!;
  await coordinatorVisit(ctx, page, "Monthly Records", `/account/area-clubs/reports?month=${month}`);
  // The club's row appears in more than one table on the page (the month table and the full-year grid); any may say it.
  const rowsOf = (name: string) => () => page.locator("tr").filter({ hasText: name }).allInnerTexts().then((rows: string[]) => rows.map(clean));
  // With many clubs the month view lists only some, so find each club the way a coordinator would: search by name.
  const search = page.locator("#area-club-search");
  await search.fill(clubs.missing.clubName);
  const missing = await pollPage<string[]>(page, rowsOf(clubs.missing.clubName), (rows) => rows.some((row) => /Not submitted/.test(row)), 8_000);
  assert(missing.ok, `the club with no record is not shown as Not submitted (rows: ${JSON.stringify(missing.value)})`);
  await search.fill(clubs.complete.clubName);
  const complete = await pollPage<string[]>(page, rowsOf(clubs.complete.clubName), (rows) => rows.some((row) => /Submitted/.test(row)), 8_000);
  assert(complete.ok, `the club with a record is not shown as Submitted (rows: ${JSON.stringify(complete.value)})`);
  await page.locator(`a[href*="/account/area/${clubs.complete.clubId}/reports/${month}"]`).first().click();
  await page.waitForURL(new RegExp(`/area/${clubs.complete.clubId}/reports/${month}`), { timeout: 20_000 });
  await coordinatorVisited(ctx, page, "Monthly Record (read only)");
  assert(await page.getByText(/Submitted \(/).count(), "the record does not show its Submitted state");
  // Read only: nothing here saves, submits or approves (the page says the club files and changes its own reports).
  assert(!(await page.getByRole("button", { name: /Save draft|Submit report|Reviewed|Approve/ }).count()), "the coordinator's record page offers a save, submit or approve button");
}

/** 4. Points: every seeded club is ranked; the club with three submitted records leads. The page has no action to take. */
async function coordinatorPointsJourney(ctx: Ctx, page: J.Page) {
  const { clubs, submittedMonths } = ctx.world.coordinator!;
  await coordinatorVisit(ctx, page, "Points", "/account/area-clubs/points");
  const leader = page.getByText(clubs.complete.clubName).first();
  await leader.waitFor({ state: "visible", timeout: 20_000 });
  assert(await page.getByText(clubs.missing.clubName).first().isVisible(), "the points chart does not list the club with no records");
  assert(await page.getByText(new RegExp(`${submittedMonths.length * 25}\\s*total points`)).count(), `the leader's ${submittedMonths.length * 25} points are not shown`);
}

/** 5. Help: the coordinator's Getting started guide is linked from Overview, and Help lists it (H5). */
async function coordinatorHelpJourney(ctx: Ctx, page: J.Page) {
  const { rec } = ctx;
  await coordinatorVisit(ctx, page, "Overview (Getting started)", "/account/area-clubs/overview");
  await page.getByText(/Getting started as an area coordinator/).first().waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("link", { name: /Read the Getting started guide/ }).first().click();
  await page.waitForURL(/\/account\/help\/coordinator-getting-started/, { timeout: 20_000 });
  await coordinatorVisited(ctx, page, "Getting started guide");
  await coordinatorVisit(ctx, page, "Help", "/account/help");
  const guide = page.getByRole("link", { name: /Getting started as an area coordinator/ });
  assert(await guide.count(), "the Help page does not list the coordinator's Getting started guide");
  const search = page.locator('input[type="search"], [role="searchbox"]');
  if ((await search.count()) === 0) rec.record("Coordinator: Help", "H5", "Help search finds the coordinator guide", "fail", "the account Help page has no search box to type in");
  else {
    await search.first().fill("getting started");
    const found = await pollPage<number>(page, () => guide.count(), (count) => count > 0, 4_000);
    rec.record("Coordinator: Help", "H5", "Help search finds the coordinator guide", found.ok ? "pass" : "fail", found.ok ? "searching lists the guide" : "the guide is not found by searching");
  }
  await guide.first().click();
  await page.waitForURL(/\/account\/help\/coordinator-getting-started/, { timeout: 20_000 });
  await S.expectHeading(page, /Getting started/);
}

/* ---------------------------------------------------------------- key journey, translated and blocked */

/**
 * The key club director journey (sign in with the emailed code, set up two-step, add a roster member, fill and save a
 * monthly record) for a director of their own club, with the Google-Translate simulation or with the privacy-browser
 * blocker lists. Rule checks are left to the plain runs; this proves the journey still works (rules T1, P2).
 */
async function keyJourneyVariant(ctx: Ctx, director: Director, mode: "translate" | "blockers") {
  const { world } = ctx;
  const { context, page } = await newDirectorContext(ctx, { translate: mode === "translate", block: mode === "blockers" });
  try {
    await signInJourney(ctx, page, director, { rules: false });
    const url = `${J.baseUrl}${S.clubPath(director.clubId, "/roster")}`;
    await J.openRoster(page, url);
    const first = "Zed";
    const last = `Journey${world.stamp}-${mode}`;
    const before = await J.activeCount(page);
    await J.addRosterMember(page, first, last);
    assert(await J.visibleText(page, last), `${mode}: the new roster member did not appear without a reload`);
    if (before !== null) assert((await J.activeCount(page)) === before + 1, `${mode}: the active count did not follow the new member`);
    await J.assertHealthy(page, `${ctx.viewport.name}: ${mode} roster`, problems);

    await S.openPage(page, S.clubPath(director.clubId, `/records?month=${monthKey(1)}`));
    await settle(page);
    await S.openMonthlyRecord(page);
    const place = `Journey ${mode} hall ${world.stamp}`;
    await S.fillMonthlyRecord(page, { place, attendance: "12", pathfinders: "8", tlts: "1", staff: "3" });
    await S.saveMonthlyRecordDraft(page);
    await J.assertHealthy(page, `${ctx.viewport.name}: ${mode} monthly record`, problems);

    if (mode === "blockers") console.log(`    (${blockedRequests} request(s) were blocked by the filter lists so far)`);
    if (mode === "translate") {
      const exact: string[] = await page.evaluate("window.__translationSimExactValues()");
      assert(exact.length === 0, `translate="no" values were rewritten: ${exact.join(" | ")}`);
      // The simulator starts once the page has hydrated, like a person turning translation on, so wait for it.
      await page.waitForFunction(() => (window as unknown as { __translationSim: { wrapped: number } }).__translationSim.wrapped >= 20, undefined, { timeout: 30_000 })
        .catch(async () => { throw new Error(`the simulator rewrote only ${await page.evaluate("window.__translationSim.wrapped")} text nodes; it is not running`); });
    }
  } finally {
    await context.close();
  }
}

/* ---------------------------------------------------------------- run */

const ONLY = (process.env.JOURNEY_ONLY ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const wanted = (id: string) => ONLY.length === 0 || ONLY.includes(id) || (ONLY.includes("C") && id.startsWith("C"));

async function runShard(ctx: Ctx) {
  const { world } = ctx;
  // Signed in as the main director through the real sign-in (journey 1), then used for everything else.
  const main = await newDirectorContext(ctx);
  try {
    await journey(ctx, "1. Sign in with the emailed code and set up two-step", () => signInJourney(ctx, main.page, world.main, { rules: true }));
    if (wanted("2")) await journey(ctx, "2. Team: add a leader, the invite email arrives", () => teamJourney(ctx, main.page));
    if (wanted("3")) await journey(ctx, "3. Roster: add a member, see it at once, a second browser sees it", () => rosterJourney(ctx, main.page));
    if (wanted("4")) await journey(ctx, "4. Yearly forms: open, fill one in", () => formsJourney(ctx, main.page));
    if (wanted("5")) await journey(ctx, "5. Register the club for an event", () => eventsJourney(ctx, main.page));
    if (wanted("6")) await journey(ctx, "6. Orders: add a line to the order list", () => ordersJourney(ctx, main.page));
    if (wanted("7")) await journey(ctx, "7. Monthly record: fill and save", () => monthlyRecordJourney(ctx, main.page));
    if (wanted("8")) await journey(ctx, "8. Year-end report: fill and save", () => yearEndJourney(ctx, main.page));
    if (wanted("9")) await journey(ctx, "9. Getting started checklist and Help", () => helpJourney(ctx, main.page));
    if (wanted("10")) await journey(ctx, "10. Forms help popup", () => formsHelpJourney(ctx, main.page));
  } finally {
    await main.context.close();
  }
  if (["C1", "C2", "C3", "C4", "C5"].some(wanted)) {
    await seedCoordinatorWorld(ctx.prisma, world);
    const coordinator = await coordinatorContext(ctx);
    try {
      if (wanted("C1")) await journey(ctx, "C1. Coordinator: the club list", () => coordinatorClubsJourney(ctx, coordinator.page));
      if (wanted("C2")) await journey(ctx, "C2. Coordinator: who's missing what", () => coordinatorMissingJourney(ctx, coordinator.page));
      if (wanted("C3")) await journey(ctx, "C3. Coordinator: open a submitted monthly record", () => coordinatorRecordsJourney(ctx, coordinator.page));
      if (wanted("C4")) await journey(ctx, "C4. Coordinator: points", () => coordinatorPointsJourney(ctx, coordinator.page));
      if (wanted("C5")) await journey(ctx, "C5. Coordinator: Getting started and Help", () => coordinatorHelpJourney(ctx, coordinator.page));
    } finally {
      await coordinator.context.close();
    }
  }
  const [, translate, blockers] = world.directors;
  if (wanted("T")) await journey(ctx, "Key journey with the translation simulation", () => keyJourneyVariant(ctx, translate!, "translate"));
  if (wanted("B")) await journey(ctx, "Key journey with the privacy-browser blocker lists", () => keyJourneyVariant(ctx, blockers!, "blockers"));
}

async function main() {
  J.guardLocal();
  const playwright = await J.loadPlaywright();
  const shardFilter = process.env.JOURNEY_SHARD?.trim();
  const chosen = viewports.filter((viewport) => !shardFilter || viewport.name === shardFilter);
  if (chosen.length === 0) throw new Error(`JOURNEY_SHARD must be desktop or phone (got "${shardFilter}")`);
  const prisma = new PrismaClient();
  await resetSignInBudgets(prisma);
  const mail = new FakeMailServer();
  await mail.start();
  const settings = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { passkeyRpId: true } });
  await prisma.platformSettings.upsert({ where: { id: "platform" }, update: { passkeyRpId: "localhost" }, create: { id: "platform", passkeyRpId: "localhost" } });
  const summaries: string[] = [];
  const worlds: JourneyWorld[] = [];
  const tokens: string[] = [];
  const recorders: Recorder[] = [];
  try {
    for (const viewport of chosen) {
      const started = Date.now();
      console.log(`\n== ${viewport.name} (${viewport.width}px)`);
      const world = await seedJourneyWorld(prisma, viewport.name);
      worlds.push(world);
      const rec = new Recorder(viewport.name, KNOWN_BUGS);
      recorders.push(rec);
      for (const name of (process.env.JOURNEY_BROWSERS ?? "chromium").split(",").map((value) => value.trim()).filter(Boolean)) {
        const browser = await J.launch(playwright, name);
        try {
          await runShard({ browser, world, mail, rec, viewport, prisma, tokens, failures: problems });
        } finally {
          await browser.close();
        }
      }
      summaries.push(`${viewport.name}: ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  } finally {
    await J.revokeSessions(tokens);
    if (process.env.JOURNEY_KEEP_DATA !== "1") for (const world of worlds) await cleanupJourneyWorld(prisma, world);
    await prisma.platformSettings.updateMany({ where: { id: "platform" }, data: { passkeyRpId: settings?.passkeyRpId ?? null } });
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
  console.log("\nClub director journeys: OK");
}

main().catch((error) => { console.error(error); process.exit(1); });
