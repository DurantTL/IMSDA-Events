/**
 * Registration ledger backfill (#117). Run by hand, after the migration is deployed and the new code is live:
 *
 *   npm run ledger:backfill                      dry run: prints what would be written and the residuals
 *   npm run ledger:backfill -- --apply           writes the missing entries
 *   npm run ledger:backfill -- --event <id>      limit either mode to one event
 *
 * It never runs from the seed, a migration, postinstall, the Docker entrypoint or app start. Safe to repeat: entries
 * that already exist (same source and kind) are skipped, so a second run writes nothing. It writes no balancing entry:
 * a registration whose ledger differs from its total is reported as a residual and left for the Ledger check page.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function parseArgs(argv: string[]) {
  let apply = false;
  let eventId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--event") {
      eventId = argv[index + 1];
      index += 1;
      if (!eventId || eventId.startsWith("--")) throw new Error("--event needs an event id.");
    } else if (arg.startsWith("--event=")) eventId = arg.slice("--event=".length);
    else throw new Error(`Unknown argument: ${arg}. Use --apply and --event <id>.`);
  }
  return { apply, eventId };
}

async function main() {
  const { apply, eventId } = parseArgs(process.argv.slice(2));
  const { getPrisma } = await import("../lib/prisma");
  const { runLedgerBackfill, formatBackfillReport } = await import("../modules/ledger/backfill");
  const prisma = getPrisma();
  try {
    const report = await runLedgerBackfill(prisma, { apply, eventId });
    console.log(formatBackfillReport(report));
    if (report.failures.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
