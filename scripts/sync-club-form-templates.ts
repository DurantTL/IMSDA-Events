/**
 * Operator step after migrations (#610): brings every club form template up
 * to the version in the code. A version that makes an answer newly sensitive
 * re-seals the existing submissions in the same transaction as the template
 * update, so this can take a while on a large table. It is the step for
 * deploys: `docker-entrypoint.sh` runs it after `prisma migrate deploy`
 * and before the app starts. A system administrator can also run the same
 * sync from Sync templates on /admin/club-forms (#742); that action is
 * single-flight and audited, but a proxy may time it out on a very large table.
 *
 * Until it has run, saves to a behind template are
 * refused and readers already treat the code's sensitive keys as restricted.
 *
 *   npm run club-forms:sync
 *
 * Safe to run any number of times. It carries on past a form it refuses (a
 * version that would make a sensitive answer or a birth date readable again
 * needs a reviewed change, and changes nothing for that form), syncs every
 * other form, reports each refusal, and exits non-zero at the end.
 *
 * A template that was edited or created in the club form builder (#712) is
 * never overwritten: the sync logs that it skipped it. A template with only an
 * unpublished draft is still updated; its draft is left in place and reported
 * as stale (it must be discarded: it can no longer be saved or published).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/** 1 when any submission on the two forms still holds an emergency key in its sealed value (or cannot be checked), else 0. Opened here, never printed. */
async function countStillSealed(
  prisma: import("@prisma/client").PrismaClient,
  templateKeys: string[],
  keysByTemplate: Readonly<Record<string, readonly string[]>>,
) {
  const { openSensitiveAnswers } = await import("../modules/club-forms/sealed-answers");
  const rows = await prisma.clubFormSubmission.findMany({
    where: { template: { key: { in: templateKeys } }, sealedSensitiveAnswers: { not: null } },
    select: { id: true, sealedSensitiveAnswers: true, template: { select: { key: true } } },
  });
  let count = 0;
  for (const row of rows) {
    try {
      const held = Object.keys(openSensitiveAnswers(row.id, row.sealedSensitiveAnswers!));
      if (held.some((key) => keysByTemplate[row.template.key]?.includes(key))) count += 1;
    } catch {
      // Unsure (wrong or missing key): count it, so the reminder still prints. The unseal script reports the details.
      count += 1;
    }
    if (count > 0) break; // Only used as a yes/no check.
  }
  return count;
}

async function main() {
  const { getPrisma } = await import("../lib/prisma");
  const { syncClubFormTemplates } = await import("../modules/club-forms/templates");
  const prisma = getPrisma();
  try {
    const { refused, skipped, staleDrafts, updated } = await syncClubFormTemplates(prisma, { continueOnRefusal: true });
    for (const item of skipped) console.log(`SKIPPED ${item.key}: ${item.reason}; the code's version is not applied.`);
    for (const item of staleDrafts) console.log(`UPDATED ${item.key}: draft is now stale`);
    const rows = await prisma.clubFormTemplate.findMany({ orderBy: { sortOrder: "asc" }, select: { key: true, version: true, enabled: true } });
    for (const row of rows) console.log(`${row.key}: version ${row.version}${row.enabled ? " (on)" : " (off)"}`);
    if (refused.length > 0) {
      for (const item of refused) console.error(`REFUSED ${item.message}`);
      console.error(`${refused.length} club form template(s) were not synced and need a reviewed change.`);
      process.exitCode = 1;
      return;
    }
    console.log("Club form templates are in sync.");
    // Only when it matters: a version of one of the two forms was applied just now, or one of them still has answers sealed.
    const { EMERGENCY_PLAIN_KEYS } = await import("../modules/club-forms/plain-emergency");
    const emergencyKeys = Object.keys(EMERGENCY_PLAIN_KEYS);
    const versionChanged = updated.some((item) => !item.created && emergencyKeys.includes(item.key));
    const stillSealed = versionChanged ? 0 : await countStillSealed(prisma, emergencyKeys, EMERGENCY_PLAIN_KEYS);
    if (versionChanged || stillSealed > 0) {
      console.log("The Off-Premises Permission Slip and the Transportation Passenger List now keep emergency and physician answers plain. Move the existing ones with: npm run club-forms:unseal-emergency (dry run), then npm run club-forms:unseal-emergency -- --execute --actor <your account email>.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
