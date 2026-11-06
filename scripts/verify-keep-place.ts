/**
 * Site rule B17 (#1557): "Changing a filter, tab, sort or month keeps you where you are, and nothing on the page jumps
 * while it loads." This is its real-browser check, in Chromium at 1280 and 390 px wide.
 *
 *  1. LOAD SHIFT. Each page below is opened cold three times and its layout shift is added up with a buffered `layout-shift`
 *     observer (shifts right after the person's own input are left out, as the browser's CLS does). The middle of the three totals must be
 *     at most 0.05.
 *  2. KEEP YOUR PLACE. On a page that scrolls, the check scrolls about 600 px down and then changes a filter, a year, a
 *     sort, a tab and a month, one control at a time, the way a person would from the place they are reading (the
 *     control is clicked in the page, not scrolled into view first, so a control above the fold is still a fair test). The page must not
 *     reload (a marker set on `window` survives only a soft navigation) and must not jump to the top (the scroll
 *     position stays where it was, or as close as a shorter page allows).
 *
 * Uses the existing journey helpers (scripts/support/browser-journeys.ts, journey-data.ts): its own synthetic club
 * director, coordinator and clubs, sessions minted for the seeded system administrator, a director and the coordinator,
 * and it removes what it made. LOCAL USE ONLY: it refuses a production NODE_ENV or a database or URL that is not on this
 * machine. Pass page scripts as strings (tsx wraps named functions in `__name`, which the page does not have).
 *
 *   npm i --no-save playwright@1.63.0 && npx playwright install chromium
 *   npm run build && npm run start   # the fictitious CI secrets from .github/workflows/browser-translation.yml
 *   npm run test:keep-place
 *
 * Environment: JOURNEY_BASE_URL (default http://localhost:3000), KEEP_PLACE_CLS_MAX (default 0.05),
 * KEEP_PLACE_ONLY (a comma list of widths, 1280 or 390).
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import * as J from "./support/browser-journeys";
import { cleanupJourneyWorld, seedCoordinatorWorld, seedJourneyWorld, type JourneyWorld } from "./support/journey-data";

loadEnvConfig(process.cwd());

const CLS_MAX = Number(process.env.KEEP_PLACE_CLS_MAX ?? "0.05");
const WIDTHS = (process.env.KEEP_PLACE_ONLY ?? "1280,390").split(",").map((value) => Number(value.trim())).filter(Boolean);
/** How far the page may sit above where it was after a change (a list can get shorter, a header a little taller). */
const PLACE_TOLERANCE = 150;
const SCROLL_TO = 600;
const SYSTEM_ADMIN = "system@imsda-events.test";

type Role = "director" | "staff" | "coordinator";
type Contexts = Record<Role, J.BrowserContext>;
const problems: string[] = [];
const lines: string[] = [];

const CLS_SCRIPT = `
window.__cls = 0; window.__clsParts = [];
try {
  new PerformanceObserver(function (list) {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__cls += entry.value;
      window.__clsParts.push({ value: Math.round(entry.value * 1000) / 1000, nodes: (entry.sources || []).map(function (source) { return source.node ? source.node.nodeName.toLowerCase() + (source.node.className && typeof source.node.className === 'string' ? '.' + source.node.className.split(' ')[0] : '') : '?'; }).slice(0, 3) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch (error) {}
`;

function fail(message: string) {
  console.error(`  FAIL ${message}`);
  problems.push(message);
}

/* ---------------------------------------------------------------- 1. load shift */

const SHIFT_PAGES: Array<{ role: Role; path: (world: JourneyWorld) => string }> = [
  { role: "director", path: () => "/account" },
  { role: "director", path: () => "/account/registrations" },
  { role: "staff", path: () => "/admin/clubs/reports" },
  { role: "staff", path: () => "/admin/clubs/leaders" },
  { role: "coordinator", path: () => "/account/area-clubs/reports" },
  { role: "staff", path: () => "/admin/people" },
];

async function settleLoad(page: J.Page) {
  await page.waitForLoadState("load");
  // Streamed tables arrive after the page is interactive; give them time to land before reading the total.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
}

/** Cold loads of one page, so one slow font or network moment does not decide the result: the middle value is used. */
const LOADS = 3;

async function loadShift(world: JourneyWorld, contexts: Contexts, width: number) {
  for (const item of SHIFT_PAGES) {
    const path = item.path(world);
    const runs: Array<{ cls: number; parts: Array<{ value: number; nodes: string[] }> }> = [];
    try {
      for (let load = 0; load < LOADS; load += 1) {
        const page = await contexts[item.role].newPage();
        try {
          await page.goto(`${J.baseUrl}${path}`, { waitUntil: "load" });
          await settleLoad(page);
          const landed = new URL(page.url()).pathname;
          if (landed !== path.split("?")[0]) throw new Error(`opened ${landed} instead (no access?)`);
          runs.push(JSON.parse(await page.evaluate("JSON.stringify({ cls: window.__cls, parts: window.__clsParts })")));
        } finally {
          await page.close();
        }
      }
      runs.sort((a, b) => a.cls - b.cls);
      const middle = runs[Math.floor(runs.length / 2)]!;
      const ok = middle.cls <= CLS_MAX;
      lines.push(`  ${ok ? "ok  " : "FAIL"} ${width}px load shift ${middle.cls.toFixed(3)} (max ${CLS_MAX}; ${LOADS} loads: ${runs.map((run) => run.cls.toFixed(3)).join(", ")})  ${path}`);
      if (!ok) fail(`${width}px: ${path}: load layout shift ${middle.cls.toFixed(3)} is over ${CLS_MAX}; biggest shifts: ${JSON.stringify([...middle.parts].sort((a, b) => b.value - a.value).slice(0, 3))}`);
    } catch (error) {
      fail(`${width}px: ${path}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
}

/* ---------------------------------------------------------------- 2. keep your place */

type Change = {
  name: string;
  kind: "filter" | "year" | "sort" | "tab" | "month";
  role: Role;
  path: (world: JourneyWorld) => string;
  /** The id of a section the link goes to on the same page; the change then lands on it. */
  anchor?: string;
  /** A script for the page: makes the change and returns what the new address must be: "param:name=value" (in the query) or "href:/path?query". Runs without scrolling anything into view. */
  act: string;
};

/** Picks a different option of a select, then submits its form with `requestSubmit`, like pressing Apply. */
const selectAndSubmit = (selector: string, submit: boolean) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const other = [...el.options].find((option) => option.value && option.value !== el.value && !option.value.startsWith('__'));
  if (!other) return null;
  el.value = other.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  ${submit ? "if (el.form) el.form.requestSubmit();" : ""}
  return 'param:' + el.name + '=' + other.value;
})()`;

const clickLink = (selector: string, text?: RegExp) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((link) => link.getAttribute('href') !== (location.pathname + location.search) && ${text ? `${text}.test((link.textContent || '').trim())` : "true"});
  if (!el) return null;
  const href = (el.getAttribute('href') || '').split('#')[0];
  el.click();
  return 'href:' + href;
})()`;

const CHANGES: Change[] = [
  { name: "people: Role select", kind: "filter", role: "staff", path: () => "/admin/people", act: selectAndSubmit('form[role="search"] select[name="role"]', false) },
  {
    name: "people: Filters panel, Apply", kind: "filter", role: "staff", path: () => "/admin/people",
    act: `(() => {
      const form = [...document.querySelectorAll('form[action="/admin/people"]')].find((f) => !f.matches('[role="search"]'));
      const box = form && form.querySelector('input[type="checkbox"][name="role"]');
      if (!box) return null;
      box.click();
      form.requestSubmit();
      return 'param:role=' + box.value;
    })()`,
  },
  { name: "clubs: club year", kind: "year", role: "staff", path: () => "/admin/clubs", act: selectAndSubmit('form[action="/admin/clubs"] select[name="year"]', true) },
  { name: "club leaders: role", kind: "filter", role: "staff", path: () => "/admin/clubs/leaders", act: selectAndSubmit('form[action="/admin/clubs/leaders"] select[name="role"]', true) },
  { name: "club summary: sort", kind: "sort", role: "staff", path: () => "/admin/clubs/summary?view=records", act: clickLink('a.table-sort-button[href*="sort=record"]') },
  { name: "club summary: Points tab", kind: "tab", role: "staff", path: () => "/admin/clubs/summary?view=records", anchor: "points", act: clickLink('a[href*="view=points"]:not(.table-sort-button)') },
  { name: "club summary: month link", kind: "month", role: "staff", path: () => "/admin/clubs/summary?view=records", anchor: "monthly-records", act: clickLink('a[href*="view=records"][href*="month="]:not(.table-sort-button)') },
  { name: "club summary: month select (phone form)", kind: "month", role: "staff", path: () => "/admin/clubs/summary?view=records", act: selectAndSubmit('form[action="/admin/clubs/summary"] select[name="month"]', true) },
  { name: "coordinator overview: sort", kind: "sort", role: "coordinator", path: () => "/account/area-clubs/overview", act: clickLink('a.table-sort-button[href*="sort=roster"]') },
  { name: "coordinator records: Next month", kind: "month", role: "coordinator", path: () => "/account/area-clubs/reports", act: clickLink('a[href*="month="]', /^Next month/) },
  { name: "director records: Open a month", kind: "month", role: "director", path: (world) => `/account/clubs/${world.clubId}/records`, act: clickLink('a[href*="/records?month="]') },
];

async function keepPlace(world: JourneyWorld, contexts: Contexts, width: number) {
  for (const change of CHANGES) {
    const path = change.path(world);
    const label = `${width}px: ${change.name}`;
    const page = await contexts[change.role].newPage();
    try {
      await page.goto(`${J.baseUrl}${path}`, { waitUntil: "load" });
      await settleLoad(page);
      // A page is interactive once React has attached to it (a change before that would be a plain form submit).
      await page.waitForFunction("[...document.body.querySelectorAll('*')].slice(0, 400).some((node) => Object.keys(node).some((key) => key.startsWith('__reactFiber$')))", undefined, { timeout: 20_000 });
      // Scroll down. A spacer after the page's content gives room to stay at 600 px even when the new list is shorter
      // (a filter that narrows a list would otherwise pull the page up by itself, which is not a jump). It sits outside
      // the app and is not part of what is being measured; the check fails if the app removes it.
      const before = Number(await page.evaluate(`(() => {
        const spacer = document.createElement('div');
        spacer.id = 'keep-place-spacer';
        spacer.style.height = '1600px';
        document.body.appendChild(spacer);
        window.scrollTo(0, ${SCROLL_TO});
        window.__keepPlaceMarker = 1;
        return window.scrollY;
      })()`));
      if (before < 300) { fail(`${label}: the page would not scroll (${before}px), so the check could not run`); continue; }
      const wanted = await page.evaluate(change.act);
      if (!wanted) { fail(`${label}: the control was not found on ${path} (or has nothing different to pick)`); continue; }
      try {
        const target = String(wanted);
        const [kind, value] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
        await page.waitForURL((url: URL) => (kind === "href" ? url.pathname + url.search === value : url.searchParams.getAll(value.split("=")[0]!).includes(value.slice(value.indexOf("=") + 1))), { timeout: 15_000 });
      } catch {
        fail(`${label}: the address did not change to include "${wanted}" (now ${page.url()})`);
        continue;
      }
      // The new list is in once the busy sign is gone and the network is quiet.
      await page.waitForFunction("!document.querySelector('[aria-busy=\"true\"]')", undefined, { timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const anchorId = JSON.stringify(change.anchor ?? "");
      const after = JSON.parse(await page.evaluate(`(() => {
        const anchor = ${anchorId} ? document.getElementById(${anchorId}) : null;
        return JSON.stringify({ marker: window.__keepPlaceMarker || 0, y: Math.round(window.scrollY), spacer: Boolean(document.getElementById('keep-place-spacer')), anchor: anchor ? Math.round(anchor.getBoundingClientRect().top) : null });
      })()`)) as { marker: number; y: number; spacer: boolean; anchor: number | null };
      const reloaded = after.marker !== 1;
      // A link to a section of the same page (#id) lands on that section, which is where the person asked to go; every
      // other change must leave the page where it was.
      const stayed = change.anchor ? after.anchor !== null && after.anchor >= -10 && after.anchor <= 300 && after.y > 0 : after.y >= before - PLACE_TOLERANCE;
      const ok = !reloaded && stayed && after.spacer;
      lines.push(`  ${ok ? "ok  " : "FAIL"} ${width}px ${change.kind.padEnd(6)} ${change.name}: scrolled ${before}px, after ${after.y}px${change.anchor ? ` (section #${change.anchor} at ${after.anchor}px)` : ""}${reloaded ? ", FULL RELOAD" : ""}`);
      if (reloaded) fail(`${label}: the whole page reloaded instead of updating in place (${path})`);
      else if (!after.spacer) fail(`${label}: the check's spacer was removed, so the page was rebuilt (${path})`);
      else if (!stayed) fail(`${label}: the page jumped from ${before}px to ${after.y}px${change.anchor ? ` and #${change.anchor} is at ${after.anchor}px` : ""} (${path})`);
    } catch (error) {
      fail(`${label}: ${(error as Error).message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }
}

/* ---------------------------------------------------------------- run */

async function main() {
  J.guardLocal();
  const playwright = await J.loadPlaywright();
  const prisma = new PrismaClient();
  const tokens: string[] = [];
  let world: JourneyWorld | undefined;
  const browser = await J.launch(playwright, "chromium");
  try {
    world = await seedJourneyWorld(prisma, "keepplace");
    await seedCoordinatorWorld(prisma, world);
    const cookies = {
      director: await J.mintDirectorSession(tokens, world.main.accountId),
      staff: await J.mintStaffSession(tokens, SYSTEM_ADMIN),
      coordinator: await J.mintDirectorSession(tokens, world.coordinator!.accountId),
    };
    for (const width of WIDTHS) {
      console.log(`\n== ${width}px wide`);
      const opened: J.BrowserContext[] = [];
      const contexts = {} as Contexts;
      for (const role of Object.keys(cookies) as Role[]) {
        const context = await J.newContext(browser, { translate: false, cookie: cookies[role], width });
        context.setDefaultTimeout(20_000);
        await context.addInitScript(CLS_SCRIPT);
        opened.push(context);
        contexts[role] = context;
      }
      try {
        lines.length = 0;
        await loadShift(world, contexts, width);
        await keepPlace(world, contexts, width);
        for (const line of lines) console.log(line);
      } finally {
        for (const context of opened) await context.close();
      }
    }
  } finally {
    await J.revokeStaffSessions(tokens);
    await J.revokeSessions(tokens);
    if (world) await cleanupJourneyWorld(prisma, world);
    await browser.close();
    await prisma.$disconnect();
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.map((line) => `  - ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nKeep your place (B17): OK");
}

main().catch((error) => { console.error(error); process.exit(1); });
