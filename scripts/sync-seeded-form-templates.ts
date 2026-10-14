/**
 * Operator step after migrations (#153): brings the seeded form templates
 * (Women's Retreat, Camp Meeting, Spring Camporee) up to the versions in
 * `prisma/seed-data/form-templates/`. Safe to run any number of times: a
 * template is written only when it is missing or its seed version is higher.
 * It never reads or changes an event, a registration form or a published form
 * version: those keep the definition they were created with.
 * `docker-entrypoint.sh` runs it after `prisma migrate deploy`.
 *
 *   npm run form-templates:sync
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getPrisma } = await import("../lib/prisma");
  const { syncSeededFormTemplates } = await import("../modules/forms/seeded-templates");
  const prisma = getPrisma();
  try {
    const { created, updated, unchanged, ahead } = await syncSeededFormTemplates(prisma);
    for (const item of created) console.log(`${item.key}: created at version ${item.version}`);
    for (const item of updated) console.log(`${item.key}: updated from version ${item.from} to ${item.to}`);
    for (const item of unchanged) console.log(`${item.key}: version ${item.version} already current`);
    for (const item of ahead) console.log(`${item.key}: stored version ${item.stored} is newer than the code's ${item.code}; left as is`);
    console.log("Seeded form templates are in sync.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
