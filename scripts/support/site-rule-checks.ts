/**
 * Page-level SITE-RULES checks for the role journeys (#1439, docs/SITE-RULES.md).
 *
 * `Recorder` collects one result per check (pass, fail, or not applicable with a reason), keyed by page name, so a run
 * can print "page: rule ID: result" lists for a review report. `KNOWN_BUGS` are failures that are the site's fault, not
 * the test's: a check named in the list is reported as an "expected failure", and the suite fails if it unexpectedly
 * passes (so the entry is removed when the site is fixed).
 *
 * Passive checks run on every page a journey visits (`checkPage`): B12 status chips, B13 times, B3 tables, H3/H4 help
 * for "not set up" states, S1/S2/S4 search boxes. Active checks are called by the journey at the point where the
 * state exists: `checkErrorSummary` (B7), `checkLeaveWarning` (B6), `checkConfirmDialog` (B9), `checkDialogBehavior` (L7).
 *
 * Decisions about what counts (so a reader can tell test from site):
 *  - B12 looks only at the shared `.status-chip` element (L4). The eight agreed words plus the words docs/SITE-RULES.md
 *    says keep their own meaning (Expired, Used, Attached to a club, Declined, Completed; email delivery states; the
 *    area roll-ups; check-in states) are accepted. "Missing", "Late" and "To review" are L4's coral/purple flags, not
 *    record statuses, so they are accepted too, and so are a person's club role (Director, Registrar, ...) and the
 *    Sterling Volunteers state of a roster person (Clear, Not in compliance, No record): they describe a person, not a
 *    record. Event availability ("Open", "Registration closed", ...) and a form's "Done" are not record statuses either.
 *    A chip's detail after " · " ("Draft saved · 2 chosen") is ignored; its first words are the word. Anything else is
 *    reported as a failure naming the word.
 *  - B13 looks for clock times ("3:15 PM"): each must sit next to "CT". Dates alone are not times.
 *  - B3 checks `table` elements and their three nearest wrappers for sideways scrolling.
 *  - H3/H4: a text that says something is not set up, missing, blocked or not available yet must have, nearby, a link or
 *    a "How to do this" panel (H3) or name who to ask (H4).
 */
import { clubDirectorRoleLabels } from "../../modules/organizations/director-grants-domain";
import type { Page } from "./browser-journeys";

export type Outcome = "pass" | "fail" | "n/a";
export type RuleResult = { viewport: string; page: string; rule: string; what: string; outcome: Outcome; detail: string; known?: string };
export type KnownBug = { id: string; description: string; labels: string[]; only?: string };

export const APPROVED_STATUS_WORDS = ["Draft", "Submitted", "Pending payment", "Pending approval", "Confirmed", "Waitlisted", "Cancelled", "Refunded"];
const OWN_MEANING_WORDS = ["Expired", "Used", "Attached to a club", "Declined", "Completed", "Queued", "Processing", "Captured", "Sent", "Failed", "Suppressed"];
/** The area coordinator roll-ups (B12): whether an area has registered. Accepted only on coordinator pages (`extraWords`). */
export const AREA_ROLLUP_WORDS = ["Registered", "Not registered"];
const L4_FLAGS = ["Missing", "Late", "To review"];
/**
 * Chips that use the shared look but are not the status of a record (decided in #1439): a person's role in the club
 * (Director, Deputy, Registrar, Reporter) and the Sterling Volunteers background-check state of a roster person.
 */
/**
 * Chips about whether something can be done, not about a record: an event's registration window, and a yearly form's
 * "Done" next to its "Missing" (the L4 flag).
 */
const AVAILABILITY_WORDS = ["Open", "Closed", "Registration opens soon", "Registration closed", "Not open for clubs yet", "Done"];
const NOT_A_RECORD_STATUS = [...Object.values(clubDirectorRoleLabels), "Clear", "Not in compliance", "No record", "No record yet"];

export const clean = (text: string) => text.replace(/\[es\]\s*/g, "").replace(/\s+/g, " ").trim();

export class Recorder {
  readonly results: RuleResult[] = [];
  readonly unexpected: string[] = [];
  readonly seenKnown = new Set<string>();
  constructor(readonly viewport: string, private readonly knownBugs: KnownBug[] = []) {}

  /** The label every result gets, also what KNOWN_BUGS name. */
  static label(page: string, rule: string, what: string) {
    return `${page} | ${rule} | ${what}`;
  }

  record(page: string, rule: string, what: string, outcome: Outcome, detail: string) {
    const label = Recorder.label(page, rule, what);
    const known = this.knownBugs.find((bug) => bug.labels.includes(label) && (!bug.only || bug.only === this.viewport));
    const result: RuleResult = { viewport: this.viewport, page, rule, what, outcome, detail };
    if (known) {
      result.known = known.id;
      this.seenKnown.add(known.id);
      if (outcome === "pass") this.unexpected.push(`KNOWN BUG ${known.id} unexpectedly passed (${label}). The site is fixed: remove it from KNOWN_BUGS.`);
    } else if (outcome === "fail") {
      this.unexpected.push(`${this.viewport}: ${label}: ${detail}`);
    }
    this.results.push(result);
    const mark = known && outcome === "fail" ? "expected failure" : outcome;
    if (outcome === "fail" || known) console.log(`    ${mark.toUpperCase()} ${rule} ${what}${known ? ` [${known.id}]` : ""}: ${detail}`);
    return outcome === "pass";
  }

  /** For a plain assertion in a journey: counts like a failed check but is not tied to a rule. */
  summary() {
    const byPage = new Map<string, Map<string, string[]>>();
    for (const result of this.results) {
      const rules = byPage.get(result.page) ?? new Map<string, string[]>();
      const marks = rules.get(result.rule) ?? [];
      marks.push(result.known && result.outcome === "fail" ? "expected-fail" : result.outcome);
      rules.set(result.rule, marks);
      byPage.set(result.page, rules);
    }
    const lines: string[] = [];
    for (const [page, rules] of byPage) {
      const parts = [...rules].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).map(([rule, marks]) => {
        const unique = [...new Set(marks)];
        const word = unique.includes("fail") ? "FAIL" : unique.includes("expected-fail") ? "expected-fail" : unique.every((mark) => mark === "n/a") ? "n/a" : "pass";
        return `${rule}=${word}`;
      });
      lines.push(`  ${page}: ${parts.join(" ")}`);
    }
    return lines;
  }
}

/** Polls a page-side condition without dying when a navigation destroys the page context in between. */
export async function pollPage<T>(page: Page, read: () => Promise<T>, done: (value: T) => boolean, timeout = 4_000): Promise<{ ok: boolean; value: T | null }> {
  const started = Date.now();
  let last: T | null = null;
  for (;;) {
    try {
      last = await read();
      if (done(last)) return { ok: true, value: last };
    } catch {
      // A navigation is in flight: ask again.
    }
    if (Date.now() - started > timeout) return { ok: false, value: last };
    await page.waitForTimeout(80);
  }
}

const bodyText = (page: Page) => async () => clean(await page.evaluate(() => document.body?.innerText ?? ""));

/* ----------------------------------------------------------- passive */

type Scan = {
  chips: string[];
  badTimes: string[];
  times: number;
  tables: number;
  wideTables: string[];
  notSet: Array<{ text: string; fixLinks: string[]; asksWho: boolean }>;
};

async function scanPage(page: Page): Promise<Scan> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const squash = (text: string) => text.replace(/\[es\]\s*/g, "").replace(/\s+/g, " ").trim();
    const chips = [...document.querySelectorAll(".status-chip")].filter(visible).map((chip) => squash(chip.textContent ?? ""));

    const timePattern = /\b(1[0-2]|0?[1-9]):[0-5]\d\s?(am|pm)\b/i;
    const badTimes: string[] = [];
    let times = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (!parent || !timePattern.test(node.nodeValue ?? "") || !visible(parent) || parent.closest("script, style, option")) continue;
      times += 1;
      const around = squash((parent.closest("p, li, td, div, span, time") ?? parent).textContent ?? "");
      if (!/\b(CT|Central)\b/.test(around)) badTimes.push(squash(node.nodeValue ?? "").slice(0, 80));
    }

    const tables = [...document.querySelectorAll("table")].filter(visible);
    const wideTables: string[] = [];
    for (const table of tables) {
      let node: Element | null = table;
      for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== "visible") {
          wideTables.push(`${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ")[0]}` : ""} ${node.scrollWidth}>${node.clientWidth}`);
          break;
        }
      }
    }

    const notSetPattern = /(not set up|isn.t set up|not been set up|no (?:[\w'-]+ ){0,4}(?:are|is) available yet|haven.t (?:loaded|been)|not configured|(?:is|are) blocked|(?:is|are) missing|not ready yet|^missing\b|incomplete)/i;
    const fixPattern = /(set up|open|fill|add|help|how to|start|register|continue|send|invite|go to|choose)/i;
    const whoPattern = /(conference staff|conference office|system administrator|ask (?:your|the|a)|contact (?:your|the))/i;
    const notSet: Scan["notSet"] = [];
    const seen = new Set<Element>();
    for (const element of document.body.querySelectorAll("p, li, small, span, h3, h4, strong, div")) {
      if (!visible(element) || element.closest("script, style, option, nav, header, .modal-card")) continue;
      // The deepest element that says it: a container whose own children already say it is skipped.
      if ([...element.children].some((child) => notSetPattern.test(squash(child.textContent ?? "")))) continue;
      const own = squash(element.textContent ?? "");
      if (own.length > 220 || !notSetPattern.test(own) || seen.has(element)) continue;
      seen.add(element);
      let container: Element = element;
      for (let depth = 0; depth < 4 && container.parentElement && container.parentElement !== document.body; depth += 1) {
        container = container.parentElement;
        if (container.matches("section, article, li, form, main, .public-manage-card")) break;
      }
      const fixLinks = [...container.querySelectorAll("a[href], button, summary")].filter(visible)
        .map((control) => squash(control.textContent ?? "")).filter((text) => fixPattern.test(text));
      notSet.push({ text: own.slice(0, 100), fixLinks: fixLinks.slice(0, 3), asksWho: whoPattern.test(squash(container.textContent ?? "")) });
    }
    return { chips, badTimes, times, tables: tables.length, wideTables, notSet };
  });
}

export async function checkPage(page: Page, rec: Recorder, name: string, options: { extraWords?: string[] } = {}) {
  const scan = await scanPage(page);

  // B12: status chips.
  if (scan.chips.length === 0) rec.record(name, "B12", "status chip words", "n/a", "no status chips on this page");
  else {
    const accepted = [...APPROVED_STATUS_WORDS, ...OWN_MEANING_WORDS, ...L4_FLAGS, ...NOT_A_RECORD_STATUS, ...AVAILABILITY_WORDS, ...(options.extraWords ?? [])].map((word) => word.toLowerCase());
    // A chip may carry a detail after the word ("Draft saved · 2 chosen"): the word is what is checked, and it may be
    // an approved word followed by more words ("Draft saved").
    const wordOf = (chip: string) => chip.split(" · ")[0]!.trim().toLowerCase();
    const bad = [...new Set(scan.chips.filter((chip) => !accepted.includes(wordOf(chip)) && !APPROVED_STATUS_WORDS.some((word) => wordOf(chip).startsWith(`${word.toLowerCase()} `))))];
    const words = [...new Set(scan.chips)].join(", ");
    if (bad.length === 0) rec.record(name, "B12", "status chip words", "pass", `chips: ${words}`);
    else rec.record(name, "B12", "status chip words", "fail", `chip word(s) outside the approved list: ${bad.map((word) => `"${word}"`).join(", ")} (all chips: ${words})`);
  }

  // B13: times in Central, labeled.
  if (scan.times === 0) rec.record(name, "B13", "times show CT", "n/a", "no clock times on this page");
  else if (scan.badTimes.length === 0) rec.record(name, "B13", "times show CT", "pass", `${scan.times} time(s), each labeled CT`);
  else rec.record(name, "B13", "times show CT", "fail", `time without "CT": ${scan.badTimes.slice(0, 3).map((time) => `"${time}"`).join(", ")}`);

  // B3: no table scrolls sideways.
  if (scan.tables === 0) rec.record(name, "B3", "tables do not scroll sideways", "n/a", "no tables on this page");
  else if (scan.wideTables.length === 0) rec.record(name, "B3", "tables do not scroll sideways", "pass", `${scan.tables} table(s) fit`);
  else rec.record(name, "B3", "tables do not scroll sideways", "fail", `scrolls sideways: ${scan.wideTables.join("; ")}`);

  // H3/H4: every "not set up" or missing state has a way forward.
  if (scan.notSet.length === 0) rec.record(name, "H3", "not-set-up states show help", "n/a", "no not-set-up, missing or blocked state on this page");
  else {
    const dead = scan.notSet.filter((state) => state.fixLinks.length === 0 && !state.asksWho);
    if (dead.length === 0) {
      const viaWho = scan.notSet.filter((state) => state.fixLinks.length === 0).length;
      rec.record(name, "H3", "not-set-up states show help", "pass", `${scan.notSet.length} state(s); e.g. "${scan.notSet[0]!.text.slice(0, 50)}" -> ${scan.notSet[0]!.fixLinks[0] ?? "names who to ask"}`);
      if (viaWho > 0) rec.record(name, "H4", "says who to ask", "pass", `${viaWho} state(s) name who can fix it`);
    } else rec.record(name, "H3", "not-set-up states show help", "fail", `dead end: ${dead.slice(0, 2).map((state) => `"${state.text}"`).join("; ")}`);
  }

  await checkSearchBoxes(page, rec, name);
}

/* ------------------------------------------------------------ search */

/** S1, S2, S4: typing narrows with no Enter, and clearing brings the whole list back. */
export async function checkSearchBoxes(page: Page, rec: Recorder, name: string) {
  const boxes = page.locator('input[type="search"], .search-field input, [role="searchbox"]');
  const count = await boxes.count();
  const usable: number[] = [];
  for (let index = 0; index < count; index += 1) if (await boxes.nth(index).isVisible()) usable.push(index);
  if (usable.length === 0) {
    for (const rule of ["S1", "S2", "S4"]) rec.record(name, rule, "search box", "n/a", "no search box on this page");
    return;
  }
  const read = bodyText(page);
  for (const index of usable) {
    const box = boxes.nth(index);
    const id = (await box.getAttribute("id")) ?? (await box.getAttribute("placeholder")) ?? `box ${index + 1}`;
    const what = `search box "${id}"`;
    const baseline = await read();
    // S2: no minimum and no "type to search" empty state.
    const gate = /type (at least )?\d+ (characters|letters)|type to search|type more to narrow|enter at least/i.exec(baseline);
    rec.record(name, "S2", what, gate ? "fail" : "pass", gate ? `shows "${gate[0]}"` : "no minimum-character or type-to-search message");
    // S1: focusing does not hide anything.
    await box.click();
    const afterFocus = await read();
    rec.record(name, "S1", `${what} (focus shows full list)`, afterFocus === baseline ? "pass" : "fail", afterFocus === baseline ? "list unchanged on focus" : "the page changed when the box was focused");
    // S4: typing narrows with no Enter.
    await box.pressSequentially("zzqx-no-match-zz", { delay: 15 });
    const narrowed = await pollPage<string>(page, read, (text) => text !== baseline, 5_000);
    rec.record(name, "S4", `${what} (typing narrows, no Enter)`, narrowed.ok ? "pass" : "fail", narrowed.ok ? "results changed while typing" : "typed text did not change the results without pressing Enter");
    // S1/S2: clearing shows the full list again.
    await box.fill("");
    const restored = await pollPage<string>(page, read, (text) => text === baseline, 5_000);
    rec.record(name, "S1", `${what} (empty shows full list)`, restored.ok ? "pass" : "fail", restored.ok ? "emptying the box restored the full list" : "emptying the box did not bring back the full list");
  }
}

/* -------------------------------------------------------------- active */

/** B7: a failed submit shows the shared summary at the top ("N things to fix") and a message by the field. */
export async function checkErrorSummary(page: Page, rec: Recorder, name: string, what: string, submit: () => Promise<void>) {
  await submit();
  type ErrorState = { summary: boolean; summaryText: string; summaryAbove: boolean; invalid: number; described: number; anyError: boolean };
  const narrowed = await pollPage<ErrorState>(
    page,
    () => page.evaluate(() => {
      const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      const summary = [...document.querySelectorAll(".form-error-summary, [role='alert']")].filter(visible).find((node) => /thing|fix|review|error|required/i.test(node.textContent ?? ""));
      const invalid = [...document.querySelectorAll("[aria-invalid='true']")].filter(visible);
      const described = invalid.filter((field) => {
        const ids = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        return ids.some((id) => { const note = document.getElementById(id); return note && visible(note) && (note.textContent ?? "").trim().length > 0 && /field-error|error/i.test(note.className + note.id); });
      });
      return {
        summary: Boolean(summary), summaryText: (summary?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        summaryAbove: Boolean(summary && invalid[0] && summary.getBoundingClientRect().top <= invalid[0].getBoundingClientRect().top + 1),
        invalid: invalid.length, described: described.length, anyError: Boolean(document.querySelector(".form-error, .inline-notice.error, .field-error-message")),
      };
    }),
    (value) => value.summary || value.invalid > 0 || value.anyError,
    5_000,
  );
  const value = narrowed.value;
  if (!narrowed.ok || !value) { rec.record(name, "B7", `${what}: error at the top`, "fail", "submitting with a problem showed no error at all"); rec.record(name, "B7", `${what}: error by the field`, "fail", "submitting with a problem showed no error at all"); return; }
  rec.record(name, "B7", `${what}: error at the top`, value.summary && value.summaryAbove ? "pass" : "fail", value.summary ? (value.summaryAbove ? `summary: "${value.summaryText}"` : "the summary is below the field") : "no summary of the problems at the top");
  rec.record(name, "B7", `${what}: error by the field`, value.described > 0 ? "pass" : "fail", value.described > 0 ? `${value.described} field(s) marked invalid with their own message` : `no field has its own message (${value.invalid} marked invalid)`);
}

/** B6: after an edit, leaving the page warns first (the browser's own prompt or an in-page dialog). Returns to the page afterwards. */
export async function checkLeaveWarning(page: Page, rec: Recorder, name: string, what: string, edit: () => Promise<void>, leave: () => Promise<void>) {
  let prompted = false;
  const onDialog = (dialog: { type(): string; dismiss(): Promise<void> }) => { prompted = true; void dialog.dismiss().catch(() => undefined); };
  page.on("dialog", onDialog);
  try {
    await edit();
    const startUrl: string = page.url();
    // A dialog that was already open (a form inside a modal) is not a warning; only a new one is.
    const openBefore = await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count();
    await leave().catch(() => undefined);
    const seen = await pollPage<{ prompted: boolean; url: string; inPage: number }>(
      page,
      async () => ({ prompted, url: page.url() as string, inPage: (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) - openBefore }),
      (value) => value.prompted || value.inPage > 0 || value.url !== startUrl,
      2_500,
    );
    const value = seen.value;
    const warned = Boolean(value && (value.prompted || value.inPage > 0));
    rec.record(name, "B6", `${what}: leaving with unsaved changes warns`, warned ? "pass" : "fail", warned ? (value!.prompted ? "the browser asked before leaving" : "a dialog asked before leaving") : `left to ${value?.url ?? "another page"} without any warning`);
    if (warned && value && value.inPage > 0) await page.keyboard.press("Escape");
    if (!warned) await page.goto(startUrl, { waitUntil: "load" });
  } finally {
    page.off("dialog", onDialog);
  }
}

/** B9: a delete, remove or cancel opens the shared confirm dialog. Opens it, checks it, and cancels (nothing is confirmed). */
export async function checkConfirmDialog(page: Page, rec: Recorder, name: string, what: string, trigger: () => Promise<void>, opener?: ReturnType<Page["locator"]>) {
  let nativePrompt = false;
  const onDialog = (dialog: { dismiss(): Promise<void> }) => { nativePrompt = true; void dialog.dismiss().catch(() => undefined); };
  page.on("dialog", onDialog);
  try {
    await trigger();
    const shown = await pollPage<number>(page, () => page.locator(".confirm-dialog").count(), (value) => value > 0 || nativePrompt, 3_000);
    const shared = Boolean(shown.value && shown.value > 0);
    rec.record(name, "B9", `${what}: asks for confirmation in the shared dialog`, shared ? "pass" : "fail", shared ? "the shared confirm dialog opened" : nativePrompt ? "a browser prompt (window.confirm) opened instead of the shared dialog" : "nothing asked before the action");
    if (shared) {
      await checkDialogBehavior(page, rec, name, what, page.locator(".confirm-dialog"), opener);
    }
  } finally {
    page.off("dialog", onDialog);
  }
}

/** L7: a dialog traps focus, closes on Escape and gives focus back to what opened it. The dialog must already be open. */
export async function checkDialogBehavior(page: Page, rec: Recorder, name: string, what: string, dialog: ReturnType<Page["locator"]>, opener?: ReturnType<Page["locator"]>) {
  const inside = await pollPage<boolean>(page, () => dialog.first().evaluate((node: Element) => node.contains(document.activeElement)), Boolean, 3_000);
  rec.record(name, "L7", `${what}: focus moves into the dialog`, inside.ok ? "pass" : "fail", inside.ok ? "focus is inside the dialog" : "focus stayed outside the dialog");
  await page.keyboard.press("Escape");
  const closed = await pollPage<number>(page, () => dialog.count(), (value) => value === 0, 3_000);
  rec.record(name, "L7", `${what}: Escape closes the dialog`, closed.ok ? "pass" : "fail", closed.ok ? "Escape closed it" : "Escape did not close it");
  if (opener) {
    const back = await pollPage<boolean>(page, () => opener.evaluate((node: Element) => node === document.activeElement), Boolean, 3_000);
    rec.record(name, "L7", `${what}: focus returns to the opener`, back.ok ? "pass" : "fail", back.ok ? "focus is back on the button that opened it" : "focus did not return to the button that opened the dialog");
  }
}
