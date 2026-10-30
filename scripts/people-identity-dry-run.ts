/**
 * READ-ONLY identity migration dry run (#128): which attendee accounts would
 * receive a person link, which households need effective-date backfill, which
 * people look like duplicates, and which rows cannot be classified, with
 * reconciliation totals and an exceptions list. Ids only.
 *
 *   npm run people:identity-dry-run
 *   npm run people:identity-dry-run -- --json
 *   npm run people:identity-dry-run -- --show-emails   # full emails: personal data
 *
 * It never writes (every query runs in a `SET TRANSACTION READ ONLY`
 * transaction) and applies nothing. Running it against production data is
 * human-only (AGENTS.md); see docs/PEOPLE-IDENTITY-MIGRATION-DRY-RUN.md.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { SHOW_EMAILS_WARNING } from "../modules/account-merge/dry-run-domain";
import { runIdentityMigrationDryRun } from "../modules/people/identity-migration-dry-run";
import { formatIdentityDryRunText } from "../modules/people/identity-migration-dry-run-domain";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(["--json", "--show-emails", "--help"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0 || args.includes("--help")) {
    process.stderr.write("Usage: npm run people:identity-dry-run -- [--json] [--show-emails]\n");
    process.exitCode = args.includes("--help") && unknown.length === 0 ? 0 : 1;
    return;
  }
  const showEmails = args.includes("--show-emails");
  if (showEmails) process.stderr.write(`${SHOW_EMAILS_WARNING}\n`);
  const prisma = new PrismaClient();
  try {
    const report = await runIdentityMigrationDryRun(prisma, { showEmails });
    process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatIdentityDryRunText(report));
    if (!report.reconciled) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
