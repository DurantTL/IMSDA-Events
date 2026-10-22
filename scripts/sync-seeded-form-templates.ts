/**
 * Operator step after migrations (#153, #1064): brings the code's form templates
 * (the seeded Women's Retreat, Camp Meeting and Spring Camporee, from
 * `prisma/seed-data/form-templates/`, and the rest of `formTemplates`) up to
 * date. Safe to run any number of times: a template is written only when it is
 * missing or the code's version is newer. A template whose latest version was
 * saved in the app by a system administrator is never changed.
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
    const { created, updated, unchanged, ahead, appOwned } = await syncSeededFormTemplates(prisma);
    for (const item of created) console.log(`${item.key}: created at version ${item.version}`);
    for (const item of updated) console.log(`${item.key}: updated from version ${item.from} to ${item.to}`);
    for (const item of unchanged) console.log(`${item.key}: version ${item.version} already current`);
    for (const item of ahead) console.log(`${item.key}: stored version ${item.stored} is newer than the code's ${item.code}; left as is`);
    for (const item of appOwned) console.log(`${item.key}: version ${item.version} was saved in the app; code updates do not apply`);
    console.log("Seeded form templates are in sync.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
