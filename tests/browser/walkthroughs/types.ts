/**
 * The contract between the shared walkthrough steps and whatever drives them (#1482). The capture script
 * (`scripts/capture-help-screenshots.ts`) and the browser check (`npm run test:walkthroughs`) both use the harness in
 * `scripts/support/walkthrough-harness.ts`; the club browser tests (#1439) can supply their own context and run the same steps.
 *
 * Playwright is not a dependency, so the browser types are structural stand-ins.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type WalkthroughPage = any;
export type WalkthroughLocator = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Where a walkthrough starts: a visitor who is not signed in, the sample club director signed in with two-step sign-in done,
 * or the sample area coordinator signed in with two-step sign-in done.
 */
export type WalkthroughStart = "signed-out" | "signed-in" | "signed-in-coordinator";

export type WalkthroughContext = {
  page: WalkthroughPage;
  baseUrl: string;
  /** `/account/clubs/<id>` for the sample club. */
  clubPath: string;
  director: { email: string; password: string; displayName: string };
  /** The sample area coordinator, who has an authenticator app set up. */
  coordinator: { email: string; password: string; displayName: string };
  /** The six-digit code the coordinator's authenticator app shows right now. */
  authenticatorCode: () => string;
  /** The sample person the roster walkthrough adds, edits and removes. */
  rosterPerson: { firstName: string; lastName: string; editedRole: string };
  /** The sample person the leaders walkthrough invites. */
  invitee: { email: string };
  /** The sample supply the orders walkthrough adds. */
  supplyName: string;
  /**
   * The six-digit code the app emailed for the sign-in that just started. Read from the local development mail path, never
   * from real email. Resolves once the code is known.
   */
  readSignInCode: () => Promise<string>;
  /** Puts the browser in the start state. Called once before the first step. */
  begin: (start: WalkthroughStart) => Promise<void>;
};

/**
 * Drives the page to the state a step's picture shows (doing whatever tap or typing leads there from the step before) and
 * returns the control to mark, or null when the picture needs no mark.
 */
export type WalkthroughStepAction = (context: WalkthroughContext) => Promise<WalkthroughLocator | null>;

export type WalkthroughActions = {
  start: WalkthroughStart;
  /** One action per step id in `modules/help/walkthroughs.ts`, and no others. */
  steps: Record<string, WalkthroughStepAction>;
};
