/**
 * Live roster check in real browsers (#1445, site rule P2).
 *
 * A club director adds a member and sees it at once, with no manual refresh. A
 * second browser context (another device) sees it after a reload, and sees the
 * removal the same way. The roster API answers with `Cache-Control: no-store`.
 * When the request is blocked the person sees a clear message and a Reload
 * button, never a silent stale list. Each flow runs twice per browser: as is,
 * and with the Google-Translate simulation rewriting every text node.
 *
 * LOCAL USE ONLY (see scripts/support/browser-journeys.ts). Member names are
 * unique per run ("Livecheck-..."), so other runs on the same database do not
 * collide with this one.
 *
 *   npm i --no-save playwright@1.63.0 && npx playwright install chromium firefox webkit
 *   npm run test:live-roster
 *
 * Environment: JOURNEY_BASE_URL (default http://localhost:3000),
 * JOURNEY_BROWSERS (default chromium,firefox,webkit), JOURNEY_KEEP_DATA=1.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import * as J from "./support/browser-journeys";

loadEnvConfig(process.cwd());

const failures: J.Failures = [];
const fail = (message: string) => { failures.push(message); console.error(`  FAIL ${message}`); };

async function expectText(page: J.Page, text: string, label: string) {
  if (!(await J.visibleText(page, text))) fail(`${label}: "${text}" never appeared`);
}

async function flow(browser: J.Browser, browserName: string, translate: boolean, cookie: Awaited<ReturnType<typeof J.mintDirectorSession>>) {
  const mode = `${browserName}${translate ? " + translation" : ""}`;
  console.log(`- ${mode}`);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const first = "Zed";
  const last = `Livecheck-${browserName}-${translate ? "t" : "p"}-${stamp}`;

  const a = await J.newContext(browser, { translate, cookie });
  const b = await J.newContext(browser, { translate, cookie });
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  J.watchPage(pageA, failures);
  J.watchPage(pageB, failures);
  try {
    await J.openRoster(pageA);
    await J.openRoster(pageB);
    const before = await J.activeCount(pageA);
    if (before === null) fail(`${mode}: could not read the active count`);

    // The API is never cached.
    const api = await a.request.get(`${J.baseUrl}/api/attendee/clubs/${J.clubId}/roster`);
    if (!/no-store/.test(api.headers()["cache-control"] ?? "")) fail(`${mode}: roster API Cache-Control is "${api.headers()["cache-control"]}"`);

    // Add: the new person is in the list at once, and the count follows.
    await J.addRosterMember(pageA, first, last);
    await expectText(pageA, last, `${mode}: after adding`);
    if (before !== null) {
      const after = await J.activeCount(pageA);
      if (after !== before + 1) fail(`${mode}: the active count shows ${after} after adding, expected ${before + 1}`);
    }
    await J.assertHealthy(pageA, `${mode}: after adding`, failures);

    // A second device sees it after a reload.
    await pageB.reload({ waitUntil: "load" });
    await J.settleRoster(pageB);
    await expectText(pageB, last, `${mode}: second context after reload`);
    if (before !== null && (await J.activeCount(pageB)) !== before + 1) fail(`${mode}: second context count after reload is ${await J.activeCount(pageB)}`);

    // Remove: gone at once here, gone after a reload there.
    await J.removeRosterMember(pageA, first, last);
    if (before !== null && (await J.activeCount(pageA)) !== before) fail(`${mode}: the active count shows ${await J.activeCount(pageA)} after removing, expected ${before}`);
    await pageB.reload({ waitUntil: "load" });
    await J.settleRoster(pageB);
    if (await pageB.getByText(last, { exact: false }).count()) fail(`${mode}: second context still lists the removed person after a reload`);

    // Blocked request: a clear message and a Reload button, never a silent stale list.
    await pageA.route(`**/api/attendee/clubs/${J.clubId}/roster`, (route: { request(): { method(): string }; abort(): Promise<void>; continue(): Promise<void> }) =>
      route.request().method() === "POST" ? route.abort() : route.continue());
    await J.openAddDialog(pageA);
    await J.fillRosterForm(pageA, first, `${last}-blocked`);
    await J.submitRosterForm(pageA);
    if (!(await J.visibleText(pageA, "connection was lost or blocked"))) fail(`${mode}: a blocked save showed no message`);
    else if (!(await pageA.getByRole("button", { name: /Reload/ }).first().isVisible())) fail(`${mode}: a blocked save showed no Reload button`);
    await pageA.unroute(`**/api/attendee/clubs/${J.clubId}/roster`);
    await J.assertHealthy(pageA, `${mode}: after a blocked save`, failures);

    if (translate) {
      const exact: string[] = await pageA.evaluate("window.__translationSimExactValues()");
      if (exact.length) fail(`${mode}: translate="no" values were rewritten: ${exact.join(" | ")}`);
      const wrapped: number = await pageA.evaluate("window.__translationSim.wrapped");
      if (wrapped < 20) fail(`${mode}: the simulator rewrote only ${wrapped} text nodes; it is not running`);
    }
  } catch (error) {
    fail(`${mode}: ${(error as Error).message.split("\n").slice(0, 3).join(" ").slice(0, 400)}`);
  } finally {
    await a.close();
    await b.close();
  }
}

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
      const browser = await J.launch(playwright, name);
      try {
        await flow(browser, name, false, cookie);
        await flow(browser, name, true, cookie);
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
  console.log("\nLive roster: OK");
}

main().catch((error) => { console.error(error); process.exit(1); });
