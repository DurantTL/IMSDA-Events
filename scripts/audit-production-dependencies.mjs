/**
 * Weekly dependency check (#1776): fails when `npm audit --omit=dev` reports a high or critical advisory that is not
 * listed in `.github/dependency-audit-exceptions.json`. Each exception names one advisory and says why it is accepted,
 * so a new advisory always fails the job. An exception that no longer matches anything is reported so it can be removed.
 *
 *   npm run audit:production
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SEVERITIES = new Set(["high", "critical"]);

/** The high and critical advisories in an `npm audit --json` report, one entry per advisory id. */
export function seriousAdvisories(report) {
  const found = new Map();
  for (const entry of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null || !SEVERITIES.has(via.severity)) continue;
      const id = String(via.url ?? "").split("/").pop() || String(via.source ?? via.title);
      if (!found.has(id)) found.set(id, { id, package: via.name ?? entry.name, severity: via.severity, title: via.title ?? "", url: via.url ?? "" });
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Splits advisories into those to fail on and those accepted, and lists exceptions that match nothing. */
export function applyExceptions(advisories, exceptions) {
  const accepted = new Set(exceptions.map((exception) => exception.id));
  const present = new Set(advisories.map((advisory) => advisory.id));
  return {
    failing: advisories.filter((advisory) => !accepted.has(advisory.id)),
    excepted: advisories.filter((advisory) => accepted.has(advisory.id)),
    unused: exceptions.filter((exception) => !present.has(exception.id)),
  };
}

function main() {
  const { exceptions } = JSON.parse(readFileSync(new URL("../.github/dependency-audit-exceptions.json", import.meta.url), "utf8"));
  const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error("npm audit did not return a report.");
    console.error(run.stderr || run.stdout);
    process.exit(2);
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? report.error.code ?? "unknown error"}`);
    process.exit(2);
  }
  const { failing, excepted, unused } = applyExceptions(seriousAdvisories(report), exceptions);
  for (const advisory of excepted) console.log(`accepted  ${advisory.id}  ${advisory.package} (${advisory.severity})`);
  for (const exception of unused) console.log(`unused exception  ${exception.id}: remove it from .github/dependency-audit-exceptions.json`);
  if (failing.length === 0) {
    console.log("No new high or critical advisory in the packages the app runs with.");
    return;
  }
  for (const advisory of failing) console.error(`NEW  ${advisory.id}  ${advisory.package} (${advisory.severity})  ${advisory.title}  ${advisory.url}`);
  console.error(`${failing.length} high or critical ${failing.length === 1 ? "advisory needs" : "advisories need"} attention.`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
