/**
 * Walkthrough browser check (#1482): `npm run test:walkthroughs`.
 *
 * Runs every walkthrough's shared steps (`tests/browser/walkthroughs/`) against the running local app at phone and desktop
 * width, without saving anything. It fails when a step's action throws or the control it should mark is not on the screen:
 * a page that changed under a guide breaks CI instead of leaving people with a wrong picture. The same steps are what the
 * club browser tests (#1439) reuse.
 *
 * LOCAL USE ONLY: see `scripts/support/walkthrough-harness.ts` for the guards. Environment: HELP_SHOTS_BASE_URL,
 * HELP_SHOTS_ONLY, HELP_SHOTS_BROWSER (same as `npm run help:screenshots`).
 */
import { runWalkthroughHarness } from "./support/walkthrough-harness";

const baseUrl = process.env.HELP_SHOTS_BASE_URL ?? "http://localhost:3000";

runWalkthroughHarness({ baseUrl, only: process.env.HELP_SHOTS_ONLY || undefined, kinds: ["phone", "desktop"], onStep: async ({ walkthroughId, stepId, kind }) => console.log(`  ok ${walkthroughId} ${stepId} (${kind})`) })
  .then((result) => {
    const steps = result.reduce((sum, row) => sum + row.steps, 0);
    console.log(`\nAll walkthrough steps ran: ${result.length} runs, ${steps} steps.`);
  })
  .catch((error) => {
    console.error(`\nA walkthrough step failed:\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
