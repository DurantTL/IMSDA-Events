import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFERENCE_TIME_ZONE,
  conferenceDateFormat,
  formatInConferenceTime,
  formatInTimeZone,
  shortZoneName,
  timeZoneLongName,
} from "@/modules/calendar/conference-format";
import { formatCountdownTarget } from "@/modules/events/content-countdown";

// Behavior 8 / rule 13 (#1454): a time shown to a person is in Central time and says so.

afterEach(() => vi.useRealTimers());

// Either side of both 2026 US daylight-saving changes, plus a plain winter and summer instant.
const CST_MORNING = "2026-01-15T15:30:00Z"; // 9:30 AM CST
const CDT_AFTERNOON = "2026-07-04T20:30:00Z"; // 3:30 PM CDT
const BEFORE_SPRING_FORWARD = "2026-03-08T07:59:00Z"; // 1:59 AM CST
const AFTER_SPRING_FORWARD = "2026-03-08T08:00:00Z"; // 3:00 AM CDT
const LAST_CDT_HOUR = "2026-11-01T06:59:00Z"; // 1:59 AM CDT
const FIRST_CST_HOUR = "2026-11-01T07:00:00Z"; // 1:00 AM CST (the repeated hour, second pass)

describe("formatInConferenceTime labels every time of day", () => {
  it("adds the short zone name to field options", () => {
    const options = { hour: "numeric", minute: "2-digit" } as const;
    expect(formatInConferenceTime(CST_MORNING, options)).toBe("9:30 AM CST");
    expect(formatInConferenceTime(CDT_AFTERNOON, options)).toBe("3:30 PM CDT");
    expect(formatInConferenceTime(BEFORE_SPRING_FORWARD, options)).toBe("1:59 AM CST");
    expect(formatInConferenceTime(AFTER_SPRING_FORWARD, options)).toBe("3:00 AM CDT");
    expect(formatInConferenceTime(LAST_CDT_HOUR, options)).toBe("1:59 AM CDT");
    expect(formatInConferenceTime(FIRST_CST_HOUR, options)).toBe("1:00 AM CST");
  });

  it("labels date and time field options", () => {
    expect(formatInConferenceTime(CDT_AFTERNOON, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))
      .toBe("Jul 4, 2026, 3:30 PM CDT");
  });

  it("appends the zone for timeStyle, which Intl will not combine with timeZoneName", () => {
    expect(formatInConferenceTime(CDT_AFTERNOON, { dateStyle: "medium", timeStyle: "short" })).toBe("Jul 4, 2026, 3:30 PM CDT");
    expect(formatInConferenceTime(CST_MORNING, { timeStyle: "short" })).toBe("9:30 AM CST");
    expect(formatInConferenceTime(CST_MORNING, { dateStyle: "full", timeStyle: "short" })).toBe("Thursday, January 15, 2026 at 9:30 AM CST");
  });

  it("does not repeat a zone that timeStyle long or full already prints", () => {
    expect(formatInConferenceTime(CDT_AFTERNOON, { timeStyle: "long" })).toMatch(/^3:30:00 PM CDT$/);
    expect(formatInConferenceTime(CDT_AFTERNOON, { timeStyle: "full" })).toBe("3:30:00 PM Central Daylight Time");
  });

  it("leaves a zone name the caller asked for alone", () => {
    expect(formatInConferenceTime(CST_MORNING, { hour: "numeric", minute: "2-digit", timeZoneName: "long" })).toBe("9:30 AM Central Standard Time");
  });

  it("lets a caller that labels a range once opt out", () => {
    const clock = (value: string) => formatInConferenceTime(value, { hour: "numeric", minute: "2-digit", zoneLabel: false });
    expect(clock(CST_MORNING)).toBe("9:30 AM");
    expect(`${clock("2026-01-16T22:00:00Z")} – ${clock("2026-01-17T18:00:00Z")} ${shortZoneName(CST_MORNING)}`).toBe("4:00 PM – 12:00 PM CST");
  });

  it("leaves date-only options unlabeled and unchanged", () => {
    const options = { month: "short", day: "numeric", year: "numeric" } as const;
    expect(formatInConferenceTime(CDT_AFTERNOON, options)).toBe("Jul 4, 2026");
    expect(formatInConferenceTime(CDT_AFTERNOON, { dateStyle: "medium" })).toBe("Jul 4, 2026");
    expect(formatInConferenceTime(CDT_AFTERNOON)).toBe("7/4/2026");
    expect(formatInConferenceTime(CDT_AFTERNOON, { weekday: "long" })).toBe("Saturday");
    // The date a late-evening Central instant falls on is Central's, not UTC's.
    expect(formatInConferenceTime("2026-01-01T05:59:00Z", options)).toBe("Dec 31, 2025");
  });

  it("accepts a Date, an ISO string and a number, and prints Invalid Date instead of throwing", () => {
    const options = { hour: "numeric", minute: "2-digit" } as const;
    expect(formatInConferenceTime(new Date(CDT_AFTERNOON), options)).toBe("3:30 PM CDT");
    expect(formatInConferenceTime(new Date(CDT_AFTERNOON).getTime(), options)).toBe("3:30 PM CDT");
    expect(formatInConferenceTime("not a date", options)).toBe("Invalid Date");
  });

  it("is the same zone the rest of the app calls the conference zone", () => {
    expect(CONFERENCE_TIME_ZONE).toBe("America/Chicago");
    expect(formatInTimeZone(CDT_AFTERNOON, CONFERENCE_TIME_ZONE, { hour: "numeric", minute: "2-digit" })).toBe("3:30 PM CDT");
    expect(conferenceDateFormat({ hour: "numeric", minute: "2-digit" }).format(new Date(CDT_AFTERNOON))).toBe("3:30 PM");
  });
});

describe("formatInTimeZone labels the event's own zone", () => {
  it("labels a non-Chicago zone with that zone's name", () => {
    const options = { hour: "numeric", minute: "2-digit" } as const;
    expect(formatInTimeZone(CDT_AFTERNOON, "America/Denver", options)).toBe("2:30 PM MDT");
    expect(formatInTimeZone(CST_MORNING, "America/Denver", options)).toBe("8:30 AM MST");
    expect(formatInTimeZone(CDT_AFTERNOON, "UTC", { dateStyle: "medium", timeStyle: "short" })).toBe("Jul 4, 2026, 8:30 PM UTC");
  });

  it("keeps date-only options unlabeled", () => {
    expect(formatInTimeZone(CDT_AFTERNOON, "America/Denver", { month: "short", day: "numeric" })).toBe("Jul 4");
  });

  it("labels the countdown target with the event's zone, matching the page header", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    expect(formatCountdownTarget(new Date("2027-03-05T15:00:00Z"), "America/Chicago")).toBe("Friday, March 5, 2027 at 9:00 AM CST");
    expect(formatCountdownTarget(new Date("2027-03-05T15:00:00Z"), "America/Denver")).toBe("Friday, March 5, 2027 at 8:00 AM MST");
  });
});

describe("zone names for copy", () => {
  it("gives the long form without the IANA name", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const instant of ["2026-01-15T12:00:00Z", "2026-07-04T12:00:00Z"]) {
      vi.setSystemTime(new Date(instant));
      expect(timeZoneLongName()).toBe("Central Time");
      expect(timeZoneLongName("America/Denver")).toBe("Mountain Time");
    }
  });

  it("gives the short form for the instant asked about", () => {
    expect(shortZoneName(CST_MORNING)).toBe("CST");
    expect(shortZoneName(CDT_AFTERNOON)).toBe("CDT");
    expect(shortZoneName("nope")).toBe("");
  });
});

/* ------------------------------ source scan ------------------------------ */

const roots = ["app", "components", "modules", "lib"];
const sharedFile = "modules/calendar/conference-format.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full.split(path.sep).join("/")] : [];
  });
}

/** The text between the parentheses that open at `open`, or null when they never close. */
function callArguments(source: string, open: number) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

const timeFields = /\b(hour|minute|second|dayPeriod|fractionalSecondDigits|timeStyle)\b/;
const dateFields = /\b(dateStyle|timeZone|month|day|year|weekday|era)\b/;

type Finding = { file: string; line: number; rule: string; text: string };

function scan(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  const add = (index: number, rule: string) => findings.push({ file, line: lineOf(index), rule, text: source.slice(index, index + 80).split("\n")[0] ?? "" });

  for (const match of source.matchAll(/toLocaleTimeString\(/g)) add(match.index!, "toLocaleTimeString");

  for (const match of source.matchAll(/toLocaleString\(/g)) {
    const args = (callArguments(source, match.index! + match[0].length - 1) ?? "").trim();
    const before = source.slice(Math.max(0, match.index! - 60), match.index!);
    const numeric = /^"en-US"(\s*,\s*\{[^}]*\})?$/.test(args) && !timeFields.test(args) && !dateFields.test(args);
    const onDate = /new Date\([^;]*\)\s*\.$/.test(before) || /\bDate\.now\(\)\s*\.$/.test(before);
    if (!numeric || onDate) add(match.index!, "toLocaleString");
  }

  for (const match of source.matchAll(/toLocaleDateString\(/g)) {
    const args = callArguments(source, match.index! + match[0].length - 1) ?? "";
    if (timeFields.test(args)) add(match.index!, "toLocaleDateString with a time field");
  }

  for (const match of source.matchAll(/new Intl\.DateTimeFormat\(/g)) {
    const args = callArguments(source, match.index! + match[0].length - 1) ?? "";
    // A formatter that already prints the zone name is labeled; one that shows a time and does not is not.
    if (timeFields.test(args) && !/\btimeZoneName\b/.test(args)) add(match.index!, "Intl.DateTimeFormat with a time and no zone name");
  }

  source.split("\n").forEach((text, index) => {
    // en-CA is the sortable YYYY-MM-DD key, not display.
    if (text.includes('timeZone: "America/Chicago"') && !text.includes('"en-CA"')) {
      findings.push({ file, line: index + 1, rule: 'timeZone: "America/Chicago" literal', text: text.trim().slice(0, 80) });
    }
  });
  return findings;
}

/**
 * Files that may keep a flagged pattern, each with the reason. Keep this as small as possible.
 *
 * Machine helpers read the clock parts of an instant to do date arithmetic; they never print a time.
 */
const allowed: Record<string, string> = {
  "modules/communications/scheduled-email-domain.ts": "zoneFormatter reads wall-clock parts (hourCycle h23) to project a send time; never shown",
  "modules/cancellation-policy/event-time.ts": "zonedParts reads wall-clock parts for cancellation-window arithmetic; never shown",
  "modules/event-locations/waitlist-digest-domain.ts": "zonedParts reads wall-clock parts to find the digest send instant; never shown",
  "modules/events/content-countdown.ts": "wallClockFormatter reads wall-clock parts for the countdown target; never shown",
  "modules/events/event-times.ts": "localClockTime returns a machine HH:MM for time inputs, not a display string",
  "modules/meals/scanner-import.ts": "zoneParts reads wall-clock parts to find the event-local date; never shown",
  "modules/calendar/ics-import.ts": "reads wall-clock parts of an imported ICS instant; never shown",
};

/**
 * Files owned by the open builds #1445 and #1435 that still have a time break. This build must not edit them, so they
 * wait for a follow-up once those merge; delete each entry as its file is converted (the test below insists).
 */
const PENDING = "pending #1445/#1435 merge; follow-up";
const pendingOtherBuilds: Record<string, string> = {
  "app/(workspace)/check-in/passes/page.tsx": PENDING,
  "app/(workspace)/more/health/page.tsx": PENDING,
  "components/asset-issue-desk.tsx": PENDING,
  "components/attendee-community-board.tsx": PENDING,
  "components/cancellation-policy-workspace.tsx": PENDING,
  "components/cancellation-requests-workspace.tsx": PENDING,
  "components/check-in-workspace.tsx": PENDING,
  "components/communications-workspace.tsx": PENDING,
  "components/duplicate-match-review-workspace.tsx": PENDING,
  "components/finance-workspace.tsx": PENDING,
  "components/import-workspace.tsx": PENDING,
  "components/lodging-assignments-panels.tsx": PENDING,
  "components/platform-settings-workspace.tsx": PENDING,
  "components/public-lodging-assignment.tsx": PENDING,
  "components/registration-meals-history.tsx": PENDING,
  "components/registration-notes-tags-panel.tsx": PENDING,
  "components/square-payment-matching.tsx": PENDING,
  "modules/system-admin/system-report/model.ts": PENDING,
};

describe("no unlabeled time formatting outside the shared formatter (#1454)", () => {
  const files = roots.flatMap((root) => sourceFiles(root)).filter((file) => file !== sharedFile);

  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("finds nothing outside the allowlists", () => {
    const skip = new Set([...Object.keys(allowed), ...Object.keys(pendingOtherBuilds)]);
    const findings = files.filter((file) => !skip.has(file)).flatMap((file) => scan(file, readFileSync(file, "utf8")));
    expect(findings.map((finding) => `${finding.file}:${finding.line} ${finding.rule}: ${finding.text}`)).toEqual([]);
  });

  it("keeps every allowlist entry honest: the file exists and still has something flagged", () => {
    for (const file of [...Object.keys(allowed), ...Object.keys(pendingOtherBuilds)]) {
      expect(files, `${file} is no longer scanned`).toContain(file);
      expect(scan(file, readFileSync(file, "utf8")).length, `${file} no longer needs its allowlist entry`).toBeGreaterThan(0);
    }
  });

  it("flags the patterns it is meant to catch", () => {
    const sample = [
      'const a = date.toLocaleTimeString([], { hour: "numeric" });',
      "const b = new Date(x).toLocaleString();",
      'const c = new Date(x).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });',
      'const d = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone }).format(x);',
      'const e = x.toLocaleDateString("en-US", { hour: "numeric" });',
      'const f = y.toLocaleString("en-US", { timeZone: "America/Chicago" });',
    ].join("\n");
    expect(scan("sample.ts", sample).map((finding) => finding.line)).toEqual([1, 2, 3, 6, 5, 4, 6]);
    const fine = [
      'const a = count.toLocaleString("en-US");',
      'const b = percent.toLocaleString("en-US", { maximumFractionDigits: 1 });',
      'const c = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });',
      'const d = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone, timeZoneName: "short" });',
      'const e = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric" });',
    ].join("\n");
    expect(scan("sample.ts", fine)).toEqual([]);
  });
});
