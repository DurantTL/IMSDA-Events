/**
 * Operator step after migrations (#919): brings the seeded event content (the
 * Camp Meeting meal preset and cancellation rule preset, from
 * `prisma/seed-data/event-content/`) up to date. Safe to run any number of
 * times: a row is written only when it is missing or the code's version is
 * higher. It only creates or updates `SeededEventContent` rows: it never reads
 * or changes an event, its meals, its cancellation rules, its lodging or its
 * messages. `docker-entrypoint.sh` runs it after `prisma migrate deploy`.
 *
 *   npm run event-content:sync
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getPrisma } = await import("../lib/prisma");
  const { syncSeededEventContent } = await import("../modules/event-content/repository");
  const prisma = getPrisma();
  try {
    const { created, updated, unchanged, ahead } = await syncSeededEventContent(prisma);
    for (const item of created) console.log(`${item.kind} ${item.key}: created at version ${item.version}`);
    for (const item of updated) console.log(`${item.kind} ${item.key}: updated from version ${item.from} to ${item.to}`);
    for (const item of unchanged) console.log(`${item.kind} ${item.key}: version ${item.version} already current`);
    for (const item of ahead) console.log(`${item.kind} ${item.key}: stored version ${item.stored} is newer than the code's ${item.code}; left as is`);
    console.log("Seeded event content is in sync.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
