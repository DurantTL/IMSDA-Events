/**
 * Real-browser task check for the staff shell on a phone and an iPad (#1566).
 *
 * Not a screenshot audit: it does the work a staff member does, at 390 px (a phone) and 820 px (an iPad), and fails when a
 * step cannot be finished. As a system administrator (who holds every workspace):
 *
 *  1. switch workspace through the account menu (labelled dialog, Close, focus in, Tab kept inside, Escape returns focus);
 *  2. find the registration form with "Find a page or task" (the header search, or the More sheet on a phone) and open it;
 *  3. enter an edit page, change a field, try to leave, get the unsaved-changes guard, stay, then leave;
 *  4. open a record and come back to the list with its search kept;
 *  5. check an attendee in (and undo it, so the run can be repeated);
 *  6. reach a secondary tool through More (the sheet on a phone, the Event setup tab on an iPad);
 *  7. the sheets fit the screen with Close in view, and a focused field is never under the bottom bar.
 *
 * Then as limited roles, asserting each sees only their subset in every menu (rail, tab row, bottom bar, More sheet) and
 * that a page outside it says so: check-in staff (Charlie Check-in) and kitchen-only staff (a synthetic account this
 * script creates).
 *
 * LOCAL USE ONLY, like scripts/verify-mobile-layout.ts: it mints sessions that skip the second factor and writes one
 * synthetic kitchen-staff account (phonetask.kitchen@imsda-events.test), so it refuses to run with NODE_ENV=production,
 * with a DATABASE_URL or STAFF_PHONE_BASE_URL that is not on this machine, or against a database without the seeded
 * accounts. Run it against a production build (`npm run build && npm run start`) on a migrated and seeded database. CI runs
 * it in the "club-journeys" job, after the journeys, against that job's own database.
 *
 *   npm i --no-save playwright-core@1.56.1
 *   STAFF_PHONE_BASE_URL=http://localhost:3000 npm run test:staff-phone-tasks
 *
 * Environment:
 *   STAFF_PHONE_BASE_URL  default http://localhost:3000
 *   STAFF_PHONE_WIDTHS    comma list of widths (default 390,820)
 *   STAFF_PHONE_BROWSER   path to a Chromium executable (default: Playwright's)
 *   STAFF_PHONE_OUT_DIR   screenshots of a failing step are saved here (default: a temp dir)
 *   STAFF_PHONE_ONLY      run only the tasks whose name contains this text
 *   DATABASE_URL          the local database the app uses (read from .env when not exported)
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "@prisma/client";
import { assertLocalDatabase, assertLocalUrl, assertSeededStaffEmail } from "./support/local-only-guard";

loadEnvConfig(process.cwd());

// Structural stand-ins: playwright-core is installed on demand, not a dependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Context = any;

const baseUrl = (process.env.STAFF_PHONE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outDir = process.env.STAFF_PHONE_OUT_DIR ?? mkdtempSync(path.join(tmpdir(), "staff-phone-tasks-"));
const widths = (process.env.STAFF_PHONE_WIDTHS ?? "390,820").split(",").map((value) => Number(value.trim())).filter(Boolean);
const only = process.env.STAFF_PHONE_ONLY;
const eventId = "evt_wr26";
const kitchenEmail = "phonetask.kitchen@imsda-events.test";
const phoneBarMaxWidth = 800;

type StaffAccount = "system" | "checkin" | "kitchen";
const emails: Record<StaffAccount, string> = { system: "system@imsda-events.test", checkin: "checkin@imsda-events.test", kitchen: kitchenEmail };

const failures: string[] = [];
let passes = 0;
let currentLabel = "";
function check(ok: boolean, message: string) {
  if (ok) {
    passes += 1;
    console.log(`  ok   ${message}`);
  } else {
    failures.push(`${currentLabel}: ${message}`);
    console.error(`  FAIL ${message}`);
  }
}

/** Dynamic import by variable name so tsc and eslint do not need the package; `require` is the fallback because it honors NODE_PATH. */
async function loadOptional(name: string) {
  try {
    return await import(/* webpackIgnore: true */ name);
  } catch {
    try {
      return createRequire(path.join(process.cwd(), "package.json"))(name);
    } catch {
      console.error(`Missing ${name}. Run: npm i --no-save playwright-core@1.56.1`);
      process.exit(1);
    }
  }
}

const eventQuery = `?event=${eventId}`;
const isPhone = (width: number) => width <= phoneBarMaxWidth;

/** Seeds the one synthetic account this check needs: kitchen-only staff on the seeded event, with the credential row a session needs. Idempotent. */
async function seedKitchenStaff(prisma: PrismaClient) {
  const user = await prisma.user.upsert({
    where: { email: kitchenEmail },
    update: {},
    create: { id: "phonetask_user_kitchen", email: kitchenEmail, displayName: "Kim Phonetask-Kitchen" },
  });
  await prisma.eventMembership.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    update: { role: "KITCHEN_STAFF", status: "ACTIVE", permissions: [] },
    create: { eventId, userId: user.id, role: "KITCHEN_STAFF", status: "ACTIVE" },
  });
  await prisma.authCredential.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, passwordHash: "phonetask-never-a-real-hash" } });
}

const mintedTokens: string[] = [];
async function sessionCookie(prisma: PrismaClient, account: StaffAccount) {
  const { createDatabaseSession } = await import("../modules/access/session-store");
  const { staffSessionCookie } = await import("../modules/security/session-cookies");
  const user = await prisma.user.findUnique({ where: { email: emails[account] } });
  if (!user) throw new Error(`The seeded account ${emails[account]} is missing. Run \`npm run db:seed\` first.`);
  const session = await createDatabaseSession(user.id, null);
  mintedTokens.push(session.token);
  return { name: staffSessionCookie.legacyName, value: session.token, url: baseUrl, httpOnly: true, expires: Math.floor(session.expiresAt.getTime() / 1000) };
}

async function openPage(context: Context, width: number, height = 844) {
  const page: Page = await context.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

async function go(page: Page, target: string) {
  await page.goto(`${baseUrl}${target}`, { waitUntil: "load" });
  // The shell shows a loading fallback until it has hydrated; wait it out.
  await page.locator("main.workspace").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(250);
}

const pathOf = (page: Page) => new URL(page.url()).pathname;

/** Every link the shell draws for navigation: rail, tab row, bottom bar (the More sheet and menu dialog are read when open). */
async function shellLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const regions = ["#primary-navigation", "[data-staff-tabs]", "[data-staff-views]", "nav.mobile-nav"];
    const found = new Set<string>();
    for (const selector of regions) {
      for (const region of Array.from(document.querySelectorAll(selector))) {
        for (const link of Array.from(region.querySelectorAll("a[href]"))) found.add(new URL((link as HTMLAnchorElement).href).pathname);
      }
    }
    return [...found];
  });
}

async function sheetLinks(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((root: string) => Array.from(document.querySelectorAll(`${root} a[href]`)).map((link) => new URL((link as HTMLAnchorElement).href).pathname), selector);
}

async function openAccountMenu(page: Page) {
  await page.locator('button[aria-label="Staff account"]').click();
  await page.locator('#staff-account-menu[role="dialog"]').waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(100);
}

/** Opens the More sheet on a phone. */
async function openMoreSheet(page: Page) {
  await page.locator('nav.mobile-nav a[aria-haspopup="dialog"]').click();
  await page.locator('.more-launcher-tab[role="dialog"]').waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(150);
}

/** An element that must be entirely on screen (Close is never pushed off the viewport). Takes a Playwright selector. */
async function insideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox({ timeout: 3000 }).catch(() => null);
  if (!box) return "missing";
  const size = page.viewportSize() as { width: number; height: number };
  const ok = box.y >= -0.5 && box.x >= -0.5 && box.y + box.height <= size.height + 0.5 && box.x + box.width <= size.width + 0.5 && box.width > 0 && box.height > 0;
  return ok ? "ok" : `outside the viewport (${Math.round(box.y)}..${Math.round(box.y + box.height)} of ${size.height}, ${Math.round(box.x)}..${Math.round(box.x + box.width)} of ${size.width})`;
}

async function noSideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/* ------------------------------------------------------------------ tasks */

type Task = { name: string; account: StaffAccount; run: (page: Page, width: number) => Promise<void> };

const tasks: Task[] = [
  {
    name: "switch workspace through the account menu",
    account: "system",
    async run(page, width) {
      await go(page, `/overview${eventQuery}`);
      await openAccountMenu(page);
      const label = await page.locator("#staff-account-menu").getAttribute("aria-labelledby");
      check(Boolean(label) && (await page.locator(`#${label}`).innerText()).trim() === "Your account", "the account menu has a visible title");
      check((await insideViewport(page, "#staff-account-menu [data-account-close]")) === "ok", "Close is in view");
      const focused = await page.evaluate(() => document.activeElement?.closest("#staff-account-menu") !== null);
      check(focused, "focus moved into the account menu");
      // Tab many times: focus never leaves the dialog.
      let stayed = true;
      for (let step = 0; step < 14; step += 1) {
        await page.keyboard.press("Tab");
        if (!(await page.evaluate(() => document.activeElement?.closest("#staff-account-menu") !== null))) stayed = false;
      }
      check(stayed, "Tab keeps focus inside the account menu");
      await page.keyboard.press("Escape");
      await page.locator("#staff-account-menu").waitFor({ state: "detached", timeout: 3000 }).catch(() => undefined);
      check((await page.locator("#staff-account-menu").count()) === 0, "Escape closes the account menu");
      check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Staff account"), "Escape returns focus to the account button");
      await openAccountMenu(page);
      await page.locator("#staff-account-menu [data-account-close]").click();
      check((await page.locator("#staff-account-menu").count()) === 0, "Close closes the account menu");
      await openAccountMenu(page);
      const options: string[] = await page.locator('#staff-account-menu [aria-label="Switch workspace"] a').allInnerTexts();
      check(options.some((text) => /System management/.test(text)) && options.some((text) => /Staff workspace/.test(text)), `the switcher lists the held workspaces (${options.map((text) => text.trim()).join(", ")})`);
      await page.locator('#staff-account-menu a:has-text("System management")').click();
      await page.waitForURL(/\/admin(\?|$)/, { timeout: 15000 });
      await page.locator("main.workspace").first().waitFor({ state: "visible" });
      check(pathOf(page) === "/admin", "System management opens the Admin area");
      check(!(await page.locator("#event-picker").count()), "the Admin area shows no event picker");
      check(await noSideways(page), `no sideways scroll at ${width}px`);
      await openAccountMenu(page);
      await page.locator('#staff-account-menu a:has-text("Staff workspace")').click();
      await page.waitForURL(/\/(overview|events-admin|check-in|more)/, { timeout: 15000 });
      check(pathOf(page) !== "/admin", "Staff workspace leaves the Admin area");
    },
  },
  {
    name: "find the registration form and open it",
    account: "system",
    async run(page, width) {
      await go(page, `/overview${eventQuery}`);
      if (isPhone(width)) {
        await openMoreSheet(page);
        check((await insideViewport(page, ".more-launcher-tab .more-launcher-close")) === "ok", "More: Close is in view");
        check((await page.locator(".more-launcher-tab h2").first().innerText()).trim() === "More", "More: has a visible title");
        await page.locator(".more-launcher-tab input.destination-search-input").fill("registration forms");
      } else {
        await page.locator("input.destination-search-input").first().fill("registration forms");
      }
      const hit = page.locator('[aria-label="Matching pages"] [role="option"]:has-text("Registration forms")').first();
      await hit.waitFor({ state: "visible", timeout: 8000 });
      await hit.click();
      await page.waitForURL(/\/registration-builder/, { timeout: 15000 });
      check(pathOf(page) === "/registration-builder", "the search found and opened the registration form");
      check(await page.locator("main.workspace").first().isVisible(), "the form page rendered inside the shell");
    },
  },
  {
    name: "enter an edit page and leave it with the unsaved-changes guard",
    account: "system",
    async run(page, width) {
      await go(page, `/more/event-settings${eventQuery}`);
      const field = page.locator('main.workspace :is(input:not([type]), input[type="text"], textarea):visible').first();
      await field.waitFor({ state: "visible", timeout: 10000 });
      const before = await field.inputValue();
      await field.click();
      await field.press("End");
      await page.keyboard.type(" x");
      if (isPhone(width)) {
        check(await page.evaluate(() => document.documentElement.getAttribute("data-keyboard") === "open"), "a focused field marks the keyboard open");
        check(await page.evaluate(() => document.querySelector("nav.mobile-nav")!.getBoundingClientRect().top >= window.innerHeight), "the bottom bar steps aside while typing");
        // A tap on the page body (outside any field) hands the bottom back.
        await page.locator("main.workspace h1").first().click();
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(150);
        check(await page.evaluate(() => document.querySelector("nav.mobile-nav")!.getBoundingClientRect().top < window.innerHeight), "the bottom bar returns when the field loses focus");
      }
      const target = isPhone(width) ? page.locator('nav.mobile-nav a:has-text("Events")') : page.locator('#primary-navigation a:has-text("Events")');
      await target.first().click();
      const dialog = page.locator('[role="dialog"]:has-text("Leave without saving?")');
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      check(true, "leaving a dirty form asks first");
      check((await insideViewport(page, '[role="dialog"]:has-text("Leave without saving?")')) === "ok", "the guard fits the screen");
      await page.locator('button:has-text("Keep editing")').click();
      await page.waitForTimeout(200);
      check(pathOf(page) === "/more/event-settings", "Keep editing stays on the page");
      check((await field.inputValue()) === `${before} x`, "the edit is still there");
      await target.first().click();
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      await page.locator('button:has-text("Leave without saving")').click();
      await page.waitForURL((url: URL) => url.pathname !== "/more/event-settings", { timeout: 15000 });
      check(pathOf(page) !== "/more/event-settings", "Leave without saving navigates away");
    },
  },
  {
    name: "open a record and return to the list with its search kept",
    account: "system",
    async run(page, width) {
      await go(page, "/admin/people?q=Charlie");
      const record = page.locator('main.workspace a[href^="/admin/people/"]').first();
      await record.waitFor({ state: "visible", timeout: 10000 });
      await record.click();
      await page.waitForURL(/\/admin\/people\/[^/]+\/[^/?]+/, { timeout: 15000 });
      await page.locator("main.workspace").first().waitFor({ state: "visible" });
      check(/\/admin\/people\/[^/]+\/[^/]+/.test(pathOf(page)), "a person's record opened");
      const place = await page.evaluate(() => ({
        rail: document.querySelectorAll('#primary-navigation [aria-current="true"]').length,
        tab: Boolean(document.querySelector('[data-staff-tabs] [aria-current]')),
        bar: Array.from(document.querySelectorAll("nav.mobile-nav a.active")).map((link) => link.textContent?.trim()),
      }));
      check(isPhone(width) ? place.bar.length === 1 && /More/.test(place.bar[0] ?? "") : place.rail === 1, "the parent area is lit (People, so More on the phone bar)");
      check(place.tab, "the parent tab (People and access) is marked");
      const back = page.locator('main.workspace a:has-text("Back to People")').first();
      await back.waitFor({ state: "visible", timeout: 5000 });
      await back.click();
      await page.waitForURL(/\/admin\/people(\?|$)/, { timeout: 15000 });
      check(new URL(page.url()).searchParams.get("q") === "Charlie", "the list came back with its search (?q=Charlie)");
      check(await noSideways(page), `no sideways scroll at ${width}px`);
    },
  },
  {
    name: "check an attendee in",
    account: "system",
    async run(page) {
      await go(page, `/check-in${eventQuery}`);
      const button = page.locator('main.workspace button:has-text("Check in"):not([disabled])').first();
      await button.waitFor({ state: "visible", timeout: 15000 });
      await button.evaluate((element: HTMLElement) => element.setAttribute("data-phonetask", "target"));
      await button.scrollIntoViewIfNeeded();
      const target = page.locator('[data-phonetask="target"]');
      // Scrolled into view, the button is the topmost thing at its centre: the bottom bar does not sit over it.
      const uncovered = await target.evaluate((element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === element || element.contains(hit);
      });
      check(uncovered, "the Check in button is not under the bottom bar once scrolled into view");
      await target.click();
      await page.locator('[data-phonetask="target"]:has-text("Undo")').waitFor({ state: "visible", timeout: 15000 });
      check(true, "the attendee shows as checked in");
      await target.click();
      await page.locator('[data-phonetask="target"]:has-text("Check in")').waitFor({ state: "visible", timeout: 15000 });
      check(true, "the check-in was undone, so the run can be repeated");
    },
  },
  {
    name: "reach a secondary authorized tool through More",
    account: "system",
    async run(page, width) {
      await go(page, `/overview${eventQuery}`);
      if (isPhone(width)) {
        await openMoreSheet(page);
        const sections = await page.locator(".more-launcher-tab .more-launcher-group-label").allInnerTexts();
        check(/This event/i.test(sections[0] ?? ""), `More lists "This event" first (${sections.join(", ")})`);
        const card = page.locator('.more-launcher-tab a[href^="/more/promo-codes"], .more-launcher-tab a[href^="/more/kitchen-report"]').first();
        await card.scrollIntoViewIfNeeded();
        check((await insideViewport(page, ".more-launcher-tab .more-launcher-close")) === "ok", "Close stays in view after scrolling the sheet");
        const href = await card.getAttribute("href");
        await card.click();
        await page.waitForURL((url: URL) => url.pathname === new URL(href!, baseUrl).pathname, { timeout: 15000 });
        check((await page.locator(".more-launcher-tab").count()) === 0, "following a link closes the sheet");
        check(pathOf(page).startsWith("/more/"), `the tool opened (${pathOf(page)})`);
      } else {
        // An iPad has no bottom bar: the menu line's "Event menu" opens the same pages.
        await page.locator('[data-staff-menu-line] button:has-text("Event menu")').click();
        await page.locator("[data-staff-menu]").waitFor({ state: "visible", timeout: 5000 });
        check((await insideViewport(page, "[data-staff-menu] button:has-text('Close')")) === "ok", "Event menu: Close is in view");
        await page.locator("[data-staff-menu] a:has-text('Event setup')").first().click();
        await page.waitForURL(/\/more(\?|$)/, { timeout: 15000 });
        check(pathOf(page) === "/more", "Event setup opened");
        const tool = page.locator('main.workspace a[href^="/more/emergency-plan"], main.workspace a[href^="/more/promo-codes"], main.workspace a[href^="/more/kitchen-report"], main.workspace a[href^="/more/meals"]').first();
        await tool.waitFor({ state: "visible", timeout: 15000 });
        await tool.click();
        await page.waitForURL(/\/more\/[a-z-]+/, { timeout: 15000 });
        check(pathOf(page).startsWith("/more/"), `the tool opened (${pathOf(page)})`);
      }
      check(await noSideways(page), `no sideways scroll at ${width}px`);
    },
  },
  {
    name: "sheets fit a short screen with Close in view",
    account: "system",
    async run(page, width) {
      // A landscape phone is the shortest case: 844 x 390 at 390 wide's long edge; on the iPad width, a short window.
      await page.setViewportSize({ width: isPhone(width) ? 844 : width, height: 390 });
      await go(page, `/overview${eventQuery}`);
      await openAccountMenu(page);
      check((await insideViewport(page, "#staff-account-menu")) === "ok", "the account menu fits a 390px-tall screen");
      check((await insideViewport(page, "#staff-account-menu [data-account-close]")) === "ok", "its Close is in view");
      await page.keyboard.press("Escape");
      const menuButton = page.locator('[data-staff-menu-line] button:visible').first();
      if (await menuButton.count()) {
        await menuButton.click();
        await page.locator("[data-staff-menu]").waitFor({ state: "visible", timeout: 5000 });
        check((await insideViewport(page, "[data-staff-menu]")) === "ok", "the menu dialog fits a 390px-tall screen");
        check((await insideViewport(page, "[data-staff-menu] button:has-text('Close')")) === "ok", "its Close is in view");
        await page.keyboard.press("Escape");
        check(await page.evaluate(() => document.activeElement?.textContent?.includes("menu") === true), "Escape returns focus to the menu button");
      }
      if (await page.locator('nav.mobile-nav a[aria-haspopup="dialog"]:visible').count()) {
        await openMoreSheet(page);
        check((await insideViewport(page, ".more-launcher-tab")) === "ok", "the More sheet fits a 390px-tall screen");
        check((await insideViewport(page, ".more-launcher-tab .more-launcher-close")) === "ok", "its Close is in view");
        await page.keyboard.press("Escape");
        check(await page.evaluate(() => document.activeElement?.closest("nav.mobile-nav") !== null), "Escape returns focus to More");
      }
      check(await noSideways(page), "no sideways scroll on a short screen");
    },
  },
  {
    name: "shell fits split view, landscape and zoomed widths",
    account: "system",
    async run(page, width) {
      // Only once: the conditions carry their own sizes, so the second width of a run skips it.
      if (width !== widths[0]) return;
      const conditions: Array<{ name: string; width: number; height: number; scale?: number }> = [
        { name: "iPad split view, one third (507)", width: 507, height: 1024 },
        { name: "iPad split view, two thirds (678)", width: 678, height: 1024 },
        { name: "iPad split view, wide (981)", width: 981, height: 768 },
        { name: "landscape phone (844x390)", width: 844, height: 390 },
        { name: "200% zoom on a 1280px screen (640)", width: 640, height: 450, scale: 2 },
        { name: "200% zoom on a 1024px screen (512)", width: 512, height: 384, scale: 2 },
        { name: "desktop (1280)", width: 1280, height: 800 },
      ];
      for (const condition of conditions) {
        await page.setViewportSize({ width: condition.width, height: condition.height });
        for (const target of [`/finance${eventQuery}`, `/more/event-settings${eventQuery}`, "/admin/clubs"]) {
          await go(page, target);
          const label = `${condition.name} ${target.split("?")[0]}`;
          check(await noSideways(page), `${label}: no sideways scroll`);
          const state = await page.evaluate(() => {
            // No named inner functions in here: the script's transpiler would add a helper the page does not have.
            const [barShown, menuLineShown] = ["nav.mobile-nav", "[data-staff-menu-line]"].map((query) => {
              const element = document.querySelector(query);
              return Boolean(element) && getComputedStyle(element as Element).display !== "none" && (element as HTMLElement).getBoundingClientRect().height > 0;
            });
            const tabs = document.querySelector("[data-staff-tabs] ul");
            const row = document.querySelector("[data-staff-tabs]") as HTMLElement | null;
            const rail = document.querySelector("#primary-navigation ul") as HTMLElement | null;
            return {
              bar: barShown,
              menuLine: menuLineShown,
              tabsShown: Boolean(tabs) && getComputedStyle(tabs!.parentElement as Element).visibility !== "hidden" && getComputedStyle(tabs!.parentElement as Element).display !== "none" && (tabs!.parentElement as HTMLElement).getBoundingClientRect().height > 0,
              tight: row?.getAttribute("data-fit") ?? "",
              // The hidden row stays in the page and measurable, so its natural width can be compared with the room at any time.
              tabsWidth: tabs ? Math.round(tabs.getBoundingClientRect().width) : 0,
              room: row ? row.clientWidth : 0,
              railReachable: !rail || rail.scrollHeight <= rail.clientHeight + 1 || getComputedStyle(rail).overflowY === "auto",
            };
          });
          check(state.bar === condition.width <= phoneBarMaxWidth, `${label}: the bottom bar is ${state.bar ? "shown" : "hidden"} (shown at 800px and under only)`);
          check(state.menuLine !== state.tabsShown, `${label}: exactly one of the menu line and the tab row is shown`);
          // L11 (#1734): the row is the menu line only when its tabs would not fit, at any width, never because the screen is narrow.
          const fits = state.tabsWidth <= state.room + 0.5;
          check(state.menuLine === !fits, `${label}: the row is the ${state.menuLine ? "menu line" : "tab row"} and its tabs (${state.tabsWidth}px) ${fits ? "fit" : "do not fit"} the ${state.room}px line`);
          check(state.railReachable, `${label}: every rail area can be reached`);
          // At the bottom of the page the last content is clear of the fixed bottom bar.
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(150);
          const clear = await page.evaluate(() => {
            const bar = document.querySelector("nav.mobile-nav");
            if (!bar || getComputedStyle(bar).display === "none") return true;
            const barTop = bar.getBoundingClientRect().top;
            const main = document.querySelector("main.workspace") as HTMLElement;
            return main.getBoundingClientRect().bottom <= barTop + 1;
          });
          check(clear, `${label}: the last content is clear of the bottom bar`);
        }
      }
      // The event settings save bar (pinned once something is edited) is never left under the bottom bar: at the end of the page
      // it ends above it, and while a field has focus the bottom bar is gone, so the field and the save bar are both clear.
      await page.setViewportSize({ width: 390, height: 700 });
      await go(page, `/more/event-settings${eventQuery}`);
      const field = page.locator('main.workspace :is(input:not([type]), input[type="text"], textarea):visible').first();
      await field.click();
      await field.press("End");
      await page.keyboard.type("x");
      const typing = await page.evaluate(() => {
        const save = document.querySelector(".event-savebar");
        return { keyboard: document.documentElement.getAttribute("data-keyboard"), barHidden: (document.querySelector("nav.mobile-nav") as Element).getBoundingClientRect().top >= window.innerHeight, savePosition: save ? getComputedStyle(save).position : "none" };
      });
      check(typing.keyboard === "open" && typing.barHidden, "while typing, the bottom bar is out of the way");
      check(typing.savePosition !== "fixed", "the save bar is never fixed over a focused field");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      const end = await page.evaluate(() => {
        const save = document.querySelector(".event-savebar");
        const bar = document.querySelector("nav.mobile-nav");
        if (!save || !bar) return "no save bar or no bottom bar";
        const a = save.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        return a.bottom <= b.top + 1 ? "ok" : `the save bar (${Math.round(a.top)}..${Math.round(a.bottom)}) ends under the bottom bar (${Math.round(b.top)}..${Math.round(b.bottom)})`;
      });
      check(end === "ok", `at the end of the page the save bar ends above the bottom bar (${end})`);
      await page.goto("about:blank");
    },
  },
  {
    name: "check-in staff see only their subset",
    account: "checkin",
    async run(page, width) {
      await go(page, `/check-in${eventQuery}`);
      const links = await shellLinks(page);
      const allowed = (href: string) => ["/check-in", "/overview", "/more", "/help", "/home", "/profile", "/people", "/archived-events"].some((prefix) => href === prefix || href.startsWith(`${prefix}/`));
      const outside = links.filter((href) => !allowed(href));
      check(outside.length === 0, `every shell link is one check-in staff may open (${outside.join(", ") || "none outside"})`);
      for (const forbidden of ["/finance", "/communications", "/registration-builder", "/admin", "/imports"]) {
        check(!links.some((href) => href === forbidden || href.startsWith(`${forbidden}/`)), `no ${forbidden} link in the shell`);
      }
      check(links.some((href) => href.startsWith("/check-in")), "Check-in is there");
      if (isPhone(width)) {
        const bar: string[] = await page.locator("nav.mobile-nav a").allInnerTexts();
        check(!bar.some((text) => /Clubs/.test(text)), `the bottom bar has no Clubs (${bar.map((text) => text.trim()).join(", ")})`);
        await openMoreSheet(page);
        const sheet = await sheetLinks(page, ".more-launcher-tab");
        check(sheet.every((href) => allowed(href) || href.startsWith("/more/")), "the More sheet lists nothing beyond their tools");
        check(!sheet.some((href) => href.startsWith("/finance") || href.startsWith("/communications") || href.startsWith("/admin")), "the More sheet has no money, communications or admin links");
        await page.keyboard.press("Escape");
      }
      await go(page, `/finance${eventQuery}`);
      const body = (await page.locator("main.workspace").first().innerText()).toLowerCase();
      check(/restricted|not have access|do not have|permission|ask/.test(body), "a page outside their role says so");
    },
  },
  {
    name: "kitchen-only staff see only their subset",
    account: "kitchen",
    async run(page, width) {
      await go(page, `/more/kitchen-report/counts${eventQuery}`);
      const links = await shellLinks(page);
      const kitchenOnly = links.filter((href) => !href.startsWith("/more/kitchen-report") && !href.startsWith("/help") && !href.startsWith("/home") && !href.startsWith("/profile") && !href.startsWith("/archived-events"));
      check(kitchenOnly.length === 0, `every shell link is the kitchen counts, Home, Help or the profile (${kitchenOnly.join(", ") || "none outside"})`);
      check(links.some((href) => href.startsWith("/more/kitchen-report/counts")), "Kitchen counts is there");
      if (isPhone(width)) {
        const bar: string[] = await page.locator("nav.mobile-nav a").allInnerTexts();
        // Home (#1568) is its own page; Events opens the kitchen counts, the only event page they have.
        check(!bar.some((text) => /Clubs|Check-in/.test(text)), `the bottom bar has no Clubs or Check-in (${bar.map((text) => text.trim()).join(", ")})`);
      }
      await go(page, `/people${eventQuery}`);
      const body = (await page.locator("main.workspace").first().innerText()).toLowerCase();
      check(/restricted|not have access|do not have|permission|ask/.test(body), "a page outside their role says so");
      check(await noSideways(page), `no sideways scroll at ${width}px`);
    },
  },
];

async function main() {
  // Hard guard first: nothing below loads Prisma or the session store until it has passed.
  assertLocalDatabase(process.env, "write one synthetic kitchen-staff account and mint sessions");
  assertLocalUrl(baseUrl, "STAFF_PHONE_BASE_URL");
  for (const email of Object.values(emails)) assertSeededStaffEmail(email);

  const { PrismaClient: Prisma } = await import("@prisma/client");
  const { chromium } = await loadOptional("playwright-core");
  mkdirSync(outDir, { recursive: true });
  const prisma: PrismaClient = new Prisma();
  const browser = await chromium.launch({ executablePath: process.env.STAFF_PHONE_BROWSER || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    await seedKitchenStaff(prisma);
    for (const width of widths) {
      for (const account of ["system", "checkin", "kitchen"] as StaffAccount[]) {
        const context: Context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width <= phoneBarMaxWidth, isMobile: width <= phoneBarMaxWidth });
        await context.addCookies([await sessionCookie(prisma, account)]);
        for (const task of tasks.filter((candidate) => candidate.account === account && (!only || candidate.name.includes(only)))) {
          currentLabel = `${width}px ${task.name}`;
          console.log(`\n${currentLabel}`);
          const page = await openPage(context, width);
          try {
            await task.run(page, width);
          } catch (error) {
            const message = (error as Error).message.split("\n")[0] ?? "failed";
            failures.push(`${currentLabel}: ${message}`);
            console.error(`  FAIL ${message}`);
            await page.screenshot({ path: path.join(outDir, `${width}-${task.name.replace(/\W+/g, "-")}.png`) }).catch(() => undefined);
          }
          await page.close();
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    const { revokeDatabaseSession } = await import("../modules/access/session-store");
    for (const token of mintedTokens) await revokeDatabaseSession(token).catch(() => undefined);
    await prisma.$disconnect();
  }
  console.log(`\n${passes} checks passed, ${failures.length} failed. Screenshots of failing steps: ${outDir}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
