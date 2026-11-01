import { findWalkthrough } from "@/modules/help/walkthroughs";
import { clubDirectorWalkthroughActions } from "./club-director";
import type { WalkthroughActions, WalkthroughContext, WalkthroughLocator } from "./types";

/**
 * Every walkthrough's browser actions, by walkthrough id (#1482). The data (ids, text, alt text) is in
 * `modules/help/walkthroughs.ts`; `tests/walkthroughs-1482.test.ts` checks the two agree step for step.
 * Coordinator walkthroughs are added here.
 */
export const walkthroughActions: Record<string, WalkthroughActions> = {
  ...clubDirectorWalkthroughActions,
};

export type StepEvent = {
  walkthroughId: string;
  stepId: string;
  /** 0-based. */
  index: number;
  total: number;
  /** The control to mark, or null. */
  target: WalkthroughLocator | null;
};

/**
 * Runs one walkthrough's steps in order. `onStep` runs after each step has put the page in its state: the capture script
 * screenshots there; the browser check only counts. Throws when a step's action is missing, when it fails, or when the
 * control it returned is not visible.
 */
export async function runWalkthrough(
  walkthroughId: string,
  context: WalkthroughContext,
  onStep?: (event: StepEvent) => Promise<void>,
): Promise<number> {
  const definition = findWalkthrough(walkthroughId);
  const actions = walkthroughActions[walkthroughId];
  if (!definition || !actions) throw new Error(`No walkthrough "${walkthroughId}".`);
  await context.begin(actions.start);
  for (const [index, step] of definition.steps.entries()) {
    const action = actions.steps[step.id];
    if (!action) throw new Error(`${walkthroughId}: step "${step.id}" has no browser action.`);
    let target: WalkthroughLocator | null;
    try {
      target = await action(context);
      if (target) await target.first().waitFor({ state: "visible", timeout: 15_000 });
    } catch (error) {
      throw new Error(`${walkthroughId} step ${index + 1} "${step.id}": ${(error as Error).message.split("\n")[0]}`);
    }
    await onStep?.({ walkthroughId, stepId: step.id, index, total: definition.steps.length, target });
  }
  return definition.steps.length;
}
