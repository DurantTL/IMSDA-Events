/**
 * Human-run data step for the owner's decision of 2026-11-07 (issue #1652):
 * emergency contact and physician/clinic answers on the Off-Premises
 * Permission Slip and the Transportation Passenger List are plain, not
 * sealed. This moves those answers out of each existing submission's sealed
 * value into its plain answers; every other sealed answer stays sealed.
 *
 *   npm run club-forms:unseal-emergency                                  dry run (changes nothing, takes no lock)
 *   npm run club-forms:unseal-emergency -- --execute --actor <email>     apply it
 *
 * `--actor` is the email of the user account that runs it; it is required with
 * `--execute` and is recorded on the audit row (as the user id, not the email).
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
  const actorAt = process.argv.indexOf("--actor");
  const actorEmail = actorAt >= 0 ? process.argv[actorAt + 1] : undefined;
  if (execute && (!actorEmail || actorEmail.startsWith("--"))) {
    console.error("--execute needs --actor <email>: the user account that runs this, recorded in the audit log.");
    process.exit(1);
  }
  const { getPrisma } = await import("../lib/prisma");
  const { unsealEmergencyAnswers } = await import("../modules/club-forms/unseal-emergency");
  const prisma = getPrisma();
  try {
    let actorUserId: string | undefined;
    if (execute) {
      const actor = await prisma.user.findUnique({ where: { email: actorEmail!.trim().toLowerCase() }, select: { id: true } });
      if (!actor) {
        console.error("No user account has that email, so nothing was changed.");
        process.exitCode = 1;
        return;
      }
      actorUserId = actor.id;
    }
    console.log(execute ? "EXECUTE: moving emergency answers from sealed to plain." : "DRY RUN: nothing will be changed. Add --execute to apply.");
    const { templates } = await unsealEmergencyAnswers(prisma, { execute, actorUserId });
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
  // Only the error's name and code: a database error message can quote the row it failed on, and that holds answers.
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  console.error(`Failed: ${typeof name === "string" ? name : "Error"}${typeof code === "string" ? ` (${code})` : ""}. Nothing was printed from the data.`);
  process.exit(1);
});
