/**
 * READ-ONLY preview of central Email settings migration 20261114100000_central_email (#1043): how many events the
 * migration pauses (and which), and which events have a sender email that differs from the central one.
 *
 *   npm run email:migration-preview
 *   npm run email:migration-preview -- --json
 *
 * It never writes: it runs in a `SET TRANSACTION READ ONLY` transaction. Run it BEFORE applying the migration (it also
 * works after, because the old columns are kept). Applying the migration in production is a human step.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { formatCentralEmailPreview, loadCentralEmailPreview } from "../modules/communications/central-email-preview";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write("Usage: npm run email:migration-preview -- [--json]\n");
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  try {
    const preview = await loadCentralEmailPreview(prisma);
    process.stdout.write(args.includes("--json") ? `${JSON.stringify(preview, null, 2)}\n` : formatCentralEmailPreview(preview));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
