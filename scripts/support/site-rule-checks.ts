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
 *    record. The coordinator's gap flags ("No director", "No roster yet", "Missing 1 earlier month", "Late 2
 *    records") are L4 "Missing"/"Late" flags too. Event availability ("Open", "Registration closed", ...) and a form's "Done" are not record statuses either.
 *    A chip's detail after " · " ("Draft saved · 2 chosen") is ignored; its first words are the word. Anything else is
 *    reported as a failure naming the word.
 *  - B13 looks for clock times ("3:15 PM"): each must sit next to a Central label (CT, CDT, CST: the site prints the short
 *    zone name). Dates alone are not times. No page the director and coordinator journeys visit shows a clock time yet, so
 *    B13 is n/a everywhere and SITE-RULES.md does not claim it; the check is ready for a page that does.
 *  - B3 checks `table` elements and their three nearest wrappers for sideways scrolling.
 *  - H3/H4: a text that says something is not set up, missing, blocked or not available yet must have, nearby, a link or
 *    a "How to do this" panel (H3) or name who to ask (H4).
 */
import { EMAIL_FIELD_MESSAGE, PHONE_FIELD_MESSAGE } from "../../lib/field-validation";
import { attendeeStaffPageCopy } from "../../modules/access/no-access-copy";
import { clubDirectorRoleLabels } from "../../modules/organizations/director-grants-domain";
import type { Page } from "./browser-journeys";

export type Outcome = "pass" | "fail" | "n/a";
export type RuleResult = { viewport: string; page: string; rule: string; what: string; outcome: Outcome; detail: string; known?: string };
/**
 * `checks`: each failing check the bug explains, by its exact label and either a substring its failure detail must contain, or (for
 * a check that can list several offenders) `offenders`: the failure matches only when EVERY offender it lists is one of these, so a
 * new offender can never hide behind a known one.
 */
export type KnownBug = { id: string; description: string; checks: Array<{ label: string; detail?: string; offenders?: string[] }>; only?: string };

export const APPROVED_STATUS_WORDS = ["Draft", "Submitted", "Pending payment", "Pending approval", "Confirmed", "Waitlisted", "Cancelled", "Refunded"];
const OWN_MEANING_WORDS = ["Expired", "Used", "Attached to a club", "Declined", "Completed", "Queued", "Processing", "Captured", "Sent", "Failed", "Suppressed"];
/** The area coordinator roll-ups (B12): whether an area has registered. Accepted only on coordinator pages (`extraWords`). */
export const AREA_ROLLUP_WORDS = ["Registered", "Not registered"];
const L4_FLAGS = ["Missing", "Late", "To review", "No director", "No roster yet"];
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

  record(page: string, rule: string, what: string, outcome: Outcome, detail: string, offenders?: string[]) {
    const label = Recorder.label(page, rule, what);
    const named = this.knownBugs.find((bug) => bug.checks.some((check) => check.label === label) && (!bug.only || bug.only === this.viewport));
    // A failure is the known one only when its detail also says what the entry expects; the same check failing for
    // another reason is a new, real failure.
    const explains = (check: KnownBug["checks"][number]) => check.label === label && (check.offenders
      ? Boolean(offenders && offenders.length > 0 && offenders.every((offender) => check.offenders!.includes(offender)))
      : detail.includes(check.detail ?? "\u0000"));
    const known = named && (outcome === "pass" || named.checks.some(explains)) ? named : undefined;
    const result: RuleResult = { viewport: this.viewport, page, rule, what, outcome, detail };
    if (known) {
      result.known = known.id;
      this.seenKnown.add(known.id);
      if (outcome === "pass") this.unexpected.push(`KNOWN BUG ${known.id} unexpectedly passed (${label}). The site is fixed: remove it from KNOWN_BUGS.`);
    } else if (outcome === "fail") {
      this.unexpected.push(`${this.viewport}: ${label}: ${detail}${named ? ` (the known bug ${named.id} expects a different failure)` : ""}`);
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

/** The page text, one trimmed line per line, so two reads can be compared line by line. */
const bodyText = (page: Page) => async () => (await page.evaluate(() => document.body?.innerText ?? "")).split("\n").map((line: string) => clean(line)).filter(Boolean).join("\n");

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
      if (!/\b(CT|CDT|CST|Central)\b/.test(around)) badTimes.push(squash(node.nodeValue ?? "").slice(0, 80));
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
      if (!visible(element) || element.closest("script, style, option, nav, header, .modal-card, a[href]")) continue;
      // The deepest element that says it: a container whose own children already say it is skipped.
      if ([...element.children].some((child) => notSetPattern.test(squash(child.textContent ?? "")))) continue;
      const own = squash(element.textContent ?? "");
      if (own.length > 220 || !notSetPattern.test(own) || seen.has(element)) continue;
      seen.add(element);
      // The nearest enclosing row, item or section that holds a way forward (a link, button or "How to do this" panel).
      const controlsIn = (node: Element) => [...node.querySelectorAll("a[href], button, summary")].filter(visible)
        .map((control) => squash(control.textContent ?? "")).filter((text) => fixPattern.test(text));
      let container: Element = element;
      let fixLinks = controlsIn(container);
      for (let depth = 0; depth < 6 && fixLinks.length === 0 && container.parentElement && container.parentElement !== document.body; depth += 1) {
        container = container.parentElement;
        fixLinks = controlsIn(container);
        if (container.matches("section, article, form, main, .public-manage-card")) break;
      }
      notSet.push({ text: own.slice(0, 100), fixLinks: fixLinks.slice(0, 3), asksWho: whoPattern.test(squash(container.textContent ?? "")) });
    }
    return { chips, badTimes, times, tables: tables.length, wideTables, notSet };
  });
}

export async function checkPage(page: Page, rec: Recorder, name: string, options: { extraWords?: string[]; look?: boolean } = {}) {
  const scan = await scanPage(page);

  // B12: status chips.
  if (scan.chips.length === 0) rec.record(name, "B12", "status chip words", "n/a", "no status chips on this page");
  else {
    const accepted = [...APPROVED_STATUS_WORDS, ...OWN_MEANING_WORDS, ...L4_FLAGS, ...NOT_A_RECORD_STATUS, ...AVAILABILITY_WORDS, ...(options.extraWords ?? [])].map((word) => word.toLowerCase());
    // A chip may carry a detail after the word ("Draft saved · 2 chosen"): the word is what is checked, and it may be
    // an approved word followed by more words ("Draft saved").
    const wordOf = (chip: string) => chip.split(" · ")[0]!.trim().toLowerCase();
    // "Missing 1 earlier month" and "Late 2 records" are the L4 flags with a count.
    const flagged = (word: string) => /^(missing|late) /.test(word);
    const bad = [...new Set(scan.chips.filter((chip) => !accepted.includes(wordOf(chip)) && !flagged(wordOf(chip)) && !APPROVED_STATUS_WORDS.some((word) => wordOf(chip).startsWith(`${word.toLowerCase()} `))))];
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
  // The look rules (L1, L4, L5, L6) are passive too, but only the event journeys switch them on.
  if (options.look) {
    await checkSearchFieldLook(page, rec, name);
    await checkChipsAndBadges(page, rec, name);
    await checkButtons(page, rec, name);
    await checkTabs(page, rec, name);
  }
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
    // A combobox (the header's "Find a page or task") opens a list of choices when it is focused: that list is the full list, so it
    // is read as options, not as a change to the page.
    if ((await box.getAttribute("role")) === "combobox") {
      await checkComboboxSearch(page, rec, name, what, box);
      continue;
    }
    const baseline = await read();
    // S2: no minimum and no "type to search" empty state.
    const gate = /type (at least )?\d+ (characters|letters)|type to search|type more to narrow|enter at least/i.exec(baseline);
    rec.record(name, "S2", what, gate ? "fail" : "pass", gate ? `shows "${gate[0]}"` : "no minimum-character or type-to-search message");
    // S1: focusing does not hide anything.
    await box.click();
    const afterFocus = await read();
    const focusDiff = afterFocus === baseline ? "" : (() => { const was = new Set(baseline.split("\n")); const now = new Set(afterFocus.split("\n")); const gone = baseline.split("\n").find((line: string) => !now.has(line)); const added = afterFocus.split("\n").find((line: string) => !was.has(line)); return ` (${gone ? `gone: "${gone.slice(0, 60)}"` : ""}${added ? ` new: "${added.slice(0, 60)}"` : ""})`; })();
    rec.record(name, "S1", `${what} (focus shows full list)`, afterFocus === baseline ? "pass" : "fail", afterFocus === baseline ? "list unchanged on focus" : `the page changed when the box was focused${focusDiff}`);
    // S4: typing narrows with no Enter.
    await box.pressSequentially("zzqx-no-match-zz", { delay: 15 });
    // Narrowing means fewer lines of results than before, or a no-match message that was not there before; a different
    // line somewhere (a counter, an echo of the typed text) is not narrowing.
    const noMatch = /\b(no (?:\w+ )*(?:results?|matches|clubs?|guides?|items?|people|forms?|events?) (?:found|match)|no (?:results?|matches)|nothing (?:found|matches)|none of them match|0 (?:results?|matches|of \d+)|not found)\b/i;
    const baselineCount = baseline.split("\n").length;
    const narrowed = await pollPage<string>(page, read, (text) => text.split("\n").length < baselineCount || (noMatch.test(text) && !noMatch.test(baseline)), 5_000);
    rec.record(name, "S4", `${what} (typing narrows, no Enter)`, narrowed.ok ? "pass" : "fail", narrowed.ok ? "fewer results (or a no-match message) while typing" : "typing a string that matches nothing did not narrow the results or show a no-match message without pressing Enter");
    // S1/S2: clearing shows the full list again.
    await box.fill("");
    // Emptying the box brings the whole list back: every line the page showed before is shown again (a page may add
    // more, for example a table that stays open after a search).
    const baselineLines = baseline.split("\n");
    const restored = await pollPage<string>(page, read, (text) => { const now = new Set(text.split("\n")); return baselineLines.every((line: string) => now.has(line)); }, 5_000);
    const missingLine = restored.ok ? "" : (() => { const now = new Set((restored.value ?? "").split("\n")); const gone = baselineLines.find((line: string) => !now.has(line)); return gone ? ` (missing: "${gone.slice(0, 70)}")` : ""; })();
    rec.record(name, "S1", `${what} (empty shows full list)`, restored.ok ? "pass" : "fail", restored.ok ? "emptying the box restored the full list" : `emptying the box did not bring back the full list${missingLine}`);
    // Leave the box as a person would, so a list or popup it opened is not still there for the next box.
    await page.keyboard.press("Escape");
    await box.blur().catch(() => undefined);
  }
}

/** S1, S2, S4 for a combobox search: focus lists every choice, typing narrows them (or says none match), emptying lists them all again. */
async function checkComboboxSearch(page: Page, rec: Recorder, name: string, what: string, box: ReturnType<Page["locator"]>) {
  const options = page.locator('[role="listbox"] [role="option"]:visible');
  await box.click();
  const all = await pollPage<number>(page, () => options.count(), (count) => count > 0, 3_000);
  rec.record(name, "S1", `${what} (focus shows full list)`, all.ok ? "pass" : "fail", all.ok ? `${all.value} choice(s) listed on focus` : "focusing the box listed no choices");
  rec.record(name, "S2", what, "pass", "a combobox: no minimum-character or type-to-search message");
  await box.pressSequentially("zzqx-no-match-zz", { delay: 15 });
  const none = await pollPage<{ count: number; message: boolean }>(page, async () => ({ count: await options.count(), message: /\bno [\w ]*(match|results?|found)/i.test(await page.locator("body").innerText()) }), (value) => value.count < (all.value ?? 0) || value.message, 3_000);
  rec.record(name, "S4", `${what} (typing narrows, no Enter)`, none.ok ? "pass" : "fail", none.ok ? "fewer choices (or a no-match message) while typing" : "typing a string that matches nothing did not narrow the choices");
  await box.fill("");
  const back = await pollPage<number>(page, () => options.count(), (count) => count >= (all.value ?? 1), 3_000);
  rec.record(name, "S1", `${what} (empty shows full list)`, back.ok ? "pass" : "fail", back.ok ? "emptying the box listed every choice again" : "emptying the box did not bring the choices back");
  await page.keyboard.press("Escape");
  await box.blur().catch(() => undefined);
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

/* =========================================================================================================
 * Event journeys (#1439 round 2): checks for the rules the attendee pages answer to. Each is capable of failing, and a
 * rule that does not apply to a page is recorded "n/a" with the reason. The look checks (L1, L4, L5, L6) run from
 * `checkPage` only when `look: true` is passed.
 * ========================================================================================================= */

/** What a person can read of a field's own message: the elements its aria-describedby points at, joined. */
async function describedText(field: ReturnType<Page["locator"]>) {
  return field.evaluate((node: Element) => (node.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim());
}

/** Holds back the next request that `match` accepts, so the in-flight state (the "Saving…" label) can be read before it ends. */
export async function holdRequest(page: Page, match: (url: string, method: string, body: string | null) => boolean) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let seen: () => void = () => undefined;
  const hit = new Promise<void>((resolve) => { seen = resolve; });
  let held = false;
  const handler = async (route: { request(): { url(): string; method(): string; postData(): string | null }; fallback(): Promise<void>; continue(): Promise<void> }) => {
    const request = route.request();
    if (held || !match(request.url(), request.method(), request.postData())) return route.fallback();
    held = true;
    seen();
    await gate;
    await route.continue().catch(() => undefined);
  };
  await page.route("**/*", handler);
  return { hit, release, stop: async () => { release(); await page.unroute("**/*", handler).catch(() => undefined); } };
}

/* ------------------------------------------------------------- B8 */

/**
 * B8: phone, email and date answers are checked and tidied the same way in every form. Types a bad value into each given
 * field, leaves it, and expects the shared message (the field is marked invalid and its own message is the one in
 * lib/field-validation.ts); a good unformatted phone is tidied to "(515) 555-0134" when the field is left. Leaves the fields blank.
 */
export async function checkTypedFields(page: Page, rec: Recorder, name: string, fields: { phone?: ReturnType<Page["locator"]>; email?: ReturnType<Page["locator"]>; birthDate?: ReturnType<Page["locator"]> }) {
  const leave = async (field: ReturnType<Page["locator"]>) => { await field.blur(); };
  const messageOf = (field: ReturnType<Page["locator"]>) => async () => ({ invalid: (await field.getAttribute("aria-invalid")) === "true", text: await describedText(field) });
  if (fields.phone) {
    await fields.phone.fill("idk 911");
    await leave(fields.phone);
    const bad = await pollPage(page, messageOf(fields.phone), (value) => value.invalid, 3_000);
    const text = bad.value?.text ?? "";
    rec.record(name, "B8", "a bad phone gets the shared message", bad.ok && text.includes(PHONE_FIELD_MESSAGE) ? "pass" : "fail", bad.ok ? `message: "${text.slice(0, 90)}"` : "a bad phone number was not marked invalid when the field was left");
    await fields.phone.fill("5155550134");
    await leave(fields.phone);
    const tidy = await pollPage<string>(page, () => fields.phone!.inputValue(), (value) => value === "(515) 555-0134", 3_000);
    rec.record(name, "B8", "a good phone is tidied to (515) 555-0134", tidy.ok ? "pass" : "fail", tidy.ok ? "5155550134 became (515) 555-0134 when the field was left" : `the phone stayed "${tidy.value}"`);
    await fields.phone.fill("");
  }
  if (fields.email) {
    await fields.email.fill("not-an-email");
    await leave(fields.email);
    const bad = await pollPage(page, messageOf(fields.email), (value) => value.invalid, 3_000);
    const text = bad.value?.text ?? "";
    rec.record(name, "B8", "a bad email gets the shared message", bad.ok && text.includes(EMAIL_FIELD_MESSAGE) ? "pass" : "fail", bad.ok ? `message: "${text.slice(0, 90)}"` : "a bad email address was not marked invalid when the field was left");
  }
  if (fields.birthDate) {
    const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    await fields.birthDate.fill(future);
    await leave(fields.birthDate);
    const bad = await pollPage(page, messageOf(fields.birthDate), (value) => value.invalid, 3_000);
    const text = bad.value?.text ?? "";
    rec.record(name, "B8", "a birth date in the future gets the shared date message", bad.ok && /can't be in the future/.test(text) ? "pass" : "fail", bad.ok ? `message: "${text.slice(0, 90)}"` : "a birth date a year from now was not marked invalid");
    await fields.birthDate.fill("");
  }
}

/** B8 for a plain email field that the browser alone checks (the shared message never appears): records what really happens. */
export async function checkBrowserOnlyEmail(page: Page, rec: Recorder, name: string, field: ReturnType<Page["locator"]>) {
  await field.fill("not-an-email");
  await field.blur();
  const state = await pollPage(page, async () => ({
    invalid: (await field.getAttribute("aria-invalid")) === "true",
    text: await describedText(field),
    native: await field.evaluate((node: HTMLInputElement) => node.validity.typeMismatch),
  }), (value) => value.invalid || value.text.length > 0, 1_500);
  const value = state.value;
  const shared = Boolean(value?.invalid && value.text.includes(EMAIL_FIELD_MESSAGE));
  rec.record(name, "B8", "a bad email gets the shared message", shared ? "pass" : "fail", shared ? `message: "${value!.text.slice(0, 90)}"` : `the field shows no shared message when left; only the browser's own check (${value?.native ? "type mismatch on submit" : "none"}) applies`);
  await field.fill("");
}

/* ------------------------------------------------------- B5 and B10 */

/**
 * B5 and B10: a form has one clear Save, the pressed button reads "Saving…" while the request is in flight, and one message
 * under it says "Saved." (or "Not saved: ..."). `click` presses Save; `match` picks the request to hold open.
 */
export async function checkSaveFlow(page: Page, rec: Recorder, name: string, what: string, input: { form: ReturnType<Page["locator"]>; button: ReturnType<Page["locator"]>; click: () => Promise<void>; match: (url: string, method: string, body: string | null) => boolean; done: () => Promise<unknown> }) {
  const saveButtons = await input.form.locator("button").evaluateAll((nodes: HTMLButtonElement[]) => nodes.filter((node) => node.getBoundingClientRect().width > 0).map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()).filter((text) => /^(save|saving|update)\b/i.test(text)));
  rec.record(name, "B5", `${what}: one clear Save button`, saveButtons.length === 1 ? "pass" : "fail", `Save-type buttons in the form: ${JSON.stringify(saveButtons)}`);
  const held = await holdRequest(page, input.match);
  try {
    await input.click();
    await Promise.race([held.hit, page.waitForTimeout(8_000)]);
    const label = clean((await input.button.textContent()) ?? "");
    const busy = (await input.button.getAttribute("aria-busy")) === "true";
    rec.record(name, "B10", `${what}: the button reads "Saving…" while working`, /^Saving…$/.test(label) ? "pass" : "fail", `while the request was in flight the button said "${label}"${busy ? " (aria-busy)" : ""}`);
  } finally {
    await held.stop();
  }
  await input.done();
  const messages = await input.form.locator('[role="status"], [role="alert"], .inline-notice, [aria-live="polite"], [aria-live="assertive"]').evaluateAll((nodes: HTMLElement[]) => nodes.filter((node) => node.getBoundingClientRect().width > 0 && (node.textContent ?? "").trim().length > 0).map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()));
  const text = messages[0] ?? "";
  rec.record(name, "B5", `${what}: one "Saved." message after saving`, messages.length === 1 && /^Saved\./.test(text) ? "pass" : "fail", `messages shown after saving: ${JSON.stringify(messages)}`);
}

/** B10: a button that sends something says what it is doing (ends in "…", like "Saving…" or "Submitting…") while the request is in flight, and is marked busy or disabled so it cannot be sent twice. */
export async function checkInFlightLabel(page: Page, rec: Recorder, name: string, what: string, input: { button: ReturnType<Page["locator"]>; click: () => Promise<void>; match: (url: string, method: string, body: string | null) => boolean; expect?: RegExp }) {
  const held = await holdRequest(page, input.match);
  try {
    await input.click();
    await Promise.race([held.hit, page.waitForTimeout(8_000)]);
    const text = clean((await input.button.first().textContent()) ?? "");
    const guarded = (await input.button.first().getAttribute("aria-busy")) === "true" || (await input.button.first().isDisabled());
    const named = input.expect ? input.expect.test(text) : /…$/.test(text);
    rec.record(name, "B10", `${what}: says what it is doing while working`, named && guarded ? "pass" : "fail", `while the request was in flight the button said "${text}"${guarded ? ", and could not be pressed again" : ", and could be pressed again"}`);
  } finally {
    await held.stop();
  }
}

/* --------------------------------------------------------------- B4 */

/** B4: an empty list says why it is empty and offers the next step (a link or a button with its own words). */
export async function checkEmptyState(page: Page, rec: Recorder, name: string, what: string, container: ReturnType<Page["locator"]>) {
  const found = await container.first().waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
  if (!found) { rec.record(name, "B4", `${what}: says why and offers a next step`, "fail", "no empty-state message is on the page"); return; }
  const state = await container.first().evaluate((node: HTMLElement) => ({
    text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
    next: [...node.querySelectorAll("a[href], button")].map((control) => (control.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean),
  }));
  const why = state.text.length >= 25 && /\b(no|none|nothing|not|yet)\b/i.test(state.text);
  rec.record(name, "B4", `${what}: says why it is empty`, why ? "pass" : "fail", `"${state.text.slice(0, 120)}"`);
  rec.record(name, "B4", `${what}: offers the next step`, state.next.length > 0 ? "pass" : "fail", state.next.length > 0 ? `next step: ${state.next.map((label: string) => `"${label}"`).join(", ")}` : "the empty message has no link or button to go on with");
}

/* -------------------------------------------------------------- B14 */

/** B14: a staff page opened by someone signed in as an attendee says the shared thing and who to ask. */
export async function checkNoAccess(page: Page, rec: Recorder, name: string, email: string) {
  const copy = attendeeStaffPageCopy(email);
  const text = clean(await page.evaluate(() => document.body?.innerText ?? ""));
  const ask = `Ask ${copy.whoToAsk} if you need access.`;
  rec.record(name, "B14", "says the shared no-access words", text.includes(copy.heading) && text.includes(copy.body) ? "pass" : "fail", text.includes(copy.heading) ? `heading "${copy.heading}"` : `page says: "${text.slice(0, 140)}"`);
  rec.record(name, "B14", "explains who to ask", text.includes(ask) ? "pass" : "fail", text.includes(ask) ? `"${ask}"` : "the \"Ask ... if you need access.\" line is missing");
  const heading = await page.getByRole("heading", { level: 1 }).count();
  rec.record(name, "B14", "the page has its own heading", heading > 0 ? "pass" : "fail", `${heading} level-1 heading(s)`);
}

/**
 * B14 for a staff member whose role lacks the permission for a page: the shared "Permission required" state (components/access-restricted.tsx)
 * with the page's own title and the line "Ask <who> if you need access.", a heading, and a way on (Help & learning).
 */
export async function checkRestricted(page: Page, rec: Recorder, name: string, expected: { title: string; whoToAsk: string }) {
  const state = page.locator(".forbidden-state");
  const shown = await state.first().waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
  if (!shown) { rec.record(name, "B14", "shows the shared no-access state", "fail", `no "Permission required" state: the page says "${clean((await page.locator("main").innerText().catch(() => "")).slice(0, 120))}"`); return; }
  const text = clean(await state.first().innerText());
  rec.record(name, "B14", "shows the shared no-access state", /permission required/i.test(text) && text.includes(expected.title) ? "pass" : "fail", `"${text.slice(0, 140)}"`);
  const ask = `Ask ${expected.whoToAsk} if you need access.`;
  rec.record(name, "B14", "explains who to ask", text.includes(ask) ? "pass" : "fail", text.includes(ask) ? `"${ask}"` : `the page says: "${text.slice(0, 140)}"`);
  const next = await state.first().locator("a[href]").count();
  rec.record(name, "B14", "offers a permitted next step", next > 0 ? "pass" : "fail", `${next} link(s) in the no-access state`);
}

/* --------------------------------------------------------------- S5 */

/**
 * S5: typing in a search box keeps focus in it while the results update, and the new results are announced in a live
 * region (role="status" or aria-live). `query` should narrow the list.
 */
export async function checkSearchLive(page: Page, rec: Recorder, name: string, input: { box: ReturnType<Page["locator"]>; query: string }) {
  const live = () => page.evaluate(() => [...document.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]')].map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | "));
  const before = await live();
  await input.box.click();
  await input.box.pressSequentially(input.query, { delay: 15 });
  const announced = await pollPage<string>(page, live, (text) => text !== before && text.length > 0, 6_000);
  const stillFocused = await input.box.evaluate((node: Element) => node === document.activeElement);
  const kept = (await input.box.inputValue()) === input.query;
  rec.record(name, "S5", "focus stays in the search box while results update", stillFocused && kept ? "pass" : "fail", stillFocused ? (kept ? "the typed text and the focus were still in the box after the results changed" : "the box lost what was typed") : "focus left the search box while the results updated");
  rec.record(name, "S5", "the new results are announced in a live region", announced.ok ? "pass" : "fail", announced.ok ? `live region: "${(announced.value ?? "").slice(0, 80)}" (was "${before.slice(0, 40)}")` : "no live region changed while the results updated");
}

/** S5: Enter and no-JavaScript still work: with scripts off, typing and pressing Enter submits the form and shows the narrowed list. */
export async function checkSearchWithoutScript(browser: { newContext(options: Record<string, unknown>): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> }, rec: Recorder, name: string, input: { url: string; query: string; expectText: string }) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: "load" });
    const box = page.locator('input[type="search"]').first();
    await box.fill(input.query);
    await Promise.all([page.waitForURL((url: URL) => url.searchParams.get("q") === input.query, { timeout: 15_000 }), box.press("Enter")]);
    const shown = await page.getByText(input.expectText).first().isVisible().catch(() => false);
    rec.record(name, "S5", "Enter and no-JavaScript still work", shown ? "pass" : "fail", shown ? "with scripts off, Enter sent the search in the address and the list showed the match" : "with scripts off, Enter did not show the matching result");
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------- look */


/** L1: the `.search-field` wrapper draws the border (10px radius), the input draws nothing, the native clear "x" is hidden, clear buttons are 44px. */
export async function checkSearchFieldLook(page: Page, rec: Recorder, name: string) {
  const wrappers = page.locator(".search-field:visible");
  const total = await wrappers.count();
  if (total === 0) { rec.record(name, "L1", "search field look", "n/a", "no search field on this page"); return; }
  // Every search field on the page (the staff header has one too), each read the same way.
  for (let index = 0; index < total; index += 1) await checkOneSearchFieldLook(page, rec, name, wrappers.nth(index));
}

async function checkOneSearchFieldLook(page: Page, rec: Recorder, name: string, wrapper: ReturnType<Page["locator"]>) {
  const look = await wrapper.evaluate((node: HTMLElement) => {
    const style = getComputedStyle(node);
    const input = node.querySelector("input");
    const inner = input ? getComputedStyle(input) : null;
    // The browser does not report the native x through getComputedStyle, so ask the page's own stylesheets: a rule that
    // matches this input (before its ::-webkit-search-cancel-button) and says display: none.
    let cancel = "shown";
    const hideRules = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) hideRules(nested);
        const styleRule = rule as CSSStyleRule;
        if (!styleRule.selectorText || !input || !styleRule.selectorText.includes("::-webkit-search-cancel-button")) continue;
        const matches = styleRule.selectorText.split(",").some((selector) => selector.includes("::-webkit-search-cancel-button") && (() => { try { return input.matches(selector.replace(/::-webkit-search-cancel-button.*$/, "").trim()); } catch { return false; } })());
        if (matches && styleRule.style.display === "none") cancel = "none";
      }
    };
    for (const sheet of Array.from(document.styleSheets)) { try { hideRules(sheet.cssRules); } catch { /* a sheet from another site */ } }
    return {
      radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      border: `${style.borderTopWidth} ${style.borderTopStyle}`,
      inner: inner ? { width: inner.borderTopWidth, style: inner.borderTopStyle, shadow: inner.boxShadow, type: input!.type } : null,
      cancel,
    };
  });
  rec.record(name, "L1", "the wrapper draws the border with a 10px radius", look.radii.every((radius: string) => radius === "10px") && !/^0px|none/.test(look.border) ? "pass" : "fail", `radius ${look.radii.join("/")}, border ${look.border}`);
  if (look.inner) {
    const drawsNothing = (look.inner.width === "0px" || look.inner.style === "none") && (look.inner.shadow === "none" || look.inner.shadow === "");
    rec.record(name, "L1", "the input inside draws no border", drawsNothing ? "pass" : "fail", `input border ${look.inner.width} ${look.inner.style}, shadow ${look.inner.shadow}`);
    if (look.inner.type === "search") rec.record(name, "L1", "the native clear x is hidden", look.cancel === "none" ? "pass" : "fail", look.cancel === "none" ? "a stylesheet rule hides ::-webkit-search-cancel-button inside this field" : "no stylesheet rule hides the browser's own clear x inside this field");
  }
  // The clear button shows once something is typed.
  const input = wrapper.locator("input").first();
  await input.fill("x");
  const clear = wrapper.locator("button:visible").first();
  const shown = await clear.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false);
  if (!shown) rec.record(name, "L1", "the clear button is 44px", "n/a", "this search field has no clear button after typing (the rule sizes the buttons that exist)");
  else {
    const box = await clear.boundingBox();
    const size = box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "not measurable";
    rec.record(name, "L1", "the clear button is 44px", box && box.width >= 43.5 && box.height >= 43.5 ? "pass" : "fail", `clear button is ${size}px`, [size]);
  }
  await input.fill("");
}

/** The ring a focused field shows: one 2px ring at 2px offset in the field-focus color, and no halo. */
async function focusLook(field: ReturnType<Page["locator"]>) {
  await field.focus();
  return field.evaluate((input: HTMLElement) => {
    // A search box draws its ring on the .search-field wrapper (focus-within), the input inside stays bare.
    const node = (input.closest(".search-field") as HTMLElement | null) ?? input;
    const style = getComputedStyle(node);
    const probe = document.createElement("span");
    probe.style.color = "var(--field-focus)";
    document.body.append(probe);
    const ring = getComputedStyle(probe).color;
    probe.remove();
    return { outline: `${style.outlineWidth} ${style.outlineStyle}`, color: style.outlineColor, ring, offset: style.outlineOffset, shadow: `${style.boxShadow}${node === input ? "" : ` / input ${getComputedStyle(input).boxShadow}`}`.replace(/^none \/ input none$/, "none"), border: style.borderTopColor };
  });
}

/** L2: a focused field shows one 2px ring at 2px offset in the shared focus color, with no box-shadow halo. */
export async function checkFocusRing(page: Page, rec: Recorder, name: string, field: ReturnType<Page["locator"]>) {
  const look = await focusLook(field);
  const ok = look.outline === "2px solid" && look.offset === "2px" && look.color === look.ring;
  rec.record(name, "L2", "a focused field shows one 2px ring at 2px offset", ok ? "pass" : "fail", `outline ${look.outline} ${look.color} at ${look.offset} offset (the shared color is ${look.ring})`);
  rec.record(name, "L2", "a focused field has no glow", look.shadow === "none" ? "pass" : "fail", `box-shadow: ${look.shadow}`);
}

/** L3: an errored field that has focus keeps the red edge (a red border, or the 1px red line the invalid style draws around the border) and also gets the ring. The field must already be marked invalid. */
export async function checkErroredFocus(page: Page, rec: Recorder, name: string, field: ReturnType<Page["locator"]>) {
  const invalid = (await field.getAttribute("aria-invalid")) === "true";
  if (!invalid) { rec.record(name, "L3", "an errored focused field keeps the red border and the ring", "fail", "the field is not marked invalid, so the errored state could not be checked"); return; }
  const look = await focusLook(field);
  const redOf = (color: string) => {
    const [red = 0, green = 255, blue = 255] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    return red >= 100 && red >= green * 1.5 && red >= blue * 1.5;
  };
  const borderRed = redOf(look.border);
  const shadowRed = redOf(look.shadow) && /\b[1-9]\d*px\s*(rgb|$)|0px 0px 0px [1-9]/.test(look.shadow);
  const ring = look.outline === "2px solid" && look.offset === "2px" && look.color === look.ring;
  rec.record(name, "L3", "an errored focused field keeps the red border and the ring", (borderRed || shadowRed) && ring ? "pass" : "fail", `border ${look.border} (${borderRed ? "red" : "not red"}), shadow ${look.shadow} (${shadowRed ? "red line" : "no red line"}), outline ${look.outline} ${look.color} at ${look.offset}`);
}

/** L4: status chips and badges use the shared `.status-chip` and `.count-badge`; filter counts use the count badge. */
export async function checkChipsAndBadges(page: Page, rec: Recorder, name: string) {
  const scan = await page.evaluate(() => {
    const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
    const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/);
    const shared = (element: Element) => element.matches(".status-chip, .count-badge") || Boolean(element.closest(".status-chip, .count-badge")) || Boolean(element.querySelector(".status-chip, .count-badge"));
    const own = [...document.body.querySelectorAll("*")].filter((element) => {
      if (element.closest("svg, script, style, nav.skip-links") || !visible(element) || shared(element)) return false;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length === 0 || text.length > 40 || element.children.length > 2) return false;
      const classes = String((element as HTMLElement).className || "").split(/\s+/).flatMap((token) => words(token));
      return classes.some((word) => ["pill", "chip", "badge"].includes(word));
    }).map((element) => `${element.tagName.toLowerCase()}.${String((element as HTMLElement).className).split(/\s+/)[0]} "${(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}"`);
    const filterLinks = [...document.querySelectorAll('nav[aria-label*="Show" i] a, nav[aria-label*="Filter" i] a, [role="tab"]')].filter(visible);
    const counted = filterLinks.flatMap((link) => {
      const count = [...link.querySelectorAll("span, small")].find((child) => /^\(?\d+\)?$/.test((child.textContent ?? "").trim()));
      return count ? [{ label: (link.textContent ?? "").replace(/\s+/g, " ").trim(), shared: count.matches(".count-badge") || Boolean(count.closest(".count-badge")), cls: String((count as HTMLElement).className) }] : [];
    });
    return { own: [...new Set(own)], counted };
  });
  if (scan.own.length === 0) rec.record(name, "L4", "chips and badges use the shared classes", "n/a", "no chip, pill or badge on this page outside the shared ones");
  else rec.record(name, "L4", "chips and badges use the shared classes", "fail", `own chip look instead of .status-chip / .count-badge: ${scan.own.slice(0, 8).join("; ")}`, [...new Set(scan.own.map((entry: string) => entry.replace(/ ".*$/, "")))] as string[]);
  if (scan.counted.length === 0) rec.record(name, "L4", "filter counts use the count badge", "n/a", "no filter with counts on this page");
  else {
    const bad = scan.counted.filter((entry: { shared: boolean }) => !entry.shared);
    rec.record(name, "L4", "filter counts use the count badge", bad.length === 0 ? "pass" : "fail", bad.length === 0 ? `${scan.counted.length} filter count(s) use .count-badge` : `the count in "${bad[0]!.label}" is a plain span (.${String(bad[0]!.cls).split(" ")[0] || "no class"}), not .count-badge`, bad.map((entry: { cls: string }) => `.${String(entry.cls).split(" ")[0] || "no class"}`));
  }
}

const REVIEWED_OWN_LOOK = /retryButton|resetButton|skip|linkButton|productSelect|undo|chipRemove/;

/** L5: buttons use the shared classes (no button styled by a module class alone), main and light buttons have a hover look, a disabled button shows the not-allowed cursor. */
export async function checkButtons(page: Page, rec: Recorder, name: string) {
  const scan = await page.evaluate((reviewed: string) => {
    const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
    const sharedClass = /(^|\s)(primary|secondary|text|icon|danger|ghost)-button(\s|$)/;
    const buttons = [...document.querySelectorAll("button")].filter(visible);
    const ownLook = buttons.filter((button) => {
      const classes = String(button.className || "").trim();
      if (!classes || sharedClass.test(classes) || button.closest("summary")) return false;
      const tokens = classes.split(/\s+/);
      return tokens.every((token) => token.includes("__")) && !new RegExp(reviewed).test(classes);
    }).map((button) => `${String(button.className).split(" ")[0]} "${(button.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}"`);
    const disabled = buttons.filter((button) => (button as HTMLButtonElement).disabled).map((button) => ({ label: (button.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30), cursor: getComputedStyle(button).cursor }));
    return { count: buttons.length, ownLook: [...new Set(ownLook)], disabled };
  }, REVIEWED_OWN_LOOK.source);
  if (scan.count === 0) rec.record(name, "L5", "buttons use the shared classes", "n/a", "no button on this page");
  else rec.record(name, "L5", "buttons use the shared classes", scan.ownLook.length === 0 ? "pass" : "fail", scan.ownLook.length === 0 ? `${scan.count} button(s), none styled by a module class alone` : `styled by a module class alone: ${scan.ownLook.slice(0, 3).join("; ")}`,
    // The module's build hash is dropped, so the same class is the same offender in every build.
    [...new Set(scan.ownLook.map((entry: string) => `button.${entry.replace(/ ".*$/, "").replace(/__[A-Za-z0-9_-]{6}__/, "__")}`))] as string[]);
  if (scan.disabled.length === 0) rec.record(name, "L5", "a disabled button shows the not-allowed cursor", "n/a", "no disabled button on this page");
  else {
    const bad = scan.disabled.filter((entry: { cursor: string }) => entry.cursor !== "not-allowed");
    rec.record(name, "L5", "a disabled button shows the not-allowed cursor", bad.length === 0 ? "pass" : "fail", bad.length === 0 ? `${scan.disabled.length} disabled button(s), all not-allowed` : `disabled ${bad.map((entry: { label: string; cursor: string }) => `"${entry.label}" has cursor ${entry.cursor}`).join("; ")}`, bad.map((entry: { label: string; cursor: string }) => `${entry.label}:${entry.cursor}`));
  }
  // Hover: a main or light button changes its look under the pointer.
  const target = page.locator("button.primary-button:visible:enabled, button.secondary-button:visible:enabled").first();
  if (await target.count()) {
    const paint = () => target.evaluate((node: HTMLElement) => { const style = getComputedStyle(node); return `${style.backgroundColor}|${style.boxShadow}|${style.color}|${style.borderTopColor}`; });
    // The pointer may still be where the last click was (over this very button): move it off before reading the resting look.
    await page.mouse.move(0, 0);
    await pollPage<boolean>(page, () => target.evaluate((node: Element) => !node.matches(":hover")), Boolean, 1_000);
    const resting = await pollPage<string>(page, paint, () => true, 100).then(async () => {
      // The look can still be easing back (a 120ms transition): read it again once it stops changing.
      let last = await paint();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const next = await paint();
        if (next === last) break;
        last = next;
      }
      return last;
    });
    await target.hover();
    // If something covers the button the pointer is not on it, and that says nothing about the button's look.
    const reached = await pollPage<boolean>(page, () => target.evaluate((node: Element) => node.matches(":hover")), Boolean, 1_000);
    const hovered = reached.ok ? await pollPage<string>(page, paint, (value) => value !== resting, 1_500) : { ok: false, value: null };
    await page.mouse.move(0, 0);
    if (!reached.ok) rec.record(name, "L5", "main and light buttons have a hover look", "n/a", "the pointer could not reach the first button (something covers it), so its hover look was not read");
    else rec.record(name, "L5", "main and light buttons have a hover look", hovered.ok ? "pass" : "fail", hovered.ok ? "the button changed its look under the pointer" : `the "${clean((await target.textContent()) ?? "")}" button (${(await target.getAttribute("class")) ?? ""}) looked the same under the pointer`);
  }
}

/** L6: tabs use the shared tabs component: a tablist, one selected tab, arrow keys move between tabs. */
export async function checkTabs(page: Page, rec: Recorder, name: string) {
  const list = page.locator('[role="tablist"]:visible').first();
  if (!(await list.count())) { rec.record(name, "L6", "tabs use the shared tablist with arrow keys", "n/a", "no tab list on this page"); return; }
  const tabs = list.locator('[role="tab"]');
  const count = await tabs.count();
  const selected = await list.locator('[role="tab"][aria-selected="true"]').count();
  const rover = await tabs.evaluateAll((nodes: HTMLElement[]) => nodes.map((node) => `${node.getAttribute("aria-selected")}:${node.tabIndex}`));
  const shape = count >= 2 && selected === 1 && rover.every((entry: string) => entry === "true:0" || entry === "false:-1");
  const first = tabs.nth(0);
  await first.focus();
  const startIndex = await tabs.evaluateAll((nodes: HTMLElement[]) => nodes.findIndex((node) => node === document.activeElement));
  await page.keyboard.press("ArrowRight");
  const moved = await pollPage<number>(page, () => tabs.evaluateAll((nodes: HTMLElement[]) => nodes.findIndex((node) => node === document.activeElement)), (index) => index === (startIndex + 1) % count, 1_500);
  await page.keyboard.press("ArrowLeft");
  rec.record(name, "L6", "tabs use the shared tablist with arrow keys", shape && moved.ok ? "pass" : "fail", shape ? (moved.ok ? `${count} tabs, one selected, ArrowRight moved focus to the next tab` : "ArrowRight did not move focus to the next tab") : `tab roles are off: ${JSON.stringify(rover)}`);
}
