import type { Signal } from "./model";

/**
 * The System report row for problems people sent from the Forms help popup (#1483). A count and a fixed word only: never a
 * report's text, email or details. Open reports are a "watch", not an "attention": they are people asking for help, not a
 * fault in the system, but they must not read as healthy while they wait.
 */
export function openProblemReportFields(input: { openCount: number; now: Date }): Pick<Signal, "key" | "state" | "resultText" | "checkedAt" | "whenLabel"> {
  const { openCount, now } = input;
  return {
    key: "open-problem-reports",
    state: openCount === 0 ? "ok" : "watch",
    checkedAt: now.toISOString(),
    whenLabel: "Checked",
    resultText: openCount === 0 ? "No problem reports are open." : `${openCount} problem ${openCount === 1 ? "report is" : "reports are"} open.`,
  };
}
