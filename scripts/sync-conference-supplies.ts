/**
 * Operator step after migrations (#1688): makes sure the three conference-supplied patches and pins (Pathfinder Shoulder Patch,
 * Pathfinder Conference Pin, Adventurer Shoulder Patch) are in the club supply catalog at the conference sheet's prices.
 * Safe to run any number of times: it only adds a missing item and never changes an existing one, so a price staff set in
 * Admin, Club supply catalog is never overwritten. `docker-entrypoint.sh` runs it after `prisma migrate deploy`.
 *
 *   npm run conference-supplies:sync
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getPrisma } = await import("../lib/prisma");
  const { syncConferenceSupplyItems } = await import("../modules/club-orders/conference-items-sync");
  const prisma = getPrisma();
  try {
    const { created, existing } = await syncConferenceSupplyItems(prisma);
    for (const name of created) console.log(`${name}: added`);
    for (const name of existing) console.log(`${name}: already in the catalog; left as is`);
    console.log("Conference supply items are in sync.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
