/**
 * Outdated-guide check (#1259): `npm run help:check`.
 *
 * Prints every staff and portal help guide problem and exits 1 when there is any:
 * a guide using an undefined destination, a destination whose route has no page under app/, a related doc that does
 * not exist, or a guide not reviewed for more than `maxGuideAgeDays` days. It reads only the repository and changes
 * nothing. It is run by hand when menus or routes change. It is not part of CI: a guide going stale by the calendar
 * should prompt a review, not break an unrelated pull request.
 *
 * It also prints WARNINGS (never an exit code of its own) for walkthrough pictures that may be stale (#1482): a walkthrough
 * whose source files changed since its pictures were captured, or that has no entry in the screenshot manifest. A missing
 * picture file is an error. With GITHUB_ACTIONS set, warnings are also written as `::warning::` annotations.
 */
import { checkHelpGuides, maxGuideAgeDays } from "@/modules/help/guide-check";
import { docFileExists, listPageRoutes, publicFileExists } from "@/modules/help/guide-check-files";
import { checkWalkthroughManifest } from "@/modules/help/walkthrough-check";
import { readWalkthroughManifest, walkthroughSourceHash } from "@/modules/help/walkthrough-files";
import { walkthroughs } from "@/modules/help/walkthroughs";

const problems = checkHelpGuides({ now: new Date(), routes: listPageRoutes(), docExists: (path) => docFileExists(path), publicFileExists: (path) => publicFileExists(path) });

if (problems.length === 0) {
  console.log(`Help guides are current: every destination has a page, every related doc exists, and every review is within ${maxGuideAgeDays} days.`);
} else {
  console.error(`${problems.length} help guide ${problems.length === 1 ? "problem" : "problems"}:`);
  for (const problem of problems) console.error(`- [${problem.source}] ${problem.kind}: ${problem.message}`);
  process.exitCode = 1;
}

const warnings = checkWalkthroughManifest({
  walkthroughs,
  manifest: readWalkthroughManifest(),
  currentHashes: Object.fromEntries(walkthroughs.map((walkthrough) => [walkthrough.id, walkthroughSourceHash(walkthrough)])),
});
if (warnings.length === 0) {
  console.log(`Walkthrough pictures are current for all ${walkthroughs.length} walkthroughs.`);
} else {
  console.warn(`\n${warnings.length} walkthrough ${warnings.length === 1 ? "warning" : "warnings"} (not errors):`);
  for (const warning of warnings) {
    console.warn(`- [walkthrough] ${warning.kind}: ${warning.message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Walkthrough pictures may be stale::${warning.message}`);
  }
}
