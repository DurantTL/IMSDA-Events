/**
 * Outdated-guide check (#1259): `npm run help:check`.
 *
 * Prints every staff and portal help guide problem and exits 1 when there is any:
 * a guide using an undefined destination, a destination whose route has no page under app/, a related doc that does
 * not exist, or a guide not reviewed for more than `maxGuideAgeDays` days. It reads only the repository and changes
 * nothing. It is run by hand when menus or routes change. It is not part of CI: a guide going stale by the calendar
 * should prompt a review, not break an unrelated pull request.
 */
import { checkHelpGuides, maxGuideAgeDays } from "@/modules/help/guide-check";
import { docFileExists, listPageRoutes, publicFileExists } from "@/modules/help/guide-check-files";

const problems = checkHelpGuides({ now: new Date(), routes: listPageRoutes(), docExists: (path) => docFileExists(path), publicFileExists: (path) => publicFileExists(path) });

if (problems.length === 0) {
  console.log(`Help guides are current: every destination has a page, every related doc exists, and every review is within ${maxGuideAgeDays} days.`);
} else {
  console.error(`${problems.length} help guide ${problems.length === 1 ? "problem" : "problems"}:`);
  for (const problem of problems) console.error(`- [${problem.source}] ${problem.kind}: ${problem.message}`);
  process.exitCode = 1;
}
