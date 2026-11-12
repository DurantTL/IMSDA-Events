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
 * the sample area coordinator signed in with two-step sign-in done, the sample family account (one registration)
 * signed in with two-step sign-in done, or (#1882) the sample Clubs Administrator, a staff user who is not a system administrator,
 * signed in to the staff workspace with a placeholder two-step enrolment (the session is minted; no code is ever typed).
 */
export type WalkthroughStart = "signed-out" | "signed-in" | "signed-in-coordinator" | "signed-in-family" | "signed-in-clubs-admin";

export type WalkthroughContext = {
  page: WalkthroughPage;
  baseUrl: string;
  /** `/account/clubs/<id>` for the sample club. */
  clubPath: string;
  director: { email: string; password: string; displayName: string };
  /** The sample area coordinator, who has an authenticator app set up. */
  coordinator: { email: string; password: string; displayName: string };
  /** The sample family account, signed in for the family walkthroughs. `newPhone` is the number the change walkthrough types. */
  family: { email: string; password: string; displayName: string; phone: string; newPhone: string };
  /** The sample Clubs Administrator (#1882). `searchWord` finds the sample club `clubName` in the header search. */
  clubsAdmin: { displayName: string; searchWord: string; clubName: string };
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
 * What a step returns to say what its picture shows: the control to mark, or an object when the picture needs more:
 * - `alsoMark`: a second control that belongs to the same action (for example the Last name box beside First name). One
 *   outline then covers both.
 * - `area`: other context to keep in view (for example the person's whole card around the menu that is marked). It is not
 *   outlined.
 * The capture crops around the mark and the area together, at the usual picture size; when both do not fit, the mark stays in view.
 */
export type WalkthroughStepTarget = WalkthroughLocator | { target: WalkthroughLocator; alsoMark?: WalkthroughLocator; area?: WalkthroughLocator };

/**
 * Drives the page to the state a step's picture shows (doing whatever tap or typing leads there from the step before) and
 * returns the control to mark (see `WalkthroughStepTarget`), or null when the picture needs no mark.
 */
export type WalkthroughStepAction = (context: WalkthroughContext) => Promise<WalkthroughStepTarget | null>;

export type WalkthroughActions = {
  start: WalkthroughStart;
  /** One action per step id in `modules/help/walkthroughs.ts`, and no others. */
  steps: Record<string, WalkthroughStepAction>;
};
