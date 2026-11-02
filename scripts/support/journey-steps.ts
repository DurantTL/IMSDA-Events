/**
 * Shared, reusable journey steps (#1439): what a person does on the site, as plain exported async functions that take a
 * page plus data, so another suite can call them too.
 *
 * Issue #1482 (walkthrough guides) is writing shared walkthrough step definitions in parallel; merge the two into one
 * module in #1482 or a follow-up.
 *
 * Rules for steps: drive the UI with role/label locators like a person would, wait on conditions (never a fixed
 * sleep), and throw an Error with a plain sentence when the page does not do what a person expects. Judgements about
 * SITE-RULES live in `site-rule-checks.ts`, not here.
 */
import { totpCode } from "../../modules/access/totp";
import type { FakeMailServer } from "./fake-mail-server";
import { baseUrl, type Page } from "./browser-journeys";

const SLOW = 20_000;

/** A pattern for exactly this text, which still matches when the translation simulator puts "[es] " in front of it. */
export const exactly = (text: string) => new RegExp(`^(\\[es\\] )?${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** Opens a page and waits until it is a real, loaded page (not a spinner or a redirect in flight). */
export async function openPage(page: Page, path: string) {
  await page.goto(path.startsWith("http") ? path : `${baseUrl}${path}`, { waitUntil: "load" });
  await page.locator("main, [role='main'], body").first().waitFor({ state: "visible", timeout: SLOW });
}

/** Waits until a heading with this text (or pattern) is showing. */
export async function expectHeading(page: Page, name: string | RegExp, timeout = SLOW) {
  await page.getByRole("heading", { name }).first().waitFor({ state: "visible", timeout });
}

/* ------------------------------------------------------------ sign in */

/**
 * Account sign-in with email + password. A club role without two-step is then asked for the emailed code (rule A2):
 * this step stops after the click and returns when the password was sent, so the code can be looked up in the outbox.
 */
export async function submitPassword(page: Page, input: { email: string; password: string; next?: string }) {
  await openPage(page, `/account/sign-in${input.next ? `?next=${encodeURIComponent(input.next)}` : ""}`);
  await page.getByLabel("Email address").fill(input.email);
  await page.getByLabel("Password").first().fill(input.password);
  const sentAfter = Date.now() - 1_000;
  await page.getByRole("button", { name: exactly("Sign in") }).click();
  return sentAfter;
}

/** Reads the emailed code from the outbox and enters it on the "Check your email" page. */
export async function enterEmailedCode(page: Page, mail: FakeMailServer, input: { email: string; since: number }) {
  await expectHeading(page, /Check your email/);
  const code = await mail.waitForCode(input.email, { since: input.since });
  await page.getByLabel("Sign-in code").fill(code);
  await page.getByRole("button", { name: exactly("Sign in") }).click();
  await page.waitForURL((url: URL) => !/\/account\/sign-in\/code/.test(url.pathname), { timeout: SLOW });
  return code;
}

/** Password, then the emailed code, until the person is inside (their account, with no club page opened yet). */
export async function signInWithEmailedCode(page: Page, mail: FakeMailServer, input: { email: string; password: string; next?: string }) {
  const since = await submitPassword(page, input);
  await page.waitForURL(/\/account\/sign-in\/code/, { timeout: SLOW });
  return enterEmailedCode(page, mail, { email: input.email, since });
}

/* ------------------------------------------------------------ two-step */

/** The path of a club's page. */
export const clubPath = (clubId: string, sub = "") => `/account/clubs/${clubId}${sub}`;

/**
 * On the two-step gate's first screen: opens setup. With passkeys switched on the choice screen follows; this returns
 * its options in the order shown (empty when setup went straight to the authenticator app).
 */
export async function startTwoStepSetup(page: Page) {
  await page.getByRole("button", { name: /Set up two-step sign-in/ }).click();
  const radios = page.getByRole("radio");
  const choice = await radios.first().waitFor({ state: "visible", timeout: 4_000 }).then(() => true, () => false);
  if (!choice) return [] as string[];
  const options = (await page.locator("fieldset label").allInnerTexts()).map((text: string) => text.replace(/\s+/g, " ").trim());
  return options;
}

/** Chooses the authenticator app (if asked), reads the secret the page shows, types the current code and finishes. Returns the secret. */
export async function finishAuthenticatorSetup(page: Page) {
  const radios = page.getByRole("radio");
  if (await radios.first().isVisible().catch(() => false)) {
    await page.getByRole("radio", { name: /authenticator app/i }).check();
    await page.getByRole("button", { name: exactly("Continue") }).click();
  }
  await page.getByRole("button", { name: /Set up an authenticator/ }).click();
  const secretField = page.locator("input.copy-field");
  await secretField.waitFor({ state: "visible", timeout: SLOW });
  const secret = (await secretField.inputValue()).trim();
  if (!/^[A-Z2-7]{16,}$/.test(secret)) throw new Error(`The authenticator secret on the page looks wrong ("${secret.slice(0, 6)}...")`);
  await page.getByLabel("Code from your authenticator").fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: /Confirm and turn on/ }).click();
  await page.getByText(/Save your recovery codes/).waitFor({ state: "visible", timeout: SLOW });
  await page.getByRole("button", { name: /saved these codes/ }).click();
  await page.getByRole("heading", { name: /Two-step sign-in is on/ }).waitFor({ state: "visible", timeout: SLOW });
  return secret;
}

/** After setup: follows "Open <club>" and waits for the club's home. */
export async function openClubFromTwoStepDone(page: Page, clubName: string) {
  await page.getByRole("link", { name: new RegExp(`Open ${clubName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await expectHeading(page, new RegExp(clubName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

/** From a club page that needs two-step: follows its "Set up two-step sign-in" link to the gate. */
export async function followTwoStepLink(page: Page) {
  await page.getByRole("link", { name: /Set up two-step sign-in/ }).first().click();
  await page.waitForURL(/\/account\/(two-step|security|profile)/, { timeout: SLOW });
}

/* ---------------------------------------------------------------- team */

/** Club settings, "Add club admin": gives a role by email. Waits for the confirmation line. */
export async function addTeamAdmin(page: Page, clubId: string, email: string) {
  await openPage(page, clubPath(clubId, "/club-info"));
  await page.getByRole("button", { name: /Add club admin/ }).first().click();
  await page.getByLabel("Their email").fill(email);
  const sentAfter = Date.now() - 1_000;
  await page.locator("form").filter({ has: page.getByLabel("Their email") }).getByRole("button", { name: /Add club admin/ }).click();
  await page.getByText(/Invite sent|got the role|has the role|added/i).first().waitFor({ state: "visible", timeout: SLOW });
  return sentAfter;
}

/* ---------------------------------------------------------- club forms */

/** Fills a club form's text and number questions by their visible label. */
export async function fillClubForm(page: Page, answers: Record<string, string>) {
  for (const [label, value] of Object.entries(answers)) {
    await page.getByLabel(label, { exact: false }).first().fill(value);
  }
}

/* ------------------------------------------------------ club event registration */

/**
 * The club registration for an open club event, as a director does it: choose who is going, give the contact, move
 * through the attendee step and the review, and submit. Starts on the event's first screen. Ends on whatever the
 * site shows after the submit (a person reads that, so the step only waits for the review's Submit to be gone).
 */
export async function registerClubForEvent(page: Page, input: { contact: { first: string; last: string; email: string }; people: string[] }) {
  // `people` are shown as "Last, First" on the list.
  for (const [index, person] of input.people.entries()) {
    const box = page.locator("label").filter({ hasText: person }).locator('input[type="checkbox"]').first();
    await box.waitFor({ state: "visible", timeout: SLOW });
    await box.check();
    // The choice is saved as it is made; wait for the count to follow before the next one.
    await page.getByRole("button", { name: new RegExp(`Continue with ${index + 1} (people|person)`) }).waitFor({ state: "visible", timeout: SLOW });
  }
  // A person with no birth date on the roster is asked for their age on the event date.
  const ages = page.getByLabel(/Age on event date/);
  for (let index = 0; index < (await ages.count()); index += 1) await ages.nth(index).fill("12");
  await page.getByRole("button", { name: new RegExp(`Continue with ${input.people.length} (people|person)`) }).click();
  await page.getByLabel(/First name/).first().fill(input.contact.first);
  await page.getByLabel(/Last name/).first().fill(input.contact.last);
  await page.getByLabel(/Email/).first().fill(input.contact.email);
  await page.getByRole("button", { name: exactly("Continue") }).click();
  await page.getByText(/Choices for each attendee/).waitFor({ state: "visible", timeout: SLOW });
  await page.getByRole("button", { name: exactly("Continue") }).click();
  const submit = page.getByRole("button", { name: /Submit registration/ });
  await submit.waitFor({ state: "visible", timeout: SLOW });
  await submit.click();
  await submit.waitFor({ state: "detached", timeout: SLOW });
}

/* -------------------------------------------------------------- orders */

/** The "Add an item" picker on Orders: finds the item by typing part of its name, chooses it, sets the quantity, adds it. */
export async function addOrderLine(page: Page, input: { item: string; quantity: number }) {
  const search = page.locator("#club-order-picker-search");
  await search.fill(input.item);
  const select = page.locator("#club-order-picker-item");
  const option = select.locator("option", { hasText: input.item }).first();
  await option.waitFor({ state: "attached", timeout: SLOW });
  await select.selectOption({ label: ((await option.textContent()) ?? "").trim() });
  await page.locator("#club-order-picker-quantity").fill(String(input.quantity));
  await page.getByRole("button", { name: exactly("Add to list") }).click();
}

/* ----------------------------------------------------- monthly records */

/** Opens the month's form from the Monthly Records page (the button under the month's points). */
export async function openMonthlyRecord(page: Page) {
  const form = page.locator('input[name="meetingPlace"]');
  // The button reads "Open Monthly Record", or "Continue report" once a draft exists.
  if (!(await form.isVisible().catch(() => false))) await page.getByRole("button", { name: /Open Monthly Record|Continue report/ }).click();
  await form.waitFor({ state: "visible", timeout: SLOW });
}

export async function fillMonthlyRecord(page: Page, input: { place: string; attendance: string; pathfinders: string; tlts: string; staff: string }) {
  await page.locator('input[name="meetingPlace"]').fill(input.place);
  await page.locator('input[name="averageAttendance"]').fill(input.attendance);
  await page.locator('input[name="pathfinderCount"]').fill(input.pathfinders);
  await page.locator('input[name="tltCount"]').fill(input.tlts);
  await page.locator('input[name="staffCount"]').fill(input.staff);
  await page.locator("#points-staffMeeting").selectOption("25");
}

/** Save draft on a report form, and wait for the shared "Saved." message. */
export async function saveMonthlyRecordDraft(page: Page) {
  await page.getByRole("button", { name: /Save draft/ }).click();
  await page.getByRole("status").filter({ hasText: /Saved\./ }).first().waitFor({ state: "visible", timeout: SLOW });
}

export async function fillYearEnd(page: Page, input: { adultBaptisms: string; tltMaleLow: string }) {
  await page.locator("#ye-baptismAdult").fill(input.adultBaptisms);
  await page.locator("#ye-tltMale12").fill(input.tltMaleLow);
}

export async function saveYearEndDraft(page: Page) {
  await saveMonthlyRecordDraft(page);
}
