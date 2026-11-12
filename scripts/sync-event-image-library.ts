/**
 * Operator step (#1913): adds every existing event header image to the shared image library. Safe to run any number
 * of times: an image already in the library (same file contents) is only linked, never added twice. It reads event
 * pages and uploaded files and writes only library rows and the library's own copies; it never changes an event.
 *
 *   npm run event-image-library:sync
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getPrisma } = await import("../lib/prisma");
  const { syncHeaderImagesToLibrary } = await import("../modules/events/image-library");
  const prisma = getPrisma();
  try {
    const { added, alreadyThere, skipped } = await syncHeaderImagesToLibrary();
    console.log(`Header images added to the library: ${added}`);
    console.log(`Already in the library: ${alreadyThere}`);
    console.log(`Skipped (no image chosen, or the file is missing): ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
