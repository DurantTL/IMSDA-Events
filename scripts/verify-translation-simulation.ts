/**
 * Browser-translation simulation (#1445, site rule T1).
 *
 * Chrome's "Translate this page", Edge and Safari rewrite the page's text
 * nodes (Google Translate wraps each in `<font>` elements) while React still
 * holds the original nodes. That used to crash React apps ("removeChild" /
 * "insertBefore" errors) or leave text stale after a state change. This check
 * injects a rewriter that does the same to every text node outside a
 * `translate="no"` subtree (scripts/support/browser-journeys.ts), then uses the
 * key journeys the way a Spanish-speaking club director or registrant would:
 *
 *  - public registration: validation errors, then fixed; add and remove an
 *    attendee (a list that re-renders); a promo code; Back and Continue; the
 *    review step with its amounts;
 *  - club roster: open and close the dialogs, search as you type, filters,
 *    submit with errors then fixed, add and remove a person;
 *  - the club portal's other pages, the public event page and the sign-in form.
 *
 * It fails on any uncaught page error, React error screen or blank page, on
 * text that stays stale after a change, and on a `translate="no"` value that was
 * rewritten or is not exact.
 *
 * LOCAL USE ONLY (see scripts/support/browser-journeys.ts).
 *
 *   npm i --no-save playwright@1.63.0 && npx playwright install chromium firefox webkit
 *   npm run test:translation-sim
 *
 * Environment: JOURNEY_BASE_URL (default http://localhost:3000),
 * JOURNEY_BROWSERS (default chromium,firefox,webkit), JOURNEY_KEEP_DATA=1,
 * JOURNEY_WITHOUT_GUARD=1 (drops the removeChild/insertBefore guard in the page,
 * to prove this check catches the crash it exists to catch).
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import * as J from "./support/browser-journeys";

loadEnvConfig(process.cwd());

const failures: J.Failures = [];
const fail = (message: string) => { failures.push(message); console.error(`  FAIL ${message}`); };

/** Runs one named step; a thrown error is a failure of that step, not of the whole run. */
async function step(label: string, page: J.Page, run: () => Promise<void>) {
  try {
    await run();
    await J.assertHealthy(page, label, failures);
  } catch (error) {
    fail(`${label}: ${(error as Error).message.split("\n").slice(0, 6).join(" ").slice(0, 700)}`);
  }
}

async function expectText(page: J.Page, text: string | RegExp, label: string) {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    fail(`${label}: "${String(text)}" never appeared`);
  }
}

async function expectGone(page: J.Page, text: string | RegExp, label: string) {
  try {
    await page.getByText(text).first().waitFor({ state: "detached", timeout: 10_000 });
  } catch {
    fail(`${label}: "${String(text)}" is still showing (stale text)`);
  }
}

/** Every `translate="no"` value on the page that looks like an amount must be exactly an amount. */
async function expectExactValues(page: J.Page, label: string, expected: { amounts?: number; texts?: string[] }) {
  const result = await page.evaluate(() => {
    const exactNodes = Array.from(document.querySelectorAll('[translate="no"]'));
    return {
      rewritten: (window as unknown as { __translationSimExactValues?(): string[] }).__translationSimExactValues?.() ?? [],
      amounts: exactNodes.map((node) => (node.textContent ?? "").trim()).filter((text) => /\$\d/.test(text)),
      texts: exactNodes.map((node) => (node.textContent ?? "").trim()),
    };
  });
  if (result.rewritten.length) fail(`${label}: translate="no" values were rewritten: ${result.rewritten.join(" | ")}`);
  for (const text of result.amounts) {
    if (!/^[−-]?\$[\d,]+\.\d{2}$/.test(text)) fail(`${label}: an amount in translate="no" is not exact: "${text}"`);
  }
  if (expected.amounts !== undefined && result.amounts.length < expected.amounts) fail(`${label}: expected at least ${expected.amounts} exact amounts, found ${result.amounts.length}`);
  for (const text of expected.texts ?? []) {
    if (!result.texts.includes(text)) fail(`${label}: "${text}" is not in a translate="no" element`);
  }
}

/** The removeChild/insertBefore guard (instrumentation-client.ts) must be in place on every kind of page, before React hydrates. */
async function guardInstalled(page: J.Page, label: string) {
  if (process.env.JOURNEY_WITHOUT_GUARD === "1") return;
  const installed = await page.evaluate(() => (Node.prototype as unknown as Record<symbol, unknown>)[Symbol.for("imsda.translationSafeDom")] === true);
  if (!installed) fail(`${label}: the translation guard is not installed`);
}

async function translated(page: J.Page) {
  if (process.env.JOURNEY_TRANSLATE === "0") return;
  await page.waitForFunction(() => ((window as unknown as { __translationSim?: { wrapped: number } }).__translationSim?.wrapped ?? 0) > 0, undefined, { timeout: 30_000 });
}

/* ---------------------------------------------------------------- journeys */

async function publicRegistration(context: J.BrowserContext) {
  const page = await context.newPage();
  J.watchPage(page, failures);
  const label = "public registration";
  await page.goto(`${J.baseUrl}/register/${J.eventSlug}/${J.formSlug}`, { waitUntil: "load" });
  await page.getByRole("button", { name: /Continue/ }).waitFor({ state: "visible", timeout: 20_000 });
  await translated(page);
  await guardInstalled(page, label);

  // Validation errors appear, then go away once fixed.
  await step(`${label}: errors on an empty step`, page, async () => {
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectText(page, /First name is required/, `${label}: first error`);
  });
  await step(`${label}: fix the errors`, page, async () => {
    await page.getByLabel(/First name/).first().fill("Pat");
    await page.getByLabel(/Last name/).first().fill("Sample");
    await page.getByLabel(/Email/).first().fill("pat@example.test");
    await expectGone(page, /First name is required/, `${label}: first error after fixing`);
  });

  // The promo code, applied on the contact step.
  await step(`${label}: promo code`, page, async () => {
    await page.getByLabel(/Promo code/).first().fill(J.promoCode);
    await page.getByRole("button", { name: /Apply/ }).first().click();
    await expectText(page, /Promo code .*TRANSPROMO/, `${label}: promo line`);
    await expectText(page, /−\$12\.50|-\$12\.50/, `${label}: discount amount`);
  });
  await step(`${label}: to attendees`, page, async () => {
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectText(page, /Attendee roster/, `${label}: attendee step`);
  });

  // A list that re-renders: add an attendee, then remove it.
  await step(`${label}: add and remove an attendee`, page, async () => {
    await page.getByRole("button", { name: /Add another attendee/ }).click();
    await expectText(page, /2 of 3/, `${label}: roster count after adding`);
    await expectText(page, /Attendee 2/i, `${label}: second attendee card`);
    await page.getByRole("button", { name: /Remove/ }).last().click();
    await expectText(page, /1 of 3/, `${label}: roster count after removing`);
  });
  await step(`${label}: edit the first attendee`, page, async () => {
    await page.getByRole("button", { name: /^(\[es\] )?Edit/ }).first().click();
    await expectText(page, /Registration fee/, `${label}: the attendee's fields`);
  });
  await step(`${label}: attendee names, back and forward`, page, async () => {
    await page.getByLabel(/First name/).first().fill("Lee");
    await page.getByLabel(/Last name/).first().fill("Sample");
    await page.getByRole("button", { name: /Back/ }).click();
    await expectText(page, /STEP 1 OF 3|Step 1 of 3/, `${label}: back to step 1`);
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("button", { name: /Continue/ }).click();
  });
  await step(`${label}: review`, page, async () => {
    await expectText(page, /Review & submit/, `${label}: review step`);
    await expectText(page, /Registration total/, `${label}: totals`);
    await expectExactValues(page, `${label}: review`, { amounts: 3, texts: ["$112.50", "pat@example.test"].filter((text) => text.startsWith("$")) });
  });
  await page.close();
}

async function clubRoster(context: J.BrowserContext) {
  const page = await context.newPage();
  J.watchPage(page, failures);
  const label = "club roster";
  const [first, last] = [J.rosterNames[0][0], J.rosterNames[0][1]];
  await J.openRoster(page);
  await guardInstalled(page, label);

  await step(`${label}: open and close the add dialog`, page, async () => {
    await J.openAddDialog(page);
    await page.keyboard.press("Escape");
    await page.locator("#roster-dialog-title").waitFor({ state: "detached", timeout: 10_000 });
  });
  await step(`${label}: errors on an empty add, then fixed`, page, async () => {
    await J.openAddDialog(page);
    await J.submitRosterForm(page);
    await expectText(page, /first name|required/i, `${label}: validation message`);
    await J.fillRosterForm(page, "Zed", "Transcheck-Temporary");
    await J.submitRosterForm(page);
    await page.locator("#roster-dialog-title").waitFor({ state: "detached", timeout: 15_000 });
    await expectText(page, "Transcheck-Temporary", `${label}: the new person`);
  });
  await step(`${label}: the count follows the list`, page, async () => {
    const count = await J.activeCount(page);
    if (count !== J.rosterNames.length + 1) fail(`${label}: the active count shows ${count} after adding, expected ${J.rosterNames.length + 1}`);
  });
  await step(`${label}: search as you type`, page, async () => {
    const search = page.locator("#roster-search");
    await search.pressSequentially(first, { delay: 30 });
    await expectText(page, last, `${label}: matching person while searching`);
    await expectGone(page, J.rosterNames[1][1], `${label}: a non-matching person is filtered out`);
    await search.fill("");
    await expectText(page, J.rosterNames[1][1], `${label}: the full list after clearing`);
  });
  await step(`${label}: filters`, page, async () => {
    await page.getByRole("button", { name: /Details needed/ }).first().click();
    await page.getByRole("button", { name: /Show gender/ }).click();
    await page.getByRole("button", { name: /Show gender/ }).click();
    await page.getByRole("button", { name: /Details needed/ }).first().click();
  });
  await step(`${label}: edit dialog opens and cancels`, page, async () => {
    await page.getByRole("button", { name: `Edit ${first} ${last}` }).click();
    await page.locator("#roster-dialog-title").waitFor({ state: "visible", timeout: 10_000 });
    await expectExactValues(page, `${label}: dialog`, { texts: [`${first} ${last}`] });
    await rosterCancel(page);
  });
  await step(`${label}: remove the added person`, page, async () => {
    await J.removeRosterMember(page, "Zed", "Transcheck-Temporary");
    const count = await J.activeCount(page);
    if (count !== J.rosterNames.length) fail(`${label}: the active count shows ${count} after removing, expected ${J.rosterNames.length}`);
  });
  await step(`${label}: names stay exact`, page, async () => {
    await expectExactValues(page, label, { texts: [`${J.rosterNames[1][1]}, ${J.rosterNames[1][0]}`] });
  });
  await page.close();
}

async function rosterCancel(page: J.Page) {
  await J.rosterForm(page).getByRole("button", { name: /Cancel/ }).click();
  await page.locator("#roster-dialog-title").waitFor({ state: "detached", timeout: 10_000 });
}

async function clubPages(context: J.BrowserContext) {
  const page = await context.newPage();
  J.watchPage(page, failures);
  for (const [name, suffix] of [["home", ""], ["orders", "/orders"], ["settings", "/profile"], ["forms", "/forms"], ["events", "/events"]] as const) {
    await step(`club ${name}`, page, async () => {
      await page.goto(`${J.baseUrl}/account/clubs/${J.clubId}${suffix}`, { waitUntil: "load" });
      await page.locator("main, [role=main], body").first().waitFor({ state: "visible" });
      await translated(page);
      await guardInstalled(page, `club ${name}`);
      await page.waitForTimeout(400);
      await expectExactValues(page, `club ${name}`, {});
    });
  }
  // The club profile form: an error from a cleared required field, then fixed and saved.
  await step("club settings form: error, then fixed", page, async () => {
    await page.goto(`${J.baseUrl}/account/clubs/${J.clubId}/profile`, { waitUntil: "load" });
    await translated(page);
    const name = page.locator('input[name="name"]');
    await name.fill("");
    await page.locator('form button[type="submit"]').first().click();
    await name.fill("Transcheck Trailblazers");
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(800);
  });
  await page.close();
}

async function publicPages(context: J.BrowserContext) {
  const page = await context.newPage();
  J.watchPage(page, failures);
  await step("public event page", page, async () => {
    await page.goto(`${J.baseUrl}/events/${J.eventSlug}`, { waitUntil: "load" });
    await translated(page);
    await guardInstalled(page, "public event page");
    await expectExactValues(page, "public event page", {});
  });
  await step("sign-in form: error, then fixed", page, async () => {
    await page.goto(`${J.baseUrl}/sign-in`, { waitUntil: "load" });
    await translated(page);
    await guardInstalled(page, "sign-in form");
    const email = page.locator('input[type="email"]').first();
    await email.fill("not-an-email");
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(400);
    await email.fill("someone@example.test");
  });
  await page.close();
}

/* -------------------------------------------------------------------- main */

async function main() {
  J.guardLocal();
  const playwright = await J.loadPlaywright();
  const prisma = new PrismaClient();
  const tokens: string[] = [];
  try {
    await J.cleanupJourneyData(prisma);
    await J.seedJourneyData(prisma);
    const cookie = await J.mintDirectorSession(tokens);
    for (const name of J.browserNames()) {
      console.log(`- ${name}`);
      const browser = await J.launch(playwright, name);
      try {
        const visitor = await J.newContext(browser, { translate: process.env.JOURNEY_TRANSLATE !== "0", withoutGuard: process.env.JOURNEY_WITHOUT_GUARD === "1" });
        const director = await J.newContext(browser, { translate: true, cookie, withoutGuard: process.env.JOURNEY_WITHOUT_GUARD === "1" });
        const before = failures.length;
        await publicRegistration(visitor).catch((error) => fail(`${name}: public registration: ${(error as Error).message.split("\n")[0]}`));
        await clubRoster(director).catch((error) => fail(`${name}: club roster: ${(error as Error).message.split("\n")[0]}`));
        await clubPages(director).catch((error) => fail(`${name}: club pages: ${(error as Error).message.split("\n")[0]}`));
        await publicPages(visitor).catch((error) => fail(`${name}: public pages: ${(error as Error).message.split("\n")[0]}`));
        console.log(`  ${name}: ${failures.length - before} problem(s)`);
        await visitor.close();
        await director.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await J.revokeSessions(tokens);
    if (process.env.JOURNEY_KEEP_DATA !== "1") await J.cleanupJourneyData(prisma);
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):\n${failures.map((line) => `  - ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nTranslation simulation: OK");
}

main().catch((error) => { console.error(error); process.exit(1); });
