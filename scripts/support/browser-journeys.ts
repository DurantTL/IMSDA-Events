/**
 * Shared pieces for the real-browser journey checks (#1445):
 * `scripts/verify-translation-simulation.ts` and `scripts/verify-live-roster.ts`.
 *
 * LOCAL USE ONLY. Both write synthetic rows (every id starts with
 * "transcheck") and mint sessions that skip the second factor, so they refuse
 * to run with NODE_ENV=production or against a database or URL that is not on
 * this machine, before anything is written.
 *
 * Playwright is deliberately not a dependency (it would bloat the production
 * image); install it first with
 *   npm i --no-save playwright@1.63.0 && npx playwright install chromium firefox webkit
 */
import { createRequire } from "node:module";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { assertLocalDatabase, assertLocalUrl } from "./local-only-guard";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Page = any;
export type BrowserContext = any;
export type Browser = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const P = "transcheck";
export const baseUrl = (process.env.JOURNEY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const clubId = `${P}_club`;
export const churchId = `${P}_church`;
export const directorAccountId = `${P}_account_director`;
export const eventId = `${P}_event`;
export const eventSlug = `${P}-retreat`;
export const formId = `${P}_form`;
export const formVersionId = `${P}_formver`;
export const formSlug = `${P}-registration`;
export const promoCode = "TRANSPROMO";
export const rosterNames = [
  ["Alma", "Transcheck-Alder"],
  ["Beto", "Transcheck-Bravo"],
  ["Cleo", "Transcheck-Cedar"],
  ["Dario", "Transcheck-Delta"],
  ["Elena", "Transcheck-Echo"],
  ["Fabio", "Transcheck-Fox"],
] as const;

export function guardLocal() {
  // Hard guard first: nothing below may load Prisma or the session store until this has passed.
  assertLocalDatabase(process.env, "write synthetic clubs and accounts and mint sessions");
  assertLocalUrl(baseUrl, "JOURNEY_BASE_URL");
}

/** Loads Playwright on demand (it is not a dependency). Resolved like `require`, so NODE_PATH and a global install work too. */
export async function loadPlaywright() {
  const resolve = createRequire(path.join(process.cwd(), "package.json"));
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return resolve(name);
    } catch {
      // try the next name
    }
  }
  console.error("Missing playwright. Run: npm i --no-save playwright@1.63.0 && npx playwright install --with-deps chromium firefox webkit");
  process.exit(1);
}

export function browserNames() {
  return (process.env.JOURNEY_BROWSERS ?? "chromium,firefox,webkit").split(",").map((name) => name.trim()).filter(Boolean);
}

/**
 * A Google-Translate-like page rewriter, injected before any page script runs.
 *
 * Like the real translator it replaces every text node that is not inside a
 * `translate="no"` subtree with `<font style="vertical-align: inherit"><font
 * style="vertical-align: inherit">translated text</font></font>`, so the
 * original text node React still holds is gone from the page. It keeps working
 * for text React adds or changes later. The "translation" is a visible marker
 * (`[es] `) in front of the original, so assertions can tell translated text
 * from text that must stay exact.
 */
export const TRANSLATION_MARKER = "[es] ";
export const translationSimulatorScript = `
(() => {
  const MARKER = ${JSON.stringify(TRANSLATION_MARKER)};
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "TITLE"]);
  const stats = { wrapped: 0, retranslated: 0 };
  window.__translationSim = stats;
  function insideFake(node) {
    for (let n = node.parentElement; n; n = n.parentElement) if (n.tagName === "FONT" && n.getAttribute("data-sim") === "1") return true;
    return false;
  }
  function protectedNode(node) {
    for (let n = node.parentElement; n; n = n.parentElement) {
      if (n.getAttribute && n.getAttribute("translate") === "no") return true;
      if (SKIP.has(n.tagName)) return true;
    }
    return false;
  }
  function hasTextSibling(node) {
    for (const sibling of node.parentNode.childNodes) {
      if (sibling !== node && sibling.nodeType === 3 && /[A-Za-z]{2,}/.test(sibling.nodeValue || "")) return true;
    }
    return false;
  }
  function translate(text) {
    // Numbers and punctuation stay as they are; words get the marker.
    if (!/[A-Za-z]{2,}/.test(text)) return text;
    const lead = text.match(/^\\s*/)[0];
    const trail = text.match(/\\s*$/)[0];
    return lead + MARKER + text.trim() + trail;
  }
  function wrap(textNode) {
    if (!textNode.parentNode) return;
    const value = textNode.nodeValue || "";
    // Like the real translator, a number that sits in a sentence ("6 active") is rewritten with its words.
    if (!/[A-Za-z]{2,}/.test(value) && !(/\\d/.test(value) && hasTextSibling(textNode))) return;
    if (insideFake(textNode) || protectedNode(textNode)) return;
    const outer = document.createElement("font");
    outer.setAttribute("style", "vertical-align: inherit;");
    outer.setAttribute("data-sim", "1");
    const inner = document.createElement("font");
    inner.setAttribute("style", "vertical-align: inherit;");
    inner.setAttribute("data-sim", "1");
    inner.appendChild(document.createTextNode(translate(value)));
    outer.appendChild(inner);
    // Native replaceChild, like the real translator: the original node is detached, React still holds it.
    textNode.parentNode.replaceChild(outer, textNode);
    stats.wrapped += 1;
  }
  function walk(root) {
    if (root.nodeType === 3) return wrap(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && (SKIP.has(root.tagName) || root.getAttribute("translate") === "no")) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    found.forEach(wrap);
  }
  function hydrated() {
    // React marks every DOM node it owns once it has hydrated it. Wait until almost all of the page's elements carry the mark.
    const nodes = document.body ? document.body.querySelectorAll("*:not(svg *):not(script):not(style):not(noscript):not(template)") : [];
    let marked = 0;
    for (const node of nodes) {
      if (Object.keys(node).some((key) => key.startsWith("__reactFiber$"))) marked += 1;
    }
    return nodes.length > 20 && marked / nodes.length >= 0.95;
  }
  function start() {
    walk(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") { wrap(record.target); stats.retranslated += 1; }
        record.addedNodes.forEach((node) => walk(node));
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  // A person turns translation on after the page has loaded and become interactive, so the rewriter does the same.
  function whenReady() {
    let waited = 0;
    let stable = 0;
    const timer = setInterval(() => {
      waited += 100;
      stable = document.readyState !== "loading" && hydrated() ? stable + 1 : 0;
      if (stable >= 3 || waited > 20000) {
        clearInterval(timer);
        start();
      }
    }, 100);
  }
  whenReady();
  window.__translationSimExactValues = () => {
    const bad = [];
    document.querySelectorAll('[translate="no"]').forEach((el) => {
      if (el.querySelector('font[data-sim="1"]') || (el.textContent || "").includes(MARKER)) bad.push((el.textContent || "").slice(0, 60));
    });
    return bad;
  };
})();
`;

/** Every page-level failure a translated page could show. */
export type Failures = string[];

export function watchPage(page: Page, failures: Failures) {
  page.on("pageerror", (error: Error) => failures.push(`pageerror at ${page.url()}: ${error.message.split("\n")[0].slice(0, 200)}`));
  page.on("console", (message: { type(): string; text(): string }) => {
    const text = message.text();
    if (message.type() === "error" && /removeChild|insertBefore|NotFoundError|not a child of this node|Minified React error|Hydration failed/i.test(text)) {
      failures.push(`console at ${page.url()}: ${text.slice(0, 200)}`);
    }
  });
}

/** The page is a real page: no error screen, not blank, no dev overlay. */
export async function assertHealthy(page: Page, label: string, failures: Failures) {
  const state = await page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    return {
      length: text.trim().length,
      errorScreen: /This page couldn.?t load|Something went wrong|Application error/i.test(text),
      // Only in development: the framework's error dialog (its dev-tools badge is always in the page and is not an error).
      overlay: Boolean(document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog-overlay], [data-nextjs-dialog]")),
    };
  });
  if (state.length < 40) failures.push(`${label}: blank page (${state.length} characters)`);
  if (state.errorScreen) failures.push(`${label}: an error screen is showing`);
  if (state.overlay) failures.push(`${label}: the framework error overlay is showing`);
}

/** Text a person would read in the page body. */
export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

/* ------------------------------------------------------------- data */

export async function seedJourneyData(prisma: PrismaClient) {
  const { clubYearFor } = await import("../../modules/club-rosters/domain");
  const { registrationFormDefinitionSchema } = await import("../../modules/forms/definition");
  const clubYear = clubYearFor(new Date());
  const now = new Date();

  const existing = await prisma.user.findUnique({ where: { email: "admin@imsda-events.test" }, select: { id: true } });
  if (!existing) throw new Error("This is not a seeded dev database (admin@imsda-events.test is missing). Run `npm run db:seed` first.");
  const staffUserId = existing.id;

  await prisma.organization.upsert({
    where: { id: churchId },
    update: {},
    create: { id: churchId, type: "CHURCH", name: "Transcheck Prairie Church", normalizedName: "transcheck prairie church", city: "Testville", state: "IA" },
  });
  await prisma.organization.upsert({
    where: { id: clubId },
    update: {},
    create: { id: clubId, type: "CLUB", name: "Transcheck Trailblazers", normalizedName: "transcheck trailblazers", parentOrganizationId: churchId },
  });
  await prisma.clubProfile.upsert({
    where: { organizationId: clubId },
    update: {},
    create: { organizationId: clubId, meetingPlace: "Fellowship hall", meetingSchedule: "Saturdays after lunch", contactEmail: `${clubId}@example.test`, contactPhone: "(515) 555-0100" },
  });
  await prisma.attendeeAccount.upsert({
    where: { id: directorAccountId },
    update: { status: "ACTIVE", disabledAt: null },
    create: { id: directorAccountId, email: `${P}.director@example.test`, displayName: "Dana Transcheck-Director", firstName: "Dana", lastName: "Transcheck-Director", status: "ACTIVE", emailVerifiedAt: now },
  });
  await prisma.attendeeMfaEnrollment.upsert({
    where: { accountId: directorAccountId },
    update: { status: "ACTIVE" },
    create: { accountId: directorAccountId, method: "TOTP", status: "ACTIVE", sealedSecret: `${P}-placeholder-not-a-secret`, confirmedAt: now },
  });
  const grant = await prisma.clubDirectorGrant.findFirst({ where: { organizationId: clubId, attendeeAccountId: directorAccountId, revokedAt: null } });
  if (!grant) {
    await prisma.clubDirectorGrant.create({
      data: { organizationId: clubId, attendeeAccountId: directorAccountId, role: "DIRECTOR", effectiveFrom: new Date("2026-01-01T00:00:00Z"), reason: "Synthetic browser journey check" },
    });
  }
  for (const [index, [firstName, lastName]] of rosterNames.entries()) {
    const personId = `${P}_person_${index}`;
    await prisma.person.upsert({ where: { id: personId }, update: {}, create: { id: personId, firstName, lastName } });
    await prisma.clubRosterMember.upsert({
      where: { organizationId_clubYear_personId: { organizationId: clubId, clubYear, personId } },
      update: {},
      create: {
        organizationId: clubId, clubYear, personId,
        attendeeType: index === 5 ? "STAFF" : "YOUTH", role: index === 5 ? "Counselor" : "Pathfinder",
        classLevel: index === 5 ? null : "FRIEND", reportedAge: index === 5 ? 34 : 11 + index, gender: index % 2 === 0 ? "FEMALE" : "MALE", source: "DIRECTOR",
      },
    });
  }

  // A published event with a small registration form, a price and a promo code.
  const day = 86_400_000;
  await prisma.event.upsert({
    where: { id: eventId },
    update: { isPublished: true },
    create: {
      id: eventId, slug: eventSlug, name: "Transcheck Spring Retreat", startsAt: new Date(now.getTime() + 30 * day), endsAt: new Date(now.getTime() + 32 * day),
      isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY", timezone: "America/Chicago", location: "Fictitious verification venue", supportContact: "registration@imsda.org",
    },
  });
  const definition = registrationFormDefinitionSchema.parse({
    title: "Transcheck registration",
    description: "A synthetic form used only by the browser journey checks.",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 3, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" },
    sections: [
      {
        id: `${P}_contact`, title: "Contact", description: "", fields: [
          { id: `${P}_f_first`, key: "primary_contact_first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${P}_f_last`, key: "primary_contact_last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${P}_f_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
          { id: `${P}_f_promo`, key: "promo_code", label: "Promo code", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
        ],
      },
      {
        id: `${P}_attendees`, title: "Attendees", description: "", fields: [
          { id: `${P}_a_first`, key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${P}_a_last`, key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${P}_a_fee`, key: "registration_fee", label: "Registration fee", helpText: "", type: "CALCULATED", scope: "ATTENDEE", required: false, options: [], priceCents: 12_500 },
        ],
      },
    ],
  });
  await prisma.registrationForm.upsert({
    where: { id: formId },
    update: { status: "PUBLISHED" },
    create: {
      id: formId, eventId, createdByUserId: staffUserId, name: definition.title, slug: formSlug, status: "PUBLISHED",
      versions: { create: { id: formVersionId, createdByUserId: staffUserId, versionNumber: 1, status: "PUBLISHED", publishedAt: now, definition } },
    },
  });
  await prisma.promoCode.upsert({
    where: { eventId_normalizedCode: { eventId, normalizedCode: promoCode } },
    update: { isActive: true },
    create: { id: `${P}_promo`, eventId, code: promoCode, normalizedCode: promoCode, isActive: true, discountType: "PERCENT_BPS", discountValue: 1000 },
  });
}

/** Best effort: every step is tried, none stops the others. Rows all start with "transcheck". */
export async function cleanupJourneyData(prisma: PrismaClient) {
  const mine = { startsWith: `${P}_` };
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["messages", async () => {
      const ids = (await prisma.registration.findMany({ where: { eventId }, select: { id: true } })).map((row) => row.id);
      await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ eventId }, { entityId: { in: ids } }] } });
    }],
    ["registrations", async () => {
      await prisma.registrationAttendee.deleteMany({ where: { eventId } });
      await prisma.registration.deleteMany({ where: { eventId } });
    }],
    ["promo", () => prisma.promoCode.deleteMany({ where: { eventId } })],
    ["form", async () => {
      await prisma.registrationFormVersion.deleteMany({ where: { formId } });
      await prisma.registrationForm.deleteMany({ where: { id: formId } });
    }],
    ["event", () => prisma.event.deleteMany({ where: { id: eventId } })],
    ["sessions", () => prisma.attendeeSession.deleteMany({ where: { accountId: directorAccountId } })],
    ["roster", () => prisma.clubRosterMember.deleteMany({ where: { organizationId: clubId } })],
    ["people", async () => {
      await prisma.person.deleteMany({ where: { id: mine } });
      await prisma.person.deleteMany({ where: { lastName: { startsWith: "Transcheck-" } } });
      await prisma.person.deleteMany({ where: { lastName: { startsWith: "Livecheck-" } } });
    }],
    ["grants", () => prisma.clubDirectorGrant.deleteMany({ where: { attendeeAccountId: directorAccountId } })],
    ["mfa", () => prisma.attendeeMfaEnrollment.deleteMany({ where: { accountId: directorAccountId } })],
    ["account", () => prisma.attendeeAccount.deleteMany({ where: { id: directorAccountId } })],
    ["club", async () => {
      await prisma.clubProfile.deleteMany({ where: { organizationId: clubId } });
      await prisma.organization.deleteMany({ where: { id: clubId } });
      await prisma.organization.deleteMany({ where: { id: churchId } });
    }],
  ];
  for (const [name, run] of steps) {
    await run().catch((error: Error) => console.error(`cleanup (${name}): ${error.message.split("\n").slice(-2).join(" ").slice(0, 160)}`));
  }
}

/** A signed-in director session, minted directly (the second factor is skipped, as in verify-badge-print). */
export async function mintDirectorSession(tokens: string[], accountId: string = directorAccountId) {
  const { createAttendeeSession } = await import("../../modules/attendee-accounts/session-store");
  const { attendeeSessionCookie } = await import("../../modules/security/session-cookies");
  const session = await createAttendeeSession(accountId, null, { secondFactorVerifiedAt: new Date() });
  tokens.push(session.token);
  return { name: attendeeSessionCookie.legacyName, value: session.token, expires: Math.floor(session.expiresAt.getTime() / 1000) };
}

export async function revokeSessions(tokens: string[]) {
  const { revokeAttendeeSession } = await import("../../modules/attendee-accounts/session-store");
  for (const token of tokens) await revokeAttendeeSession(token).catch(() => undefined);
}

export async function newContext(browser: Browser, options: { translate: boolean; cookie?: { name: string; value: string; expires: number }; width?: number; withoutGuard?: boolean }) {
  const context: BrowserContext = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 }, reducedMotion: "reduce" });
  // tsx compiles with esbuild's keepNames, which wraps functions in __name(); the page has no such helper.
  await context.addInitScript("window.__name = (target) => target;");
  // Proof that the check catches the crash it exists for: JOURNEY_WITHOUT_GUARD=1 turns the app's removeChild/insertBefore guard off
  // (it is a no-op marked as already installed, so the app's own install is skipped).
  if (options.withoutGuard) await context.addInitScript("Node.prototype[Symbol.for('imsda.translationSafeDom')] = true;");
  if (options.translate) await context.addInitScript(translationSimulatorScript);
  if (options.cookie) {
    await context.addCookies([{ name: options.cookie.name, value: options.cookie.value, url: baseUrl, httpOnly: true, expires: options.cookie.expires }]);
  }
  return context;
}

export async function launch(playwright: Record<string, any>, name: string): Promise<Browser> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const type = playwright[name];
  if (!type) throw new Error(`Unknown browser ${name}`);
  return type.launch({ args: name === "chromium" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [] });
}

/* ------------------------------------------------------- shared steps */

export const rosterUrl = `${baseUrl}/account/clubs/${clubId}/roster`;

/** The roster is fully interactive (hydrated) when the search box answers. */
export async function openRoster(page: Page, url: string = rosterUrl) {
  await page.goto(url, { waitUntil: "load" });
  await settleRoster(page);
}

/** Waits for the roster to be interactive (and translated, when the simulator is on), then opens its Staff and Members sections. */
export async function settleRoster(page: Page) {
  await page.locator("#roster-search").waitFor({ state: "visible", timeout: 20_000 });
  const translating: boolean = await page.evaluate("typeof window.__translationSim !== 'undefined'");
  if (translating) await page.waitForFunction(() => (window as unknown as { __translationSim: { wrapped: number } }).__translationSim.wrapped > 0, undefined, { timeout: 30_000 });
  const closed = page.locator(".club-roster-stack details[data-roster-section]:not([open]) > summary");
  for (let attempts = 0; attempts < 6 && (await closed.count()) > 0; attempts += 1) {
    // A section can open by itself (a remembered choice restored after hydration); a click that finds it gone is fine.
    await closed.first().click({ timeout: 3_000 }).catch(() => undefined);
  }
}

export async function activeCount(page: Page): Promise<number | null> {
  const text: string = (await page.locator(".club-roster-heading-actions .count-badge").first().innerText()) ?? "";
  const match = /(\d+)\s*active/i.exec(text.replace(TRANSLATION_MARKER, ""));
  return match ? Number(match[1]) : null;
}

/** Opens the Add dialog from the roster heading. */
export async function openAddDialog(page: Page) {
  await page.locator(".club-roster-heading-actions").getByRole("button", { name: /Add to roster/ }).click();
  await page.locator("#roster-dialog-title").waitFor({ state: "visible", timeout: 10_000 });
  // The dialog hook moves focus into the dialog on the next animation frame (use-accessible-dialog.ts). Typing before that
  // frame lets the hook take focus from a half-typed field in WebKit and the text is lost, so wait until focus is inside.
  await page.waitForFunction(() => Boolean(document.activeElement?.closest("form")?.querySelector("#roster-dialog-title")), undefined, { timeout: 10_000 });
}

export function rosterForm(page: Page) {
  return page.locator("form:has(#roster-dialog-title)");
}

/** Fills one field and waits until the page holds the value (a fill that raced a focus change is repeated, never skipped). */
async function fillField(locator: ReturnType<Page["locator"]>, value: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
  }
  throw new Error(`The field would not keep "${value}"`);
}

export async function fillRosterForm(page: Page, first: string, last: string) {
  const form = rosterForm(page);
  await fillField(form.locator('input[name="firstName"]'), first);
  await fillField(form.locator('input[name="lastName"]'), last);
  await fillField(form.locator('input[name="birthDateText"]'), "6/1/2014");
  await form.locator('select[name="gender"]').selectOption("FEMALE");
}

export async function submitRosterForm(page: Page) {
  await rosterForm(page).locator('button[type="submit"]').click();
}

/** Adds a person through the dialog and waits for the dialog to close. */
export async function addRosterMember(page: Page, first: string, last: string) {
  await openAddDialog(page);
  await fillRosterForm(page, first, last);
  await submitRosterForm(page);
  await page.locator("#roster-dialog-title").waitFor({ state: "detached", timeout: 15_000 });
}

/** Removes a person through the actions menu and the confirmation. */
export async function removeRosterMember(page: Page, first: string, last: string) {
  const label = `${first} ${last}`;
  await page.locator(`summary[aria-label^="Actions for ${label}"]`).click();
  await page.locator(`button[aria-label^="Remove ${label}"]`).first().click();
  // The confirmation dialog has its own button with the same name.
  await page.locator('[role="dialog"], dialog').getByRole("button", { name: `Remove ${label}` }).click();
  await page.getByText(last, { exact: false }).first().waitFor({ state: "detached", timeout: 15_000 });
}

export async function visibleText(page: Page, text: string, timeout = 15_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}
