/**
 * Finds message files (attachments and pictures staff uploaded for email) that nothing refers to any more, and,
 * only when told to, removes them (#845).
 *
 *   npm run message-files:sweep                      dry run: prints what would be deleted, deletes nothing
 *   npm run message-files:sweep -- --apply           deletes them (rows first, then the bytes)
 *   npm run message-files:sweep -- --grace-hours=96  only files older than this (never under 24 hours)
 *   npm run message-files:sweep -- --show-names      also print each file's name (hidden by default: names can be personal)
 *
 * A file is only ever removed when it is older than the grace period and nothing refers to it: no template version
 * (any status), announcement or message links it, and no body names it. The report lists ids, events, sizes and times (names only with
 * --show-names); never a storage path or a hash. See docs/DEPLOY-DOCKER.md, "Message files".
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function parseArgs(argv: string[]) {
  let apply = false;
  let showNames = false;
  let graceHours: number | undefined;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--show-names") showNames = true;
    else if (arg.startsWith("--grace-hours=")) {
      const value = Number(arg.slice("--grace-hours=".length));
      if (!Number.isInteger(value) || value < 0) throw new Error("--grace-hours must be a whole number of hours.");
      graceHours = value;
    } else throw new Error(`Unknown option ${arg.split("=")[0]}. Use --apply, --show-names or --grace-hours=N.`);
  }
  return { apply, graceHours, showNames };
}

function mb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const { apply, graceHours, showNames } = parseArgs(process.argv.slice(2));
  const { sweepMessageFiles } = await import("@/modules/communications/message-file-sweep");
  const report = await sweepMessageFiles({ mode: apply ? "apply" : "dry-run", graceHours });
  console.log(apply ? "Message file sweep: APPLY (deleting)." : "Message file sweep: DRY RUN (nothing is deleted; add --apply to delete).");
  console.log(`Grace period: ${report.graceHours} hours (files older than ${report.cutoff}).`);
  console.log(`Candidates: ${report.candidates.count} file(s), ${mb(report.candidates.bytes)}.`);
  for (const event of report.candidates.byEvent) {
    console.log(`  event ${event.eventId}: ${event.count} file(s), ${mb(event.bytes)}`);
  }
  if (!apply) {
    for (const file of report.wouldDelete) {
      console.log(`  would delete ${file.id} (event ${file.eventId}, ${file.sizeBytes} bytes, uploaded ${file.createdAt}${showNames ? `, name ${file.filename}` : ""})`);
    }
    console.log(`Cleanup records waiting to retry (removed files whose bytes are still on disk): ${report.cleanup.pending}.`);
    console.log(`Expired upload reservations (interrupted uploads): ${report.reservations.expired}.`);
    if (report.cleanup.pending > 0 || report.reservations.expired > 0) {
      console.log("These are only cleared by an apply run, and until then they keep counting against their event's quota. Run with --apply to clear them.");
    }
  } else {
    console.log(`Deleted: ${report.deleted.count} file(s), ${mb(report.deleted.bytes)}; kept at the final check: ${report.keptAtRecheck}.`);
    console.log(`Removed from disk: ${report.bytesRemoved.count} file(s), ${mb(report.bytesRemoved.bytes)}.`);
    console.log(`Cleanup records: ${report.cleanup.retried} retried, ${report.cleanup.succeeded} succeeded, ${report.cleanup.failed} failed, ${report.cleanup.pending} still pending.`);
    console.log(`Expired upload reservations: ${report.reservations.expired} found, ${report.reservations.reconciled} reconciled.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "The sweep failed.");
    process.exit(1);
  });
