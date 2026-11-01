import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for #1431: a search box must not come back requiring Enter. Every search input under app/ and
 * components/ (type="search", name="q", or the input inside a `search-field` box) must live in a file that uses the
 * shared module `@/components/search-as-you-type`, or be on the reviewed allowlist below, each with a reason and the
 * exact number of boxes allowed, so a NEW box in an allowlisted file still fails.
 */
const root = path.resolve(__dirname, "..");
const SHARED = "components/search-as-you-type.tsx";

function walk(dir: string, found: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (full.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/** The end of a JSX tag that starts at `start`, skipping braces and quotes. */
function tagEnd(source: string, start: number) {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return index;
  }
  return source.length - 1;
}

/** Positions of the search inputs of a file. */
export function searchInputs(source: string) {
  const tags: Array<{ pos: number; text: string }> = [];
  for (const match of source.matchAll(/<input\b/g)) {
    tags.push({ pos: match.index!, text: source.slice(match.index!, tagEnd(source, match.index!) + 1) });
  }
  const visible = (text: string) => !/type="hidden"/.test(text);
  const hits = new Set<number>();
  for (const tag of tags) {
    if (visible(tag.text) && (/type="search"/.test(tag.text) || /\bname="q"/.test(tag.text))) hits.add(tag.pos);
  }
  for (const box of source.matchAll(/className=(?:"[^"]*|\{`[^`]*)\bsearch-field\b/g)) {
    const input = tags.find((tag) => tag.pos > box.index! && tag.pos - box.index! < 1500 && visible(tag.text));
    if (input) hits.add(input.pos);
  }
  return [...hits];
}

/**
 * Whether the search input at `pos` really searches as you type: its own tag uses the shared debounced callback
 * (`.schedule(` or `inputProps`), or it sits inside a `<SearchAsYouTypeForm>` or a `<form>` spreading `formProps`.
 * Importing the module is not enough: a second, Enter-only form in the same file must fail.
 */
export function isLive(source: string, pos: number) {
  const tag = source.slice(pos, tagEnd(source, pos) + 1);
  if (/\.schedule\(|inputProps|useDebouncedSearch|\{\.\.\.formProps\}/.test(tag)) return true;
  const before = source.slice(0, pos);
  const openAt = (open: RegExp, close: string, accept: (text: string) => boolean) => {
    let found = -1;
    for (const match of before.matchAll(open)) {
      const closedAfter = before.indexOf(close, match.index!) !== -1;
      if (!closedAfter && accept(source.slice(match.index!, tagEnd(source, match.index!) + 1))) found = match.index!;
    }
    return found !== -1;
  };
  return openAt(/<SearchAsYouTypeForm\b/g, "</SearchAsYouTypeForm>", () => true)
    || openAt(/<form\b/g, "</form>", (text) => /\{\.\.\.formProps\}/.test(text));
}

const usesShared = (source: string) => /from "@\/components\/search-as-you-type"/.test(source);

type Allowed = { file: string; count: number; reason: string };

/** Pickers and comboboxes: they filter their own option list on every keystroke. */
const pickers = [
  "components/searchable-select.tsx|2",
  "components/destination-search.tsx|1",
  "components/honor-combobox.tsx|1",
  "components/honor-multi-select.tsx|1",
  "components/more-launcher.tsx|1",
  "components/more-task-search.tsx|1",
  "components/registration-builder/builder-palette.tsx|1",
].map((entry): Allowed => {
  const [file, count] = entry.split("|");
  return { file: file!, count: Number(count), reason: "picker: filters its own options on every keystroke" };
});

/** A field component the page renders inside `SearchAsYouTypeForm`, which does the searching. */
const wrapped: Allowed[] = [
  { file: "app/(public)/events/events-search-field.tsx", count: 1, reason: "wrapped: rendered inside SearchAsYouTypeForm by app/(public)/events/page.tsx" },
];

const allowlist: Allowed[] = [...pickers, ...wrapped];

describe("search boxes search as you type (#1431)", () => {
  const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "components"))]
    .map((full) => ({ file: path.relative(root, full).split(path.sep).join("/"), full }));

  it("every search input uses the shared module or is on the reviewed allowlist", () => {
    const problems: string[] = [];
    for (const { file, full } of files) {
      if (file === SHARED) continue;
      const source = fs.readFileSync(full, "utf8");
      const count = searchInputs(source).length;
      if (count === 0) continue;
      const allowed = allowlist.find((entry) => entry.file === file);
      if (allowed) {
        if (count !== allowed.count) problems.push(`${file}: ${count} search input(s), the allowlist reviewed ${allowed.count}. Use the shared hook for the new one.`);
        continue;
      }
      if (!usesShared(source)) problems.push(`${file}: ${count} search input(s) without components/search-as-you-type`);
      else {
        const dead = searchInputs(source).filter((pos) => !isLive(source, pos));
        if (dead.length > 0) problems.push(`${file}: ${dead.length} of ${count} search input(s) not inside SearchAsYouTypeForm / a formProps form and not using the shared debounce`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the allowlist is precise: every entry names a real file with a reason and still has that many boxes", () => {
    for (const entry of allowlist) {
      expect(entry.reason.length).toBeGreaterThan(10);
      const full = path.join(root, entry.file);
      expect(fs.existsSync(full), `${entry.file} exists`).toBe(true);
      const source = fs.readFileSync(full, "utf8");
      expect(searchInputs(source).length, `${entry.file} box count`).toBe(entry.count);
      expect(usesShared(source), `${entry.file} is allowlisted yet already uses the shared module; remove it`).toBe(false);
    }
    expect(new Set(allowlist.map((entry) => entry.file)).size).toBe(allowlist.length);
  });

  it("finds the boxes it should (the scanner itself)", () => {
    expect(searchInputs('<input type="search" name="q" />')).toHaveLength(1);
    expect(searchInputs('<input type="hidden" name="q" value="x" />')).toHaveLength(0);
    expect(searchInputs('<label className="search-field"><X /><input value={q}\n onChange={() => 1} /></label>')).toHaveLength(1);
    expect(searchInputs('<input name="email" type="email" />')).toHaveLength(0);
  });

  it("the liveness check tells a shared form from an Enter-only one", () => {
    const live = '<SearchAsYouTypeForm action="/a"><input name="q" type="search" /></SearchAsYouTypeForm>';
    const enterOnly = '<form method="get" action="/a"><input name="q" type="search" /></form>';
    const hook = '<form {...formProps} action="/a"><input name="q" type="search" /></form>';
    const fetchBox = '<form onSubmit={x}><input type="search" onChange={() => { go(); soon.schedule(); }} /></form>';
    const pos = (source: string) => searchInputs(source)[0]!;
    expect(isLive(live, pos(live))).toBe(true);
    expect(isLive(hook, pos(hook))).toBe(true);
    expect(isLive(fetchBox, pos(fetchBox))).toBe(true);
    expect(isLive(enterOnly, pos(enterOnly))).toBe(false);
    // A live form that closed earlier does not cover a later Enter-only one.
    const both = live + enterOnly;
    expect(isLive(both, searchInputs(both)[1]!)).toBe(false);
  });

  it("the wrapped events field really sits inside the shared form", () => {
    const page = fs.readFileSync(path.join(root, "app/(public)/events/page.tsx"), "utf8");
    expect(page).toMatch(/<SearchAsYouTypeForm[^>]*action="\/events"[\s\S]*<EventsSearchField[\s\S]*<\/SearchAsYouTypeForm>/);
  });

  it("converted boxes are not on the allowlist", () => {
    for (const file of [
      "app/(workspace)/admin/clubs/page.tsx",
      "app/(workspace)/admin/clubs/summary/page.tsx",
      "app/(workspace)/admin/forms/page.tsx",
      "app/(workspace)/people/attendees/page.tsx",
      "components/staff-monthly-records.tsx",
      "components/people-quick-filters.tsx",
      "components/operations-search-bar.tsx",
      "components/background-check-review-panel.tsx",
      "components/organization-search-controls.tsx",
      "components/area-club-search-form.tsx",
      "components/attendee-community-board.tsx",
      "app/(public)/events/page.tsx",
      "components/calendar-admin-workspace.tsx",
      "components/club-earned-awards-workspace.tsx",
      "components/club-honors-workspace.tsx",
      "components/club-order-workspace.tsx",
      "components/club-roster-workspace.tsx",
      "components/club-supply-catalog-workspace.tsx",
      "components/club-supply-stock-workspace.tsx",
      "components/honor-catalog-workspace.tsx",
      "components/honor-watch-panel.tsx",
      "components/lodging-assignments-workspace.tsx",
      "components/public-club-directory.tsx",
      "components/registration-form-notifications-panel.tsx",
      "components/staff-workspace.tsx",
      "components/finance-workspace.tsx",
      "components/check-in-workspace.tsx",
      "components/staff-invitation-list.tsx",
      "components/square-payment-matching.tsx",
      "components/people-workspace.tsx",
      "app/(workspace)/help/help-search.tsx",
    ]) {
      expect(allowlist.some((entry) => entry.file === file)).toBe(false);
      expect(usesShared(fs.readFileSync(path.join(root, file), "utf8")), file).toBe(true);
    }
  });
});

/**
 * The empty-search rule (#1347, #1348): an empty search lists everything, so a converted server page must never stop
 * early when the search text is empty. tests/empty-server-search-1348.test.ts covers the pickers; this covers the
 * pages that now search as you type.
 */
describe("converted server searches still list everything when empty (#1347, #1348)", () => {
  const pages = [
    "app/(workspace)/admin/clubs/page.tsx",
    "app/(workspace)/admin/clubs/summary/page.tsx",
    "app/(workspace)/admin/forms/page.tsx",
    "app/(workspace)/people/attendees/page.tsx",
    "components/operations-search-bar.tsx",
    "components/people-quick-filters.tsx",
    "components/background-check-review-panel.tsx",
  ];
  it.each(pages)("%s has no early return on an empty search", (file) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    expect(source).not.toMatch(/if\s*\(\s*!\s*(?:q|query|text|search|lookupName|params\.q|filters\.q)(?:\.trim\(\))?\s*\)\s*(?:return|\{\s*return)/);
  });
});
