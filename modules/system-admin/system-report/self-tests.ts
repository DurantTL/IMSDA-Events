import { buildBadgeCsvRows } from "@/modules/checkin/badge-csv";
import type { RegistrationRecord } from "@/modules/registrations/repository";
import { parseIcsFeed, IcsParseError } from "@/modules/calendar/ics-import";
import { buildRosterExportTable } from "@/modules/club-rosters/export";
import type { RosterExportColumn } from "@/modules/club-rosters/export-columns";
import type { GuardianRecord } from "@/modules/club-rosters/guardians-domain";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";
import { projectSchedule, ScheduleProjectionError, type ScheduleEventFacts, type ScheduleRule } from "@/modules/communications/scheduled-email-domain";
import { reconcileEvent, type GroupSource } from "@/modules/attendance-reconciliation/domain";
import { buildInvoiceFigures } from "@/modules/invoices/domain";
import { splitSubmissionTotal } from "@/modules/ledger/domain";
import { quoteStay } from "@/modules/lodging/domain";
import { resolveMealPrice } from "@/modules/meals/domain";
import { toCsv } from "@/modules/reporting/csv";
import { SELF_TEST_FIXTURES, type FixtureCase, type SelfTestFixtureSet, type SelfTestKey } from "./self-test-fixtures";

/**
 * The built-in self-tests (#1381). Each one runs the REAL pure function on the fixed examples in
 * `self-test-fixtures.ts` and compares the answer with the known one written beside it. Nothing here reads the
 * database, the network or the clock, so a difference means the server's own runtime (time zone data, Intl, Node)
 * or the code gives a different answer than it did when the example was written. A result carries counts only.
 */

export type SelfTestResult = {
  key: SelfTestKey;
  /** Examples that gave the known answer. */
  passed: number;
  total: number;
  /** Examples that gave a different answer: a count, never the example. */
  differing: number;
};

export type SelfTestDefinition = SelfTestFixtureSet & {
  /** Runs the real function on one example's input and returns the answer in the shape the example writes down. */
  run: (input: never) => unknown;
};

/** Order-sensitive deep equality. Numbers compare with `Object.is`, so a stray -0 or NaN is a difference. */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** The answer when the function refuses on purpose (a rule it will not guess at). */
const REFUSED = { refused: true };

/** The input of one example, typed loosely: the fixtures are plain data. */
type Input = Record<string, unknown>;
const cast = <T>(value: unknown) => value as T;

const RUNNERS: Record<SelfTestKey, (input: Input) => unknown> = {
  "lodging-quote": (input) => quoteStay(cast<Parameters<typeof quoteStay>[0]>(input)),
  "meal-price": (input) => resolveMealPrice(cast<Parameters<typeof resolveMealPrice>[0]>(input)),
  "invoice-figures": (input) => {
    const reconciled = reconcileEvent([cast<GroupSource | null>(input.group)].filter((group): group is GroupSource => group !== null), "PER_CHURCH");
    const group = reconciled.groups[0] ?? null;
    const build = () => buildInvoiceFigures({
      event: { id: "event-1", name: "Spring Camporee 2027" },
      groupKey: "church-one",
      groupTitle: "Church One",
      invoiceGrouping: "PER_CHURCH",
      party: { kind: "ORGANIZATION", id: "church-1", name: "Church One" },
      clubId: null,
      reconciliation: { versionId: "recon-1", versionNumber: 1, ruleVersion: reconciled.ruleVersion },
      group,
    });
    const figures = build();
    return {
      groupTitle: figures.groupTitle,
      organizationName: figures.organizationName,
      registeredCount: figures.registeredCount,
      billableCount: figures.billableCount,
      amountDueCents: figures.amountDueCents,
      lineAmountsCents: figures.snapshot.lines.map((line) => line.amountCents),
      fingerprintLength: figures.amountsFingerprint.length,
      fingerprintRepeats: figures.amountsFingerprint === build().amountsFingerprint,
    };
  },
  "ledger-split": (input) => splitSubmissionTotal(cast<Parameters<typeof splitSubmissionTotal>[0]>(input)),
  "badge-csv": (input) => buildBadgeCsvRows(cast<RegistrationRecord[]>(input.registrations), cast<string | null>(input.positionField), cast<boolean>(input.showAttendeeType)),
  "roster-export": (input) => {
    const table = buildRosterExportTable(
      cast<RosterMemberRecord[]>(input.members),
      cast<RosterExportColumn[]>(input.columns),
      cast<Record<string, string> | null>(input.birthDates),
      cast<Record<string, GuardianRecord[]> | null>(input.guardians),
    );
    return { ...table, csv: toCsv([table.headers, ...table.rows]) };
  },
  "ics-parsing": (input) => {
    try {
      const feed = parseIcsFeed(cast<string>(input.text));
      return {
        warnings: feed.warnings.length,
        entries: feed.entries.map((entry) => ({ uid: entry.uid, title: entry.title, startsOn: entry.startsOn, endsOn: entry.endsOn, timeLabel: entry.timeLabel, status: entry.status, repeatRule: entry.repeatRule })),
      };
    } catch (error) {
      if (error instanceof IcsParseError) return REFUSED;
      throw error;
    }
  },
  "scheduled-email": (input) => {
    const event = cast<{ timezone: string; startsAt: string; registrationClosesOn: string | null; paymentDueOn: string | null }>(input.event);
    const facts: ScheduleEventFacts = { ...event, startsAt: new Date(event.startsAt) };
    try {
      const projection = projectSchedule(cast<ScheduleRule>(input.rule), facts);
      return {
        sendAt: projection.sendAt.toISOString(),
        anchorAt: projection.anchorAt ? projection.anchorAt.toISOString() : null,
        localDate: projection.localDate,
        localTime: projection.localTime,
        dstBehavior: projection.dstBehavior,
        sendAtLabel: projection.sendAtLabel,
      };
    } catch (error) {
      if (error instanceof ScheduleProjectionError) return REFUSED;
      throw error;
    }
  },
};

/** Runs the real function on one example. Shared with the unit tests so they exercise the same adapter. */
export function runFixtureCase(key: SelfTestKey, fixtureCase: FixtureCase): unknown {
  return RUNNERS[key](fixtureCase.input as Input);
}

export const SELF_TEST_DEFINITIONS: readonly SelfTestDefinition[] = SELF_TEST_FIXTURES.map((set) => ({
  ...set,
  run: RUNNERS[set.key] as SelfTestDefinition["run"],
}));

/** Runs every example of one self-test. A function that throws is not a difference: the throw reaches the caller. */
export function runSelfTest(definition: SelfTestDefinition): SelfTestResult {
  let differing = 0;
  for (const fixtureCase of definition.cases) {
    const answer = (definition.run as (input: unknown) => unknown)(fixtureCase.input);
    if (!deepEqual(answer, fixtureCase.expected)) differing += 1;
  }
  return { key: definition.key, passed: definition.cases.length - differing, total: definition.cases.length, differing };
}
