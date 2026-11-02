/**
 * Stopping a walkthrough run cleanly (#1482). A SIGINT or SIGTERM only sets a flag; the run checks it before every write, so it
 * never changes the database after it has been told to stop, and the one `finally` in the harness does the single restore and the
 * exit. Pure, so the ordering is tested without a database.
 */
export class RunStopped extends Error {
  constructor() {
    super("The run was stopped.");
    this.name = "RunStopped";
  }
}

/** Throws RunStopped when the run has been told to stop. */
export function throwIfStopping(shouldStop: () => boolean) {
  if (shouldStop()) throw new RunStopped();
}

export type SetupStep = { name: string; run: () => Promise<void> };

/** Runs the steps in order, checking `shouldStop` before each one. Steps after a stop never run. Returns the names of the steps that ran. */
export async function runSetupSteps(steps: readonly SetupStep[], shouldStop: () => boolean): Promise<string[]> {
  const ran: string[] = [];
  for (const step of steps) {
    throwIfStopping(shouldStop);
    await step.run();
    ran.push(step.name);
  }
  return ran;
}
