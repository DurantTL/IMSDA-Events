/**
 * The System report's model (#1357): pure. A report is a list of signals, each one saying what was checked, when it
 * was checked and what it found. Nothing here reads the database, the environment or the clock; the providers in
 * `providers.ts` do the reading and this file only decides how a set of readings adds up.
 *
 * The rules the page keeps:
 * - A reading that could not be made is "unavailable". It is never counted as OK and never as zero.
 * - Problems come first: sections sort attention, then unavailable, then watch, then ok, each keeping its declared
 *   order within a group.
 * - The readiness checklist shows what people have ticked, but a tick is a record of what a person did, not a live
 *   reading, so it never counts toward the overall status.
 * - Counts, states and times only: a signal carries no secret, setting value, address or person's name.
 */

export type SignalState = "ok" | "watch" | "attention" | "unavailable" | "info";

export type SectionKey =
  | "release"
  | "database"
  | "jobs"
  | "email"
  | "payments"
  | "ledger"
  | "storage"
  | "imports"
  | "alerts"
  | "setup"
  | "public-site"
  | "checklist"
  | "registration"
  | "money"
  | "communications"
  | "notices";

export type Signal = {
  key: string;
  section: SectionKey;
  name: string;
  /** What was checked, in one sentence. */
  description: string;
  /** ISO time of the reading (a job's last success, or when the page read it), or `null` when there is none. */
  checkedAt: string | null;
  /** "Checked", "Last success", "Tried" and so on. */
  whenLabel: string;
  state: SignalState;
  /** The result in words: counts and states only. */
  resultText: string;
  /** The page where this is fixed, or `null` when there is none. */
  fixHref: string | null;
  /** The link text, or, with no link, the reason there is none ("Fixed on the server"). `null` shows a dash. */
  fixLabel: string | null;
  /** Counted toward the section and overall status. Defaults to true; the readiness checklist is `false`. */
  countsTowardOverall?: boolean;
  /** A short list under the result, such as the titles of open alerts. Titles of alert kinds only. */
  items?: string[];
  /** What to show in place of a time when there is none ("Never"). Defaults to "Not recorded". */
  noTimeLabel?: string;
  /** Replaces the section's status chip text when the section is not counted (for example "11 of 13 ticked"). */
  sectionLabel?: string;
};

export type SectionDefinition = {
  key: SectionKey;
  title: string;
  /** The page where the section as a whole is fixed. */
  fixHref: string | null;
  fixLabel: string | null;
};

/** The declared order of the sections. A new section is appended here and gets a provider in `providers.ts`. */
export const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { key: "release", title: "App version", fixHref: null, fixLabel: null },
  { key: "database", title: "Database", fixHref: "/admin/readiness", fixLabel: "Open readiness" },
  { key: "jobs", title: "Background jobs", fixHref: "/admin/readiness", fixLabel: "Open readiness" },
  { key: "email", title: "Email", fixHref: "/admin/email", fixLabel: "Open email settings" },
  { key: "payments", title: "Payments (Square)", fixHref: "/more/health", fixLabel: "Open operational health" },
  { key: "ledger", title: "Ledger and balances", fixHref: "/more/ledger-health", fixLabel: "Open ledger check" },
  { key: "storage", title: "Storage", fixHref: "/admin/email", fixLabel: "Open email settings" },
  { key: "imports", title: "Imports and capacity", fixHref: "/more/health", fixLabel: "Open operational health" },
  { key: "alerts", title: "Open alerts", fixHref: null, fixLabel: null },
  { key: "setup", title: "Security and setup", fixHref: "/admin/settings", fixLabel: "Platform settings" },
  { key: "public-site", title: "Public site", fixHref: "/admin/analytics", fixLabel: "Open analytics" },
  { key: "registration", title: "Registration and checkout", fixHref: "/people", fixLabel: "Open registrations" },
  { key: "money", title: "Refunds and payment follow-up", fixHref: "/finance", fixLabel: "Open finance" },
  { key: "communications", title: "Communications", fixHref: "/communications/scheduled", fixLabel: "Open scheduled email" },
  { key: "notices", title: "Payment and email notices", fixHref: null, fixLabel: null },
  // Declared last: it never counts, so it always sorts last, and an empty section declared after it would follow it.
  { key: "checklist", title: "Readiness checklist", fixHref: "/admin/readiness", fixLabel: "Open readiness" },
];

export type SignalMeta = Pick<Signal, "key" | "name" | "description" | "fixHref" | "fixLabel">;

export type ReportSection = SectionDefinition & {
  state: SignalState;
  /** False for a section whose signals never count toward the overall status. */
  counted: boolean;
  /** The text of the section's status chip. */
  stateLabel: string;
  signals: Signal[];
};

export type Tally = Record<SignalState, number>;

export type SystemReport = {
  /** ISO time the report was read. */
  generatedAt: string;
  overall: {
    state: SignalState;
    headline: string;
    /** Signals that need attention. */
    problems: number;
    tally: Tally;
    /** Counted readings that were tried (everything but the checklist). */
    readingsTried: number;
    couldNotRead: number;
  };
  sections: ReportSection[];
  releaseSha: string | null;
};

export const STATE_LABEL: Record<SignalState, string> = {
  ok: "OK",
  watch: "Check soon",
  attention: "Needs attention",
  unavailable: "Unavailable",
  info: "Count only",
};

/** Problems first: the sort key of a section or signal. Information sorts with OK. */
const STATE_RANK: Record<SignalState, number> = { attention: 0, unavailable: 1, watch: 2, ok: 3, info: 3 };

/** From worst to best. A section takes the worst state among the signals that count. */
const WORST_FIRST: readonly SignalState[] = ["attention", "unavailable", "watch", "ok", "info"];

export function emptyTally(): Tally {
  return { ok: 0, watch: 0, attention: 0, unavailable: 0, info: 0 };
}

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const longDateFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A reading's time in UTC, as the System home states it. A reading from an earlier day carries its date. */
export function reportTimeLabel(iso: string | null, now: Date): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const time = `${timeFormat.format(date)} UTC`;
  return dateFormat.format(date) === dateFormat.format(now) ? `${time} today` : `${dateFormat.format(date)}, ${time}`;
}

/** "Friday, October 30, 2026 at 10:42 AM UTC". */
export function reportReadLabel(now: Date): string {
  return `${longDateFormat.format(now)} at ${timeFormat.format(now)} UTC`;
}

/** A row for a reading that could not be made: "Tried <time>", state unavailable, never OK and never zero. */
export function unavailableSignal(meta: SignalMeta, section: SectionKey, triedAt: Date, reason = "This could not be read just now. It is not shown as healthy or as zero."): Signal {
  return {
    ...meta,
    section,
    checkedAt: triedAt.toISOString(),
    whenLabel: "Tried",
    state: "unavailable",
    resultText: reason,
  };
}

/** Counts toward the section and overall status unless the signal says otherwise. */
const counts = (signal: Signal) => signal.countsTowardOverall !== false;

function worstState(signals: readonly Signal[]): SignalState {
  const present = new Set(signals.map((signal) => signal.state));
  return WORST_FIRST.find((state) => present.has(state)) ?? "unavailable";
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function buildSection(definition: SectionDefinition, signals: Signal[]): ReportSection {
  const counted = signals.some(counts);
  const ordered = [...signals].sort((left, right) => STATE_RANK[left.state] - STATE_RANK[right.state]);
  // A section with no signals has nothing to show as healthy, so it reads as unavailable.
  const state = signals.length === 0 ? "unavailable" : worstState(counted ? signals.filter(counts) : signals);
  const stateLabel = !counted ? signals.find((signal) => signal.sectionLabel)?.sectionLabel ?? STATE_LABEL[state] : STATE_LABEL[state];
  return { ...definition, state, counted, stateLabel, signals: ordered };
}

/**
 * The report from every signal the providers returned. Sections sort problems first (attention, unavailable, watch,
 * then ok), keep their declared order within a group, and the readiness checklist always comes last because it never
 * counts. A declared section with no signals still appears, as unavailable.
 */
export function buildSystemReport(signals: readonly Signal[], now: Date, releaseSha: string | null = null): SystemReport {
  const sections = SECTION_DEFINITIONS.map((definition, index) => ({
    index,
    section: buildSection(definition, signals.filter((signal) => signal.section === definition.key)),
  }));
  sections.sort((left, right) => {
    const leftRank = left.section.counted ? STATE_RANK[left.section.state] : 99;
    const rightRank = right.section.counted ? STATE_RANK[right.section.state] : 99;
    return leftRank - rightRank || left.index - right.index;
  });

  const tally = emptyTally();
  for (const signal of signals.filter(counts)) tally[signal.state] += 1;
  const readingsTried = Object.values(tally).reduce((sum, value) => sum + value, 0);
  const state: SignalState = tally.attention > 0
    ? "attention"
    : tally.unavailable > 0 || readingsTried === 0
      ? "unavailable"
      : tally.watch > 0 ? "watch" : "ok";
  const headline = tally.attention > 0
    ? `${plural(tally.attention, "problem needs", "problems need")} attention`
    : state === "unavailable"
      ? readingsTried === 0 ? "Nothing could be read" : `${plural(tally.unavailable, "reading", "readings")} could not be read`
      : state === "watch"
        ? `${plural(tally.watch, "thing", "things")} to check soon`
        : "No problems found";

  return {
    generatedAt: now.toISOString(),
    overall: { state, headline, problems: tally.attention, tally, readingsTried, couldNotRead: tally.unavailable },
    sections: sections.map((entry) => entry.section),
    releaseSha,
  };
}
