/**
 * Human-run data step for the owner's decision of 2026-11-07 (issue #1652):
 * emergency contact and physician/clinic answers on the Off-Premises
 * Permission Slip and the Transportation Passenger List are plain, not
 * sealed. This moves those answers out of each existing submission's sealed
 * value into its plain answers; every other sealed answer stays sealed.
 *
 *   npm run club-forms:unseal-emergency              dry run (changes nothing)
 *   npm run club-forms:unseal-emergency -- --execute apply it
 *
 * Run it after `npm run club-forms:sync` has applied the new template
 * versions. Safe to run again: a submission with none of these answers in its
 * sealed value is left alone. Output and audit rows hold template keys,
 * submission ids and counts only, never an answer. A system administrator or
 * operator runs it in production; automation must not.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const execute = process.argv.includes("--execute");
  const { getPrisma } = await import("../lib/prisma");
  const { unsealEmergencyAnswers } = await import("../modules/club-forms/unseal-emergency");
  const prisma = getPrisma();
  try {
    console.log(execute ? "EXECUTE: moving emergency answers from sealed to plain." : "DRY RUN: nothing will be changed. Add --execute to apply.");
    const { templates } = await unsealEmergencyAnswers(prisma, { execute });
    let problems = 0;
    for (const item of templates) {
      console.log(`${item.templateKey}: ${item.status}; sealed submissions scanned ${item.scanned}, ${execute ? "moved" : "to move"} ${item.submissionsMoved} (${item.answersMoved} answers), sealed value dropped on ${item.sealedDropped}.`);
      if (item.message) console.log(`  ${item.message}`);
      for (const id of item.failedSubmissionIds) console.log(`  could not read the sealed value of submission ${id}`);
      if (item.status === "FAILED" || item.status === "NOT_SYNCED") problems += 1;
    }
    if (problems > 0) {
      console.error(`${problems} template(s) were not changed. See above.`);
      process.exitCode = 1;
      return;
    }
    console.log(execute ? "Done." : "Dry run complete. Run again with --execute to apply.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
