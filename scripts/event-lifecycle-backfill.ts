/**
 * Dry run (default) or apply of the Event.lifecycleState backfill (#156). Prints each event's id and slug, its
 * current fields and the state it maps to, plus counts; no names and no attendee data. `--apply` writes the
 * state only where it is null and writes no history rows. Applying in production is a human step.
 *
 *   npm run lifecycle:backfill                # dry run
 *   npm run lifecycle:backfill -- --apply     # write
 */
import { loadEnvConfig } from "@next/env";
import { backfillEventLifecycle } from "@/modules/events/lifecycle-backfill";

loadEnvConfig(process.cwd());

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const report = await backfillEventLifecycle(apply);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(
    report.dryRun
      ? `Dry run: ${report.needsWrite} of ${report.totalEvents} event(s) would be given a state. Nothing was written.\n`
      : `Applied: ${report.updatedCount} event(s) given a state; ${report.totalEvents - report.updatedCount} left as they were.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
